<div align="center">

# THE MAZE

**There is always a way out.**

A browser-based first-person 3D maze game. Spawn inside a seeded labyrinth, learn its sectors, and walk out — solo or with friends.

**Source:** https://github.com/amayushmansharma/the-maze

[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=0b0e13)](https://react.dev/)
[![Three.js](https://img.shields.io/badge/Three.js-WebGL-9db3bd?logo=three.js&logoColor=0b0e13)](https://threejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-7aa2f7?logo=typescript&logoColor=0b0e13)](https://www.typescriptlang.org/)
[![Vite](https://img.shields.io/badge/Vite-7-8a7cf0?logo=vite&logoColor=0b0e13)](https://vite.dev/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-4-67e8f9?logo=tailwindcss&logoColor=0b0e13)](https://tailwindcss.com/)

*No verified public demo URL was found in this repository, so no live link is listed here.*
<br>
Play Game Here --> https://the-maze-orpin.vercel.app/ 

</div>

---

## HERO

No gameplay screenshot is committed to this repository yet, so this README ships without an embedded image.

> To add one later: commit a capture to `docs/screenshot-01.png` (1280×720 or 1920×1080), then reference it here with a relative path. Nothing else in this file depends on that image.

## OVERVIEW

**THE MAZE** drops you inside a dark, fully walkable 26 × 26-cell labyrinth with five connected sectors. There is nothing to collect and nothing to unlock. You explore, build a mental map, manage your flashlight and fog-of-war map, and reach the single physical exit gate.

It runs as a static browser game built with React, Three.js, Vite, and TypeScript. The source is public at https://github.com/amayushmansharma/the-maze.

Basic play has been confirmed working: the game opens, movement works, wall collision works, restart and refresh work, and a basic Chrome console check showed no errors. Advanced performance, mobile support, and cross-network multiplayer are **not** claimed as verified here.

## WHAT'S INSIDE

Verified against the code in `src/`, not assumed from the title:

| System | What it does |
|---|---|
| Seeded 26 × 26 maze | Recursive-backtracker sectors joined by open portals; same seed, same layout, entrance, and exit |
| Five sectors | Concrete Labyrinth, Abandoned Facility, Overgrowth, Flooded Passages, Undercroft — distinct materials, lamps, and fog |
| Validated layout | Breadth-first-search checks for connectivity, reachability, boundary seal, and entrance/exit separation |
| First-person controller | Fixed-step movement, grid collision solver, sprint, head-bob setting, pointer-lock mouse look |
| Flashlight | Hand-held style spotlight with soft falloff, toggled in-game |
| Fog-of-war map | Shows only passages actually walked; never reveals the exit |
| Timer + seed HUD | Run timer, current seed with copy button, minimal reticle |
| Save + settings | Local save/continue plus persisted sensitivity, FOV, volumes, quality, and comfort options |
| Procedural art + audio | Canvas-generated textures and Web Audio synthesis; no external texture or audio files |
| Co-op Escape | Real rooms, room codes, shared seed, live remote players, escape tracking — see [MULTIPLAYER.md](./MULTIPLAYER.md) |

No enemies, weapons, inventories, quests, shops, or progression systems are part of this build.

## CONTROLS

From `src/ui/Menus.tsx` and `src/engine/game.ts`:

| Action | Input |
|---|---|
| Walk | `W` `A` `S` `D` or Arrow keys |
| Look | Mouse, pointer-locked |
| Sprint | `Shift`, while moving forward |
| Flashlight | `F` |
| Map | `M` |
| Pause | `Esc` |

Click the viewport to capture the mouse. `Esc` releases it and pauses. Menus never move the player.

## QUICK START

Uses `npm` because `package-lock.json` is committed. Scripts come from [package.json](./package.json).

```bash
git clone https://github.com/amayushmansharma/the-maze.git
cd the-maze
npm install
npm run dev
```

Open the localhost URL printed by Vite, usually `http://localhost:5173`.

Build and preview:

```bash
npm run build
npm run preview
```

`npm run build` runs `vite build` with `vite-plugin-singlefile` and emits a self-contained `dist/index.html`. `npm run preview` serves that production build locally.

No global installs, API keys, credentials, or backend services are required for solo play.

## TECH STACK

Only what [package.json](./package.json) and [vite.config.ts](./vite.config.ts) actually use:

- [React](https://react.dev/) — menu, HUD, map, and multiplayer UI layers.
- [Three.js](https://threejs.org/) — WebGL renderer, maze geometry, lights, shadows, fog, and characters.
- [TypeScript](https://www.typescriptlang.org/) — typed engine, networking, and UI code.
- [Vite](https://vite.dev/) — dev server, production build, and preview workflow.
- [Tailwind CSS](https://tailwindcss.com/) — utility styling for menus and overlays.
- [PeerJS](https://peerjs.com/) — WebRTC data-channel helper for co-op connections.
- [vite-plugin-singlefile](https://github.com/richardtallent/vite-plugin-singlefile) — bundles the production build into one HTML file.

## CO-OP ESCAPE

Multiplayer exists and is documented in [MULTIPLAYER.md](./MULTIPLAYER.md). Short version:

- Host creates a room, gets a 6-character code, and owns one shared maze seed.
- Guests join with that code, or open a shared `?room=XXXXXX` link and then explicitly click Join.
- Every client builds the same maze locally; version and fingerprint mismatches are rejected.
- Remote players are real network state with names and shirt colours, interpolated in 3D.
- Each player escapes independently; results appear when no one is still exploring.

Connection paths, in order:

1. Same-origin `BroadcastChannel` for two local tabs.
2. WebRTC data channels through PeerJS signalling plus public STUN.
3. Optional relay in [server/relay.mjs](./server/relay.mjs) via `?relay=ws://host:port` or `VITE_RELAY_URL`.

Cross-network play is experimental. A Vercel static frontend does not automatically host the separate relay, and STUN alone cannot cross every NAT. Read the limits section in [MULTIPLAYER.md](./MULTIPLAYER.md) before testing across networks.

## PROJECT STRUCTURE

Real files only:

```text
.
├── index.html                 # Title, meta, React mount point
├── package.json               # npm scripts and dependencies
├── vite.config.ts             # React + Tailwind + single-file build
├── tsconfig.json              # TypeScript configuration
├── MULTIPLAYER.md             # Co-op architecture, limits, relay setup
├── server/
│   └── relay.mjs              # Optional WebSocket message relay
├── scripts/
│   ├── sim.ts                 # Headless movement/maze harness
│   ├── seed-tests.ts          # Determinism and entrance/exit checks
│   ├── mp-test.ts             # Protocol validation harness
│   └── human-check.ts         # Character measurement helper
└── src/
    ├── main.tsx               # React entry point
    ├── App.tsx                # Screens, session wiring, HUD state
    ├── index.css              # Global styles
    ├── engine/                # Maze, world, player, audio, save, character
    ├── net/                   # Room protocol, session, transports
    └── ui/                    # Menus, HUD, map, multiplayer panels
```

`src/engine/maze.ts` owns generation and validation. `src/engine/world.ts` builds geometry and lighting. `src/engine/game.ts` owns the loop and input. `src/net/session.ts` owns rooms and shared-seed flow.

## SCREENSHOTS

There are currently no committed screenshots, so this section intentionally contains no image tags.

To document gameplay later:

1. Capture the running game at 1280×720 or larger.
2. Save it as `docs/screenshot-01.png`.
3. Add a captioned relative link here.

Do not use remote art, copyrighted images, or fabricated gameplay stills.

## CONTRIBUTING

1. Fork https://github.com/amayushmansharma/the-maze
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR-USERNAME/the-maze.git
   cd the-maze
   ```
3. Create a focused branch:
   ```bash
   git checkout -b fix/shorter-fog-falloff
   ```
4. Install dependencies:
   ```bash
   npm install
   ```
5. Make one small, verifiable change.
6. Build before opening a PR:
   ```bash
   npm run build
   ```
7. Open a pull request describing what changed and how you tested it.

There is no `npm test` script, lint workflow, CI config, or PR template in this repository. `scripts/` contains manual developer harnesses only.

## ROADMAP

Short and explicitly uncommitted — ideas, not promises:

- Add a real captured screenshot and optional short gameplay clip.
- Publish clearer cross-network setup notes if relay testing confirms a stable path.
- Small comfort fixes only where a reproducible bug is found.

Nothing above is scheduled or marked complete.

## LICENSE AND ATTRIBUTION

No `LICENSE` or `LICENCE` file was found in the repository, so no license is claimed here. Check with the repository owner before reusing this code.

Third-party software actually in use includes React, Three.js, Vite, TypeScript, Tailwind CSS, and PeerJS. See [package.json](./package.json) for versions.

---

<div align="center">

**THE MAZE — find the exit.**

Run it locally: [Quick start](#quick-start) · Read the code: https://github.com/amayushmansharma/the-maze · Report an issue: https://github.com/amayushmansharma/the-maze/issues

</div>
