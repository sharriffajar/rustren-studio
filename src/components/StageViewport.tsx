import React, { useEffect, useRef, useState } from 'react';
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  Grid,
  Pause,
  Play,
  Repeat,
  SkipBack,
  SkipForward,
} from 'lucide-react';
import { formatTimecode } from '../engine/animation';
import { renderRustrenFrame, type LayerBounds } from '../engine/renderer';
import type { RustrenScene } from '../engine/types';

interface StageViewportProps {
  scene: RustrenScene;
  currentTime: number;
  isPlaying: boolean;
  loop: boolean;
  selectedLayerIndex: number | null;
  onTogglePlay: () => void;
  onSeek: (t: number) => void;
  onToggleLoop: () => void;
  onSelectLayer: (idx: number | null) => void;
  onDragMoveLayer: (idx: number, dx: number, dy: number) => void;
  onSnapshotPng: () => void;
}

export const StageViewport: React.FC<StageViewportProps> = ({
  scene,
  currentTime,
  isPlaying,
  loop,
  selectedLayerIndex,
  onTogglePlay,
  onSeek,
  onToggleLoop,
  onSelectLayer,
  onDragMoveLayer,
  onSnapshotPng,
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
    dragStateRef.current = null;
  };

  return (
    <section
      aria-label="Video preview viewport"
      className="flex-1 flex flex-col min-w-0 min-h-0 bg-[#0B0C11]"
    >
      {/* Viewport Utility Sub-Bar */}
      <div className="h-9 shrink-0 bg-[#14151C] border-b border-[#252630] px-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-[#8B8B96]">
          <span className="font-semibold text-[#D4D4D8]">Preview</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono text-[11px] tabular-nums">
            {scene.canvas.width}×{scene.canvas.height}
          </span>
          <span aria-hidden="true">·</span>
          <span className="font-mono text-[11px] tabular-nums">{fps} fps</span>
        </div>

        <div className="flex items-center gap-1.5">
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
            <span>Snapshot PNG</span>
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
            className="w-full h-full block cursor-crosshair"
          />
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
