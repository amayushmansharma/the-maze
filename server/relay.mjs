#!/usr/bin/env node
/**
 * Optional dumb WebSocket relay for THE MAZE co-op.
 *
 *   npm install ws
 *   node server/relay.mjs
 *
 * Then open the game with ?relay=ws://localhost:8787
 * or build with VITE_RELAY_URL=wss://your-relay.example
 *
 * This is NOT a game server. It only forwards JSON between a host and joiners
 * of the same room code. Host authority still lives in the host browser.
 */
import { createServer } from "node:http";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.PORT || 8787);
const MAX = 6;

/** @type {Map<string, { host: import('ws').WebSocket, clients: Map<string, import('ws').WebSocket>, started: boolean }>} */
const rooms = new Map();
let nid = 1;

const http = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("the maze relay\n");
});
const wss = new WebSocketServer({ server: http });

wss.on("connection", (ws) => {
  const id = "c" + nid++;
  /** @type {string | null} */
  let room = null;
  /** @type {"host" | "join" | null} */
  let role = null;

  ws.on("message", (buf) => {
    let data;
    try {
      data = JSON.parse(String(buf));
    } catch {
      return;
    }
    if (data.op === "host") {
      const code = String(data.code || "").toUpperCase();
      if (!/^[A-Z2-9]{6}$/.test(code)) {
        ws.send(JSON.stringify({ op: "hosted", ok: false, error: "Invalid room code." }));
        return;
      }
      if (rooms.has(code)) {
        ws.send(JSON.stringify({ op: "hosted", ok: false, error: "ROOM_CODE_TAKEN" }));
        return;
      }
      rooms.set(code, { host: ws, clients: new Map(), started: false });
      room = code;
      role = "host";
      ws.send(JSON.stringify({ op: "hosted", ok: true, code }));
      return;
    }
    if (data.op === "join") {
      const code = String(data.code || "").toUpperCase();
      const r = rooms.get(code);
      if (!r) {
        ws.send(JSON.stringify({ op: "joined", ok: false, error: "Room not found." }));
        return;
      }
      if (r.started) {
        ws.send(JSON.stringify({ op: "joined", ok: false, error: "Game already started." }));
        return;
      }
      if (r.clients.size + 1 >= MAX) {
        ws.send(JSON.stringify({ op: "joined", ok: false, error: "Room full." }));
        return;
      }
      r.clients.set(id, ws);
      room = code;
      role = "join";
      ws.send(JSON.stringify({ op: "joined", ok: true, code }));
      return;
    }
    if (!room) return;
    const r = rooms.get(room);
    if (!r) return;
    if (role === "host") {
      if (data.op === "bcast") {
        const payload = JSON.stringify({ op: "msg", msg: data.msg });
        for (const c of r.clients.values()) if (c.readyState === 1) c.send(payload);
      } else if (data.op === "to" && data.to) {
        const c = r.clients.get(data.to);
        if (c && c.readyState === 1) c.send(JSON.stringify({ op: "msg", msg: data.msg }));
      } else if (data.op === "close") {
        for (const c of r.clients.values()) {
          if (c.readyState === 1) c.send(JSON.stringify({ op: "hostgone" }));
          c.close();
        }
        rooms.delete(room);
      }
    } else if (role === "join") {
      if (data.op === "msg" && r.host.readyState === 1) {
        r.host.send(JSON.stringify({ op: "from", from: id, msg: data.msg }));
      }
    }
  });

  ws.on("close", () => {
    if (!room) return;
    const r = rooms.get(room);
    if (!r) return;
    if (role === "host") {
      for (const c of r.clients.values()) {
        if (c.readyState === 1) c.send(JSON.stringify({ op: "hostgone" }));
        c.close();
      }
      rooms.delete(room);
    } else {
      r.clients.delete(id);
      if (r.host.readyState === 1) r.host.send(JSON.stringify({ op: "gone", from: id }));
    }
  });
});

http.listen(PORT, () => {
  console.log(`[relay] ws://localhost:${PORT}`);
});
