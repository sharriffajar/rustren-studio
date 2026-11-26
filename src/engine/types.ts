/**
 * Rustren v1.1 Declarative Scene Types
 * Aligned with sdk/typescript/rustren.d.ts from sharriffajar/rustren
 */

export type HexColor = string;

export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color_dodge'
  | 'color_burn'
  | 'hard_light'
  | 'soft_light'
  | 'difference'
  | 'exclusion';

export type FitMode = 'fill' | 'cover' | 'contain';

export type Easing =
  | 'linear'
  | 'ease_in'
  | 'ease_out'
  | 'ease_in_out'
  | 'ease_in_quad'
  | 'ease_out_quad'
  | 'ease_in_out_quad'
  | 'ease_in_expo'
  | 'ease_out_expo'
  | 'ease_in_out_expo'
  | 'ease_in_back'
  | 'ease_out_back'
  | 'ease_in_out_back'
  | 'ease_out_bounce'
  | 'cubic_bezier'
  | 'spring';

export type AnimProperty =
  | 'x'
  | 'y'
  | 'width'
  | 'height'
  | 'opacity'
  | 'scale'
  | 'scale_x'
  | 'scale_y'
  | 'rotation'
  | 'skew_x'
  | 'skew_y'
  | 'rotate_x'
  | 'rotate_y'
  | 'perspective'
  | 'z'
  | 'rotate_z'
  | 'z_index'
  | 'cx'
  | 'cy'
  | 'r'
  | 'radius'
  | 'color'
  | 'background'
  | 'border_color'
  | 'path_progress'
  | 'stroke_dashoffset'
  | 'volume';

export type Anchor =
  | 'top_left'
  | 'top_center'
  | 'top_right'
  | 'center_left'
  | 'center'
  | 'center_right'
  | 'bottom_left'
  | 'bottom_center'
  | 'bottom_right';

export type TextAlign = 'left' | 'center' | 'right' | 'start' | 'end';

export type FontWeight =
  | 'thin'
  | 'extralight'
  | 'light'
  | 'normal'
  | 'medium'
  | 'semibold'
  | 'bold'
  | 'extrabold'
  | 'black'
  | 100
  | 200
  | 300
  | 400
  | 500
  | 600
  | 700
  | 800
  | 900;

export type WaveWarpAxis = 'x' | 'y' | 'stretch_x' | 'stretch_y';

export interface WaveWarpSpec {
  amplitude?: number;
  wavelength?: number;
  /** @deprecated legacy alias; use wavelength */
  frequency?: number;
  speed?: number;
  phase?: number;
  axis?: WaveWarpAxis;
}

export interface EchoSpec {
  count?: number;
  step_sec?: number;
  decay?: number;
}

export interface TextAnimatorSpec {
  mode?: 'char' | 'word';
  /** @deprecated legacy alias; use mode */
  unit?: 'char' | 'word';
  start_sec?: number;
  stagger_secs?: number;
  duration_secs?: number;
  x_offset?: number;
  y_offset?: number;
  opacity_from?: number;
  scale_from?: number;
  easing?: Easing;
}

export type TrackMatteMode = 'alpha' | 'alpha_inverted' | 'luma' | 'luma_inverted';

export interface FrameNote {
  id: string;
  timeSec: number;
  x: number;
  y: number;
  w?: number;
  h?: number;
  note: string;
}

export interface GradientStop {
  offset: number;
  color: HexColor;
}

export interface LinearGradient {
  type?: 'linear' | 'radial';
  from?: HexColor;
  to?: HexColor;
  stops?: GradientStop[];
  angle?: number;
}

export interface SpringConfig {
  stiffness?: number;
  damping?: number;
  mass?: number;
}

export interface Keyframe {
  time: number;
  value: number | HexColor;
  easing?: Easing;
  bezier?: [number, number, number, number];
}

export interface Animation {
  property: AnimProperty;
  from?: number | HexColor;
  to?: number | HexColor;
  start_sec?: number;
  end_sec?: number;
  easing?: Easing;
  bezier?: [number, number, number, number];
  spring?: SpringConfig;
  keyframes?: Keyframe[];
  expr?: string;
  expression?: string;
  repeat?: number | 'infinite';
  yoyo?: boolean;
}

export type DynamicText =
  | {
      mode: 'typewriter';
      text: string;
      start_sec?: number;
      end_sec?: number;
      cursor?: string;
    }
  | {
      mode: 'counter';
      from: number;
      to: number;
      decimals?: number;
      prefix?: string;
      suffix?: string;
      start_sec?: number;
      end_sec?: number;
      easing?: Easing;
    }
  | {
      mode: 'timecode';
      format?: 'mm:ss' | 'mm:ss.cc' | 'hh:mm:ss';
      offset_sec?: number;
    };

export interface TextSpan {
  text: string;
  color?: HexColor;
  font_weight?: 'normal' | 'bold';
}

export interface ShadowConfig {
  color?: HexColor;
  blur?: number;
  offset_x?: number;
  offset_y?: number;
}

export interface LayoutConfig {
  direction?: 'row' | 'column';
  justify_content?:
    | 'start'
    | 'center'
    | 'end'
    | 'space_between'
    | 'space_around'
    | 'stretch'
    | 'flex_start'
    | 'flex_end';
  align_items?:
    | 'start'
    | 'center'
    | 'end'
    | 'space_between'
    | 'space_around'
    | 'stretch'
    | 'flex_start'
    | 'flex_end';
  gap?: number;
  padding?: number;
  padding_top?: number;
  padding_right?: number;
  padding_bottom?: number;
  padding_left?: number;
}

export interface BaseLayer {
  id?: string;
  name?: string;
  position?: 'absolute' | 'relative';
  start_sec?: number;
  end_sec?: number;
  duration_secs?: number;
  opacity?: number;
  z_index?: number;
  anchor?: Anchor;
  pivot_x?: number;
  pivot_y?: number;
  scale_x?: number;
  scale_y?: number;
  skew_x?: number;
  skew_y?: number;
  blur?: number;
  blend_mode?: BlendMode;
  shadow?: ShadowConfig;
  echo?: EchoSpec;
  wave_warp?: WaveWarpSpec;
  track_matte?: TrackMatteMode;
  matte_layer?: Layer | string;
  hidden?: boolean;
  animations?: Animation[];
}

export interface RectLayer extends BaseLayer {
  type: 'rect';
  x?: number;
  y?: number;
  width: number;
  height: number;
  radius?: number;
  rotation?: number;
  scale?: number;
  color: HexColor;
  gradient?: LinearGradient;
  border_color?: HexColor;
  border_width?: number;
  path_progress?: number;
  stroke_dashoffset?: number;
}

export interface CircleLayer extends BaseLayer {
  type: 'circle';
  cx?: number;
  cy?: number;
  r: number;
  color: HexColor;
  gradient?: LinearGradient;
  border_color?: HexColor;
  border_width?: number;
  scale?: number;
  rotation?: number;
}

export interface TextLayer extends BaseLayer {
  type: 'text';
  x?: number;
  y?: number;
  content?: string;
  dynamic?: DynamicText;
  spans?: TextSpan[];
  font_size?: number;
  line_height?: number;
  letter_spacing?: number;
  font_family?: string;
  font_weight?: FontWeight;
  text_align?: TextAlign;
  text_animator?: TextAnimatorSpec;
  color?: HexColor;
  gradient?: LinearGradient;
  scale?: number;
  rotation?: number;
  max_width?: number;
}

export interface SvgLayer extends BaseLayer {
  type: 'svg';
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  src: string;
  rotation?: number;
  scale?: number;
}

export interface ImageLayer extends BaseLayer {
  type: 'image';
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  src: string;
  fit?: FitMode;
  rotation?: number;
  scale?: number;
  radius?: number;
}

export interface VideoLayer extends BaseLayer {
  type: 'video';
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  src: string;
  fit?: FitMode;
  loop?: boolean;
  playback_rate?: number;
  rotation?: number;
  scale?: number;
  radius?: number;
}

export interface LottieLayer extends BaseLayer {
  type: 'lottie';
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  src: string;
  loop_animation?: boolean;
  speed?: number;
  rotation?: number;
  scale?: number;
}

export interface WaveformLayer extends BaseLayer {
  type: 'waveform';
  x?: number;
  y?: number;
  width: number;
  height: number;
  bars?: number;
  bar_gap?: number;
  color?: HexColor;
  seed?: number;
  speed?: number;
  rotation?: number;
  scale?: number;
}

export interface ParticlesLayer extends BaseLayer {
  type: 'particles';
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  count?: number;
  seed?: number;
  speed?: number;
  gravity?: number;
  spread?: number;
  angle?: number;
  size?: number;
  color?: HexColor;
  colors?: HexColor[];
  shape?: 'circle' | 'rect' | 'confetti';
  rotation?: number;
  scale?: number;
}

export interface ContainerLayer extends BaseLayer {
  type: 'container';
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  background?: HexColor;
  /** @deprecated legacy alias; use background */
  color?: HexColor;
  gradient?: LinearGradient;
  radius?: number;
  border_color?: HexColor;
  border_width?: number;
  clip?: boolean;
  clip_feather?: number;
  cascade_opacity?: boolean;
  timeline?: 'global' | 'local' | 'series';
  stagger_secs?: number;
  layout?: LayoutConfig;
  scale?: number;
  rotation?: number;
  children?: Layer[];
}

export type Layer =
  | RectLayer
  | CircleLayer
  | TextLayer
  | SvgLayer
  | ImageLayer
  | VideoLayer
  | LottieLayer
  | WaveformLayer
  | ParticlesLayer
  | ContainerLayer;

export interface CanvasConfig {
  width: number;
  height: number;
  fps: number;
  duration_secs: number;
  background?: HexColor;
}

export interface RustrenScene {
  schema_version?: string;
  canvas: CanvasConfig;
  fonts?: string[];
  audio?: Array<{
    src: string;
    start_sec?: number;
    volume?: number;
  }>;
  layers: Layer[];
}

export interface LintWarning {
  code: 'font_size' | 'end_sec' | 'missing_max_width' | 'out_of_canvas' | 'low_contrast' | 'schema';
  path: string;
  message: string;
  fix?: string;
}

export type AiProviderId =
  | 'studio_gemini'
  | 'gemini_byok'
  | 'openai'
  | 'openrouter'
  | 'anthropic'
  | 'custom';

export interface AiProviderConfig {
  provider: AiProviderId;
  apiKey: string;
  model: string;
  baseUrl: string;
  useCorsProxy?: boolean;
  rememberKey: boolean;
  autoRenderAfterAi: boolean;
  autoRenderFormat: 'mp4' | 'webm' | 'png';
}

export interface AiChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'error';
  content: string;
  timestamp: number;
  providerLabel?: string;
  layerDelta?: string;
  sceneSnapshotBefore?: RustrenScene;
  autoRenderTriggered?: boolean;
}

/** A moodboard / reference image attached to an AI Director prompt. */
export interface AiReferenceImage {
  /** Stable id used as the React key and for removal. */
  id: string;
  /** Original file name, shown as a tooltip. */
  name: string;
  /** `image/png` | `image/jpeg` | `image/webp`. */
  mimeType: string;
  /** Full data URL (`data:<mime>;base64,<payload>`), used by OpenAI-compatible APIs. */
  dataUrl: string;
  /** Raw base64 payload without the data-URL prefix, used by Gemini and Anthropic. */
  base64: string;
}
