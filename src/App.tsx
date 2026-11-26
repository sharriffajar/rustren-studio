import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Sliders, Sparkles } from 'lucide-react';
import { AiDirectorPanel } from './components/AiDirectorPanel';
import { ExportModal } from './components/ExportModal';
import { InspectorPanel } from './components/InspectorPanel';
import { LeftSidebar, type CatalogAsset, type LeftTab } from './components/LeftSidebar';
import { StageViewport } from './components/StageViewport';
import { TimelinePanel } from './components/TimelinePanel';
import { TopBar } from './components/TopBar';
import { runAiDirectorCommand } from './engine/aiClient';
import {
  exportMp4ViaRustrenApi,
  exportPngSnapshot,
  exportSceneJsonFile,
  exportWebmLocally,
} from './engine/exporter';
import { compileRustrenHtml } from './engine/htmlCompiler';
import { autoFixScene, lintScene, validateAndNormalizeScene } from './engine/lint';
import { SCENE_PRESETS } from './engine/presets';
import { renderRustrenFrame } from './engine/renderer';
import type {
  AiChatMessage,
  AiProviderConfig,
  AiReferenceImage,
  CanvasConfig,
  FrameNote,
  Layer,
  RustrenScene,
} from './engine/types';
import type { VideoAnalysisResult } from './engine/videoAnalyzer';

const STORAGE_AI_KEY = 'rustren_studio_byok_config_v1';
const STORAGE_AUTOSAVE_KEY = 'rustren_studio_autosave_v1';

function loadAutosavedProject(): {
  projectName: string;
  activePresetId: string;
  scene: RustrenScene;
  frameNotes: FrameNote[];
} | null {
  try {
    const raw = localStorage.getItem(STORAGE_AUTOSAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const normalized = validateAndNormalizeScene(parsed?.scene);
    if (normalized) {
      return {
        projectName: typeof parsed.projectName === 'string' ? parsed.projectName : SCENE_PRESETS[0].name,
        activePresetId: typeof parsed.activePresetId === 'string' ? parsed.activePresetId : 'custom',
        scene: normalized,
        frameNotes: Array.isArray(parsed.frameNotes) ? parsed.frameNotes : [],
      };
    }
  } catch {
    // ignore corrupt autosave
  }
  return null;
}

function loadInitialAiConfig(): AiProviderConfig {
  const defaults: AiProviderConfig = {
    provider: 'gemini_byok',
    apiKey: '',
    model: 'gemini-2.5-flash',
    baseUrl: 'http://localhost:11434/v1',
    rememberKey: true,
    autoRenderAfterAi: false,
    autoRenderFormat: 'mp4',
  };
  try {
    const raw = localStorage.getItem(STORAGE_AI_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<AiProviderConfig>;
    return { ...defaults, ...parsed };
  } catch {
    return defaults;
  }
}

function createNewLayer(type: Layer['type'], scene: RustrenScene): Layer {
  const cx = Math.round(scene.canvas.width / 2);
  const cy = Math.round(scene.canvas.height / 2);
  const dur = scene.canvas.duration_secs || 5;
  const idx = scene.layers.length + 1;

  switch (type) {
    case 'text':
      return {
        type: 'text',
        name: `Text #${idx}`,
        x: cx,
        y: cy,
        anchor: 'center',
        text_align: 'center',
        content: 'New Text',
        font_size: 56,
        font_weight: 'bold',
        color: '#F8FAFC',
        start_sec: 0,
        end_sec: dur,
        animations: [
          { property: 'opacity', from: 0, to: 1, start_sec: 0, end_sec: 0.6, easing: 'ease_out' },
        ],
      };
    case 'rect':
      return {
        type: 'rect',
        name: `Rect #${idx}`,
        x: cx,
        y: cy,
        width: 340,
        height: 160,
        radius: 16,
        anchor: 'center',
        color: '#1E293B',
        border_color: '#F97316',
        border_width: 2,
        start_sec: 0,
        end_sec: dur,
      };
    case 'circle':
      return {
        type: 'circle',
        name: `Circle #${idx}`,
        cx,
        cy,
        r: 90,
        color: '#F97316',
        opacity: 0.85,
        start_sec: 0,
        end_sec: dur,
      };
    case 'waveform':
      return {
        type: 'waveform',
        name: `Waveform #${idx}`,
        x: cx - 220,
        y: cy + 120,
        width: 440,
        height: 80,
        bars: 28,
        bar_gap: 4,
        color: '#F97316',
        speed: 1.2,
        start_sec: 0,
        end_sec: dur,
      };
    case 'particles':
      return {
        type: 'particles',
        name: `Partikel #${idx}`,
        x: cx - 200,
        y: cy - 150,
        width: 400,
        height: 300,
        count: 36,
        shape: 'confetti',
        colors: ['#F97316', '#FACC15', '#38BDF8', '#F8FAFC'],
        start_sec: 0,
        end_sec: dur,
      };
    case 'image':
      return {
        type: 'image',
        name: `Image #${idx}`,
        x: cx,
        y: cy,
        width: 420,
        height: 260,
        anchor: 'center',
        fit: 'cover',
        radius: 14,
        src: '',
        start_sec: 0,
        end_sec: dur,
      };
    default:
      return {
        type: 'rect',
        name: `Layer #${idx}`,
        x: cx,
        y: cy,
        width: 200,
        height: 120,
        anchor: 'center',
        color: '#334155',
        start_sec: 0,
        end_sec: dur,
      };
  }
}

export default function App() {
  const initialSaved = useMemo(() => loadAutosavedProject(), []);
  const [activePresetId, setActivePresetId] = useState<string>(
    initialSaved?.activePresetId ?? SCENE_PRESETS[0].id
  );
  const [projectName, setProjectName] = useState<string>(
    initialSaved?.projectName ?? SCENE_PRESETS[0].name
  );
  const [scene, setScene] = useState<RustrenScene>(() =>
    initialSaved?.scene ?? JSON.parse(JSON.stringify(SCENE_PRESETS[0].scene))
  );
  const [history, setHistory] = useState<RustrenScene[]>([]);
  const [future, setFuture] = useState<RustrenScene[]>([]);

  const [currentTime, setCurrentTime] = useState<number>(1.8);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [loop, setLoop] = useState<boolean>(true);
  const [selectedLayerIndex, setSelectedLayerIndex] = useState<number | null>(
    initialSaved ? (initialSaved.scene.layers.length > 0 ? 0 : null) : 4
  );

  const [leftTab, setLeftTab] = useState<LeftTab>('layers');
  const [rightTab, setRightTab] = useState<'ai' | 'inspector'>('ai');
  const [frameNotes, setFrameNotes] = useState<FrameNote[]>(initialSaved?.frameNotes ?? []);

  // Clamp playhead whenever scene duration shrinks (including duration_secs: 0)
  useEffect(() => {
    const maxDur = Math.max(0, scene.canvas.duration_secs || 0);
    setCurrentTime((t) => (t > maxDur ? maxDur : t));
  }, [scene.canvas.duration_secs]);

  // Auto-save active project to localStorage so refresh never loses work
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(
          STORAGE_AUTOSAVE_KEY,
          JSON.stringify({ projectName, activePresetId, scene, frameNotes })
        );
      } catch {
        // ignore quota errors
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [projectName, activePresetId, scene, frameNotes]);
  const [exportOpen, setExportOpen] = useState<boolean>(false);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);

  const [timelineHeight, setTimelineHeight] = useState(220);

  const handleStartTimelineResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = timelineHeight;
    const onMove = (ev: PointerEvent) => {
      const delta = startY - ev.clientY;
      const maxH = Math.max(260, Math.floor(window.innerHeight * 0.6));
      setTimelineHeight(Math.max(140, Math.min(maxH, startH + delta)));
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const [capabilities, setCapabilities] = useState({
    ffmpegAvailable: true,
    studioGeminiAvailable: false,
  });

  const [aiConfig, setAiConfig] = useState<AiProviderConfig>(loadInitialAiConfig);
  const [aiMessages, setAiMessages] = useState<AiChatMessage[]>([]);
  const [aiRunning, setAiRunning] = useState<boolean>(false);
  const [toast, setToast] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastFrameTsRef = useRef<number | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [toast]);

  // Static deployment: MP4 uses Rustren Render API, AI Director uses BYOK directly in browser
  useEffect(() => {
    setCapabilities({
      ffmpegAvailable: true,
      studioGeminiAvailable: false,
    });
  }, []);

  // Persist BYOK config locally (respecting rememberKey toggle)
  useEffect(() => {
    try {
      const toStore: AiProviderConfig = {
        ...aiConfig,
        apiKey: aiConfig.rememberKey ? aiConfig.apiKey : '',
      };
      localStorage.setItem(STORAGE_AI_KEY, JSON.stringify(toStore));
    } catch {
      // ignore storage quota
    }
  }, [aiConfig]);

  const lintWarnings = useMemo(() => lintScene(scene), [scene]);

  const commitScene = useCallback(
    (nextScene: RustrenScene) => {
      if (JSON.stringify(nextScene) === JSON.stringify(scene)) return;
      setHistory((prev) => [...prev.slice(-39), scene]);
      setFuture([]);
      setScene(nextScene);
    },
    [scene]
  );

  const handleUndo = useCallback(() => {
    setHistory((prev) => {
      if (prev.length === 0) return prev;
      const previous = prev[prev.length - 1];
      setFuture((f) => [scene, ...f]);
      setScene(previous);
      return prev.slice(0, -1);
    });
  }, [scene]);

  const handleRedo = useCallback(() => {
    setFuture((prev) => {
      if (prev.length === 0) return prev;
      const next = prev[0];
      setHistory((h) => [...h, scene]);
      setScene(next);
      return prev.slice(1);
    });
  }, [scene]);

  // Playback RAF loop
  useEffect(() => {
    if (!isPlaying) {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      lastFrameTsRef.current = null;
      return;
    }

    const duration = scene.canvas.duration_secs || 5;
    const step = (ts: number) => {
      if (lastFrameTsRef.current === null) {
        lastFrameTsRef.current = ts;
      }
      const dt = (ts - lastFrameTsRef.current) / 1000;
      lastFrameTsRef.current = ts;

      setCurrentTime((prev) => {
        const next = prev + dt;
        if (next >= duration) {
          if (loop) return next % duration;
          setIsPlaying(false);
          return duration;
        }
        return next;
      });

      rafRef.current = requestAnimationFrame(step);
    };

    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying, loop, scene.canvas.duration_secs]);

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isEditing =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      if (isEditing) return;

      if (e.code === 'Space') {
        e.preventDefault();
        setIsPlaying((p) => !p);
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        setIsPlaying(false);
        setCurrentTime((t) => Math.max(0, t - 1 / (scene.canvas.fps || 30)));
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        setIsPlaying(false);
        setCurrentTime((t) =>
          Math.min(scene.canvas.duration_secs || 5, t + 1 / (scene.canvas.fps || 30))
        );
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if (
        (e.ctrlKey || e.metaKey) &&
        (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))
      ) {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [scene.canvas.fps, scene.canvas.duration_secs, handleUndo, handleRedo]);

  const handleSelectPreset = (presetId: string) => {
    const found = SCENE_PRESETS.find((p) => p.id === presetId);
    if (!found) return;
    setIsPlaying(false);
    setActivePresetId(found.id);
    setProjectName(found.name);
    commitScene(JSON.parse(JSON.stringify(found.scene)));
    setCurrentTime(Math.min(1.5, found.scene.canvas.duration_secs / 2));
    setSelectedLayerIndex(found.scene.layers.length > 0 ? 0 : null);
    showToast(`Preset loaded: ${found.name}`);
  };

  const handleImportFile = async (file: File) => {
    const lower = file.name.toLowerCase();
    try {
      if (lower.endsWith('.json')) {
        const text = await file.text();
        const parsed = JSON.parse(text) as RustrenScene;
        if (!parsed.canvas || !Array.isArray(parsed.layers)) {
          throw new Error('JSON file does not match Rustren schema (requires canvas & layers).');
        }
        commitScene(parsed);
        setActivePresetId('custom');
        setProjectName(file.name.replace(/\.json$/i, ''));
        setCurrentTime(0);
        setSelectedLayerIndex(parsed.layers.length > 0 ? 0 : null);
        showToast(`Scene JSON loaded: ${file.name}`);
      } else if (lower.endsWith('.html') || lower.endsWith('.htm')) {
        const text = await file.text();
        const compiled = compileRustrenHtml(text);
        commitScene(compiled);
        setActivePresetId('custom');
        setProjectName(file.name.replace(/\.html?$/i, ''));
        setCurrentTime(0);
        setSelectedLayerIndex(compiled.layers.length > 0 ? 0 : null);
        showToast(`HTML scene compiled: ${file.name}`);
      } else if (file.type.startsWith('image/')) {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(new Error('Failed to read image.'));
          reader.readAsDataURL(file);
        });
        const imgLayer: Layer = {
          type: 'image',
          name: file.name,
          x: Math.round(scene.canvas.width / 2),
          y: Math.round(scene.canvas.height / 2),
          width: Math.round(scene.canvas.width * 0.5),
          height: Math.round(scene.canvas.height * 0.5),
          anchor: 'center',
          fit: 'cover',
          radius: 12,
          src: dataUrl,
          start_sec: 0,
          end_sec: scene.canvas.duration_secs,
        };
        const next: RustrenScene = { ...scene, layers: [...scene.layers, imgLayer] };
        commitScene(next);
        setSelectedLayerIndex(next.layers.length - 1);
        setRightTab('inspector');
        showToast(`Image layer added: ${file.name}`);
      } else {
        showToast('Unsupported format. Upload .json, .html, or an image.');
      }
    } catch (err) {
      showToast(`Failed to open file: ${(err as Error).message}`);
    }
  };

  const handleUpdateCanvas = (patch: Partial<CanvasConfig>) => {
    commitScene({
      ...scene,
      canvas: { ...scene.canvas, ...patch },
    });
  };

  const handleUpdateLayer = (idx: number, updater: (l: Layer) => Layer) => {
    const nextLayers = scene.layers.map((l, i) => (i === idx ? updater(l) : l));
    commitScene({ ...scene, layers: nextLayers });
  };

  const handleDragMoveLayer = (idx: number, dx: number, dy: number) => {
    setScene((prev) => ({
      ...prev,
      layers: prev.layers.map((l, i) => {
        if (i !== idx) return l;
        if (l.type === 'circle') {
          return { ...l, cx: Math.round((l.cx ?? 0) + dx), cy: Math.round((l.cy ?? 0) + dy) };
        }
        return { ...l, x: Math.round((l.x ?? 0) + dx), y: Math.round((l.y ?? 0) + dy) };
      }),
    }));
  };

  const handleShiftLayerTiming = (idx: number, newStart: number, newEnd: number) => {
    setScene((prev) => ({
      ...prev,
      layers: prev.layers.map((l, i) =>
        i === idx ? { ...l, start_sec: newStart, end_sec: newEnd } : l
      ),
    }));
  };

  const handleAddLayer = (type: Layer['type']) => {
    const layer = createNewLayer(type, scene);
    const next: RustrenScene = { ...scene, layers: [...scene.layers, layer] };
    commitScene(next);
    setSelectedLayerIndex(next.layers.length - 1);
    setRightTab('inspector');
  };

  const handleToggleHidden = (idx: number) => {
    handleUpdateLayer(idx, (l) => ({ ...l, hidden: !l.hidden }));
  };

  const handleMoveLayer = (idx: number, dir: -1 | 1) => {
    const target = idx + dir;
    if (target < 0 || target >= scene.layers.length) return;
    const copy = [...scene.layers];
    const [item] = copy.splice(idx, 1);
    copy.splice(target, 0, item);
    commitScene({ ...scene, layers: copy });
    setSelectedLayerIndex(target);
  };

  const handleDuplicateLayer = (idx: number) => {
    const orig = scene.layers[idx];
    if (!orig) return;
    const dup: Layer = JSON.parse(JSON.stringify(orig));
    dup.name = `${orig.name || orig.type} (Copy)`;
    if (dup.type === 'circle') {
      dup.cx = (dup.cx ?? 0) + 30;
      dup.cy = (dup.cy ?? 0) + 30;
    } else {
      dup.x = (dup.x ?? 0) + 30;
      dup.y = (dup.y ?? 0) + 30;
    }
    const copy = [...scene.layers];
    copy.splice(idx + 1, 0, dup);
    commitScene({ ...scene, layers: copy });
    setSelectedLayerIndex(idx + 1);
  };

  const handleDeleteLayer = (idx: number) => {
    const copy = scene.layers.filter((_, i) => i !== idx);
    commitScene({ ...scene, layers: copy });
    setSelectedLayerIndex(copy.length > 0 ? Math.max(0, idx - 1) : null);
  };

  const handleAutoFixLint = () => {
    const fixed = autoFixScene(scene);
    commitScene(fixed);
    showToast('Lint issues auto-fixed.');
  };

  const handleSendAiCommand = async (
    prompt: string,
    mode: 'edit' | 'new',
    references: AiReferenceImage[] = [],
    videoAnalysis?: VideoAnalysisResult,
  ) => {
    const stageSnapshotRef: AiReferenceImage[] = [];
    if (mode === 'edit' && references.length === 0) {
      try {
        const snapCanvas = document.createElement('canvas');
        const maxDim = 960;
        const scale = Math.min(1, maxDim / Math.max(scene.canvas.width, scene.canvas.height));
        snapCanvas.width = Math.max(1, Math.round(scene.canvas.width * scale));
        snapCanvas.height = Math.max(1, Math.round(scene.canvas.height * scale));
        const sctx = snapCanvas.getContext('2d');
        if (sctx) {
          sctx.scale(scale, scale);
          renderRustrenFrame(sctx, scene, currentTime);
          const dataUrl = snapCanvas.toDataURL('image/jpeg', 0.82);
          const base64 = dataUrl.split(',')[1] || '';
          if (base64) {
            stageSnapshotRef.push({
              id: `stage_live_${Date.now()}`,
              name: `current-stage-t${currentTime.toFixed(2)}s.jpg`,
              mimeType: 'image/jpeg',
              dataUrl,
              base64,
            });
          }
        }
      } catch {
        // ignore if canvas is tainted
      }
    }

    const combinedReferences = [
      ...stageSnapshotRef,
      ...references,
      ...(videoAnalysis ? videoAnalysis.keyframes : []),
    ];
    const userMsg: AiChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content:
        (videoAnalysis
          ? `${prompt}\n\nVideo analyzed locally: ${videoAnalysis.fileName} · ${videoAnalysis.shots.length} shot${videoAnalysis.shots.length === 1 ? '' : 's'} · ${videoAnalysis.keyframes.length} keyframe${videoAnalysis.keyframes.length === 1 ? '' : 's'} · palette ${videoAnalysis.palette.join(' ')}`
          : prompt) +
        (references.length > 0
          ? `\n\n${references.length} reference image${references.length > 1 ? 's' : ''}: ${references
              .map((r) => r.name)
              .join(', ')}`
          : ''),
      timestamp: Date.now(),
    };
    setAiMessages((prev) => [...prev, userMsg]);
    setAiRunning(true);

    const beforeSnapshot: RustrenScene = JSON.parse(JSON.stringify(scene));

    try {
      const data = await runAiDirectorCommand({
        provider: aiConfig.provider,
        apiKey: aiConfig.apiKey,
        model: aiConfig.model,
        baseUrl: aiConfig.baseUrl,
        prompt,
        mode,
        currentScene: mode === 'edit' ? scene : undefined,
        references: combinedReferences,
        videoAnalysis,
      });

      const nextScene = data.scene as RustrenScene;
      commitScene(nextScene);
      setActivePresetId('custom');
      if (mode === 'new') {
        setProjectName('AI Generated Scene');
      }
      setCurrentTime(Math.min(1.0, (nextScene.canvas.duration_secs || 5) / 2));
      setSelectedLayerIndex(nextScene.layers.length > 0 ? 0 : null);

      const delta = `${nextScene.layers.length} layer · ${nextScene.canvas.width}×${nextScene.canvas.height}`;
      const willAutoRender = aiConfig.autoRenderAfterAi;

      setAiMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: data.summary || 'Scene updated by AI.',
          timestamp: Date.now(),
          providerLabel: aiConfig.model || aiConfig.provider,
          layerDelta: delta,
          sceneSnapshotBefore: beforeSnapshot,
          autoRenderTriggered: willAutoRender,
        },
      ]);

      if (willAutoRender) {
        showToast(`AI finished! Running Auto-Render (${aiConfig.autoRenderFormat.toUpperCase()})...`);
        if (aiConfig.autoRenderFormat === 'png') {
          await exportPngSnapshot(nextScene, Math.min(1.5, nextScene.canvas.duration_secs / 2), 'rustren_ai');
        } else if (aiConfig.autoRenderFormat === 'mp4') {
          const apiUrl = localStorage.getItem('rustren_studio_api_url') || 'https://nvm.web.id/rustren/api';
          const apiKey = localStorage.getItem('rustren_studio_api_key') || '';
          await exportMp4ViaRustrenApi(nextScene, {
            apiUrl,
            apiKey,
            filename: 'rustren_ai_autorender.mp4',
          });
        } else {
          await exportWebmLocally(nextScene);
        }
        showToast('Auto-Render complete and saved locally.');
      } else {
        showToast('Scene updated by AI Director.');
      }
      return true;
    } catch (err) {
      setAiMessages((prev) => [
        ...prev,
        {
          id: `e-${Date.now()}`,
          role: 'error',
          content: (err as Error).message,
          timestamp: Date.now(),
        },
      ]);
      return false;
    } finally {
      setAiRunning(false);
    }
  };

  return (
    <div
      className="h-screen w-screen overflow-hidden flex flex-col bg-[#09090D] text-[#F4F4F6]"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={(e) => {
        if (e.relatedTarget === null) setIsDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragOver(false);
        const file = e.dataTransfer?.files?.[0];
        if (file) handleImportFile(file);
      }}
    >
      {/* Hidden file picker for Open Scene (.json / .html / image) */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json,.html,.htm,image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleImportFile(f);
          e.target.value = '';
        }}
      />

      {/* Top Studio Header */}
      <TopBar
        projectName={projectName}
        presets={SCENE_PRESETS}
        activePresetId={activePresetId}
        onSelectPreset={handleSelectPreset}
        onImportClick={() => fileInputRef.current?.click()}
        onSaveJson={() => {
          exportSceneJsonFile(scene, projectName.toLowerCase().replace(/[^a-z0-9]+/g, '_') || 'rustren_scene')
            .then(() => showToast('Scene JSON saved locally.'))
            .catch(() => {});
        }}
        onOpenExport={() => setExportOpen(true)}
        canUndo={history.length > 0}
        canRedo={future.length > 0}
        onUndo={handleUndo}
        onRedo={handleRedo}
        lintCount={lintWarnings.length}
        onOpenLintTab={() => setLeftTab('lint')}
        canvasLabel={`${scene.canvas.width}×${scene.canvas.height} · ${scene.canvas.fps}fps · ${scene.canvas.duration_secs.toFixed(1)}s`}
      />

      {/* Main 3-Pane Studio Workspace */}
      <main className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left Pane: Layers / JSON / Lint */}
        <LeftSidebar
          scene={scene}
          activeTab={leftTab}
          onTabChange={setLeftTab}
          selectedLayerIndex={selectedLayerIndex}
          onSelectLayer={(idx) => {
            setSelectedLayerIndex(idx);
            if (idx !== null) setRightTab('inspector');
          }}
          onAddLayer={handleAddLayer}
          onInsertCatalogAsset={(asset: CatalogAsset, fullUrl: string) => {
            const dur = scene.canvas.duration_secs || 5;
            const imgLayer: Layer = {
              type: 'image',
              name: asset.title,
              src: fullUrl,
              x: 0,
              y: 0,
              width: scene.canvas.width,
              height: scene.canvas.height,
              fit: 'cover',
              start_sec: 0,
              end_sec: dur,
              ...(asset.kind === 'overlay'
                ? {
                    blend_mode: (asset.blend || 'screen') as Layer['blend_mode'],
                    opacity: 0.65,
                  }
                : {}),
            };
            if (asset.kind === 'matte' && selectedLayerIndex !== null && scene.layers[selectedLayerIndex]) {
              const copy = [...scene.layers];
              copy[selectedLayerIndex] = {
                ...copy[selectedLayerIndex],
                track_matte: 'luma',
                matte_layer: imgLayer,
              };
              commitScene({ ...scene, layers: copy });
              showToast(`Applied "${asset.title}" as Luma Track Matte.`);
              return;
            }
            if (asset.kind === 'backdrop') {
              commitScene({ ...scene, layers: [imgLayer, ...scene.layers] });
              setSelectedLayerIndex(0);
              showToast(`Backdrop added: ${asset.title}`);
              return;
            }
            const nextLayers = [...scene.layers, imgLayer];
            commitScene({ ...scene, layers: nextLayers });
            setSelectedLayerIndex(nextLayers.length - 1);
            showToast(`Overlay added: ${asset.title}`);
          }}
          onToggleHidden={handleToggleHidden}
          onMoveLayer={handleMoveLayer}
          onDuplicateLayer={handleDuplicateLayer}
          onDeleteLayer={handleDeleteLayer}
          onApplyRawJson={(next) => {
            commitScene(next);
            showToast('JSON changes applied to stage.');
          }}
          lintWarnings={lintWarnings}
          onAutoFixLint={handleAutoFixLint}
        />

        {/* Center Pane: Stage Preview + Transport */}
        <StageViewport
          scene={scene}
          currentTime={currentTime}
          isPlaying={isPlaying}
          loop={loop}
          selectedLayerIndex={selectedLayerIndex}
          frameNotes={frameNotes}
          onAddFrameNote={(note) => {
            setFrameNotes((prev) => [
              ...prev,
              { ...note, id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 6)}` },
            ]);
            setRightTab('ai');
            showToast('Frame note pinned. Click "Apply with AI" when ready.');
          }}
          onDeleteFrameNote={(id) => {
            setFrameNotes((prev) => prev.filter((n) => n.id !== id));
          }}
          onTogglePlay={() => setIsPlaying((p) => !p)}
          onSeek={(t) => {
            setIsPlaying(false);
            setCurrentTime(t);
          }}
          onToggleLoop={() => setLoop((l) => !l)}
          onSelectLayer={(idx) => {
            setSelectedLayerIndex(idx);
            if (idx !== null) setRightTab('inspector');
          }}
          onDragMoveLayer={handleDragMoveLayer}
          onSnapshotPng={() => {
            exportPngSnapshot(scene, currentTime, projectName.toLowerCase().replace(/[^a-z0-9]+/g, '_'))
              .then((res) => showToast(`Snapshot saved: ${res.filename}`))
              .catch(() => {});
          }}
          onNotify={showToast}
        />

        {/* Right Pane: AI BYOK Director & Layer Inspector */}
        <aside
          aria-label="AI Director and Inspector"
          className="w-[340px] shrink-0 bg-[#121319] border-l border-[#252630] flex flex-col min-h-0"
        >
          <div
            role="tablist"
            aria-label="Right panel mode"
            className="h-9 shrink-0 bg-[#171820] border-b border-[#252630] px-2 flex items-center gap-1"
          >
            <button
              role="tab"
              type="button"
              aria-selected={rightTab === 'ai'}
              onClick={() => setRightTab('ai')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1 text-xs font-semibold rounded transition-colors whitespace-nowrap ${
                rightTab === 'ai'
                  ? 'bg-[#F97316] text-[#09090D]'
                  : 'text-[#A1A1AA] hover:text-white'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>AI Director (BYOK)</span>
            </button>

            <button
              role="tab"
              type="button"
              aria-selected={rightTab === 'inspector'}
              onClick={() => setRightTab('inspector')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1 text-xs font-semibold rounded transition-colors whitespace-nowrap ${
                rightTab === 'inspector'
                  ? 'bg-[#252633] text-white'
                  : 'text-[#A1A1AA] hover:text-white'
              }`}
            >
              <Sliders className="w-3.5 h-3.5" />
              <span>Inspector</span>
            </button>
          </div>

          {rightTab === 'ai' ? (
            <AiDirectorPanel
              config={aiConfig}
              onUpdateConfig={(patch) => setAiConfig((c) => ({ ...c, ...patch }))}
              onClearSavedKey={() => {
                setAiConfig((c) => ({ ...c, apiKey: '' }));
                showToast('Personal API key cleared from local storage.');
              }}
              messages={aiMessages}
              isRunning={aiRunning}
              onSendCommand={handleSendAiCommand}
              onRevertScene={(prevScene) => {
                commitScene(prevScene);
                showToast('Scene reverted to previous version.');
              }}
              studioGeminiAvailable={capabilities.studioGeminiAvailable}
              frameNotes={frameNotes}
              onSeekToTime={(t) => {
                setIsPlaying(false);
                setCurrentTime(t);
              }}
              onDeleteFrameNote={(id) => {
                setFrameNotes((prev) => prev.filter((n) => n.id !== id));
              }}
              onUpdateFrameNote={(id, note) => {
                setFrameNotes((prev) => prev.map((n) => (n.id === id ? { ...n, note } : n)));
              }}
              onCopyFrameNotes={() => {
                const payload = JSON.stringify(
                  {
                    canvas: { width: scene.canvas.width, height: scene.canvas.height, fps: scene.canvas.fps },
                    notes: frameNotes.map((n, idx) => ({
                      index: idx + 1,
                      time_sec: n.timeSec,
                      x: n.x,
                      y: n.y,
                      ...(n.w && n.h ? { w: n.w, h: n.h } : {}),
                      note: n.note,
                    })),
                  },
                  null,
                  2
                );
                navigator.clipboard
                  .writeText(payload)
                  .then(() => showToast('Frame notes JSON copied to clipboard.'))
                  .catch(() => showToast('Failed to copy frame notes JSON.'));
              }}
              onClearFrameNotes={() => setFrameNotes([])}
              onApplyFrameNotes={async () => {
                if (frameNotes.length === 0) return;
                const lines = frameNotes.map((n, i) => {
                  const region = n.w && n.h ? `box (${n.x},${n.y} ${n.w}x${n.h})` : `point (${n.x},${n.y})`;
                  return `${i + 1}. [t=${n.timeSec.toFixed(2)}s, ${region}]: ${n.note}`;
                });
                const prompt = `Apply these frame-pinned review notes to the current scene:\n${lines.join('\n')}`;
                const refs: AiReferenceImage[] = [];
                try {
                  const snapCanvas = document.createElement('canvas');
                  snapCanvas.width = scene.canvas.width;
                  snapCanvas.height = scene.canvas.height;
                  const sctx = snapCanvas.getContext('2d');
                  if (sctx) {
                    renderRustrenFrame(sctx, scene, currentTime);
                    const dataUrl = snapCanvas.toDataURL('image/png');
                    const base64 = dataUrl.split(',')[1] || '';
                    if (base64) {
                      refs.push({
                        id: `frame_snap_${Date.now()}`,
                        name: `stage-t${currentTime.toFixed(2)}s.png`,
                        mimeType: 'image/png',
                        dataUrl,
                        base64,
                      });
                    }
                  }
                } catch {
                  // proceed without snapshot if canvas taint occurs
                }
                const ok = await handleSendAiCommand(prompt, 'edit', refs);
                if (ok) {
                  setFrameNotes([]);
                }
              }}
            />
          ) : (
            <InspectorPanel
              scene={scene}
              selectedLayerIndex={selectedLayerIndex}
              onUpdateCanvas={handleUpdateCanvas}
              onUpdateLayer={handleUpdateLayer}
            />
          )}
        </aside>
      </main>

      {/* Draggable vertical splitter between Stage and Timeline */}
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize timeline panel"
        title="Drag to resize timeline"
        onPointerDown={handleStartTimelineResize}
        className="h-1.5 shrink-0 bg-[#16171F] hover:bg-[#F97316]/60 cursor-row-resize transition-colors flex items-center justify-center group"
      >
        <div className="w-10 h-0.5 rounded-full bg-[#343544] group-hover:bg-white/80" />
      </div>

      {/* Bottom NLE Multi-Track Timeline */}
      <TimelinePanel
        scene={scene}
        currentTime={currentTime}
        selectedLayerIndex={selectedLayerIndex}
        height={timelineHeight}
        onSeek={(t) => {
          setIsPlaying(false);
          setCurrentTime(t);
        }}
        onSelectLayer={(idx) => {
          setSelectedLayerIndex(idx);
          setRightTab('inspector');
        }}
        onShiftLayerTiming={handleShiftLayerTiming}
      />

      {/* Export Dialog */}
      <ExportModal
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        scene={scene}
        currentTime={currentTime}
        projectName={projectName}
        ffmpegAvailable={capabilities.ffmpegAvailable}
      />

      {/* Drag & Drop Scene Overlay */}
      {isDragOver && (
        <div className="fixed inset-0 z-50 bg-[#09090D]/80 border-2 border-dashed border-[#F97316] flex items-center justify-center pointer-events-none">
          <div className="bg-[#14151C] border border-[#F97316]/60 rounded-lg px-6 py-4 text-center">
            <div className="text-sm font-bold text-white">Drop file to open in Rustren Studio</div>
            <div className="text-xs text-[#A1A1AA] mt-1">Supports .json, .html (Rustren scene), and images</div>
          </div>
        </div>
      )}

      {/* Subtle Toast Feedback */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-[#1C1D26] border border-[#343648] text-xs font-medium text-[#F4F4F6] px-4 py-2 rounded shadow-xl"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
