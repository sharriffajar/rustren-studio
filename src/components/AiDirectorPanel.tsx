import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Film,
  ImagePlus,
  KeyRound,
  Loader2,
  RotateCcw,
  Send,
  Sparkles,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import { testAiConnection } from '../engine/aiClient';
import type {
  AiChatMessage,
  AiProviderConfig,
  AiProviderId,
  AiReferenceImage,
  FrameNote,
  RustrenScene,
} from '../engine/types';
import {
  analyzeVideoFile,
  aspectRatioLabel,
  type VideoAnalysisResult,
} from '../engine/videoAnalyzer';

interface AiDirectorPanelProps {
  config: AiProviderConfig;
  onUpdateConfig: (patch: Partial<AiProviderConfig>) => void;
  onClearSavedKey: () => void;
  messages: AiChatMessage[];
  isRunning: boolean;
  onSendCommand: (
    prompt: string,
    mode: 'edit' | 'new',
    references: AiReferenceImage[],
    videoAnalysis?: VideoAnalysisResult,
  ) => void;
  onRevertScene: (scene: RustrenScene) => void;
  studioGeminiAvailable: boolean;
  frameNotes: FrameNote[];
  onSeekToTime: (t: number) => void;
  onDeleteFrameNote: (id: string) => void;
  onUpdateFrameNote: (id: string, note: string) => void;
  onCopyFrameNotes: () => void;
  onClearFrameNotes: () => void;
  onApplyFrameNotes: () => void;
}

/** How many moodboard images one prompt may carry. */
const MAX_REFERENCES = 3;
const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

const PROVIDER_META: Record<
  AiProviderId,
  { label: string; defaultModel: string; keyPlaceholder: string; needsKey: boolean; needsBaseUrl?: boolean }
> = {
  gemini_byok: {
    label: 'Google Gemini (BYOK)',
    defaultModel: 'gemini-2.5-flash',
    keyPlaceholder: 'AIzaSy... (Personal API key)',
    needsKey: true,
  },
  openai: {
    label: 'OpenAI (BYOK)',
    defaultModel: 'gpt-4o-mini',
    keyPlaceholder: 'sk-proj-... (OpenAI API Key)',
    needsKey: true,
  },
  openrouter: {
    label: 'OpenRouter (BYOK)',
    defaultModel: 'google/gemini-2.5-flash',
    keyPlaceholder: 'sk-or-v1-... (OpenRouter Key)',
    needsKey: true,
  },
  anthropic: {
    label: 'Anthropic Claude (BYOK)',
    defaultModel: 'claude-sonnet-4-20250514',
    keyPlaceholder: 'sk-ant-... (Anthropic Key)',
    needsKey: true,
  },
  custom: {
    label: 'Custom / Ollama / LM Studio',
    defaultModel: 'llama3.2',
    keyPlaceholder: 'Optional (leave empty for local Ollama)',
    needsKey: false,
    needsBaseUrl: true,
  },
  studio_gemini: {
    label: 'Studio Built-in Gemini (Server)',
    defaultModel: 'gemini-4-hydrogen',
    keyPlaceholder: 'Uses server key automatically',
    needsKey: false,
  },
};

const QUICK_PROMPTS = [
  { label: 'Convert to 9:16 Vertical', prompt: 'Convert this scene layout to 9:16 vertical (1080x1920) with bold typography and a bottom progress bar.', mode: 'edit' as const },
  { label: 'Add Particles & Bounce', prompt: 'Add orange-gold confetti particles and a spring bounce animation to the main title.', mode: 'edit' as const },
  { label: '5s Product Intro', prompt: 'Create a new 5-second 1280x720 dark modern product launch intro with a typewriter title, 10,000+ user counter, and audio waveform.', mode: 'new' as const },
];

export const AiDirectorPanel: React.FC<AiDirectorPanelProps> = ({
  config,
  onUpdateConfig,
  onClearSavedKey,
  messages,
  isRunning,
  onSendCommand,
  onRevertScene,
  studioGeminiAvailable,
  frameNotes,
  onSeekToTime,
  onDeleteFrameNote,
  onUpdateFrameNote,
  onCopyFrameNotes,
  onClearFrameNotes,
  onApplyFrameNotes,
}) => {
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [editingNoteText, setEditingNoteText] = useState('');
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const chatFeedRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = chatFeedRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages.length, isRunning]);

  const handleTestConnection = async () => {
    setTestBusy(true);
    setTestResult(null);
    const res = await testAiConnection({
      provider: config.provider,
      apiKey: config.apiKey,
      model: config.model,
      baseUrl: config.baseUrl,
      useCorsProxy: config.useCorsProxy,
    });
    setTestResult({ ok: res.ok, message: res.message });
    setTestBusy(false);
  };
  const [prompt, setPrompt] = useState('');
  const [mode, setMode] = useState<'edit' | 'new'>('edit');
  const [showKey, setShowKey] = useState(false);
  const [configOpen, setConfigOpen] = useState(true);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [references, setReferences] = useState<AiReferenceImage[]>([]);
  const [videoAnalysis, setVideoAnalysis] = useState<VideoAnalysisResult | null>(null);
  const [videoBusy, setVideoBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);

  const meta = PROVIDER_META[config.provider];

  const handleProviderChange = (nextProvider: AiProviderId) => {
    setValidationError(null);
    onUpdateConfig({
      provider: nextProvider,
      model: PROVIDER_META[nextProvider].defaultModel,
    });
  };

  const handleAttachFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setValidationError(null);
    const picked = Array.from(files);
    const accepted = picked.filter((f) => ACCEPTED_IMAGE_TYPES.includes(f.type));
    if (accepted.length < picked.length) {
      setValidationError('Only PNG, JPG and WebP reference images are supported.');
    }
    const room = MAX_REFERENCES - references.length;
    if (room <= 0) {
      setValidationError(`You can attach up to ${MAX_REFERENCES} reference images.`);
      return;
    }
    const next: AiReferenceImage[] = [];
    for (const file of accepted.slice(0, room)) {
      try {
        const dataUrl = await readFileAsDataUrl(file);
        const comma = dataUrl.indexOf(',');
        if (comma < 0) continue;
        next.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          name: file.name || 'reference-image',
          mimeType: file.type,
          dataUrl,
          base64: dataUrl.slice(comma + 1),
        });
      } catch (err) {
        setValidationError(err instanceof Error ? err.message : 'Could not read the image.');
      }
    }
    if (next.length > 0) {
      setReferences((prev) => [...prev, ...next].slice(0, MAX_REFERENCES));
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleRemoveReference = (id: string) => {
    setReferences((prev) => prev.filter((r) => r.id !== id));
  };

  const handleAnalyzeVideo = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setValidationError(null);
    setVideoBusy(true);
    try {
      const result = await analyzeVideoFile(file);
      setVideoAnalysis(result);
    } catch (err) {
      setValidationError(err instanceof Error ? err.message : 'Could not analyze the video.');
    } finally {
      setVideoBusy(false);
      if (videoInputRef.current) videoInputRef.current.value = '';
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = prompt.trim();
    if (videoBusy) {
      setValidationError('Wait for the local video analysis to finish.');
      return;
    }
    if (!cleaned) {
      setValidationError('Enter a prompt for the AI first.');
      return;
    }
    if (meta.needsKey && !config.apiKey.trim()) {
      setValidationError(`Enter your personal API key for ${meta.label} to continue.`);
      setConfigOpen(true);
      return;
    }
    setValidationError(null);
    onSendCommand(cleaned, mode, references, videoAnalysis ?? undefined);
    setPrompt('');
    setReferences([]);
    setVideoAnalysis(null);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* BYOK Configuration Accordion */}
      <div className="border-b border-[#252630] bg-[#15161E] shrink-0">
        <button
          type="button"
          onClick={() => setConfigOpen((o) => !o)}
          aria-expanded={configOpen}
          className="w-full px-3 py-2 flex items-center justify-between text-left hover:bg-[#1B1C26] transition-colors"
        >
          <div className="flex items-center gap-2 min-w-0">
            <KeyRound className="w-3.5 h-3.5 text-[#F97316] shrink-0" />
            <span className="text-xs font-semibold text-[#E4E4E7] truncate">
              BYOK AI Configuration
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="font-mono text-[10px] text-[#8B8B96] truncate max-w-[105px]">
              {config.provider === 'studio_gemini'
                ? 'Server Key'
                : config.apiKey
                  ? 'Key Ready'
                  : 'No Key Set'}
            </span>
            {configOpen ? (
              <ChevronUp className="w-3.5 h-3.5 text-[#71717A]" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-[#71717A]" />
            )}
          </div>
        </button>

        {configOpen && (
          <div className="px-3 pb-2.5 pt-1.5 space-y-2 border-t border-[#22232E]">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] text-[#8B8B96] mb-0.5" htmlFor="ai-provider-select">
                  AI Provider
                </label>
                <select
                  id="ai-provider-select"
                  value={config.provider}
                  onChange={(e) => handleProviderChange(e.target.value as AiProviderId)}
                  className="w-full bg-[#0F1016] border border-[#2C2D39] rounded px-2 py-1 text-[11px] text-[#E4E4E7] focus:outline-none focus:border-[#F97316]"
                >
                  <option value="gemini_byok">Gemini (BYOK)</option>
                  <option value="openai">OpenAI (BYOK)</option>
                  <option value="openrouter">OpenRouter (BYOK)</option>
                  <option value="anthropic">Claude (BYOK)</option>
                  <option value="custom">Ollama / Custom</option>
                  {studioGeminiAvailable && (
                    <option value="studio_gemini">Studio Gemini</option>
                  )}
                </select>
              </div>

              <div>
                <label className="block text-[10px] text-[#8B8B96] mb-0.5" htmlFor="byok-model-name">
                  Model ID
                </label>
                <input
                  id="byok-model-name"
                  type="text"
                  value={config.model}
                  onChange={(e) => onUpdateConfig({ model: e.target.value })}
                  disabled={config.provider === 'studio_gemini'}
                  placeholder={meta.defaultModel}
                  className="w-full bg-[#0F1016] border border-[#2C2D39] rounded px-2 py-1 font-mono text-[11px] text-[#E4E4E7] disabled:opacity-60 focus:outline-none focus:border-[#F97316]"
                />
              </div>
            </div>

            {config.provider !== 'studio_gemini' && (
              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <label className="text-[10px] text-[#8B8B96]" htmlFor="byok-api-key">
                    Personal API Key (BYOK)
                  </label>
                  {config.apiKey && (
                    <button
                      type="button"
                      onClick={onClearSavedKey}
                      className="text-[10px] text-[#A1A1AA] hover:text-[#F87171] flex items-center gap-0.5"
                    >
                      <Trash2 className="w-2.5 h-2.5" />
                      <span>Clear Key</span>
                    </button>
                  )}
                </div>
                <div className="relative">
                  <input
                    id="byok-api-key"
                    type={showKey ? 'text' : 'password'}
                    autoComplete="off"
                    value={config.apiKey}
                    onChange={(e) => {
                      setValidationError(null);
                      onUpdateConfig({ apiKey: e.target.value });
                    }}
                    placeholder={meta.keyPlaceholder}
                    className="w-full bg-[#0F1016] border border-[#2C2D39] rounded pl-2.5 pr-8 py-1 font-mono text-[11px] text-white placeholder:text-[#52525B] focus:outline-none focus:border-[#F97316]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((s) => !s)}
                    aria-label={showKey ? 'Hide API key' : 'Show API key'}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-[#71717A] hover:text-white"
                  >
                    {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            )}

            {meta.needsBaseUrl && (
              <div>
                <label className="block text-[10px] text-[#8B8B96] mb-0.5" htmlFor="byok-base-url">
                  Base URL (OpenAI-Compatible)
                </label>
                <input
                  id="byok-base-url"
                  type="url"
                  value={config.baseUrl}
                  onChange={(e) => onUpdateConfig({ baseUrl: e.target.value })}
                  placeholder="http://localhost:11434/v1"
                  className="w-full bg-[#0F1016] border border-[#2C2D39] rounded px-2 py-1 font-mono text-[11px] text-white focus:outline-none focus:border-[#F97316]"
                />
                <label className="flex items-center gap-2 pt-1 text-[11px] text-[#A1A1AA] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.useCorsProxy ?? true}
                    onChange={(e) => onUpdateConfig({ useCorsProxy: e.target.checked })}
                    className="accent-[#F97316] rounded"
                  />
                  <span>Use Studio CORS Proxy (for non-CORS https:// APIs)</span>
                </label>
              </div>
            )}

            {config.provider !== 'studio_gemini' && (
              <div className="flex items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-[11px] text-[#A1A1AA] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={config.rememberKey}
                    onChange={(e) => onUpdateConfig({ rememberKey: e.target.checked })}
                    className="accent-[#F97316] rounded"
                  />
                  <span>Remember API key</span>
                </label>

                <button
                  type="button"
                  disabled={testBusy}
                  onClick={() => void handleTestConnection()}
                  className="flex items-center gap-1 px-2 py-1 rounded bg-[#1D1F2B] hover:bg-[#272A3A] border border-[#343648] text-[11px] font-medium text-[#E4E4E7] disabled:opacity-50 whitespace-nowrap"
                >
                  {testBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3 text-[#F97316]" />}
                  <span>{testBusy ? 'Testing...' : 'Test Connection'}</span>
                </button>
              </div>
            )}

            {testResult && (
              <div
                className={`text-[11px] rounded px-2 py-1.5 border leading-snug ${
                  testResult.ok
                    ? 'bg-[#064E3B]/30 border-[#10B981]/50 text-[#6EE7B7]'
                    : 'bg-[#7F1D1D]/25 border-[#EF4444]/40 text-[#FCA5A5]'
                }`}
              >
                {testResult.message}
              </div>
            )}

            {/* Auto-Render Automation Pipeline Toggle */}
            <div className="pt-1.5 border-t border-[#22232E] space-y-1.5">
              <label className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={config.autoRenderAfterAi}
                  onChange={(e) => onUpdateConfig({ autoRenderAfterAi: e.target.checked })}
                  className="accent-[#F97316] mt-0.5 rounded"
                />
                <span className="text-[11px] text-[#E4E4E7] leading-snug">
                  <strong className="font-semibold text-[#FDBA74]">Auto-Render</strong> — automatically export after AI finishes
                </span>
              </label>

              {config.autoRenderAfterAi && (
                <div className="flex items-center gap-2 pl-5">
                  <span className="text-[10px] text-[#8B8B96]">Format:</span>
                  <select
                    aria-label="Auto-render format"
                    value={config.autoRenderFormat}
                    onChange={(e) =>
                      onUpdateConfig({
                        autoRenderFormat: e.target.value as AiProviderConfig['autoRenderFormat'],
                      })
                    }
                    className="bg-[#0F1016] border border-[#2C2D39] rounded px-2 py-0.5 font-mono text-[11px] text-[#F97316]"
                  >
                    <option value="mp4">MP4 (FFmpeg H.264)</option>
                    <option value="webm">WebM (Local Browser)</option>
                    <option value="png">PNG Snapshot</option>
                  </select>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Chat / Command Feed */}
      <div ref={chatFeedRef} className="flex-1 min-h-0 overflow-y-auto p-3 pb-6 space-y-3">
        {messages.length === 0 ? (
          <div className="space-y-3 py-2">
            <div className="text-xs text-[#A1A1AA] leading-relaxed">
              Describe in plain English what you want to create or edit in your <span className="font-mono text-[#FDBA74]">Rustren v1.1</span> scene. Attach up to {MAX_REFERENCES} reference images (PNG, JPG, WebP) and the AI will lift the palette, typography, whitespace and rhythm from them. You can also analyze a local MP4/WebM video to rebuild its shots, pacing and palette — the video never leaves your browser.
            </div>
            <div className="space-y-1.5">
              <div className="text-[10px] font-medium text-[#71717A]">Quick prompts:</div>
              {QUICK_PROMPTS.map((qp) => (
                <button
                  key={qp.label}
                  type="button"
                  onClick={() => {
                    setMode(qp.mode);
                    setPrompt(qp.prompt);
                  }}
                  className="w-full text-left px-2.5 py-2 rounded bg-[#171820] hover:bg-[#20222E] border border-[#252632] text-xs text-[#D4D4D8] transition-colors flex items-center gap-2"
                >
                  <Sparkles className="w-3.5 h-3.5 text-[#F97316] shrink-0" />
                  <span className="truncate">{qp.label}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`rounded p-2.5 text-xs leading-relaxed border ${
                msg.role === 'user'
                  ? 'bg-[#1A1C26] border-[#2C2E3D] text-[#F4F4F6] ml-4'
                  : msg.role === 'error'
                    ? 'bg-[#261417] border-[#DC2626]/50 text-[#FCA5A5]'
                    : 'bg-[#15161E] border-[#262735] text-[#E4E4E7]'
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-1">
                <span className="text-[10px] font-semibold text-[#8B8B96]">
                  {msg.role === 'user'
                    ? 'You'
                    : msg.role === 'error'
                      ? 'Failed to process'
                      : msg.providerLabel || 'AI Director'}
                </span>
                {msg.layerDelta && (
                  <span className="font-mono text-[10px] text-[#34D399]">{msg.layerDelta}</span>
                )}
              </div>
              <p className="whitespace-pre-wrap break-words">{msg.content}</p>
              {msg.role === 'error' && !isRunning && (() => {
                const lastUser = [...messages].reverse().find((m) => m.role === 'user');
                if (!lastUser) return null;
                return (
                  <button
                    type="button"
                    onClick={() => onSendCommand(lastUser.content, mode, references)}
                    className="mt-2 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#3B181C] hover:bg-[#522127] border border-[#EF4444]/40 text-[11px] font-medium text-[#FCA5A5] hover:text-white transition-colors"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Retry</span>
                  </button>
                );
              })()}
              {msg.autoRenderTriggered && (
                <div className="mt-1.5 flex items-center gap-1 text-[11px] text-[#FDBA74]">
                  <Zap className="w-3 h-3" />
                  <span>Auto-Render triggered automatically</span>
                </div>
              )}
              {msg.sceneSnapshotBefore && (
                <button
                  type="button"
                  onClick={() => onRevertScene(msg.sceneSnapshotBefore!)}
                  className="mt-2 inline-flex items-center gap-1 text-[11px] font-medium text-[#A1A1AA] hover:text-white transition-colors"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Revert to previous scene</span>
                </button>
              )}
            </div>
          ))
        )}

        {isRunning && (
          <div className="flex items-center gap-2 p-2.5 rounded bg-[#161720] border border-[#F97316]/40 text-xs text-[#FDBA74]">
            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
            <span>Composing Rustren v1.1 scene with AI...</span>
          </div>
        )}
      </div>

      {/* Prompt Composer */}
      <form onSubmit={handleSubmit} className="p-2.5 border-t border-[#252630] bg-[#14151C] space-y-2 shrink-0">
        {validationError && (
          <div
            role="alert"
            className="text-[11px] text-[#FCA5A5] bg-[#7F1D1D]/25 border border-[#EF4444]/40 rounded px-2 py-1.5"
          >
            {validationError}
          </div>
        )}

        {frameNotes.length > 0 && (
          <div className="rounded border border-[#F97316]/40 bg-[#171311] p-2 space-y-1.5">
            <div className="flex items-center justify-between gap-1.5">
              <span className="text-[10px] font-semibold tracking-wide text-[#FDBA74] whitespace-nowrap">
                FRAME NOTES ({frameNotes.length})
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={onCopyFrameNotes}
                  title="Copy frame notes as JSON for external agents/CLI"
                  className="text-[10px] text-[#A1A1AA] hover:text-white px-1.5 py-0.5 rounded bg-[#22232F] border border-[#343648]"
                >
                  Copy JSON
                </button>
                <button
                  type="button"
                  onClick={onClearFrameNotes}
                  className="text-[10px] text-[#8B8B96] hover:text-white"
                >
                  Clear
                </button>
                <button
                  type="button"
                  disabled={isRunning}
                  onClick={onApplyFrameNotes}
                  className="px-2 py-0.5 rounded bg-[#F97316] hover:bg-[#FB923C] text-[#09090D] text-[10px] font-bold disabled:opacity-40 whitespace-nowrap"
                >
                  Apply with AI
                </button>
              </div>
            </div>
            <div className="max-h-28 overflow-y-auto space-y-1">
              {frameNotes.map((n, idx) => (
                <div
                  key={n.id}
                  className="flex items-start justify-between gap-1.5 text-[11px] bg-[#0F1016] border border-[#272834] rounded px-1.5 py-1"
                >
                  {editingNoteId === n.id ? (
                    <div className="flex-1 flex items-center gap-1">
                      <input
                        type="text"
                        autoFocus
                        value={editingNoteText}
                        onChange={(e) => setEditingNoteText(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            e.stopPropagation();
                            if (editingNoteText.trim()) {
                              onUpdateFrameNote(n.id, editingNoteText.trim());
                            }
                            setEditingNoteId(null);
                          } else if (e.key === 'Escape') {
                            e.preventDefault();
                            setEditingNoteId(null);
                          }
                        }}
                        className="flex-1 min-w-0 bg-[#181924] border border-[#F97316] rounded px-1.5 py-0.5 text-[11px] text-white focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (editingNoteText.trim()) {
                            onUpdateFrameNote(n.id, editingNoteText.trim());
                          }
                          setEditingNoteId(null);
                        }}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-[#F97316] text-[#09090D] font-bold"
                      >
                        Save
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onSeekToTime(n.timeSec)}
                      onDoubleClick={() => {
                        setEditingNoteId(n.id);
                        setEditingNoteText(n.note);
                      }}
                      title="Click to seek · Double-click to edit"
                      className="text-left min-w-0 flex-1 hover:text-white text-[#D4D4D8]"
                    >
                      <span className="font-mono text-[10px] text-[#F97316] mr-1">
                        #{idx + 1} @{n.timeSec.toFixed(2)}s
                      </span>
                      <span className="break-words">{n.note}</span>
                    </button>
                  )}
                  <div className="flex items-center gap-1 shrink-0">
                    {editingNoteId !== n.id && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingNoteId(n.id);
                          setEditingNoteText(n.note);
                        }}
                        className="text-[10px] text-[#71717A] hover:text-[#FDBA74]"
                      >
                        Edit
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => onDeleteFrameNote(n.id)}
                      aria-label={`Remove frame note ${idx + 1}`}
                      className="text-[#71717A] hover:text-[#FCA5A5] p-0.5"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2 min-w-0">
            <div className="flex items-center bg-[#0F1016] border border-[#272834] rounded p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => setMode('edit')}
                className={`px-2 py-0.5 rounded font-medium transition-colors ${
                  mode === 'edit' ? 'bg-[#262836] text-white' : 'text-[#8B8B96] hover:text-white'
                }`}
              >
                Edit Scene
              </button>
              <button
                type="button"
                onClick={() => setMode('new')}
                className={`px-2 py-0.5 rounded font-medium transition-colors ${
                  mode === 'new' ? 'bg-[#262836] text-white' : 'text-[#8B8B96] hover:text-white'
                }`}
              >
                New Scene
              </button>
            </div>

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={references.length >= MAX_REFERENCES || isRunning}
              title={`Attach up to ${MAX_REFERENCES} reference images (PNG, JPG, WebP)`}
              aria-label="Attach reference images"
              className="flex items-center gap-1 px-2 py-1 rounded border border-[#272834] bg-[#0F1016] text-[11px] text-[#A1A1AA] hover:text-white hover:border-[#F97316] disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
            >
              <ImagePlus className="w-3.5 h-3.5" />
              <span className="whitespace-nowrap">
                Reference{references.length > 0 ? ` ${references.length}/${MAX_REFERENCES}` : ''}
              </span>
            </button>

            <button
              type="button"
              onClick={() => videoInputRef.current?.click()}
              disabled={videoBusy || isRunning}
              title="Analyze an MP4 or WebM video locally — nothing is uploaded"
              aria-label="Analyze reference video"
              className="flex items-center gap-1 px-2 py-1 rounded border border-[#272834] bg-[#0F1016] text-[11px] text-[#A1A1AA] hover:text-white hover:border-[#F97316] disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
            >
              {videoBusy ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Film className="w-3.5 h-3.5" />
              )}
              <span className="whitespace-nowrap">{videoBusy ? 'Analyzing...' : 'Analyze Video'}</span>
            </button>
          </div>
          {config.autoRenderAfterAi && (
            <span className="text-[10px] font-mono text-[#F97316]">
              Auto-Render: {config.autoRenderFormat.toUpperCase()}
            </span>
          )}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          className="hidden"
          aria-label="Choose reference images"
          onChange={(e) => {
            void handleAttachFiles(e.target.files);
          }}
        />

        <input
          ref={videoInputRef}
          type="file"
          accept="video/mp4,video/webm,.mp4,.webm"
          className="hidden"
          aria-label="Choose a reference video"
          onChange={(e) => {
            void handleAnalyzeVideo(e.target.files);
          }}
        />

        {videoBusy && (
          <div className="flex items-center gap-2 text-[11px] text-[#FDBA74] bg-[#161720] border border-[#F97316]/40 rounded px-2 py-1.5">
            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
            <span>Analyzing video locally...</span>
          </div>
        )}

        {videoAnalysis && (
          <div className="rounded border border-[#2C2D39] bg-[#0F1016] p-2 space-y-1.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[10px] font-semibold tracking-wide text-[#FDBA74]">
                  VIDEO FORENSICS
                </div>
                <div className="text-[11px] text-[#E4E4E7] truncate" title={videoAnalysis.fileName}>
                  {videoAnalysis.fileName} · {videoAnalysis.durationSec.toFixed(2)}s ·{' '}
                  {videoAnalysis.width}×{videoAnalysis.height} ·{' '}
                  {aspectRatioLabel(videoAnalysis.width, videoAnalysis.height)}
                </div>
                <div className="text-[10px] text-[#8B8B96]">
                  {videoAnalysis.shots.length} shot{videoAnalysis.shots.length === 1 ? '' : 's'} ·{' '}
                  {videoAnalysis.palette.length} colors · {videoAnalysis.keyframes.length} keyframe
                  {videoAnalysis.keyframes.length === 1 ? '' : 's'} · analyzed locally
                </div>
              </div>
              <button
                type="button"
                onClick={() => setVideoAnalysis(null)}
                aria-label="Remove video analysis"
                title="Remove video analysis"
                className="shrink-0 w-4 h-4 rounded-full bg-[#262836] border border-[#3A3B48] text-[#A1A1AA] hover:text-white hover:bg-[#DC2626] flex items-center justify-center transition-colors"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            </div>

            <div className="flex items-center gap-1.5 min-w-0">
              {videoAnalysis.palette.map((hex) => (
                <span
                  key={hex}
                  title={hex}
                  aria-label={`Palette color ${hex}`}
                  className="w-4 h-4 rounded-sm border border-white/20 shrink-0"
                  style={{ backgroundColor: hex }}
                />
              ))}
              <span className="font-mono text-[9px] text-[#71717A] truncate">
                {videoAnalysis.palette.join(' ')}
              </span>
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
              {videoAnalysis.keyframes.map((frame) => (
                <img
                  key={frame.id}
                  src={frame.dataUrl}
                  alt={`Keyframe at ${frame.timeSec.toFixed(2)}s`}
                  title={`${frame.timeSec.toFixed(2)}s · shot ${frame.shotIndex + 1}`}
                  className="h-10 w-auto rounded border border-[#2C2D39] shrink-0"
                />
              ))}
            </div>
          </div>
        )}

        {references.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            {references.map((ref) => (
              <div key={ref.id} className="relative w-11 h-11 shrink-0">
                <img
                  src={ref.dataUrl}
                  alt={ref.name}
                  title={ref.name}
                  className="w-11 h-11 object-cover rounded border border-[#2C2D39]"
                />
                <button
                  type="button"
                  onClick={() => handleRemoveReference(ref.id)}
                  aria-label={`Remove reference image ${ref.name}`}
                  className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-[#262836] border border-[#3A3B48] text-[#A1A1AA] hover:text-white hover:bg-[#DC2626] flex items-center justify-center transition-colors"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            ))}
            <span className="text-[10px] text-[#71717A]">
              {references.length}/{MAX_REFERENCES} reference{references.length > 1 ? 's' : ''} ·
              palette, type &amp; rhythm
            </span>
          </div>
        )}

        <div className="flex items-end gap-1.5">
          <textarea
            rows={2}
            aria-label="AI video editor command"
            value={prompt}
            onChange={(e) => {
              setValidationError(null);
              setPrompt(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit(e);
              }
            }}
            placeholder="e.g. Add a spring-animated title & change background to dark navy..."
            className="flex-1 bg-[#0F1016] border border-[#2C2D39] rounded px-2.5 py-1.5 text-xs text-white placeholder:text-[#52525B] focus:outline-none focus:border-[#F97316] resize-none"
          />
          <button
            type="submit"
            disabled={isRunning}
            aria-label="Send command to AI"
            className="h-[52px] px-3 rounded bg-[#F97316] hover:bg-[#FB923C] disabled:opacity-50 text-[#09090D] font-bold flex items-center justify-center transition-colors cursor-pointer shrink-0"
          >
            {isRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </form>
    </div>
  );
};
