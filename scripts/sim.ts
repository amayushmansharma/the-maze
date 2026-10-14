// Headless gameplay test: node_modules/.bin/esbuild scripts/sim.ts --bundle --format=esm --platform=node --outfile=/tmp/sim.mjs && node /tmp/sim.mjs
// ---- minimal canvas stub so texture generation can run in Node ----
const ctx: any = new Proxy({}, {
  get: (_t, k) => k === "createImageData" ? (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) })
    : k === "createLinearGradient" || k === "createRadialGradient" ? () => ({ addColorStop() {} })
    : () => {},
  set: () => true,
});
(globalThis as any).document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx, style: {} }) };

import * as THREE from "three";
import { generateMaze, bfs, idx, GRID, CELL, cellCenter, hasWall, doorAt, wallTransform, type Edge } from "../src/engine/maze";
import { buildLevel, probeLevel, type BuiltLevel } from "../src/engine/world";
import { buildSurfaces } from "../src/engine/textures";
import { Player } from "../src/engine/player";

const log = (ok: boolean, msg: string) => { console.log((ok ? "PASS " : "FAIL ") + msg); if (!ok) process.exitCode = 1; };
const t0 = Date.now();
await buildSurfaces();
console.log("textures built in", Date.now() - t0, "ms");

// ---------------- movement tests in an empty level ----------------
const empty = { grid: new Map(), colliders: [], waterCells: new Set() } as unknown as BuiltLevel;
function run(dt: number, secs: number, input: any, p = new Player()) {
  if (!p.pos.x) p.reset(new THREE.Vector3(50, 0, 50), 0);
  const steps = Math.round(secs / dt);
  for (let i = 0; i < steps; i++) p.update(dt, input, empty, 0.5, false);
  return p;
}
const fwd = { forward: 1, strafe: 0, sprint: false };
const diag = { forward: 1, strafe: 1, sprint: false };
const spr = { forward: 1, strafe: 0, sprint: true };
const none = { forward: 0, strafe: 0, sprint: false };
const sp = (p: Player) => Math.hypot(p.vel.x, p.vel.z);
const walk = sp(run(1 / 60, 2, fwd)), dg = sp(run(1 / 60, 2, diag)), sr = sp(run(1 / 60, 2, spr));
log(Math.abs(walk - 3.0) < 0.02, `walk speed ${walk.toFixed(3)} m/s`);
log(Math.abs(dg - walk) < 0.02, `diagonal speed ${dg.toFixed(3)} m/s equals straight speed`);
log(sr > walk * 1.4 && sr < walk * 1.8, `sprint speed ${sr.toFixed(3)} m/s (x${(sr / walk).toFixed(2)}, moderate)`);
const back = sp(run(1 / 60, 2, { forward: -1, strafe: 0, sprint: true }));
log(Math.abs(back - walk) < 0.02, `sprint ignored while walking backwards (${back.toFixed(2)} m/s)`);
{ const p = run(1 / 60, 2, fwd); const x0 = p.pos.clone(); let tStop = 0;
  for (let i = 0; i < 120; i++) { p.update(1 / 60, none, empty, 0.5, false); if (sp(p) === 0 && !tStop) tStop = (i + 1) / 60; }
  log(tStop > 0 && tStop < 0.5, `player fully stops ${tStop.toFixed(2)} s after keys released (slid ${p.pos.distanceTo(x0).toFixed(2)} m)`); }
const dists = [30, 60, 144, 240].map((hz) => { const p = run(1 / hz, 3, fwd); return p.pos.distanceTo(new THREE.Vector3(50, 0, 50)); });
const spread = (Math.max(...dists) - Math.min(...dists)) / Math.min(...dists);
log(spread < 0.01, `distance in 3 s at 30/60/144/240 fps: ${dists.map((d) => d.toFixed(3)).join(" / ")} (spread ${(spread * 100).toFixed(2)}%)`);
{ const p = run(1 / 60, 1, fwd); log(Math.abs(p.pos.y) < 1e-9, "player stays on the floor (y = 0)"); }

// ---------------- maze + level tests across seeds ----------------
let seedsOk = 0, walksOk = 0, wallsOk = 0;
const SEEDS = 24;
let totalPath = 0, totalTime = 0;
for (let n = 0; n < SEEDS; n++) {
  const seed = 1000 + n * 7919;
  const maze = generateMaze(seed);
  const level = buildLevel(maze, { foliageDensity: 1, props: 1 });
  const probe = probeLevel(level, maze);
  const r = maze.report;
  if (r.ok && probe.ok) seedsOk++;
  else console.log("  seed", seed, [...r.problems, ...probe.problems].slice(0, 6));
  if (n < 3) console.log(`  seed ${seed}: exit ${r.exitDistance} cells away, ${r.deadEnds} dead ends, ${r.tJunctions} T, ${r.crossings} X, ${r.loops} loops, ${probe.openEdges} passages swept, ${probe.wallEdges} walls checked`);

  // shortest route via BFS, walked with the real controller + collision
  const { dist } = bfs(maze, maze.spawn[0], maze.spawn[1]);
  let [ci, cj] = maze.exitCell; const path: [number, number][] = [[ci, cj]];
  while (dist[idx(ci, cj)] > 0) {
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = ci + di, nj = cj + dj; if (ni < 0 || nj < 0 || ni >= GRID || nj >= GRID) continue;
      const e: Edge = di === 1 ? { axis: "V", i: ci + 1, j: cj } : di === -1 ? { axis: "V", i: ci, j: cj } : dj === 1 ? { axis: "H", i: ci, j: cj + 1 } : { axis: "H", i: ci, j: cj };
      if ((hasWall(maze, e) && !doorAt(maze, e)) || dist[idx(ni, nj)] !== dist[idx(ci, cj)] - 1) continue;
      ci = ni; cj = nj; path.push([ci, cj]); break;
    }
  }
  path.reverse();
  const wps = path.map(([i, j]) => { const [x, z] = cellCenter(i, j); return new THREE.Vector3(x, 0, z); });
  wps.push(level.exitOutside.clone());
  const p = new Player(); p.reset(level.spawn.clone().setY(0), 0);
  let w = 1, t = 0, won = false, early = false, stuck = 0, last = p.pos.clone();
  const dt = 1 / 60;
  while (t < 600 && !won) {
    const tg = wps[w]; const dx = tg.x - p.pos.x, dz = tg.z - p.pos.z;
    if (Math.hypot(dx, dz) < 0.5 && w < wps.length - 1) { w++; continue; }
    p.yaw = Math.atan2(-dx, -dz);
    p.update(dt, { forward: 1, strafe: 0, sprint: true }, level, 0.5, false);
    t += dt;
    if (level.exitTrigger(p.pos)) { won = true; if (w < wps.length - 1) early = true; }
    if (Math.floor(t * 60) % 60 === 0) { if (p.pos.distanceTo(last) < 0.2) stuck++; else stuck = 0; last.copy(p.pos); if (stuck > 3) break; }
  }
  if (won && !early) walksOk++; else console.log(`  seed ${seed}: walk failed at waypoint ${w}/${wps.length - 1}, t=${t.toFixed(1)}s, pos ${p.pos.x.toFixed(2)},${p.pos.z.toFixed(2)} early=${early}`);
  totalPath += path.length; totalTime += t;

  // push straight into every wall of the spawn cell for 3 s: must not pass
  let held = true;
  const [si, sj] = maze.spawn; const [sx, sz] = cellCenter(si, sj);
  for (const [dx, dz, e] of [[0, -1, { axis: "H", i: si, j: sj }], [0, 1, { axis: "H", i: si, j: sj + 1 }], [-1, 0, { axis: "V", i: si, j: sj }], [1, 0, { axis: "V", i: si + 1, j: sj }]] as [number, number, Edge][]) {
    if (!hasWall(maze, e)) continue;
    const q = new Player(); q.reset(new THREE.Vector3(sx, 0, sz), Math.atan2(-dx, -dz));
    for (let i = 0; i < 180; i++) q.update(1 / 60, { forward: 1, strafe: 0, sprint: true }, level, 0.5, false);
    const into = (q.pos.x - sx) * dx + (q.pos.z - sz) * dz;
    const wt = wallTransform(e);
    const distToWall = Math.abs((wt.x - sx) * dx + (wt.z - sz) * dz);
    if (into > distToWall - 0.225 - 0.34 + 0.01) held = false;
  }
  if (held) wallsOk++;
  level.dispose();
}
log(seedsOk === SEEDS, `${seedsOk}/${SEEDS} seeds: maze graph validated by BFS + collision probe (all passages clear, all walls solid, boundary sealed, trigger only beyond gate)`);
log(walksOk === SEEDS, `${walksOk}/${SEEDS} seeds: real controller walked spawn -> exit and triggered victory only after passing the gate (avg route ${(totalPath / SEEDS).toFixed(0)} cells, ${(totalTime / SEEDS).toFixed(0)} s sprinting)`);
log(wallsOk === SEEDS, `${wallsOk}/${SEEDS} seeds: pushing into spawn-cell walls for 3 s never passes the wall face`);
console.log("total", ((Date.now() - t0) / 1000).toFixed(1), "s");
