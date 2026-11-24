import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  Code2,
  Download,
  Eye,
  EyeOff,
  FileJson,
  Film,
  Grid2X2,
  KeyRound,
  Loader2,
  X,
} from 'lucide-react';
import {
  exportContactSheetPng,
  exportMp4ViaRustrenApi,
  exportPngSnapshot,
  exportSceneHtmlFile,
  exportSceneJsonFile,
  exportWebmLocally,
  type ExportProgress,
} from '../engine/exporter';
import type { RustrenScene } from '../engine/types';

interface ExportModalProps {
  open: boolean;
  onClose: () => void;
  scene: RustrenScene;
  currentTime: number;
  projectName: string;
  ffmpegAvailable: boolean;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  open,
  onClose,
  scene,
  currentTime,
  projectName,
  ffmpegAvailable,
}) => {
  const [format, setFormat] = useState<'mp4' | 'webm'>('mp4');
  const [scale, setScale] = useState(1);
  const [rustrenApiUrl, setRustrenApiUrl] = useState(() => {
    try {
      return localStorage.getItem('rustren_studio_api_url') || 'https://nvm.web.id/rustren/api';
    } catch {
      return 'https://nvm.web.id/rustren/api';
    }
  });
  const [rustrenApiKey, setRustrenApiKey] = useState(() => {
    try {
      return localStorage.getItem('rustren_studio_api_key') || '';
    } catch {
      return '';
    }
  });
  const [showApiKey, setShowApiKey] = useState(false);
  const [filename, setFilename] = useState(
    `${projectName.toLowerCase().replace(/[^a-z0-9]+/g, '_') || 'rustren_video'}`
  );
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneMessage, setDoneMessage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem('rustren_studio_api_url', rustrenApiUrl);
      localStorage.setItem('rustren_studio_api_key', rustrenApiKey);
    } catch {
      // ignore storage quota
    }
  }, [rustrenApiUrl, rustrenApiKey]);

  useEffect(() => {
    if (open) {
      const slug = projectName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
      setFilename(slug || 'rustren_video');
      setError(null);
      setDoneMessage(null);
      setProgress(null);
    }
  }, [open, projectName]);

  if (!open) return null;

  const outW = Math.round((scene.canvas.width * scale) / 2) * 2;
  const outH = Math.round((scene.canvas.height * scale) / 2) * 2;
  const totalFrames = Math.round(scene.canvas.duration_secs * (scene.canvas.fps || 30));

  const handleVideoExport = async () => {
    setError(null);
    setDoneMessage(null);
    setIsExporting(true);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      if (format === 'mp4') {
        const res = await exportMp4ViaRustrenApi(
          scene,
          {
            apiUrl: rustrenApiUrl,
            apiKey: rustrenApiKey,
            scale,
            filename: `${filename}.mp4`,
          },
          setProgress,
          controller.signal
        );
        const kb = (res.sizeBytes / 1024).toFixed(1);
        const secs = res.renderSecs ? ` · ${res.renderSecs.toFixed(1)}s` : '';
        setDoneMessage(`MP4 saved (${res.filename} · ${kb} KB${secs}) via Rustren API.`);
      } else {
        const res = await exportWebmLocally(scene, setProgress, controller.signal);
        const kb = (res.sizeBytes / 1024).toFixed(1);
        setDoneMessage(`WebM saved (${res.filename} · ${kb} KB) locally.`);
      }
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        setError((err as Error).message || 'Export failed.');
      }
    } finally {
      setIsExporting(false);
      abortRef.current = null;
    }
  };

  const handleCancel = () => {
    abortRef.current?.abort();
    setIsExporting(false);
    setProgress(null);
  };

  const handleAssetAction = async (fn: () => Promise<unknown>, successText: string) => {
    setError(null);
    setDoneMessage(null);
    try {
      await fn();
      setDoneMessage(successText);
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError') {
        setError((err as Error).message);
      }
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-modal-title"
      className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
    >
      <div className="w-full max-w-[540px] bg-[#13141B] border border-[#2A2B38] rounded-lg overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-5 py-3.5 bg-[#181922] border-b border-[#262735] flex items-center justify-between">
          <div>
            <h2 id="export-modal-title" className="text-sm font-bold text-white">
              Export Video & Assets
            </h2>
            <p className="text-[11px] text-[#8B8B96] font-mono tabular-nums mt-0.5">
              {outW}×{outH} · {scene.canvas.fps} fps · {scene.canvas.duration_secs.toFixed(1)}s ({totalFrames} frame)
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isExporting}
            aria-label="Close export dialog"
            className="p-1.5 text-[#8B8B96] hover:text-white rounded disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Format Selector */}
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              disabled={isExporting}
              onClick={() => setFormat('mp4')}
              className={`p-3 rounded border text-left transition-colors ${
                format === 'mp4'
                  ? 'bg-[#F97316]/12 border-[#F97316] text-white'
                  : 'bg-[#171820] border-[#272834] text-[#A1A1AA] hover:text-white disabled:opacity-40'
              }`}
            >
              <div className="flex items-center gap-2 font-semibold text-xs mb-1">
                <Film className="w-4 h-4 text-[#F97316]" />
                <span>MP4 via Rustren API</span>
              </div>
              <p className="text-[11px] text-[#8B8B96]">
                Deterministic H.264 render on Rustren server (4 vCPU). Requires Rustren API Key.
              </p>
            </button>

            <button
              type="button"
              disabled={isExporting}
              onClick={() => setFormat('webm')}
              className={`p-3 rounded border text-left transition-colors ${
                format === 'webm'
                  ? 'bg-[#F97316]/12 border-[#F97316] text-white'
                  : 'bg-[#171820] border-[#272834] text-[#A1A1AA] hover:text-white'
              }`}
            >
              <div className="flex items-center gap-2 font-semibold text-xs mb-1">
                <Download className="w-4 h-4 text-[#38BDF8]" />
                <span>Local WebM (Browser)</span>
              </div>
              <p className="text-[11px] text-[#8B8B96]">
                100% in-browser via MediaRecorder with no server. Great for fast offline previews.
              </p>
            </button>
          </div>

          {/* Encoding Options */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-3 sm:col-span-1">
              <label className="block text-[11px] text-[#8B8B96] mb-1" htmlFor="export-filename">
                Filename
              </label>
              <input
                id="export-filename"
                type="text"
                disabled={isExporting}
                value={filename}
                onChange={(e) => setFilename(e.target.value)}
                className="w-full bg-[#0E0F14] border border-[#2C2D39] rounded px-2.5 py-1.5 font-mono text-xs text-white focus:outline-none focus:border-[#F97316]"
              />
            </div>

            <div>
              <label className="block text-[11px] text-[#8B8B96] mb-1" htmlFor="export-scale">
                Resolution
              </label>
              <select
                id="export-scale"
                disabled={isExporting}
                value={scale}
                onChange={(e) => setScale(Number(e.target.value))}
                className="w-full bg-[#0E0F14] border border-[#2C2D39] rounded px-2 py-1.5 text-xs text-[#E4E4E7]"
              >
                <option value={1}>100% ({scene.canvas.width}×{scene.canvas.height})</option>
                <option value={0.75}>75% (Fast)</option>
                <option value={0.5}>50% (Draft)</option>
              </select>
            </div>

            {format === 'mp4' ? (
              <div>
                <label className="block text-[11px] text-[#8B8B96] mb-1">Engine</label>
                <div className="bg-[#0E0F14] border border-[#2C2D39] rounded px-2.5 py-1.5 font-mono text-xs text-[#F97316]">
                  Rustren H.264
                </div>
              </div>
            ) : (
              <div>
                <label className="block text-[11px] text-[#8B8B96] mb-1">Preset</label>
                <div className="bg-[#0E0F14] border border-[#2C2D39] rounded px-2.5 py-1.5 font-mono text-xs text-[#8B8B96]">
                  VP9 · 6 Mbps
                </div>
              </div>
            )}
          </div>

          {format === 'mp4' && (
            <div className="p-3 rounded bg-[#0E0F14] border border-[#272834] space-y-2.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-semibold text-[#E4E4E7] flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5 text-[#F97316]" />
                  Rustren Render API Configuration
                </span>
                <a
                  href="https://nvm.web.id/contact/"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[#F97316] hover:underline"
                >
                  Request API Token →
                </a>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] text-[#8B8B96] mb-1" htmlFor="rustren-api-url">
                    API Base URL
                  </label>
                  <input
                    id="rustren-api-url"
                    type="url"
                    disabled={isExporting}
                    value={rustrenApiUrl}
                    onChange={(e) => setRustrenApiUrl(e.target.value)}
                    placeholder="https://nvm.web.id/rustren/api"
                    className="w-full bg-[#13141B] border border-[#2C2D39] rounded px-2.5 py-1.5 font-mono text-[11px] text-white focus:outline-none focus:border-[#F97316]"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-[#8B8B96] mb-1" htmlFor="rustren-api-key">
                    Rustren API Key
                  </label>
                  <div className="relative">
                    <input
                      id="rustren-api-key"
                      type={showApiKey ? 'text' : 'password'}
                      disabled={isExporting}
                      value={rustrenApiKey}
                      onChange={(e) => setRustrenApiKey(e.target.value)}
                      placeholder="rr_..."
                      className="w-full bg-[#13141B] border border-[#2C2D39] rounded pl-2.5 pr-8 py-1.5 font-mono text-[11px] text-white focus:outline-none focus:border-[#F97316]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowApiKey((v) => !v)}
                      aria-label="Toggle API key visibility"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-[#8B8B96] hover:text-white"
                    >
                      {showApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                </div>
              </div>
              <p className="text-[10px] text-[#71717A]">
                Stored locally in your browser (localStorage) and sent directly to Rustren API when rendering MP4.
              </p>
            </div>
          )}

          {/* Progress Bar */}
          {progress && (
            <div className="p-3 rounded bg-[#0E0F14] border border-[#262735] space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[#E4E4E7]">{progress.message}</span>
                <span className="font-mono text-[#F97316] tabular-nums">{progress.percent}%</span>
              </div>
              <div className="h-1.5 bg-[#20222E] rounded overflow-hidden">
                <div
                  className="h-full bg-[#F97316] transition-all duration-150"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
            </div>
          )}

          {error && (
            <div role="alert" className="p-3 rounded bg-[#261417] border border-[#EF4444]/50 text-xs text-[#FCA5A5]">
              {error}
            </div>
          )}

          {doneMessage && (
            <div className="p-3 rounded bg-[#10261C] border border-[#16A34A]/50 text-xs text-[#86EFAC] flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{doneMessage}</span>
            </div>
          )}

          {/* Primary Video Render Button */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleVideoExport}
              disabled={isExporting}
              className="flex-1 py-2.5 px-4 rounded bg-[#F97316] hover:bg-[#FB923C] disabled:opacity-50 text-[#09090D] font-bold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer"
            >
              {isExporting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Merender {format.toUpperCase()}...</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  <span>Render & Save {format.toUpperCase()}</span>
                </>
              )}
            </button>
            {isExporting && (
              <button
                type="button"
                onClick={handleCancel}
                className="py-2.5 px-3 rounded bg-[#232430] hover:bg-[#2F3142] text-xs font-medium text-[#E4E4E7]"
              >
                Cancel
              </button>
            )}
          </div>

          {/* Quick Asset Exports (Rustren CLI parity) */}
          <div className="pt-4 border-t border-[#252630] space-y-2">
            <div className="text-[11px] font-semibold text-[#8B8B96]">
              Quick Asset & Source Export
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <button
                type="button"
                disabled={isExporting}
                onClick={() =>
                  handleAssetAction(
                    () => exportPngSnapshot(scene, currentTime, filename),
                    `PNG Snapshot at ${currentTime.toFixed(2)}s saved.`
                  )
                }
                className="flex items-center justify-center gap-1.5 py-2 px-2.5 rounded bg-[#171820] hover:bg-[#232533] border border-[#272834] text-[11px] font-medium text-[#E4E4E7] transition-colors"
              >
                <Camera className="w-3.5 h-3.5 text-[#F97316]" />
                <span>PNG Frame</span>
              </button>

              <button
                type="button"
                disabled={isExporting}
                onClick={() =>
                  handleAssetAction(
                    () => exportContactSheetPng(scene, 3, 2),
                    'Contact Sheet PNG (3×2) saved.'
                  )
                }
                className="flex items-center justify-center gap-1.5 py-2 px-2.5 rounded bg-[#171820] hover:bg-[#232533] border border-[#272834] text-[11px] font-medium text-[#E4E4E7] transition-colors"
              >
                <Grid2X2 className="w-3.5 h-3.5 text-[#FACC15]" />
                <span>Contact Sheet</span>
              </button>

              <button
                type="button"
                disabled={isExporting}
                onClick={() =>
                  handleAssetAction(
                    () => exportSceneJsonFile(scene, filename),
                    `File ${filename}.json saved.`
                  )
                }
                className="flex items-center justify-center gap-1.5 py-2 px-2.5 rounded bg-[#171820] hover:bg-[#232533] border border-[#272834] text-[11px] font-medium text-[#E4E4E7] transition-colors"
              >
                <FileJson className="w-3.5 h-3.5 text-[#38BDF8]" />
                <span>Rustren JSON</span>
              </button>

              <button
                type="button"
                disabled={isExporting}
                onClick={() =>
                  handleAssetAction(
                    () => exportSceneHtmlFile(scene, filename),
                    `File ${filename}.html saved.`
                  )
                }
                className="flex items-center justify-center gap-1.5 py-2 px-2.5 rounded bg-[#171820] hover:bg-[#232533] border border-[#272834] text-[11px] font-medium text-[#E4E4E7] transition-colors"
              >
                <Code2 className="w-3.5 h-3.5 text-[#34D399]" />
                <span>Rustren HTML</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
