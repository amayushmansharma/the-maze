// Shared types between the rendering engine and the React UI layer.

export type QualityPreset = "low" | "medium" | "high";

export interface Settings {
  sensitivity: number; // 0.2 - 3
  fov: number; // 60 - 100
  master: number; // 0 - 1
  ambience: number;
  sfx: number;
  music: number;
  quality: QualityPreset;
  renderScale: number; // 0.6 - 1.5 (multiplies capped device pixel ratio)
  headBob: number; // 0 - 1
  motionEffects: boolean; // subtle camera sway / roll
  events: boolean; // scripted atmosphere events
  showFps: boolean;
  invertY: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 1,
  fov: 76,
  master: 0.85,
  ambience: 0.8,
  sfx: 0.9,
  music: 0.6,
  quality: "high",
  renderScale: 1,
  headBob: 0.5,
  motionEffects: false,
  events: true,
  showFps: false,
  invertY: false,
};

export const QUALITY_PRESETS: Record<QualityPreset, {
  pixelRatio: number;
  shadows: number; // number of shadow casting spot lights
  shadowMapSize: number;
  bloom: boolean;
  anisotropy: number;
  foliageDensity: number;
  props: number;
}> = {
  low: { pixelRatio: 0.85, shadows: 0, shadowMapSize: 512, bloom: false, anisotropy: 1, foliageDensity: 0.35, props: 0.4 },
  medium: { pixelRatio: 1, shadows: 2, shadowMapSize: 1024, bloom: false, anisotropy: 4, foliageDensity: 0.7, props: 0.75 },
  high: { pixelRatio: 1.4, shadows: 3, shadowMapSize: 1536, bloom: true, anisotropy: 8, foliageDensity: 1, props: 1 },
};

/** Snapshot pushed from the engine to React for the HUD. Deliberately tiny:
 *  the only thing the player has to think about is finding the exit. */
export interface HudState {
  playing: boolean;
  time: number; // seconds since the player gained control (pauses with the game)
  fps: number;
  showFps: boolean;
  intro: boolean; // "FIND THE EXIT." is visible
  mapOpen: boolean;
  ending: null | { time: number };
  coop: null | { escaped: number; total: number; exploring: number };
  seed: number;
}

export interface SaveData {
  version: 1;
  seed: number;
  createdAt: number;
  updatedAt: number;
  elapsed: number;
  steps: number;
  pos: [number, number, number];
  yaw: number;
  pitch: number;
  objectives: Record<string, boolean>;
  items: string[];
  unlocked: string[];
  doorsOpen: string[];
  visited: number[]; // packed bitfield words
  notesRead: string[];
  flashlight: boolean;
}
