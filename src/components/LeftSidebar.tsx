import React, { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Circle,
  Code2,
  Copy,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Layers,
  Sparkles,
  Square,
  Trash2,
  Type,
  Wrench,
} from 'lucide-react';
import type { Layer, LintWarning, RustrenScene } from '../engine/types';

export type LeftTab = 'layers' | 'json' | 'lint';

interface LeftSidebarProps {
  scene: RustrenScene;
  activeTab: LeftTab;
  onTabChange: (tab: LeftTab) => void;
  selectedLayerIndex: number | null;
  onSelectLayer: (idx: number | null) => void;
  onAddLayer: (type: Layer['type']) => void;
  onToggleHidden: (idx: number) => void;
  onMoveLayer: (idx: number, dir: -1 | 1) => void;
  onDuplicateLayer: (idx: number) => void;
  onDeleteLayer: (idx: number) => void;
  onApplyRawJson: (scene: RustrenScene) => void;
  lintWarnings: LintWarning[];
  onAutoFixLint: () => void;
}

const LAYER_BADGE: Record<Layer['type'], string> = {
  rect: 'RECT',
  circle: 'CIRC',
  text: 'TEXT',
  svg: 'SVG',
  image: 'IMG',
  waveform: 'WAVE',
  particles: 'PART',
  container: 'CONT',
};

export const LeftSidebar: React.FC<LeftSidebarProps> = ({
  scene,
  activeTab,
  onTabChange,
  selectedLayerIndex,
  onSelectLayer,
  onAddLayer,
  onToggleHidden,
  onMoveLayer,
  onDuplicateLayer,
  onDeleteLayer,
  onApplyRawJson,
  lintWarnings,
  onAutoFixLint,
}) => {
  const [jsonDraft, setJsonDraft] = useState(() => JSON.stringify(scene, null, 2));
  const [jsonError, setJsonError] = useState<string | null>(null);

  useEffect(() => {
    setJsonDraft(JSON.stringify(scene, null, 2));
    setJsonError(null);
  }, [scene]);

  const handleApplyJson = () => {
    try {
      const parsed = JSON.parse(jsonDraft) as RustrenScene;
      if (!parsed.canvas || !Array.isArray(parsed.layers)) {
        setJsonError('JSON harus memiliki properti "canvas" dan array "layers".');
        return;
      }
      setJsonError(null);
      onApplyRawJson(parsed);
    } catch (err) {
      setJsonError((err as Error).message);
    }
  };

  return (
    <aside
      aria-label="Scene hierarchy and code"
      className="w-[270px] shrink-0 bg-[#121319] border-r border-[#252630] flex flex-col min-h-0"
    >
      {/* Segmented Tabs */}
      <div
        role="tablist"
        aria-label="Sidebar mode"
        className="h-9 shrink-0 bg-[#171820] border-b border-[#252630] px-2 flex items-center gap-1"
      >
        <button
          role="tab"
          type="button"
          aria-selected={activeTab === 'layers'}
          onClick={() => onTabChange('layers')}
          className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded transition-colors whitespace-nowrap ${
            activeTab === 'layers'
              ? 'bg-[#252633] text-white'
              : 'text-[#8B8B96] hover:text-[#E4E4E7]'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>Layers</span>
          <span className="font-mono text-[10px] text-[#71717A] tabular-nums">
            {scene.layers.length}
          </span>
        </button>

        <button
          role="tab"
          type="button"
          aria-selected={activeTab === 'json'}
          onClick={() => onTabChange('json')}
          className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded transition-colors whitespace-nowrap ${
            activeTab === 'json'
              ? 'bg-[#252633] text-white'
              : 'text-[#8B8B96] hover:text-[#E4E4E7]'
          }`}
        >
          <Code2 className="w-3.5 h-3.5" />
          <span>JSON</span>
        </button>

        <button
          role="tab"
          type="button"
          aria-selected={activeTab === 'lint'}
          onClick={() => onTabChange('lint')}
          className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded transition-colors whitespace-nowrap ${
            activeTab === 'lint'
              ? 'bg-[#252633] text-white'
              : 'text-[#8B8B96] hover:text-[#E4E4E7]'
          }`}
        >
          <AlertTriangle
            className={`w-3.5 h-3.5 ${lintWarnings.length > 0 ? 'text-[#FBBF24]' : ''}`}
          />
          <span>Lint</span>
          {lintWarnings.length > 0 && (
            <span className="font-mono text-[10px] text-[#FBBF24] tabular-nums">
              {lintWarnings.length}
            </span>
          )}
        </button>
      </div>

      {/* TAB 1: LAYERS */}
      {activeTab === 'layers' && (
        <div className="flex-1 flex flex-col min-h-0">
          {/* Quick Add Layer Strip */}
          <div className="p-2 border-b border-[#252630] bg-[#14151C]">
            <div className="text-[11px] font-medium text-[#8B8B96] mb-1.5">Add Layer</div>
            <div className="grid grid-cols-3 gap-1">
              <button
                type="button"
                onClick={() => onAddLayer('text')}
                className="flex items-center justify-center gap-1 py-1.5 px-2 rounded bg-[#1B1C25] hover:bg-[#262836] border border-[#2B2C3A] text-[11px] font-medium text-[#E4E4E7] transition-colors"
              >
                <Type className="w-3 h-3 text-[#F97316]" />
                <span>Text</span>
              </button>
              <button
                type="button"
                onClick={() => onAddLayer('rect')}
                className="flex items-center justify-center gap-1 py-1.5 px-2 rounded bg-[#1B1C25] hover:bg-[#262836] border border-[#2B2C3A] text-[11px] font-medium text-[#E4E4E7] transition-colors"
              >
                <Square className="w-3 h-3 text-[#38BDF8]" />
                <span>Rect</span>
              </button>
              <button
                type="button"
                onClick={() => onAddLayer('circle')}
                className="flex items-center justify-center gap-1 py-1.5 px-2 rounded bg-[#1B1C25] hover:bg-[#262836] border border-[#2B2C3A] text-[11px] font-medium text-[#E4E4E7] transition-colors"
              >
                <Circle className="w-3 h-3 text-[#A78BFA]" />
                <span>Circle</span>
              </button>
              <button
                type="button"
                onClick={() => onAddLayer('waveform')}
                className="flex items-center justify-center gap-1 py-1.5 px-2 rounded bg-[#1B1C25] hover:bg-[#262836] border border-[#2B2C3A] text-[11px] font-medium text-[#E4E4E7] transition-colors"
              >
                <Activity className="w-3 h-3 text-[#34D399]" />
                <span>Wave</span>
              </button>
              <button
                type="button"
                onClick={() => onAddLayer('particles')}
                className="flex items-center justify-center gap-1 py-1.5 px-2 rounded bg-[#1B1C25] hover:bg-[#262836] border border-[#2B2C3A] text-[11px] font-medium text-[#E4E4E7] transition-colors"
              >
                <Sparkles className="w-3 h-3 text-[#FACC15]" />
                <span>Particles</span>
              </button>
              <button
                type="button"
                onClick={() => onAddLayer('image')}
                className="flex items-center justify-center gap-1 py-1.5 px-2 rounded bg-[#1B1C25] hover:bg-[#262836] border border-[#2B2C3A] text-[11px] font-medium text-[#E4E4E7] transition-colors"
              >
                <ImageIcon className="w-3 h-3 text-[#FB7185]" />
                <span>Image</span>
              </button>
            </div>
          </div>

          {/* Canvas Settings Row */}
          <div className="px-2 pt-2">
            <button
              type="button"
              onClick={() => onSelectLayer(null)}
              className={`w-full text-left px-2.5 py-2 rounded text-xs flex items-center justify-between border transition-colors ${
                selectedLayerIndex === null
                  ? 'bg-[#F97316]/12 border-[#F97316]/60 text-white'
                  : 'bg-[#171820] border-[#252630] text-[#A1A1AA] hover:text-white'
              }`}
            >
              <span className="font-semibold">Canvas & Composition</span>
              <span className="font-mono text-[10px] tabular-nums text-[#8B8B96]">
                {scene.canvas.width}×{scene.canvas.height}
              </span>
            </button>
          </div>

          {/* Layer Hierarchy List */}
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {scene.layers.length === 0 ? (
              <div className="text-center py-8 px-3 text-xs text-[#71717A]">
                No layers yet. Add a layer above or use the AI Director panel.
              </div>
            ) : (
              scene.layers.map((layer, idx) => {
                const isSelected = selectedLayerIndex === idx;
                const label = layer.name || layer.id || `${layer.type} #${idx + 1}`;
                const animCount = layer.animations?.length ?? 0;

                return (
                  <div
                    key={`${idx}-${label}`}
                    className={`group rounded border transition-colors ${
                      isSelected
                        ? 'bg-[#1E202B] border-[#F97316]'
                        : 'bg-transparent border-transparent hover:bg-[#191A23] hover:border-[#252630]'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 px-2 py-1.5">
                      <button
                        type="button"
                        onClick={() => onToggleHidden(idx)}
                        aria-label={layer.hidden ? `Show ${label}` : `Hide ${label}`}
                        className="p-0.5 text-[#71717A] hover:text-white shrink-0"
                      >
                        {layer.hidden ? (
                          <EyeOff className="w-3.5 h-3.5 text-[#52525B]" />
                        ) : (
                          <Eye className="w-3.5 h-3.5" />
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => onSelectLayer(idx)}
                        className="flex-1 flex items-center gap-2 min-w-0 text-left"
                      >
                        <span className="font-mono text-[9px] font-semibold text-[#A1A1AA] w-8 shrink-0">
                          {LAYER_BADGE[layer.type]}
                        </span>
                        <span
                          className={`text-xs truncate flex-1 ${
                            layer.hidden ? 'text-[#52525B] line-through' : 'text-[#E4E4E7]'
                          }`}
                        >
                          {label}
                        </span>
                        {animCount > 0 && (
                          <span
                            className="font-mono text-[10px] text-[#FACC15] tabular-nums shrink-0"
                            title={`${animCount} animasi`}
                          >
                            ◆{animCount}
                          </span>
                        )}
                      </button>
                    </div>

                    {isSelected && (
                      <div className="flex items-center justify-end gap-1 px-2 pb-1.5 pt-0.5 border-t border-[#262735]">
                        <button
                          type="button"
                          onClick={() => onMoveLayer(idx, -1)}
                          disabled={idx === 0}
                          aria-label={`Pindah ${label} ke bawah`}
                          title="Send ke belakang (z-order)"
                          className="p-1 text-[#A1A1AA] hover:text-white disabled:opacity-30"
                        >
                          <ArrowUp className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onMoveLayer(idx, 1)}
                          disabled={idx === scene.layers.length - 1}
                          aria-label={`Pindah ${label} ke atas`}
                          title="Majukan ke depan (z-order)"
                          className="p-1 text-[#A1A1AA] hover:text-white disabled:opacity-30"
                        >
                          <ArrowDown className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDuplicateLayer(idx)}
                          aria-label={`Duplikat ${label}`}
                          title="Duplikat layer"
                          className="p-1 text-[#A1A1AA] hover:text-white"
                        >
                          <Copy className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onDeleteLayer(idx)}
                          aria-label={`Delete ${label}`}
                          title="Delete layer"
                          className="p-1 text-[#A1A1AA] hover:text-[#F87171]"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* TAB 2: LIVE JSON CODE EDITOR */}
      {activeTab === 'json' && (
        <div className="flex-1 flex flex-col min-h-0 p-2.5 gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-[#A1A1AA]">Rustren v1.1 Scene JSON</span>
            <button
              type="button"
              onClick={handleApplyJson}
              className="px-2.5 py-1 rounded bg-[#F97316] hover:bg-[#FB923C] text-[#09090D] font-bold text-[11px] transition-colors"
            >
              Apply JSON
            </button>
          </div>
          {jsonError && (
            <div className="text-[11px] text-[#FCA5A5] bg-[#7F1D1D]/30 border border-[#EF4444]/40 rounded px-2.5 py-1.5">
              {jsonError}
            </div>
          )}
          <textarea
            aria-label="Editor kode JSON Rustren"
            value={jsonDraft}
            onChange={(e) => setJsonDraft(e.target.value)}
            spellCheck={false}
            className="flex-1 w-full bg-[#0C0D12] text-[#E4E4E7] font-mono text-[11px] leading-relaxed p-2.5 rounded border border-[#262734] focus:outline-none focus:border-[#F97316] resize-none"
          />
        </div>
      )}

      {/* TAB 3: LINT DIAGNOSTICS */}
      {activeTab === 'lint' && (
        <div className="flex-1 flex flex-col min-h-0 p-3 gap-3 overflow-y-auto">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[#E4E4E7]">Rustren Scene Linter</span>
            {lintWarnings.length > 0 && (
              <button
                type="button"
                onClick={onAutoFixLint}
                className="flex items-center gap-1 px-2 py-1 rounded bg-[#F97316] hover:bg-[#FB923C] text-[#09090D] font-bold text-[11px] transition-colors"
              >
                <Wrench className="w-3 h-3" />
                <span>Auto-Fix</span>
              </button>
            )}
          </div>

          {lintWarnings.length === 0 ? (
            <div className="p-4 rounded bg-[#14161D] border border-[#252630] text-center space-y-2">
              <CheckCircle2 className="w-6 h-6 text-[#34D399] mx-auto" />
              <div className="text-xs font-semibold text-[#E4E4E7]">
                All checks passed
              </div>
              <p className="text-[11px] text-[#8B8B96] leading-relaxed">
                Font size, layer duration, text contrast, and canvas bounds checked against Rustren v1.1 rules.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {lintWarnings.map((w, i) => (
                <div
                  key={`${w.code}-${w.path}-${i}`}
                  className="p-2.5 rounded bg-[#181512] border border-[#D97706]/35 space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[10px] font-semibold text-[#FBBF24]">
                      {w.code}
                    </span>
                    <span className="font-mono text-[10px] text-[#71717A] truncate">
                      {w.path}
                    </span>
                  </div>
                  <p className="text-xs text-[#E4E4E7] leading-snug">{w.message}</p>
                  {w.fix && (
                    <p className="text-[11px] text-[#A1A1AA]">Saran: {w.fix}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </aside>
  );
};
