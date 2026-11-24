import type {
  Animation,
  DynamicText,
  Easing,
  HexColor,
  Layer,
  SpringConfig,
} from './types';

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

export function clamp(val: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, val));
}

export function parseHexColor(hex: string): RGBA {
  const clean = hex.trim().replace(/^#/, '');
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16);
    const g = parseInt(clean[1] + clean[1], 16);
    const b = parseInt(clean[2] + clean[2], 16);
    return { r, g, b, a: 1 };
  }
  if (clean.length === 6) {
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    return { r, g, b, a: 1 };
  }
  if (clean.length === 8) {
    const r = parseInt(clean.slice(0, 2), 16);
    const g = parseInt(clean.slice(2, 4), 16);
    const b = parseInt(clean.slice(4, 6), 16);
    const a = parseInt(clean.slice(6, 8), 16) / 255;
    return { r, g, b, a };
  }
  return { r: 255, g: 255, b: 255, a: 1 };
}

export function rgbaToHex({ r, g, b, a }: RGBA): HexColor {
  const toHex = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  const base = `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  if (a < 0.999) {
    return `${base}${toHex(a * 255)}`;
  }
  return base;
}

export function lerpHexColor(from: string, to: string, t: number): HexColor {
  const f = parseHexColor(from);
  const o = parseHexColor(to);
  const k = clamp(t, 0, 1);
  return rgbaToHex({
    r: f.r + (o.r - f.r) * k,
    g: f.g + (o.g - f.g) * k,
    b: f.b + (o.b - f.b) * k,
    a: f.a + (o.a - f.a) * k,
  });
}

/**
 * Exact damped harmonic oscillator physics matching rustren/src/animation.rs
 */
export function evalSpringPhysics(elapsedSec: number, cfg?: SpringConfig): number {
  const t = Math.max(0, elapsedSec);
  const k = Math.max(1e-3, cfg?.stiffness ?? 180);
  const c = Math.max(0, cfg?.damping ?? 18);
  const m = Math.max(1e-3, cfg?.mass ?? 1);
  const omega0 = Math.sqrt(k / m);
  const zeta = c / (2 * Math.sqrt(k * m));

  if (zeta < 1 - 1e-4) {
    const sqrtTerm = Math.sqrt(1 - zeta * zeta);
    const omegaD = omega0 * sqrtTerm;
    const exp = Math.exp(-zeta * omega0 * t);
    return 1 - exp * (Math.cos(omegaD * t) + (zeta / sqrtTerm) * Math.sin(omegaD * t));
  }
  if (Math.abs(zeta - 1) <= 1e-4) {
    const exp = Math.exp(-omega0 * t);
    return 1 - exp * (1 + omega0 * t);
  }
  const sqrtTerm = Math.sqrt(zeta * zeta - 1);
  const gamma = omega0 * sqrtTerm;
  const exp = Math.exp(-zeta * omega0 * t);
  return 1 - exp * (Math.cosh(gamma * t) + (zeta / sqrtTerm) * Math.sinh(gamma * t));
}

export function evalCubicBezier(t: number, p: [number, number, number, number]): number {
  const xTarget = clamp(t, 0, 1);
  const [x1, y1, x2, y2] = p;
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;

  const sampleX = (u: number) => ((ax * u + bx) * u + cx) * u;
  const sampleDx = (u: number) => (3 * ax * u + 2 * bx) * u + cx;
  const sampleY = (u: number) => ((ay * u + by) * u + cy) * u;

  let u = xTarget;
  for (let i = 0; i < 6; i++) {
    const err = sampleX(u) - xTarget;
    if (Math.abs(err) < 1e-5) break;
    const dx = sampleDx(u);
    if (Math.abs(dx) < 1e-6) break;
    u = clamp(u - err / dx, 0, 1);
  }
  return sampleY(u);
}

export function evalEasing(
  rawT: number,
  easing: Easing = 'linear',
  bezier?: [number, number, number, number],
  springCfg?: SpringConfig,
  durationSec = 1
): number {
  const t = clamp(rawT, 0, 1);
  switch (easing) {
    case 'linear':
      return t;
    case 'ease_in':
      return t * t * t;
    case 'ease_out':
      return 1 - Math.pow(1 - t, 3);
    case 'ease_in_out':
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    case 'ease_in_quad':
      return t * t;
    case 'ease_out_quad':
      return 1 - (1 - t) * (1 - t);
    case 'ease_in_out_quad':
      return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    case 'ease_in_expo':
      return t === 0 ? 0 : Math.pow(2, 10 * t - 10);
    case 'ease_out_expo':
      return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
    case 'ease_in_out_expo':
      if (t === 0 || t === 1) return t;
      return t < 0.5 ? Math.pow(2, 20 * t - 10) / 2 : (2 - Math.pow(2, -20 * t + 10)) / 2;
    case 'ease_in_back': {
      const c1 = 1.70158;
      const c3 = c1 + 1;
      return c3 * t * t * t - c1 * t * t;
    }
    case 'ease_out_back': {
      const c1 = 1.70158;
      const c3 = c1 + 1;
      return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
    }
    case 'ease_in_out_back': {
      const c1 = 1.70158;
      const c2 = c1 * 1.525;
      return t < 0.5
        ? (Math.pow(2 * t, 2) * ((c2 + 1) * 2 * t - c2)) / 2
        : (Math.pow(2 * t - 2, 2) * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2;
    }
    case 'ease_out_bounce': {
      const n1 = 7.5625;
      const d1 = 2.75;
      if (t < 1 / d1) return n1 * t * t;
      if (t < 2 / d1) {
        const u = t - 1.5 / d1;
        return n1 * u * u + 0.75;
      }
      if (t < 2.5 / d1) {
        const u = t - 2.25 / d1;
        return n1 * u * u + 0.9375;
      }
      const u = t - 2.625 / d1;
      return n1 * u * u + 0.984375;
    }
    case 'cubic_bezier':
      return evalCubicBezier(t, bezier ?? [0.25, 0.1, 0.25, 1]);
    case 'spring': {
      if (t <= 0) return 0;
      if (t >= 1) return 1;
      return evalSpringPhysics(t * Math.max(durationSec, 0.4), springCfg);
    }
    default:
      return t;
  }
}

/**
 * Safe recursive-descent math expression evaluator matching Rustren's evalexpr helpers.
 * Supports: + - * / ^ ( ), t, time, val, PI, sin, cos, abs, min, max, clamp, lerp, smoothstep, sqrt
 */
export function evalMathExpression(expr: string, timeSec: number, currentVal: number): number {
  let pos = 0;
  const src = expr.trim();

  function skipWs() {
    while (pos < src.length && /\s/.test(src[pos])) pos++;
  }

  function parseExpression(): number {
    let left = parseTerm();
    while (true) {
      skipWs();
      if (src[pos] === '+') {
        pos++;
        left += parseTerm();
      } else if (src[pos] === '-') {
        pos++;
        left -= parseTerm();
      } else {
        break;
      }
    }
    return left;
  }

  function parseTerm(): number {
    let left = parsePower();
    while (true) {
      skipWs();
      if (src[pos] === '*') {
        pos++;
        left *= parsePower();
      } else if (src[pos] === '/') {
        pos++;
        const denom = parsePower();
        left = denom === 0 ? 0 : left / denom;
      } else {
        break;
      }
    }
    return left;
  }

  function parsePower(): number {
    let base = parseUnary();
    skipWs();
    if (src[pos] === '^') {
      pos++;
      const exp = parsePower();
      base = Math.pow(base, exp);
    }
    return base;
  }

  function parseUnary(): number {
    skipWs();
    if (src[pos] === '-') {
      pos++;
      return -parseUnary();
    }
    if (src[pos] === '+') {
      pos++;
      return parseUnary();
    }
    return parsePrimary();
  }

  function parsePrimary(): number {
    skipWs();
    if (src[pos] === '(') {
      pos++;
      const v = parseExpression();
      skipWs();
      if (src[pos] === ')') pos++;
      return v;
    }

    // Number literal
    const numMatch = src.slice(pos).match(/^\d+(\.\d+)?/);
    if (numMatch) {
      pos += numMatch[0].length;
      return parseFloat(numMatch[0]);
    }

    // Identifier or function call
    const idMatch = src.slice(pos).match(/^[a-zA-Z_][a-zA-Z0-9_]*/);
    if (idMatch) {
      const name = idMatch[0];
      pos += name.length;
      skipWs();
      if (src[pos] === '(') {
        pos++;
        const args: number[] = [];
        skipWs();
        if (src[pos] !== ')') {
          args.push(parseExpression());
          while (true) {
            skipWs();
            if (src[pos] === ',') {
              pos++;
              args.push(parseExpression());
            } else {
              break;
            }
          }
        }
        skipWs();
        if (src[pos] === ')') pos++;
        return callBuiltin(name, args);
      }
      if (name === 't' || name === 'time') return timeSec;
      if (name === 'val') return currentVal;
      if (name === 'PI') return Math.PI;
      return 0;
    }

    return 0;
  }

  function callBuiltin(name: string, args: number[]): number {
    switch (name) {
      case 'sin':
        return Math.sin(args[0] ?? 0);
      case 'cos':
        return Math.cos(args[0] ?? 0);
      case 'abs':
        return Math.abs(args[0] ?? 0);
      case 'sqrt':
        return Math.sqrt(Math.max(0, args[0] ?? 0));
      case 'min':
        return Math.min(args[0] ?? 0, args[1] ?? 0);
      case 'max':
        return Math.max(args[0] ?? 0, args[1] ?? 0);
      case 'clamp':
        return clamp(args[0] ?? 0, args[1] ?? 0, args[2] ?? 1);
      case 'lerp': {
        const a = args[0] ?? 0;
        const b = args[1] ?? 0;
        const k = args[2] ?? 0;
        return a + (b - a) * k;
      }
      case 'smoothstep': {
        const e0 = args[0] ?? 0;
        const e1 = args[1] ?? 1;
        const x = args[2] ?? 0;
        const u = clamp((x - e0) / Math.max(1e-9, e1 - e0), 0, 1);
        return u * u * (3 - 2 * u);
      }
      default:
        return 0;
    }
  }

  const out = parseExpression();
  return Number.isFinite(out) ? out : currentVal;
}

export function evalDynamicText(dynamic: DynamicText, timeSec: number): string {
  if (dynamic.mode === 'typewriter') {
    const start = dynamic.start_sec ?? 0;
    const end = dynamic.end_sec ?? start + 1;
    const text = dynamic.text ?? '';
    if (timeSec <= start) return '';
    if (timeSec >= end) return text;
    const progress = clamp((timeSec - start) / Math.max(1e-6, end - start), 0, 1);
    const count = Math.floor(progress * text.length);
    const cursor = dynamic.cursor ?? '';
    return text.slice(0, count) + (count < text.length ? cursor : '');
  }
  if (dynamic.mode === 'counter') {
    const start = dynamic.start_sec ?? 0;
    const end = dynamic.end_sec ?? start + 1;
    const progress =
      timeSec <= start
        ? 0
        : timeSec >= end
          ? 1
          : evalEasing(
              (timeSec - start) / Math.max(1e-6, end - start),
              dynamic.easing ?? 'ease_out',
              undefined,
              undefined,
              end - start
            );
    const val = dynamic.from + (dynamic.to - dynamic.from) * progress;
    const decimals = dynamic.decimals ?? 0;
    const formatted = decimals > 0 ? val.toFixed(decimals) : Math.round(val).toLocaleString('en-US');
    return `${dynamic.prefix ?? ''}${formatted}${dynamic.suffix ?? ''}`;
  }
  if (dynamic.mode === 'timecode') {
    const t = Math.max(0, timeSec + (dynamic.offset_sec ?? 0));
    const hrs = Math.floor(t / 3600);
    const mins = Math.floor((t % 3600) / 60);
    const secs = Math.floor(t % 60);
    const cs = Math.floor((t - Math.floor(t)) * 100);
    const pad = (n: number) => String(n).padStart(2, '0');
    if (dynamic.format === 'hh:mm:ss') return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
    if (dynamic.format === 'mm:ss') return `${pad(mins)}:${pad(secs)}`;
    return `${pad(mins)}:${pad(secs)}.${pad(cs)}`;
  }
  return '';
}

function isColorProp(prop: string): boolean {
  return prop === 'color' || prop === 'background' || prop === 'border_color';
}

export function evaluateAnimation(
  anim: Animation,
  timeSec: number,
  currentValue: number | string
): number | string | undefined {
  if (anim.expression) {
    if (typeof currentValue === 'number') {
      return evalMathExpression(anim.expression, timeSec, currentValue);
    }
    return evalMathExpression(anim.expression, timeSec, 0);
  }

  if (anim.keyframes && anim.keyframes.length >= 2) {
    const kfs = [...anim.keyframes].sort((a, b) => a.time - b.time);
    if (timeSec <= kfs[0].time) return kfs[0].value;
    if (timeSec >= kfs[kfs.length - 1].time) return kfs[kfs.length - 1].value;
    for (let i = 0; i < kfs.length - 1; i++) {
      const a = kfs[i];
      const b = kfs[i + 1];
      if (timeSec >= a.time && timeSec <= b.time) {
        const dur = Math.max(1e-6, b.time - a.time);
        const raw = (timeSec - a.time) / dur;
        const eased = evalEasing(raw, b.easing ?? anim.easing ?? 'linear', b.bezier, anim.spring, dur);
        if (isColorProp(anim.property) && typeof a.value === 'string' && typeof b.value === 'string') {
          return lerpHexColor(a.value, b.value, eased);
        }
        return Number(a.value) + (Number(b.value) - Number(a.value)) * eased;
      }
    }
  }

  const start = anim.start_sec ?? 0;
  const end = anim.end_sec ?? start + 1;
  const dur = Math.max(1e-6, end - start);

  if (timeSec < start) {
    return undefined;
  }

  let rawT: number;
  if (timeSec >= end) {
    if (anim.repeat === 'infinite' || (typeof anim.repeat === 'number' && anim.repeat > 1)) {
      const elapsed = timeSec - start;
      const cycleIndex = Math.floor(elapsed / dur);
      const maxCycles = anim.repeat === 'infinite' ? Infinity : anim.repeat;
      if (cycleIndex >= maxCycles) {
        rawT = anim.yoyo && maxCycles % 2 === 0 ? 0 : 1;
      } else {
        const local = (elapsed % dur) / dur;
        rawT = anim.yoyo && cycleIndex % 2 === 1 ? 1 - local : local;
      }
    } else {
      rawT = 1;
    }
  } else {
    rawT = (timeSec - start) / dur;
  }

  const eased = evalEasing(rawT, anim.easing ?? 'linear', anim.bezier, anim.spring, dur);
  const fromVal = anim.from ?? currentValue;
  const toVal = anim.to ?? currentValue;

  if (isColorProp(anim.property) && typeof fromVal === 'string' && typeof toVal === 'string') {
    return lerpHexColor(fromVal, toVal, eased);
  }
  const f = Number(fromVal);
  const o = Number(toVal);
  if (Number.isNaN(f) || Number.isNaN(o)) return currentValue;
  return f + (o - f) * eased;
}

export interface ComputedLayerProps {
  visible: boolean;
  x: number;
  y: number;
  cx: number;
  cy: number;
  r: number;
  width: number;
  height: number;
  radius: number;
  opacity: number;
  scale: number;
  rotation: number;
  skew_x: number;
  skew_y: number;
  color: string;
  border_color: string;
  path_progress: number;
  stroke_dashoffset: number;
}

export function getLayerTimeRange(
  layer: Layer,
  canvasDuration: number
): { start: number; end: number } {
  const start = layer.start_sec ?? 0;
  const end =
    layer.end_sec !== undefined
      ? layer.end_sec
      : layer.duration_secs !== undefined
        ? start + layer.duration_secs
        : canvasDuration;
  return { start, end };
}

export function evaluateLayerAtTime(
  layer: Layer,
  timeSec: number,
  canvasDuration: number
): ComputedLayerProps {
  const { start, end } = getLayerTimeRange(layer, canvasDuration);
  const visible = !layer.hidden && timeSec >= start - 1e-5 && timeSec <= end + 1e-5;

  const state: ComputedLayerProps = {
    visible,
    x: 'x' in layer && typeof layer.x === 'number' ? layer.x : 0,
    y: 'y' in layer && typeof layer.y === 'number' ? layer.y : 0,
    cx: layer.type === 'circle' ? (layer.cx ?? 0) : 0,
    cy: layer.type === 'circle' ? (layer.cy ?? 0) : 0,
    r: layer.type === 'circle' ? layer.r : 0,
    width: 'width' in layer && typeof layer.width === 'number' ? layer.width : 0,
    height: 'height' in layer && typeof layer.height === 'number' ? layer.height : 0,
    radius: 'radius' in layer && typeof layer.radius === 'number' ? layer.radius : 0,
    opacity: layer.opacity ?? 1,
    scale: 'scale' in layer && typeof layer.scale === 'number' ? layer.scale : 1,
    rotation: 'rotation' in layer && typeof layer.rotation === 'number' ? layer.rotation : 0,
    skew_x: layer.skew_x ?? 0,
    skew_y: layer.skew_y ?? 0,
    color: 'color' in layer && typeof layer.color === 'string' ? layer.color : '#FFFFFF',
    border_color:
      'border_color' in layer && typeof layer.border_color === 'string'
        ? layer.border_color
        : '#FFFFFF',
    path_progress:
      'path_progress' in layer && typeof layer.path_progress === 'number'
        ? layer.path_progress
        : 1,
    stroke_dashoffset:
      'stroke_dashoffset' in layer && typeof layer.stroke_dashoffset === 'number'
        ? layer.stroke_dashoffset
        : 0,
  };

  if (!layer.animations || layer.animations.length === 0) {
    return state;
  }

  // Group animations by property to handle sequential animations properly
  // Also preserve "before first animation starts" initial value if an animation starts later
  for (const anim of layer.animations) {
    const key = anim.property as keyof ComputedLayerProps;
    if (!(key in state)) continue;
    const current = state[key] as number | string;
    const result = evaluateAnimation(anim, timeSec, current);
    if (result !== undefined) {
      (state as unknown as Record<string, number | string | boolean>)[key] = result;
    } else if (anim.from !== undefined && anim.start_sec !== undefined && timeSec < anim.start_sec) {
      // Check if this is the earliest animation for this property
      const earlierExists = layer.animations.some(
        (other) =>
          other !== anim &&
          other.property === anim.property &&
          (other.start_sec ?? 0) < (anim.start_sec ?? 0)
      );
      if (!earlierExists) {
        (state as unknown as Record<string, number | string | boolean>)[key] = anim.from;
      }
    }
  }

  state.opacity = clamp(state.opacity, 0, 1);
  return state;
}

export function formatTimecode(sec: number, fps = 30): string {
  const s = Math.max(0, sec);
  const mins = Math.floor(s / 60);
  const secs = Math.floor(s % 60);
  const frames = Math.floor((s - Math.floor(s)) * fps) % fps;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
}
