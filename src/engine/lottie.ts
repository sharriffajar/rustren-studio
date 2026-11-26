/**
 * Lightweight zero-dependency Canvas2D Lottie (Bodymovin JSON) renderer
 * Mirrors rustren/src/renderer/lottie.rs for 100% Studio <-> Engine parity.
 */

const lottieCache = new Map<string, Record<string, unknown> | 'loading' | 'error'>();

export function getCachedLottie(
  src: string,
  onLoad?: () => void
): Record<string, unknown> | null {
  if (!src) return null;
  const trimmed = src.trim();
  if (trimmed.startsWith('{')) {
    const cached = lottieCache.get(trimmed);
    if (cached && typeof cached === 'object') return cached;
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      lottieCache.set(trimmed, parsed);
      return parsed;
    } catch {
      lottieCache.set(trimmed, 'error');
      return null;
    }
  }
  const cached = lottieCache.get(src);
  if (cached && typeof cached === 'object') return cached;
  if (cached === 'loading' || cached === 'error') return null;

  lottieCache.set(src, 'loading');
  fetch(src)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
    .then((doc) => {
      lottieCache.set(src, doc as Record<string, unknown>);
      onLoad?.();
    })
    .catch(() => {
      lottieCache.set(src, 'error');
    });
  return null;
}

function toFloats(v: unknown, def: number[]): number[] {
  if (typeof v === 'number') return [v];
  if (Array.isArray(v)) {
    const nums = v.filter((x): x is number => typeof x === 'number');
    if (nums.length > 0) return nums;
  }
  return def;
}

function cubic(u: number, p1: number, p2: number): number {
  const inv = 1 - u;
  return 3 * inv * inv * u * p1 + 3 * inv * u * u * p2 + u * u * u;
}

function firstNum(v: unknown, def: number): number {
  if (typeof v === 'number') return v;
  if (Array.isArray(v) && typeof v[0] === 'number') return v[0];
  return def;
}

function evalVecN(prop: Record<string, unknown> | undefined, frame: number, def: number[]): number[] {
  if (!prop || prop.k === undefined) return def;
  const kArr = Array.isArray(prop.k) ? (prop.k as Array<Record<string, unknown>>) : null;
  const animated =
    prop.a === 1 ||
    (kArr !== null && kArr.length > 0 && typeof kArr[0] === 'object' && kArr[0] !== null && 't' in kArr[0]);
  if (!animated || !kArr || kArr.length === 0) return toFloats(prop.k, def);
  const kfs = kArr;
  const t0 = typeof kfs[0].t === 'number' ? kfs[0].t : 0;
  if (frame <= t0) return toFloats(kfs[0].s, def);

  for (let i = 0; i < kfs.length; i++) {
    const cur = kfs[i];
    const tCur = typeof cur.t === 'number' ? cur.t : 0;
    if (i + 1 >= kfs.length) {
      const termVal = cur.s !== undefined ? cur.s : (i > 0 ? kfs[i - 1].e : undefined);
      return toFloats(termVal, def);
    }
    const next = kfs[i + 1];
    const tNext = typeof next.t === 'number' ? next.t : tCur;
    if (frame >= tCur && frame < tNext) {
      const sVals = toFloats(cur.s, def);
      if (cur.h === 1 || tNext <= tCur) return sVals;
      const eVals = toFloats(cur.e ?? next.s, sVals);
      const rawT = Math.max(0, Math.min(1, (frame - tCur) / (tNext - tCur)));
      const o = cur.o as Record<string, unknown> | undefined;
      const inp = cur.i as Record<string, unknown> | undefined;
      const ox = firstNum(o?.x, 0);
      const oy = firstNum(o?.y, 0);
      const ix = firstNum(inp?.x, 1);
      const iy = firstNum(inp?.y, 1);
      let eased = rawT;
      if (Math.abs(ox - oy) > 1e-4 || Math.abs(ix - iy) > 1e-4) {
        let lo = 0, hi = 1, u = rawT;
        for (let k = 0; k < 8; k++) {
          const x = cubic(u, ox, ix);
          if (Math.abs(x - rawT) < 1e-4) break;
          if (x < rawT) lo = u; else hi = u;
          u = 0.5 * (lo + hi);
        }
        eased = cubic(u, oy, iy);
      }
      const len = Math.max(sVals.length, eVals.length);
      return Array.from({ length: len }, (_, idx) => {
        const a = sVals[idx] ?? 0;
        const b = eVals[idx] ?? a;
        return a + (b - a) * eased;
      });
    }
  }
  return def;
}

function evalScalar(prop: unknown, frame: number, def: number): number {
  return evalVecN(prop as Record<string, unknown> | undefined, frame, [def])[0];
}

function evalVec2(prop: unknown, frame: number, def: [number, number]): [number, number] {
  const obj = prop as Record<string, unknown> | undefined;
  if (obj && obj.s === true) {
    return [evalScalar(obj.x, frame, def[0]), evalScalar(obj.y, frame, def[1])];
  }
  const v = evalVecN(obj, frame, def);
  return [v[0], v[1] ?? def[1]];
}

function evalRgba(prop: unknown, frame: number, alphaMult: number): string {
  const v = evalVecN(prop as Record<string, unknown> | undefined, frame, [1, 1, 1, 1]);
  let [r, g, b] = v;
  const a = (v[3] ?? 1) * alphaMult;
  if (r <= 1 && g <= 1 && b <= 1) {
    r *= 255; g *= 255; b *= 255;
  }
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${Math.max(0, Math.min(1, a))})`;
}

function applyKs(ctx: CanvasRenderingContext2D, ks: Record<string, unknown> | undefined, frame: number): number {
  if (!ks) return 1;
  const a = evalVec2(ks.a, frame, [0, 0]);
  const p = evalVec2(ks.p, frame, [0, 0]);
  const s = evalVec2(ks.s, frame, [100, 100]);
  const r = evalScalar(ks.r, frame, 0);
  const o = evalScalar(ks.o, frame, 100) / 100;
  ctx.translate(p[0], p[1]);
  if (r) ctx.rotate((r * Math.PI) / 180);
  if (s[0] !== 100 || s[1] !== 100) ctx.scale(s[0] / 100, s[1] / 100);
  if (a[0] || a[1]) ctx.translate(-a[0], -a[1]);
  return Math.max(0, Math.min(1, o));
}

function renderShapes(
  ctx: CanvasRenderingContext2D,
  items: Array<Record<string, unknown>>,
  frame: number,
  parentOp: number
): void {
  ctx.save();
  let groupOp = parentOp;
  for (const it of items) {
    if (it.ty === 'tr') {
      groupOp *= applyKs(ctx, it, frame);
    }
  }
  const paths: Path2D[] = [];
  for (const it of items) {
    if (it.hd) continue;
    const ty = it.ty;
    if (ty === 'gr' && Array.isArray(it.it)) {
      renderShapes(ctx, it.it as Array<Record<string, unknown>>, frame, groupOp);
    } else if (ty === 'el') {
      const p = evalVec2(it.p, frame, [0, 0]);
      const s = evalVec2(it.s, frame, [100, 100]);
      const path = new Path2D();
      path.ellipse(p[0], p[1], Math.abs(s[0]) / 2, Math.abs(s[1]) / 2, 0, 0, Math.PI * 2);
      paths.push(path);
    } else if (ty === 'rc') {
      const p = evalVec2(it.p, frame, [0, 0]);
      const s = evalVec2(it.s, frame, [100, 100]);
      const r = Math.max(0, evalScalar(it.r, frame, 0));
      const w = Math.abs(s[0]), h = Math.abs(s[1]);
      const path = new Path2D();
      path.roundRect(p[0] - w / 2, p[1] - h / 2, w, h, Math.min(r, w / 2, h / 2));
      paths.push(path);
    } else if (ty === 'sh') {
      const ks = it.ks as Record<string, unknown> | undefined;
      const kfsArr = Array.isArray(ks?.k) ? (ks.k as Array<Record<string, unknown>>) : [];
      const shape = ks?.a === 1
        ? ([...kfsArr].reverse().find((kf) => frame >= (Number(kf.t) || 0))?.s as Array<Record<string, unknown>>)?.[0]
        : (ks?.k as Record<string, unknown> | undefined);
      const v = shape?.v as number[][] | undefined;
      const inp = shape?.i as number[][] | undefined;
      const out = shape?.o as number[][] | undefined;
      if (v && inp && out && v.length > 0) {
        const path = new Path2D();
        path.moveTo(v[0][0], v[0][1]);
        const segs = shape?.c ? v.length : v.length - 1;
        for (let idx = 0; idx < segs; idx++) {
          const next = (idx + 1) % v.length;
          path.bezierCurveTo(
            v[idx][0] + out[idx][0],
            v[idx][1] + out[idx][1],
            v[next][0] + inp[next][0],
            v[next][1] + inp[next][1],
            v[next][0],
            v[next][1]
          );
        }
        if (shape?.c) path.closePath();
        paths.push(path);
      }
    } else if (ty === 'fl') {
      const o = evalScalar(it.o, frame, 100) / 100;
      ctx.fillStyle = evalRgba(it.c, frame, o * groupOp);
      for (const path of paths) ctx.fill(path, it.r === 2 ? 'evenodd' : 'nonzero');
    } else if (ty === 'st') {
      const o = evalScalar(it.o, frame, 100) / 100;
      ctx.strokeStyle = evalRgba(it.c, frame, o * groupOp);
      ctx.lineWidth = evalScalar(it.w, frame, 2);
      ctx.lineCap = it.lc === 2 ? 'round' : it.lc === 3 ? 'square' : 'butt';
      ctx.lineJoin = it.lj === 2 ? 'round' : it.lj === 3 ? 'bevel' : 'miter';
      for (const path of paths) ctx.stroke(path);
    }
  }
  ctx.restore();
}

export function renderLottieToCanvas(
  ctx: CanvasRenderingContext2D,
  doc: Record<string, unknown>,
  timeSec: number,
  loopAnimation: boolean,
  speed: number,
  w: number,
  h: number,
  opacity: number
): void {
  const compW = Number(doc.w) || 512;
  const compH = Number(doc.h) || 512;
  const fr = Number(doc.fr) || 30;
  const ip = Number(doc.ip) || 0;
  const op = Number(doc.op) || 60;
  const dur = Math.max(1, op - ip);
  const rawFrame = Math.max(0, timeSec) * Math.max(0, speed) * fr;
  const frame = loopAnimation ? ip + (rawFrame % dur) : Math.min(ip + rawFrame, op - 0.001);

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.clip();
  ctx.scale(w / compW, h / compH);

  const layers = (doc.layers as Array<Record<string, unknown>>) || [];
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i];
    if (l.hd) continue;
    const lip = Number(l.ip ?? 0);
    const lop = Number(l.op ?? 1e9);
    if (frame < lip || frame >= lop) continue;

    ctx.save();
    const lOp = applyKs(ctx, l.ks as Record<string, unknown> | undefined, frame);
    const finalOp = opacity * lOp;
    if (finalOp > 0.001) {
      if (l.ty === 4 && Array.isArray(l.shapes)) {
        renderShapes(ctx, l.shapes as Array<Record<string, unknown>>, frame, finalOp);
      } else if (l.ty === 1 && typeof l.sc === 'string') {
        ctx.globalAlpha = finalOp;
        ctx.fillStyle = l.sc;
        ctx.fillRect(0, 0, Number(l.sw) || compW, Number(l.sh) || compH);
      }
    }
    ctx.restore();
  }

  ctx.restore();
}
