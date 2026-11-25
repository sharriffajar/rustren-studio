import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  Cpu,
  Grid,
  Loader2,
  MessageSquarePlus,
  Pause,
  Play,
  Repeat,
  SkipBack,
  SkipForward,
  X,
} from 'lucide-react';
import { formatTimecode } from '../engine/animation';
import { renderRustrenFrame, type LayerBounds } from '../engine/renderer';
import type { FrameNote, RustrenScene } from '../engine/types';

interface StageViewportProps {
  scene: RustrenScene;
  currentTime: number;
  isPlaying: boolean;
  loop: boolean;
  selectedLayerIndex: number | null;
  frameNotes: FrameNote[];
  onAddFrameNote: (note: Omit<FrameNote, 'id'>) => void;
  onDeleteFrameNote: (id: string) => void;
  onTogglePlay: () => void;
  onSeek: (t: number) => void;
  onToggleLoop: () => void;
  onSelectLayer: (idx: number | null) => void;
  onDragMoveLayer: (idx: number, dx: number, dy: number) => void;
  onSnapshotPng: () => void;
  onNotify?: (msg: string) => void;
}

export const StageViewport: React.FC<StageViewportProps> = ({
  scene,
  currentTime,
  isPlaying,
  loop,
  selectedLayerIndex,
  frameNotes,
  onAddFrameNote,
  onDeleteFrameNote,
  onTogglePlay,
  onSeek,
  onToggleLoop,
  onSelectLayer,
  onDragMoveLayer,
  onSnapshotPng,
  onNotify,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageWrapRef = useRef<HTMLDivElement | null>(null);
  const [wrapSize, setWrapSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const boundsRef = useRef<LayerBounds[]>([]);

  useEffect(() => {
    const el = stageWrapRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      // Account for p-4 (16px padding on each side = 32px)
      setWrapSize({
        w: Math.max(64, rect.width - 32),
        h: Math.max(64, rect.height - 32),
      });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const dragStateRef = useRef<{
    layerIdx: number;
    lastCanvasX: number;
    lastCanvasY: number;
  } | null>(null);

  const [showGuides, setShowGuides] = useState(false);
  const [zoomMode, setZoomMode] = useState<'fit' | '75' | '100'>('fit');
  const [assetTick, setAssetTick] = useState(0);

  // Frame Annotation (Pin / Box) mode
  const [annotateMode, setAnnotateMode] = useState(false);
  const [draftBox, setDraftBox] = useState<{ startX: number; startY: number; curX: number; curY: number } | null>(null);
  const [pendingNote, setPendingNote] = useState<{ x: number; y: number; w?: number; h?: number } | null>(null);
  const [noteText, setNoteText] = useState('');

  // True Rustren Engine Preview (POST /snapshot)
  const [rustrenPreviewUrl, setRustrenPreviewUrl] = useState<string | null>(null);
  const [rustrenPreviewLoading, setRustrenPreviewLoading] = useState(false);

  // Clear Rustren preview overlay whenever playhead or scene changes
  useEffect(() => {
    if (rustrenPreviewUrl) {
      URL.revokeObjectURL(rustrenPreviewUrl);
      setRustrenPreviewUrl(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTime, scene]);

  const handleRustrenPreview = async () => {
    if (rustrenPreviewUrl) {
      URL.revokeObjectURL(rustrenPreviewUrl);
      setRustrenPreviewUrl(null);
      return;
    }
    const apiUrl = (localStorage.getItem('rustren_studio_api_url') || 'https://nvm.web.id/rustren/api').replace(/\/+$/, '');
    const apiKey = (localStorage.getItem('rustren_studio_api_key') || '').trim();
    if (!apiKey) {
      onNotify?.('Set your Rustren API key in Export → Rustren Cloud API first.');
      return;
    }
    setRustrenPreviewLoading(true);
    try {
      const res = await fetch(`${apiUrl}/snapshot`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ scene, time: Number(currentTime.toFixed(3)) }),
      });
      if (!res.ok) {
        const errText = await res.text().catch(() => res.statusText);
        throw new Error(`HTTP ${res.status}: ${errText.slice(0, 120)}`);
      }
      const blob = await res.blob();
      setRustrenPreviewUrl(URL.createObjectURL(blob));
    } catch (err) {
      onNotify?.(`Rustren Preview failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRustrenPreviewLoading(false);
    }
  };

  const fps = scene.canvas.fps || 30;
  const duration = scene.canvas.duration_secs || 5;
  const frameStep = 1 / fps;

  // Render frame deterministically whenever scene, playhead, selection, or guides change
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (canvas.width !== scene.canvas.width || canvas.height !== scene.canvas.height) {
      canvas.width = scene.canvas.width;
      canvas.height = scene.canvas.height;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bounds: LayerBounds[] = [];
    renderRustrenFrame(ctx, scene, currentTime, {
      selectedLayerIndex,
      showGuides,
      collectBounds: bounds,
      onAssetLoad: () => setAssetTick((n) => n + 1),
    });
    boundsRef.current = bounds;
  }, [scene, currentTime, selectedLayerIndex, showGuides, assetTick]);

  const clientToCanvas = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = scene.canvas.width / rect.width;
    const scaleY = scene.canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const pt = clientToCanvas(e);
    if (annotateMode) {
      e.currentTarget.setPointerCapture(e.pointerId);
      setPendingNote(null);
      setNoteText('');
      setDraftBox({ startX: pt.x, startY: pt.y, curX: pt.x, curY: pt.y });
      return;
    }
    // Hit test top-most layer first
    const bounds = boundsRef.current;
    let hitIdx: number | null = null;
    for (let i = bounds.length - 1; i >= 0; i--) {
      const b = bounds[i];
      if (pt.x >= b.x && pt.x <= b.x + b.width && pt.y >= b.y && pt.y <= b.y + b.height) {
        hitIdx = b.layerIndex;
        break;
      }
    }

    onSelectLayer(hitIdx);
    if (hitIdx !== null) {
      e.currentTarget.setPointerCapture(e.pointerId);
      dragStateRef.current = {
        layerIdx: hitIdx,
        lastCanvasX: pt.x,
        lastCanvasY: pt.y,
      };
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (annotateMode && draftBox) {
      const pt = clientToCanvas(e);
      setDraftBox((prev) => (prev ? { ...prev, curX: pt.x, curY: pt.y } : null));
      return;
    }
    const drag = dragStateRef.current;
    if (!drag) return;
    const pt = clientToCanvas(e);
    const dx = Math.round(pt.x - drag.lastCanvasX);
    const dy = Math.round(pt.y - drag.lastCanvasY);
    if (dx !== 0 || dy !== 0) {
      onDragMoveLayer(drag.layerIdx, dx, dy);
      drag.lastCanvasX = pt.x;
      drag.lastCanvasY = pt.y;
    }
  };

  const handlePointerUp = () => {
    if (annotateMode && draftBox) {
      const x = Math.round(Math.min(draftBox.startX, draftBox.curX));
      const y = Math.round(Math.min(draftBox.startY, draftBox.curY));
      const w = Math.round(Math.abs(draftBox.curX - draftBox.startX));
      const h = Math.round(Math.abs(draftBox.curY - draftBox.startY));
      setPendingNote(w > 12 && h > 12 ? { x, y, w, h } : { x: Math.round(draftBox.startX), y: Math.round(draftBox.startY) });
      setDraftBox(null);
      return;
    }
    dragStateRef.current = null;
  };

  const handleCommitNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingNote || !noteText.trim()) return;
    onAddFrameNote({
      timeSec: Number(currentTime.toFixed(2)),
      x: pendingNote.x,
      y: pendingNote.y,
      w: pendingNote.w,
      h: pendingNote.h,
      note: noteText.trim(),
    });
    setPendingNote(null);
    setNoteText('');
  };

  return (
    <section
      aria-label="Video preview viewport"
      className="flex-1 flex flex-col min-w-0 min-h-0 bg-[#0B0C11]"
    >
      {/* Viewport Utility Sub-Bar */}
      <div className="h-9 shrink-0 bg-[#14151C] border-b border-[#252630] px-3 flex items-center justify-between gap-2 overflow-x-auto">
        <div className="flex items-center gap-1.5 text-xs text-[#8B8B96] whitespace-nowrap shrink-0">
          <span className="font-semibold text-[#D4D4D8]">Preview</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono text-[11px] tabular-nums">
            {scene.canvas.width}×{scene.canvas.height}
          </span>
          <span aria-hidden="true" className="hidden xl:inline">·</span>
          <span className="hidden xl:inline font-mono text-[11px] tabular-nums">{fps} fps</span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0 whitespace-nowrap">
          <div className="flex items-center bg-[#1A1B23] border border-[#272834] rounded p-0.5 text-[11px]">
            {(['fit', '75', '100'] as const).map((z) => (
              <button
                key={z}
                type="button"
                onClick={() => setZoomMode(z)}
                className={`px-2 py-0.5 rounded font-mono transition-colors ${
                  zoomMode === z ? 'bg-[#2B2D3B] text-white' : 'text-[#8B8B96] hover:text-white'
                }`}
              >
                {z === 'fit' ? 'Fit' : `${z}%`}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => {
              setAnnotateMode((v) => !v);
              setDraftBox(null);
              setPendingNote(null);
            }}
            aria-pressed={annotateMode}
            title="Click or drag on frame to pin notes for AI Director"
            className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border transition-colors ${
              annotateMode
                ? 'bg-[#F97316] border-[#F97316] text-[#09090D]'
                : 'bg-[#1A1B23] border-[#272834] text-[#A1A1AA] hover:text-white'
            }`}
          >
            <MessageSquarePlus className="w-3.5 h-3.5" />
            <span>Annotate{frameNotes.length > 0 ? ` (${frameNotes.length})` : ''}</span>
          </button>

          <button
            type="button"
            onClick={() => void handleRustrenPreview()}
            disabled={rustrenPreviewLoading}
            aria-pressed={Boolean(rustrenPreviewUrl)}
            title="Fetch pixel-exact PNG preview from Rustren Cloud API (/snapshot)"
            className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border transition-colors ${
              rustrenPreviewUrl
                ? 'bg-[#10B981]/20 border-[#10B981]/60 text-[#6EE7B7]'
                : 'bg-[#1A1B23] border-[#272834] text-[#A1A1AA] hover:text-white'
            }`}
          >
            {rustrenPreviewLoading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Cpu className="w-3.5 h-3.5" />
            )}
            <span>Rustren</span>
          </button>

          <button
            type="button"
            onClick={() => setShowGuides((v) => !v)}
            aria-pressed={showGuides}
            title="Toggle safe-area & center guides"
            className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border transition-colors ${
              showGuides
                ? 'bg-[#F97316]/15 border-[#F97316]/50 text-[#FDBA74]'
                : 'bg-[#1A1B23] border-[#272834] text-[#A1A1AA] hover:text-white'
            }`}
          >
            <Grid className="w-3.5 h-3.5" />
            <span>Guides</span>
          </button>

          <button
            type="button"
            onClick={onSnapshotPng}
            title="Save current frame as PNG"
            className="flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium bg-[#1A1B23] hover:bg-[#252634] border border-[#272834] text-[#D4D4D8] transition-colors"
          >
            <Camera className="w-3.5 h-3.5" />
            <span>Snapshot</span>
          </button>
        </div>
      </div>

      {/* Stage Canvas Area */}
      <div
        ref={stageWrapRef}
        className="flex-1 min-h-0 stage-checkerboard flex items-center justify-center p-4 overflow-auto"
      >
        <div
          className="relative shadow-2xl border border-[#2A2B36] bg-black flex items-center justify-center shrink-0"
          style={(() => {
            if (zoomMode === 'fit') {
              if (wrapSize.w > 0 && wrapSize.h > 0) {
                const scale = Math.min(
                  wrapSize.w / scene.canvas.width,
                  wrapSize.h / scene.canvas.height
                );
                return {
                  width: `${Math.max(1, Math.floor(scene.canvas.width * scale))}px`,
                  height: `${Math.max(1, Math.floor(scene.canvas.height * scale))}px`,
                };
              }
              return {
                width: `${scene.canvas.width}px`,
                height: `${scene.canvas.height}px`,
                maxWidth: '100%',
                maxHeight: '100%',
              };
            }
            return {
              width: `${Math.round(scene.canvas.width * (Number(zoomMode) / 100))}px`,
              height: `${Math.round(scene.canvas.height * (Number(zoomMode) / 100))}px`,
            };
          })()}
        >
          <canvas
            ref={canvasRef}
            data-testid="rustren-stage-canvas"
            data-time={currentTime.toFixed(2)}
            data-playing={isPlaying ? 'true' : 'false'}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            className={`w-full h-full block ${annotateMode ? 'cursor-cell' : 'cursor-crosshair'}`}
          />

          {/* Annotate Mode Hint Pill */}
          {annotateMode && !pendingNote && (
            <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 pointer-events-none bg-[#09090D]/90 border border-[#F97316]/60 text-[#FDBA74] text-[11px] font-medium px-3 py-1 rounded-full shadow-lg whitespace-nowrap">
              Annotate mode: Click to pin or drag a box on the canvas
            </div>
          )}

          {/* True Rustren Engine Preview Overlay */}
          {rustrenPreviewUrl && (
            <div className="absolute inset-0 z-20 pointer-events-none">
              <img
                src={rustrenPreviewUrl}
                alt="Rustren exact engine preview"
                className="w-full h-full object-contain block"
              />
              <div className="absolute top-2 left-2 pointer-events-auto flex items-center gap-2 bg-[#09090D]/90 border border-[#10B981]/60 text-[#6EE7B7] text-[11px] font-mono px-2.5 py-1 rounded shadow-lg">
                <span>Rustren Engine Preview · t={currentTime.toFixed(2)}s</span>
                <button
                  type="button"
                  onClick={() => {
                    URL.revokeObjectURL(rustrenPreviewUrl);
                    setRustrenPreviewUrl(null);
                  }}
                  aria-label="Close Rustren preview"
                  className="text-[#A1A1AA] hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* Draft selection box while dragging in Annotate mode */}
          {draftBox && (
            <div
              className="absolute pointer-events-none border-2 border-dashed border-[#F97316] bg-[#F97316]/15 z-20"
              style={{
                left: `${(Math.min(draftBox.startX, draftBox.curX) / scene.canvas.width) * 100}%`,
                top: `${(Math.min(draftBox.startY, draftBox.curY) / scene.canvas.height) * 100}%`,
                width: `${(Math.abs(draftBox.curX - draftBox.startX) / scene.canvas.width) * 100}%`,
                height: `${(Math.abs(draftBox.curY - draftBox.startY) / scene.canvas.height) * 100}%`,
              }}
            />
          )}

          {/* Existing Frame Notes pins & boxes */}
          {frameNotes.map((n, idx) => {
            const isNear = Math.abs(n.timeSec - currentTime) <= 0.4;
            return (
              <div
                key={n.id}
                onClick={(e) => {
                  e.stopPropagation();
                  onSeek(n.timeSec);
                }}
                title={`#${idx + 1} @ ${n.timeSec.toFixed(2)}s: ${n.note}`}
                className={`absolute z-20 cursor-pointer transition-opacity ${isNear ? 'opacity-100' : 'opacity-40 hover:opacity-90'}`}
                style={{
                  left: `${(n.x / scene.canvas.width) * 100}%`,
                  top: `${(n.y / scene.canvas.height) * 100}%`,
                  width: n.w ? `${(n.w / scene.canvas.width) * 100}%` : undefined,
                  height: n.h ? `${(n.h / scene.canvas.height) * 100}%` : undefined,
                }}
              >
                {n.w && n.h ? (
                  <div className="w-full h-full border-2 border-[#F97316] bg-[#F97316]/10 rounded-sm relative">
                    <span className="absolute -top-3 -left-3 w-5 h-5 rounded-full bg-[#F97316] text-[#09090D] text-[10px] font-bold flex items-center justify-center shadow">
                      {idx + 1}
                    </span>
                  </div>
                ) : (
                  <div className="-translate-x-1/2 -translate-y-1/2 flex items-center gap-1 bg-[#F97316] text-[#09090D] text-[10px] font-bold pl-2 pr-1 py-0.5 rounded-full shadow-lg whitespace-nowrap">
                    <span>#{idx + 1}</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteFrameNote(n.id);
                      }}
                      aria-label={`Delete note ${idx + 1}`}
                      className="w-4 h-4 rounded-full flex items-center justify-center hover:bg-black/25 hover:text-white transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}

          {/* Pending Note Popover (auto-flips near right/bottom edges) */}
          {pendingNote && (() => {
            const xPct = (pendingNote.x / scene.canvas.width) * 100;
            const yPct = (pendingNote.y / scene.canvas.height) * 100;
            const flipLeft = xPct > 58;
            const flipUp = yPct > 62;
            return (
              <form
                onSubmit={handleCommitNote}
                onClick={(e) => e.stopPropagation()}
                className="absolute z-30 bg-[#14151C] border border-[#F97316]/70 rounded-lg p-2.5 shadow-2xl w-64 space-y-2"
                style={{
                  left: flipLeft ? undefined : `${Math.max(2, Math.min(96, xPct))}%`,
                  right: flipLeft ? `${Math.max(2, Math.min(96, 100 - xPct))}%` : undefined,
                  top: flipUp ? undefined : `${Math.max(2, Math.min(96, yPct))}%`,
                  bottom: flipUp ? `${Math.max(2, Math.min(96, 100 - yPct))}%` : undefined,
                }}
              >
              <div className="text-[10px] font-mono text-[#FDBA74] flex items-center justify-between">
                <span>
                  Note @ t={currentTime.toFixed(2)}s ({pendingNote.x}, {pendingNote.y}
                  {pendingNote.w ? ` · ${pendingNote.w}×${pendingNote.h}` : ''})
                </span>
              </div>
              <input
                type="text"
                autoFocus
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="e.g. Make this headline bigger & bounce..."
                className="w-full bg-[#0D0E14] border border-[#2B2D3B] rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-[#F97316]"
              />
              <div className="flex justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() => setPendingNote(null)}
                  className="px-2 py-1 rounded text-[11px] text-[#A1A1AA] hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!noteText.trim()}
                  className="px-2.5 py-1 rounded text-[11px] font-semibold bg-[#F97316] text-[#09090D] hover:bg-[#FB923C] disabled:opacity-40"
                >
                  Add Note
                </button>
              </div>
            </form>
            );
          })()}
        </div>
      </div>

      {/* Transport Controls Bar */}
      <div className="h-11 shrink-0 bg-[#14151C] border-t border-[#252630] px-4 flex items-center justify-between gap-4">
        <div className="font-mono text-xs tabular-nums text-[#F4F4F6] flex items-center gap-2 min-w-[165px]">
          <span data-testid="timecode-current" className="text-[#F97316] font-semibold">
            {formatTimecode(currentTime, fps)}
          </span>
          <span className="text-[#52525B]">/</span>
          <span className="text-[#8B8B96]">{formatTimecode(duration, fps)}</span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onSeek(0)}
            aria-label="Jump to start"
            title="Jump to start (00:00)"
            className="p-1.5 rounded text-[#A1A1AA] hover:text-white hover:bg-[#23242F] transition-colors"
          >
            <SkipBack className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => onSeek(Math.max(0, currentTime - frameStep))}
            aria-label="Previous frame"
            title="Previous frame (←)"
            className="p-1.5 rounded text-[#A1A1AA] hover:text-white hover:bg-[#23242F] transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={onTogglePlay}
            aria-label={isPlaying ? 'Pause' : 'Play'}
            title="Play / Pause (Space)"
            className="w-8 h-8 rounded bg-[#F97316] hover:bg-[#FB923C] text-[#09090D] flex items-center justify-center transition-colors cursor-pointer"
          >
            {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
          </button>

          <button
            type="button"
            onClick={() => onSeek(Math.min(duration, currentTime + frameStep))}
            aria-label="Next frame"
            title="Next frame (→)"
            className="p-1.5 rounded text-[#A1A1AA] hover:text-white hover:bg-[#23242F] transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={() => onSeek(duration)}
            aria-label="Ke akhir"
            title="Ke akhir"
            className="p-1.5 rounded text-[#A1A1AA] hover:text-white hover:bg-[#23242F] transition-colors"
          >
            <SkipForward className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center justify-end gap-2 min-w-[165px]">
          <button
            type="button"
            onClick={onToggleLoop}
            aria-pressed={loop}
            title="Loop playback"
            className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium border transition-colors ${
              loop
                ? 'bg-[#F97316]/15 border-[#F97316]/50 text-[#FDBA74]'
                : 'bg-transparent border-[#272834] text-[#8B8B96] hover:text-white'
            }`}
          >
            <Repeat className="w-3 h-3" />
            <span>Loop</span>
          </button>
        </div>
      </div>
    </section>
  );
};
