import test from 'node:test';
import assert from 'node:assert/strict';
import { lintScene } from './lint';
import { SCENE_PRESETS } from './presets';

test('every scene preset uses schema v1.1 and passes lintScene with zero warnings', () => {
  assert.ok(SCENE_PRESETS.length >= 8, 'expected at least 8 curated presets');

  const seen = new Set<string>();
  for (const preset of SCENE_PRESETS) {
    assert.equal(seen.has(preset.id), false, `duplicate preset id: ${preset.id}`);
    seen.add(preset.id);

    assert.equal(preset.scene.schema_version, '1.1', `${preset.id} must declare schema_version 1.1`);

    const warnings = lintScene(preset.scene);
    assert.deepEqual(
      warnings,
      [],
      `${preset.id} has lint warnings: ${warnings.map((w) => `[${w.code}] ${w.message}`).join('; ')}`,
    );
  }
});

test('curated style blueprints are present', () => {
  const ids = SCENE_PRESETS.map((p) => p.id);
  for (const id of [
    'monochrome-liquid-lyric',
    '35mm-editorial',
    'swiss-bauhaus-poster',
    'saas-product-launch',
    'kinetic-data-card',
  ]) {
    assert.ok(ids.includes(id), `missing style blueprint: ${id}`);
  }
});
