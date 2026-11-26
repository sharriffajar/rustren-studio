import { serializeSceneToHtml } from './htmlCompiler';
import { renderContactSheetCanvas, renderRustrenFrame } from './renderer';
import type { RustrenScene } from './types';

export interface ExportProgress {
  phase: 'rendering' | 'encoding' | 'saving' | 'done';
  currentFrame: number;
  totalFrames: number;
  percent: number;
  message: string;
}

/**
 * Saves any Blob directly to user's local storage.
 * Prefers File System Access API (`showSaveFilePicker`) when available outside restricted iframes,
 * and gracefully falls back to a direct `<a download>` anchor trigger.
 */
export async function saveBlobToStorage(
  blob: Blob,
  suggestedName: string,
  mimeType: string,
  extension: string
): Promise<'picker' | 'download'> {
  const win = window as unknown as {
    showSaveFilePicker?: (opts: {
      suggestedName: string;
      types: Array<{ description: string; accept: Record<string, string[]> }>;
    }) => Promise<{
      createWritable: () => Promise<{
        write: (data: Blob) => Promise<void>;
        close: () => Promise<void>;
      }>;
    }>;
  };

  // Only invoke showSaveFilePicker when running in a top-level context (iframes block it with SecurityError)
  if (typeof win.showSaveFilePicker === 'function' && window.self === window.top) {
    try {
      const handle = await win.showSaveFilePicker({
        suggestedName,
        types: [
          {
            description: `${extension.toUpperCase()} File`,
            accept: { [mimeType]: [`.${extension}`] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return 'picker';
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') {
        throw err;
      }
      // Fall through to anchor download
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 1500);
  return 'download';
}

export async function exportPngSnapshot(
  scene: RustrenScene,
  timeSec: number,
  filePrefix = 'rustren_frame'
): Promise<{ filename: string; method: 'picker' | 'download' }> {
  const canvas = document.createElement('canvas');
  canvas.width = scene.canvas.width;
  canvas.height = scene.canvas.height;
  const ctx = canvas.getContext('2d')!;
  renderRustrenFrame(ctx, scene, timeSec);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Failed to encode PNG snapshot'))), 'image/png');
  });

  const filename = `${filePrefix}_${timeSec.toFixed(2)}s.png`;
  const method = await saveBlobToStorage(blob, filename, 'image/png', 'png');
  return { filename, method };
}

export async function exportContactSheetPng(
  scene: RustrenScene,
  cols = 3,
  rows = 2
): Promise<{ filename: string; method: 'picker' | 'download' }> {
  const sheet = renderContactSheetCanvas(scene, cols, rows);
  const blob = await new Promise<Blob>((resolve, reject) => {
    sheet.toBlob((b) => (b ? resolve(b) : reject(new Error('Failed to encode contact sheet'))), 'image/png');
  });
  const filename = `rustren_contact_sheet_${cols}x${rows}.png`;
  const method = await saveBlobToStorage(blob, filename, 'image/png', 'png');
  return { filename, method };
}

export async function exportSceneJsonFile(scene: RustrenScene, name = 'rustren_scene'): Promise<void> {
  const json = JSON.stringify(scene, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  await saveBlobToStorage(blob, `${name}.json`, 'application/json', 'json');
}

export async function exportSceneHtmlFile(scene: RustrenScene, name = 'rustren_scene'): Promise<void> {
  const html = serializeSceneToHtml(scene);
  const blob = new Blob([html], { type: 'text/html' });
  await saveBlobToStorage(blob, `${name}.html`, 'text/html', 'html');
}

/**
 * Render deterministic H.264 MP4 via Rustren HTTP Render API (e.g. https://nvm.web.id/rustren/api).
 */
export async function exportMp4ViaRustrenApi(
  scene: RustrenScene,
  options: {
    apiUrl: string;
    apiKey: string;
    scale?: number;
    filename?: string;
  },
  onProgress?: (p: ExportProgress) => void,
  signal?: AbortSignal
): Promise<{ filename: string; sizeBytes: number; method: 'picker' | 'download'; renderSecs?: number }> {
  const baseUrl = (options.apiUrl || 'https://nvm.web.id/rustren/api').trim().replace(/\/+$/, '');
  const apiKey = options.apiKey.trim();

  const scale = options.scale ?? 1;
  const visibleLayers = (scene.layers || []).filter((l) => !l.hidden);
  const payloadScene: RustrenScene =
    scale === 1
      ? { ...scene, layers: visibleLayers }
      : {
          ...scene,
          layers: visibleLayers,
          canvas: {
            ...scene.canvas,
            width: Math.max(64, Math.round((scene.canvas.width * scale) / 2) * 2),
            height: Math.max(64, Math.round((scene.canvas.height * scale) / 2) * 2),
          },
        };

  onProgress?.({
    phase: 'rendering',
    currentFrame: 0,
    totalFrames: 100,
    percent: 10,
    message: 'Submitting scene to Rustren Render API...',
  });

  const submitRes = await fetch(`${baseUrl}/jobs`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payloadScene),
    signal,
  });

  const submitBody = await submitRes.json().catch(() => ({ error: submitRes.statusText }));
  if (!submitRes.ok) {
    throw new Error(submitBody.error || `Failed to submit job to Rustren API (${submitRes.status})`);
  }

  const jobId = submitBody.job_id as string;
  if (!jobId) {
    throw new Error('Server did not return a job_id.');
  }

  let pollCount = 0;
  let renderSecs: number | undefined;
  while (true) {
    if (signal?.aborted) {
      throw new DOMException('Export cancelled', 'AbortError');
    }
    await new Promise((r) => setTimeout(r, 1200));
    pollCount += 1;

    const statusRes = await fetch(`${baseUrl}/jobs/${encodeURIComponent(jobId)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal,
    });
    const info = await statusRes.json().catch(() => ({ error: statusRes.statusText }));
    if (!statusRes.ok) {
      throw new Error(info.error || `Failed to check job status (${statusRes.status})`);
    }

    if (info.status === 'completed') {
      renderSecs = typeof info.render_secs === 'number' ? info.render_secs : undefined;
      break;
    }
    if (info.status === 'failed') {
      throw new Error(info.error || 'MP4 render failed on Rustren server.');
    }

    const pct = Math.min(88, 15 + pollCount * 7);
    onProgress?.({
      phase: 'encoding',
      currentFrame: pct,
      totalFrames: 100,
      percent: pct,
      message:
        info.status === 'processing'
          ? 'Rendering & encoding H.264 on Rustren server...'
          : 'Waiting for worker slot in Rustren queue...',
    });
  }

  onProgress?.({
    phase: 'saving',
    currentFrame: 92,
    totalFrames: 100,
    percent: 92,
    message: 'Downloading rendered MP4...',
  });

  const videoRes = await fetch(`${baseUrl}/jobs/${encodeURIComponent(jobId)}/video`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  });
  if (!videoRes.ok) {
    const errBody = await videoRes.json().catch(() => ({ error: videoRes.statusText }));
    throw new Error(errBody.error || `Failed to download MP4 (${videoRes.status})`);
  }

  const blob = await videoRes.blob();
  const filename = options.filename?.endsWith('.mp4')
    ? options.filename
    : `${options.filename || 'rustren_video'}.mp4`;
  const method = await saveBlobToStorage(blob, filename, 'video/mp4', 'mp4');

  onProgress?.({
    phase: 'done',
    currentFrame: 100,
    totalFrames: 100,
    percent: 100,
    message: 'MP4 downloaded!',
  });

  return { filename, sizeBytes: blob.size, method, renderSecs };
}

/**
 * Deterministic frame-by-frame MP4 export via local Express + FFmpeg H.264 encoder (`/api/export/mp4`).
 * Mirrors Rustren's zero-disk FFmpeg pipe architecture.
 */
export async function exportMp4ViaServer(
  scene: RustrenScene,
  options: {
    crf?: number;
    preset?: 'ultrafast' | 'veryfast' | 'fast' | 'medium';
    scale?: number;
    filename?: string;
  },
  onProgress?: (p: ExportProgress) => void,
  signal?: AbortSignal
): Promise<{ filename: string; sizeBytes: number; method: 'picker' | 'download' }> {
  const scale = options.scale ?? 1;
  const width = Math.max(64, Math.round((scene.canvas.width * scale) / 2) * 2);
  const height = Math.max(64, Math.round((scene.canvas.height * scale) / 2) * 2);
  const fps = Math.max(1, Math.min(60, Math.round(scene.canvas.fps || 30)));
  const totalFrames = Math.max(1, Math.round(scene.canvas.duration_secs * fps));

  // 1. Start FFmpeg export session on local server
  const startRes = await fetch('/api/export/mp4/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      width,
      height,
      fps,
      crf: options.crf ?? 20,
      preset: options.preset ?? 'fast',
    }),
    signal,
  });

  if (!startRes.ok) {
    const errBody = await startRes.json().catch(() => ({ error: startRes.statusText }));
    throw new Error(errBody.error || 'Failed to start FFmpeg MP4 export session');
  }
  const { jobId } = (await startRes.json()) as { jobId: string };

  const canvas = document.createElement('canvas');
  canvas.width = scene.canvas.width;
  canvas.height = scene.canvas.height;
  const ctx = canvas.getContext('2d')!;

  const scaledCanvas = document.createElement('canvas');
  scaledCanvas.width = width;
  scaledCanvas.height = height;
  const sctx = scaledCanvas.getContext('2d')!;

  // Batch frames in chunks of 10 JPEG/PNG frames to keep IPC fast and memory bounded
  const batchSize = 10;
  let batch: string[] = [];

  const flushBatch = async () => {
    if (batch.length === 0) return;
    const res = await fetch(`/api/export/mp4/${jobId}/frames`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ frames: batch }),
      signal,
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({ error: 'Failed to stream frames' }));
      throw new Error(errBody.error || 'Frame upload failed');
    }
    batch = [];
  };

  for (let i = 0; i < totalFrames; i++) {
    if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError');
    const t = i / fps;
    renderRustrenFrame(ctx, scene, t);

    if (scale !== 1) {
      sctx.drawImage(canvas, 0, 0, width, height);
    }
    const target = scale === 1 ? canvas : scaledCanvas;
    // High quality JPEG keeps payload tiny while visually lossless at 0.95
    const dataUrl = target.toDataURL('image/jpeg', 0.94);
    const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
    batch.push(base64);

    if (batch.length >= batchSize || i === totalFrames - 1) {
      await flushBatch();
    }

    onProgress?.({
      phase: 'rendering',
      currentFrame: i + 1,
      totalFrames,
      percent: Math.round(((i + 1) / totalFrames) * 85),
      message: `Merender frame ${i + 1} / ${totalFrames} (${width}×${height} @ ${fps}fps)`,
    });

    // Yield to browser paint loop every few frames so progress bar stays buttery smooth
    if (i % 4 === 0) {
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  onProgress?.({
    phase: 'encoding',
    currentFrame: totalFrames,
    totalFrames,
    percent: 92,
    message: 'Finalisasi encoding H.264 MP4 via FFmpeg...',
  });

  const finishRes = await fetch(`/api/export/mp4/${jobId}/finish`, {
    method: 'POST',
    signal,
  });

  if (!finishRes.ok) {
    const errBody = await finishRes.json().catch(() => ({ error: 'FFmpeg finalization failed' }));
    throw new Error(errBody.error || 'FFmpeg finalization failed');
  }

  const mp4Blob = await finishRes.blob();
  const filename = options.filename || `rustren_export_${width}x${height}.mp4`;

  onProgress?.({
    phase: 'saving',
    currentFrame: totalFrames,
    totalFrames,
    percent: 98,
    message: 'Saving MP4 file locally...',
  });

  const method = await saveBlobToStorage(mp4Blob, filename, 'video/mp4', 'mp4');

  onProgress?.({
    phase: 'done',
    currentFrame: totalFrames,
    totalFrames,
    percent: 100,
    message: `Saved: ${filename}`,
  });

  return { filename, sizeBytes: mp4Blob.size, method };
}

/**
 * 100% browser-local WebM video exporter using Canvas captureStream + MediaRecorder.
 * Works completely offline without server FFmpeg.
 */
export async function exportWebmLocally(
  scene: RustrenScene,
  onProgress?: (p: ExportProgress) => void,
  signal?: AbortSignal,
  customFilename?: string
): Promise<{ filename: string; sizeBytes: number; method: 'picker' | 'download' }> {
  if (typeof MediaRecorder === 'undefined') {
    throw new Error('Browser does not support MediaRecorder API for local WebM export.');
  }

  const fps = Math.max(1, Math.min(60, Math.round(scene.canvas.fps || 30)));
  const totalFrames = Math.max(1, Math.round(scene.canvas.duration_secs * fps));

  const canvas = document.createElement('canvas');
  canvas.width = scene.canvas.width;
  canvas.height = scene.canvas.height;
  const ctx = canvas.getContext('2d')!;

  const mimeCandidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  const mimeType = mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) || 'video/webm';

  const stream = canvas.captureStream(fps);
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 6_000_000,
  });

  const chunks: BlobPart[] = [];
  recorder.ondataavailable = (ev) => {
    if (ev.data && ev.data.size > 0) chunks.push(ev.data);
  };

  const stopped = new Promise<Blob>((resolve, reject) => {
    recorder.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
    recorder.onerror = () => reject(new Error('MediaRecorder encoding error'));
  });

  recorder.start(200);
  const frameDelayMs = 1000 / fps;

  for (let i = 0; i < totalFrames; i++) {
    if (signal?.aborted) {
      recorder.stop();
      throw new DOMException('Export cancelled', 'AbortError');
    }
    const t = i / fps;
    renderRustrenFrame(ctx, scene, t);

    onProgress?.({
      phase: 'rendering',
      currentFrame: i + 1,
      totalFrames,
      percent: Math.round(((i + 1) / totalFrames) * 92),
      message: `Recording local WebM: frame ${i + 1} / ${totalFrames}`,
    });

    await new Promise((r) => setTimeout(r, frameDelayMs));
  }

  recorder.stop();
  const webmBlob = await stopped;
  const filename = customFilename
    ? (customFilename.endsWith('.webm') ? customFilename : `${customFilename}.webm`)
    : `rustren_local_${scene.canvas.width}x${scene.canvas.height}.webm`;
  const method = await saveBlobToStorage(webmBlob, filename, 'video/webm', 'webm');

  onProgress?.({
    phase: 'done',
    currentFrame: totalFrames,
    totalFrames,
    percent: 100,
    message: `Saved: ${filename}`,
  });

  return { filename, sizeBytes: webmBlob.size, method };
}
