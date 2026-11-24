import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aspectRatioLabel,
  detectShotCuts,
  extractDominantPalette,
  formatVideoAnalysisForPrompt,
  histogramDistance,
  type ShotSample,
  type VideoForensics,
} from './videoAnalyzer';

function histogramWithBin(bin: number): number[] {
  const histogram = new Array<number>(16).fill(0);
  histogram[bin] = 1;
  return histogram;
}

function sample(timeSec: number, luma: number, histogram: number[]): ShotSample {
  return { timeSec, luma, histogram };
}

test('detectShotCuts finds a hard cut between two stable scenes', () => {
  const dark = histogramWithBin(1);
  const bright = histogramWithBin(14);
  const samples = [
    sample(0, 20, dark),
    sample(0.5, 21, dark),
    sample(1.0, 19, dark),
    sample(1.5, 220, bright),
    sample(2.0, 218, bright),
    sample(2.5, 221, bright),
  ];

  const shots = detectShotCuts(samples, { durationSec: 3 });

  assert.equal(shots.length, 2);
  assert.deepEqual(shots[0], {
    index: 0,
    startSec: 0,
    endSec: 1.25,
    durationSec: 1.25,
    motion: 'static',
    luma: 'dark',
  });
  assert.deepEqual(shots[1], {
    index: 1,
    startSec: 1.25,
    endSec: 3,
    durationSec: 1.75,
    motion: 'static',
    luma: 'bright',
  });
});

test('detectShotCuts ignores gradual changes below the cut threshold', () => {
  // Move 0.1 of the mass from bin 0 to bin 1 each step: distance = 0.1.
  const samples = Array.from({ length: 5 }, (_, i) => {
    const shift = i * 0.1;
    const histogram = new Array<number>(16).fill(0);
    histogram[0] = 0.5 - shift;
    histogram[1] = 0.5 + shift;
    return sample(i * 0.5, 120, histogram);
  });

  const shots = detectShotCuts(samples, { durationSec: 2 });

  assert.equal(shots.length, 1);
  assert.equal(shots[0].motion, 'moderate');
  assert.equal(shots[0].luma, 'mid');
  assert.equal(shots[0].durationSec, 2);
});

test('detectShotCuts classifies fast in-shot motion as dynamic when no hard cut occurs', () => {
  const samples = Array.from({ length: 5 }, (_, i) => {
    const shift = i * 0.25;
    const histogram = new Array<number>(16).fill(0);
    histogram[0] = 0.5 - shift;
    histogram[1] = 0.5 + shift;
    return sample(i * 0.5, 120, histogram);
  });

  const shots = detectShotCuts(samples, { durationSec: 2 });

  assert.equal(shots.length, 1);
  assert.equal(shots[0].motion, 'dynamic');
});

test('detectShotCuts enforces the minimum shot length', () => {
  const dark = histogramWithBin(1);
  const bright = histogramWithBin(14);
  // Cut after 0.3s is too short; the next stable run is accepted.
  const samples = [
    sample(0, 20, dark),
    sample(0.25, 220, bright),
    sample(0.5, 21, dark),
    sample(2.0, 20, dark),
    sample(2.5, 220, bright),
  ];

  const shots = detectShotCuts(samples, { durationSec: 3, minShotSec: 0.6 });

  assert.ok(shots.length >= 1);
  for (const shot of shots) {
    assert.ok(shot.durationSec >= 0.6 - 1e-9, `shot ${shot.index} is ${shot.durationSec}s`);
  }
});

test('histogramDistance returns 0 for identical histograms and 1 for disjoint ones', () => {
  assert.equal(histogramDistance(histogramWithBin(0), histogramWithBin(0)), 0);
  assert.equal(histogramDistance(histogramWithBin(0), histogramWithBin(15)), 1);
});

test('extractDominantPalette picks the most frequent opaque colours', () => {
  const pixels = new Uint8ClampedArray([
    ...new Array(8).fill([255, 0, 0, 255]).flat(),
    ...new Array(2).fill([0, 0, 255, 255]).flat(),
    ...new Array(6).fill([0, 255, 0, 0]).flat(), // fully transparent, must be ignored
  ]);

  const palette = extractDominantPalette([pixels], 5);

  assert.deepEqual(palette, ['#FF0000', '#0000FF']);
});

test('extractDominantPalette respects maxColors and merges across frames', () => {
  const colors = [
    [255, 0, 0],
    [0, 255, 0],
    [0, 0, 255],
    [255, 255, 0],
    [255, 0, 255],
  ];
  const frameA = new Uint8ClampedArray(colors.flatMap(([r, g, b]) => [r, g, b, 255]));
  const frameB = new Uint8ClampedArray(colors.flatMap(([r, g, b]) => [r, g, b, 255]));

  const palette = extractDominantPalette([frameA, frameB], 5);
  assert.equal(palette.length, 5);
  assert.deepEqual(new Set(palette), new Set(['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF']));

  assert.equal(extractDominantPalette([frameA], 2).length, 2);
  assert.deepEqual(extractDominantPalette([], 5), []);
});

test('aspectRatioLabel reduces common resolutions', () => {
  assert.equal(aspectRatioLabel(1080, 1920), '9:16');
  assert.equal(aspectRatioLabel(1280, 720), '16:9');
  assert.equal(aspectRatioLabel(1080, 1080), '1:1');
});

test('formatVideoAnalysisForPrompt embeds timeline, palette and keyframes', () => {
  const forensics: VideoForensics = {
    fileName: 'launch.mp4',
    durationSec: 6,
    width: 1080,
    height: 1920,
    sampledFrames: 13,
    palette: ['#0B0B0C', '#F97316', '#F8FAFC', '#111219', '#FACC15'],
    keyframeTimes: [1, 3, 5],
    shots: [
      { index: 0, startSec: 0, endSec: 2, durationSec: 2, motion: 'static', luma: 'dark' },
      { index: 1, startSec: 2, endSec: 4.5, durationSec: 2.5, motion: 'dynamic', luma: 'mid' },
      { index: 2, startSec: 4.5, endSec: 6, durationSec: 1.5, motion: 'moderate', luma: 'bright' },
    ],
  };

  const text = formatVideoAnalysisForPrompt(forensics);

  assert.ok(text.includes('REFERENCE VIDEO FORENSICS'));
  assert.ok(text.includes('launch.mp4'));
  assert.ok(text.includes('1080x1920 (9:16)'));
  assert.ok(text.includes('Shots detected: 3'));
  assert.ok(text.includes('#01  0.00s → 2.00s'));
  assert.ok(text.includes('luma=dark'));
  assert.ok(text.includes('luma=mid'));
  assert.ok(text.includes('luma=bright'));
  assert.ok(text.includes('motion=dynamic'));
  assert.ok(text.includes('motion=static'));
  assert.ok(text.includes('Attached keyframes: 3'));
  for (const color of forensics.palette) {
    assert.ok(text.includes(color), `missing palette colour ${color}`);
  }
  assert.ok(text.includes('Match the palette above exactly'));
});
