import { CELL, GRID, MAZE_GEN_VERSION } from "@/engine/maze";

export { MAZE_GEN_VERSION };

export const MAX_PLAYERS = 6;
export const ROOM_CODE_LEN = 6;
export const POS_HZ = 18;
export const INTERP_DELAY_MS = 100;
export const HOST_TIMEOUT_MS = 8000;
export const HEARTBEAT_MS = 2000;
export const DISCONNECT_GRACE_MS = 6000;
export const RECONNECT_WINDOW_MS = 45000;
export const MAX_MSG_BYTES = 4096;
export const POS_RATE_MAX = 30; // per second per player, reject above this
export const APP_PREFIX = "tm";

/** Unambiguous alphabet: no 0/O, 1/I/L. */
const ALPHA = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export type RoomPhase = "lobby" | "starting" | "running" | "completed" | "closed";

export type PlayerStatus = "lobby" | "ready" | "playing" | "escaped" | "left" | "disconnected";

export interface RosterPlayer {
  id: string;
  name: string;
  host: boolean;
  status: PlayerStatus;
  color: number;
  slot: number;
  escapeTime: number | null;
  token: string;
}

export interface SessionResult {
  id: string;
  name: string;
  status: PlayerStatus;
  escapeTime: number | null;
}

export type Msg =
  | { t: "hello"; id: string; name: string; v: number; reconnect?: string }
  | {
      t: "welcome";
      you: string;
      hostId: string;
      seed: number;
      hash: string;
      v: number;
      phase: RoomPhase;
      players: RosterPlayer[];
      token: string;
      startAt?: number;
    }
  | { t: "join"; player: RosterPlayer }
  | { t: "leave"; id: string; reason: string }
  | { t: "roster"; players: RosterPlayer[] }
  | { t: "start"; seed: number; hash: string; at: number }
  | { t: "ready"; id: string; hash: string }
  | { t: "pos"; id: string; x: number; y: number; z: number; yaw: number; pitch: number; sp: 0 | 1; seq: number }
  | { t: "escape"; id: string; time: number }
  | { t: "ping"; n: number; ts: number }
  | { t: "pong"; n: number; ts: number; ht: number }
  | { t: "hb"; hostId: string; phase: RoomPhase }
  | { t: "hostgone"; reason: string }
  | { t: "end"; results: SessionResult[]; duration: number }
  | { t: "rematch"; seed: number; hash: string }
  | { t: "error"; msg: string }
  | { t: "kick"; reason: string };

export function makeRoomCode(rng: () => number = Math.random): string {
  let s = "";
  for (let i = 0; i < ROOM_CODE_LEN; i++) s += ALPHA[(rng() * ALPHA.length) | 0];
  return s;
}

export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function isValidCode(code: string): boolean {
  if (code.length !== ROOM_CODE_LEN) return false;
  for (const c of code) if (!ALPHA.includes(c)) return false;
  return true;
}

export function peerIdFor(code: string): string {
  return `${APP_PREFIX}${code}`;
}

export function sanitizeName(raw: string): string {
  const s = raw.replace(/[^\w \-.'']/g, "").trim().slice(0, 16);
  return s || defaultName();
}

export function defaultName(): string {
  return "WANDERER " + String(100 + ((Math.random() * 900) | 0)).slice(1);
}

export function makeId(): string {
  const a = cryptoRandom();
  return "p" + a.toString(16).padStart(8, "0") + ((Math.random() * 0xffff) | 0).toString(16);
}

export function makeToken(): string {
  return makeId() + makeId();
}

function cryptoRandom(): number {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const b = new Uint32Array(1);
    crypto.getRandomValues(b);
    return b[0]!;
  }
  return (Math.random() * 0xffffffff) | 0;
}

const COLORS = [0xb08d4a, 0x7a9bb8, 0x8a6a78, 0x6b8f71, 0xc4a882, 0x6a7b8a];
export function colorForSlot(slot: number): number {
  return COLORS[slot % COLORS.length]!;
}

export function parseMsg(raw: unknown): Msg | null {
  if (typeof raw === "string") {
    if (raw.length > MAX_MSG_BYTES) return null;
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== "object") return null;
  const m = raw as { t?: unknown };
  if (typeof m.t !== "string") return null;
  return m as Msg;
}

export function validPos(msg: Extract<Msg, { t: "pos" }>): boolean {
  if (typeof msg.id !== "string" || msg.id.length > 40) return false;
  if (![msg.x, msg.y, msg.z, msg.yaw, msg.pitch].every((n) => typeof n === "number" && Number.isFinite(n))) return false;
  const lim = GRID * CELL + 20;
  if (msg.x < -10 || msg.x > lim || msg.z < -10 || msg.z > lim) return false;
  if (msg.y < -1 || msg.y > 8) return false;
  if (Math.abs(msg.yaw) > 50 || Math.abs(msg.pitch) > 2) return false;
  if (msg.sp !== 0 && msg.sp !== 1) return false;
  if (!Number.isFinite(msg.seq)) return false;
  return true;
}

export function loadStoredName(): string {
  try {
    const n = localStorage.getItem("themaze.playerName");
    if (n) return sanitizeName(n);
  } catch {
    /* ignore */
  }
  return defaultName();
}

export function storeName(name: string) {
  try {
    localStorage.setItem("themaze.playerName", sanitizeName(name));
  } catch {
    /* ignore */
  }
}

export const GEN_VERSION = MAZE_GEN_VERSION;
