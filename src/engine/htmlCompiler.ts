import type { Animation, AnimProperty, Easing, Layer, RustrenScene } from './types';

function parseAttrMap(attrText: string): Record<string, string> {
  const map: Record<string, string> = {};
  const regex = /([a-zA-Z0-9_-]+)\s*=\s*"([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(attrText)) !== null) {
    map[match[1].toLowerCase()] = match[2];
  }
  return map;
}

function numAttr(attrs: Record<string, string>, key: string): number | undefined {
  const val = attrs[key];
  if (val === undefined || val === '') return undefined;
  const parsed = Number(val);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Lightweight declarative HTML scene compiler for Rustren `.html` scene files.
 * Works both in Node (for unit tests) and in browser without DOMParser dependencies.
 */
export function compileRustrenHtml(html: string): RustrenScene {
  const canvasMatch = html.match(/<canvas\b([^>]*)\/?>/i);
  const canvasAttrs = canvasMatch ? parseAttrMap(canvasMatch[1]) : {};

  const scene: RustrenScene = {
    schema_version: '1.1',
    canvas: {
      width: numAttr(canvasAttrs, 'width') ?? 1280,
      height: numAttr(canvasAttrs, 'height') ?? 720,
      fps: numAttr(canvasAttrs, 'fps') ?? 30,
      duration_secs: numAttr(canvasAttrs, 'duration') ?? numAttr(canvasAttrs, 'duration-secs') ?? 5,
      background: canvasAttrs['background'] || canvasAttrs['bg'] || '#09090D',
    },
    layers: [],
  };

  const layerTagRe = /<(rect|circle|text|waveform|particles|image)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/\1>)/gi;
  let match: RegExpExecArray | null;
  while ((match = layerTagRe.exec(html)) !== null) {
    const tag = match[1].toLowerCase();
    const attrs = parseAttrMap(match[2]);
    const inner = match[3] || '';

    const animations: Animation[] = [];
    const animRe = /<animate\b([^>]*?)\/?>/gi;
    let am: RegExpExecArray | null;
    while ((am = animRe.exec(inner)) !== null) {
      const a = parseAttrMap(am[1]);
      if (!a['property'] && !a['prop']) continue;
      const property = (a['property'] || a['prop']) as AnimProperty;
      const fromRaw = a['from'];
      const toRaw = a['to'];
      animations.push({
        property,
        from: fromRaw !== undefined && !isNaN(Number(fromRaw)) ? Number(fromRaw) : fromRaw,
        to: toRaw !== undefined && !isNaN(Number(toRaw)) ? Number(toRaw) : toRaw,
        start_sec: numAttr(a, 'start') ?? numAttr(a, 'start-sec') ?? 0,
        end_sec: numAttr(a, 'end') ?? numAttr(a, 'end-sec') ?? 1,
        easing: (a['easing'] as Easing) || 'ease_out',
      });
    }

    const base = {
      name: attrs['name'] || attrs['id'] || `${tag}_${scene.layers.length + 1}`,
      start_sec: numAttr(attrs, 'start') ?? numAttr(attrs, 'start-sec'),
      end_sec: numAttr(attrs, 'end') ?? numAttr(attrs, 'end-sec'),
      opacity: numAttr(attrs, 'opacity'),
      anchor: attrs['anchor'] as Layer['anchor'],
      ...(animations.length > 0 ? { animations } : {}),
    };

    if (tag === 'rect') {
      scene.layers.push({
        ...base,
        type: 'rect',
        x: numAttr(attrs, 'x') ?? 0,
        y: numAttr(attrs, 'y') ?? 0,
        width: numAttr(attrs, 'width') ?? 200,
        height: numAttr(attrs, 'height') ?? 100,
        radius: numAttr(attrs, 'radius') ?? 0,
        color: attrs['color'] || attrs['fill'] || '#F97316',
        border_color: attrs['border-color'],
        border_width: numAttr(attrs, 'border-width'),
      });
    } else if (tag === 'circle') {
      scene.layers.push({
        ...base,
        type: 'circle',
        cx: numAttr(attrs, 'cx') ?? numAttr(attrs, 'x') ?? 640,
        cy: numAttr(attrs, 'cy') ?? numAttr(attrs, 'y') ?? 360,
        r: numAttr(attrs, 'r') ?? 80,
        color: attrs['color'] || attrs['fill'] || '#38BDF8',
      });
    } else if (tag === 'text') {
      const strippedText = inner.replace(/<animate\b[^>]*\/?>/gi, '').trim();
      scene.layers.push({
        ...base,
        type: 'text',
        x: numAttr(attrs, 'x') ?? 100,
        y: numAttr(attrs, 'y') ?? 100,
        content: attrs['content'] || strippedText || 'Text',
        font_size: numAttr(attrs, 'font-size') ?? 48,
        font_weight: attrs['font-weight'] === 'bold' ? 'bold' : 'normal',
        color: attrs['color'] || '#FFFFFF',
        max_width: numAttr(attrs, 'max-width'),
      });
    } else if (tag === 'waveform') {
      scene.layers.push({
        ...base,
        type: 'waveform',
        x: numAttr(attrs, 'x') ?? 100,
        y: numAttr(attrs, 'y') ?? 500,
        width: numAttr(attrs, 'width') ?? 400,
        height: numAttr(attrs, 'height') ?? 80,
        bars: numAttr(attrs, 'bars') ?? 28,
        color: attrs['color'] || '#F97316',
      });
    } else if (tag === 'particles') {
      scene.layers.push({
        ...base,
        type: 'particles',
        x: numAttr(attrs, 'x') ?? 0,
        y: numAttr(attrs, 'y') ?? 0,
        width: numAttr(attrs, 'width') ?? scene.canvas.width,
        height: numAttr(attrs, 'height') ?? scene.canvas.height,
        count: numAttr(attrs, 'count') ?? 40,
        color: attrs['color'] || '#F97316',
      });
    } else if (tag === 'image') {
      scene.layers.push({
        ...base,
        type: 'image',
        x: numAttr(attrs, 'x') ?? 0,
        y: numAttr(attrs, 'y') ?? 0,
        width: numAttr(attrs, 'width') ?? 400,
        height: numAttr(attrs, 'height') ?? 300,
        src: attrs['src'] || '',
      });
    }
  }

  return scene;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function serializeSceneToHtml(scene: RustrenScene): string {
  const c = scene.canvas;
  const lines: string[] = [
    `<scene schema-version="${scene.schema_version ?? '1.1'}">`,
    `  <canvas width="${c.width}" height="${c.height}" fps="${c.fps}" duration="${c.duration_secs}" background="${c.background ?? '#09090D'}" />`,
  ];

  for (const layer of scene.layers) {
    const attrs: string[] = [];
    if (layer.name) attrs.push(`name="${escapeXml(layer.name)}"`);
    if (layer.start_sec !== undefined) attrs.push(`start="${layer.start_sec}"`);
    if (layer.end_sec !== undefined) attrs.push(`end="${layer.end_sec}"`);
    if (layer.opacity !== undefined) attrs.push(`opacity="${layer.opacity}"`);
    if (layer.anchor) attrs.push(`anchor="${layer.anchor}"`);

    if (layer.type === 'rect') {
      attrs.push(`x="${layer.x ?? 0}"`, `y="${layer.y ?? 0}"`, `width="${layer.width}"`, `height="${layer.height}"`);
      if (layer.radius) attrs.push(`radius="${layer.radius}"`);
      attrs.push(`color="${layer.color}"`);
    } else if (layer.type === 'circle') {
      attrs.push(`cx="${layer.cx ?? 0}"`, `cy="${layer.cy ?? 0}"`, `r="${layer.r}"`, `color="${layer.color}"`);
    } else if (layer.type === 'text') {
      attrs.push(`x="${layer.x ?? 0}"`, `y="${layer.y ?? 0}"`, `font-size="${layer.font_size ?? 48}"`);
      if (layer.font_weight === 'bold') attrs.push(`font-weight="bold"`);
      attrs.push(`color="${layer.color ?? '#FFFFFF'}"`);
      if (layer.max_width) attrs.push(`max-width="${layer.max_width}"`);
    } else if (layer.type === 'waveform') {
      attrs.push(`x="${layer.x ?? 0}"`, `y="${layer.y ?? 0}"`, `width="${layer.width}"`, `height="${layer.height}"`, `bars="${layer.bars ?? 24}"`, `color="${layer.color ?? '#F97316'}"`);
    } else if (layer.type === 'particles') {
      attrs.push(`x="${layer.x ?? 0}"`, `y="${layer.y ?? 0}"`, `width="${layer.width ?? 400}"`, `height="${layer.height ?? 400}"`, `count="${layer.count ?? 40}"`, `color="${layer.color ?? '#F97316'}"`);
    } else if (layer.type === 'image') {
      attrs.push(`x="${layer.x ?? 0}"`, `y="${layer.y ?? 0}"`, `width="${layer.width ?? 400}"`, `height="${layer.height ?? 300}"`, `src="${escapeXml(layer.src)}"`);
    }

    const anims = layer.animations ?? [];
    const textContent = layer.type === 'text' ? escapeXml(layer.content ?? '') : '';

    if (anims.length === 0 && !textContent) {
      lines.push(`  <${layer.type} ${attrs.join(' ')} />`);
    } else {
      lines.push(`  <${layer.type} ${attrs.join(' ')}>`);
      if (textContent) lines.push(`    ${textContent}`);
      for (const a of anims) {
        const aAttrs = [
          `property="${a.property}"`,
          a.from !== undefined ? `from="${a.from}"` : '',
          a.to !== undefined ? `to="${a.to}"` : '',
          `start="${a.start_sec ?? 0}"`,
          `end="${a.end_sec ?? 1}"`,
          `easing="${a.easing ?? 'ease_out'}"`,
        ].filter(Boolean);
        lines.push(`    <animate ${aAttrs.join(' ')} />`);
      }
      lines.push(`  </${layer.type}>`);
    }
  }

  lines.push(`</scene>`);
  return lines.join('\n');
}
