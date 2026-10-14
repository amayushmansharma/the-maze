import { generateMaze, mazeFingerprint, bfs, idx, type MazeData } from "../src/engine/maze";
import {
  generateFreshSeed,
  makeConfigKey,
  recordConfigUsed,
  isConfigRecentlyUsed,
  clearConfigHistory,
  parseSeedInput,
  hashSeedString,
} from "../src/engine/configHistory";

function log(ok: boolean, msg: string) {
  console.log((ok ? "PASS " : "FAIL ") + msg);
  if (!ok) process.exitCode = 1;
}

console.log("--- SEED & ENTRANCE/EXIT VALIDATION SUITE ---");

// TEST 1: Starting a new solo game generates a valid seed
const seed1 = generateFreshSeed();
log(typeof seed1 === "number" && Number.isFinite(seed1) && seed1 > 0, `Test 1: generateFreshSeed produces valid positive integer (${seed1})`);

// TEST 2: The same seed produces exactly the same maze and entrance/exit locations
const m2a = generateMaze(482910);
const m2b = generateMaze(482910);
const fp2a = mazeFingerprint(m2a);
const fp2b = mazeFingerprint(m2b);
log(fp2a === fp2b, `Test 2a: Identical fingerprint for same seed (${fp2a})`);
log(m2a.spawn[0] === m2b.spawn[0] && m2a.spawn[1] === m2b.spawn[1], `Test 2b: Identical entrance for same seed: [${m2a.spawn}]`);
log(m2a.exitCell[0] === m2b.exitCell[0] && m2a.exitCell[1] === m2b.exitCell[1], `Test 2c: Identical exit cell for same seed: [${m2a.exitCell}]`);
log(m2a.exitEdge.axis === m2b.exitEdge.axis && m2a.exitEdge.i === m2b.exitEdge.i && m2a.exitEdge.j === m2b.exitEdge.j, `Test 2d: Identical exit edge: ${m2a.exitEdge.axis}@${m2a.exitEdge.i},${m2a.exitEdge.j}`);

// TEST 3: Different seeds produce varied layouts and entrance/exit locations
const spawns = new Set<string>();
const exits = new Set<string>();
const fps = new Set<string>();
const SAMPLE_COUNT = 30;

for (let i = 0; i < SAMPLE_COUNT; i++) {
  const s = 100000 + i * 17931;
  const m = generateMaze(s);
  spawns.add(`${m.spawn[0]},${m.spawn[1]}`);
  exits.add(`${m.exitCell[0]},${m.exitCell[1]}`);
  fps.add(mazeFingerprint(m));
}
log(fps.size === SAMPLE_COUNT, `Test 3a: ${SAMPLE_COUNT} different seeds produce ${fps.size} distinct layouts`);
log(spawns.size >= 10, `Test 3b: Entrance varies widely across seeds (${spawns.size} distinct entrance locations in ${SAMPLE_COUNT} seeds)`);
log(exits.size >= 10, `Test 3c: Exit varies widely across seeds (${exits.size} distinct exit locations in ${SAMPLE_COUNT} seeds)`);

// TEST 4 & 5 & 6: Entrance and exit are never the same location, exit reachable, far apart
let allNeverSame = true;
let allReachable = true;
let allMinDistance = true;
let minWalkDist = 999;
let maxWalkDist = 0;

for (let i = 0; i < 50; i++) {
  const s = 200000 + i * 8329;
  const m = generateMaze(s);
  if (m.spawn[0] === m.exitCell[0] && m.spawn[1] === m.exitCell[1]) allNeverSame = false;
  const { dist } = bfs(m, m.spawn[0], m.spawn[1]);
  const d = dist[idx(m.exitCell[0], m.exitCell[1])];
  if (d < 0) allReachable = false;
  if (d < 35) allMinDistance = false;
  minWalkDist = Math.min(minWalkDist, d);
  maxWalkDist = Math.max(maxWalkDist, d);
}
log(allNeverSame, "Test 4: Entrance and exit are never the same location (50/50 seeds)");
log(allReachable, "Test 5: Exit is reachable from entrance (50/50 seeds)");
log(allMinDistance, `Test 6: Entrance and exit are far apart in walkable distance (min=${minWalkDist}, max=${maxWalkDist} cells, all >= 35)`);

// TEST 7: Repeated configurations are avoided when alternatives exist
clearConfigHistory();
const testM = generateMaze(555555);
const key = makeConfigKey(testM.spawn, testM.exitCell);
log(!isConfigRecentlyUsed(key), "Test 7a: Config starts unrecorded");
recordConfigUsed(testM.spawn, testM.exitCell);
log(isConfigRecentlyUsed(key), "Test 7b: Config is now recorded as recently used");
const freshSeed = generateFreshSeed();
const freshM = generateMaze(freshSeed);
const freshKey = makeConfigKey(freshM.spawn, freshM.exitCell);
log(freshKey !== key, `Test 7c: Fresh seed generated a different entrance/exit configuration (${freshKey} !== ${key})`);

// TEST 8: Two players joining the same room receive the same seed and see the exact same maze
const sharedSeed = 987654321;
const hostMaze = generateMaze(sharedSeed);
const clientMaze = generateMaze(sharedSeed);
log(
  mazeFingerprint(hostMaze) === mazeFingerprint(clientMaze) &&
  hostMaze.spawn[0] === clientMaze.spawn[0] && hostMaze.spawn[1] === clientMaze.spawn[1] &&
  hostMaze.exitCell[0] === clientMaze.exitCell[0] && hostMaze.exitCell[1] === clientMaze.exitCell[1],
  `Test 8: Host and client generate 100% identical maze, entrance [${hostMaze.spawn}] and exit [${hostMaze.exitCell}] from shared seed`
);

// TEST 9: A newly created room / rematch can use a different seed
const roomSeed1 = generateFreshSeed();
recordConfigUsed(generateMaze(roomSeed1).spawn, generateMaze(roomSeed1).exitCell);
const roomSeed2 = generateFreshSeed();
log(roomSeed1 !== roomSeed2, `Test 9: Subsequent room gets different seed (${roomSeed1} !== ${roomSeed2})`);

// TEST 10: Input validation for custom seeds
const parsedNum = parseSeedInput("777888");
const parsedText = parseSeedInput("THE_LOST_LABYRINTH");
const parsedInvalid = parseSeedInput("   ");
log(parsedNum === 777888, `Test 10a: Numeric seed input parsed correctly (${parsedNum})`);
log(typeof parsedText === "number" && parsedText > 0, `Test 10b: Text keyword seed hashed deterministically (${parsedText})`);
log(parsedInvalid === null, "Test 10c: Empty seed input rejected cleanly");
log(hashSeedString("THE_LOST_LABYRINTH") === hashSeedString("THE_LOST_LABYRINTH"), "Test 10d: Same text seed produces identical numeric hash");

console.log("--- ALL SEED TESTS COMPLETED ---");
