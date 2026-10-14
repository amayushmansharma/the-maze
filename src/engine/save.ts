import { DEFAULT_SETTINGS, type SaveData, type Settings } from "./types";

const SAVE_KEY = "themaze.save.v1";
const SET_KEY = "themaze.settings.v1";

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SET_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const s = { ...DEFAULT_SETTINGS, ...parsed };
    // clamp everything to sane ranges
    s.sensitivity = clamp(num(s.sensitivity, 1), 0.2, 3);
    s.fov = clamp(num(s.fov, 76), 60, 100);
    s.master = clamp01(num(s.master, 0.85));
    s.ambience = clamp01(num(s.ambience, 0.8));
    s.sfx = clamp01(num(s.sfx, 0.9));
    s.music = clamp01(num(s.music, 0.6));
    s.renderScale = clamp(num(s.renderScale, 1), 0.6, 1.5);
    s.headBob = clamp01(num(s.headBob, 0.5));
    if (!["low", "medium", "high"].includes(s.quality)) s.quality = "high";
    return s;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(SET_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable — settings simply do not persist */
  }
}

export function loadSave(): SaveData | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw) as SaveData;
    if (!d || d.version !== 1) return null;
    if (typeof d.seed !== "number" || !isFinite(d.seed)) return null;
    if (!Array.isArray(d.pos) || d.pos.length !== 3 || d.pos.some((n) => typeof n !== "number" || !isFinite(n))) return null;
    if (typeof d.yaw !== "number" || typeof d.pitch !== "number") return null;
    if (!d.objectives || typeof d.objectives !== "object") return null;
    if (!Array.isArray(d.items)) d.items = [];
    if (!Array.isArray(d.unlocked)) d.unlocked = [];
    if (!Array.isArray(d.doorsOpen)) d.doorsOpen = [];
    if (!Array.isArray(d.visited)) d.visited = [];
    if (!Array.isArray(d.notesRead)) d.notesRead = [];
    d.elapsed = num(d.elapsed, 0);
    d.steps = num(d.steps, 0);
    return d;
  } catch {
    return null;
  }
}

export function writeSave(data: SaveData) {
  try {
    data.updatedAt = Date.now();
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {
    /* ignore quota errors */
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
}

export function hasSave(): boolean {
  return loadSave() !== null;
}

function num(v: unknown, def: number): number {
  return typeof v === "number" && isFinite(v) ? v : def;
}
function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}
function clamp01(v: number) {
  return clamp(v, 0, 1);
}
