import { generateMaze, mazeFingerprint, MAZE_GEN_VERSION } from "@/engine/maze";
import { generateFreshSeed, recordConfigUsed } from "@/engine/configHistory";
import {
  colorForSlot,
  DISCONNECT_GRACE_MS,
  HEARTBEAT_MS,
  isValidCode,
  makeId,
  makeRoomCode,
  makeToken,
  MAX_PLAYERS,
  normalizeCode,
  POS_RATE_MAX,
  sanitizeName,
  type Msg,
  type PlayerStatus,
  type RosterPlayer,
  type RoomPhase,
  type SessionResult,
  validPos,
} from "./protocol";
import { createHostTransport, openClient, type ClientLink, type ClientTransport, type HostTransport } from "./transport";

export interface LobbyView {
  code: string;
  phase: RoomPhase;
  host: boolean;
  selfId: string;
  players: RosterPlayer[];
  seed: number;
  hash: string;
  error: string | null;
  status: string;
  startAt: number | null;
  clockOffset: number;
  results: SessionResult[];
  duration: number;
}

export type SessionEvent =
  | { type: "lobby"; view: LobbyView }
  | { type: "start"; seed: number; hash: string; at: number; offset: number; slot: number; selfId: string }
  | { type: "pos"; id: string; x: number; y: number; z: number; yaw: number; pitch: number; sprint: boolean }
  | { type: "escape"; id: string; time: number }
  | { type: "left"; id: string }
  | { type: "hostgone"; reason: string }
  | { type: "end"; results: SessionResult[]; duration: number }
  | { type: "rematch"; seed: number; hash: string }
  | { type: "error"; msg: string };

type Listener = (e: SessionEvent) => void;

interface Member {
  rec: RosterPlayer;
  link: ClientLink | null;
  lastPosAt: number;
  lastHb: number;
  seq: number;
  goneTimer: number;
}

function pickSeed(customSeed?: number): { seed: number; hash: string } {
  const seed0 =
    customSeed != null && Number.isFinite(customSeed) && customSeed > 0
      ? Math.floor(customSeed)
      : generateFreshSeed();
  const m = generateMaze(seed0);
  recordConfigUsed(m.spawn, m.exitCell);
  return { seed: m.seed, hash: mazeFingerprint(m) };
}

export class NetSession {
  private listeners: Listener[] = [];
  private host: HostTransport | null = null;
  private client: ClientTransport | null = null;
  private members = new Map<string, Member>();
  private self: RosterPlayer | null = null;
  private phase: RoomPhase = "closed";
  private code = "";
  private seed = 0;
  private hash = "";
  private startAt: number | null = null;
  private clockOffset = 0;
  private error: string | null = null;
  private status = "";
  private results: SessionResult[] = [];
  private duration = 0;
  private hbTimer = 0;
  private pingN = 0;
  private pingT = 0;
  private runStarted = 0;
  private closed = false;
  private welcomeHook: ((ok: boolean) => void) | null = null;

  on(fn: Listener) {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((x) => x !== fn);
    };
  }
  private emit(e: SessionEvent) {
    for (const l of this.listeners) l(e);
  }

  get isHost() {
    return !!this.host;
  }
  get view(): LobbyView {
    return {
      code: this.code,
      phase: this.phase,
      host: this.isHost,
      selfId: this.self?.id ?? "",
      players: this.roster(),
      seed: this.seed,
      hash: this.hash,
      error: this.error,
      status: this.status,
      startAt: this.startAt,
      clockOffset: this.clockOffset,
      results: this.results,
      duration: this.duration,
    };
  }

  private roster(): RosterPlayer[] {
    if (this.host) return [...this.members.values()].map((m) => m.rec);
    return this.cachedRoster;
  }
  private cachedRoster: RosterPlayer[] = [];

  private pushLobby() {
    this.emit({ type: "lobby", view: this.view });
  }

  /* ---------------------------- host ---------------------------- */
  async createRoom(name: string, customSeed?: number): Promise<LobbyView> {
    this.reset();
    const clean = sanitizeName(name);
    let lastErr = "Could not create room.";
    for (let attempt = 0; attempt < 6; attempt++) {
      const code = makeRoomCode();
      try {
        const host = await createHostTransport(code);
        this.host = host;
        this.code = code;
        this.phase = "lobby";
        const picked = pickSeed(customSeed);
        this.seed = picked.seed;
        this.hash = picked.hash;
        this.self = {
          id: makeId(),
          name: clean,
          host: true,
          status: "lobby",
          color: colorForSlot(0),
          slot: 0,
          escapeTime: null,
          token: makeToken(),
        };
        this.members.set(this.self.id, {
          rec: this.self,
          link: null,
          lastPosAt: 0,
          lastHb: performance.now(),
          seq: 0,
          goneTimer: 0,
        });
        host.onPipe = (link) => this.acceptPipe(link);
        this.hostBeat();
        this.hbTimer = window.setInterval(() => this.hostBeat(), 1000);
        this.status = "Waiting for players.";
        this.pushLobby();
        return this.view;
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
        if (lastErr !== "ROOM_CODE_TAKEN") break;
      }
    }
    throw new Error(lastErr === "ROOM_CODE_TAKEN" ? "Could not reserve a room code. Try again." : lastErr);
  }

  private acceptPipe(link: ClientLink) {
    let member: Member | null = null;
    const handler = (msg: Msg) => {
      if (!member) {
        if (msg.t !== "hello") return;
        member = this.onHello(link, msg);
        return;
      }
      this.onClientMsg(member, msg);
    };
    const onGone = () => {
      if (member) this.markGone(member);
    };
    return { handler, onGone };
  }

  private onHello(link: ClientLink, msg: Extract<Msg, { t: "hello" }>): Member | null {
    if (this.phase === "closed") {
      link.send({ t: "error", msg: "Room closed." });
      return null;
    }
    if (msg.v !== MAZE_GEN_VERSION) {
      link.send({ t: "error", msg: "Incompatible game version." });
      link.close();
      return null;
    }
    // reconnect
    if (msg.reconnect) {
      for (const m of this.members.values()) {
        if (m.rec.token === msg.reconnect && m.rec.status === "disconnected") {
          m.link = link;
          m.rec.status = this.phase === "running" || this.phase === "starting" ? "playing" : "lobby";
          m.lastHb = performance.now();
          this.welcome(link, m.rec);
          this.bcastRoster();
          this.pushLobby();
          return m;
        }
      }
    }
    if (this.phase !== "lobby") {
      link.send({ t: "error", msg: "Game already started." });
      link.close();
      return null;
    }
    if (this.liveCount() >= MAX_PLAYERS) {
      link.send({ t: "error", msg: "Room full." });
      link.close();
      return null;
    }
    const slot = this.nextSlot();
    const rec: RosterPlayer = {
      id: typeof msg.id === "string" && msg.id.length < 40 ? msg.id : makeId(),
      name: this.uniqueName(sanitizeName(msg.name)),
      host: false,
      status: "lobby",
      color: colorForSlot(slot),
      slot,
      escapeTime: null,
      token: makeToken(),
    };
    const member: Member = { rec, link, lastPosAt: 0, lastHb: performance.now(), seq: 0, goneTimer: 0 };
    this.members.set(rec.id, member);
    this.welcome(link, rec);
    this.host!.broadcast({ t: "join", player: rec });
    this.bcastRoster();
    this.pushLobby();
    return member;
  }

  private welcome(link: ClientLink, rec: RosterPlayer) {
    link.send({
      t: "welcome",
      you: rec.id,
      hostId: this.self!.id,
      seed: this.seed,
      hash: this.hash,
      v: MAZE_GEN_VERSION,
      phase: this.phase,
      players: this.roster(),
      token: rec.token,
      startAt: this.startAt ?? undefined,
    });
  }

  private uniqueName(name: string): string {
    const taken = new Set([...this.members.values()].map((m) => m.rec.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let n = 2; n < 30; n++) {
      const c = `${name} ${n}`;
      if (!taken.has(c.toLowerCase())) return c;
    }
    return name + " " + makeId().slice(1, 4);
  }

  private nextSlot() {
    const used = new Set([...this.members.values()].map((m) => m.rec.slot));
    for (let i = 0; i < MAX_PLAYERS; i++) if (!used.has(i)) return i;
    return 0;
  }

  private liveCount() {
    let n = 0;
    for (const m of this.members.values()) if (m.rec.status !== "left" && m.rec.status !== "disconnected") n++;
    return n;
  }

  private onClientMsg(m: Member, msg: Msg) {
    m.lastHb = performance.now();
    switch (msg.t) {
      case "ready":
        if (this.phase === "starting" && msg.hash === this.hash) {
          m.rec.status = "ready";
          this.bcastRoster();
          this.pushLobby();
        }
        break;
      case "pos":
        if (this.phase !== "running") return;
        if (msg.id !== m.rec.id) return;
        if (!validPos(msg)) return;
        const now = performance.now();
        if (now - m.lastPosAt < 1000 / POS_RATE_MAX) return;
        if (msg.seq <= m.seq) return;
        m.seq = msg.seq;
        m.lastPosAt = now;
        this.relayExcept(m.rec.id, msg);
        this.emit({ type: "pos", id: m.rec.id, x: msg.x, y: msg.y, z: msg.z, yaw: msg.yaw, pitch: msg.pitch, sprint: msg.sp === 1 });
        break;
      case "escape":
        if (this.phase !== "running") return;
        if (m.rec.status === "escaped") return;
        const t = Math.max(0, Number(msg.time) || 0);
        m.rec.status = "escaped";
        m.rec.escapeTime = t;
        this.host!.broadcast({ t: "escape", id: m.rec.id, time: t });
        this.emit({ type: "escape", id: m.rec.id, time: t });
        this.checkComplete();
        this.pushLobby();
        break;
      case "ping":
        m.link?.send({ t: "pong", n: msg.n, ts: msg.ts, ht: performance.now() });
        break;
      default:
        break;
    }
  }

  private relayExcept(id: string, msg: Msg) {
    for (const m of this.members.values()) {
      if (m.rec.id === id || m.rec.host) continue;
      m.link?.send(msg);
    }
  }

  private bcastRoster() {
    this.host?.broadcast({ t: "roster", players: this.roster() });
  }

  private hostBeat() {
    if (!this.host || this.phase === "closed") return;
    this.host.broadcast({ t: "hb", hostId: this.self!.id, phase: this.phase });
    const now = performance.now();
    for (const m of this.members.values()) {
      if (m.rec.host) continue;
      if (m.rec.status === "left" || m.rec.status === "disconnected") continue;
      if (now - m.lastHb > DISCONNECT_GRACE_MS) this.markGone(m);
    }
  }

  private markGone(m: Member) {
    if (m.rec.status === "left" || m.rec.status === "disconnected") return;
    const wasEscaped = m.rec.status === "escaped";
    m.rec.status = wasEscaped ? "escaped" : "disconnected";
    m.link = null;
    this.host?.broadcast({ t: "leave", id: m.rec.id, reason: "disconnected" });
    this.emit({ type: "left", id: m.rec.id });
    this.bcastRoster();
    this.pushLobby();
    this.checkComplete();
  }

  canStart(): string | null {
    if (!this.host) return "Only the host can start.";
    if (this.phase !== "lobby") return "The room is not in the lobby.";
    const n = [...this.members.values()].filter((m) => m.rec.status === "lobby" || m.rec.status === "ready").length;
    if (n < 2) return "Need at least two players.";
    return null;
  }

  startGame() {
    const err = this.canStart();
    if (err) {
      this.error = err;
      this.pushLobby();
      return;
    }
    this.phase = "starting";
    this.startAt = performance.now() + 1800;
    this.runStarted = 0;
    for (const m of this.members.values()) {
      if (m.rec.status === "lobby") m.rec.status = "ready";
    }
    this.host!.broadcast({ t: "start", seed: this.seed, hash: this.hash, at: this.startAt });
    this.bcastRoster();
    this.pushLobby();
    this.emit({
      type: "start",
      seed: this.seed,
      hash: this.hash,
      at: this.startAt,
      offset: 0,
      slot: this.self!.slot,
      selfId: this.self!.id,
    });
    window.setTimeout(() => {
      if (this.phase === "starting") {
        this.phase = "running";
        this.runStarted = performance.now();
        for (const m of this.members.values()) {
          if (m.rec.status === "ready" || m.rec.status === "lobby") m.rec.status = "playing";
        }
        this.bcastRoster();
        this.pushLobby();
      }
    }, 1900);
  }

  hostPos(msg: Extract<Msg, { t: "pos" }>) {
    if (!this.host || this.phase !== "running") return;
    this.host.broadcast(msg);
  }

  hostEscape(time: number) {
    if (!this.host || !this.self || this.self.status === "escaped") return;
    this.self.status = "escaped";
    this.self.escapeTime = time;
    this.host.broadcast({ t: "escape", id: this.self.id, time });
    this.emit({ type: "escape", id: this.self.id, time });
    this.checkComplete();
    this.pushLobby();
  }

  private checkComplete() {
    if (this.phase !== "running") return;
    const active = [...this.members.values()].filter((m) => m.rec.status === "playing" || m.rec.status === "ready");
    if (active.length > 0) return;
    this.phase = "completed";
    this.duration = (performance.now() - (this.runStarted || performance.now())) / 1000;
    this.results = this.roster().map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      escapeTime: p.escapeTime,
    }));
    this.host?.broadcast({ t: "end", results: this.results, duration: this.duration });
    this.emit({ type: "end", results: this.results, duration: this.duration });
    this.pushLobby();
  }

  rematch() {
    if (!this.host || (this.phase !== "completed" && this.phase !== "running")) return;
    const picked = pickSeed();
    this.seed = picked.seed;
    this.hash = picked.hash;
    this.phase = "lobby";
    this.startAt = null;
    this.results = [];
    this.duration = 0;
    for (const m of this.members.values()) {
      if (m.rec.status === "disconnected" || m.rec.status === "left") continue;
      m.rec.status = "lobby";
      m.rec.escapeTime = null;
      m.seq = 0;
    }
    this.host.broadcast({ t: "rematch", seed: this.seed, hash: this.hash });
    this.bcastRoster();
    this.emit({ type: "rematch", seed: this.seed, hash: this.hash });
    this.pushLobby();
  }

  /* --------------------------- client --------------------------- */
  async joinRoom(codeRaw: string, name: string): Promise<LobbyView> {
    this.reset();
    const code = normalizeCode(codeRaw);
    if (!isValidCode(code)) throw new Error("Invalid room code.");
    this.status = "Connecting…";
    this.pushLobby();
    const client = await openClient(code);
    this.client = client;
    this.code = code;
    this.self = {
      id: makeId(),
      name: sanitizeName(name),
      host: false,
      status: "lobby",
      color: colorForSlot(1),
      slot: 1,
      escapeTime: null,
      token: "",
    };
    const welcomed = new Promise<boolean>((resolve) => {
      const t = window.setTimeout(() => resolve(false), 8000);
      this.welcomeHook = (ok) => {
        window.clearTimeout(t);
        this.welcomeHook = null;
        resolve(ok);
      };
    });
    client.onMessage((msg) => this.onHostMsg(msg));
    client.onClose((reason) => {
      if (this.closed) return;
      this.phase = "closed";
      this.emit({ type: "hostgone", reason });
    });
    client.send({ t: "hello", id: this.self.id, name: this.self.name, v: MAZE_GEN_VERSION });
    const ok = await welcomed;
    if (!ok) {
      this.close();
      throw new Error(this.error || "Connection timeout.");
    }
    this.hbTimer = window.setInterval(() => {
      if (!this.client) return;
      this.pingN++;
      this.pingT = performance.now();
      this.client.send({ t: "ping", n: this.pingN, ts: this.pingT });
    }, HEARTBEAT_MS);
    return this.view;
  }

  private onHostMsg(msg: Msg) {
    switch (msg.t) {
      case "welcome": {
        if (msg.v !== MAZE_GEN_VERSION) {
          this.emit({ type: "error", msg: "Incompatible game version." });
          this.close();
          return;
        }
        this.self = {
          ...(this.self as RosterPlayer),
          id: msg.you,
          token: msg.token,
          slot: msg.players.find((p) => p.id === msg.you)?.slot ?? this.self!.slot,
          color: msg.players.find((p) => p.id === msg.you)?.color ?? this.self!.color,
          name: msg.players.find((p) => p.id === msg.you)?.name ?? this.self!.name,
        };
        this.seed = msg.seed;
        this.hash = msg.hash;
        this.phase = msg.phase;
        this.cachedRoster = msg.players;
        this.startAt = msg.startAt ?? null;
        this.error = null;
        this.status = "Connected.";
        this.welcomeHook?.(true);
        this.pushLobby();
        break;
      }
      case "error":
        this.error = msg.msg;
        this.welcomeHook?.(false);
        this.emit({ type: "error", msg: msg.msg });
        this.pushLobby();
        break;
      case "kick":
        this.emit({ type: "error", msg: msg.reason });
        this.close();
        break;
      case "join":
      case "roster":
        this.cachedRoster = msg.t === "roster" ? msg.players : [...this.cachedRoster.filter((p) => p.id !== msg.player.id), msg.player];
        this.pushLobby();
        break;
      case "leave":
        this.cachedRoster = this.cachedRoster.map((p) => (p.id === msg.id ? { ...p, status: "disconnected" as PlayerStatus } : p));
        this.emit({ type: "left", id: msg.id });
        this.pushLobby();
        break;
      case "start": {
        this.phase = "starting";
        this.seed = msg.seed;
        this.hash = msg.hash;
        this.startAt = msg.at;
        this.pushLobby();
        this.emit({
          type: "start",
          seed: msg.seed,
          hash: msg.hash,
          at: msg.at,
          offset: this.clockOffset,
          slot: this.self?.slot ?? 0,
          selfId: this.self?.id ?? "",
        });
        window.setTimeout(() => {
          if (this.phase === "starting") this.phase = "running";
          this.pushLobby();
        }, Math.max(0, msg.at + this.clockOffset - performance.now() + 50));
        break;
      }
      case "pos":
        if (msg.id === this.self?.id) return;
        if (!validPos(msg)) return;
        this.emit({ type: "pos", id: msg.id, x: msg.x, y: msg.y, z: msg.z, yaw: msg.yaw, pitch: msg.pitch, sprint: msg.sp === 1 });
        break;
      case "escape":
        this.cachedRoster = this.cachedRoster.map((p) => (p.id === msg.id ? { ...p, status: "escaped", escapeTime: msg.time } : p));
        this.emit({ type: "escape", id: msg.id, time: msg.time });
        this.pushLobby();
        break;
      case "pong":
        if (msg.n === this.pingN) {
          const rtt = performance.now() - msg.ts;
          this.clockOffset = msg.ht - (msg.ts + rtt / 2);
        }
        break;
      case "hostgone":
        this.phase = "closed";
        this.emit({ type: "hostgone", reason: msg.reason });
        break;
      case "end":
        this.phase = "completed";
        this.results = msg.results;
        this.duration = msg.duration;
        this.emit({ type: "end", results: msg.results, duration: msg.duration });
        this.pushLobby();
        break;
      case "rematch":
        this.phase = "lobby";
        this.seed = msg.seed;
        this.hash = msg.hash;
        this.results = [];
        this.cachedRoster = this.cachedRoster.map((p) =>
          p.status === "disconnected" || p.status === "left" ? p : { ...p, status: "lobby", escapeTime: null },
        );
        this.emit({ type: "rematch", seed: msg.seed, hash: msg.hash });
        this.pushLobby();
        break;
      case "hb":
        break;
      default:
        break;
    }
  }

  sendReady(hash: string) {
    this.client?.send({ t: "ready", id: this.self?.id ?? "", hash });
  }

  sendPos(p: { x: number; y: number; z: number; yaw: number; pitch: number; sprint: boolean; seq: number }) {
    if (!this.self) return;
    const msg: Extract<Msg, { t: "pos" }> = {
      t: "pos",
      id: this.self.id,
      x: p.x,
      y: p.y,
      z: p.z,
      yaw: p.yaw,
      pitch: p.pitch,
      sp: p.sprint ? 1 : 0,
      seq: p.seq,
    };
    if (this.host) this.hostPos(msg);
    else this.client?.send(msg);
  }

  sendEscape(time: number) {
    if (this.host) this.hostEscape(time);
    else this.client?.send({ t: "escape", id: this.self?.id ?? "", time });
  }

  leave() {
    if (this.host) {
      this.host.broadcast({ t: "hostgone", reason: "Host left the session." });
    }
    this.close();
  }

  close() {
    this.closed = true;
    this.phase = "closed";
    if (this.hbTimer) window.clearInterval(this.hbTimer);
    this.hbTimer = 0;
    this.host?.close();
    this.client?.close();
    this.host = null;
    this.client = null;
    this.members.clear();
  }

  private reset() {
    this.close();
    this.closed = false;
    this.members.clear();
    this.cachedRoster = [];
    this.self = null;
    this.error = null;
    this.status = "";
    this.results = [];
    this.startAt = null;
    this.clockOffset = 0;
    this.phase = "closed";
  }
}


