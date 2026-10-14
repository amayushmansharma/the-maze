import { generateMaze } from "./maze";

const STORAGE_KEY = "themaze.recentConfigs.v1";
const MAX_HISTORY = 40;

// In-memory set of configurations used during the current browser session
const sessionConfigs = new Set<string>();

/**
 * Creates an unordered canonical key for an entrance/exit cell pair.
 * e.g. "4,4<->25,20" (always sorted so entrance and exit order doesn't duplicate).
 */
export function makeConfigKey(spawn: [number, number], exitCell: [number, number]): string {
  const k1 = `${spawn[0]},${spawn[1]}`;
  const k2 = `${exitCell[0]},${exitCell[1]}`;
  return k1 < k2 ? `${k1}<->${k2}` : `${k2}<->${k1}`;
}

export function loadPersistentHistory(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function isConfigRecentlyUsed(key: string): boolean {
  if (sessionConfigs.has(key)) return true;
  const persistent = loadPersistentHistory();
  return persistent.includes(key);
}

export function recordConfigUsed(spawn: [number, number], exitCell: [number, number]): void {
  const key = makeConfigKey(spawn, exitCell);
  sessionConfigs.add(key);
  try {
    const history = loadPersistentHistory().filter((k) => k !== key);
    history.unshift(key);
    if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  } catch {
    // localStorage unavailable in some sandboxes - sessionConfigs still protects current session
  }
}

export function clearConfigHistory(): void {
  sessionConfigs.clear();
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function parseSeedInput(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) {
    const num = parseInt(trimmed, 10);
    if (num > 0 && num <= 2147483647) return num;
  }
  return hashSeedString(trimmed);
}

export function hashSeedString(str: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 1000000000 || 123456789;
}

/**
 * Generates a fresh seed guaranteed or preferred to produce an entrance/exit configuration
 * that has not been recently used in this session or in persistent storage.
 */
export function generateFreshSeed(): number {
  let bestSeed = 0;
  let leastRecentIndex = -1;
  const persistent = loadPersistentHistory();

  for (let attempt = 0; attempt < 30; attempt++) {
    const candidate = Math.floor(100000 + Math.random() * 899999999);
    const m = generateMaze(candidate);
    const key = makeConfigKey(m.spawn, m.exitCell);

    // If never used in this session and not in persistent history, return immediately!
    if (!sessionConfigs.has(key) && !persistent.includes(key)) {
      return candidate;
    }

    // Otherwise track the candidate whose configuration was least recently used
    const idx = persistent.indexOf(key);
    if (!sessionConfigs.has(key) && idx > leastRecentIndex) {
      leastRecentIndex = idx;
      bestSeed = candidate;
    } else if (bestSeed === 0) {
      bestSeed = candidate;
    }
  }

  return bestSeed || Math.floor(100000 + Math.random() * 899999999);
}
