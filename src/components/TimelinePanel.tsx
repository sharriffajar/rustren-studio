import React, { useRef, useState } from 'react';
import { ZoomIn, ZoomOut } from 'lucide-react';
import { getLayerTimeRange } from '../engine/animation';
import type { Layer, RustrenScene } from '../engine/types';

interface TimelinePanelProps {
  scene: RustrenScene;
  currentTime: number;
  selectedLayerIndex: number | null;
  onSeek: (t: number) => void;
  onSelectLayer: (idx: number) => void;
  onShiftLayerTiming: (idx: number, newStart: number, newEnd: number) => void;
  height?: number;
}

const TRACK_COLORS: Record<Layer['type'], string> = {
  rect: 'bg-[#1E3A5F] border-[#38BDF8]/60 text-[#E0F2FE]',
  circle: 'bg-[#3B2158] border-[#A78BFA]/60 text-[#EDE9FE]',
  text: 'bg-[#4C2411] border-[#F97316]/70 text-[#FFEDD5]',
  svg: 'bg-[#1D3B38] border-[#2DD4BF]/60 text-[#CCFBF1]',
  image: 'bg-[#4C1D2D] border-[#FB7185]/60 text-[#FFE4E6]',
  waveform: 'bg-[#163B29] border-[#34D399]/60 text-[#D1FAE5]',
  particles: 'bg-[#423310] border-[#FACC15]/60 text-[#FEF9C3]',
  container: 'bg-[#262938] border-[#94A3B8]/50 text-[#F1F5F9]',
};

export const TimelinePanel: React.FC<TimelinePanelProps> = ({
  scene,
  currentTime,
  selectedLayerIndex,
  onSeek,
  onSelectLayer,
  onShiftLayerTiming,
  height = 220,
}) => {
  const duration = Math.max(0.5, scene.canvas.duration_secs || 5);
  const [zoom, setZoom] = useState(1);
  const tracksAreaRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    idx: number;
    startClientX: number;
    origStart: number;
    origEnd: number;
    trackWidth: number;
  } | null>(null);

  const playheadPct = Math.min(100, Math.max(0, (currentTime / duration) * 100));

  const seekFromClientX = (clientX: number) => {
    const el = tracksAreaRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / Math.max(1, rect.width)));
    onSeek(Number((ratio * duration).toFixed(3)));
  };

  const handleRulerPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    seekFromClientX(e.clientX);
  };

  const handleRulerPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.buttons !== 1) return;
    seekFromClientX(e.clientX);
  };

  const handleBlockPointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    idx: number,
    start: number,
    end: number
  ) => {
    e.stopPropagation();
    onSelectLayer(idx);
    const el = tracksAreaRef.current;
    if (!el) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      idx,
      startClientX: e.clientX,
      origStart: start,
      origEnd: end,
      trackWidth: el.getBoundingClientRect().width,
    };
  };

  const handleBlockPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startClientX;
    const dt = (dx / Math.max(1, drag.trackWidth)) * duration;
    const span = drag.origEnd - drag.origStart;
    const nextStart = Math.max(0, Math.min(duration - Math.min(span, duration), drag.origStart + dt));
    const nextEnd = Math.min(duration, nextStart + span);
    onShiftLayerTiming(drag.idx, Number(nextStart.toFixed(2)), Number(nextEnd.toFixed(2)));
  };

  const handleBlockPointerUp = () => {
    dragRef.current = null;
  };

  // Compute ruler ticks every 0.5s or 1s depending on duration
  const stepSec = duration <= 4 ? 0.5 : duration <= 12 ? 1 : 2;
  const ticks: number[] = [];
  for (let t = 0; t <= duration + 1e-4; t += stepSec) {
    ticks.push(Number(t.toFixed(2)));
  }

  return (
    <section
      aria-label="Timeline editor"
      style={{ height: `${height}px` }}
      className="shrink-0 bg-[#121319] border-t border-[#252630] flex flex-col select-none"
    >
      {/* Timeline Header */}
      <div className="h-8 shrink-0 bg-[#171820] border-b border-[#252630] px-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 text-xs">
          <span className="font-semibold text-[#E4E4E7]">Timeline</span>
          <span className="font-mono text-[11px] text-[#8B8B96] tabular-nums">
            {scene.layers.length} track · {duration.toFixed(1)}s
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[#8B8B96] hidden sm:inline">
            Click ruler to scrub · Click ◆ to jump to keyframe
          </span>
          <div className="flex items-center gap-1 border border-[#272834] rounded bg-[#121319] px-1.5 py-0.5">
            <button
              type="button"
              onClick={() => setZoom((z) => Math.max(1, Number((z - 0.5).toFixed(1))))}
              aria-label="Perkecil zoom timeline"
              className="p-0.5 text-[#8B8B96] hover:text-white"
            >
              <ZoomOut className="w-3 h-3" />
            </button>
            <span className="font-mono text-[10px] text-[#D4D4D8] w-8 text-center tabular-nums">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setZoom((z) => Math.min(3, Number((z + 0.5).toFixed(1))))}
              aria-label="Perbesar zoom timeline"
              className="p-0.5 text-[#8B8B96] hover:text-white"
            >
              <ZoomIn className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>

      {/* Timeline Body — Unified Vertical Scroll with Sticky Track Column */}
      <div className="flex-1 min-h-0 overflow-auto bg-[#0E0F14]">
        <div
          className="flex min-h-full"
          style={{ width: zoom > 1 ? `calc(180px + ${zoom * 100}%)` : '100%' }}
        >
          {/* Sticky Left Track Names Column */}
          <div className="w-[180px] shrink-0 sticky left-0 z-30 border-r border-[#252630] bg-[#14151C] flex flex-col">
            <div className="h-6 sticky top-0 z-40 border-b border-[#252630] bg-[#171820] px-2.5 flex items-center text-[10px] font-mono text-[#71717A]">
              LAYER TRACK
            </div>
            {scene.layers.map((layer, idx) => {
              const label = layer.name || layer.id || `${layer.type} #${idx + 1}`;
              const isSelected = selectedLayerIndex === idx;
              return (
                <button
                  key={`label-${idx}`}
                  type="button"
                  onClick={() => onSelectLayer(idx)}
                  className={`h-7 shrink-0 px-2.5 border-b border-[#1E1F29] flex items-center justify-between gap-2 text-left transition-colors ${
                    isSelected
                      ? 'bg-[#20222E] text-white'
                      : 'text-[#A1A1AA] hover:bg-[#191A23] hover:text-white'
                  }`}
                >
                  <span className="text-[11px] truncate">{label}</span>
                  <span className="font-mono text-[9px] text-[#71717A] uppercase shrink-0">
                    {layer.type.slice(0, 4)}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Right Ruler & Track Bars */}
          <div ref={tracksAreaRef} className="flex-1 relative min-w-0">
            {/* Time Ruler */}
            <div
              role="slider"
              aria-label="Timeline playhead scrubber"
              aria-valuemin={0}
              aria-valuemax={duration}
              aria-valuenow={Number(currentTime.toFixed(2))}
              tabIndex={0}
              onPointerDown={handleRulerPointerDown}
              onPointerMove={handleRulerPointerMove}
              className="h-6 sticky top-0 z-20 bg-[#171820] border-b border-[#252630] cursor-ew-resize relative"
            >
              {ticks.map((t) => {
                const leftPct = (t / duration) * 100;
                const isLast = Math.abs(t - duration) < 1e-3;
                return (
                  <div
                    key={t}
                    className={`absolute top-0 bottom-0 flex flex-col justify-between ${
                      isLast ? '-translate-x-full pr-1' : ''
                    }`}
                    style={{ left: `${leftPct}%` }}
                  >
                    <span className="font-mono text-[10px] text-[#8B8B96] pl-1 pt-0.5 tabular-nums whitespace-nowrap">
                      {t.toFixed(1)}s
                    </span>
                    <div className="w-px h-1.5 bg-[#3A3C4C]" />
                  </div>
                );
              })}
            </div>

            {/* Playhead Needle */}
            <div
              className="absolute top-0 bottom-0 w-px bg-[#F97316] z-20 pointer-events-none"
              style={{ left: `${playheadPct}%` }}
            >
              <div className="w-2.5 h-2.5 bg-[#F97316] -ml-[4.5px] rotate-45 -mt-1" />
            </div>

            {/* Track Lanes */}
            <div className="relative">
              {scene.layers.map((layer, idx) => {
                const { start, end } = getLayerTimeRange(layer, duration);
                const leftPct = (start / duration) * 100;
                const widthPct = Math.max(2, ((end - start) / duration) * 100);
                const isSelected = selectedLayerIndex === idx;
                const label = layer.name || layer.id || `${layer.type} #${idx + 1}`;

                // Deduplicate keyframe timestamps per layer
                const kfSet = new Set<number>();
                if (Array.isArray(layer.animations)) {
                  for (const anim of layer.animations) {
                    if (typeof anim.start_sec === 'number') kfSet.add(Number(anim.start_sec.toFixed(2)));
                    if (typeof anim.end_sec === 'number') kfSet.add(Number(anim.end_sec.toFixed(2)));
                    if (Array.isArray(anim.keyframes)) {
                      for (const kf of anim.keyframes) kfSet.add(Number(kf.time.toFixed(2)));
                    }
                  }
                }
                const keyframeTimes = Array.from(kfSet).sort((a, b) => a - b);

                return (
                  <div
                    key={`lane-${idx}`}
                    onClick={() => onSelectLayer(idx)}
                    className={`h-7 border-b border-[#1A1B24] relative ${
                      isSelected ? 'bg-[#191B26]/70' : ''
                    }`}
                  >
                    {/* Duration Bar */}
                    <div
                      onPointerDown={(e) => handleBlockPointerDown(e, idx, start, end)}
                      onPointerMove={handleBlockPointerMove}
                      onPointerUp={handleBlockPointerUp}
                      title={`${label}: ${start.toFixed(2)}s – ${end.toFixed(2)}s (drag to adjust timing)`}
                      className={`absolute top-1 bottom-1 rounded-sm border px-2 flex items-center text-[10px] font-medium truncate cursor-grab active:cursor-grabbing ${
                        TRACK_COLORS[layer.type]
                      } ${isSelected ? 'ring-1 ring-[#F97316]' : 'opacity-85 hover:opacity-100'}`}
                      style={{
                        left: `${leftPct}%`,
                        width: `${widthPct}%`,
                      }}
                    >
                      <span className="truncate">{label}</span>
                    </div>

                    {/* Keyframe Diamonds (clamped away from 0%/100% edges) */}
                    {keyframeTimes.map((kt) => {
                      const rawPct = (kt / duration) * 100;
                      const clampedPct = Math.min(99.2, Math.max(0.8, rawPct));
                      return (
                        <button
                          key={`kf-${idx}-${kt}`}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectLayer(idx);
                            onSeek(kt);
                          }}
                          aria-label={`Keyframe ${label} at ${kt.toFixed(2)} detik`}
                          title={`Keyframe @ ${kt.toFixed(2)}s`}
                          className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 text-[#FACC15] hover:scale-125 transition-transform text-[11px] leading-none z-10 cursor-pointer"
                          style={{ left: `${clampedPct}%` }}
                        >
                          ◆
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
