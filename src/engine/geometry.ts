import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** Recompute UVs from world-space position so tiled textures never seam
 *  between neighbouring wall segments and always run the right way. */
export function applyWorldUV(geo: THREE.BufferGeometry, tile: number): THREE.BufferGeometry {
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const nor = geo.getAttribute("normal") as THREE.BufferAttribute;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const nx = Math.abs(nor.getX(i));
    const ny = Math.abs(nor.getY(i));
    const nz = Math.abs(nor.getZ(i));
    let u: number;
    let v: number;
    if (nx >= ny && nx >= nz) {
      u = z / tile;
      v = y / tile;
    } else if (ny >= nx && ny >= nz) {
      u = x / tile;
      v = z / tile;
    } else {
      u = x / tile;
      v = y / tile;
    }
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  return geo;
}

/** Per-vertex tint. Used for baked contact shadows, grime and variation. */
export function applyShade(
  geo: THREE.BufferGeometry,
  fn: (x: number, y: number, z: number, ny: number) => [number, number, number],
): THREE.BufferGeometry {
  const pos = geo.getAttribute("position") as THREE.BufferAttribute;
  const nor = geo.getAttribute("normal") as THREE.BufferAttribute;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const [r, g, b] = fn(pos.getX(i), pos.getY(i), pos.getZ(i), nor.getY(i));
    col[i * 3] = r;
    col[i * 3 + 1] = g;
    col[i * 3 + 2] = b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  return geo;
}

export function boxUV(w: number, h: number, d: number, tile: number): THREE.BufferGeometry {
  return applyWorldUV(new THREE.BoxGeometry(w, h, d), tile);
}

/** Merge static geometry into one draw call. Normalises inputs first (indexed vs
 *  non-indexed, missing colour/uv) so a single odd piece can never make the
 *  whole batch silently disappear. */
export function mergeGeos(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  let filtered = geos.filter((g) => g.getAttribute("position")?.count);
  if (!filtered.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0], 3));
    return g;
  }
  const mixedIndex = filtered.some((g) => !!g.index) && filtered.some((g) => !g.index);
  if (mixedIndex) {
    filtered = filtered.map((g) => {
      if (!g.index) return g;
      const n = g.toNonIndexed();
      g.dispose();
      return n;
    });
  }
  const needColor = filtered.some((g) => g.getAttribute("color"));
  const needUv = filtered.some((g) => g.getAttribute("uv"));
  for (const g of filtered) {
    const count = g.getAttribute("position").count;
    if (!g.getAttribute("normal")) g.computeVertexNormals();
    if (needColor && !g.getAttribute("color")) g.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(count * 3).fill(1), 3));
    if (needUv && !g.getAttribute("uv")) g.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(count * 2), 2));
    for (const name of Object.keys(g.attributes)) {
      if (!["position", "normal", "uv", "color"].includes(name)) g.deleteAttribute(name);
    }
  }
  const merged = mergeGeometries(filtered, false);
  if (!merged) throw new Error("mergeGeos: incompatible geometry batch");
  filtered.forEach((g) => g.dispose());
  return merged;
}

/** Cheap smooth 2D value noise (used for large-scale floor/prop variation). */
export function noise2(x: number, z: number, seed = 1): number {
  const xi = Math.floor(x);
  const zi = Math.floor(z);
  const h = (a: number, b: number) => {
    let n = (a * 374761393 + b * 668265263 + seed * 1442695041) | 0;
    n = (n ^ (n >>> 13)) * 1274126177;
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const tx = x - xi;
  const tz = z - zi;
  const sx = tx * tx * (3 - 2 * tx);
  const sz = tz * tz * (3 - 2 * tz);
  const a = h(xi, zi);
  const b = h(xi + 1, zi);
  const c = h(xi, zi + 1);
  const d = h(xi + 1, zi + 1);
  return (a + (b - a) * sx) * (1 - sz) + (c + (d - c) * sx) * sz;
}

export function fbm2(x: number, z: number, seed = 1, oct = 3): number {
  let v = 0;
  let amp = 0.5;
  let f = 1;
  for (let i = 0; i < oct; i++) {
    v += noise2(x * f, z * f, seed + i * 17) * amp;
    amp *= 0.5;
    f *= 2;
  }
  return v;
}

/** Semi-circular arch rib (for the older passages). */
export function archRib(span: number, rise: number, depth: number, thick: number, seg = 14): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  const r = span / 2;
  const steps = seg;
  const outer: THREE.Vector2[] = [];
  const inner: THREE.Vector2[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = Math.PI * t;
    // centred on x = 0 so the rib springs from both walls symmetrically
    const ox = Math.cos(a) * r;
    const oy = Math.sin(a) * rise;
    const ir = r - thick;
    const ix = Math.cos(a) * ir;
    const iy = Math.sin(a) * Math.max(0.05, rise - thick * (rise / r));
    outer.push(new THREE.Vector2(ox, oy));
    inner.push(new THREE.Vector2(ix, iy));
  }
  shape.moveTo(outer[0].x, outer[0].y);
  for (const p of outer) shape.lineTo(p.x, p.y);
  for (let i = inner.length - 1; i >= 0; i--) shape.lineTo(inner[i].x, inner[i].y);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 8 });
  geo.translate(0, 0, -depth / 2);
  applyWorldUV(geo, 1.2);
  return geo;
}

/** Hollow box "sleeve" used for tunnel / doorway linings. */
/** Door lining: two jambs and a lintel, no sill (nothing to trip the player). */
export function frame(w: number, h: number, d: number, t: number, tile: number): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = [];
  const add = (bw: number, bh: number, bd: number, x: number, y: number, z: number) => {
    const g = boxUV(bw, bh, bd, tile);
    g.translate(x, y, z);
    geos.push(g);
  };
  add(t, h, d, -w / 2 + t / 2, h / 2, 0);
  add(t, h, d, w / 2 - t / 2, h / 2, 0);
  add(w, t, d, 0, h - t / 2, 0);
  return mergeGeos(geos);
}
