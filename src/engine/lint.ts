import { parseHexColor } from './animation';
import type { Layer, LintWarning, RustrenScene } from './types';

function relativeLuminance(hex: string): number {
  const { r, g, b } = parseHexColor(hex);
  const toLinear = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

export function contrastRatio(fgHex: string, bgHex: string): number {
  const l1 = relativeLuminance(fgHex);
  const l2 = relativeLuminance(bgHex);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Profile-aware scene linter ported from rustren/src/lint.rs
 */
export function lintScene(scene: RustrenScene): LintWarning[] {
  const warnings: LintWarning[] = [];
  if (!scene || !scene.canvas) {
    warnings.push({
      code: 'schema',
      path: 'canvas',
      message: 'Scene is missing a valid canvas object.',
      fix: 'Add canvas with width, height, fps, and duration_secs.',
    });
    return warnings;
  }

  const canvasW = scene.canvas.width || 1280;
  const canvasH = scene.canvas.height || 720;
  const rawDuration = scene.canvas.duration_secs;
  if (typeof rawDuration !== 'number' || rawDuration <= 0) {
    warnings.push({
      code: 'schema',
      path: 'canvas.duration_secs',
      message: `canvas.duration_secs must be greater than 0 (got ${rawDuration}).`,
      fix: 'Set canvas.duration_secs to at least 0.5s',
    });
  }
  const duration = rawDuration > 0 ? rawDuration : 5;
  const bgHex = scene.canvas.background || '#000000';
  const isPortrait = canvasH > canvasW;
  const minFontPx = isPortrait ? 26 : 14;
  const profileLabel = isPortrait ? '9:16' : 'landscape/square';

  const walk = (layers: Layer[], inContainer: boolean, prefix: string, parentBg: string) => {
    layers.forEach((layer, idx) => {
      const path = `${prefix}[${idx}]`;

      if (layer.end_sec !== undefined && layer.end_sec > duration + 0.001) {
        warnings.push({
          code: 'end_sec',
          path,
          message: `Layer "${layer.name || layer.type}" has end_sec (${layer.end_sec}s) > canvas.duration_secs (${duration}s).`,
          fix: `Clamp end_sec to <= ${duration}s`,
        });
      }

      if (layer.type === 'text') {
        const fs = layer.font_size ?? 48;
        if (fs < minFontPx) {
          warnings.push({
            code: 'font_size',
            path,
            message: `Text "${layer.name || layer.content?.slice(0, 18) || 'text'}" has font_size ${fs}px < ${minFontPx}px (${profileLabel} profile).`,
            fix: `Raise font_size to at least ${minFontPx}px`,
          });
        }
        if (inContainer && !layer.max_width) {
          warnings.push({
            code: 'missing_max_width',
            path,
            message: `Text "${layer.name || path}" inside a container is missing max_width.`,
            fix: 'Add max_width equal to container width minus padding',
          });
        }
        const fg = layer.color ?? '#FFFFFF';
        // Check if a solid rect layer below this text (at root or inside same container) overlaps its anchor point
        let effectiveBg = parentBg;
        if (layer.x !== undefined && layer.y !== undefined) {
          for (let j = idx - 1; j >= 0; j--) {
            const below = layers[j];
            if (below.type === 'rect' && below.color && (below.opacity ?? 1) >= 0.7 && !below.hidden) {
              const rx = below.x ?? 0;
              const ry = below.y ?? 0;
              const rw = below.width ?? 0;
              const rh = below.height ?? 0;
              const isC = below.anchor === 'center';
              const rLeft = isC ? rx - rw / 2 : rx;
              const rTop = isC ? ry - rh / 2 : ry;
              if (layer.x >= rLeft && layer.x <= rLeft + rw && layer.y >= rTop && layer.y <= rTop + rh) {
                effectiveBg = below.color;
                break;
              }
            }
          }
        }
        const ratio = contrastRatio(fg, effectiveBg);
        if (ratio < 3.0) {
          warnings.push({
            code: 'low_contrast',
            path,
            message: `Text "${layer.name || path}" has low contrast (${ratio.toFixed(1)}:1 against ${effectiveBg}).`,
            fix: 'Use a higher contrast text color or background',
          });
        }
      }

      // Bounds check for root layers
      if (!inContainer) {
        if (layer.type === 'rect' || layer.type === 'container' || layer.type === 'waveform') {
          const x = layer.x ?? 0;
          const y = layer.y ?? 0;
          const w = layer.width ?? 100;
          const h = layer.height ?? 100;
          const isCenter = layer.anchor === 'center';
          const left = isCenter ? x - w / 2 : x;
          const top = isCenter ? y - h / 2 : y;
          if (left + w < 0 || left > canvasW || top + h < 0 || top > canvasH) {
            warnings.push({
              code: 'out_of_canvas',
              path,
              message: `Layer "${layer.name || layer.type}" lies completely outside the ${canvasW}x${canvasH} canvas.`,
              fix: 'Move or resize the layer so it intersects the canvas',
            });
          }
        } else if (layer.type === 'circle') {
          const cx = layer.cx ?? 0;
          const cy = layer.cy ?? 0;
          const r = layer.r ?? 0;
          if (cx + r < 0 || cx - r > canvasW || cy + r < 0 || cy - r > canvasH) {
            warnings.push({
              code: 'out_of_canvas',
              path,
              message: `Circle "${layer.name || path}" lies outside the ${canvasW}x${canvasH} canvas.`,
              fix: 'Adjust cx/cy so the circle intersects the canvas',
            });
          }
        }
      }

      if (layer.type === 'container' && Array.isArray(layer.children)) {
        const nextBg = layer.background || layer.color || parentBg;
        walk(layer.children, true, `${path}.children`, nextBg);
      }
    });
  };

  walk(scene.layers || [], false, 'layers', bgHex);
  return warnings;
}

/**
 * Automatically repairs common Rustren lint issues (font_size, end_sec, missing_max_width)
 */
export function autoFixScene(scene: RustrenScene): RustrenScene {
  const cloned: RustrenScene = JSON.parse(JSON.stringify(scene));
  if (!cloned.canvas.duration_secs || cloned.canvas.duration_secs <= 0) {
    cloned.canvas.duration_secs = 5;
  }
  const duration = cloned.canvas.duration_secs;
  const isPortrait = cloned.canvas.height > cloned.canvas.width;
  const minFontPx = isPortrait ? 26 : 14;

  const fixList = (layers: Layer[], containerWidth?: number) => {
    for (const layer of layers) {
      if (layer.end_sec !== undefined && layer.end_sec > duration) {
        layer.end_sec = duration;
      }
      if (layer.type === 'text') {
        if ((layer.font_size ?? 48) < minFontPx) {
          layer.font_size = minFontPx;
        }
        if (containerWidth && !layer.max_width) {
          layer.max_width = Math.max(120, containerWidth - 64);
        }
      }
      if (layer.type === 'container' && Array.isArray(layer.children)) {
        const pad = (layer.layout?.padding ?? 0) * 2;
        fixList(layer.children, Math.max(160, (layer.width ?? cloned.canvas.width) - pad));
      }
    }
  };

  fixList(cloned.layers);
  return cloned;
}

/**
 * Validates and normalizes untrusted scene JSON (from localStorage, file import, or JSON editor)
 * so corrupt payloads can never trigger a React render crash-loop.
 */
export function validateAndNormalizeScene(raw: unknown): RustrenScene | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (!obj.canvas || typeof obj.canvas !== 'object' || !Array.isArray(obj.layers)) {
    return null;
  }
  const c = obj.canvas as Record<string, unknown>;
  const width = typeof c.width === 'number' && Number.isFinite(c.width) && c.width > 0 ? Math.round(c.width) : 1280;
  const height = typeof c.height === 'number' && Number.isFinite(c.height) && c.height > 0 ? Math.round(c.height) : 720;
  const fps = typeof c.fps === 'number' && Number.isFinite(c.fps) && c.fps > 0 ? Math.min(120, Math.round(c.fps)) : 30;
  const duration_secs =
    typeof c.duration_secs === 'number' && Number.isFinite(c.duration_secs) && c.duration_secs >= 0
      ? c.duration_secs
      : 5;
  const background = typeof c.background === 'string' ? c.background : '#09090D';

  const sanitizeLayers = (arr: unknown[]): Layer[] =>
    arr
      .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && typeof (item as Record<string, unknown>).type === 'string'))
      .map((item) => {
        const copy = { ...item };
        if (copy.type === 'container' && Array.isArray(copy.children)) {
          copy.children = sanitizeLayers(copy.children);
        }
        return copy as unknown as Layer;
      });

  return {
    ...(obj as unknown as RustrenScene),
    schema_version: typeof obj.schema_version === 'string' ? obj.schema_version : '1.1',
    canvas: { width, height, fps, duration_secs, background },
    layers: sanitizeLayers(obj.layers),
  };
}
