import { Rng } from "./rng";

/* ------------------------------------------------------------------ *
 * Constants
 * ------------------------------------------------------------------ */
export const CELL = 4; // metres per maze cell
export const WALL_T = 0.45; // wall thickness (real walls have thickness)
export const WALL_H = 4.0; // wall height
export const GRID = 26; // cells per side
/** Bump this if maze generation logic changes so mismatched clients cannot start together. */
export const MAZE_GEN_VERSION = 1;

export type ZoneId = "A" | "B" | "C" | "D" | "E";

export interface ZoneInfo {
  id: ZoneId;
  index: number;
  name: string;
  short: string;
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  indoor: boolean;
  ceiling: number;
  /** lamp colour, warm/cool */
  lamp: number;
  lampPower: number;
  lampSpacing: number;
  fog: number;
  fogColor: number;
}

export const ZONES: ZoneInfo[] = [
  {
    id: "A", index: 0, name: "Concrete Labyrinth", short: "SECTOR A",
    x0: 0, x1: 12, z0: 0, z1: 12, indoor: true, ceiling: 4.0,
    lamp: 0xc9d6e2, lampPower: 1.0, lampSpacing: 2, fog: 0.055, fogColor: 0x0d1116,
  },
  {
    id: "B", index: 1, name: "Abandoned Facility", short: "SECTOR B",
    x0: 13, x1: 25, z0: 0, z1: 12, indoor: true, ceiling: 4.0,
    lamp: 0xbcd2dd, lampPower: 0.9, lampSpacing: 2, fog: 0.05, fogColor: 0x0b1013,
  },
  {
    id: "C", index: 2, name: "The Overgrowth", short: "SECTOR C",
    x0: 13, x1: 25, z0: 20, z1: 25, indoor: false, ceiling: 999,
    lamp: 0xffffff, lampPower: 0, lampSpacing: 99, fog: 0.02, fogColor: 0x8fa3ad,
  },
  {
    id: "D", index: 3, name: "Flooded Passages", short: "SECTOR D",
    x0: 13, x1: 25, z0: 13, z1: 19, indoor: true, ceiling: 3.4,
    lamp: 0x9fc6cf, lampPower: 0.75, lampSpacing: 3, fog: 0.07, fogColor: 0x080d10,
  },
  {
    id: "E", index: 4, name: "The Undercroft", short: "SECTOR E",
    x0: 0, x1: 12, z0: 13, z1: 25, indoor: true, ceiling: 3.6,
    lamp: 0xffb266, lampPower: 0.8, lampSpacing: 3, fog: 0.065, fogColor: 0x100c08,
  },
];

export function zoneOfCell(i: number, j: number): ZoneInfo {
  for (const z of ZONES) {
    if (i >= z.x0 && i <= z.x1 && j >= z.z0 && j <= z.z1) return z;
  }
  return ZONES[0];
}

/* ------------------------------------------------------------------ *
 * Data model
 * ------------------------------------------------------------------ */
export type DoorKind = "metal" | "tunnel" | "grate" | "power" | "exit" | "rusty";

export interface DoorSpec {
  id: string;
  axis: "H" | "V";
  i: number;
  j: number;
  kind: DoorKind;
  label: string;
  /** id of the item required, if locked */
  requires?: string;
  /** initial state */
  open: boolean;
}

export type PlaceKind = "note" | "lore" | "fuse" | "key" | "breaker" | "exit";

export interface Placement {
  id: string;
  kind: PlaceKind;
  i: number;
  j: number;
  x: number;
  z: number;
  title: string;
  text: string;
  optional: boolean;
}

export interface Room {
  id: number;
  zone: ZoneId;
  i0: number;
  j0: number;
  w: number;
  h: number;
  label: string;
}

export interface MazeData {
  seed: number;
  w: number;
  h: number;
  zone: Uint8Array;
  wallH: Uint8Array; // (h+1) * w   index = j*w+i      wall between (i,j-1) and (i,j)
  wallV: Uint8Array; // h * (w+1)   index = j*(w+1)+i  wall between (i-1,j) and (i,j)
  isRoom: Uint8Array;
  roomId: Int16Array;
  rooms: Room[];
  doors: DoorSpec[];
  places: Placement[];
  spawn: [number, number];
  spawnYaw: number;
  exitCell: [number, number];
  exitEdge: { axis: "H" | "V"; i: number; j: number };
  report: ValidationReport;
}

export interface ValidationReport {
  ok: boolean;
  problems: string[];
  reachableCells: number;
  exitDistance: number;
  deadEnds: number;
  tJunctions: number;
  crossings: number;
  loops: number;
  attempts: number;
}

/* ------------------------------------------------------------------ *
 * Index helpers
 * ------------------------------------------------------------------ */
export const idx = (i: number, j: number) => j * GRID + i;
export const hIdx = (i: number, j: number) => j * GRID + i; // j in 0..GRID
export const vIdx = (i: number, j: number) => j * (GRID + 1) + i; // i in 0..GRID

export function cellCenter(i: number, j: number): [number, number] {
  return [(i + 0.5) * CELL, (j + 0.5) * CELL];
}
export function cellOf(x: number, z: number): [number, number] {
  return [Math.floor(x / CELL), Math.floor(z / CELL)];
}

export interface Edge {
  axis: "H" | "V";
  i: number;
  j: number;
}
export function edgeKey(e: Edge): string {
  return `${e.axis}${e.i}_${e.j}`;
}
/** Edge between two orthogonal cells (must be adjacent). */
export function edgeBetween(i0: number, j0: number, i1: number, j1: number): Edge {
  if (j1 === j0 + 1) return { axis: "H", i: i0, j: j1 };
  if (j1 === j0 - 1) return { axis: "H", i: i0, j: j0 };
  if (i1 === i0 + 1) return { axis: "V", i: i1, j: j0 };
  return { axis: "V", i: i0, j: j0 };
}
export function hasWall(m: MazeData, e: Edge): boolean {
  return e.axis === "H" ? m.wallH[hIdx(e.i, e.j)] === 1 : m.wallV[vIdx(e.i, e.j)] === 1;
}
export function setWall(m: MazeData, e: Edge, val: number) {
  if (e.axis === "H") m.wallH[hIdx(e.i, e.j)] = val;
  else m.wallV[vIdx(e.i, e.j)] = val;
}
export function doorAt(m: MazeData, e: Edge): DoorSpec | undefined {
  const k = edgeKey(e);
  return m.doors.find((d) => edgeKey(d) === k);
}
export function isPassable(m: MazeData, e: Edge, openDoors: Set<string>): boolean {
  if (!hasWall(m, e)) return true;
  const d = doorAt(m, e);
  if (!d) return false;
  return openDoors.has(d.id);
}

/** Centre of a wall segment in world space, plus its world-space footprint. */
export function wallTransform(e: Edge): { x: number; z: number; along: "x" | "z" } {
  if (e.axis === "H") return { x: (e.i + 0.5) * CELL, z: e.j * CELL, along: "x" };
  return { x: e.i * CELL, z: (e.j + 0.5) * CELL, along: "z" };
}

/* ------------------------------------------------------------------ *
 * Generation
 * ------------------------------------------------------------------ */
function regionCells(z: ZoneInfo): [number, number][] {
  const out: [number, number][] = [];
  for (let j = z.z0; j <= z.z1; j++) for (let i = z.x0; i <= z.x1; i++) out.push([i, j]);
  return out;
}

function inside(z: ZoneInfo, i: number, j: number) {
  return i >= z.x0 && i <= z.x1 && j >= z.z0 && j <= z.z1;
}

/** Recursive-backtracker over one region (guarantees region connectivity). */
function carveRegion(m: MazeData, z: ZoneInfo, rng: Rng) {
  const cells = regionCells(z);
  const visited = new Set<number>();
  const start = cells[rng.int(0, cells.length - 1)];
  const stack: [number, number][] = [start];
  visited.add(idx(start[0], start[1]));
  const dirs: [number, number][] = [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ];

  while (stack.length) {
    const [ci, cj] = stack[stack.length - 1];
    const options = rng
      .shuffle(dirs.slice())
      .filter(([dx, dz]) => {
        const ni = ci + dx;
        const nj = cj + dz;
        return inside(z, ni, nj) && !visited.has(idx(ni, nj));
      });
    if (!options.length) {
      stack.pop();
      continue;
    }
    const [dx, dz] = options[0];
    const ni = ci + dx;
    const nj = cj + dz;
    setWall(m, edgeBetween(ci, cj, ni, nj), 0);
    visited.add(idx(ni, nj));
    stack.push([ni, nj]);
  }

  // Braid: knock out extra interior walls for loops, junctions and alt routes.
  for (let j = z.z0; j <= z.z1; j++) {
    for (let i = z.x0; i <= z.x1; i++) {
      if (i > z.x0 && rng.bool(0.05)) setWall(m, { axis: "V", i, j }, 0);
      if (j > z.z0 && rng.bool(0.05)) setWall(m, { axis: "H", i, j }, 0);
    }
  }
}

function carveRoom(m: MazeData, room: Room, rng: Rng) {
  for (let j = room.j0; j < room.j0 + room.h; j++) {
    for (let i = room.i0; i < room.i0 + room.w; i++) {
      const k = idx(i, j);
      m.isRoom[k] = 1;
      m.roomId[k] = room.id;
      if (i > room.i0) setWall(m, { axis: "V", i, j }, 0);
      if (j > room.j0) setWall(m, { axis: "H", i, j }, 0);
    }
  }
  // Break one wall of the room on 1-2 sides so it reads as an opening, not a box.
  const sides: Edge[] = [];
  const { i0, j0, w, h } = room;
  for (let a = 0; a < w; a++) sides.push({ axis: "H", i: i0 + a, j: j0 });
  for (let a = 0; a < w; a++) sides.push({ axis: "H", i: i0 + a, j: j0 + h });
  for (let b = 0; b < h; b++) sides.push({ axis: "V", i: i0, j: j0 + b });
  for (let b = 0; b < h; b++) sides.push({ axis: "V", i: i0 + w, j: j0 + b });
  rng.shuffle(sides);
  let opened = 0;
  for (const s of sides) {
    if (hasWall(m, s)) {
      setWall(m, s, 0);
      opened++;
    }
    if (opened >= 2) break;
  }
}

/** Flood fill returning distances and reachability. */
export function bfs(
  m: MazeData,
  si: number,
  sj: number,
  openDoors?: Set<string>,
): { dist: Int32Array; count: number } {
  const dist = new Int32Array(m.w * m.h).fill(-1);
  const q: number[] = [idx(si, sj)];
  dist[idx(si, sj)] = 0;
  let head = 0;
  const doors = openDoors ?? new Set(m.doors.map((d) => d.id));
  while (head < q.length) {
    const cur = q[head++];
    const i = cur % m.w;
    const j = (cur - i) / m.w;
    const d = dist[cur];
    const nbrs: [number, number, Edge][] = [
      [i, j - 1, { axis: "H", i, j }],
      [i, j + 1, { axis: "H", i, j: j + 1 }],
      [i - 1, j, { axis: "V", i, j }],
      [i + 1, j, { axis: "V", i: i + 1, j }],
    ];
    for (const [ni, nj, e] of nbrs) {
      if (ni < 0 || nj < 0 || ni >= m.w || nj >= m.h) continue;
      if (!isPassable(m, e, doors)) continue;
      const nk = idx(ni, nj);
      if (dist[nk] !== -1) continue;
      dist[nk] = d + 1;
      q.push(nk);
    }
  }
  let count = 0;
  for (let k = 0; k < dist.length; k++) if (dist[k] >= 0) count++;
  return { dist, count };
}

export function deadEnds(m: MazeData, filter: (i: number, j: number) => boolean): [number, number][] {
  const out: [number, number][] = [];
  for (let j = 0; j < m.h; j++) {
    for (let i = 0; i < m.w; i++) {
      if (!filter(i, j)) continue;
      let open = 0;
      const es: Edge[] = [
        { axis: "H", i, j },
        { axis: "H", i, j: j + 1 },
        { axis: "V", i, j },
        { axis: "V", i: i + 1, j },
      ];
      for (const e of es) if (!hasWall(m, e)) open++;
      if (open === 1) out.push([i, j]);
    }
  }
  return out;
}

const ROOM_LABELS: Record<ZoneId, string[]> = {
  A: ["PUMP CHAMBER", "STORAGE BAY", "STAIR PIT"],
  B: ["MAINTENANCE", "CONTROL ROOM", "LAB 3", "COMMS"],
  C: ["GARDENER'S HUT", "CLEARING"],
  D: ["CISTERN", "SUMP ROOM"],
  E: ["LOWER VAULT", "BOILER HALL", "OSSUARY"],
};

/* ------------------------------------------------------------------ *
 * Main entry
 * ------------------------------------------------------------------ */
export function generateMaze(seed: number, attempt = 1): MazeData {
  const rng = new Rng(seed ^ 0x5f3759df);
  const m: MazeData = {
    seed,
    w: GRID,
    h: GRID,
    zone: new Uint8Array(GRID * GRID),
    wallH: new Uint8Array((GRID + 1) * GRID).fill(1),
    wallV: new Uint8Array(GRID * (GRID + 1)).fill(1),
    isRoom: new Uint8Array(GRID * GRID),
    roomId: new Int16Array(GRID * GRID).fill(-1),
    rooms: [],
    doors: [],
    places: [],
    spawn: [3, 3],
    spawnYaw: 0,
    exitCell: [25, 25],
    exitEdge: { axis: "V", i: GRID, j: 25 },
    report: { ok: false, problems: [], reachableCells: 0, exitDistance: 0, deadEnds: 0, tJunctions: 0, crossings: 0, loops: 0, attempts: attempt },
  };

  for (let j = 0; j < GRID; j++) for (let i = 0; i < GRID; i++) m.zone[idx(i, j)] = zoneOfCell(i, j).index;

  // 1. Independent maze per zone.
  for (const z of ZONES) carveRegion(m, z, rng.fork(z.index * 77 + 3));

  // 2. Rooms (landmarks + places to search).
  let roomId = 0;
  const overlaps = (r: { i0: number; j0: number; w: number; h: number }) =>
    m.rooms.some((o) => r.i0 < o.i0 + o.w && r.i0 + r.w > o.i0 && r.j0 < o.j0 + o.h && r.j0 + r.h > o.j0);
  for (const z of ZONES) {
    const zr = rng.fork(1000 + z.index);
    const count = z.id === "C" ? 1 : z.id === "D" ? 2 : 3;
    for (let n = 0; n < count; n++) {
      const rw = zr.int(1, 2);
      const rh = zr.int(1, 2);
      // keep a one-cell margin so carving the room never opens a sector
      // border or the outer boundary of the maze
      const ri = zr.int(z.x0 + 1, z.x1 - rw - 1);
      const rj = zr.int(z.z0 + 1, z.z1 - rh - 1);
      if (ri < z.x0 + 1 || rj < z.z0 + 1 || ri > z.x1 - rw - 1 || rj > z.z1 - rh - 1) continue;
      const room: Room = {
        id: roomId,
        zone: z.id,
        i0: ri,
        j0: rj,
        w: rw + 1,
        h: rh + 1,
        label: zr.pick(ROOM_LABELS[z.id]) + (n > 0 ? " " + (n + 1) : ""),
      };
      if (overlaps(room)) continue;
      roomId++;
      carveRoom(m, room, zr);
      m.rooms.push(room);
    }
  }

  // 3. Starting chamber: placed deterministically in any of the sectors
  const startZone = rng.pick(ZONES);
  const rw = rng.pick([2, 3]);
  const rh = rng.pick([2, 3]);
  const minI = startZone.x0 + 1;
  const maxI = Math.max(minI, startZone.x1 - rw - 1);
  const minJ = startZone.z0 + 1;
  const maxJ = Math.max(minJ, startZone.z1 - rh - 1);
  const ri = rng.int(minI, maxI);
  const rj = rng.int(minJ, maxJ);
  const startRoom: Room = {
    id: roomId++,
    zone: startZone.id,
    i0: ri,
    j0: rj,
    w: rw,
    h: rh,
    label: `${startZone.name.toUpperCase()} — ENTRY`,
  };
  carveRoom(m, startRoom, rng);
  m.rooms.unshift(startRoom);
  m.spawn = [ri + Math.floor(rw / 2), rj + Math.floor(rh / 2)];
  m.spawnYaw = rng.range(0, Math.PI * 2);

  // 4. Inter-zone portals. Only these edges cross zone borders, so each
  //    transition is a deliberate doorway / tunnel / gate.
  const portals: { a: ZoneId; b: ZoneId; axis: "H" | "V"; kind: DoorKind; label: string; requires?: string }[] = [
    { a: "A", b: "B", axis: "V", kind: "metal", label: "Blast door" },
    { a: "A", b: "E", axis: "H", kind: "tunnel", label: "Low tunnel" },
    { a: "B", b: "D", axis: "H", kind: "grate", label: "Rusted grate" },
    { a: "E", b: "D", axis: "V", kind: "rusty", label: "Sheet-metal door" },
    { a: "D", b: "C", axis: "H", kind: "power", label: "Raised gate" },
  ];
  for (const p of portals) {
    const za = ZONES.find((z) => z.id === p.a)!;
    const zb = ZONES.find((z) => z.id === p.b)!;
    const pr = rng.fork(5000 + za.index * 13 + zb.index * 7);
    let e: Edge | null = null;
    for (let tries = 0; tries < 200 && !e; tries++) {
      if (p.axis === "V") {
        // vertical boundary: x = zb.x0
        const x = zb.x0;
        const j = pr.int(Math.max(za.z0, zb.z0), Math.min(za.z1, zb.z1));
        const cand: Edge = { axis: "V", i: x, j };
        if (hasWall(m, cand) && !m.isRoom[idx(x - 1, j)] && !m.isRoom[idx(x, j)]) e = cand;
      } else {
        const zz = Math.max(za.z0, zb.z0);
        const i = pr.int(Math.max(za.x0, zb.x0), Math.min(za.x1, zb.x1));
        const cand: Edge = { axis: "H", i, j: zz };
        if (hasWall(m, cand) && !m.isRoom[idx(i, zz - 1)] && !m.isRoom[idx(i, zz)]) e = cand;
      }
    }
    if (!e) continue;
    setWall(m, e, 1);
    m.doors.push({
      id: `door_${p.a}${p.b}`,
      axis: e.axis,
      i: e.i,
      j: e.j,
      kind: p.kind,
      label: p.label,
      open: true, // every doorway is permanently open
    });
  }

  // 5. Exit: pick from far, reachable outer perimeter boundaries across the maze
  const allOpen = new Set(m.doors.map((d) => d.id));
  const { dist } = bfs(m, m.spawn[0], m.spawn[1], allOpen);
  interface ExitCand {
    cell: [number, number];
    edge: Edge;
    d: number;
  }
  const candidates: ExitCand[] = [];
  for (let i = 0; i < GRID; i++) {
    candidates.push({ cell: [i, 0], edge: { axis: "H", i, j: 0 }, d: dist[idx(i, 0)] }); // North
    candidates.push({ cell: [i, GRID - 1], edge: { axis: "H", i, j: GRID }, d: dist[idx(i, GRID - 1)] }); // South
    candidates.push({ cell: [0, i], edge: { axis: "V", i: 0, j: i }, d: dist[idx(0, i)] }); // West
    candidates.push({ cell: [GRID - 1, i], edge: { axis: "V", i: GRID, j: i }, d: dist[idx(GRID - 1, i)] }); // East
  }
  const reachable = candidates.filter(
    (c) => c.d > 0 && (c.cell[0] !== m.spawn[0] || c.cell[1] !== m.spawn[1])
  );
  const maxD = reachable.reduce((acc, c) => Math.max(acc, c.d), 0);
  const minThreshold = Math.max(35, Math.floor(maxD * 0.72));
  let eligible = reachable.filter((c) => c.d >= minThreshold);
  if (!eligible.length) eligible = reachable.filter((c) => c.d >= 35);
  if (!eligible.length) eligible = reachable.sort((a, b) => b.d - a.d).slice(0, 5);

  const chosen = rng.pick(eligible);
  m.exitCell = chosen.cell;
  m.exitEdge = chosen.edge;
  m.doors.push({
    id: "door_exit",
    axis: m.exitEdge.axis,
    i: m.exitEdge.i,
    j: m.exitEdge.j,
    kind: "exit",
    label: "Exit",
    open: true, // reachable from the start, nothing to unlock
  });

  // 6. The exit is the only goal. It is reachable from the very first second:
  //    no items, switches or keys are required anywhere in the maze.
  {
    const [x, z] = cellCenter(m.exitCell[0], m.exitCell[1]);
    m.places.push({ id: "exit", kind: "exit", i: m.exitCell[0], j: m.exitCell[1], x, z, title: "EXIT", text: "", optional: false });
  }

  // 7. Validation ----------------------------------------------------------
  m.report = validate(m);
  if (!m.report.ok && attempt < 8) return generateMaze(seed + 7919, attempt + 1);
  return m;
}

/* ------------------------------------------------------------------ *
 * Validation: proves the level is completable before it is built.
 * ------------------------------------------------------------------ */
export function validate(m: MazeData): ValidationReport {
  const problems: string[] = [];
  const [si, sj] = m.spawn;

  // 1. spawn inside the grid, in a valid cell
  if (si < 0 || sj < 0 || si >= m.w || sj >= m.h) problems.push("spawn outside grid");

  // 2. nothing may be locked: the exit must be reachable from the start
  for (const d of m.doors) if (!d.open || d.requires) problems.push(`door ${d.id} is locked`);

  // 3. every cell reachable from spawn (no sealed pockets, no fake corridors)
  const full = bfs(m, si, sj);
  if (full.count !== m.w * m.h) problems.push(`maze not fully connected (${full.count}/${m.w * m.h} cells)`);

  // 4. exit exists, sits on the outer boundary next to its cell, and is reachable
  const exitDoor = m.doors.find((d) => d.kind === "exit");
  if (!exitDoor) problems.push("no exit door");
  else if (exitDoor.axis !== m.exitEdge.axis || exitDoor.i !== m.exitEdge.i || exitDoor.j !== m.exitEdge.j)
    problems.push("exit door not on exit edge");
  const [ei, ej] = m.exitCell;
  if (si === ei && sj === ej) problems.push("entrance and exit are the exact same cell");

  const onEdge =
    (m.exitEdge.axis === "V" && m.exitEdge.i === GRID && m.exitEdge.j === ej && ei === GRID - 1) ||
    (m.exitEdge.axis === "V" && m.exitEdge.i === 0 && m.exitEdge.j === ej && ei === 0) ||
    (m.exitEdge.axis === "H" && m.exitEdge.j === GRID && m.exitEdge.i === ei && ej === GRID - 1) ||
    (m.exitEdge.axis === "H" && m.exitEdge.j === 0 && m.exitEdge.i === ei && ej === 0);
  if (!onEdge) problems.push("exit edge is not on the outer boundary of the exit cell");
  const exitD = full.dist[idx(ei, ej)];
  if (exitD < 0) problems.push("exit unreachable");
  else if (exitD < 35) problems.push(`exit too close to spawn (${exitD} cells)`);

  // 5. the outer boundary is sealed everywhere except the exit gate
  for (let i = 0; i < GRID; i++) {
    if (!hasWall(m, { axis: "H", i, j: 0 })) problems.push(`hole in north boundary at ${i}`);
    if (!hasWall(m, { axis: "H", i, j: GRID })) problems.push(`hole in south boundary at ${i}`);
    if (!hasWall(m, { axis: "V", i: 0, j: i })) problems.push(`hole in west boundary at ${i}`);
    if (!hasWall(m, { axis: "V", i: GRID, j: i })) problems.push(`hole in east boundary at ${i}`);
  }

  // 6. it has to be a real maze: dead ends, junctions and loops
  let dead = 0;
  let j3 = 0;
  let j4 = 0;
  let open = 0;
  for (let j = 0; j < m.h; j++) {
    for (let i = 0; i < m.w; i++) {
      const es: Edge[] = [
        { axis: "H", i, j },
        { axis: "H", i, j: j + 1 },
        { axis: "V", i, j },
        { axis: "V", i: i + 1, j },
      ];
      let n = 0;
      for (const e of es) {
        const boundary = (e.axis === "H" && (e.j === 0 || e.j === GRID)) || (e.axis === "V" && (e.i === 0 || e.i === GRID));
        if (boundary) continue;
        if (!hasWall(m, e) || doorAt(m, e)) n++;
      }
      if (n === 1) dead++;
      if (n === 3) j3++;
      if (n === 4) j4++;
      open += n;
    }
  }
  const loops = open / 2 - m.w * m.h + 1;
  if (dead < 12) problems.push(`too few dead ends (${dead})`);
  if (j3 < 20) problems.push(`too few T-junctions (${j3})`);
  if (loops < 6) problems.push(`too few loops (${loops})`);

  return {
    ok: problems.length === 0,
    problems,
    reachableCells: full.count,
    exitDistance: exitD,
    deadEnds: dead,
    tJunctions: j3,
    crossings: j4,
    loops,
    attempts: m.report.attempts,
  };
}

/** Compact deterministic fingerprint of walls, spawn and exit. Used so every
 *  co-op client can prove they built the same maze from the published seed. */
export function mazeFingerprint(m: MazeData): string {
  let h = 2166136261 >>> 0;
  const feed = (n: number) => {
    h ^= n >>> 0;
    h = Math.imul(h, 16777619);
  };
  feed(MAZE_GEN_VERSION);
  feed(m.seed);
  feed(m.w);
  feed(m.h);
  feed(m.spawn[0]);
  feed(m.spawn[1]);
  feed(m.exitCell[0]);
  feed(m.exitCell[1]);
  feed(m.exitEdge.axis === "H" ? 1 : 2);
  feed(m.exitEdge.i);
  feed(m.exitEdge.j);
  for (let i = 0; i < m.wallH.length; i++) feed(m.wallH[i]);
  for (let i = 0; i < m.wallV.length; i++) feed(m.wallV[i]);
  for (const d of m.doors) {
    feed(d.axis === "H" ? 1 : 2);
    feed(d.i);
    feed(d.j);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
