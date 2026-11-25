import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateLayerAtTime, normalizeFontWeight } from './animation';
import type { RectLayer } from './types';

test('normalizeFontWeight maps named and numeric weights', () => {
  assert.equal(normalizeFontWeight(undefined), '500');
  assert.equal(normalizeFontWeight('thin'), '100');
  assert.equal(normalizeFontWeight('normal'), '400');
  assert.equal(normalizeFontWeight('bold'), '700');
  assert.equal(normalizeFontWeight('black'), '900');
  assert.equal(normalizeFontWeight(800), '800');
  assert.equal(normalizeFontWeight(950 as never), '900');
});

test('evaluateLayerAtTime supports expr alias and scale_x / scale_y', () => {
  const layer: RectLayer = {
    type: 'rect',
    x: 100,
    y: 100,
    width: 200,
    height: 100,
    color: '#F97316',
    scale_x: 1.5,
    scale_y: 0.5,
    animations: [
      { property: 'x', expr: '100 + t * 50' },
      { property: 'scale_x', from: 1, to: 2, start_sec: 0, end_sec: 2, easing: 'linear' },
    ],
  };

  const at1 = evaluateLayerAtTime(layer, 1, 5);
  assert.equal(at1.visible, true);
  assert.equal(at1.x, 150);
  assert.equal(at1.scale_x, 1.5);
  assert.equal(at1.scale_y, 0.5);
});
