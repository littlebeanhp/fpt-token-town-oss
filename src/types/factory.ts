import type { Group, Object3D, Vector3 } from 'three/webgpu';

export type FactoryId = 'deepseek' | 'glm' | 'gemma-26b' | 'qwen' | 'tts' | 'llama' | 'gemma-31b';
/** Every camera stop in the locked city tour is a model district; the hub is the home stop. */
export type StopId = FactoryId;
/** Vendor marks in `public/logos`; two Gemma districts share one brand. */
export type BrandLogo = 'deepseek' | 'zhipu' | 'gemma' | 'qwen' | 'meta' | 'fpt';
/** Speech is billed per character, everything else per token. */
export type UsageUnit = 'tokens' | 'characters';
export type AnchorName =
  'CameraAnchor' | 'CameraTarget' | 'Doorway' | 'TokenInput' | 'TokenOutput' | 'UIAnchor';
export interface StopDefinition {
  id: StopId;
  name: string;
  category: string;
  description: string;
  color: string;
  /** Vendor behind the model, shown on the nameplate and in the city directory. */
  brand: string;
  /** Logo file stem: `/logos/<logo>.svg` in colour, `/logos/<logo>-mono.svg` in white. */
  logo: BrandLogo;
  /** World position of the building origin; its city block is derived from x/z. */
  position: [number, number, number];
}
export interface ModelDefinition extends StopDefinition {
  id: FactoryId;
  /** Usage this week, as reported by the dashboard, counted in `unit`. */
  usage: number;
  unit: UsageUnit;
  /** Catalog context window, already formatted; undefined where the model takes none. */
  contextLength?: string;
  /** Catalog price, already formatted, e.g. `$0.45/$3.20`. */
  price?: string;
  priceUnit?: string;
  /** Illustrative cached rate, randomly assigned per LLM; speech has none. */
  cachedRate?: number;
  assetUrl?: string;
}
/** All positions are world-space. Implementations own and dispose their resources. */
export interface FactoryAsset {
  readonly root: Group;
  readonly colliders: Object3D[];
  getAnchor(name: AnchorName, target: Vector3): Vector3;
  setEmphasis(value: number): void;
  setNight(value: number): void;
  dispose(): void;
}
export type DayPhase = 'night' | 'dawn' | 'day' | 'dusk';
export type DayPreset = 'day' | 'dusk' | 'night';
export interface ClockState {
  /** City time in hours, 0 to 24. */
  hours: number;
  phase: DayPhase;
  /** True when the city reads as night, used for the page theme. */
  night: boolean;
  paused: boolean;
  speed: number;
}
/** Chapters of the startup sequence, in the order the city reports them. */
export type LoadStage = 'renderer' | 'city' | 'districts' | 'backdrop' | 'crowd' | 'shaders';
export interface ExperienceCallbacks {
  /** A rendered starting view is available; tour controls wait for onReady. */
  onPreview?: () => void;
  /** Which chapter of the startup sequence the city has reached. */
  onStage?: (stage: LoadStage) => void;
  onSelect: (id: StopId) => void;
  onReady: (backend: string) => void;
  onError: (message: string) => void;
  onClock: (state: ClockState) => void;
}
