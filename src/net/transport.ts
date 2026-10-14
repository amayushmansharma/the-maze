import { Peer, type DataConnection } from "peerjs";
import { HOST_TIMEOUT_MS, MAX_MSG_BYTES, type Msg, parseMsg, peerIdFor } from "./protocol";

const ICE = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" },
  ],
};

export type SendFn = (msg: Msg) => void;

export interface ClientLink {
  send: SendFn;
  close: () => void;
}

export interface HostTransport {
  code: string;
  /** Session assigns this. Transport calls it for each new client pipe. */
  onPipe: (link: ClientLink) => { handler: (msg: Msg) => void; onGone: () => void };
  broadcast: (msg: Msg) => void;
  close: () => void;
}

export interface ClientTransport {
  send: SendFn;
  onMessage: (cb: (msg: Msg) => void) => void;
  onClose: (cb: (reason: string) => void) => void;
  close: () => void;
}

function encode(msg: Msg): string {
  return JSON.stringify(msg);
}
function decode(raw: unknown): Msg | null {
  if (typeof raw === "string" && raw.length > MAX_MSG_BYTES) return null;
  return parseMsg(raw);
}

function relayUrl(): string | null {
  try {
    const q = new URLSearchParams(location.search).get("relay");
    if (q) return q;
  } catch {
    /* ignore */
  }
  const env = (import.meta as unknown as { env?: { VITE_RELAY_URL?: string } }).env?.VITE_RELAY_URL;
  return env && env.length > 0 ? env : null;
}

class ChannelBus {
  private ch: BroadcastChannel | null;
  private handlers: Array<(msg: Msg) => void> = [];
  constructor(code: string) {
    try {
      this.ch = new BroadcastChannel(`themaze:${code}`);
      this.ch.onmessage = (e) => {
        const m = decode(typeof e.data === "string" ? e.data : JSON.stringify(e.data));
        if (m) for (const h of this.handlers) h(m);
      };
    } catch {
      this.ch = null;
    }
  }
  get ok() {
    return !!this.ch;
  }
  post(msg: Msg) {
    try {
      this.ch?.postMessage(encode(msg));
    } catch {
      /* ignore */
    }
  }
  on(h: (msg: Msg) => void) {
    this.handlers.push(h);
  }
  close() {
    try {
      this.ch?.close();
    } catch {
      /* ignore */
    }
    this.ch = null;
    this.handlers = [];
  }
}

function createPeer(id: string | undefined): Promise<Peer> {
  return new Promise((resolve, reject) => {
    const peer = id ? new Peer(id, { debug: 0, config: ICE }) : new Peer({ debug: 0, config: ICE });
    const timer = setTimeout(() => {
      try {
        peer.destroy();
      } catch {
        /* ignore */
      }
      reject(new Error("Connection timeout."));
    }, HOST_TIMEOUT_MS + 4000);
    peer.on("open", () => {
      clearTimeout(timer);
      resolve(peer);
    });
    peer.on("error", (err: { type?: string; message?: string }) => {
      clearTimeout(timer);
      const t = err?.type ?? "";
      if (t === "unavailable-id") reject(new Error("ROOM_CODE_TAKEN"));
      else if (t === "peer-unavailable") reject(new Error("Room not found."));
      else if (t === "network") reject(new Error("Network unavailable."));
      else reject(new Error(err?.message || "Failed connection."));
    });
  });
}

/* ================================================================== */
/* HOST                                                                */
/* ================================================================== */
export async function createHostTransport(code: string): Promise<HostTransport> {
  const url = relayUrl();
  if (url) return openRelayHost(code, url);
  return openPeerHost(code);
}

async function openPeerHost(code: string): Promise<HostTransport> {
  const peer = await createPeer(peerIdFor(code));
  const conns = new Set<DataConnection>();
  const bc = new ChannelBus(code);
  let onPipe: HostTransport["onPipe"] = () => ({ handler: () => undefined, onGone: () => undefined });

  const api: HostTransport = {
    code,
    onPipe: () => ({ handler: () => undefined, onGone: () => undefined }),
    broadcast(msg) {
      const s = encode(msg);
      for (const c of conns) {
        if (c.open) {
          try {
            c.send(s);
          } catch {
            /* ignore */
          }
        }
      }
      bc.post(msg);
    },
    close() {
      for (const c of conns) {
        try {
          c.close();
        } catch {
          /* ignore */
        }
      }
      conns.clear();
      bc.close();
      try {
        peer.destroy();
      } catch {
        /* ignore */
      }
    },
  };
  Object.defineProperty(api, "onPipe", {
    get: () => onPipe,
    set: (fn: HostTransport["onPipe"]) => {
      onPipe = fn;
    },
    configurable: true,
    enumerable: true,
  });

  const attach = (send: SendFn, closer: () => void): { handler: (m: Msg) => void; onGone: () => void } => {
    return onPipe({ send, close: closer });
  };

  peer.on("connection", (conn) => {
    conns.add(conn);
    const { handler, onGone } = attach(
      (msg) => {
        if (conn.open) {
          try {
            conn.send(encode(msg));
          } catch {
            /* ignore */
          }
        }
      },
      () => {
        try {
          conn.close();
        } catch {
          /* ignore */
        }
      },
    );
    conn.on("data", (raw) => {
      const m = decode(typeof raw === "string" ? raw : JSON.stringify(raw));
      if (m) handler(m);
    });
    const dead = () => {
      conns.delete(conn);
      onGone();
    };
    conn.on("close", dead);
    conn.on("error", dead);
  });

  const bcHandlers = new Map<string, (m: Msg) => void>();
  bc.on((msg) => {
    if (msg.t === "hello") {
      let h = bcHandlers.get(msg.id);
      if (!h) {
        const { handler, onGone } = attach(
          (m) => bc.post(m),
          () => {
            bcHandlers.delete(msg.id);
            onGone();
          },
        );
        h = handler;
        bcHandlers.set(msg.id, handler);
      }
      h(msg);
      return;
    }
    if ("id" in msg && typeof (msg as { id?: unknown }).id === "string") {
      bcHandlers.get((msg as { id: string }).id)?.(msg);
    }
  });

  return api;
}

/* ================================================================== */
/* CLIENT                                                              */
/* ================================================================== */
export async function openClient(code: string): Promise<ClientTransport> {
  const url = relayUrl();
  if (url) return openRelayClient(code, url);

  const bc = await tryBroadcastClient(code, 1600);
  if (bc) return bc;
  return openPeerClient(code);
}

async function tryBroadcastClient(code: string, wait: number): Promise<ClientTransport | null> {
  const bus = new ChannelBus(code);
  if (!bus.ok) return null;
  return new Promise((resolve) => {
    let live = false;
    const msgH: Array<(m: Msg) => void> = [];
    const closeH: Array<(r: string) => void> = [];
    const timer = setTimeout(() => {
      if (live) return;
      bus.close();
      resolve(null);
    }, wait);
    bus.on((msg) => {
      if (!live && (msg.t === "hb" || msg.t === "welcome" || msg.t === "roster")) {
        live = true;
        clearTimeout(timer);
        resolve({
          send: (m) => bus.post(m),
          onMessage: (cb) => msgH.push(cb),
          onClose: (cb) => closeH.push(cb),
          close: () => bus.close(),
        });
      }
      for (const h of msgH) h(msg);
    });
  });
}

async function openPeerClient(code: string): Promise<ClientTransport> {
  const peer = await createPeer(undefined);
  const remote = peerIdFor(code);
  return new Promise((resolve, reject) => {
    const conn = peer.connect(remote, { reliable: true });
    const timer = setTimeout(() => {
      try {
        conn.close();
        peer.destroy();
      } catch {
        /* ignore */
      }
      reject(new Error("Room not found. Check the code, or the host may have left."));
    }, HOST_TIMEOUT_MS);
    const msgH: Array<(m: Msg) => void> = [];
    const closeH: Array<(r: string) => void> = [];
    const fail = (reason: string) => {
      clearTimeout(timer);
      try {
        peer.destroy();
      } catch {
        /* ignore */
      }
      reject(new Error(reason));
    };
    conn.on("open", () => {
      clearTimeout(timer);
      resolve({
        send(msg) {
          if (conn.open) {
            try {
              conn.send(encode(msg));
            } catch {
              /* ignore */
            }
          }
        },
        onMessage: (cb) => msgH.push(cb),
        onClose: (cb) => closeH.push(cb),
        close() {
          try {
            conn.close();
          } catch {
            /* ignore */
          }
          try {
            peer.destroy();
          } catch {
            /* ignore */
          }
        },
      });
    });
    conn.on("data", (raw) => {
      const m = decode(typeof raw === "string" ? raw : JSON.stringify(raw));
      if (m) for (const h of msgH) h(m);
    });
    conn.on("close", () => {
      for (const h of closeH) h("Host disconnected.");
    });
    conn.on("error", () => fail("Failed connection."));
    peer.on("error", (err: { type?: string; message?: string }) => {
      if (err?.type === "peer-unavailable") fail("Room not found.");
      else fail(err?.message || "Failed connection.");
    });
  });
}

/* ================================================================== */
/* Optional WebSocket relay                                            */
/* ================================================================== */
function openWs(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch {
      reject(new Error("Network unavailable."));
      return;
    }
    const t = setTimeout(() => {
      ws.close();
      reject(new Error("Connection timeout."));
    }, 5000);
    ws.onopen = () => {
      clearTimeout(t);
      resolve(ws);
    };
    ws.onerror = () => {
      clearTimeout(t);
      reject(new Error("Network unavailable."));
    };
  });
}

function waitOp(ws: WebSocket, op: string, ms: number): Promise<Record<string, unknown> | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    ws.addEventListener(
      "message",
      function once(ev) {
        try {
          const d = JSON.parse(String(ev.data)) as Record<string, unknown>;
          if (d.op === op) {
            clearTimeout(t);
            ws.removeEventListener("message", once);
            resolve(d);
          }
        } catch {
          /* ignore */
        }
      },
    );
  });
}

async function openRelayHost(code: string, url: string): Promise<HostTransport> {
  const ws = await openWs(url);
  ws.send(JSON.stringify({ op: "host", code }));
  const ack = await waitOp(ws, "hosted", 4000);
  if (!ack || ack.ok === false) {
    ws.close();
    throw new Error(typeof ack?.error === "string" ? ack.error : "ROOM_CODE_TAKEN");
  }
  let onPipe: HostTransport["onPipe"] = () => ({ handler: () => undefined, onGone: () => undefined });
  const handlers = new Map<string, (m: Msg) => void>();
  const api: HostTransport = {
    code,
    onPipe: () => ({ handler: () => undefined, onGone: () => undefined }),
    broadcast(msg) {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op: "bcast", msg }));
    },
    close() {
      try {
        ws.send(JSON.stringify({ op: "close" }));
      } catch {
        /* ignore */
      }
      ws.close();
    },
  };
  Object.defineProperty(api, "onPipe", {
    get: () => onPipe,
    set: (fn: HostTransport["onPipe"]) => {
      onPipe = fn;
    },
    configurable: true,
  });
  ws.onmessage = (ev) => {
    let data: { op?: string; from?: string; msg?: unknown };
    try {
      data = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    if (data.op === "from" && data.from && data.msg) {
      const m = decode(data.msg);
      if (!m) return;
      let h = handlers.get(data.from);
      if (!h) {
        const id = data.from;
        const link: ClientLink = {
          send(msg) {
            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op: "to", to: id, msg }));
          },
          close() {
            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op: "drop", to: id }));
          },
        };
        const hooks = onPipe(link);
        h = hooks.handler;
        handlers.set(id, hooks.handler);
      }
      h?.(m);
    }
    if (data.op === "gone" && data.from) handlers.delete(data.from);
  };
  return api;
}

async function openRelayClient(code: string, url: string): Promise<ClientTransport> {
  const ws = await openWs(url);
  ws.send(JSON.stringify({ op: "join", code }));
  const ack = await waitOp(ws, "joined", 4000);
  if (!ack || ack.ok === false) {
    ws.close();
    throw new Error(typeof ack?.error === "string" ? ack.error : "Room not found.");
  }
  const msgH: Array<(m: Msg) => void> = [];
  const closeH: Array<(r: string) => void> = [];
  ws.onmessage = (ev) => {
    let data: { op?: string; msg?: unknown };
    try {
      data = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    if (data.op === "msg") {
      const m = decode(data.msg);
      if (m) for (const h of msgH) h(m);
    }
    if (data.op === "hostgone") for (const h of closeH) h("Host disconnected.");
  };
  ws.onclose = () => {
    for (const h of closeH) h("Connection timeout.");
  };
  return {
    send(msg) {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op: "msg", msg }));
    },
    onMessage: (cb) => msgH.push(cb),
    onClose: (cb) => closeH.push(cb),
    close: () => ws.close(),
  };
}
