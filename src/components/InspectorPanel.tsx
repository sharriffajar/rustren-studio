import React from 'react';
import { Plus, Trash2, Upload } from 'lucide-react';
import type {
  Anchor,
  Animation,
  AnimProperty,
  CanvasConfig,
  DynamicText,
  Easing,
  Layer,
  RustrenScene,
} from '../engine/types';

interface InspectorPanelProps {
  scene: RustrenScene;
  selectedLayerIndex: number | null;
  onUpdateCanvas: (patch: Partial<CanvasConfig>) => void;
  onUpdateLayer: (idx: number, updater: (layer: Layer) => Layer) => void;
}

const ANIM_PROPERTIES: AnimProperty[] = [
  'opacity',
  'x',
  'y',
  'scale',
  'rotation',
  'width',
  'height',
  'r',
  'radius',
  'skew_x',
  'color',
  'border_color',
];

const EASINGS: Easing[] = [
  'spring',
  'ease_out',
  'ease_in_out',
  'ease_out_expo',
  'ease_out_back',
  'ease_out_bounce',
  'ease_in',
  'linear',
];

const ANCHORS: Anchor[] = [
  'top_left',
  'top_center',
  'top_right',
  'center_left',
  'center',
  'center_right',
  'bottom_left',
  'bottom_center',
  'bottom_right',
];

export const InspectorPanel: React.FC<InspectorPanelProps> = ({
  scene,
  selectedLayerIndex,
  onUpdateCanvas,
  onUpdateLayer,
}) => {
  const layer =
    selectedLayerIndex !== null && scene.layers[selectedLayerIndex]
      ? scene.layers[selectedLayerIndex]
      : null;

  if (!layer || selectedLayerIndex === null) {
    const c = scene.canvas;
    return (
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        <div>
          <h3 className="text-xs font-semibold text-[#E4E4E7] mb-2">Preset Rasio Canvas</h3>
          <div className="grid grid-cols-3 gap-1.5">
            {[
              { label: '16:9 HD', w: 1280, h: 720 },
              { label: '9:16 Reels', w: 1080, h: 1920 },
              { label: '1:1 Square', w: 1080, h: 1080 },
            ].map((p) => {
              const active = c.width === p.w && c.height === p.h;
              return (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => onUpdateCanvas({ width: p.w, height: p.h })}
                  className={`py-1.5 px-2 rounded text-[11px] font-medium border transition-colors ${
                    active
                      ? 'bg-[#F97316]/15 border-[#F97316] text-[#FDBA74]'
                      : 'bg-[#171820] border-[#272834] text-[#A1A1AA] hover:text-white'
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2.5">
          <FieldNumber
            label="Width (px)"
            value={c.width}
            min={128}
            max={3840}
            onChange={(v) => onUpdateCanvas({ width: v })}
          />
          <FieldNumber
            label="Height (px)"
            value={c.height}
            min={128}
            max={3840}
            onChange={(v) => onUpdateCanvas({ height: v })}
          />
          <FieldNumber
            label="FPS"
            value={c.fps}
            min={12}
            max={60}
            onChange={(v) => onUpdateCanvas({ fps: v })}
          />
          <FieldNumber
            label="Duration (s)"
            value={c.duration_secs}
            min={0.5}
            max={120}
            step={0.5}
            onChange={(v) => onUpdateCanvas({ duration_secs: v })}
          />
        </div>

        <div>
          <label className="block text-[11px] text-[#8B8B96] mb-1" htmlFor="canvas-bg">
            Background Color
          </label>
          <div className="flex items-center gap-2">
            <input
              id="canvas-bg"
              type="color"
              value={c.background || '#09090D'}
              onChange={(e) => onUpdateCanvas({ background: e.target.value })}
              className="w-8 h-8 rounded bg-transparent border border-[#2C2D39] cursor-pointer"
            />
            <input
              type="text"
              aria-label="Background hex color"
              value={c.background || '#09090D'}
              onChange={(e) => onUpdateCanvas({ background: e.target.value })}
              className="flex-1 bg-[#171820] border border-[#2C2D39] rounded px-2.5 py-1.5 font-mono text-xs text-[#E4E4E7] focus:outline-none focus:border-[#F97316]"
            />
          </div>
        </div>

        <p className="text-[11px] text-[#71717A] leading-relaxed pt-2 border-t border-[#22232E]">
          Select a layer on the left or click an element on the canvas to edit transform properties and animation keyframes.
        </p>
      </div>
    );
  }

  const update = (patch: Record<string, unknown>) => {
    onUpdateLayer(selectedLayerIndex, (curr) => ({ ...curr, ...patch }) as Layer);
  };

  const animations = layer.animations || [];

  const handleAddAnimation = () => {
    const newAnim: Animation = {
      property: 'opacity',
      from: 0,
      to: 1,
      start_sec: layer.start_sec ?? 0,
      end_sec: Math.min(scene.canvas.duration_secs, (layer.start_sec ?? 0) + 0.8),
      easing: 'ease_out',
    };
    update({ animations: [...animations, newAnim] });
  };

  const handleUpdateAnim = (aIdx: number, patch: Partial<Animation>) => {
    const next = animations.map((a, i) => (i === aIdx ? { ...a, ...patch } : a));
    update({ animations: next });
  };

  const handleRemoveAnim = (aIdx: number) => {
    update({ animations: animations.filter((_, i) => i !== aIdx) });
  };

  const handleImageFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        update({ src: reader.result });
      }
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-4">
      {/* Layer Identity */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-[#A1A1AA]">
            Layer · <span className="font-mono text-[#F97316] uppercase">{layer.type}</span>
          </span>
        </div>
        <input
          type="text"
          aria-label="Layer name"
          value={layer.name || ''}
          placeholder={`${layer.type} #${selectedLayerIndex + 1}`}
          onChange={(e) => update({ name: e.target.value })}
          className="w-full bg-[#171820] border border-[#2C2D39] rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-[#F97316]"
        />
      </div>

      {/* Timing */}
      <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[#22232E]">
        <FieldNumber
          label="Start (s)"
          value={layer.start_sec ?? 0}
          min={0}
          max={scene.canvas.duration_secs}
          step={0.1}
          onChange={(v) => update({ start_sec: v })}
        />
        <FieldNumber
          label="End (s)"
          value={layer.end_sec ?? scene.canvas.duration_secs}
          min={0}
          max={scene.canvas.duration_secs}
          step={0.1}
          onChange={(v) => update({ end_sec: v })}
        />
      </div>

      {/* Position & Geometry */}
      <div className="space-y-2 pt-2 border-t border-[#22232E]">
        <div className="text-[11px] font-semibold text-[#A1A1AA]">Transform</div>
        <div className="grid grid-cols-2 gap-2">
          {layer.type === 'circle' ? (
            <>
              <FieldNumber label="CX" value={layer.cx ?? 0} onChange={(v) => update({ cx: v })} />
              <FieldNumber label="CY" value={layer.cy ?? 0} onChange={(v) => update({ cy: v })} />
              <FieldNumber label="Radius" value={layer.r} min={1} onChange={(v) => update({ r: v })} />
            </>
          ) : (
            <>
              <FieldNumber label="X" value={layer.x ?? 0} onChange={(v) => update({ x: v })} />
              <FieldNumber label="Y" value={layer.y ?? 0} onChange={(v) => update({ y: v })} />
              {'width' in layer && (
                <FieldNumber
                  label="Width"
                  value={layer.width ?? 200}
                  min={1}
                  onChange={(v) => update({ width: v })}
                />
              )}
              {'height' in layer && (
                <FieldNumber
                  label="Height"
                  value={layer.height ?? 100}
                  min={1}
                  onChange={(v) => update({ height: v })}
                />
              )}
            </>
          )}

          {'scale' in layer && (
            <FieldNumber
              label="Scale"
              value={layer.scale ?? 1}
              min={0.05}
              max={10}
              step={0.05}
              onChange={(v) => update({ scale: v })}
            />
          )}
          {'rotation' in layer && (
            <FieldNumber
              label="Rotation (°)"
              value={layer.rotation ?? 0}
              step={1}
              onChange={(v) => update({ rotation: v })}
            />
          )}
          {layer.type === 'rect' && (
            <FieldNumber
              label="Corner Radius"
              value={layer.radius ?? 0}
              min={0}
              onChange={(v) => update({ radius: v })}
            />
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 items-end">
          <div>
            <label className="block text-[10px] text-[#8B8B96] mb-1">Anchor</label>
            <select
              value={layer.anchor || 'top_left'}
              onChange={(e) => update({ anchor: e.target.value as Anchor })}
              className="w-full bg-[#171820] border border-[#2C2D39] rounded px-2 py-1 text-xs text-[#E4E4E7] focus:outline-none focus:border-[#F97316]"
            >
              {ANCHORS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </div>
          <div>
            <div className="flex justify-between text-[10px] text-[#8B8B96] mb-1">
              <span>Opacity</span>
              <span className="font-mono tabular-nums">{Math.round((layer.opacity ?? 1) * 100)}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={layer.opacity ?? 1}
              onChange={(e) => update({ opacity: parseFloat(e.target.value) })}
              className="w-full studio-range"
            />
          </div>
        </div>
      </div>

      {/* Color & Style */}
      {'color' in layer && (
        <div className="space-y-2 pt-2 border-t border-[#22232E]">
          <div className="text-[11px] font-semibold text-[#A1A1AA]">Color & Style</div>
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label="Layer color"
              value={layer.color || '#FFFFFF'}
              onChange={(e) => update({ color: e.target.value })}
              className="w-7 h-7 rounded bg-transparent border border-[#2C2D39] cursor-pointer"
            />
            <input
              type="text"
              aria-label="Hex color code"
              value={layer.color || '#FFFFFF'}
              onChange={(e) => update({ color: e.target.value })}
              className="flex-1 bg-[#171820] border border-[#2C2D39] rounded px-2 py-1 font-mono text-xs text-[#E4E4E7] focus:outline-none focus:border-[#F97316]"
            />
          </div>
        </div>
      )}

      {/* Text Specific Controls */}
      {layer.type === 'text' && (
        <div className="space-y-2.5 pt-2 border-t border-[#22232E]">
          <div className="text-[11px] font-semibold text-[#A1A1AA]">Text Content</div>

          <div>
            <label className="block text-[10px] text-[#8B8B96] mb-1">Dynamic Text Mode</label>
            <select
              value={layer.dynamic?.mode || 'static'}
              onChange={(e) => {
                const mode = e.target.value;
                if (mode === 'static') {
                  update({ dynamic: undefined, content: layer.content || 'New Text' });
                } else if (mode === 'typewriter') {
                  const dyn: DynamicText = {
                    mode: 'typewriter',
                    text: layer.content || 'RUSTREN STUDIO',
                    start_sec: layer.start_sec ?? 0,
                    end_sec: Math.min(scene.canvas.duration_secs, (layer.start_sec ?? 0) + 1.5),
                    cursor: '_',
                  };
                  update({ dynamic: dyn });
                } else if (mode === 'counter') {
                  const dyn: DynamicText = {
                    mode: 'counter',
                    from: 0,
                    to: 100,
                    suffix: '%',
                    start_sec: layer.start_sec ?? 0,
                    end_sec: Math.min(scene.canvas.duration_secs, (layer.start_sec ?? 0) + 2.0),
                    easing: 'ease_out_expo',
                  };
                  update({ dynamic: dyn });
                } else if (mode === 'timecode') {
                  update({ dynamic: { mode: 'timecode', format: 'mm:ss.cc' } });
                }
              }}
              className="w-full bg-[#171820] border border-[#2C2D39] rounded px-2 py-1 text-xs text-[#E4E4E7] focus:outline-none focus:border-[#F97316]"
            >
              <option value="static">Static</option>
              <option value="typewriter">Typewriter</option>
              <option value="counter">Counter</option>
              <option value="timecode">Live Timecode</option>
            </select>
          </div>

          {!layer.dynamic && (
            <textarea
              rows={4}
              aria-label="Text content"
              value={layer.content || ''}
              onChange={(e) => update({ content: e.target.value })}
              className="w-full min-h-[84px] bg-[#171820] border border-[#2C2D39] rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-[#F97316] resize-y"
            />
          )}

          {layer.dynamic?.mode === 'typewriter' && (
            <input
              type="text"
              aria-label="Typewriter text"
              value={layer.dynamic.text}
              onChange={(e) =>
                update({ dynamic: { ...layer.dynamic!, mode: 'typewriter', text: e.target.value } })
              }
              className="w-full bg-[#171820] border border-[#2C2D39] rounded px-2.5 py-1.5 text-xs text-white focus:outline-none focus:border-[#F97316]"
            />
          )}

          <div className="grid grid-cols-2 gap-2">
            <FieldNumber
              label="Font Size"
              value={layer.font_size ?? 48}
              min={8}
              max={240}
              onChange={(v) => update({ font_size: v })}
            />
            <div>
              <label className="block text-[10px] text-[#8B8B96] mb-1">Font Weight</label>
              <select
                value={layer.font_weight || 'normal'}
                onChange={(e) => update({ font_weight: e.target.value })}
                className="w-full bg-[#171820] border border-[#2C2D39] rounded px-2 py-1 text-xs text-[#E4E4E7] focus:outline-none focus:border-[#F97316]"
              >
                <option value="normal">Regular</option>
                <option value="bold">Bold</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Image Upload Control */}
      {layer.type === 'image' && (
        <div className="space-y-2 pt-2 border-t border-[#22232E]">
          <div className="text-[11px] font-semibold text-[#A1A1AA]">Image Source</div>
          <label className="flex items-center justify-center gap-1.5 py-2 px-3 rounded bg-[#1A1B24] hover:bg-[#252736] border border-[#2C2D39] text-xs font-medium text-[#E4E4E7] cursor-pointer transition-colors">
            <Upload className="w-3.5 h-3.5 text-[#F97316]" />
            <span>Upload Local Image</span>
            <input type="file" accept="image/*" onChange={handleImageFileUpload} className="hidden" />
          </label>
        </div>
      )}

      {/* Keyframe Animations List */}
      <div className="space-y-2 pt-2 border-t border-[#22232E]">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-[#A1A1AA]">
            Animations & Keyframes ({animations.length})
          </span>
          <button
            type="button"
            onClick={handleAddAnimation}
            className="flex items-center gap-1 px-2 py-0.5 rounded bg-[#232430] hover:bg-[#2E3040] text-[11px] font-medium text-[#FDBA74] transition-colors"
          >
            <Plus className="w-3 h-3" />
            <span>Add</span>
          </button>
        </div>

        {animations.length === 0 ? (
          <div className="text-[11px] text-[#71717A]">
            No animations on this layer yet. Click Add to create a keyframe transition.
          </div>
        ) : (
          <div className="space-y-2">
            {animations.map((anim, aIdx) => (
              <div
                key={aIdx}
                className="p-2 rounded bg-[#161720] border border-[#262735] space-y-2"
              >
                <div className="flex items-center justify-between gap-1.5">
                  <select
                    aria-label="Animation property"
                    value={anim.property}
                    onChange={(e) => handleUpdateAnim(aIdx, { property: e.target.value as AnimProperty })}
                    className="bg-[#0F1016] border border-[#2C2D39] rounded px-1.5 py-0.5 font-mono text-[11px] text-[#FACC15]"
                  >
                    {ANIM_PROPERTIES.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>

                  <select
                    aria-label="Animation easing"
                    value={anim.easing || 'ease_out'}
                    onChange={(e) => handleUpdateAnim(aIdx, { easing: e.target.value as Easing })}
                    className="flex-1 bg-[#0F1016] border border-[#2C2D39] rounded px-1.5 py-0.5 text-[11px] text-[#E4E4E7]"
                  >
                    {EASINGS.map((es) => (
                      <option key={es} value={es}>
                        {es}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    onClick={() => handleRemoveAnim(aIdx)}
                    aria-label={`Delete animation ${anim.property}`}
                    className="p-1 text-[#71717A] hover:text-[#F87171]"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-1.5">
                  <FieldNumber
                    label="From"
                    value={Number(anim.from ?? 0)}
                    step={0.1}
                    onChange={(v) => handleUpdateAnim(aIdx, { from: v })}
                  />
                  <FieldNumber
                    label="To"
                    value={Number(anim.to ?? 1)}
                    step={0.1}
                    onChange={(v) => handleUpdateAnim(aIdx, { to: v })}
                  />
                  <FieldNumber
                    label="Start (s)"
                    value={anim.start_sec ?? 0}
                    min={0}
                    max={scene.canvas.duration_secs}
                    step={0.1}
                    onChange={(v) => handleUpdateAnim(aIdx, { start_sec: v })}
                  />
                  <FieldNumber
                    label="End (s)"
                    value={anim.end_sec ?? 1}
                    min={0}
                    max={scene.canvas.duration_secs}
                    step={0.1}
                    onChange={(v) => handleUpdateAnim(aIdx, { end_sec: v })}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

interface FieldNumberProps {
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange: (val: number) => void;
}

const FieldNumber: React.FC<FieldNumberProps> = ({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}) => (
  <div>
    <label className="block text-[10px] text-[#8B8B96] mb-0.5">{label}</label>
    <input
      type="number"
      value={Number.isFinite(value) ? value : 0}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        const parsed = parseFloat(e.target.value);
        if (Number.isFinite(parsed)) onChange(parsed);
      }}
      className="w-full bg-[#171820] border border-[#2C2D39] rounded px-2 py-1 font-mono text-xs tabular-nums text-[#E4E4E7] focus:outline-none focus:border-[#F97316]"
    />
  </div>
);
