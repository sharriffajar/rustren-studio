import test from 'node:test';
import assert from 'node:assert/strict';
import { autoFixScene, contrastRatio, lintScene } from './lint';
import { compileRustrenHtml, serializeSceneToHtml } from './htmlCompiler';
import type { RustrenScene } from './types';

test('lintScene detects profile-aware font_size, end_sec overflow, missing max_width, and low contrast', () => {
  const portraitScene: RustrenScene = {
    canvas: { width: 1080, height: 1920, fps: 30, duration_secs: 5, background: '#111111' },
    layers: [
      {
        type: 'text',
        name: 'tiny_dark_text',
        x: 40,
        y: 40,
        content: 'Too small',
        font_size: 18,
        color: '#222222',
        end_sec: 9.0,
      },
      {
        type: 'container',
        name: 'card',
        x: 40,
        y: 200,
        width: 800,
        height: 400,
        children: [
          {
            type: 'text',
            name: 'unbounded',
            content: 'Missing max_width inside container',
            font_size: 32,
            color: '#FFFFFF',
          },
        ],
      },
    ],
  };

  const warnings = lintScene(portraitScene);
  const codes = new Set(warnings.map((w) => w.code));
  assert.ok(codes.has('font_size'));
  assert.ok(codes.has('end_sec'));
  assert.ok(codes.has('missing_max_width'));
  assert.ok(codes.has('low_contrast'));

  const fixed = autoFixScene(portraitScene);
  const afterCodes = new Set(lintScene(fixed).map((w) => w.code));
  assert.equal(afterCodes.has('font_size'), false);
  assert.equal(afterCodes.has('end_sec'), false);
  assert.equal(afterCodes.has('missing_max_width'), false);
});

test('contrastRatio computes expected WCAG ratio for black vs white', () => {
  const ratio = contrastRatio('#FFFFFF', '#000000');
  assert.ok(Math.abs(ratio - 21) < 0.1);
});

test('HTML scene compiler and serializer roundtrip core layers and animations', () => {
  const html = `
    <scene schema-version="1.1">
      <canvas width="1280" height="720" fps="30" duration="4" background="#09090D" />
      <rect name="hero_card" x="200" y="180" width="600" height="240" radius="16" color="#18181F">
        <animate property="opacity" from="0" to="1" start="0" end="0.8" easing="ease_out" />
      </rect>
      <text name="headline" x="240" y="260" font-size="48" font-weight="bold" color="#FFFFFF">
        Hello Rustren
      </text>
    </scene>
  `;

  const scene = compileRustrenHtml(html);
  assert.equal(scene.canvas.width, 1280);
  assert.equal(scene.canvas.duration_secs, 4);
  assert.equal(scene.layers.length, 2);
  assert.equal(scene.layers[0].type, 'rect');
  assert.equal(scene.layers[0].animations?.length, 1);
  assert.equal(scene.layers[1].type, 'text');

  const reserialized = serializeSceneToHtml(scene);
  assert.ok(reserialized.includes('Hello Rustren'));
  assert.ok(reserialized.includes('property="opacity"'));
});
