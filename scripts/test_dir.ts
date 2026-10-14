const ctx: any = new Proxy({}, {
  get: (_t, k) => k === "createImageData" ? (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) })
    : k === "createLinearGradient" || k === "createRadialGradient" ? () => ({ addColorStop() {} })
    : () => {},
  set: () => true,
});
(globalThis as any).document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) };

import * as THREE from "three";
import { generateMaze, GRID, cellCenter } from "../src/engine/maze";
import { buildLevel, probeLevel } from "../src/engine/world";
import { buildSurfaces } from "../src/engine/textures";

await buildSurfaces();

for (const [name, cell, edge] of [
  ["East", [GRID-1, 10], { axis: "V", i: GRID, j: 10 }],
  ["West", [0, 10], { axis: "V", i: 0, j: 10 }],
  ["South", [10, GRID-1], { axis: "H", i: 10, j: GRID }],
  ["North", [10, 0], { axis: "H", i: 10, j: 0 }],
] as const) {
  const m = generateMaze(1234);
  m.exitCell = cell as [number, number];
  m.exitEdge = edge as any;
  const d = m.doors.find(d => d.kind === "exit")!;
  d.axis = edge.axis as any;
  d.i = edge.i;
  d.j = edge.j;
  const lvl = buildLevel(m, { foliageDensity: 1, props: 1 });
  const [ex, ez] = cellCenter(cell[0], cell[1]);
  const insideTrig = lvl.exitTrigger(new THREE.Vector3(ex, 0, ez));
  const outsideTrig = lvl.exitTrigger(lvl.exitOutside);
  console.log(`Exit ${name}: inside=${insideTrig} outside=${outsideTrig}`);
}
