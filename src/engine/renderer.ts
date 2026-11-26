import {
  clamp,
  evalDynamicText,
  evalEasing,
  evaluateLayerAtTime,
  normalizeFontWeight,
  type ComputedLayerProps,
} from './animation';
import type {
  Anchor,
  BlendMode,
  ContainerLayer,
  Layer,
  LinearGradient,
  RustrenScene,
  TrackMatteMode,
  WaveWarpSpec,
} from './types';

export interface LayerBounds {
  layerIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

const imageCache = new Map<string, HTMLImageElement | 'loading' | 'error'>();
const svgCache = new Map<string, HTMLImageElement | 'loading' | 'error'>();

function getCachedImage(src: string, onLoad?: () => void): HTMLImageElement | null {
  if (!src) return null;
  const cached = imageCache.get(src);
  if (cached instanceof HTMLImageElement) return cached;
  if (cached === 'loading' || cached === 'error') return null;

  if (typeof Image === 'undefined') return null;
  imageCache.set(src, 'loading');
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    imageCache.set(src, img);
    onLoad?.();
  };
  img.onerror = () => {
    imageCache.set(src, 'error');
  };
  img.src = src;
  return null;
}

function getCachedSvg(src: string, onLoad?: () => void): HTMLImageElement | null {
  if (!src) return null;
  const cached = svgCache.get(src);
  if (cached instanceof HTMLImageElement) return cached;
  if (cached === 'loading' || cached === 'error') return null;
  if (typeof Image === 'undefined') return null;

  svgCache.set(src, 'loading');
  const img = new Image();
  img.onload = () => {
    svgCache.set(src, img);
    onLoad?.();
  };
  img.onerror = () => {
    svgCache.set(src, 'error');
  };
  if (src.trim().startsWith('<svg')) {
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(src)}`;
  } else {
    img.src = src;
  }
  return null;
}

function mapBlendMode(mode?: BlendMode): GlobalCompositeOperation {
  switch (mode) {
    case 'multiply':
      return 'multiply';
    case 'screen':
      return 'screen';
    case 'overlay':
      return 'overlay';
    case 'darken':
      return 'darken';
    case 'lighten':
      return 'lighten';
    case 'color_dodge':
      return 'color-dodge';
    case 'color_burn':
      return 'color-burn';
    case 'hard_light':
      return 'hard-light';
    case 'soft_light':
      return 'soft-light';
    case 'difference':
      return 'difference';
    case 'exclusion':
      return 'exclusion';
    default:
      return 'source-over';
  }
}

function getAnchorOffset(anchor: Anchor | undefined, w: number, h: number): [number, number] {
  switch (anchor) {
    case 'top_center':
      return [-w / 2, 0];
    case 'top_right':
      return [-w, 0];
    case 'center_left':
      return [0, -h / 2];
    case 'center':
      return [-w / 2, -h / 2];
    case 'center_right':
      return [-w, -h / 2];
    case 'bottom_left':
      return [0, -h];
    case 'bottom_center':
      return [-w / 2, -h];
    case 'bottom_right':
      return [-w, -h];
    case 'top_left':
    default:
      return [0, 0];
  }
}

function buildFillStyle(
  ctx: CanvasRenderingContext2D,
  color: string,
  gradient: LinearGradient | undefined,
  w: number,
  h: number
): string | CanvasGradient {
  if (!gradient) return color;
  if (gradient.type === 'radial') {
    const cx = w / 2;
    const cy = h / 2;
    const r = Math.max(w, h) / 2;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.max(1, r));
    if (gradient.stops && gradient.stops.length > 0) {
      for (const s of gradient.stops) g.addColorStop(clamp(s.offset, 0, 1), s.color);
    } else {
      g.addColorStop(0, gradient.from || color);
      g.addColorStop(1, gradient.to || '#000000');
    }
    return g;
  }

  const rad = ((gradient.angle ?? 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = w / 2;
  const cy = h / 2;
  const halfLen = (Math.abs(w * cos) + Math.abs(h * sin)) / 2;
  const g = ctx.createLinearGradient(
    cx - cos * halfLen,
    cy - sin * halfLen,
    cx + cos * halfLen,
    cy + sin * halfLen
  );
  if (gradient.stops && gradient.stops.length > 0) {
    for (const s of gradient.stops) g.addColorStop(clamp(s.offset, 0, 1), s.color);
  } else {
    g.addColorStop(0, gradient.from || color);
    g.addColorStop(1, gradient.to || '#000000');
  }
  return g;
}

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const rad = Math.min(Math.max(0, r), w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

function seededRand(seed: number): () => number {
  let s = seed | 0 || 42;
  return () => {
    s = (s * 1664525 + 1013904223) | 0;
    return ((s >>> 0) % 100000) / 100000;
  };
}

function wrapTextLines(ctx: CanvasRenderingContext2D, text: string, maxWidth?: number): string[] {
  const paragraphs = text.split('\n');
  if (!maxWidth || maxWidth <= 0) return paragraphs;
  const lines: string[] = [];
  for (const para of paragraphs) {
    const words = para.split(/\s+/);
    let current = '';
    for (const word of words) {
      const test = current ? `${current} ${word}` : word;
      if (ctx.measureText(test).width > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = test;
      }
    }
    if (current) lines.push(current);
  }
  return lines.length > 0 ? lines : [''];
}

export interface RenderOptions {
  selectedLayerIndex?: number | null;
  showGuides?: boolean;
  onAssetLoad?: () => void;
  collectBounds?: LayerBounds[];
}

export function renderRustrenFrame(
  ctx: CanvasRenderingContext2D,
  scene: RustrenScene,
  timeSec: number,
  options: RenderOptions = {}
): void {
  const { width, height, duration_secs } = scene.canvas;
  ctx.save();
  ctx.clearRect(0, 0, width, height);

  // Canvas background
  ctx.fillStyle = scene.canvas.background || '#09090D';
  ctx.fillRect(0, 0, width, height);

  const layers = scene.layers || [];
  const layerById = new Map<string, Layer>();
  const matteIds = new Set<string>();
  for (const l of layers) {
    if (l.id) layerById.set(l.id, l);
    if (l.name && !layerById.has(l.name)) layerById.set(l.name, l);
    if (l.track_matte && typeof l.matte_layer === 'string') matteIds.add(l.matte_layer);
  }

  layers.forEach((layer, idx) => {
    if (layer.id && matteIds.has(layer.id)) return;
    renderLayer(ctx, layer, idx, timeSec, duration_secs, 1, 0, 0, options, layerById, width, height);
  });

  // Safe area guide overlay (only in editor preview, never during export)
  if (options.showGuides) {
    ctx.save();
    ctx.strokeStyle = 'rgba(249, 115, 22, 0.35)';
    ctx.lineWidth = Math.max(1.5, width / 900);
    ctx.setLineDash([8, 6]);
    const marginX = width * 0.05;
    const marginY = height * 0.05;
    ctx.strokeRect(marginX, marginY, width - marginX * 2, height - marginY * 2);

    // Center crosshair
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(width / 2, 0);
    ctx.lineTo(width / 2, height);
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();
    ctx.restore();
  }

  // Selected layer bounding box
  if (
    options.selectedLayerIndex !== null &&
    options.selectedLayerIndex !== undefined &&
    options.collectBounds
  ) {
    const box = options.collectBounds.find((b) => b.layerIndex === options.selectedLayerIndex);
    if (box) {
      ctx.save();
      const lw = Math.max(2, width / 640);
      ctx.strokeStyle = '#F97316';
      ctx.lineWidth = lw;
      ctx.strokeRect(box.x, box.y, box.width, box.height);

      // Corner handles
      const hs = Math.max(7, width / 160);
      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = '#F97316';
      const corners = [
        [box.x, box.y],
        [box.x + box.width, box.y],
        [box.x, box.y + box.height],
        [box.x + box.width, box.y + box.height],
      ];
      for (const [cx, cy] of corners) {
        ctx.fillRect(cx - hs / 2, cy - hs / 2, hs, hs);
        ctx.strokeRect(cx - hs / 2, cy - hs / 2, hs, hs);
      }
      ctx.restore();
    }
  }

  ctx.restore();
}

function applyTransform(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  props: ComputedLayerProps
) {
  ctx.translate(px, py);
  if (props.rotation) {
    ctx.rotate((props.rotation * Math.PI) / 180);
  }
  if (props.skew_x || props.skew_y) {
    const sx = Math.tan(((props.skew_x || 0) * Math.PI) / 180);
    const sy = Math.tan(((props.skew_y || 0) * Math.PI) / 180);
    ctx.transform(1, sy, sx, 1, 0, 0);
  }
  const sx = props.scale * props.scale_x;
  const sy = props.scale * props.scale_y;
  if (sx !== 1 || sy !== 1) {
    ctx.scale(sx, sy);
  }
}

function applyWaveWarpToCanvas(
  srcCanvas: HTMLCanvasElement,
  warp: WaveWarpSpec,
  timeSec: number
): HTMLCanvasElement {
  const w = srcCanvas.width;
  const h = srcCanvas.height;
  const amp = warp.amplitude ?? 12;
  if (Math.abs(amp) < 0.01 || w === 0 || h === 0) return srcCanvas;
  const freq = warp.wavelength
    ? (2 * Math.PI) / Math.max(1, warp.wavelength)
    : (warp.frequency ?? 0.04);
  const speed = warp.speed ?? 4;
  const phase = (warp.phase ?? 0) + timeSec * speed;
  const axis = warp.axis ?? 'x';

  const sctx = srcCanvas.getContext('2d');
  if (!sctx) return srcCanvas;
  const srcData = sctx.getImageData(0, 0, w, h);
  const dstCanvas = document.createElement('canvas');
  dstCanvas.width = w;
  dstCanvas.height = h;
  const dctx = dstCanvas.getContext('2d');
  if (!dctx) return srcCanvas;
  const dstData = dctx.createImageData(w, h);
  const s = srcData.data;
  const d = dstData.data;

  if (axis === 'x') {
    const lut = new Int32Array(h);
    for (let y = 0; y < h; y++) lut[y] = Math.round(Math.sin(y * freq + phase) * amp);
    for (let y = 0; y < h; y++) {
      const shift = lut[y];
      const rowOff = y * w;
      for (let x = 0; x < w; x++) {
        const sx = x - shift;
        if (sx < 0 || sx >= w) continue;
        const si = (rowOff + sx) * 4;
        const di = (rowOff + x) * 4;
        d[di] = s[si]; d[di + 1] = s[si + 1]; d[di + 2] = s[si + 2]; d[di + 3] = s[si + 3];
      }
    }
  } else if (axis === 'stretch_x') {
    const lut = new Int32Array(w);
    for (let x = 0; x < w; x++) lut[x] = Math.round(x - Math.sin(x * freq + phase) * amp);
    for (let y = 0; y < h; y++) {
      const rowOff = y * w;
      for (let x = 0; x < w; x++) {
        const sx = lut[x];
        if (sx < 0 || sx >= w) continue;
        const si = (rowOff + sx) * 4;
        const di = (rowOff + x) * 4;
        d[di] = s[si]; d[di + 1] = s[si + 1]; d[di + 2] = s[si + 2]; d[di + 3] = s[si + 3];
      }
    }
  } else if (axis === 'y') {
    const lut = new Int32Array(w);
    for (let x = 0; x < w; x++) lut[x] = Math.round(Math.sin(x * freq + phase) * amp);
    for (let y = 0; y < h; y++) {
      const rowOff = y * w;
      for (let x = 0; x < w; x++) {
        const sy = y - lut[x];
        if (sy < 0 || sy >= h) continue;
        const si = (sy * w + x) * 4;
        const di = (rowOff + x) * 4;
        d[di] = s[si]; d[di + 1] = s[si + 1]; d[di + 2] = s[si + 2]; d[di + 3] = s[si + 3];
      }
    }
  } else {
    // stretch_y
    const lut = new Int32Array(h);
    for (let y = 0; y < h; y++) lut[y] = Math.round(y - Math.sin(y * freq + phase) * amp);
    for (let y = 0; y < h; y++) {
      const sy = lut[y];
      if (sy < 0 || sy >= h) continue;
      const srcRow = sy * w;
      const dstRow = y * w;
      for (let x = 0; x < w; x++) {
        const si = (srcRow + x) * 4;
        const di = (dstRow + x) * 4;
        d[di] = s[si]; d[di + 1] = s[si + 1]; d[di + 2] = s[si + 2]; d[di + 3] = s[si + 3];
      }
    }
  }

  dctx.putImageData(dstData, 0, 0);
  return dstCanvas;
}

function applyTrackMatteToCanvas(
  srcCanvas: HTMLCanvasElement,
  matteCanvas: HTMLCanvasElement,
  mode: TrackMatteMode
): void {
  const w = srcCanvas.width;
  const h = srcCanvas.height;
  const sctx = srcCanvas.getContext('2d');
  const mctx = matteCanvas.getContext('2d');
  if (!sctx || !mctx || w === 0 || h === 0) return;

  const sImg = sctx.getImageData(0, 0, w, h);
  const mImg = mctx.getImageData(0, 0, w, h);
  const sd = sImg.data;
  const md = mImg.data;

  for (let i = 0; i < sd.length; i += 4) {
    let factor = 0;
    if (mode === 'alpha' || mode === 'alpha_inverted') {
      factor = md[i + 3] / 255;
      if (mode === 'alpha_inverted') factor = 1 - factor;
    } else {
      const luma = (0.299 * md[i] + 0.587 * md[i + 1] + 0.114 * md[i + 2]) / 255;
      factor = luma * (md[i + 3] / 255);
      if (mode === 'luma_inverted') factor = 1 - factor;
    }
    sd[i + 3] = Math.round(sd[i + 3] * clamp(factor, 0, 1));
  }

  sctx.putImageData(sImg, 0, 0);
}

function renderLayer(
  ctx: CanvasRenderingContext2D,
  layer: Layer,
  rootIndex: number | null,
  timeSec: number,
  durationSecs: number,
  inheritedOpacity: number,
  originX: number,
  originY: number,
  options: RenderOptions,
  layerById?: Map<string, Layer>,
  canvasW?: number,
  canvasH?: number
): void {
  // Echo motion trails (v0.5.1)
  if (layer.echo && (layer.echo.count ?? 0) > 0) {
    const count = Math.min(12, Math.max(0, Math.round(layer.echo.count ?? 3)));
    const step = layer.echo.step_sec ?? 0.04;
    const decay = clamp(layer.echo.decay ?? 0.6, 0.05, 0.98);
    const strippedLayer: Layer = { ...layer, echo: undefined };
    for (let i = count; i >= 1; i--) {
      const trailT = timeSec - i * step;
      if (trailT < 0) continue;
      const trailOpacity = inheritedOpacity * Math.pow(decay, i);
      renderLayer(
        ctx,
        strippedLayer,
        null,
        trailT,
        durationSecs,
        trailOpacity,
        originX,
        originY,
        options,
        layerById,
        canvasW,
        canvasH
      );
    }
  }

  // Offscreen post-processing for wave_warp / track_matte (v0.5.1)
  const resolvedMatteLayer =
    layer.track_matte && layer.matte_layer
      ? typeof layer.matte_layer === 'string'
        ? layerById?.get(layer.matte_layer)
        : layer.matte_layer
      : undefined;
  const needsOffscreen =
    typeof document !== 'undefined' &&
    Boolean(layer.wave_warp || resolvedMatteLayer);

  if (needsOffscreen) {
    const cw = canvasW || ctx.canvas.width || 1920;
    const ch = canvasH || ctx.canvas.height || 1080;
    let off = document.createElement('canvas');
    off.width = cw;
    off.height = ch;
    const octx = off.getContext('2d');
    if (octx) {
      const cleanLayer: Layer = {
        ...layer,
        echo: undefined,
        wave_warp: undefined,
        track_matte: undefined,
        matte_layer: undefined,
      };
      renderLayerCore(octx, cleanLayer, rootIndex, timeSec, durationSecs, inheritedOpacity, originX, originY, options, layerById, cw, ch);

      if (layer.wave_warp) {
        off = applyWaveWarpToCanvas(off, layer.wave_warp, timeSec);
      }

      if (layer.track_matte && resolvedMatteLayer) {
        const matteCanvas = document.createElement('canvas');
        matteCanvas.width = cw;
        matteCanvas.height = ch;
        const mctx = matteCanvas.getContext('2d');
        if (mctx) {
          renderLayerCore(mctx, resolvedMatteLayer, null, timeSec, durationSecs, 1, 0, 0, {}, layerById, cw, ch);
          applyTrackMatteToCanvas(off, matteCanvas, layer.track_matte);
        }
      }

      ctx.save();
      ctx.globalCompositeOperation = mapBlendMode(layer.blend_mode);
      ctx.drawImage(off, 0, 0);
      ctx.restore();
      return;
    }
  }

  renderLayerCore(ctx, layer, rootIndex, timeSec, durationSecs, inheritedOpacity, originX, originY, options, layerById, canvasW, canvasH);
}

function renderLayerCore(
  ctx: CanvasRenderingContext2D,
  layer: Layer,
  rootIndex: number | null,
  timeSec: number,
  durationSecs: number,
  inheritedOpacity: number,
  originX: number,
  originY: number,
  options: RenderOptions,
  layerById?: Map<string, Layer>,
  canvasW?: number,
  canvasH?: number
): void {
  const props = evaluateLayerAtTime(layer, timeSec, durationSecs);
  if (!props.visible || props.opacity <= 0.001) return;

  const finalOpacity = clamp(props.opacity * inheritedOpacity, 0, 1);

  ctx.save();
  ctx.globalAlpha = finalOpacity;
  ctx.globalCompositeOperation = mapBlendMode(layer.blend_mode);

  if (layer.blur && layer.blur > 0) {
    ctx.filter = `blur(${layer.blur}px)`;
  }

  if (layer.shadow) {
    ctx.shadowColor = layer.shadow.color || 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = layer.shadow.blur ?? 16;
    ctx.shadowOffsetX = layer.shadow.offset_x ?? 0;
    ctx.shadowOffsetY = layer.shadow.offset_y ?? 6;
  }

  if (layer.type === 'rect') {
    const w = Math.max(0, props.width);
    const h = Math.max(0, props.height);
    const [ox, oy] = getAnchorOffset(layer.anchor, w, h);
    const px = originX + props.x;
    const py = originY + props.y;

    if (rootIndex !== null && options.collectBounds) {
      options.collectBounds.push({ layerIndex: rootIndex, x: px + ox, y: py + oy, width: w, height: h });
    }

    const pvx = layer.pivot_x ?? 0.5;
    const pvy = layer.pivot_y ?? 0.5;
    const pivotX = px + ox + w * pvx;
    const pivotY = py + oy + h * pvy;
    applyTransform(ctx, pivotX, pivotY, props);
    const drawX = -w * pvx;
    const drawY = -h * pvy;

    drawRoundedRectPath(ctx, drawX, drawY, w, h, props.radius);
    ctx.fillStyle = buildFillStyle(ctx, props.color, layer.gradient, w, h);
    ctx.fill();

    if (layer.border_width && layer.border_width > 0) {
      ctx.strokeStyle = props.border_color || '#FFFFFF';
      ctx.lineWidth = layer.border_width;
      if (props.path_progress < 1) {
        const perimeter = 2 * (w + h);
        ctx.setLineDash([perimeter * clamp(props.path_progress, 0, 1), perimeter]);
        ctx.lineDashOffset = props.stroke_dashoffset || 0;
      }
      ctx.stroke();
    }
  } else if (layer.type === 'circle') {
    const cx = originX + props.cx;
    const cy = originY + props.cy;
    const r = Math.max(0, props.r);

    if (rootIndex !== null && options.collectBounds) {
      const scaledR = r * props.scale;
      options.collectBounds.push({
        layerIndex: rootIndex,
        x: cx - scaledR,
        y: cy - scaledR,
        width: scaledR * 2,
        height: scaledR * 2,
      });
    }

    applyTransform(ctx, cx, cy, props);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = buildFillStyle(ctx, props.color, layer.gradient, r * 2, r * 2);
    ctx.fill();

    if (layer.border_width && layer.border_width > 0) {
      ctx.strokeStyle = props.border_color || '#FFFFFF';
      ctx.lineWidth = layer.border_width;
      ctx.stroke();
    }
  } else if (layer.type === 'text') {
    const fontSize = (layer.font_size ?? 48) * props.scale;
    const weight = normalizeFontWeight(layer.font_weight);
    const family = layer.font_family || '"Plus Jakarta Sans", sans-serif';
    ctx.font = `${weight} ${fontSize}px ${family}`;
    ctx.textBaseline = 'top';

    const rawText = layer.dynamic
      ? evalDynamicText(layer.dynamic, timeSec)
      : layer.spans
        ? layer.spans.map((s) => s.text).join('')
        : (layer.content ?? '');

    const lines = wrapTextLines(ctx, rawText, layer.max_width);
    const lineHeight = (layer.line_height ?? fontSize * 1.25) * (layer.line_height ? props.scale : 1);
    const measuredWidths = lines.map((l) => ctx.measureText(l).width);
    const boxW = Math.max(10, ...measuredWidths);
    const boxH = Math.max(fontSize, lines.length * lineHeight);

    const px = originX + props.x;
    const py = originY + props.y;
    const [ox, oy] = getAnchorOffset(layer.anchor, boxW, boxH);

    if (rootIndex !== null && options.collectBounds) {
      options.collectBounds.push({
        layerIndex: rootIndex,
        x: px + ox,
        y: py + oy,
        width: boxW,
        height: boxH,
      });
    }

    ctx.translate(px, py);
    if (props.rotation) ctx.rotate((props.rotation * Math.PI) / 180);
    if (props.skew_x || props.skew_y) {
      ctx.transform(
        1,
        Math.tan(((props.skew_y || 0) * Math.PI) / 180),
        Math.tan(((props.skew_x || 0) * Math.PI) / 180),
        1,
        0,
        0
      );
    }
    if (props.scale_x !== 1 || props.scale_y !== 1) {
      ctx.scale(props.scale_x, props.scale_y);
    }

    ctx.fillStyle = buildFillStyle(ctx, props.color, layer.gradient, boxW, boxH);
    const align = layer.text_align || (layer.anchor === 'center' ? 'center' : 'left');
    ctx.textAlign = align === 'start' ? 'left' : align === 'end' ? 'right' : align;

    if (layer.text_animator) {
      const ta = layer.text_animator;
      const unit = ta.mode ?? ta.unit ?? 'char';
      const taStart = ta.start_sec ?? layer.start_sec ?? 0;
      const stagger = ta.stagger_secs ?? 0.04;
      const dur = Math.max(0.01, ta.duration_secs ?? 0.35);
      const xOff = ta.x_offset ?? 0;
      const yOff = ta.y_offset ?? 24;
      const opFrom = ta.opacity_from ?? 1;
      const scFrom = ta.scale_from ?? 1;
      const easing = ta.easing ?? 'linear';

      let itemIdx = 0;
      lines.forEach((line, lineIdx) => {
        const lineW = ctx.measureText(line).width;
        let baseX = ox;
        if (ctx.textAlign === 'center') baseX = ox + (boxW - lineW) / 2;
        else if (ctx.textAlign === 'right') baseX = ox + (boxW - lineW);

        const tokens = unit === 'word' ? line.split(/(\s+)/) : Array.from(line);
        let cursorX = baseX;
        const baseY = oy + lineIdx * lineHeight;

        for (const tok of tokens) {
          const tokW = ctx.measureText(tok).width;
          if (!tok.trim()) {
            cursorX += tokW;
            continue;
          }
          const tLocal = (timeSec - (taStart + itemIdx * stagger)) / dur;
          const p = evalEasing(clamp(tLocal, 0, 1), easing);
          const alpha = opFrom + (1 - opFrom) * p;
          const sc = scFrom + (1 - scFrom) * p;
          const dx = xOff * (1 - p);
          const dy = yOff * (1 - p);

          if (alpha > 0.005) {
            ctx.save();
            ctx.globalAlpha = finalOpacity * clamp(alpha, 0, 1);
            ctx.textAlign = 'left';
            ctx.translate(cursorX + tokW / 2 + dx, baseY + fontSize / 2 + dy);
            if (sc !== 1) ctx.scale(sc, sc);
            ctx.fillText(tok, -tokW / 2, -fontSize / 2);
            ctx.restore();
          }
          cursorX += tokW;
          itemIdx++;
        }
      });
    } else {
      lines.forEach((line, i) => {
        let drawX = ox;
        if (ctx.textAlign === 'center') drawX = ox + boxW / 2;
        else if (ctx.textAlign === 'right') drawX = ox + boxW;
        ctx.fillText(line, drawX, oy + i * lineHeight);
      });
    }
  } else if (layer.type === 'waveform') {
    const w = Math.max(10, props.width);
    const h = Math.max(10, props.height);
    const [ox, oy] = getAnchorOffset(layer.anchor, w, h);
    const px = originX + props.x;
    const py = originY + props.y;

    if (rootIndex !== null && options.collectBounds) {
      options.collectBounds.push({ layerIndex: rootIndex, x: px + ox, y: py + oy, width: w, height: h });
    }

    applyTransform(ctx, px + ox + w / 2, py + oy + h / 2, props);
    const bars = Math.max(4, layer.bars ?? 28);
    const gap = layer.bar_gap ?? 4;
    const barW = Math.max(2, (w - gap * (bars - 1)) / bars);
    const speed = layer.speed ?? 1.2;
    const seed = layer.seed ?? 42;
    ctx.fillStyle = props.color || '#F97316';

    for (let i = 0; i < bars; i++) {
      const phase = (i * 0.65 + seed * 0.13) + timeSec * speed * 4.5;
      const envelope = 0.25 + 0.75 * Math.sin(((i + 0.5) / bars) * Math.PI);
      const amp = (0.28 + 0.72 * Math.abs(Math.sin(phase) * Math.cos(phase * 0.47 + i))) * envelope;
      const barH = Math.max(4, h * amp);
      const bx = -w / 2 + i * (barW + gap);
      const by = -barH / 2;
      drawRoundedRectPath(ctx, bx, by, barW, barH, barW / 2);
      ctx.fill();
    }
  } else if (layer.type === 'particles') {
    const w = Math.max(20, props.width || 400);
    const h = Math.max(20, props.height || 400);
    const px = originX + props.x;
    const py = originY + props.y;

    if (rootIndex !== null && options.collectBounds) {
      options.collectBounds.push({ layerIndex: rootIndex, x: px, y: py, width: w, height: h });
    }

    const count = Math.min(200, Math.max(0, layer.count ?? 40));
    const rand = seededRand(layer.seed ?? 42);
    const palette =
      layer.colors && layer.colors.length > 0
        ? layer.colors
        : [props.color || '#F97316', '#FACC15', '#38BDF8', '#F43F5E'];
    const baseAngle = ((layer.angle ?? -90) * Math.PI) / 180;
    const spreadRad = ((layer.spread ?? 160) * Math.PI) / 180;
    const gravity = layer.gravity ?? 120;
    const speedMult = layer.speed ?? 1.0;
    const baseSize = layer.size ?? 8;
    const localT = Math.max(0, timeSec - (layer.start_sec ?? 0));

    for (let i = 0; i < count; i++) {
      const spawnX = px + rand() * w;
      const spawnY = py + rand() * h * 0.4 + h * 0.3;
      const ang = baseAngle + (rand() - 0.5) * spreadRad;
      const spd = (70 + rand() * 190) * speedMult;
      const vx = Math.cos(ang) * spd;
      const vy = Math.sin(ang) * spd;
      const delay = rand() * 0.4;
      const dt = Math.max(0, localT - delay);

      const x = spawnX + vx * dt;
      const y = spawnY + vy * dt + 0.5 * gravity * dt * dt;
      const size = baseSize * (0.65 + rand() * 0.7);
      const col = palette[i % palette.length];
      const spin = (rand() - 0.5) * 6 * dt;

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(spin);
      ctx.fillStyle = col;
      if (layer.shape === 'rect') {
        ctx.fillRect(-size / 2, -size / 2, size, size);
      } else if (layer.shape === 'confetti') {
        ctx.fillRect(-size * 0.7, -size * 0.3, size * 1.4, size * 0.6);
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, size / 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
  } else if (layer.type === 'svg') {
    const w = Math.max(10, props.width || 200);
    const h = Math.max(10, props.height || 200);
    const px = originX + props.x;
    const py = originY + props.y;
    const [ox, oy] = getAnchorOffset(layer.anchor, w, h);

    if (rootIndex !== null && options.collectBounds) {
      options.collectBounds.push({ layerIndex: rootIndex, x: px + ox, y: py + oy, width: w, height: h });
    }

    const img = getCachedSvg(layer.src, options.onAssetLoad);
    if (img) {
      applyTransform(ctx, px + ox + w / 2, py + oy + h / 2, props);
      ctx.drawImage(img, -w / 2, -h / 2, w, h);
    }
  } else if (layer.type === 'image') {
    const w = Math.max(10, props.width || 400);
    const h = Math.max(10, props.height || 300);
    const px = originX + props.x;
    const py = originY + props.y;
    const [ox, oy] = getAnchorOffset(layer.anchor, w, h);

    if (rootIndex !== null && options.collectBounds) {
      options.collectBounds.push({ layerIndex: rootIndex, x: px + ox, y: py + oy, width: w, height: h });
    }

    applyTransform(ctx, px + ox + w / 2, py + oy + h / 2, props);
    const img = getCachedImage(layer.src, options.onAssetLoad);
    if (layer.radius && layer.radius > 0) {
      drawRoundedRectPath(ctx, -w / 2, -h / 2, w, h, layer.radius);
      ctx.clip();
    }
    if (img && img.naturalWidth > 0) {
      const fit = layer.fit || 'cover';
      if (fit === 'fill') {
        ctx.drawImage(img, -w / 2, -h / 2, w, h);
      } else {
        const ir = img.naturalWidth / img.naturalHeight;
        const br = w / h;
        let dw = w;
        let dh = h;
        if ((fit === 'cover' && ir > br) || (fit === 'contain' && ir < br)) {
          dw = h * ir;
        } else {
          dh = w / ir;
        }
        ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
      }
    } else if (imageCache.get(layer.src) !== 'loading') {
      ctx.fillStyle = '#18181F';
      ctx.fillRect(-w / 2, -h / 2, w, h);
      ctx.strokeStyle = '#333340';
      ctx.lineWidth = 2;
      ctx.strokeRect(-w / 2, -h / 2, w, h);
      ctx.fillStyle = '#71717A';
      ctx.font = '600 18px "Plus Jakarta Sans", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Image Layer', 0, 0);
    }
  } else if (layer.type === 'container') {
    renderContainer(ctx, layer, rootIndex, props, timeSec, durationSecs, finalOpacity, originX, originY, options, layerById, canvasW, canvasH);
  }

  ctx.restore();
}

function renderContainer(
  ctx: CanvasRenderingContext2D,
  layer: ContainerLayer,
  rootIndex: number | null,
  props: ComputedLayerProps,
  timeSec: number,
  durationSecs: number,
  finalOpacity: number,
  originX: number,
  originY: number,
  options: RenderOptions,
  layerById?: Map<string, Layer>,
  canvasW?: number,
  canvasH?: number
) {
  const w = Math.max(0, props.width || 600);
  const h = Math.max(0, props.height || 300);
  const [ox, oy] = getAnchorOffset(layer.anchor, w, h);
  const px = originX + props.x + ox;
  const py = originY + props.y + oy;

  if (rootIndex !== null && options.collectBounds) {
    options.collectBounds.push({ layerIndex: rootIndex, x: px, y: py, width: w, height: h });
  }

  ctx.save();
  ctx.translate(px, py);
  if (props.rotation) {
    ctx.translate(w / 2, h / 2);
    ctx.rotate((props.rotation * Math.PI) / 180);
    ctx.translate(-w / 2, -h / 2);
  }

  const containerBg = layer.background || layer.color;
  if (containerBg || layer.gradient) {
    drawRoundedRectPath(ctx, 0, 0, w, h, props.radius);
    ctx.fillStyle = buildFillStyle(ctx, containerBg || '#18181D', layer.gradient, w, h);
    ctx.fill();
  }
  if (layer.border_width && layer.border_width > 0) {
    drawRoundedRectPath(ctx, 0, 0, w, h, props.radius);
    ctx.strokeStyle = props.border_color || '#334155';
    ctx.lineWidth = layer.border_width;
    ctx.stroke();
  }

  const useFeather = Boolean(layer.clip && layer.clip_feather && layer.clip_feather > 0 && typeof document !== 'undefined');
  let targetCtx = ctx;
  let featherCanvas: HTMLCanvasElement | null = null;
  if (useFeather) {
    featherCanvas = document.createElement('canvas');
    featherCanvas.width = Math.max(1, Math.ceil(w));
    featherCanvas.height = Math.max(1, Math.ceil(h));
    targetCtx = featherCanvas.getContext('2d') || ctx;
  } else if (layer.clip) {
    drawRoundedRectPath(ctx, 0, 0, w, h, props.radius);
    ctx.clip();
  }

  const children = layer.children || [];
  const pad = layer.layout?.padding ?? 0;
  const gap = layer.layout?.gap ?? 16;
  const dir = layer.layout?.direction ?? 'column';
  const childOpacity = layer.cascade_opacity ? finalOpacity : 1;

  // Compute simple flex offset for relative children
  let cursorX = pad;
  let cursorY = pad;
  let seriesCursor = layer.start_sec ?? 0;

  children.forEach((child, idx) => {
    const childTime =
      layer.timeline === 'local'
        ? timeSec - (layer.start_sec ?? 0)
        : layer.timeline === 'series'
          ? timeSec - seriesCursor
          : timeSec - (layer.stagger_secs ?? 0) * idx;

    if (layer.timeline === 'series') {
      seriesCursor += child.duration_secs ?? 2;
    }

    if (child.position === 'absolute') {
      renderLayer(targetCtx, child, null, childTime, durationSecs, childOpacity, 0, 0, options, layerById, canvasW, canvasH);
    } else {
      renderLayer(targetCtx, child, null, childTime, durationSecs, childOpacity, cursorX, cursorY, options, layerById, canvasW, canvasH);
      const cw = 'width' in child && typeof child.width === 'number' ? child.width : 200;
      const ch =
        child.type === 'text'
          ? (child.font_size ?? 48) * 1.4
          : 'height' in child && typeof child.height === 'number'
            ? child.height
            : 60;
      if (dir === 'row') cursorX += cw + gap;
      else cursorY += ch + gap;
    }
  });

  if (useFeather && featherCanvas && targetCtx !== ctx) {
    const feather = layer.clip_feather ?? 0;
    targetCtx.save();
    targetCtx.globalCompositeOperation = 'destination-in';
    targetCtx.filter = `blur(${feather}px)`;
    drawRoundedRectPath(targetCtx, feather, feather, Math.max(1, w - feather * 2), Math.max(1, h - feather * 2), props.radius);
    targetCtx.fillStyle = '#FFFFFF';
    targetCtx.fill();
    targetCtx.restore();
    ctx.drawImage(featherCanvas, 0, 0);
  }

  ctx.restore();
}

/**
 * Generates a multi-frame Contact Sheet canvas (mirrors `rustren snapshot --sheet`)
 */
export function renderContactSheetCanvas(
  scene: RustrenScene,
  cols = 3,
  rows = 2
): HTMLCanvasElement {
  const total = cols * rows;
  const thumbW = 420;
  const thumbH = Math.round((thumbW * scene.canvas.height) / scene.canvas.width);
  const pad = 16;
  const headerH = 44;

  const sheet = document.createElement('canvas');
  sheet.width = cols * thumbW + (cols + 1) * pad;
  sheet.height = headerH + rows * thumbH + (rows + 1) * pad;
  const sctx = sheet.getContext('2d')!;

  sctx.fillStyle = '#09090D';
  sctx.fillRect(0, 0, sheet.width, sheet.height);

  sctx.fillStyle = '#F4F4F6';
  sctx.font = '700 15px "Plus Jakarta Sans", sans-serif';
  sctx.fillText(
    `RUSTREN CONTACT SHEET · ${scene.canvas.width}x${scene.canvas.height} @ ${scene.canvas.fps}fps · ${scene.canvas.duration_secs.toFixed(1)}s`,
    pad,
    28
  );

  const frameCanvas = document.createElement('canvas');
  frameCanvas.width = scene.canvas.width;
  frameCanvas.height = scene.canvas.height;
  const fctx = frameCanvas.getContext('2d')!;

  for (let i = 0; i < total; i++) {
    const t = total === 1 ? 0 : (i / (total - 1)) * Math.max(0.01, scene.canvas.duration_secs - 0.05);
    renderRustrenFrame(fctx, scene, t);

    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = pad + col * (thumbW + pad);
    const y = headerH + pad + row * (thumbH + pad);

    sctx.drawImage(frameCanvas, x, y, thumbW, thumbH);
    sctx.strokeStyle = 'rgba(255,255,255,0.12)';
    sctx.lineWidth = 1;
    sctx.strokeRect(x, y, thumbW, thumbH);

    // Timestamp label
    sctx.fillStyle = 'rgba(9, 9, 13, 0.82)';
    sctx.fillRect(x + 8, y + thumbH - 28, 72, 20);
    sctx.fillStyle = '#F97316';
    sctx.font = '600 11px "JetBrains Mono", monospace';
    sctx.fillText(`t=${t.toFixed(2)}s`, x + 14, y + thumbH - 14);
  }

  return sheet;
}
