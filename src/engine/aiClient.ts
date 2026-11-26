import type { AiProviderId, AiReferenceImage, RustrenScene } from './types';
import { formatVideoAnalysisForPrompt, type VideoForensics } from './videoAnalyzer';

const RUSTREN_AI_SYSTEM_PROMPT = `You are Rustren Studio AI Director — an expert motion designer who writes valid Rustren v1.1 declarative JSON video scenes.

Respond ONLY with a valid JSON object (no markdown prose outside JSON).

For SMALL / TARGETED edits in Edit Scene mode (e.g., changing duration, colors, text, position, removing/updating 1-3 layers), prefer the FAST PATCH format (much faster, fewer tokens):
{
  "summary": "Brief concise explanation (1-2 sentences, matching user's language).",
  "patch": {
    "canvas": { "duration_secs": 2.0 },
    "update_layers": [
      { "index": 0, "changes": { "color": "#F97316", "font_size": 72 } }
    ],
    "remove_layers": [2],
    "add_layers": [ ... ]
  }
}
(All fields inside "patch" are optional; omit unchanged fields.)

For NEW scenes or MAJOR layout redesigns (e.g., converting 16:9 to 9:16), return the FULL scene format:
{
  "summary": "Brief concise explanation (1-2 sentences, matching user's language) of what was created or changed.",
  "scene": {
    "schema_version": "1.1",
    "canvas": {
      "width": 1280,
      "height": 720,
      "fps": 30,
      "duration_secs": 5.0,
      "background": "#08090E"
    },
    "layers": [ ... ]
  }
}

Supported Rustren v1.1 (v0.5.1) layer types & fields:
Common BaseLayer fields on all layers: id?, name?, anchor?, pivot_x? (0..1, default 0.5), pivot_y? (0..1, default 0.5), opacity?, scale?, scale_x?, scale_y?, rotation?, skew_x?, skew_y?, blur?, blend_mode? ("normal"|"multiply"|"screen"|"overlay"|"darken"|"lighten"|"color_dodge"|"color_burn"|"hard_light"|"soft_light"|"difference"|"exclusion"), shadow?, echo?: { count?, step_sec?, decay? }, wave_warp?: { amplitude?, wavelength?, speed?, phase?, axis?: "x"|"y"|"stretch_x"|"stretch_y" }, track_matte?: "alpha"|"alpha_inverted"|"luma"|"luma_inverted", matte_layer?: { type: "rect"|"circle"|"text", ... }, start_sec?, end_sec?, animations?
1. "rect": { type: "rect", name, x, y, width, height, radius?, color, gradient?, border_color?, border_width?, ... }
2. "circle": { type: "circle", name, cx, cy, r, color, border_color?, border_width?, ... }
3. "text": { type: "text", name, x, y, content?, dynamic?, font_size, font_weight?: "thin"|"light"|"normal"|"medium"|"semibold"|"bold"|"extrabold"|"black"|100..900, font_family?, text_align?: "left"|"center"|"right", color, max_width?, line_height?, text_animator?: { mode?: "char"|"word", start_sec?, stagger_secs?, duration_secs?, x_offset?, y_offset?, opacity_from?, scale_from?, easing? }, ... }
   - dynamic modes:
     - { mode: "typewriter", text: "...", start_sec: 0.2, end_sec: 1.2, cursor: "_" }
     - { mode: "counter", from: 0, to: 100, decimals?: 1, prefix?: "", suffix?: "%", start_sec: 0.5, end_sec: 2.0, easing?: "ease_out_expo" }
     - { mode: "timecode", format?: "mm:ss.cc" }
4. "waveform": { type: "waveform", name, x, y, width, height, bars?, bar_gap?, color, speed?, seed?, ... }
5. "particles": { type: "particles", name, x, y, width, height, count?, seed?, speed?, gravity?, spread?, angle?, size?, shape?: "circle"|"rect"|"confetti", colors?: string[], ... }
6. "svg": { type: "svg", name, x, y, width, height, src: "<svg ...>...</svg>", ... }
7. "image": { type: "image", name, x, y, width, height, src: "<https:// URL>", fit?: "cover"|"contain"|"fill", radius?, ... }
8. "video": { type: "video", name, x, y, width, height, src: "<https:// MP4 URL>", fit?: "cover"|"contain"|"fill", loop?: true, playback_rate?: 1.0, ... }
9. "lottie": { type: "lottie", name, x, y, width, height, src: "<inline Bodymovin JSON string or https:// URL>", loop_animation?: true, speed?: 1.0, ... }
10. "container": { type: "container", name, x, y, width, height, background?, radius?, clip?, clip_feather?, cascade_opacity?, layout?: { direction?: "row"|"column", gap?, padding? }, children: [...], ... }

Animations array item format:
{ "property": "x"|"y"|"width"|"height"|"opacity"|"scale"|"scale_x"|"scale_y"|"rotation"|"skew_x"|"r"|"radius"|"color"|"border_color", "from"?: <num|hex>, "to"?: <num|hex>, "expr"?: "<math expr with t>", "start_sec"?: <num>, "end_sec"?: <num>, "easing"?: "linear"|"ease_in"|"ease_out"|"ease_in_out"|"ease_out_expo"|"ease_out_back"|"ease_out_bounce"|"spring", "repeat"?: number|"infinite", "yoyo"?: boolean }

Reference images (moodboard):
When one or more reference images are attached to the user message, read them FIRST and treat them as the
art direction for the scene. Extract and reuse, in this order:
1. Color palette: the dominant, secondary and accent colors as exact hex values (background, surfaces,
   text, accents). Do not invent new hues.
2. Typography hierarchy: relative scale steps (display / headline / body / caption), weight contrast and
   letter-spacing rhythm, mapped onto font_size, font_weight and line_height.
3. Composition & whitespace: grid, margins, alignment, optical balance and how much empty space the
   reference leaves between elements - mirror it in coordinates and padding.
4. Visual rhythm: repetition, scale steps, density and the implied motion tempo (how often things change),
   mapped onto layer timing (start_sec / end_sec), stagger and animation easing.
Report in "summary" which of these four you took from the references. Keep the reference's language and
copy out of it: references define style only, the user's request defines the words.

Reference video forensics:
When the user message contains a "REFERENCE VIDEO FORENSICS" block, it was produced locally in the
browser from a video the user selected. Attached images named *-keyframe-*.jpg are frames extracted
from that video, in timeline order. Rebuild the video's structure and rhythm:
1. Keep the same shot count, approximate shot durations and total canvas duration.
2. Map every shot to layer start_sec / end_sec and match its luma (dark / mid / bright) and motion
   (static / moderate / dynamic) using scale, position and timing animations.
3. Use the reported dominant palette as the scene palette (background, surfaces, text, accents).
4. Treat the keyframes as art direction for composition, whitespace and typography - do not copy
   their subject or words.
Report in "summary" how the shot structure, pacing and palette were reproduced.

Authoring quality rules:
- Always ensure high text contrast (>= 4.5:1) against background/cards.
- Keep all coordinates inside canvas bounds.
- For centered text, always set anchor: "center", text_align: "center", x: canvas.width / 2, and max_width (e.g., Math.round(canvas.width * 0.85)) so text stays optically centered.
- Inside a "container", any child positioned with explicit x/y coordinates MUST include "position": "absolute" so Studio preview and Rustren Taffy layout match 100%.
- Return ONLY raw valid JSON without markdown code fences.`;

export interface ScenePatch {
  canvas?: Partial<RustrenScene['canvas']>;
  update_layers?: Array<{ index?: number; name?: string; changes: Record<string, unknown> }>;
  remove_layers?: number[];
  add_layers?: RustrenScene['layers'];
}

export function applyScenePatch(baseScene: RustrenScene, patch: ScenePatch): RustrenScene {
  const next: RustrenScene = JSON.parse(JSON.stringify(baseScene));
  if (patch.canvas && typeof patch.canvas === 'object') {
    next.canvas = { ...next.canvas, ...patch.canvas };
  }
  if (Array.isArray(patch.update_layers)) {
    for (const upd of patch.update_layers) {
      if (!upd || !upd.changes || typeof upd.changes !== 'object') continue;
      let idx = typeof upd.index === 'number' ? upd.index : -1;
      if (idx < 0 && upd.name) {
        idx = next.layers.findIndex((l) => l.name === upd.name || l.id === upd.name);
      }
      if (idx >= 0 && idx < next.layers.length) {
        next.layers[idx] = { ...next.layers[idx], ...upd.changes } as RustrenScene['layers'][number];
      }
    }
  }
  if (Array.isArray(patch.remove_layers) && patch.remove_layers.length > 0) {
    const toRemove = new Set(patch.remove_layers);
    next.layers = next.layers.filter((_, i) => !toRemove.has(i));
  }
  if (Array.isArray(patch.add_layers) && patch.add_layers.length > 0) {
    next.layers.push(...patch.add_layers);
  }
  // Auto-clamp layer end_sec if canvas duration was shortened
  if (patch.canvas?.duration_secs !== undefined) {
    const dur = next.canvas.duration_secs;
    for (const layer of next.layers) {
      if (layer.end_sec !== undefined && layer.end_sec > dur) {
        layer.end_sec = dur;
      }
    }
  }
  return next;
}

function extractJsonObject(
  raw: string,
  currentScene?: RustrenScene
): { summary?: string; scene: RustrenScene } {
  // Strip <think>...</think> reasoning blocks emitted by reasoning models (e.g. Nemotron/DeepSeek)
  const cleaned = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();

  const tryParse = (s: string) => {
    const parseCandidate = (text: string) => {
      try {
        return JSON.parse(text);
      } catch {
        // Fallback: strip trailing commas before } or ]
        const noTrailingCommas = text.replace(/,\s*([}\]])/g, '$1');
        return JSON.parse(noTrailingCommas);
      }
    };
    const parsed = parseCandidate(s);
    if (parsed && parsed.patch && currentScene) {
      return {
        summary: parsed.summary || 'Scene updated by AI.',
        scene: applyScenePatch(currentScene, parsed.patch as ScenePatch),
      };
    }
    if (parsed && parsed.scene && parsed.scene.canvas && Array.isArray(parsed.scene.layers)) {
      return parsed;
    }
    if (parsed && parsed.canvas && Array.isArray(parsed.layers)) {
      return { summary: 'Scene created successfully.', scene: parsed };
    }
    return null;
  };

  // 1. Try fenced ```json ... ``` block first if present
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    try {
      const fromFence = tryParse(fenceMatch[1].trim());
      if (fromFence) return fromFence;
    } catch {
      // continue to direct/slice fallbacks
    }
  }

  // 2. Direct parse
  try {
    const direct = tryParse(cleaned);
    if (direct) return direct;
  } catch {
    // fallback to slicing outermost braces
  }

  // 3. Slice outermost { ... }
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const sliced = tryParse(cleaned.slice(start, end + 1));
    if (sliced) return sliced;
  }
  throw new Error('AI response is not a valid Rustren scene JSON.');
}

export async function runAiDirectorCommand(params: {
  provider: AiProviderId;
  apiKey: string;
  model: string;
  baseUrl?: string;
  useCorsProxy?: boolean;
  prompt: string;
  mode: 'edit' | 'new';
  currentScene?: RustrenScene;
  /** 1-3 moodboard images sent to the provider as multimodal parts. */
  references?: AiReferenceImage[];
  /** Locally extracted video forensics, appended to the prompt as a structured block. */
  videoAnalysis?: VideoForensics;
}): Promise<{ summary: string; scene: RustrenScene }> {
  const { provider, apiKey, model, baseUrl, useCorsProxy, prompt, mode, currentScene } = params;
  const references = params.references ?? [];
  const referenceNote =
    references.length > 0
      ? `\n\nAttached image(s) (${references.length}): ${references
          .map((r) => r.name)
          .join(', ')}. If an image is named "current-stage-*" or "stage-*", it is a live visual render of the CURRENT scene — inspect it carefully for overlapping elements, elements overflowing cards/margins, alignment, and contrast, and fix those visual issues. Otherwise treat attached images as moodboard style references (palette, typography, whitespace, rhythm).`
      : '';
  const videoNote = params.videoAnalysis
    ? `\n\n${formatVideoAnalysisForPrompt(params.videoAnalysis)}\nThe attached keyframes were extracted from this reference video and are listed in timeline order.`
    : '';
  const userContent =
    (mode === 'edit' && currentScene
      ? `Edit the existing Rustren scene below according to the user's request.\n\nUser request:\n${prompt}\n\nCurrent scene JSON:\n${JSON.stringify(currentScene)}`
      : `Create a brand new Rustren v1.1 scene for the user's request:\n${prompt}`) +
    referenceNote +
    videoNote;

  if (provider === 'studio_gemini') {
    throw new Error(
      'Studio Built-in mode is disabled in static hosting. Select Google Gemini (BYOK), OpenAI, OpenRouter, or Anthropic and enter your API key.'
    );
  }

  let rawText = '';

  if (provider === 'gemini_byok') {
    const cleanModel = (model || 'gemini-2.5-flash').replace(/^models\//, '');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cleanModel)}:generateContent`;
    // Gemini takes every modality in `contents[0].parts`: text first, then one
    // `inline_data` block per reference image.
    const parts: Array<Record<string, unknown>> = [{ text: userContent }];
    for (const ref of references) {
      parts.push({ inline_data: { mime_type: ref.mimeType, data: ref.base64 } });
    }
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey.trim(),
      },
      signal: AbortSignal.timeout(180_000),
      body: JSON.stringify({
        system_instruction: { parts: [{ text: RUSTREN_AI_SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(data?.error?.message || `Gemini API error (${resp.status})`);
    }
    const respParts = (data?.candidates?.[0]?.content?.parts ?? []) as Array<{ text?: string; thought?: boolean }>;
    rawText = respParts.filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('') || '';
  } else if (provider === 'anthropic') {
    // Anthropic needs an explicit typed block per image with base64 source.
    const content: Array<Record<string, unknown>> = [{ type: 'text', text: userContent }];
    for (const ref of references) {
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: ref.mimeType, data: ref.base64 },
      });
    }
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey.trim(),
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: model || 'claude-sonnet-4-20250514',
        max_tokens: 8192,
        system: RUSTREN_AI_SYSTEM_PROMPT,
        messages: [{ role: 'user', content }],
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(data?.error?.message || `Anthropic API error (${resp.status})`);
    }
    rawText = data?.content?.[0]?.text || '';
  } else {
    // OpenAI / OpenRouter / Custom OpenAI-compatible
    let endpoint = 'https://api.openai.com/v1/chat/completions';
    if (provider === 'openrouter') {
      endpoint = 'https://openrouter.ai/api/v1/chat/completions';
    } else if (provider === 'custom') {
      const cleanBase = (baseUrl || 'http://localhost:11434/v1').replace(/\/+$/, '');
      endpoint = cleanBase.endsWith('/chat/completions') ? cleanBase : `${cleanBase}/chat/completions`;
    }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey.trim()) {
      headers['Authorization'] = `Bearer ${apiKey.trim()}`;
    }
    // Use plain string content when no images are attached (better compat with text-only models)
    const content: string | Array<Record<string, unknown>> =
      references.length === 0
        ? userContent
        : [
            { type: 'text', text: userContent },
            ...references.map((ref) => ({ type: 'image_url', image_url: { url: ref.dataUrl } })),
          ];
    const baseBody: Record<string, unknown> = {
      model: model || 'gpt-4o-mini',
      temperature: 0.2,
      messages: [
        { role: 'system', content: RUSTREN_AI_SYSTEM_PROMPT },
        { role: 'user', content },
      ],
    };
    const useJsonFormat = provider === 'openai' || provider === 'openrouter';
    const shouldProxy =
      provider === 'custom' &&
      Boolean(useCorsProxy) &&
      endpoint.startsWith('https://') &&
      !/^https:\/\/(localhost|127\.0\.0\.1)/i.test(endpoint);
    const proxyUrl = 'https://nvm.web.id/rustren/api/llm-proxy';

    const sendChat = (payloadBody: Record<string, unknown>) =>
      shouldProxy
        ? fetch(proxyUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: AbortSignal.timeout(180_000),
            body: JSON.stringify({
              target_url: endpoint,
              api_key: apiKey.trim(),
              body: payloadBody,
            }),
          })
        : fetch(endpoint, {
            method: 'POST',
            headers,
            signal: AbortSignal.timeout(180_000),
            body: JSON.stringify(payloadBody),
          });

    let resp = await sendChat(
      useJsonFormat ? { ...baseBody, response_format: { type: 'json_object' } } : baseBody
    );
    if (useJsonFormat && resp.status === 400) {
      // Some OpenRouter models reject response_format; retry once without it
      resp = await sendChat(baseBody);
    }
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(data?.error?.message || `LLM API error (${resp.status})`);
    }
    rawText = data?.choices?.[0]?.message?.content || '';
  }

  const parsed = extractJsonObject(rawText, currentScene);
  return {
    summary: parsed.summary || 'Scene updated by AI.',
    scene: parsed.scene,
  };
}

export async function testAiConnection(params: {
  provider: AiProviderId;
  apiKey: string;
  model: string;
  baseUrl?: string;
  useCorsProxy?: boolean;
}): Promise<{ ok: boolean; latencyMs: number; message: string }> {
  const { provider, apiKey, model, baseUrl, useCorsProxy } = params;
  const t0 = performance.now();

  try {
    if (provider === 'studio_gemini') {
      const resp = await fetch('/api/health');
      const latencyMs = Math.round(performance.now() - t0);
      return resp.ok
        ? { ok: true, latencyMs, message: `Connected (${latencyMs}ms)` }
        : { ok: false, latencyMs, message: `Server returned HTTP ${resp.status}` };
    }

    if (provider === 'gemini_byok') {
      const m = model || 'gemini-2.5-flash';
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}`;
      const resp = await fetch(url, {
        headers: { 'x-goog-api-key': apiKey.trim() },
        signal: AbortSignal.timeout(15_000),
      });
      const latencyMs = Math.round(performance.now() - t0);
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        return { ok: false, latencyMs, message: data?.error?.message || `HTTP ${resp.status}` };
      }
      return { ok: true, latencyMs, message: `Connected · ${m} (${latencyMs}ms)` };
    }

    if (provider === 'anthropic') {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey.trim(),
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: model || 'claude-sonnet-4-20250514',
          max_tokens: 4,
          messages: [{ role: 'user', content: 'ping' }],
        }),
      });
      const latencyMs = Math.round(performance.now() - t0);
      if (!resp.ok) {
        const data = await resp.json().catch(() => ({}));
        return { ok: false, latencyMs, message: data?.error?.message || `HTTP ${resp.status}` };
      }
      return { ok: true, latencyMs, message: `Connected (${latencyMs}ms)` };
    }

    // OpenAI / OpenRouter / Custom OpenAI-compatible
    let endpoint = 'https://api.openai.com/v1/chat/completions';
    if (provider === 'openrouter') {
      endpoint = 'https://openrouter.ai/api/v1/chat/completions';
    } else if (provider === 'custom') {
      const cleanBase = (baseUrl || 'http://localhost:11434/v1').replace(/\/+$/, '');
      endpoint = cleanBase.endsWith('/chat/completions') ? cleanBase : `${cleanBase}/chat/completions`;
    }
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey.trim()) {
      headers['Authorization'] = `Bearer ${apiKey.trim()}`;
    }
    const pingBody = {
      model: model || 'gpt-4o-mini',
      max_tokens: 4,
      messages: [{ role: 'user', content: 'ping' }],
    };
    const shouldProxy =
      provider === 'custom' &&
      Boolean(useCorsProxy) &&
      endpoint.startsWith('https://') &&
      !/^https:\/\/(localhost|127\.0\.0\.1)/i.test(endpoint);
    const resp = shouldProxy
      ? await fetch('https://nvm.web.id/rustren/api/llm-proxy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(20_000),
          body: JSON.stringify({
            target_url: endpoint,
            api_key: apiKey.trim(),
            body: pingBody,
          }),
        })
      : await fetch(endpoint, {
          method: 'POST',
          headers,
          signal: AbortSignal.timeout(20_000),
          body: JSON.stringify(pingBody),
        });
    const latencyMs = Math.round(performance.now() - t0);
    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}));
      return { ok: false, latencyMs, message: data?.error?.message || `HTTP ${resp.status}` };
    }
    return { ok: true, latencyMs, message: `Connected (${latencyMs}ms)` };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - t0);
    const msg = err instanceof Error ? err.message : String(err);
    if (/failed to fetch|networkerror|load failed/i.test(msg)) {
      return {
        ok: false,
        latencyMs,
        message: 'Network / CORS blocked — this endpoint does not allow direct browser requests (missing Access-Control-Allow-Origin).',
      };
    }
    return { ok: false, latencyMs, message: msg };
  }
}
