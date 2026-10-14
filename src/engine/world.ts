import * as THREE from "three";
import {
  CELL,
  GRID,
  WALL_T,
  ZONES,
  type DoorSpec,
  type Edge,
  type MazeData,
  type Placement,
  type ZoneInfo,
  cellCenter,
  hasWall,
  idx,
  wallTransform,
  zoneOfCell,
} from "./maze";
import { buildMaterials, enableWind, tileOf, type MatKit } from "./materials";
import { Rng } from "./rng";
import { makeMarkTexture, makeSignTexture } from "./textures";
import { applyShade, applyWorldUV, archRib, boxUV, fbm2, frame, mergeGeos } from "./geometry";

export interface Collider {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  door?: string;
}

export interface LampFixture {
  pos: THREE.Vector3;
  color: number;
  power: number;
  zone: ZoneInfo;
  kind: "strip" | "tube" | "cage" | "lantern" | "emergency";
  flicker: number; // 0 = steady
  on: boolean;
  seed: number;
}

/** A permanently open doorway between sectors (or the exit gate). */
export interface WorldDoor {
  spec: DoorSpec;
  kind: DoorSpec["kind"];
  center: THREE.Vector3;
}

export interface Interactable {
  id: string;
  kind: Placement["kind"] | "door" | "exit";
  pos: THREE.Vector3;
  label: string;
  verb: string;
  radius: number;
  door?: WorldDoor;
  place?: Placement;
}

export interface BuiltLevel {
  root: THREE.Group;
  colliders: Collider[];
  grid: Map<number, number[]>;
  lamps: LampFixture[];
  doors: WorldDoor[];
  interactables: Interactable[];
  waterCells: Set<number>;
  spawn: THREE.Vector3;
  spawnYaw: number;
  exitOutside: THREE.Vector3;
  exitDoor: WorldDoor;
  /** true only once the player has walked through the exit gate into the
   *  vestibule beyond it — impossible to trigger from inside the maze */
  exitTrigger(p: THREE.Vector3): boolean;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  sky: THREE.Mesh;
  sunCenter: THREE.Vector3;
  audioSpots: { pos: THREE.Vector3; kind: "drip" | "vent" | "buzz" | "wind" | "creak" }[];
  update(dt: number, t: number): void;
  dispose(): void;
}

const SEG = 2; // floor tessellation (metres)
/** distance from a cell centre to the face of a wall on one of its sides */
const FACE = CELL / 2 - WALL_T / 2;
const PLAYER_R = 0.34;

export function buildLevel(maze: MazeData, quality: { foliageDensity: number; props: number }): BuiltLevel {
  const mats: MatKit = buildMaterials();
  const root = new THREE.Group();
  const rng = new Rng(maze.seed ^ 0x1234);
  const colliders: Collider[] = [];
  const grid = new Map<number, number[]>();
  const lamps: LampFixture[] = [];
  const audioSpots: BuiltLevel["audioSpots"] = [];
  const disposables: (THREE.BufferGeometry | THREE.Material | THREE.Texture)[] = [];

  const addCollider = (c: Collider) => {
    const i0 = Math.max(0, Math.floor(c.minX / CELL));
    const i1 = Math.min(GRID - 1, Math.floor(c.maxX / CELL));
    const j0 = Math.max(0, Math.floor(c.minZ / CELL));
    const j1 = Math.min(GRID - 1, Math.floor(c.maxZ / CELL));
    const at = colliders.push(c) - 1;
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const k = idx(i, j);
        let a = grid.get(k);
        if (!a) grid.set(k, (a = []));
        a.push(at);
      }
    return c;
  };

  /* ---------------------------------------------------------------- *
   * Merged static geometry batches (one draw call per material)
   * ---------------------------------------------------------------- */
  const batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const push = (mat: THREE.Material, geo: THREE.BufferGeometry) => {
    let arr = batches.get(mat);
    if (!arr) batches.set(mat, (arr = []));
    arr.push(geo);
  };
  const wallOfEdge = (e: Edge): ZoneInfo => {
    if (e.axis === "H") {
      const a = e.j > 0 ? zoneOfCell(e.i, e.j - 1) : zoneOfCell(e.i, e.j);
      const b = e.j < GRID ? zoneOfCell(e.i, e.j) : a;
      return a.indoor ? a : b;
    }
    const a = e.i > 0 ? zoneOfCell(e.i - 1, e.j) : zoneOfCell(e.i, e.j);
    const b = e.i < GRID ? zoneOfCell(e.i, e.j) : a;
    return a.indoor ? a : b;
  };

  const wallMatFor = (z: ZoneInfo) =>
    z.id === "A" ? mats.wallA : z.id === "B" ? mats.wallB : z.id === "D" ? mats.wallD : z.id === "E" ? mats.wallE : mats.hedgeSide;

  const shadeWall = (z: ZoneInfo, x: number, y: number, zpos: number, ceil: number): [number, number, number] => {
    let v = 0.86 + rng.next() * 0.0; // per-segment tint applied outside
    const ao = 0.5 + 0.5 * Math.min(1, Math.max(0, y / 1.35));
    v *= ao;
    if (y > ceil - 0.45) v *= 0.86;
    if (z.id === "D" && y < 0.42) {
      const k = 1 - y / 0.42;
      v *= 1 - 0.42 * k;
      return [v * 0.86, v * 1.02, v * 0.95];
    }
    if (z.id === "E" && y < 1.1) {
      const k = (1 - y / 1.1) * (0.4 + fbm2(x * 0.4, zpos * 0.4, 9, 2) * 0.9);
      v *= 1 - 0.3 * Math.min(1, k);
      return [v * 0.94, v * 1.0, v * 0.92];
    }
    return [v, v, v];
  };

  /* ---------------------------- WALLS ----------------------------- */
  for (let j = 0; j <= GRID; j++) {
    for (let i = 0; i <= GRID; i++) {
      const edges: Edge[] = [];
      if (i < GRID && j <= GRID) edges.push({ axis: "H", i, j });
      if (j < GRID && i <= GRID) edges.push({ axis: "V", i, j });
      for (const e of edges) {
        if (!hasWall(maze, e)) continue;
        if (maze.doors.some((d) => d.axis === e.axis && d.i === e.i && d.j === e.j)) continue;
        const zone = wallOfEdge(e);
        const { x, z, along } = wallTransform(e);
        if (zone.id === "C") {
          // ---- hedge: leafy shell + solid dark core ----
          const len = CELL + WALL_T;
          const core = boxUV(along === "x" ? len : 0.85, 2.45, along === "x" ? 0.85 : len, 2);
          core.translate(x, 1.22, z);
          applyShade(core, () => {
            const k = 0.8 + fbm2(x * 0.3, z * 0.3, 3, 2) * 0.4;
            return [k, k * 1.1, k * 0.8];
          });
          push(mats.hedgeCore, core);
          const shell = boxUV(along === "x" ? len : 1.35, 2.75, along === "x" ? 1.35 : len, tileOf(mats.hedgeSide));
          shell.translate(x, 1.3, z);
          applyShade(shell, (px, py, pz) => {
            const k = 0.72 + fbm2(px * 0.25, pz * 0.25, 5, 2) * 0.5;
            const top = 0.85 + 0.3 * Math.min(1, py / 2.6);
            return [k * top, k * top * 1.05, k * top * 0.85] as [number, number, number];
          });
          push(mats.hedgeSide, shell);
          // hedges are solid: the player cannot walk through them
          addCollider({
            minX: x - (along === "x" ? len / 2 : 0.6),
            maxX: x + (along === "x" ? len / 2 : 0.6),
            minZ: z - (along === "z" ? len / 2 : 0.6),
            maxZ: z + (along === "z" ? len / 2 : 0.6),
          });
        } else {
          const len = CELL + WALL_T;
          const ceil = zone.ceiling;
          const g = boxUV(along === "x" ? len : WALL_T, ceil, along === "x" ? WALL_T : len, tileOf(wallMatFor(zone)));
          g.translate(x, ceil / 2, z);
          const tint = 0.84 + rng.next() * 0.28;
          applyShade(g, (px, py, pz) => {
            const [r, gg, b] = shadeWall(zone, py, 0, 0, ceil);
            const grime = 0.9 + fbm2(px * 0.2, pz * 0.2, 4, 2) * 0.22;
            return [r * tint * grime, gg * tint * grime, b * tint * grime];
          });
          push(wallMatFor(zone), g);
          addCollider({
            minX: x - (along === "x" ? len / 2 : WALL_T / 2),
            maxX: x + (along === "x" ? len / 2 : WALL_T / 2),
            minZ: z - (along === "z" ? len / 2 : WALL_T / 2),
            maxZ: z + (along === "z" ? len / 2 : WALL_T / 2),
          });
        }
      }
    }
  }

  /* --------------------- FLOORS AND CEILINGS ---------------------- */
  for (const z of ZONES) {
    const w = (z.x1 - z.x0 + 1) * CELL;
    const d = (z.z1 - z.z0 + 1) * CELL;
    const cx = z.x0 * CELL + w / 2;
    const cz = z.z0 * CELL + d / 2;
    const floorMat = z.id === "A" ? mats.floorA : z.id === "B" ? mats.floorB : z.id === "D" ? mats.floorD : z.id === "E" ? mats.floorE : mats.soil;
    const steps = Math.max(2, Math.round((w / SEG) * 1));
    const stepsZ = Math.max(2, Math.round(d / SEG));
    const floor = applyWorldUV(new THREE.PlaneGeometry(w, d, steps, stepsZ), tileOf(floorMat));
    floor.rotateX(-Math.PI / 2);
    floor.translate(cx, 0, cz);
    applyShade(floor, (px, _py, pz) => {
      const mx = px - Math.floor(px / CELL) * CELL;
      const mz = pz - Math.floor(pz / CELL) * CELL;
      const edge = Math.min(Math.min(mx, CELL - mx), Math.min(mz, CELL - mz));
      const corner = Math.min(1, edge / 1.5);
      const big = 0.82 + fbm2(px * 0.11, pz * 0.11, 6, 3) * 0.36;
      const v = big * (0.68 + 0.32 * corner);
      if (z.id === "C") return [v * 1.0, v * 0.98, v * 0.92];
      return [v, v, v];
    });
    push(floorMat, floor);

    if (z.indoor) {
      const ceilMat = z.id === "B" ? mats.wallB : z.id === "E" ? mats.ceilE : mats.ceilA;
      const ceil = applyWorldUV(new THREE.PlaneGeometry(w, d, Math.max(2, w / 4), Math.max(2, d / 4)), tileOf(ceilMat) * 1.5);
      ceil.rotateX(Math.PI / 2);
      ceil.translate(cx, z.ceiling, cz);
      applyShade(ceil, (px, _py, pz) => {
        const mx = px - Math.floor(px / CELL) * CELL;
        const mz = pz - Math.floor(pz / CELL) * CELL;
        const edge = Math.min(Math.min(mx, CELL - mx), Math.min(mz, CELL - mz));
        const corner = Math.min(1, edge / 1.2);
        const v = (0.78 + fbm2(px * 0.2, pz * 0.2, 8, 2) * 0.3) * (0.7 + 0.3 * corner);
        return [v, v, v];
      });
      push(ceilMat, ceil);
    }
  }

  /* --------------------------- DOORS ------------------------------ */
  // Every doorway is permanently open: the only challenge is the layout.
  // Shutters and gates are drawn raised into the lintel so they read as real
  // doors, but never block (or appear to block) the passage. Collision is
  // limited to the two jambs, which match the visible frame exactly.
  const doors: WorldDoor[] = [];
  const interactables: Interactable[] = [];
  let exitDoor!: WorldDoor;
  const white = () => [1, 1, 1] as [number, number, number];

  for (const spec of maze.doors) {
    const edge: Edge = { axis: spec.axis, i: spec.i, j: spec.j };
    const { x, z, along } = wallTransform(edge);
    const zoneA = wallOfEdge(edge);
    const top = zoneA.indoor ? zoneA.ceiling : 4.0;
    const isExit = spec.kind === "exit";
    const depth = isExit ? 1.2 : 0.85;
    const w = CELL - 0.06;
    const h = spec.kind === "tunnel" ? 2.72 : Math.min(top, 3.4);
    const jamb = 0.28;
    const rotY = along === "x" ? 0 : Math.PI / 2;
    // local (u along the wall, v across it) -> world
    const place = (g: THREE.BufferGeometry) => {
      g.rotateY(rotY);
      g.translate(x, 0, z);
      return g;
    };

    const liningMat = spec.kind === "tunnel" || isExit ? mats.concreteProp : spec.kind === "grate" ? mats.rust : mats.painted;
    const lining = place(frame(w, h, depth, jamb, tileOf(liningMat)));
    applyShade(lining, () => [0.95, 0.95, 0.95]);
    push(liningMat, lining);

    // solid wall above the opening up to the ceiling (or gatehouse top outdoors)
    if (top - h > 0.01) {
      const headerMat = zoneA.indoor ? wallMatFor(zoneA) : mats.concreteProp;
      const thick = zoneA.indoor ? WALL_T : depth;
      const header = place(boxUV(CELL + WALL_T, top - h, thick, tileOf(headerMat)).translate(0, h + (top - h) / 2, 0));
      applyShade(header, (_px, py) => {
        const v = 0.8 + 0.2 * Math.min(1, (py - h) / 1.2);
        return [v, v, v] as [number, number, number];
      });
      push(headerMat, header);
    }
    // outdoors the gatehouse needs side piers so it does not float in the hedge
    if (!zoneA.indoor) {
      for (const s of [-1, 1]) {
        const pier = place(boxUV(0.7, top, depth + 0.1, 2.4).translate(s * (w / 2 + 0.3), top / 2, 0));
        applyShade(pier, (_px, py) => {
          const v = 0.62 + 0.38 * Math.min(1, py / 1.6);
          return [v, v, v] as [number, number, number];
        });
        push(mats.concreteProp, pier);
        const off = s * (w / 2 + 0.3);
        const cx = along === "x" ? x + off : x;
        const cz = along === "x" ? z : z + off;
        const hx = along === "x" ? 0.35 : (depth + 0.1) / 2;
        const hz = along === "x" ? (depth + 0.1) / 2 : 0.35;
        addCollider({ minX: cx - hx, maxX: cx + hx, minZ: cz - hz, maxZ: cz + hz });
      }
    }

    // jamb colliders (exactly the visible jambs)
    for (const s of [-1, 1]) {
      const off = s * (w / 2 - jamb / 2);
      const cx = along === "x" ? x + off : x;
      const cz = along === "x" ? z : z + off;
      const hx = along === "x" ? jamb / 2 : depth / 2;
      const hz = along === "x" ? depth / 2 : jamb / 2;
      addCollider({ minX: cx - hx, maxX: cx + hx, minZ: cz - hz, maxZ: cz + hz });
    }

    // raised leaf / gate, visible as a strip under the lintel
    const clear = w - jamb * 2;
    const under = h - jamb; // underside of the lintel
    if (spec.kind === "metal" || spec.kind === "rusty") {
      const leafMat = spec.kind === "rusty" ? mats.rust : mats.painted;
      const slab = place(boxUV(clear, 0.46, 0.12, tileOf(leafMat)).translate(0, under - 0.23, 0));
      applyShade(slab, white);
      push(leafMat, slab);
      const lip = place(boxUV(clear, 0.07, 0.18, 1).translate(0, under - 0.46, 0));
      applyShade(lip, white);
      push(mats.darkMetal, lip);
    } else if (spec.kind === "grate" || spec.kind === "power" || isExit) {
      const n = isExit ? 15 : 11;
      const len = isExit ? 0.62 : 0.55;
      const parts: THREE.BufferGeometry[] = [];
      for (let k = 0; k < n; k++) {
        const bar = boxUV(0.06, len, 0.06, 0.6).translate((k / (n - 1) - 0.5) * (clear - 0.1), under - len / 2, 0);
        parts.push(bar);
        // pointed tips on the gates
        if (spec.kind !== "grate") {
          const tip = applyWorldUV(new THREE.ConeGeometry(0.045, 0.12, 4), 0.4);
          tip.rotateX(Math.PI); // point downwards
          tip.translate((k / (n - 1) - 0.5) * (clear - 0.1), under - len - 0.06, 0);
          parts.push(tip);
        }
      }
      parts.push(boxUV(clear, 0.09, 0.1, 0.6).translate(0, under - len + 0.1, 0));
      const gate = place(mergeGeos(parts));
      applyShade(gate, white);
      push(isExit ? mats.darkMetal : mats.rust, gate);
    } else {
      // tunnel: a small hanging lamp in the low passage
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), mats.lampGlass);
      bulb.position.set(x, 2.35, z);
      root.add(bulb);
      lamps.push({ pos: new THREE.Vector3(x, 2.35, z), color: 0xffb377, power: 0.55, zone: zoneA, kind: "lantern", flicker: 0.35, on: true, seed: rng.next() * 100 });
    }

    if (isExit) {
      // illuminated EXIT sign on the maze side of the gatehouse, plus a lamp,
      // so the exit is recognisable once the player finds it (not before)
      const outDir = spec.axis === "V"
        ? new THREE.Vector3(spec.i === 0 ? -1 : 1, 0, 0)
        : new THREE.Vector3(0, 0, spec.j === 0 ? -1 : 1);
      const inward = new THREE.Vector3(-outDir.x, 0, -outDir.z);
      const sign = new THREE.Mesh(
        new THREE.PlaneGeometry(1.5, 0.45),
        new THREE.MeshStandardMaterial({
          map: makeSignTexture(["E X I T"], "stencil"),
          emissive: new THREE.Color(0x9fe6a0),
          emissiveIntensity: 1.1,
          transparent: true,
        }),
      );
      sign.position.set(x + inward.x * (depth / 2 + 0.02), h + 0.3, z + inward.z * (depth / 2 + 0.02));
      sign.lookAt(sign.position.x + inward.x, sign.position.y, sign.position.z + inward.z);
      root.add(sign);
      lamps.push({
        pos: new THREE.Vector3(x + inward.x * 1.2, 3.3, z + inward.z * 1.2),
        color: 0xd8f0dc,
        power: 0.9,
        zone: zoneA,
        kind: "lantern",
        flicker: 0,
        on: true,
        seed: 3,
      });
    }

    const wd: WorldDoor = { spec, kind: spec.kind, center: new THREE.Vector3(x, h / 2, z) };
    doors.push(wd);
    if (isExit) exitDoor = wd;
  }

  /* ---------------------------- LAMPS ----------------------------- */
  const housingGeos: THREE.BufferGeometry[] = [];
  const litGlass: THREE.Matrix4[] = [];
  const deadGlass: THREE.Matrix4[] = [];
  const emergencyGlass: THREE.Matrix4[] = [];

  for (const z of ZONES) {
    if (!z.indoor) continue;
    const zr = new Rng(maze.seed + z.index * 991);
    for (let j = z.z0; j <= z.z1; j++) {
      for (let i = z.x0; i <= z.x1; i++) {
        const k = idx(i, j);
        if ((i + j * 3) % z.lampSpacing !== 0 && !maze.isRoom[k]) continue;
        const [x, zz] = cellCenter(i, j);
        const y = z.ceiling - 0.16;
        const dead = zr.bool(0.22);
        const flicker = zr.bool(0.14) ? zr.range(0.3, 1) : 0;
        const emergency = z.id === "B" && zr.bool(0.25);
        const kind: LampFixture["kind"] = emergency
          ? "emergency"
          : z.id === "B"
            ? "tube"
            : z.id === "D"
              ? "cage"
              : z.id === "E"
                ? "lantern"
                : "strip";
        let color = z.lamp;
        let power = z.lampPower * zr.range(0.75, 1.15);
        if (kind === "emergency") {
          color = 0xff5a3c;
          power = 0.5;
        }
        if (kind === "lantern") color = 0xffb066;
        if (z.id === "D") color = 0xa8d8e0;

        if (kind === "strip" || kind === "tube") {
          const len = kind === "tube" ? 1.3 : 0.95;
          const ax = orient(i, j) === "x";
          const housing = boxUV(ax ? len : 0.28, 0.13, ax ? 0.28 : len, 1).translate(x, y + 0.07, zz);
          applyShade(housing, () => [0.95, 0.95, 0.95]);
          housingGeos.push(housing);
          const glass = new THREE.Matrix4().makeTranslation(x, y, zz);
          (dead ? deadGlass : flicker ? emergencyGlass : litGlass).push(glass);
        } else if (kind === "cage") {
          const housing = boxUV(0.34, 0.16, 0.34, 1).translate(x, y + 0.09, zz);
          applyShade(housing, () => [0.95, 0.95, 0.95]);
          housingGeos.push(housing);
          const glass = new THREE.Matrix4().makeTranslation(x, y - 0.02, zz);
          (dead ? deadGlass : litGlass).push(glass);
        } else {
          // wall lantern in the undercroft
          const dir = wallDir(maze, i, j);
          const hx = x + dir.x * (CELL / 2 - 0.3);
          const hz = zz + dir.z * (CELL / 2 - 0.3);
          const housing = boxUV(0.22, 0.3, 0.22, 1).translate(hx, 2.75, hz);
          applyShade(housing, () => [0.95, 0.95, 0.95]);
          housingGeos.push(housing);
          const glass = new THREE.Matrix4().makeTranslation(hx, 2.62, hz);
          (dead ? deadGlass : litGlass).push(glass);
          lamps.push({
            pos: new THREE.Vector3(hx, 2.62, hz),
            color,
            power: power * 0.8,
            zone: z,
            kind,
            flicker,
            on: !dead,
            seed: zr.next() * 100,
          });
          continue;
        }
        lamps.push({ pos: new THREE.Vector3(x, y - 0.05, zz), color, power, zone: z, kind, flicker, on: !dead, seed: zr.next() * 100 });
        if (emergency || flicker) audioSpots.push({ pos: new THREE.Vector3(x, y, zz), kind: "buzz" });
        if (zr.bool(0.12)) audioSpots.push({ pos: new THREE.Vector3(x, 2.6, zz), kind: "vent" });
      }
    }
  }
  /** fixtures run along the corridor axis */
  function orient(i: number, j: number): "x" | "z" {
    return !solid(maze, { axis: "V", i, j }) || !solid(maze, { axis: "V", i: i + 1, j }) ? "x" : "z";
  }

  const housingMesh = new THREE.Mesh(mergeGeos(housingGeos), mats.darkMetal);
  root.add(housingMesh);
  const glassGeo = new THREE.BoxGeometry(0.86, 0.055, 0.2);
  const addInstanced = (mats4: THREE.Matrix4[], mat: THREE.Material, geo: THREE.BufferGeometry) => {
    if (!mats4.length) return;
    const im = new THREE.InstancedMesh(geo, mat, mats4.length);
    mats4.forEach((m, n) => im.setMatrixAt(n, m));
    im.instanceMatrix.needsUpdate = true;
    im.frustumCulled = false;
    root.add(im);
  };
  addInstanced(litGlass, mats.lampGlass, glassGeo);
  addInstanced(deadGlass, mats.lampGlassOff, glassGeo);
  addInstanced(emergencyGlass, mats.lampGlass, new THREE.BoxGeometry(1.24, 0.06, 0.16));

  /* --------------------------- PROPS ------------------------------ */
  const propDensity = quality.props;
  const puddles: THREE.BufferGeometry[] = [];
  const markMats = new Map<string, THREE.MeshStandardMaterial>();
  const waterCells = new Set<number>();

  for (const z of ZONES) {
    const zr = new Rng(maze.seed * 31 + z.index * 7717);
    const cells: [number, number][] = [];
    for (let j = z.z0; j <= z.z1; j++) for (let i = z.x0; i <= z.x1; i++) cells.push([i, j]);

    if (z.id === "D") {
      for (const [i, j] of cells) waterCells.add(idx(i, j));
      const wg = new THREE.PlaneGeometry((z.x1 - z.x0 + 1) * CELL, (z.z1 - z.z0 + 1) * CELL, 1, 1);
      wg.rotateX(-Math.PI / 2);
      wg.translate(z.x0 * CELL + ((z.x1 - z.x0 + 1) * CELL) / 2, 0.14, z.z0 * CELL + ((z.z1 - z.z0 + 1) * CELL) / 2);
      const water = new THREE.Mesh(wg, mats.water);
      water.renderOrder = 2;
      root.add(water);
      disposables.push(wg);
    }

    for (const [i, j] of cells) {
      const [x, zz] = cellCenter(i, j);
      const k = idx(i, j);
      const isRoom = !!maze.isRoom[k];

      // ---- puddles & wet patches ----
      if (z.indoor && (z.id === "D" || zr.bool(0.07))) {
        const r = zr.range(0.5, 1.5);
        const pg = new THREE.CircleGeometry(r, 16);
        pg.rotateX(-Math.PI / 2);
        pg.translate(x + zr.range(-0.9, 0.9), z.id === "D" ? 0.155 : 0.02, zz + zr.range(-0.9, 0.9));
        puddles.push(pg);
      }
      if (z.id === "D" && zr.bool(0.3)) audioSpots.push({ pos: new THREE.Vector3(x, 2.2, zz), kind: "drip" });
      if (z.id === "E" && zr.bool(0.12)) audioSpots.push({ pos: new THREE.Vector3(x, 2.4, zz), kind: "drip" });

      if (!propDensity) continue;

      // ---- sector A: conduit, debris, chalk marks ----
      if (z.id === "A") {
        const dir = wallDir(maze, i, j);
        const hasW = dir.lengthSq() > 0.1;
        const alongZ = Math.abs(dir.x) > 0.5; // wall on an x side -> fixtures run along z
        if (hasW && zr.bool(0.3)) {
          const pipe = applyWorldUV(new THREE.CylinderGeometry(0.045, 0.045, CELL - WALL_T, 8), 0.8);
          pipe.rotateZ(Math.PI / 2);
          if (alongZ) pipe.rotateY(Math.PI / 2);
          pipe.translate(x + dir.x * (FACE - 0.07), 3.25, zz + dir.z * (FACE - 0.07));
          applyShade(pipe, white);
          push(mats.rust, pipe);
          const jb = boxUV(alongZ ? 0.1 : 0.16, 0.22, alongZ ? 0.16 : 0.1, 0.6);
          jb.translate(x + dir.x * (FACE - 0.05), 3.0, zz + dir.z * (FACE - 0.05));
          applyShade(jb, white);
          push(mats.darkMetal, jb);
        }
        if (zr.bool(0.18)) {
          // low debris heap (walk-over decoration, no collision)
          const heap = applyWorldUV(new THREE.ConeGeometry(zr.range(0.3, 0.55), zr.range(0.1, 0.24), 7), 0.8);
          heap.rotateY(zr.next() * 3);
          const hx = hasW ? x + dir.x * (FACE - 0.5) : x + zr.range(-1.2, 1.2);
          const hz = hasW ? zz + dir.z * (FACE - 0.5) : zz + zr.range(-1.2, 1.2);
          heap.translate(hx, 0.06, hz);
          applyShade(heap, () => [0.85, 0.85, 0.85] as [number, number, number]);
          push(mats.concreteProp, heap);
        }
        if (hasW && zr.bool(0.1)) {
          const key = `${zr.int(0, 2)}_${zr.int(1, 9)}`;
          let mat = markMats.get(key);
          if (!mat) {
            const [k, d] = key.split("_");
            const tex = makeMarkTexture((["arrow", "digits", "cross"] as const)[+k], d);
            mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 1, depthWrite: false });
            markMats.set(key, mat);
          }
          const mark = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8), mat);
          mark.position.set(x + dir.x * (FACE - 0.015), 1.6, zz + dir.z * (FACE - 0.015));
          mark.lookAt(mark.position.x - dir.x, 1.6, mark.position.z - dir.z);
          root.add(mark);
        }
        if (hasW && zr.bool(0.06)) {
          // crate pushed against the wall, off the corridor centre line
          const side = zr.sign() * 1.0;
          const px = x + dir.x * (FACE - 0.36) + Math.abs(dir.z) * side;
          const pz = zz + dir.z * (FACE - 0.36) + Math.abs(dir.x) * side;
          const crate = boxUV(0.7, 0.55, 0.7, 1.1);
          crate.rotateY(zr.range(-0.08, 0.08));
          crate.translate(px, 0.275, pz);
          applyShade(crate, () => [0.95, 0.95, 0.95] as [number, number, number]);
          push(mats.painted, crate);
          addCollider({ minX: px - 0.38, maxX: px + 0.38, minZ: pz - 0.38, maxZ: pz + 0.38 });
        }
      }

      // ---- sector B: pipes, trays, ducts, panels, barrels ----
      if (z.id === "B") {
        const dir = wallDir(maze, i, j);
        const hasW = dir.lengthSq() > 0.1;
        const alongZ = Math.abs(dir.x) > 0.5;
        if (hasW && zr.bool(0.5)) {
          for (let n = 0; n < 2; n++) {
            const rad = 0.06 + n * 0.03;
            const pipe = applyWorldUV(new THREE.CylinderGeometry(rad, rad, CELL - WALL_T, 10), 0.8);
            pipe.rotateZ(Math.PI / 2);
            if (alongZ) pipe.rotateY(Math.PI / 2);
            const out = FACE - rad - 0.05;
            pipe.translate(x + dir.x * out, 2.95 + n * 0.24, zz + dir.z * out);
            applyShade(pipe, white);
            push(mats.rust, pipe);
          }
          const tray = boxUV(alongZ ? 0.34 : CELL - WALL_T, 0.05, alongZ ? CELL - WALL_T : 0.34, 1.2);
          tray.translate(x + dir.x * (FACE - 0.19), 3.5, zz + dir.z * (FACE - 0.19));
          applyShade(tray, white);
          push(mats.darkMetal, tray);
        }
        if (zr.bool(0.3)) {
          // duct follows the corridor axis just under the ceiling
          const ax = orient(i, j);
          const duct = boxUV(ax === "x" ? CELL : 0.5, 0.4, ax === "x" ? 0.5 : CELL, 1.6);
          duct.translate(x + (ax === "x" ? 0 : 0.8), z.ceiling - 0.3, zz + (ax === "x" ? 0.8 : 0));
          applyShade(duct, white);
          push(mats.painted, duct);
        }
        if (hasW && zr.bool(0.16)) {
          // control panel bolted to the wall face
          const pd = 0.18;
          const px = x + dir.x * (FACE - pd / 2);
          const pz = zz + dir.z * (FACE - pd / 2);
          const panelBox = boxUV(alongZ ? pd : 0.7, 0.9, alongZ ? 0.7 : pd, 1.2);
          panelBox.translate(px, 1.45, pz);
          applyShade(panelBox, white);
          push(mats.painted, panelBox);
          const hx = alongZ ? pd / 2 : 0.35;
          const hz = alongZ ? 0.35 : pd / 2;
          addCollider({ minX: px - hx, maxX: px + hx, minZ: pz - hz, maxZ: pz + hz });
        }
        if (hasW && zr.bool(0.1)) {
          const side = zr.sign() * 1.1;
          const px = x + dir.x * (FACE - 0.34) + Math.abs(dir.z) * side;
          const pz = zz + dir.z * (FACE - 0.34) + Math.abs(dir.x) * side;
          const barrel = applyWorldUV(new THREE.CylinderGeometry(0.3, 0.3, 0.9, 14), 1.6);
          barrel.translate(px, 0.45, pz);
          applyShade(barrel, (_px, py) => [1 - 0.15 * (1 - py), 1, 1] as [number, number, number]);
          push(mats.rust, barrel);
          addCollider({ minX: px - 0.31, maxX: px + 0.31, minZ: pz - 0.31, maxZ: pz + 0.31 });
        }
        if (hasW && zr.bool(0.1)) {
          const tex = makeSignTexture(
            zr.pick([
              ["DANGER", "HIGH VOLTAGE"],
              ["SECTOR B", "AUTHORISED ONLY"],
              ["NO ENTRY", "PUMP ROOM"],
              ["CAUTION", "WET FLOOR"],
            ]),
            "warn",
          );
          const sign = new THREE.Mesh(
            new THREE.PlaneGeometry(0.55, 0.55),
            new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, metalness: 0.2, transparent: true }),
          );
          sign.position.set(x + dir.x * (FACE - 0.02), 1.75, zz + dir.z * (FACE - 0.02));
          sign.lookAt(sign.position.x - dir.x, 1.75, sign.position.z - dir.z);
          root.add(sign);
        }
      }

      // ---- sector C: undergrowth detail ----
      if (z.id === "C") {
        const tufts = Math.round(9 * quality.foliageDensity);
        const leafGeos: THREE.BufferGeometry[] = [];
        for (let n = 0; n < tufts; n++) {
          const a = zr.next() * Math.PI * 2;
          const r = zr.range(0.2, 1.55);
          const px = x + Math.cos(a) * r;
          const pz = zz + Math.sin(a) * r;
          const s = zr.range(0.35, 0.95);
          const g = new THREE.PlaneGeometry(s, s * 0.8);
          g.translate(0, s * 0.35, 0);
          g.rotateY(zr.next() * Math.PI);
          g.translate(px, 0, pz);
          leafGeos.push(g);
          if (zr.bool(0.3)) {
            const g2 = g.clone();
            g2.rotateY(Math.PI / 2);
            leafGeos.push(g2);
          }
        }
        if (leafGeos.length) {
          const merged = applyShade(mergeGeosSafe(leafGeos), () => [1, 1, 1] as [number, number, number]);
          push(mats.leaf, merged);
        }
        if (zr.bool(0.5)) {
          const stone = applyWorldUV(new THREE.DodecahedronGeometry(zr.range(0.08, 0.22), 0), 0.6);
          stone.translate(x + zr.range(-1.4, 1.4), 0.06, zz + zr.range(-1.4, 1.4));
          applyShade(stone, () => [1, 1, 1]);
          push(mats.floorE, stone);
        }
        if (zr.bool(0.25)) {
          const root2 = new THREE.CylinderGeometry(0.035, 0.05, zr.range(1.2, 2.6), 6);
          const g = applyWorldUV(root2, 0.6);
          g.rotateZ(Math.PI / 2);
          g.rotateY(zr.next() * Math.PI);
          g.translate(x + zr.range(-1.2, 1.2), 0.05, zz + zr.range(-1.2, 1.2));
          applyShade(g, () => [1, 1, 1]);
          push(mats.dirt, g);
        }
      }

      // ---- sector D: submerged debris ----
      if (z.id === "D") {
        if (zr.bool(0.2)) {
          const deb = applyWorldUV(new THREE.BoxGeometry(zr.range(0.3, 0.8), 0.2, zr.range(0.3, 0.7)), 1);
          deb.rotateY(zr.next() * 3);
          deb.translate(x + zr.range(-1.2, 1.2), 0.12, zz + zr.range(-1.2, 1.2));
          applyShade(deb, () => [0.8, 0.9, 0.88]);
          push(mats.rust, deb);
        }
        if (zr.bool(0.12)) {
          const dir = wallDir(maze, i, j);
          const algae = new THREE.Mesh(
            new THREE.PlaneGeometry(1.4, 0.5),
            new THREE.MeshStandardMaterial({ color: 0x2b3a26, roughness: 1, transparent: true, opacity: 0.55 }),
          );
          algae.position.set(x + dir.x * (CELL / 2 - 0.26), 0.35, zz + dir.z * (CELL / 2 - 0.26));
          algae.lookAt(algae.position.x - dir.x, 0.35, algae.position.z - dir.z);
          root.add(algae);
        }
      }

      // ---- sector E: rubble, arches on pilasters ----
      if (z.id === "E") {
        const wx0 = solid(maze, { axis: "V", i, j });
        const wx1 = solid(maze, { axis: "V", i: i + 1, j });
        const wz0 = solid(maze, { axis: "H", i, j });
        const wz1 = solid(maze, { axis: "H", i, j: j + 1 });
        const spanX = wx0 && wx1 && !wz0 && !wz1; // straight corridor running along z
        const spanZ = wz0 && wz1 && !wx0 && !wx1; // straight corridor running along x
        if (!isRoom && (i * 3 + j) % 3 === 0 && (spanX || spanZ)) {
          const rib = archRib(CELL - WALL_T + 0.1, 1.0, 0.5, 0.3, 12);
          if (spanZ) rib.rotateY(Math.PI / 2);
          rib.translate(x, 2.25, zz);
          applyShade(rib, () => [0.95, 0.95, 0.95] as [number, number, number]);
          push(mats.wallE, rib);
          for (const s of [-1, 1]) {
            const pil = boxUV(spanX ? 0.14 : 0.5, 2.25, spanX ? 0.5 : 0.14, 1.2);
            const px = x + (spanX ? s * (FACE - 0.07) : 0);
            const pz = zz + (spanZ ? s * (FACE - 0.07) : 0);
            pil.translate(px, 1.125, pz);
            applyShade(pil, (_px, py) => {
              const v = 0.7 + 0.3 * Math.min(1, py / 1.2);
              return [v, v, v] as [number, number, number];
            });
            push(mats.wallE, pil);
            const hx = spanX ? 0.07 : 0.25;
            const hz = spanX ? 0.25 : 0.07;
            addCollider({ minX: px - hx, maxX: px + hx, minZ: pz - hz, maxZ: pz + hz });
          }
        }
        if (zr.bool(0.22)) {
          const rub = applyWorldUV(new THREE.BoxGeometry(zr.range(0.2, 0.45), zr.range(0.08, 0.2), zr.range(0.2, 0.4)), 0.9);
          rub.rotateX(zr.range(-0.2, 0.2));
          rub.rotateY(zr.next() * 3);
          rub.translate(x + zr.range(-1.3, 1.3), 0.08, zz + zr.range(-1.3, 1.3));
          applyShade(rub, white);
          push(mats.wallE, rub);
        }
      }

      // ---- one piece of furniture per room, against a wall ----
      if (isRoom && z.id !== "C") {
        const room = maze.rooms.find((r) => i >= r.i0 && i < r.i0 + r.w && j >= r.j0 && j < r.j0 + r.h);
        if (room && i === room.i0 && j === room.j0 && !room.label.startsWith("SUBLEVEL")) {
          const dir = wallDir(maze, i, j);
          if (dir.lengthSq() > 0.1) {
            const alongZ = Math.abs(dir.x) > 0.5;
            const bx = x + dir.x * (FACE - 0.32);
            const bz = zz + dir.z * (FACE - 0.32);
            const topG = boxUV(alongZ ? 0.6 : 1.6, 0.06, alongZ ? 1.6 : 0.6, 1.4);
            topG.translate(bx, 0.9, bz);
            applyShade(topG, white);
            push(mats.dirt, topG);
            for (const a of [-0.72, 0.72])
              for (const c of [-0.24, 0.24]) {
                const leg = boxUV(0.06, 0.88, 0.06, 1);
                leg.translate(bx + (alongZ ? c : a), 0.44, bz + (alongZ ? a : c));
                applyShade(leg, white);
                push(mats.darkMetal, leg);
              }
            const hx = alongZ ? 0.3 : 0.8;
            const hz = alongZ ? 0.8 : 0.3;
            addCollider({ minX: bx - hx, maxX: bx + hx, minZ: bz - hz, maxZ: bz + hz });
          }
        }
      }
    }
  }

  if (puddles.length) {
    const pm = new THREE.Mesh(mergeGeos(puddles), mats.water);
    pm.renderOrder = 1;
    root.add(pm);
  }

  // dead foliage / tuft wind
  enableWind(mats.leaf, 1.4);
  enableWind(mats.hedgeSide, 1.0);


  /* ------------------- STARTING CHAMBER DRESSING ------------------ */
  {
    const [sx, sz] = cellCenter(maze.spawn[0], maze.spawn[1]);
    const msg = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 0.6),
      new THREE.MeshStandardMaterial({ map: makeMarkTexture("chalk", "the walls lie"), transparent: true, roughness: 1 }),
    );
    // chalk on the wall face (only if that wall actually exists)
    msg.position.set(sx - 0.9, 1.6, sz - FACE + 0.015);
    if (solid(maze, { axis: "H", i: maze.spawn[0], j: maze.spawn[1] })) root.add(msg);
    // place crate only if it doesn't obstruct any pathway
    const crateX = sx + 1.3;
    const crateZ = sz - 1.1;
    if (circleFree({ colliders, grid } as BuiltLevel, crateX, crateZ, 0.5)) {
      const crate = new THREE.Mesh(applyWorldUV(new THREE.BoxGeometry(0.8, 0.7, 0.7), 1.2), mats.painted);
      crate.position.set(crateX, 0.35, crateZ);
      crate.rotation.y = 0.4;
      crate.castShadow = true;
      crate.receiveShadow = true;
      root.add(crate);
      addCollider({ minX: crateX - 0.45, maxX: crateX + 0.45, minZ: crateZ - 0.4, maxZ: crateZ + 0.4 });
    }
    const pallet = new THREE.Mesh(applyWorldUV(new THREE.BoxGeometry(1.2, 0.12, 0.8), 1.4), mats.dirt);
    pallet.position.set(sx - 1.3, 0.06, sz + 1.2);
    pallet.rotation.y = 0.2;
    root.add(pallet);
  }

  /* ------------------------ EXIT VESTIBULE ------------------------ */
  const exitEdge = maze.exitEdge;
  const ew = wallTransform(exitEdge);
  const outward = exitEdge.axis === "V"
    ? new THREE.Vector3(exitEdge.i === 0 ? -1 : 1, 0, 0)
    : new THREE.Vector3(0, 0, exitEdge.j === 0 ? -1 : 1);
  const exitOutside = new THREE.Vector3(ew.x + outward.x * 6.5, 0, ew.z + outward.z * 6.5);
  const len = 13;
  const wid = CELL + 1.2;
  const exitTrigger = (p: THREE.Vector3) => {
    const dx = p.x - ew.x;
    const dz = p.z - ew.z;
    const ahead = dx * outward.x + dz * outward.z; // metres beyond the gate line
    const lateral = Math.abs(dx * (-outward.z) + dz * outward.x);
    return ahead > 1.6 && ahead < 13 && lateral < wid / 2;
  };
  {
    const g: THREE.BufferGeometry[] = [];
    const sizeX = outward.x !== 0 ? len : wid;
    const sizeZ = outward.z !== 0 ? len : wid;
    // floor
    const fl = applyWorldUV(new THREE.PlaneGeometry(sizeX, sizeZ), 2.6);
    fl.rotateX(-Math.PI / 2);
    fl.translate(ew.x + outward.x * (len / 2), 0, ew.z + outward.z * (len / 2));
    g.push(fl);
    // ceiling
    const ce = applyWorldUV(new THREE.PlaneGeometry(sizeX, sizeZ), 3);
    ce.rotateX(Math.PI / 2);
    ce.translate(ew.x + outward.x * (len / 2), 3.6, ew.z + outward.z * (len / 2));
    g.push(ce);

    // side walls
    for (const s of [-1, 1]) {
      const off = (wid / 2) * s;
      const wallW = outward.x !== 0 ? len : 0.4;
      const wallD = outward.z !== 0 ? len : 0.4;
      const side = applyWorldUV(new THREE.BoxGeometry(wallW, 3.6, wallD), 2.4);
      const sidePosX = ew.x + outward.x * (len / 2) + (outward.x !== 0 ? 0 : off);
      const sidePosZ = ew.z + outward.z * (len / 2) + (outward.z !== 0 ? 0 : off);
      side.translate(sidePosX, 1.8, sidePosZ);
      g.push(side);
      addCollider({
        minX: sidePosX - wallW / 2,
        maxX: sidePosX + wallW / 2,
        minZ: sidePosZ - wallD / 2,
        maxZ: sidePosZ + wallD / 2,
      });
    }

    // far wall with a glowing doorway
    const farW = outward.x !== 0 ? 0.4 : wid;
    const farD = outward.z !== 0 ? 0.4 : wid;
    const farPosX = ew.x + outward.x * len;
    const farPosZ = ew.z + outward.z * len;
    const far = applyWorldUV(new THREE.BoxGeometry(farW, 3.6, farD), 2.4);
    far.translate(farPosX, 1.8, farPosZ);
    g.push(far);
    addCollider({
      minX: farPosX - farW / 2,
      maxX: farPosX + farW / 2,
      minZ: farPosZ - farD / 2,
      maxZ: farPosZ + farD / 2,
    });

    const vest = new THREE.Mesh(
      mergeGeos(g.map((gg) => applyShade(gg, (_px, py) => [0.6 + 0.4 * Math.min(1, py / 3), 1, 1] as [number, number, number]))),
      mats.wallA
    );
    root.add(vest);

    // daylight panel at the far end
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 3.0),
      new THREE.MeshBasicMaterial({ color: 0xdfeaf2, toneMapped: false }),
    );
    glow.position.set(ew.x + outward.x * (len - 0.25), 1.5, ew.z + outward.z * (len - 0.25));
    glow.lookAt(glow.position.x - outward.x, 1.5, glow.position.z - outward.z);
    root.add(glow);

    // grass strip leading out
    const grassW = outward.x !== 0 ? 4 : wid;
    const grassD = outward.z !== 0 ? 4 : wid;
    const grass = new THREE.Mesh(applyWorldUV(new THREE.PlaneGeometry(grassW, grassD), 2.2), mats.soil);
    grass.rotateX(-Math.PI / 2);
    grass.position.set(ew.x + outward.x * (len - 1.5), 0.02, ew.z + outward.z * (len - 1.5));
    root.add(grass);
    lamps.push({
      pos: new THREE.Vector3(ew.x + outward.x * 3, 3.3, ew.z + outward.z * 3),
      color: 0xdce8f0,
      power: 2.2,
      zone: wallOfEdge(exitEdge),
      kind: "strip",
      flicker: 0,
      on: true,
      seed: 5,
    });
  }

  /* --------------------------- SUN & SKY -------------------------- */
  const cZone = ZONES[2];
  const sunCenter = new THREE.Vector3(
    cZone.x0 * CELL + ((cZone.x1 - cZone.x0 + 1) * CELL) / 2,
    0,
    cZone.z0 * CELL + ((cZone.z1 - cZone.z0 + 1) * CELL) / 2,
  );
  const sun = new THREE.DirectionalLight(0xfff0d8, 3.2);
  sun.position.set(sunCenter.x + 26, 40, sunCenter.z - 18);
  sun.target.position.copy(sunCenter);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 120;
  const sc = sun.shadow.camera as THREE.OrthographicCamera;
  sc.left = -40;
  sc.right = 40;
  sc.top = 30;
  sc.bottom = -30;
  sc.updateProjectionMatrix();
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.06;
  sun.intensity = 0;
  root.add(sun, sun.target);

  const hemi = new THREE.HemisphereLight(0xbfd6e4, 0x2a2b22, 0);
  root.add(hemi);

  const skyGeo = new THREE.SphereGeometry(90, 24, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { top: { value: new THREE.Color(0x7fa8c8) }, bottom: { value: new THREE.Color(0xd8e2e0) } },
    vertexShader: `varying float vY; void main(){ vY = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 top; uniform vec3 bottom; varying float vY;
      void main(){ float t = clamp(vY*1.2+0.15,0.0,1.0); gl_FragColor = vec4(mix(bottom, top, t),1.0); }`,
  });
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.position.copy(sunCenter);
  sky.position.y = 6;
  root.add(sky);

  /* --------------------------- BUILD BATCHES ---------------------- */
  const meshes: THREE.Mesh[] = [];
  for (const [mat, geos] of batches) {
    if (!geos.length) continue;
    const merged = mergeGeos(geos);
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = mat !== mats.hedgeSide;
    mesh.receiveShadow = true;
    root.add(mesh);
    meshes.push(mesh);
    disposables.push(merged);
  }

  const update = (dt: number, t: number) => {
    // water ripples
    const wm = mats.water;
    if (wm.normalMap) {
      wm.normalMap.offset.x = (t * 0.013) % 1;
      wm.normalMap.offset.y = (t * 0.021) % 1;
    }
    void dt;
  };

  const dispose = () => {
    for (const m of meshes) m.geometry.dispose();
    for (const d of disposables) d.dispose();
    root.traverse((o) => {
      const any = o as THREE.Mesh;
      if (any.geometry) any.geometry.dispose();
    });
    root.clear();
  };

  const [sxw, szw] = cellCenter(maze.spawn[0], maze.spawn[1]);
  return {
    root,
    colliders,
    grid,
    lamps,
    doors,
    interactables,
    waterCells,
    spawn: new THREE.Vector3(sxw, 1.65, szw),
    spawnYaw: maze.spawnYaw,
    exitOutside,
    exitDoor,
    exitTrigger,
    sun,
    hemi,
    sky,
    sunCenter,
    audioSpots,
    update,
    dispose,
  };
}

/** a wall that physically exists: doorway edges count as openings */
function solid(maze: MazeData, e: Edge): boolean {
  return hasWall(maze, e) && !maze.doors.some((d) => d.axis === e.axis && d.i === e.i && d.j === e.j);
}

/** direction from a cell centre towards a solid wall (for wall-mounted props) */
function wallDir(maze: MazeData, i: number, j: number): THREE.Vector3 {
  const opts: [THREE.Vector3, Edge][] = [
    [new THREE.Vector3(0, 0, -1), { axis: "H", i, j }],
    [new THREE.Vector3(0, 0, 1), { axis: "H", i, j: j + 1 }],
    [new THREE.Vector3(-1, 0, 0), { axis: "V", i, j }],
    [new THREE.Vector3(1, 0, 0), { axis: "V", i: i + 1, j }],
  ];
  const walls = opts.filter(([, e]) => solid(maze, e));
  if (!walls.length) return new THREE.Vector3();
  return walls[0][0].clone();
}

function mergeGeosSafe(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  return mergeGeos(geos);
}

/* ------------------------------------------------------------------ *
 * Collision probes: verify that the physical level matches the maze graph
 * ------------------------------------------------------------------ */
function nearbyColliders(level: BuiltLevel, x: number, z: number, fn: (c: Collider) => boolean): boolean {
  const ci = Math.max(0, Math.min(GRID - 1, Math.floor(x / CELL)));
  const cj = Math.max(0, Math.min(GRID - 1, Math.floor(z / CELL)));
  for (let dj = -1; dj <= 1; dj++)
    for (let di = -1; di <= 1; di++) {
      const i = ci + di;
      const j = cj + dj;
      if (i < 0 || j < 0 || i >= GRID || j >= GRID) continue;
      const list = level.grid.get(idx(i, j));
      if (!list) continue;
      for (const k of list) {
        const c = level.colliders[k];
        if (c.minX > c.maxX) continue;
        if (fn(c)) return true;
      }
    }
  return false;
}

/** Is a circle of radius r at (x, z) free of every collider? */
export function circleFree(level: BuiltLevel, x: number, z: number, r = PLAYER_R): boolean {
  return !nearbyColliders(level, x, z, (c) => {
    const px = Math.max(c.minX, Math.min(x, c.maxX));
    const pz = Math.max(c.minZ, Math.min(z, c.maxZ));
    return (x - px) ** 2 + (z - pz) ** 2 < r * r;
  });
}

export function pointBlocked(level: BuiltLevel, x: number, z: number): boolean {
  return nearbyColliders(level, x, z, (c) => x >= c.minX && x <= c.maxX && z >= c.minZ && z <= c.maxZ);
}

export interface ProbeReport {
  ok: boolean;
  problems: string[];
  openEdges: number;
  wallEdges: number;
}

/** Sweeps the player's collision circle along every open passage of the
 *  maze graph (must be clear) and samples every wall (must be solid). */
export function probeLevel(level: BuiltLevel, maze: MazeData): ProbeReport {
  const problems: string[] = [];
  let openEdges = 0;
  let wallEdges = 0;
  if (!circleFree(level, level.spawn.x, level.spawn.z)) problems.push("spawn overlaps geometry");
  const sweep = (ax: number, az: number, bx: number, bz: number) => {
    for (let t = 0; t <= 1.0001; t += 0.04) if (!circleFree(level, ax + (bx - ax) * t, az + (bz - az) * t)) return false;
    return true;
  };
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const [ax, az] = cellCenter(i, j);
      for (const [ni, nj, e] of [
        [i + 1, j, { axis: "V", i: i + 1, j }],
        [i, j + 1, { axis: "H", i, j: j + 1 }],
      ] as [number, number, Edge][]) {
        if (ni >= GRID || nj >= GRID) continue;
        const passable = !hasWall(maze, e) || maze.doors.some((d) => d.axis === e.axis && d.i === e.i && d.j === e.j);
        const [bx, bz] = cellCenter(ni, nj);
        if (passable) {
          openEdges++;
          if (!sweep(ax, az, bx, bz)) problems.push(`passage ${i},${j} -> ${ni},${nj} is physically blocked`);
        } else {
          wallEdges++;
          const m = wallTransform(e);
          if (!pointBlocked(level, m.x, m.z)) problems.push(`wall ${e.axis}${e.i},${e.j} has no collision`);
        }
      }
    }
  }
  // outer boundary must be solid everywhere except the exit gate
  for (let k = 0; k < GRID; k++) {
    for (const e of [
      { axis: "H", i: k, j: 0 },
      { axis: "H", i: k, j: GRID },
      { axis: "V", i: 0, j: k },
      { axis: "V", i: GRID, j: k },
    ] as Edge[]) {
      if (e.axis === maze.exitEdge.axis && e.i === maze.exitEdge.i && e.j === maze.exitEdge.j) continue;
      const m = wallTransform(e);
      if (!pointBlocked(level, m.x, m.z)) problems.push(`boundary ${e.axis}${e.i},${e.j} is open`);
    }
  }
  // exit: walkable from its cell to beyond the gate; trigger only out there
  const [ex, ez] = cellCenter(maze.exitCell[0], maze.exitCell[1]);
  if (!sweep(ex, ez, level.exitOutside.x, level.exitOutside.z)) problems.push("exit gate is physically blocked");
  if (level.exitTrigger(new THREE.Vector3(ex, 0, ez))) problems.push("exit trigger fires inside the maze");
  if (!level.exitTrigger(level.exitOutside)) problems.push("exit trigger does not cover the vestibule");
  return { ok: problems.length === 0, problems, openEdges, wallEdges };
}
