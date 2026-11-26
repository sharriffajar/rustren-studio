import React, { useState } from 'react';
import {
  Download,
  FolderOpen,
  HelpCircle,
  Redo2,
  Save,
  Undo2,
  AlertTriangle,
  CheckCircle2,
  X,
} from 'lucide-react';
import type { ScenePreset } from '../engine/presets';

interface TopBarProps {
  projectName: string;
  presets: ScenePreset[];
  activePresetId: string;
  onSelectPreset: (id: string) => void;
  onImportClick: () => void;
  onSaveJson: () => void;
  onOpenExport: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  lintCount: number;
  onOpenLintTab: () => void;
  canvasLabel: string;
}

export const TopBar: React.FC<TopBarProps> = ({
  projectName,
  presets,
  activePresetId,
  onSelectPreset,
  onImportClick,
  onSaveJson,
  onOpenExport,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  lintCount,
  onOpenLintTab,
  canvasLabel,
}) => {
  const [helpOpen, setHelpOpen] = useState(false);
  return (
    <header className="h-12 shrink-0 bg-[#121319] border-b border-[#252630] px-4 flex items-center justify-between gap-6 select-none">
      {/* Zone 1: Brand + Project Preset */}
      <div className="flex items-center gap-4 min-w-0">
        <a
          href="https://nvm.web.id/rustren/"
          title="Back to Rustren Home"
          className="flex items-center gap-2.5 shrink-0 hover:opacity-85 transition-opacity"
        >
          <img
            src="/rustren/assets/logo.png"
            alt="Rustren"
            className="w-6 h-6 rounded object-cover"
          />
          <span className="font-bold text-sm tracking-tight text-[#F4F4F6] whitespace-nowrap">
            Rustren Studio
          </span>
        </a>

        <span className="text-[#343542]" aria-hidden="true">
          /
        </span>

        <label className="sr-only" htmlFor="preset-selector">
          Select Scene Preset
        </label>
        <select
          id="preset-selector"
          aria-label="Select Scene Preset"
          value={activePresetId}
          onChange={(e) => onSelectPreset(e.target.value)}
          className="bg-[#1A1B23] text-[#E4E4E7] text-xs font-medium px-2.5 py-1.5 rounded border border-[#2C2D39] focus:outline-none focus:border-[#F97316] max-w-[340px] truncate cursor-pointer"
        >
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.aspect})
            </option>
          ))}
          {activePresetId === 'custom' && (
            <option value="custom">{projectName}</option>
          )}
        </select>

        <span className="hidden lg:inline text-xs font-mono tabular-nums text-[#8B8B96] whitespace-nowrap">
          {canvasLabel}
        </span>
      </div>

      {/* Zone 2: Undo/Redo, Import, Lint */}
      <nav aria-label="Workspace actions" className="flex items-center gap-2 shrink-0">
        <div className="flex items-center border border-[#272834] rounded overflow-hidden bg-[#171820]">
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            aria-label="Undo"
            title="Undo (Ctrl+Z)"
            className="px-2 py-1.5 text-[#A1A1AA] hover:text-white hover:bg-[#242530] disabled:opacity-35 disabled:pointer-events-none transition-colors"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={onRedo}
            disabled={!canRedo}
            aria-label="Redo"
            title="Redo (Ctrl+Y)"
            className="px-2 py-1.5 text-[#A1A1AA] hover:text-white hover:bg-[#242530] border-l border-[#272834] disabled:opacity-35 disabled:pointer-events-none transition-colors"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>
        </div>

        <button
          type="button"
          onClick={onOpenLintTab}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded border transition-colors whitespace-nowrap shrink-0 ${
            lintCount > 0
              ? 'border-[#D97706]/50 bg-[#D97706]/10 text-[#FBBF24] hover:bg-[#D97706]/20'
              : 'border-[#272834] bg-[#171820] text-[#A1A1AA] hover:text-white'
          }`}
          title="Check Rustren scene validation & lint"
        >
          {lintCount > 0 ? (
            <>
              <AlertTriangle className="w-3.5 h-3.5" />
              <span className="tabular-nums">{lintCount} Lint</span>
            </>
          ) : (
            <>
              <CheckCircle2 className="w-3.5 h-3.5 text-[#34D399]" />
              <span>Valid</span>
            </>
          )}
        </button>

        <button
          type="button"
          onClick={onImportClick}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-[#D4D4D8] bg-[#171820] hover:bg-[#23242F] border border-[#272834] rounded transition-colors whitespace-nowrap shrink-0"
        >
          <FolderOpen className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Open Scene</span>
        </button>

        <button
          type="button"
          onClick={onSaveJson}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-[#D4D4D8] bg-[#171820] hover:bg-[#23242F] border border-[#272834] rounded transition-colors whitespace-nowrap shrink-0"
          title="Save Rustren .json file locally"
        >
          <Save className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Save JSON</span>
        </button>
      </nav>

      {/* Zone 3: Help & Primary CTA */}
      <div className="flex items-center gap-2 shrink-0 relative">
        <button
          type="button"
          onClick={() => setHelpOpen((v) => !v)}
          title="Keyboard shortcuts & quick guide"
          aria-label="Help and shortcuts"
          className="p-1.5 rounded text-[#A1A1AA] hover:text-white bg-[#171820] hover:bg-[#23242F] border border-[#272834] transition-colors"
        >
          <HelpCircle className="w-3.5 h-3.5" />
        </button>

        {helpOpen && (
          <div className="absolute right-0 top-10 z-50 w-72 rounded-lg bg-[#14151C] border border-[#2C2D3B] shadow-2xl p-3 text-xs text-[#D4D4D8] space-y-2">
            <div className="flex items-center justify-between border-b border-[#252630] pb-1.5">
              <span className="font-bold text-white">Rustren Studio Guide</span>
              <button type="button" onClick={() => setHelpOpen(false)} className="text-[#8B8B96] hover:text-white">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <ul className="space-y-1 text-[11px] text-[#A1A1AA]">
              <li><strong className="text-white">Space</strong> — Play / Pause timeline</li>
              <li><strong className="text-white">← / →</strong> — Step 1 frame back / forward</li>
              <li><strong className="text-white">Ctrl+Z / Ctrl+Shift+Z</strong> — Undo / Redo</li>
              <li><strong className="text-white">Drag &amp; Drop</strong> — Open `.json` scene, `.html`, image, or Lottie `.json`</li>
              <li><strong className="text-white">Annotate</strong> — Click or drag on frame to pin review notes for AI Director</li>
              <li><strong className="text-white">Assets Tab</strong> — 56 free Backdrops, 3D Props, Video Loops &amp; CC0 Audio</li>
            </ul>
          </div>
        )}

        <button
          type="button"
          onClick={onOpenExport}
          className="flex items-center gap-2 px-3.5 py-1.5 rounded bg-[#F97316] hover:bg-[#FB923C] text-[#09090D] font-bold text-xs transition-colors whitespace-nowrap shrink-0 cursor-pointer"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Export Video</span>
        </button>
      </div>
    </header>
  );
};
