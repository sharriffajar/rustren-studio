/**
 * Lightweight zero-dependency Canvas2D Lottie (Bodymovin JSON) renderer
 * Mirrors rustren/src/renderer/lottie.rs for 100% Studio <-> Engine parity.
 */

const lottieCache = new Map<string, Record<string, unknown> | 'loading' | 'error'>();
const lottieImageCache = new Map<string, HTMLImageElement | 'loading' | 'error'>();

function getCachedLottieImage(src: string): HTMLImageElement | null {
  if (!src || typeof Image === 'undefined') return null;
  const cached = lottieImageCache.get(src);
  if (cached && typeof cached !== 'string') {
    return cached.complete && cached.naturalWidth > 0 ? cached : null;
  }
  if (cached === 'loading' || cached === 'error') return null;

  const img = new Image();
  if (!src.startsWith('data:')) {
    img.crossOrigin = 'anonymous';
  }
  lottieImageCache.set(src, 'loading');
  img.onload = () => {
    lottieImageCache.set(src, img);
  };
  img.onerror = () => {
    lottieImageCache.set(src, 'error');
  };
  img.src = src;
  if (img.complete && img.naturalWidth > 0) {
    lottieImageCache.set(src, img);
    return img;
  }
  return null;
}

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

function evalEasing(cur: Record<string, unknown>, rawT: number): number {
  const o = cur.o as Record<string, unknown> | undefined;
  const inp = cur.i as Record<string, unknown> | undefined;
  const ox = firstNum(o?.x, 0);
  const oy = firstNum(o?.y, 0);
  const ix = firstNum(inp?.x, 1);
  const iy = firstNum(inp?.y, 1);
  if (Math.abs(ox - oy) <= 1e-4 && Math.abs(ix - iy) <= 1e-4) return rawT;
  let lo = 0, hi = 1, u = rawT;
  for (let k = 0; k < 8; k++) {
    const x = cubic(u, ox, ix);
    if (Math.abs(x - rawT) < 1e-4) break;
    if (x < rawT) lo = u; else hi = u;
    u = 0.5 * (lo + hi);
  }
  return cubic(u, oy, iy);
}

interface LottieShapeData {
  v: number[][];
  i: number[][];
  o: number[][];
  c: boolean;
}

function extractShapeData(val: unknown): LottieShapeData | null {
  if (!val || typeof val !== 'object') return null;
  const obj = val as Record<string, unknown>;
  const v = obj.v as number[][] | undefined;
  const inp = obj.i as number[][] | undefined;
  const out = obj.o as number[][] | undefined;
  if (!Array.isArray(v) || !Array.isArray(inp) || !Array.isArray(out) || v.length === 0) return null;
  return { v, i: inp, o: out, c: Boolean(obj.c) };
}

function lerpPts(a: number[][], b: number[][], t: number): number[][] {
  return a.map((p, idx) => {
    const q = b[idx] ?? p;
    return [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
  });
}

function evalShapePoints(ks: Record<string, unknown> | undefined, frame: number): LottieShapeData | null {
  if (!ks || ks.k === undefined) return null;
  const kArr = Array.isArray(ks.k) ? (ks.k as Array<Record<string, unknown>>) : null;
  const animated =
    ks.a === 1 ||
    (kArr !== null && kArr.length > 0 && typeof kArr[0] === 'object' && kArr[0] !== null && 't' in kArr[0]);
  if (!animated || !kArr || kArr.length === 0) {
    return extractShapeData(ks.k);
  }
  const t0 = typeof kArr[0].t === 'number' ? kArr[0].t : 0;
  if (frame <= t0) {
    const sArr = kArr[0].s as unknown[] | undefined;
    return extractShapeData(Array.isArray(sArr) ? sArr[0] : sArr);
  }
  for (let idx = 0; idx < kArr.length; idx++) {
    const cur = kArr[idx];
    const tCur = typeof cur.t === 'number' ? cur.t : 0;
    if (idx + 1 >= kArr.length) {
      const term = cur.s !== undefined ? cur.s : (idx > 0 ? kArr[idx - 1].e : undefined);
      return extractShapeData(Array.isArray(term) ? term[0] : term);
    }
    const next = kArr[idx + 1];
    const tNext = typeof next.t === 'number' ? next.t : tCur;
    if (frame >= tCur && frame < tNext) {
      const sRaw = cur.s;
      const sData = extractShapeData(Array.isArray(sRaw) ? sRaw[0] : sRaw);
      if (!sData) return null;
      if (cur.h === 1 || tNext <= tCur) return sData;
      const eRaw = cur.e ?? next.s;
      const eData = extractShapeData(Array.isArray(eRaw) ? eRaw[0] : eRaw);
      if (
        eData &&
        sData.v.length === eData.v.length &&
        sData.i.length === eData.i.length &&
        sData.o.length === eData.o.length
      ) {
        const rawT = Math.max(0, Math.min(1, (frame - tCur) / (tNext - tCur)));
        const eased = evalEasing(cur, rawT);
        return {
          v: lerpPts(sData.v, eData.v, eased),
          i: lerpPts(sData.i, eData.i, eased),
          o: lerpPts(sData.o, eData.o, eased),
          c: sData.c,
        };
      }
      return sData;
    }
  }
  return null;
}

function buildShapePath(it: Record<string, unknown>, frame: number): Path2D | null {
  const ty = it.ty;
  if (ty === 'el') {
    const p = evalVec2(it.p, frame, [0, 0]);
    const s = evalVec2(it.s, frame, [100, 100]);
    const path = new Path2D();
    path.ellipse(p[0], p[1], Math.abs(s[0]) / 2, Math.abs(s[1]) / 2, 0, 0, Math.PI * 2);
    return path;
  }
  if (ty === 'rc') {
    const p = evalVec2(it.p, frame, [0, 0]);
    const s = evalVec2(it.s, frame, [100, 100]);
    const r = Math.max(0, evalScalar(it.r, frame, 0));
    const w = Math.abs(s[0]), h = Math.abs(s[1]);
    const path = new Path2D();
    path.roundRect(p[0] - w / 2, p[1] - h / 2, w, h, Math.min(r, w / 2, h / 2));
    return path;
  }
  if (ty === 'sh') {
    const shape = evalShapePoints(it.ks as Record<string, unknown> | undefined, frame);
    if (!shape || shape.v.length === 0) return null;
    const { v, i: inp, o: out, c } = shape;
    const path = new Path2D();
    path.moveTo(v[0][0], v[0][1]);
    const segs = c ? v.length : v.length - 1;
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
    if (c) path.closePath();
    return path;
  }
  return null;
}

function sampleColorStops(stops: Array<[number, number, number, number]>, pos: number): [number, number, number] {
  if (stops.length === 0) return [1, 1, 1];
  if (pos <= stops[0][0]) return [stops[0][1], stops[0][2], stops[0][3]];
  const last = stops[stops.length - 1];
  if (pos >= last[0]) return [last[1], last[2], last[3]];
  for (let i = 0; i + 1 < stops.length; i++) {
    const a = stops[i], b = stops[i + 1];
    if (pos >= a[0] && pos <= b[0]) {
      const t = Math.max(0, Math.min(1, (pos - a[0]) / Math.max(1e-6, b[0] - a[0])));
      return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
    }
  }
  return [last[1], last[2], last[3]];
}

function sampleAlphaStops(stops: Array<[number, number]>, pos: number): number {
  if (stops.length === 0) return 1;
  if (pos <= stops[0][0]) return stops[0][1];
  const last = stops[stops.length - 1];
  if (pos >= last[0]) return last[1];
  for (let i = 0; i + 1 < stops.length; i++) {
    const a = stops[i], b = stops[i + 1];
    if (pos >= a[0] && pos <= b[0]) {
      const t = Math.max(0, Math.min(1, (pos - a[0]) / Math.max(1e-6, b[0] - a[0])));
      return a[1] + (b[1] - a[1]) * t;
    }
  }
  return last[1];
}

function buildCanvasGradient(
  ctx: CanvasRenderingContext2D,
  item: Record<string, unknown>,
  frame: number,
  opacity: number
): CanvasGradient | string | null {
  const gObj = item.g as Record<string, unknown> | undefined;
  if (!gObj) return null;
  const pCount = Number(gObj.p) || 0;
  const vals = evalVecN(gObj.k as Record<string, unknown> | undefined, frame, []);
  if (pCount <= 0 || vals.length < pCount * 4) return null;

  const colorStops: Array<[number, number, number, number]> = [];
  for (let i = 0; i < pCount; i++) {
    const base = i * 4;
    const off = Math.max(0, Math.min(1, vals[base]));
    let r = vals[base + 1], g = vals[base + 2], b = vals[base + 3];
    if (r > 1 || g > 1 || b > 1) { r /= 255; g /= 255; b /= 255; }
    colorStops.push([off, Math.max(0, Math.min(1, r)), Math.max(0, Math.min(1, g)), Math.max(0, Math.min(1, b))]);
  }
  colorStops.sort((a, b) => a[0] - b[0]);

  const alphaStops: Array<[number, number]> = [];
  for (let idx = pCount * 4; idx + 1 < vals.length; idx += 2) {
    alphaStops.push([Math.max(0, Math.min(1, vals[idx])), Math.max(0, Math.min(1, vals[idx + 1]))]);
  }
  alphaStops.sort((a, b) => a[0] - b[0]);

  const allOffsets = [...colorStops.map((s) => s[0]), ...alphaStops.map((s) => s[0])].sort((a, b) => a - b);
  const dedupOffsets: number[] = [];
  for (const off of allOffsets) {
    if (dedupOffsets.length === 0 || Math.abs(off - dedupOffsets[dedupOffsets.length - 1]) >= 1e-4) {
      dedupOffsets.push(off);
    }
  }

  const s = evalVec2(item.s, frame, [0, 0]);
  const e = evalVec2(item.e, frame, [100, 0]);
  const dist = Math.hypot(e[0] - s[0], e[1] - s[1]);
  if (dist < 1e-4) {
    const [r, g, b] = sampleColorStops(colorStops, 0);
    const a = Math.max(0, Math.min(1, sampleAlphaStops(alphaStops, 0) * opacity));
    return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`;
  }

  let grad: CanvasGradient;
  if (item.t === 2) {
    const hLen = Math.max(-99, Math.min(99, evalScalar(item.h, frame, 0))) / 100;
    const hAng = (evalScalar(item.a, frame, 0) * Math.PI) / 180;
    const baseAng = Math.atan2(e[1] - s[1], e[0] - s[0]);
    const fx = s[0] + hLen * dist * Math.cos(baseAng + hAng);
    const fy = s[1] + hLen * dist * Math.sin(baseAng + hAng);
    grad = ctx.createRadialGradient(fx, fy, 0, s[0], s[1], dist);
  } else {
    grad = ctx.createLinearGradient(s[0], s[1], e[0], e[1]);
  }

  for (const pos of dedupOffsets) {
    const [r, g, b] = sampleColorStops(colorStops, pos);
    const a = Math.max(0, Math.min(1, sampleAlphaStops(alphaStops, pos) * opacity));
    grad.addColorStop(pos, `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`);
  }
  return grad;
}

function groupHasPaint(items: Array<Record<string, unknown>>): boolean {
  return items.some((it) => !it.hd && (it.ty === 'fl' || it.ty === 'gf' || it.ty === 'st' || it.ty === 'gs'));
}

function buildKsMatrix(ks: Record<string, unknown>, frame: number): DOMMatrix {
  const m = new DOMMatrix();
  const a = evalVec2(ks.a, frame, [0, 0]);
  const p = evalVec2(ks.p, frame, [0, 0]);
  const s = evalVec2(ks.s, frame, [100, 100]);
  const r = evalScalar(ks.r, frame, 0);
  m.translateSelf(p[0], p[1]);
  if (r) m.rotateSelf(r);
  if (s[0] !== 100 || s[1] !== 100) m.scaleSelf(s[0] / 100, s[1] / 100);
  if (a[0] || a[1]) m.translateSelf(-a[0], -a[1]);
  return m;
}

function collectUnpaintedGroupPaths(
  items: Array<Record<string, unknown>>,
  frame: number,
  localMat: DOMMatrix,
  out: Path2D[]
): void {
  let mat = DOMMatrix.fromMatrix(localMat);
  for (const it of items) {
    if (it.ty === 'tr') {
      mat = mat.multiply(buildKsMatrix(it, frame));
    }
  }
  for (const it of items) {
    if (it.hd) continue;
    if (it.ty === 'gr' && Array.isArray(it.it)) {
      const sub = it.it as Array<Record<string, unknown>>;
      if (!groupHasPaint(sub)) {
        collectUnpaintedGroupPaths(sub, frame, mat, out);
      }
    } else {
      const p = buildShapePath(it, frame);
      if (p) {
        const transformed = new Path2D();
        transformed.addPath(p, mat);
        out.push(transformed);
      }
    }
  }
}

function fillPathsCombined(ctx: CanvasRenderingContext2D, paths: Path2D[], rule: CanvasFillRule): void {
  if (paths.length === 1) {
    ctx.fill(paths[0], rule);
    return;
  }
  const combined = new Path2D();
  for (const p of paths) combined.addPath(p);
  ctx.fill(combined, rule);
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
    if (it.ty === 'gr' && Array.isArray(it.it)) {
      const sub = it.it as Array<Record<string, unknown>>;
      if (!groupHasPaint(sub)) {
        collectUnpaintedGroupPaths(sub, frame, new DOMMatrix(), paths);
      }
    } else {
      const p = buildShapePath(it, frame);
      if (p) paths.push(p);
    }
  }

  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (it.hd) continue;
    const ty = it.ty;
    if (ty === 'gr' && Array.isArray(it.it)) {
      const sub = it.it as Array<Record<string, unknown>>;
      if (groupHasPaint(sub)) {
        renderShapes(ctx, sub, frame, groupOp);
      }
    } else if (ty === 'fl' && paths.length > 0) {
      const o = evalScalar(it.o, frame, 100) / 100;
      ctx.fillStyle = evalRgba(it.c, frame, o * groupOp);
      fillPathsCombined(ctx, paths, it.r === 2 ? 'evenodd' : 'nonzero');
    } else if (ty === 'gf' && paths.length > 0) {
      const o = evalScalar(it.o, frame, 100) / 100;
      const grad = buildCanvasGradient(ctx, it, frame, o * groupOp);
      if (grad) {
        ctx.fillStyle = grad;
        fillPathsCombined(ctx, paths, it.r === 2 ? 'evenodd' : 'nonzero');
      }
    } else if (ty === 'st' && paths.length > 0) {
      const o = evalScalar(it.o, frame, 100) / 100;
      ctx.strokeStyle = evalRgba(it.c, frame, o * groupOp);
      ctx.lineWidth = evalScalar(it.w, frame, 2);
      ctx.lineCap = it.lc === 2 ? 'round' : it.lc === 3 ? 'square' : 'butt';
      ctx.lineJoin = it.lj === 2 ? 'round' : it.lj === 3 ? 'bevel' : 'miter';
      for (const path of paths) ctx.stroke(path);
    } else if (ty === 'gs' && paths.length > 0) {
      const o = evalScalar(it.o, frame, 100) / 100;
      const grad = buildCanvasGradient(ctx, it, frame, o * groupOp);
      if (grad) {
        ctx.strokeStyle = grad;
        ctx.lineWidth = evalScalar(it.w, frame, 2);
        ctx.lineCap = it.lc === 2 ? 'round' : it.lc === 3 ? 'square' : 'butt';
        ctx.lineJoin = it.lj === 2 ? 'round' : it.lj === 3 ? 'bevel' : 'miter';
        for (const path of paths) ctx.stroke(path);
      }
    }
  }
  ctx.restore();
}

function mapLottieBlendMode(bm: number): GlobalCompositeOperation {
  switch (bm) {
    case 1: return 'multiply';
    case 2: return 'screen';
    case 3: return 'overlay';
    case 4: return 'darken';
    case 5: return 'lighten';
    case 6: return 'color-dodge';
    case 7: return 'color-burn';
    case 8: return 'hard-light';
    case 9: return 'soft-light';
    case 10: return 'difference';
    case 11: return 'exclusion';
    case 12: return 'hue';
    case 13: return 'saturation';
    case 14: return 'color';
    case 15: return 'luminosity';
    default: return 'source-over';
  }
}

function extractGaussianBlurRadius(layer: Record<string, unknown>, frame: number): number {
  const effects = layer.ef as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(effects)) return 0;
  let total = 0;
  for (const ef of effects) {
    if (ef.ty === 29 && ef.en !== 0 && Array.isArray(ef.ef)) {
      const first = ef.ef[0] as Record<string, unknown> | undefined;
      if (first?.v) {
        const b = evalScalar(first.v, frame, 0);
        if (b > 0) total += b * 0.35;
      }
    }
  }
  return total;
}

function renderSingleLayer(
  ctx: CanvasRenderingContext2D,
  l: Record<string, unknown>,
  layers: Array<Record<string, unknown>>,
  assets: Array<Record<string, unknown>>,
  frame: number,
  parentOpacity: number,
  compW: number,
  compH: number
): void {
  ctx.save();
  const lOp = applyParentChain(ctx, l, layers, frame);
  const finalOp = parentOpacity * lOp;
  if (finalOp > 0.001) {
    if (l.ty === 4 && Array.isArray(l.shapes)) {
      renderShapes(ctx, l.shapes as Array<Record<string, unknown>>, frame, finalOp);
    } else if (l.ty === 1 && typeof l.sc === 'string') {
      ctx.globalAlpha = finalOp;
      ctx.fillStyle = l.sc;
      ctx.fillRect(0, 0, Number(l.sw) || compW, Number(l.sh) || compH);
    } else if (l.ty === 2 && typeof l.refId === 'string') {
      const asset = assets.find((a) => a.id === l.refId);
      if (asset && typeof asset.p === 'string' && asset.p.length > 0) {
        const u = typeof asset.u === 'string' ? asset.u : '';
        const imgSrc = asset.p.startsWith('data:') ? asset.p : `${u}${asset.p}`;
        const img = getCachedLottieImage(imgSrc);
        if (img) {
          ctx.globalAlpha = finalOp;
          const tw = Number(asset.w) || img.naturalWidth;
          const th = Number(asset.h) || img.naturalHeight;
          ctx.drawImage(img, 0, 0, tw, th);
        }
      }
    } else if (l.ty === 0 && typeof l.refId === 'string') {
      const comp = assets.find((a) => a.id === l.refId);
      if (comp && Array.isArray(comp.layers)) {
        const st = Number(l.st ?? 0);
        const sr = Math.max(0.001, Number(l.sr ?? 1));
        const subFrame = (frame - st) / sr;
        renderLayerList(
          ctx,
          comp.layers as Array<Record<string, unknown>>,
          assets,
          subFrame,
          finalOp,
          Number(comp.w) || compW,
          Number(comp.h) || compH
        );
      }
    }
  }
  ctx.restore();
}

function applyParentChain(
  ctx: CanvasRenderingContext2D,
  layer: Record<string, unknown>,
  allLayers: Array<Record<string, unknown>>,
  frame: number
): number {
  const chain: Array<Record<string, unknown>> = [layer];
  let cur: Record<string, unknown> = layer;
  for (let depth = 0; depth < 16; depth++) {
    const parentInd = cur.parent;
    if (typeof parentInd !== 'number') break;
    const parentLayer = allLayers.find((l) => l.ind === parentInd);
    if (!parentLayer) break;
    chain.push(parentLayer);
    cur = parentLayer;
  }
  for (let i = chain.length - 1; i >= 0; i--) {
    applyKs(ctx, chain[i].ks as Record<string, unknown> | undefined, frame);
  }
  const ks = layer.ks as Record<string, unknown> | undefined;
  return ks ? Math.max(0, Math.min(1, evalScalar(ks.o, frame, 100) / 100)) : 1;
}

function createOffscreenCanvas(w: number, h: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

function renderLayerList(
  ctx: CanvasRenderingContext2D,
  layers: Array<Record<string, unknown>>,
  assets: Array<Record<string, unknown>>,
  frame: number,
  parentOpacity: number,
  compW: number,
  compH: number
): void {
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i];
    if (l.td && Number(l.td) !== 0) continue;
    if (l.hd) continue;
    const lip = Number(l.ip ?? 0);
    const lop = Number(l.op ?? 1e9);
    if (frame < lip || frame >= lop) continue;

    const tt = Number(l.tt ?? 0);
    const bm = Number(l.bm ?? 0);
    const blurRadius = extractGaussianBlurRadius(l, frame);
    const hasMatte = tt >= 1 && tt <= 4;

    if (!hasMatte) {
      ctx.save();
      if (bm !== 0) ctx.globalCompositeOperation = mapLottieBlendMode(bm);
      if (blurRadius > 0.1) ctx.filter = `blur(${Math.min(64, blurRadius)}px)`;
      renderSingleLayer(ctx, l, layers, assets, frame, parentOpacity, compW, compH);
      ctx.restore();
      continue;
    }

    const layerCanvas = createOffscreenCanvas(compW, compH);
    const lCtx = layerCanvas?.getContext('2d');
    if (!layerCanvas || !lCtx) {
      renderSingleLayer(ctx, l, layers, assets, frame, parentOpacity, compW, compH);
      continue;
    }
    if (blurRadius > 0.1) lCtx.filter = `blur(${Math.min(64, blurRadius)}px)`;
    renderSingleLayer(lCtx, l, layers, assets, frame, parentOpacity, compW, compH);
    lCtx.filter = 'none';

    const matteIdx = typeof l.tp === 'number'
      ? layers.findIndex((cand) => cand.ind === l.tp)
      : (i > 0 ? i - 1 : -1);

    if (matteIdx >= 0 && matteIdx < layers.length) {
      const mLayer = layers[matteIdx];
      const matteCanvas = createOffscreenCanvas(compW, compH);
      const mCtx = matteCanvas?.getContext('2d');
      if (matteCanvas && mCtx) {
        const mip = Number(mLayer.ip ?? 0);
        const mop = Number(mLayer.op ?? 1e9);
        if (frame >= mip && frame < mop) {
          renderSingleLayer(mCtx, mLayer, layers, assets, frame, 1, compW, compH);
        }
        if (tt === 3 || tt === 4) {
          const imgData = mCtx.getImageData(0, 0, matteCanvas.width, matteCanvas.height);
          const d = imgData.data;
          for (let p = 0; p < d.length; p += 4) {
            const luma = Math.round(0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2]);
            d[p + 3] = Math.round((luma * d[p + 3]) / 255);
          }
          mCtx.putImageData(imgData, 0, 0);
        }
        lCtx.globalCompositeOperation = (tt === 1 || tt === 3) ? 'destination-in' : 'destination-out';
        lCtx.drawImage(matteCanvas, 0, 0);
      }
    }

    ctx.save();
    if (bm !== 0) ctx.globalCompositeOperation = mapLottieBlendMode(bm);
    ctx.drawImage(layerCanvas, 0, 0);
    ctx.restore();
  }
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

  const assets = (doc.assets as Array<Record<string, unknown>>) || [];
  const layers = (doc.layers as Array<Record<string, unknown>>) || [];
  renderLayerList(ctx, layers, assets, frame, opacity, compW, compH);

  ctx.restore();
}
