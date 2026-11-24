import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evalCubicBezier,
  evalDynamicText,
  evalEasing,
  evalMathExpression,
  evalSpringPhysics,
  evaluateLayerAtTime,
  formatTimecode,
  lerpHexColor,
} from './animation';
import type { RectLayer } from './types';

test('Penner easings satisfy boundary conditions [0..1]', () => {
  const easings = [
    'linear',
    'ease_in',
    'ease_out',
    'ease_in_out',
    'ease_in_quad',
    'ease_out_quad',
    'ease_in_expo',
    'ease_out_expo',
    'ease_out_bounce',
  ] as const;

  for (const e of easings) {
    assert.ok(Math.abs(evalEasing(0, e)) < 1e-4, `${e} at 0`);
    assert.ok(Math.abs(evalEasing(1, e) - 1) < 1e-4, `${e} at 1`);
  }
});

test('spring physics starts at 0 and converges toward 1', () => {
  assert.equal(evalSpringPhysics(0), 0);
  const settled = evalSpringPhysics(2.0, { stiffness: 180, damping: 18, mass: 1 });
  assert.ok(Math.abs(settled - 1) < 0.02, `expected spring to settle near 1, got ${settled}`);
});

test('cubic bezier evaluates smooth midpoint', () => {
  const mid = evalCubicBezier(0.5, [0.42, 0, 0.58, 1]);
  assert.ok(Math.abs(mid - 0.5) < 0.05);
});

test('hex color interpolation blends accurately', () => {
  assert.equal(lerpHexColor('#000000', '#FFFFFF', 0), '#000000');
  assert.equal(lerpHexColor('#000000', '#FFFFFF', 1), '#ffffff');
  assert.equal(lerpHexColor('#000000', '#FFFFFF', 0.5), '#808080');
});

test('math expression parser evaluates variables and built-in functions safely', () => {
  assert.equal(evalMathExpression('10 + 20 * 2', 0, 0), 50);
  assert.equal(evalMathExpression('clamp(t * 10, 0, 5)', 2, 0), 5);
  assert.equal(evalMathExpression('lerp(100, 200, 0.25)', 0, 0), 125);
  assert.ok(Math.abs(evalMathExpression('sin(PI / 2)', 0, 0) - 1) < 1e-6);
  assert.equal(evalMathExpression('smoothstep(0, 1, 0.5)', 0, 0), 0.5);
});

test('dynamic text evaluates typewriter, counter, and timecode modes', () => {
  assert.equal(
    evalDynamicText({ mode: 'typewriter', text: 'rustren', start_sec: 0, end_sec: 1 }, 0.5),
    'rus'
  );
  assert.equal(
    evalDynamicText({ mode: 'typewriter', text: 'rustren', start_sec: 0, end_sec: 1 }, 1.2),
    'rustren'
  );
  assert.equal(
    evalDynamicText(
      { mode: 'counter', from: 0, to: 100, suffix: '%', start_sec: 0, end_sec: 2, easing: 'linear' },
      1.0
    ),
    '50%'
  );
  assert.equal(evalDynamicText({ mode: 'timecode', format: 'mm:ss.cc' }, 65.25), '01:05.25');
});

test('evaluateLayerAtTime handles visibility window, animations, and yoyo repeat', () => {
  const rect: RectLayer = {
    type: 'rect',
    x: 100,
    y: 200,
    width: 300,
    height: 100,
    color: '#F97316',
    start_sec: 1.0,
    end_sec: 4.0,
    animations: [
      { property: 'x', from: 0, to: 100, start_sec: 1.0, end_sec: 2.0, easing: 'linear' },
      { property: 'opacity', from: 0, to: 1, start_sec: 1.0, end_sec: 2.0, easing: 'linear', repeat: 2, yoyo: true },
    ],
  };

  assert.equal(evaluateLayerAtTime(rect, 0.5, 5).visible, false);
  const mid = evaluateLayerAtTime(rect, 1.5, 5);
  assert.equal(mid.visible, true);
  assert.equal(mid.x, 50);
  assert.ok(Math.abs(mid.opacity - 0.5) < 1e-4);

  const yoyoMid = evaluateLayerAtTime(rect, 2.5, 5);
  assert.ok(Math.abs(yoyoMid.opacity - 0.5) < 1e-4);
  assert.equal(formatTimecode(2.5, 30), '00:02:15');
});
