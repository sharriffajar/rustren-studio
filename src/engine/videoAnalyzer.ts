import type { AiReferenceImage } from './types';

/**
 * Browser-local reference video analyzer.
 *
 * Everything in this module runs in the browser: the video file never leaves
 * the user's machine. The HTML5 `<video>` element is sampled with an offscreen
 * `<canvas>` and only light-weight JPEG keyframes + structured metadata are
 * produced for the (optional) Vision LLM step.
 *
 * The statistical helpers are pure functions so they can be unit-tested in Node
 * without a DOM.
 */

export const MAX_VIDEO_BYTES = 150 * 1024 * 1024;
export const DEFAULT_SAMPLE_INTERVAL_SEC = 0.5;
export const DEFAULT_MAX_SAMPLES = 50;
export const DEFAULT_MAX_KEYFRAMES = 6;
export const DEFAULT_PALETTE_SIZE = 5;

export type ShotMotion = 'static' | 'moderate' | 'dynamic';
export type ShotLuma = 'dark' | 'mid' | 'bright';

export interface Shot {
  /** 0-based index in timeline order. */
  index: number;
  startSec: number;
  endSec: number;
  durationSec: number;
  motion: ShotMotion;
  luma: ShotLuma;
}

/** Minimal per-frame statistics needed to detect cuts and classify shots. */
export interface ShotSample {
  timeSec: number;
  /** Mean perceptual luma in 0..255. */
  luma: number;
  /** Normalised luma histogram (sums to 1). */
  histogram: number[];
}

export interface ShotCutOptions {
  durationSec: number;
  /** Histogram distance (0..1) that counts as a hard cut. Default 0.32. */
  cutThreshold?: number;
  /** Never emit shots shorter than this. Default 0.6s. */
  minShotSec?: number;
}

export interface VideoForensics {
  fileName: string;
  durationSec: number;
  width: number;
  height: number;
  /** How many frames the analyzer actually sampled. */
  sampledFrames: number;
  shots: Shot[];
  /** Five dominant colours, `#RRGGBB`. */
  palette: string[];
  /** Timestamps (seconds) of the attached keyframes, when available. */
  keyframeTimes?: number[];
}

export interface VideoKeyframe extends AiReferenceImage {
  timeSec: number;
  shotIndex: number;
}

export interface VideoAnalysisResult extends VideoForensics {
  fileSizeBytes: number;
  keyframes: VideoKeyframe[];
}

export interface AnalyzeVideoOptions {
  sampleIntervalSec?: number;
  maxSamples?: number;
  maxKeyframes?: number;
  maxFileSizeBytes?: number;
  onProgress?: (progress: number) => void;
}

const FRAME_STATS_BINS = 16;
const ANALYSIS_MAX_WIDTH = 160;
const KEYFRAME_MAX_WIDTH = 512;
const KEYFRAME_JPEG_QUALITY = 0.75;
const SEEK_TIMEOUT_MS = 5000;

/* ------------------------------------------------------------------------- */
/* Pure helpers                                                              */
/* ------------------------------------------------------------------------- */

export function computeFrameStats(pixels: ArrayLike<number>): {
  luma: number;
  histogram: number[];
  color: [number, number, number];
} {
  const bins = new Array<number>(FRAME_STATS_BINS).fill(0);
  let r = 0;
  let g = 0;
  let b = 0;
  let lumaSum = 0;
  let count = 0;

  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] < 32) continue;
    const pr = pixels[i];
    const pg = pixels[i + 1];
    const pb = pixels[i + 2];
    r += pr;
    g += pg;
    b += pb;
    const luma = 0.2126 * pr + 0.7152 * pg + 0.0722 * pb;
    lumaSum += luma;
    const bin = Math.min(FRAME_STATS_BINS - 1, Math.max(0, Math.floor((luma / 256) * FRAME_STATS_BINS)));
    bins[bin] += 1;
    count += 1;
  }

  if (count === 0) {
    return {
      luma: 0,
      histogram: new Array<number>(FRAME_STATS_BINS).fill(1 / FRAME_STATS_BINS),
      color: [0, 0, 0],
    };
  }

  return {
    luma: lumaSum / count,
    histogram: bins.map((value) => value / count),
    color: [r / count, g / count, b / count],
  };
}

/** Total-variation distance between two normalised histograms, 0..1. */
export function histogramDistance(a: number[], b: number[]): number {
  const length = Math.max(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < length; i += 1) {
    sum += Math.abs((a[i] ?? 0) - (b[i] ?? 0));
  }
  return Math.min(1, sum / 2);
}

function classifyLuma(luma: number): ShotLuma {
  if (luma < 86) return 'dark';
  if (luma >= 170) return 'bright';
  return 'mid';
}

function classifyMotion(averageDistance: number): ShotMotion {
  if (averageDistance < 0.045) return 'static';
  if (averageDistance < 0.16) return 'moderate';
  return 'dynamic';
}

/**
 * Detect shot boundaries from sampled frame histograms.
 *
 * A cut is a pair of consecutive samples whose histogram distance exceeds
 * `cutThreshold`. Boundary time is the midpoint between the two samples and
 * cuts closer than `minShotSec` to the previous one are ignored.
 */
export function detectShotCuts(
  samples: ShotSample[],
  options: ShotCutOptions,
): Shot[] {
  const durationSec = Math.max(0, options.durationSec);
  if (samples.length === 0 || durationSec === 0) return [];

  const ordered = [...samples].sort((a, b) => a.timeSec - b.timeSec);
  const cutThreshold = options.cutThreshold ?? 0.32;
  const minShotSec = Math.max(0.05, options.minShotSec ?? 0.6);

  const boundaries: number[] = [0];
  for (let i = 0; i < ordered.length - 1; i += 1) {
    const distance = histogramDistance(ordered[i].histogram, ordered[i + 1].histogram);
    if (distance < cutThreshold) continue;

    const boundary = (ordered[i].timeSec + ordered[i + 1].timeSec) / 2;
    const previous = boundaries[boundaries.length - 1];
    if (boundary - previous < minShotSec) continue;
    if (durationSec - boundary < minShotSec) continue;
    boundaries.push(boundary);
  }
  boundaries.push(durationSec);

  const shots: Shot[] = [];
  for (let i = 0; i < boundaries.length - 1; i += 1) {
    const startSec = boundaries[i];
    const endSec = boundaries[i + 1];
    if (endSec - startSec <= 0) continue;

    const inShot = ordered.filter((sample) => sample.timeSec >= startSec && sample.timeSec < endSec);
    const usable = inShot.length > 0 ? inShot : [ordered[Math.min(ordered.length - 1, i)]];

    let distanceSum = 0;
    let distanceCount = 0;
    for (let s = 0; s < usable.length - 1; s += 1) {
      distanceSum += histogramDistance(usable[s].histogram, usable[s + 1].histogram);
      distanceCount += 1;
    }
    const averageDistance = distanceCount > 0 ? distanceSum / distanceCount : 0;
    const averageLuma = usable.reduce((sum, sample) => sum + sample.luma, 0) / usable.length;

    shots.push({
      index: shots.length,
      startSec: Number(startSec.toFixed(3)),
      endSec: Number(endSec.toFixed(3)),
      durationSec: Number((endSec - startSec).toFixed(3)),
      motion: classifyMotion(averageDistance),
      luma: classifyLuma(averageLuma),
    });
  }

  return shots;
}

interface PaletteBin {
  r: number;
  g: number;
  b: number;
  count: number;
}

function toHex(r: number, g: number, b: number): string {
  const value = (1 << 24) + (r << 16) + (g << 8) + b;
  return `#${value.toString(16).slice(1).toUpperCase()}`;
}

function colorDistance(a: PaletteBin, b: PaletteBin): number {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

/**
 * Extract the dominant colours from one or more RGBA frame buffers.
 *
 * Pixels are quantised into a 4-bit-per-channel histogram, then the most
 * frequent bins are picked while merging near-duplicates. Transparent pixels
 * (alpha < 32) are ignored.
 */
export function extractDominantPalette(
  frames: ArrayLike<number>[],
  maxColors = DEFAULT_PALETTE_SIZE,
  mergeDistance = 42,
): string[] {
  if (maxColors <= 0 || frames.length === 0) return [];

  const bins = new Map<number, PaletteBin>();
  for (const pixels of frames) {
    const pixelCount = Math.floor(pixels.length / 4);
    if (pixelCount === 0) continue;
    // Cap the work per frame at roughly 6000 pixels.
    const stride = 4 * Math.max(1, Math.floor(pixelCount / 6000));

    for (let i = 0; i + 3 < pixels.length; i += stride) {
      if (pixels[i + 3] < 32) continue;
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      const existing = bins.get(key);
      if (existing) {
        existing.r += r;
        existing.g += g;
        existing.b += b;
        existing.count += 1;
      } else {
        bins.set(key, { r, g, b, count: 1 });
      }
    }
  }

  const sorted = [...bins.values()]
    .map((bin) => ({
      r: Math.round(bin.r / bin.count),
      g: Math.round(bin.g / bin.count),
      b: Math.round(bin.b / bin.count),
      count: bin.count,
    }))
    .sort((a, b) => b.count - a.count);

  const picked: PaletteBin[] = [];
  for (const candidate of sorted) {
    if (picked.some((color) => colorDistance(color, candidate) < mergeDistance)) continue;
    picked.push(candidate);
    if (picked.length >= maxColors) break;
  }

  return picked.map((color) => toHex(color.r, color.g, color.b));
}

function greatestCommonDivisor(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y) {
    const temp = y;
    y = x % y;
    x = temp;
  }
  return x || 1;
}

export function aspectRatioLabel(width: number, height: number): string {
  if (width <= 0 || height <= 0) return 'unknown';
  const divisor = greatestCommonDivisor(width, height);
  return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
}

/* ------------------------------------------------------------------------- */
/* Prompt formatting                                                         */
/* ------------------------------------------------------------------------- */

/** Format the locally extracted forensics as a compact prompt block. */
export function formatVideoAnalysisForPrompt(analysis: VideoForensics): string {
  const shotCount = analysis.shots.length;
  const averageShot = shotCount > 0
    ? analysis.shots.reduce((sum, shot) => sum + shot.durationSec, 0) / shotCount
    : 0;
  const palette = analysis.palette.length > 0 ? analysis.palette.join(', ') : 'not detected';
  const keyframeTimes = analysis.keyframeTimes ?? [];

  const lines: string[] = [
    '=== REFERENCE VIDEO FORENSICS (analyzed locally in the browser, no upload) ===',
    `Source: ${analysis.fileName} · ${analysis.durationSec.toFixed(2)}s · ${analysis.width}x${analysis.height} (${aspectRatioLabel(analysis.width, analysis.height)}) · ${analysis.sampledFrames} sampled frames`,
    `Shots detected: ${shotCount}${shotCount > 0 ? ` · average shot ${averageShot.toFixed(2)}s` : ''}`,
    `Dominant palette: ${palette}`,
    '',
    'Shot timeline:',
  ];

  if (shotCount === 0) {
    lines.push('  (no shot boundaries detected — treat the clip as one continuous shot)');
  } else {
    for (const shot of analysis.shots) {
      lines.push(
        `  #${String(shot.index + 1).padStart(2, '0')}  ${shot.startSec.toFixed(2)}s → ${shot.endSec.toFixed(2)}s  (${shot.durationSec.toFixed(2)}s)  luma=${shot.luma}  motion=${shot.motion}`,
      );
    }
  }

  if (keyframeTimes.length > 0) {
    lines.push(
      '',
      `Attached keyframes: ${keyframeTimes.length} (at ${keyframeTimes.map((t) => `${t.toFixed(2)}s`).join(', ')}), one representative frame per major shot.`,
    );
  }

  lines.push(
    '',
    'Reproduction rules:',
    '1. Match the palette above exactly (background, surfaces, text and accents).',
    '2. Rebuild the same number of shots with equivalent durations, mapped onto start_sec / end_sec and the canvas duration.',
    '3. Reproduce the luminance progression (dark → mid → bright) and the motion energy of each shot (static / moderate / dynamic).',
    '4. Reuse the composition, whitespace and typographic rhythm visible in the keyframes.',
    '5. Replace only the subject and the copy with the user’s product; do not change the structure or pacing unless asked.',
    '=== END VIDEO FORENSICS ===',
  );

  return lines.join('\n');
}

/* ------------------------------------------------------------------------- */
/* Browser analysis                                                          */
/* ------------------------------------------------------------------------- */

function isSupportedVideo(file: File): boolean {
  const type = file.type.toLowerCase();
  if (type === 'video/mp4' || type === 'video/webm') return true;
  return /\.(mp4|webm)$/i.test(file.name);
}

function waitForEvent(
  target: HTMLVideoElement,
  event: string,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      target.removeEventListener(event, onEvent);
      target.removeEventListener('error', onError);
      window.clearTimeout(timer);
      fn();
    };
    const onEvent = () => finish(resolve);
    const onError = () => finish(() => reject(new Error('The browser could not decode this video.')));
    const timer = window.setTimeout(
      () => finish(() => reject(new Error(timeoutMessage))),
      timeoutMs,
    );
    target.addEventListener(event, onEvent, { once: true });
    target.addEventListener('error', onError, { once: true });
  });
}

async function seekTo(video: HTMLVideoElement, timeSec: number): Promise<void> {
  if (Math.abs(video.currentTime - timeSec) < 0.001) return;
  const seeked = waitForEvent(video, 'seeked', SEEK_TIMEOUT_MS, 'Timed out while sampling the video.');
  video.currentTime = timeSec;
  await seeked;
}

function drawToCanvas(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  maxWidth: number,
): CanvasRenderingContext2D {
  const sourceWidth = video.videoWidth || 1;
  const sourceHeight = video.videoHeight || 1;
  const scale = Math.min(1, maxWidth / sourceWidth);
  canvas.width = Math.max(1, Math.round(sourceWidth * scale));
  canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas 2D is not available in this browser.');
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return context;
}

async function resolveDuration(video: HTMLVideoElement): Promise<number> {
  if (Number.isFinite(video.duration) && video.duration > 0) return video.duration;

  // Some WebM files report Infinity until the browser seeks to the end.
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      video.removeEventListener('timeupdate', finish);
      window.clearTimeout(timer);
      resolve();
    };
    const timer = window.setTimeout(finish, 2000);
    video.addEventListener('timeupdate', finish);
    try {
      video.currentTime = 1e7;
    } catch {
      finish();
    }
  });
  video.currentTime = 0;

  if (Number.isFinite(video.duration) && video.duration > 0) return video.duration;
  throw new Error('Could not read the video duration. Try a standard MP4 (H.264) or WebM file.');
}

function makeKeyframe(
  fileName: string,
  index: number,
  timeSec: number,
  shotIndex: number,
  dataUrl: string,
): VideoKeyframe {
  const comma = dataUrl.indexOf(',');
  const baseName = fileName.replace(/\.[^.]+$/, '') || 'video';
  return {
    id: `video-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
    name: `${baseName}-keyframe-${index + 1}.jpg`,
    mimeType: 'image/jpeg',
    dataUrl,
    base64: comma >= 0 ? dataUrl.slice(comma + 1) : '',
    timeSec,
    shotIndex,
  };
}

function pickKeyframeShots(shots: Shot[], maxKeyframes: number): Shot[] {
  if (shots.length <= maxKeyframes) return shots;
  return [...shots]
    .sort((a, b) => b.durationSec - a.durationSec)
    .slice(0, maxKeyframes)
    .sort((a, b) => a.startSec - b.startSec);
}

/**
 * Analyze a local `.mp4` / `.webm` file entirely in the browser.
 *
 * Sampling is sequential (seek → draw → read) so memory stays flat. The
 * default budget is ~1 frame per 0.5s, capped at 50 samples, which typically
 * finishes in 2–4 seconds for short clips.
 */
export async function analyzeVideoFile(
  file: File,
  options: AnalyzeVideoOptions = {},
): Promise<VideoAnalysisResult> {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    throw new Error('Video analysis needs a browser environment.');
  }
  if (!isSupportedVideo(file)) {
    throw new Error('Only MP4 and WebM videos are supported.');
  }
  const maxBytes = options.maxFileSizeBytes ?? MAX_VIDEO_BYTES;
  if (file.size > maxBytes) {
    throw new Error(`Video is too large (${(file.size / (1024 * 1024)).toFixed(1)} MB). Maximum is ${Math.round(maxBytes / (1024 * 1024))} MB.`);
  }

  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.crossOrigin = 'anonymous';
  video.src = url;

  try {
    await waitForEvent(video, 'loadedmetadata', 10000, 'Timed out while opening the video.');
    const durationSec = await resolveDuration(video);
    if (video.readyState < 2) {
      await waitForEvent(video, 'loadeddata', 10000, 'Timed out while decoding the first video frame.');
    }

    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) {
      throw new Error('The video has no readable resolution.');
    }

    const sampleInterval = Math.max(0.1, options.sampleIntervalSec ?? DEFAULT_SAMPLE_INTERVAL_SEC);
    const maxSamples = Math.max(2, options.maxSamples ?? DEFAULT_MAX_SAMPLES);
    const requestedSamples = Math.ceil(durationSec / sampleInterval) + 1;
    const sampleCount = Math.min(maxSamples, Math.max(2, requestedSamples));

    const analysisCanvas = document.createElement('canvas');
    const samples: Array<ShotSample & { pixels: Uint8ClampedArray }> = [];

    for (let i = 0; i < sampleCount; i += 1) {
      // Spread samples evenly and keep the last one away from the exact end.
      const timeSec = Math.min(durationSec - 0.01, (durationSec * i) / sampleCount);
      await seekTo(video, Math.max(0, timeSec));
      const context = drawToCanvas(video, analysisCanvas, ANALYSIS_MAX_WIDTH);
      const image = context.getImageData(0, 0, analysisCanvas.width, analysisCanvas.height);
      const pixels = image.data;
      const stats = computeFrameStats(pixels);
      samples.push({ timeSec, luma: stats.luma, histogram: stats.histogram, pixels });
      options.onProgress?.((i + 1) / sampleCount);
    }

    const shots = detectShotCuts(
      samples.map(({ timeSec, luma, histogram }) => ({ timeSec, luma, histogram })),
      { durationSec },
    );
    const palette = extractDominantPalette(
      samples.map((sample) => sample.pixels),
      DEFAULT_PALETTE_SIZE,
    );

    const maxKeyframes = Math.max(1, options.maxKeyframes ?? DEFAULT_MAX_KEYFRAMES);
    const keyShotList = pickKeyframeShots(shots, maxKeyframes);
    const keyframes: VideoKeyframe[] = [];
    const keyframeCanvas = document.createElement('canvas');

    for (let i = 0; i < keyShotList.length; i += 1) {
      const shot = keyShotList[i];
      const timeSec = Math.max(0, Math.min(durationSec - 0.01, (shot.startSec + shot.endSec) / 2));
      await seekTo(video, timeSec);
      drawToCanvas(video, keyframeCanvas, KEYFRAME_MAX_WIDTH);
      const dataUrl = keyframeCanvas.toDataURL('image/jpeg', KEYFRAME_JPEG_QUALITY);
      keyframes.push(makeKeyframe(file.name, i, timeSec, shot.index, dataUrl));
    }

    return {
      fileName: file.name || 'reference-video',
      fileSizeBytes: file.size,
      durationSec,
      width,
      height,
      sampledFrames: samples.length,
      shots,
      palette,
      keyframes,
      keyframeTimes: keyframes.map((frame) => Number(frame.timeSec.toFixed(2))),
    };
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}
