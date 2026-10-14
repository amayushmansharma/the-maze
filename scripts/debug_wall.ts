const ctx: any = new Proxy({}, {
  get: (_t, k) => k === "createImageData" ? (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) })
    : k === "createLinearGradient" || k === "createRadialGradient" ? () => ({ addColorStop() {} })
    : () => {},
  set: () => true,
});
(globalThis as any).document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx, style: {} }) };

import * as THREE from "three";
import { generateMaze, GRID, CELL, cellCenter, hasWall, type Edge } from "../src/engine/maze";
import { buildLevel } from "../src/engine/world";
import { buildSurfaces } from "../src/engine/textures";
import { Player } from "../src/engine/player";

await buildSurfaces();

for (let n = 0; n < 24; n++) {
  const seed = 1000 + n * 7919;
  const maze = generateMaze(seed);
  const level = buildLevel(maze, { foliageDensity: 1, props: 1 });
  const [si, sj] = maze.spawn;
  const [sx, sz] = cellCenter(si, sj);
  for (const [dx, dz, e] of [
    [0, -1, { axis: "H", i: si, j: sj }],
    [0, 1, { axis: "H", i: si, j: sj + 1 }],
    [-1, 0, { axis: "V", i: si, j: sj }],
    [1, 0, { axis: "V", i: si + 1, j: sj }],
  ] as [number, number, Edge][]) {
    if (!hasWall(maze, e)) continue;
    const q = new Player();
    q.reset(new THREE.Vector3(sx, 0, sz), Math.atan2(-dx, -dz));
    for (let i = 0; i < 180; i++) q.update(1 / 60, { forward: 1, strafe: 0.3, sprint: true }, level, 0.5, false);
    const into = (q.pos.x - sx) * dx + (q.pos.z - sz) * dz;
    const limit = CELL / 2 - 0.225 - 0.34 + 0.01;
    if (into > limit) {
      console.log(`Seed ${seed} wall ${e.axis}${e.i},${e.j}: into=${into.toFixed(3)} vs limit=${limit.toFixed(3)} at cell ${si},${sj}`);
    }
  }
  level.dispose();
}
