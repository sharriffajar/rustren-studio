# Rustren Studio

**Rustren Studio** is a 100% static, browser-based motion graphics & declarative video editor for [Rustren](https://github.com/sharriffajar/rustren) (`v1.1` / `v0.5.1` engine).

- **Live Studio**: https://nvm.web.id/rustren/studio/
- **Rustren Engine**: https://github.com/sharriffajar/rustren

---

## Features

### 1. Rustren `v0.5.1` Canvas Engine Parity
Real-time deterministic HTML5 Canvas2D preview supporting Rustren's declarative scene spec:
- **Transforms & Anchors**: `scale`, `scale_x`, `scale_y`, `rotation`, `skew_x`, `skew_y`, `anchor`, and custom `pivot_x` / `pivot_y` (`0..1`, default `0.5`).
- **Typography**: Full `font_weight` (`thin`..`black` / `100`..`900`), dynamic text (`typewriter`, `counter`, `timecode`), rich spans, and built-in per-char / per-word **`text_animator`** stagger.
- **Animations**: Keyframes, easings (`ease_out_expo`, `ease_out_back`, `ease_out_bounce`, `cubic_bezier`, `spring`), `repeat` / `yoyo`, and math expressions (`expr` / `expression` with `t`).
- **Visual Effects & Compositing**:
  - 12 blend modes (`normal`, `multiply`, `screen`, `overlay`, `darken`, `lighten`, `color_dodge`, `color_burn`, `hard_light`, `soft_light`, `difference`, `exclusion`)
  - **`echo`** motion trails (`count`, `step_sec`, `decay`)
  - **`wave_warp`** (`x`, `y`, `stretch_x`, `stretch_y` via 1D LUT)
  - **`track_matte`** (`alpha`, `alpha_inverted`, `luma`, `luma_inverted` + `matte_layer`)
  - **`clip_feather`** on `container` layers
  - Drop shadows, blur, gradients, waveforms, particles, SVG, and images.

### 2. AI Director (BYOK — Bring Your Own Key)
Generate or edit Rustren scenes directly in the browser using your own API key (stored locally in `localStorage`, never sent to a Rustren server):
- **Providers**: Google Gemini, OpenAI, OpenRouter, Anthropic Claude, or Custom / Ollama / LM Studio.
- **Moodboard References**: Attach up to 3 reference images for palette, typography, and layout art direction.
- **Local Reference Video Forensics**: Analyze an MP4/WebM locally in the browser (shots, luma, motion, palette, keyframes) without uploading the video.

### 3. Frame Notes (Annotate) & True Rustren Preview
- **Annotate (Pin / Box Notes)**: Toggle **Annotate** in the viewport toolbar, click or drag on any frame to drop numbered `#1`, `#2` review notes, click notes to seek to their timestamp, and hit **Apply Notes with AI** to send exact `(t, x, y, w, h, note)` + a snapshot of the current frame to the AI Director.
- **Rustren Preview (`POST /snapshot`)**: Click **Rustren Preview** in the viewport toolbar to fetch a pixel-exact PNG rendered by the native Rust `rustren` binary via the Rustren Cloud API and overlay it directly on the stage. (Configure your API URL & key in **Export → Rustren Cloud API**.)

### 4. Export & Linting
- **Scene Linter + Auto-Fix**: Catches contrast, bounds, `end_sec`, and schema issues.
- **Exports**: Local WebM (in-browser), PNG Snapshot, Contact Sheet, Scene JSON, and native MP4 via Rustren Cloud API.

---

## Local Development

**Prerequisites:** Node.js 20+

```bash
npm install --legacy-peer-deps
npm run dev
```

### Run Tests & Typecheck

```bash
npx tsx --test src/engine/*.test.ts
npx tsc --noEmit
```

### Static Production Build

```bash
npx vite build --base=/rustren/studio/
```

The output in `dist/` is 100% static and can be served by any static host (Nginx, Cloudflare Pages, GitHub Pages, etc.).
