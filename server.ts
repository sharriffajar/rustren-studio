import 'dotenv/config';
import express from 'express';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GoogleGenAI } from '@google/genai';
import { createServer as createViteServer } from 'vite';

const PORT = Number(process.env.PORT) || 3000;
const isProd = process.env.NODE_ENV === 'production';

// Check local FFmpeg availability once at startup
const ffmpegCheck = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' });
const ffmpegAvailable = ffmpegCheck.status === 0;

interface Mp4Job {
  id: string;
  outPath: string;
  proc: ChildProcessWithoutNullStreams;
  stderr: string;
  done: Promise<number | null>;
  createdAt: number;
}

const mp4Jobs = new Map<string, Mp4Job>();

// Clean up stale jobs older than 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, job] of mp4Jobs.entries()) {
    if (now - job.createdAt > 10 * 60 * 1000) {
      try {
        job.proc.kill('SIGKILL');
      } catch {
        // ignore
      }
      fs.rmSync(job.outPath, { force: true });
      mp4Jobs.delete(id);
    }
  }
}, 60_000).unref();

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

Supported Rustren v1.1 layer types & fields:
1. "rect": { type: "rect", name, x, y, width, height, radius?, color, gradient?, border_color?, border_width?, anchor?, opacity?, rotation?, scale?, skew_x?, start_sec?, end_sec?, shadow?, animations? }
2. "circle": { type: "circle", name, cx, cy, r, color, border_color?, border_width?, opacity?, scale?, start_sec?, end_sec?, animations? }
3. "text": { type: "text", name, x, y, content?, dynamic?, font_size, font_weight?: "normal"|"bold", font_family?, text_align?: "left"|"center"|"right", anchor?, color, max_width?, line_height?, opacity?, scale?, rotation?, start_sec?, end_sec?, animations? }
   - dynamic modes:
     - { mode: "typewriter", text: "...", start_sec: 0.2, end_sec: 1.2, cursor: "_" }
     - { mode: "counter", from: 0, to: 100, decimals?: 1, prefix?: "", suffix?: "%", start_sec: 0.5, end_sec: 2.0, easing?: "ease_out_expo" }
     - { mode: "timecode", format?: "mm:ss.cc" }
4. "waveform": { type: "waveform", name, x, y, width, height, bars?, bar_gap?, color, speed?, seed?, start_sec?, end_sec?, opacity?, animations? }
5. "particles": { type: "particles", name, x, y, width, height, count?, seed?, speed?, gravity?, spread?, angle?, size?, shape?: "circle"|"rect"|"confetti", colors?: string[], start_sec?, end_sec?, opacity? }
6. "svg": { type: "svg", name, x, y, width, height, src: "<svg ...>...</svg>", opacity?, start_sec?, end_sec?, animations? }
7. "container": { type: "container", name, x, y, width, height, color?, radius?, clip?, cascade_opacity?, layout?: { direction?: "row"|"column", gap?, padding? }, children: [...], start_sec?, end_sec?, animations? }

Animations array item format:
{ "property": "x"|"y"|"width"|"height"|"opacity"|"scale"|"rotation"|"skew_x"|"r"|"radius"|"color"|"border_color", "from": <num|hex>, "to": <num|hex>, "start_sec": <num>, "end_sec": <num>, "easing": "linear"|"ease_in"|"ease_out"|"ease_in_out"|"ease_out_expo"|"ease_out_back"|"ease_out_bounce"|"spring", "repeat"?: number|"infinite", "yoyo"?: boolean }

Authoring quality rules (from Rustren SKILL.md):
- Always ensure high text contrast (>= 4.5:1) against background/cards.
- For 9:16 portrait (1080x1920), keep font_size >= 28px and keep content inside safe margins.
- For 16:9 landscape (1280x720), keep font_size >= 18px and well-proportioned coordinates.
- Always clamp layer end_sec <= canvas.duration_secs.
- If modifying an existing scene, preserve existing layers unless the user asks to replace or remove them.
- Make motion feel polished: combine spring, ease_out_expo, typewriter/counter dynamic text, progress bars, waveforms, or particles when appropriate.`;

function extractJsonObject(raw: string): Record<string, unknown> {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    // Strip markdown fences if present
    const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenceMatch) {
      return JSON.parse(fenceMatch[1].trim()) as Record<string, unknown>;
    }
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as Record<string, unknown>;
    }
    throw new Error('Model tidak mengembalikan JSON scene yang valid.');
  }
}

async function callOpenAiCompatible(opts: {
  url: string;
  apiKey?: string;
  model: string;
  userPrompt: string;
  extraHeaders?: Record<string, string>;
}): Promise<string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...opts.extraHeaders,
  };
  if (opts.apiKey) {
    headers['Authorization'] = `Bearer ${opts.apiKey}`;
  }

  const resp = await fetch(opts.url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: opts.model,
      messages: [
        { role: 'system', content: RUSTREN_AI_SYSTEM_PROMPT },
        { role: 'user', content: opts.userPrompt },
      ],
      response_format: { type: 'json_object' },
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => resp.statusText);
    throw new Error(`Provider API error (${resp.status}): ${errText.slice(0, 320)}`);
  }

  const data = (await resp.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('Empty response from OpenAI-compatible provider.');
  return content;
}

async function callAnthropic(opts: {
  apiKey: string;
  model: string;
  userPrompt: string;
}): Promise<string> {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': opts.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: 4096,
      system: RUSTREN_AI_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: opts.userPrompt }],
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => resp.statusText);
    throw new Error(`Anthropic API error (${resp.status}): ${errText.slice(0, 320)}`);
  }

  const data = (await resp.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const textBlock = data.content?.find((c) => c.type === 'text');
  if (!textBlock?.text) throw new Error('Empty response from Anthropic.');
  return textBlock.text;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '50mb' }));

  // Health & engine capabilities
  app.get('/api/capabilities', (_req, res) => {
    res.json({
      schemaVersion: '1.1',
      ffmpegAvailable,
      studioGeminiAvailable: Boolean(process.env.GEMINI_API_KEY),
    });
  });

  // 1. Start FFmpeg MP4 Export Job
  app.post('/api/export/mp4/start', (req, res) => {
    if (!ffmpegAvailable) {
      res.status(503).json({ error: 'FFmpeg tidak tersedia di server. Gunakan ekspor WebM lokal.' });
      return;
    }

    const width = Math.max(64, Math.min(3840, Number(req.body?.width) || 1280));
    const height = Math.max(64, Math.min(3840, Number(req.body?.height) || 720));
    const fps = Math.max(1, Math.min(60, Number(req.body?.fps) || 30));
    const crf = Math.max(12, Math.min(35, Number(req.body?.crf) || 20));
    const allowedPresets = new Set(['ultrafast', 'veryfast', 'fast', 'medium']);
    const preset = allowedPresets.has(req.body?.preset) ? String(req.body.preset) : 'fast';

    const jobId = crypto.randomBytes(10).toString('hex');
    const outPath = path.join(os.tmpdir(), `rustren_export_${jobId}.mp4`);

    const proc = spawn('ffmpeg', [
      '-y',
      '-f',
      'image2pipe',
      '-vcodec',
      'mjpeg',
      '-framerate',
      String(fps),
      '-i',
      '-',
      '-vf',
      `scale=${width}:${height}:flags=lanczos`,
      '-c:v',
      'libx264',
      '-preset',
      preset,
      '-crf',
      String(crf),
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      outPath,
    ]);

    const job: Mp4Job = {
      id: jobId,
      outPath,
      proc,
      stderr: '',
      createdAt: Date.now(),
      done: new Promise((resolve) => {
        proc.on('close', (code) => resolve(code));
      }),
    };

    proc.stderr.on('data', (chunk: Buffer) => {
      job.stderr += chunk.toString('utf8').slice(-2000);
    });

    mp4Jobs.set(jobId, job);
    res.json({ jobId, width, height, fps });
  });

  // 2. Append MJPEG frames to FFmpeg stdin
  app.post('/api/export/mp4/:jobId/frames', async (req, res) => {
    const job = mp4Jobs.get(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: 'Export job tidak ditemukan atau sudah kedaluwarsa.' });
      return;
    }

    const frames = req.body?.frames;
    if (!Array.isArray(frames) || frames.length === 0) {
      res.status(400).json({ error: 'Frames array kosong.' });
      return;
    }

    try {
      for (const b64 of frames) {
        if (typeof b64 !== 'string') continue;
        const buf = Buffer.from(b64, 'base64');
        const ok = job.proc.stdin.write(buf);
        if (!ok) {
          await new Promise<void>((resolve) => job.proc.stdin.once('drain', resolve));
        }
      }
      res.json({ ok: true, count: frames.length });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // 3. Finalize FFmpeg and stream MP4 directly back to client
  app.post('/api/export/mp4/:jobId/finish', async (req, res) => {
    const job = mp4Jobs.get(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: 'Export job tidak ditemukan.' });
      return;
    }
    mp4Jobs.delete(req.params.jobId);

    try {
      job.proc.stdin.end();
      const exitCode = await job.done;
      if (exitCode !== 0 || !fs.existsSync(job.outPath)) {
        fs.rmSync(job.outPath, { force: true });
        res.status(500).json({
          error: `FFmpeg exited with code ${exitCode}: ${job.stderr.slice(-300)}`,
        });
        return;
      }

      const data = fs.readFileSync(job.outPath);
      fs.rmSync(job.outPath, { force: true });
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Content-Disposition', 'attachment; filename="rustren_export.mp4"');
      res.send(data);
    } catch (err) {
      fs.rmSync(job.outPath, { force: true });
      res.status(500).json({ error: (err as Error).message });
    }
  });

  // 4. AI BYOK Director Command Endpoint
  app.post('/api/ai/command', async (req, res) => {
    const {
      provider = 'studio_gemini',
      apiKey = '',
      model = '',
      baseUrl = '',
      prompt = '',
      currentScene,
      mode = 'edit',
    } = req.body || {};

    if (typeof prompt !== 'string' || !prompt.trim()) {
      res.status(400).json({ error: 'Perintah AI tidak boleh kosong.' });
      return;
    }

    const userPrompt =
      mode === 'edit' && currentScene
        ? `Mode: Edit existing Rustren v1.1 scene.\nCurrent scene JSON:\n${JSON.stringify(currentScene)}\n\nUser instruction:\n${prompt.trim()}`
        : `Mode: Generate a brand-new Rustren v1.1 scene from scratch.\nUser instruction:\n${prompt.trim()}`;

    try {
      let rawText = '';

      if (provider === 'studio_gemini' || provider === 'gemini_byok') {
        const keyToUse =
          provider === 'gemini_byok' ? String(apiKey).trim() : (process.env.GEMINI_API_KEY || '');
        if (!keyToUse) {
          res.status(400).json({
            error:
              provider === 'gemini_byok'
                ? 'Masukkan Gemini API key pribadi Anda terlebih dahulu pada pengaturan BYOK.'
                : 'GEMINI_API_KEY belum dikonfigurasi di server. Gunakan mode BYOK atau atur Secrets.',
          });
          return;
        }
        const selectedModel =
          provider === 'studio_gemini'
            ? 'gemini-4-hydrogen'
            : String(model).trim() || 'gemini-2.5-flash';

        const ai = new GoogleGenAI({
          apiKey: keyToUse,
          httpOptions: {
            headers: {
              'User-Agent': 'aistudio-build',
            },
          },
        });

        const response = await ai.models.generateContent({
          model: selectedModel,
          contents: userPrompt,
          config: {
            systemInstruction: RUSTREN_AI_SYSTEM_PROMPT,
            responseMimeType: 'application/json',
          },
        });
        rawText = response.text || '';
      } else if (provider === 'openai') {
        const key = String(apiKey).trim();
        if (!key) {
          res.status(400).json({ error: 'Masukkan OpenAI API key Anda (sk-...) pada panel BYOK.' });
          return;
        }
        rawText = await callOpenAiCompatible({
          url: 'https://api.openai.com/v1/chat/completions',
          apiKey: key,
          model: String(model).trim() || 'gpt-4o-mini',
          userPrompt,
        });
      } else if (provider === 'openrouter') {
        const key = String(apiKey).trim();
        if (!key) {
          res.status(400).json({ error: 'Masukkan OpenRouter API key Anda (sk-or-...) pada panel BYOK.' });
          return;
        }
        rawText = await callOpenAiCompatible({
          url: 'https://openrouter.ai/api/v1/chat/completions',
          apiKey: key,
          model: String(model).trim() || 'google/gemini-2.5-flash',
          userPrompt,
          extraHeaders: {
            'HTTP-Referer': 'https://nvm.web.id/rustren/',
            'X-Title': 'Rustren Studio',
          },
        });
      } else if (provider === 'anthropic') {
        const key = String(apiKey).trim();
        if (!key) {
          res.status(400).json({ error: 'Masukkan Anthropic API key Anda (sk-ant-...) pada panel BYOK.' });
          return;
        }
        rawText = await callAnthropic({
          apiKey: key,
          model: String(model).trim() || 'claude-sonnet-4-20250514',
          userPrompt,
        });
      } else if (provider === 'custom') {
        const cleanBase = String(baseUrl).trim().replace(/\/+$/, '');
        if (!cleanBase || !/^https?:\/\//i.test(cleanBase)) {
          res.status(400).json({
            error: 'Masukkan Base URL endpoint OpenAI-compatible yang valid (contoh: http://localhost:11434/v1).',
          });
          return;
        }
        const endpoint = cleanBase.endsWith('/chat/completions')
          ? cleanBase
          : `${cleanBase}/chat/completions`;
        rawText = await callOpenAiCompatible({
          url: endpoint,
          apiKey: String(apiKey).trim() || undefined,
          model: String(model).trim() || 'llama3.2',
          userPrompt,
        });
      } else {
        res.status(400).json({ error: `Provider tidak dikenal: ${provider}` });
        return;
      }

      const parsed = extractJsonObject(rawText);
      const scene = (parsed.scene ?? parsed) as {
        canvas?: { width?: number; height?: number; fps?: number; duration_secs?: number };
        layers?: unknown[];
      };

      if (!scene || !scene.canvas || !Array.isArray(scene.layers)) {
        res.status(422).json({
          error: 'Respons AI tidak berisi struktur scene Rustren (canvas & layers) yang valid.',
        });
        return;
      }

      res.json({
        summary:
          typeof parsed.summary === 'string' && parsed.summary.trim()
            ? parsed.summary.trim()
            : `Scene diperbarui (${scene.layers.length} layer, ${scene.canvas.duration_secs ?? 5}s).`,
        scene,
      });
    } catch (err) {
      const msg = (err as Error)?.message || 'Terjadi kesalahan saat memanggil AI provider.';
      res.status(502).json({ error: msg });
    }
  });

  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Rustren Studio listening on http://0.0.0.0:${PORT} (FFmpeg: ${ffmpegAvailable})`);
  });
}

startServer();
