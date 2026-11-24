import {
  clamp,
  evalDynamicText,
  evaluateLayerAtTime,
  type ComputedLayerProps,
} from './animation';
import type {
  Anchor,
  BlendMode,
  ContainerLayer,
  Layer,
  LinearGradient,
  RustrenScene,
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
  layers.forEach((layer, idx) => {
    renderLayer(ctx, layer, idx, timeSec, duration_secs, 1, 0, 0, options);
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
  if (props.scale !== 1) {
    ctx.scale(props.scale, props.scale);
  }
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
  options: RenderOptions
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

    const pivotX = layer.anchor === 'center' ? px : px + w / 2;
    const pivotY = layer.anchor === 'center' ? py : py + h / 2;
    applyTransform(ctx, pivotX, pivotY, props);
    const drawX = layer.anchor === 'center' ? -w / 2 : ox - w / 2;
    const drawY = layer.anchor === 'center' ? -h / 2 : oy - h / 2;

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
    const weight = layer.font_weight === 'bold' ? '700' : '500';
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

    ctx.fillStyle = buildFillStyle(ctx, props.color, layer.gradient, boxW, boxH);
    const align = layer.text_align || (layer.anchor === 'center' ? 'center' : 'left');
    ctx.textAlign = align === 'start' ? 'left' : align === 'end' ? 'right' : align;

    lines.forEach((line, i) => {
      let drawX = ox;
      if (ctx.textAlign === 'center') drawX = ox + boxW / 2;
      else if (ctx.textAlign === 'right') drawX = ox + boxW;
      ctx.fillText(line, drawX, oy + i * lineHeight);
    });
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
    } else {
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
    renderContainer(ctx, layer, rootIndex, props, timeSec, durationSecs, finalOpacity, originX, originY, options);
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
  options: RenderOptions
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

  if (layer.color || layer.gradient) {
    drawRoundedRectPath(ctx, 0, 0, w, h, props.radius);
    ctx.fillStyle = buildFillStyle(ctx, layer.color || '#18181D', layer.gradient, w, h);
    ctx.fill();
  }
  if (layer.border_width && layer.border_width > 0) {
    drawRoundedRectPath(ctx, 0, 0, w, h, props.radius);
    ctx.strokeStyle = props.border_color || '#334155';
    ctx.lineWidth = layer.border_width;
    ctx.stroke();
  }

  if (layer.clip) {
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
      renderLayer(ctx, child, null, childTime, durationSecs, childOpacity, 0, 0, options);
    } else {
      renderLayer(ctx, child, null, childTime, durationSecs, childOpacity, cursorX, cursorY, options);
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
