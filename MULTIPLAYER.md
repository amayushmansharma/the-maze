# THE MAZE — Co-op Escape

Friends join with a room code, spawn in the **same** maze, see each other walk, and each find the exit at their own pace.

## How it works

The frontend is a static site. Browsers cannot find each other from a room code alone, so the game uses:

1. **BroadcastChannel** — two tabs on the same origin (same computer, same browser profile). No internet required. This is the fastest path for local testing.
2. **WebRTC data channels via PeerJS** (`0.peerjs.com` signalling + Google/Cloudflare STUN). The host registers as peer id `tmXXXXXX`. Joiners connect to that id. The host is a hub: it owns the maze seed and relays positions.
3. **Optional WebSocket relay** if you pass `?relay=ws://host:port` or build with `VITE_RELAY_URL`. Use this when WebRTC cannot punch through NAT.

A room code is an identifier, not a network connection.

## Playing

1. One player: **CO-OP ESCAPE → CREATE ROOM**. Share the 6-character code (or the `?room=` link).
2. Others: **JOIN ROOM**, enter the code and a name. They must click Join — opening a link does not auto-connect.
3. Host presses **START GAME** when at least two people are in the lobby. Joining after start is rejected.
4. Everyone gets the same maze seed and walks independently.
5. Walking through the exit ends **your** run. Others keep exploring.
6. When nobody is still exploring, the group results screen appears. The host can **PLAY AGAIN** (new seed, same room).

If the host closes the tab, the session ends. There is no host migration in this version.

## Limits (honest)

- **No anti-cheat.** The host browser is authoritative, but anyone can modify their client. Positions are validated for NaN/range/rate only.
- **STUN is not enough for every NAT.** Symmetric NATs and some school/office firewalls need a TURN server. None is bundled (TURN is usually paid). If two friends on different networks cannot connect, run the relay (below) on a VPS that both can reach.
- **PeerJS public cloud** can be slow or down. It is a free third-party signalling service, not ours.
- **Same-network vs cross-network:** two tabs on one PC is not proof that two houses can play. Test with two devices on two networks before calling it done.
- Reconnect after a refresh is not fully implemented for clients (host-side token exists; the client always joins as new).

## Local two-tab test (no extra server)

1. `npm run dev`
2. Open two windows on the same origin.
3. Create a room in one, join with the code in the other.
4. BroadcastChannel should connect within a second (host heartbeats immediately).

## Cross-network / relay

```
npm install ws
node server/relay.mjs
```

Then open:

```
http://localhost:5173/?relay=ws://localhost:8787
```

on every client (or set `VITE_RELAY_URL` at build time). Deploy `server/relay.mjs` to any Node host; point `VITE_RELAY_URL` at `wss://...`. The relay is unauthenticated and should sit behind your own rate-limiting if exposed publicly.

Free-tier note: PeerJS cloud and public STUN are free. A VPS for the relay is optional. A TURN service (e.g. Twilio, Metered) is paid if you need it.

## Maze agreement

`MAZE_GEN_VERSION` in `src/engine/maze.ts` must match on every client. The host publishes `seed` + `mazeFingerprint`. Mismatched versions are rejected at hello.
