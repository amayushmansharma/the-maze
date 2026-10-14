import { generateMaze, idx } from "../src/engine/maze";
const m = generateMaze(135623);
console.log("spawn:", m.spawn);
for (const r of m.rooms) {
  if (r.label.includes("ENTRY")) console.log("entry room:", r);
}
console.log("isRoom at spawn:", m.isRoom[idx(m.spawn[0], m.spawn[1])]);
console.log("isRoom at 16,3:", m.isRoom[idx(16, 3)]);
console.log("isRoom at 15,4:", m.isRoom[idx(15, 4)]);
