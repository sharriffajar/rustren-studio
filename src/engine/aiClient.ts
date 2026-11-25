import type { AiProviderId, AiReferenceImage, RustrenScene } from './types';
import { formatVideoAnalysisForPrompt, type VideoForensics } from './videoAnalyzer';

const RUSTREN_AI_SYSTEM_PROMPT = `You are Rustren Studio AI Director — an expert motion designer who writes valid Rustren v1.1 declarative JSON video scenes.

Respond ONLY with a valid JSON object matching this exact structure (no markdown prose outside JSON):
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
Common BaseLayer fields on all layers: id?, name?, anchor?, pivot_x? (0..1, default 0.5), pivot_y? (0..1, default 0.5), opacity?, scale?, scale_x?, scale_y?, rotation?, skew_x?, skew_y?, blur?, blend_mode? ("normal"|"multiply"|"screen"|"overlay"|"darken"|"lighten"|"color_dodge"|"color_burn"|"hard_light"|"soft_light"|"difference"|"exclusion"), shadow?, echo?: { count?, step_sec?, decay? }, wave_warp?: { amplitude?, frequency?, speed?, phase?, axis?: "x"|"y"|"stretch_x"|"stretch_y" }, track_matte?: "alpha"|"alpha_inverted"|"luma"|"luma_inverted", matte_layer?: "<layer_id>", start_sec?, end_sec?, animations?
1. "rect": { type: "rect", name, x, y, width, height, radius?, color, gradient?, border_color?, border_width?, ... }
2. "circle": { type: "circle", name, cx, cy, r, color, border_color?, border_width?, ... }
3. "text": { type: "text", name, x, y, content?, dynamic?, font_size, font_weight?: "thin"|"light"|"normal"|"medium"|"semibold"|"bold"|"extrabold"|"black"|100..900, font_family?, text_align?: "left"|"center"|"right", color, max_width?, line_height?, text_animator?: { unit?: "char"|"word", start_sec?, stagger_secs?, duration_secs?, x_offset?, y_offset?, opacity_from?, scale_from?, easing? }, ... }
   - dynamic modes:
     - { mode: "typewriter", text: "...", start_sec: 0.2, end_sec: 1.2, cursor: "_" }
     - { mode: "counter", from: 0, to: 100, decimals?: 1, prefix?: "", suffix?: "%", start_sec: 0.5, end_sec: 2.0, easing?: "ease_out_expo" }
     - { mode: "timecode", format?: "mm:ss.cc" }
4. "waveform": { type: "waveform", name, x, y, width, height, bars?, bar_gap?, color, speed?, seed?, ... }
5. "particles": { type: "particles", name, x, y, width, height, count?, seed?, speed?, gravity?, spread?, angle?, size?, shape?: "circle"|"rect"|"confetti", colors?: string[], ... }
6. "svg": { type: "svg", name, x, y, width, height, src: "<svg ...>...</svg>", ... }
7. "container": { type: "container", name, x, y, width, height, color?, radius?, clip?, clip_feather?, cascade_opacity?, layout?: { direction?: "row"|"column", gap?, padding? }, children: [...], ... }

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
- Return ONLY raw valid JSON without markdown code fences.`;

function extractJsonObject(raw: string): { summary?: string; scene: RustrenScene } {
  const trimmed = raw.trim();
  const tryParse = (s: string) => {
    const parsed = JSON.parse(s);
    if (parsed && parsed.scene && parsed.scene.canvas && Array.isArray(parsed.scene.layers)) {
      return parsed;
    }
    if (parsed && parsed.canvas && Array.isArray(parsed.layers)) {
      return { summary: 'Scene created successfully.', scene: parsed };
    }
    return null;
  };
  try {
    const direct = tryParse(trimmed);
    if (direct) return direct;
  } catch {
    // fallback to slicing outermost braces
  }
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const sliced = tryParse(trimmed.slice(start, end + 1));
    if (sliced) return sliced;
  }
  throw new Error('AI response is not a valid Rustren scene JSON.');
}

export async function runAiDirectorCommand(params: {
  provider: AiProviderId;
  apiKey: string;
  model: string;
  baseUrl?: string;
  prompt: string;
  mode: 'edit' | 'new';
  currentScene?: RustrenScene;
  /** 1-3 moodboard images sent to the provider as multimodal parts. */
  references?: AiReferenceImage[];
  /** Locally extracted video forensics, appended to the prompt as a structured block. */
  videoAnalysis?: VideoForensics;
}): Promise<{ summary: string; scene: RustrenScene }> {
  const { provider, apiKey, model, baseUrl, prompt, mode, currentScene } = params;
  const references = params.references ?? [];
  const referenceNote =
    references.length > 0
      ? `\n\nAttached reference images (${references.length}): ${references
          .map((r) => r.name)
          .join(', ')}. Extract the palette, typography hierarchy, whitespace composition and visual rhythm from them and apply them to the scene.`
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
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cleanModel)}:generateContent?key=${encodeURIComponent(apiKey.trim())}`;
    // Gemini takes every modality in `contents[0].parts`: text first, then one
    // `inline_data` block per reference image.
    const parts: Array<Record<string, unknown>> = [{ text: userContent }];
    for (const ref of references) {
      parts.push({ inline_data: { mime_type: ref.mimeType, data: ref.base64 } });
    }
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: RUSTREN_AI_SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts }],
        generationConfig: { responseMimeType: 'application/json', temperature: 0.7 },
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(data?.error?.message || `Gemini API error (${resp.status})`);
    }
    rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
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
    // OpenAI / OpenRouter / custom OpenAI-compatible servers take a `content`
    // array mixing text and `image_url` blocks with a data URL.
    const content: Array<Record<string, unknown>> = [{ type: 'text', text: userContent }];
    for (const ref of references) {
      content.push({ type: 'image_url', image_url: { url: ref.dataUrl } });
    }
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: model || 'gpt-4o-mini',
        temperature: 0.7,
        messages: [
          { role: 'system', content: RUSTREN_AI_SYSTEM_PROMPT },
          { role: 'user', content },
        ],
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw new Error(data?.error?.message || `LLM API error (${resp.status})`);
    }
    rawText = data?.choices?.[0]?.message?.content || '';
  }

  const parsed = extractJsonObject(rawText);
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
}): Promise<{ ok: boolean; latencyMs: number; message: string }> {
  const { provider, apiKey, model, baseUrl } = params;
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
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}?key=${encodeURIComponent(apiKey.trim())}`;
      const resp = await fetch(url);
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
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: model || 'gpt-4o-mini',
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
