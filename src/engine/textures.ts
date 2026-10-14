import * as THREE from "three";
import { Rng } from "./rng";

/* ------------------------------------------------------------------ *
 * Small procedural helpers (value-noise fractals, height -> normal)
 * ------------------------------------------------------------------ */
function valueNoise(w: number, h: number, rng: Rng, cells: number): Float32Array {
  const gw = cells + 1;
  const gh = cells + 1;
  const g = new Float32Array(gw * gh);
  for (let i = 0; i < g.length; i++) g[i] = rng.next();
  const out = new Float32Array(w * h);
  const smooth = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < h; y++) {
    const fy = (y / h) * cells;
    const y0 = Math.floor(fy);
    const ty = smooth(fy - y0);
    for (let x = 0; x < w; x++) {
      const fx = (x / w) * cells;
      const x0 = Math.floor(fx);
      const tx = smooth(fx - x0);
      const a = g[y0 * gw + x0];
      const b = g[y0 * gw + x0 + 1];
      const c = g[(y0 + 1) * gw + x0];
      const d = g[(y0 + 1) * gw + x0 + 1];
      out[y * w + x] = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
    }
  }
  return out;
}

function fractal(w: number, h: number, rng: Rng, octaves = 5, base = 4, gain = 0.5): Float32Array {
  const out = new Float32Array(w * h);
  let amp = 1;
  let total = 0;
  let cells = base;
  for (let o = 0; o < octaves; o++) {
    const n = valueNoise(w, h, rng.fork(o * 31 + 7), cells);
    for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
    total += amp;
    amp *= gain;
    cells *= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

function heightToNormal(height: Float32Array, size: number, strength: number): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const at = (x: number, y: number) => height[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      let nx = -dx;
      let ny = -dy;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      const o = (y * size + x) * 4;
      data[o] = (nx * 0.5 + 0.5) * 255;
      data[o + 1] = (ny * 0.5 + 0.5) * 255;
      data[o + 2] = (nz / len) * 255;
      data[o + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

function greyToTexture(v: Float32Array, size: number, lo = 0, hi = 1): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < v.length; i++) {
    const g = Math.max(0, Math.min(255, ((v[i] - lo) / (hi - lo || 1)) * 255));
    const o = i * 4;
    data[o] = data[o + 1] = data[o + 2] = g;
    data[o + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

function canvasTex(size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void, srgb = true): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export interface Surface {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
}

/* ------------------------------------------------------------------ *
 * Surface library
 * ------------------------------------------------------------------ */
const cache = new Map<string, Surface>();
const jobs: { name: string; build: () => Surface }[] = [];

function register(name: string, build: () => Surface) {
  jobs.push({ name, build });
}

function surf(
  size: number,
  albedo: Uint8ClampedArray,
  height: Float32Array,
  rough: Float32Array,
  normalStrength: number,
): Surface {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  img.data.set(albedo);
  ctx.putImageData(img, 0, 0);
  const map = new THREE.CanvasTexture(c);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  return {
    map,
    normalMap: heightToNormal(height, size, normalStrength),
    roughnessMap: greyToTexture(rough, size),
  };
}

class Px {
  data: Uint8ClampedArray;
  constructor(public size: number) {
    this.data = new Uint8ClampedArray(size * size * 4);
  }
  set(x: number, y: number, r: number, g: number, b: number) {
    const o = (y * this.size + x) * 4;
    this.data[o] = r;
    this.data[o + 1] = g;
    this.data[o + 2] = b;
    this.data[o + 3] = 255;
  }
  /** additive/multiplicative blend of a scalar multiplier */
  mul(x: number, y: number, m: number, dr = 0, dg = 0, db = 0) {
    const o = (y * this.size + x) * 4;
    this.data[o] = this.data[o] * m + dr;
    this.data[o + 1] = this.data[o + 1] * m + dg;
    this.data[o + 2] = this.data[o + 2] * m + db;
  }
}

/* ---------------------------- CONCRETE ---------------------------- */
register("concrete", () => {
  const S = 512;
  const rng = new Rng(101);
  const px = new Px(S);
  const height = new Float32Array(S * S);
  const rough = new Float32Array(S * S);
  const base = fractal(S, S, rng.fork(1), 5, 3, 0.55);
  const fine = fractal(S, S, rng.fork(2), 6, 24, 0.6);
  const stain = fractal(S, S, rng.fork(3), 4, 2, 0.5);

  for (let i = 0; i < S * S; i++) {
    const x = i % S;
    const y = (i / S) | 0;
    const shade = 0.86 + base[i] * 0.2 + (fine[i] - 0.5) * 0.09 + (stain[i] - 0.5) * 0.22;
    const r = 132 * shade;
    const g = 133 * shade;
    const b = 128 * shade;
    px.set(x, y, r, g, b);
    height[i] = base[i] * 0.5 + fine[i] * 0.5;
    rough[i] = 0.78 + (fine[i] - 0.5) * 0.16 + (stain[i] - 0.5) * 0.1;
  }
  // pores
  for (let n = 0; n < 5200; n++) {
    const x = rng.int(0, S - 1);
    const y = rng.int(0, S - 1);
    const rad = rng.range(0.6, 1.9);
    const dark = rng.range(0.72, 0.9);
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        if (dx * dx + dy * dy > rad * rad) continue;
        const xx = (x + dx + S) % S;
        const yy = (y + dy + S) % S;
        px.mul(xx, yy, dark);
        height[yy * S + xx] -= 0.06 * (1 - (dx * dx + dy * dy) / (rad * rad + 1));
      }
  }
  // hairline cracks (random walks, both albedo and height)
  for (let n = 0; n < 26; n++) {
    let x = rng.next() * S;
    let y = rng.next() * S;
    let ang = rng.next() * Math.PI * 2;
    const steps = rng.int(60, 220);
    const depth = rng.range(0.5, 1);
    for (let s = 0; s < steps; s++) {
      ang += rng.gauss(0, 0.22);
      x += Math.cos(ang) * 1.1;
      y += Math.sin(ang) * 1.1;
      const xi = ((x % S) + S) % S;
      const yi = ((y % S) + S) % S;
      const w = 1 - s / steps;
      px.mul(xi | 0, yi | 0, 1 - 0.5 * depth * w, -14 * w, -14 * w, -13 * w);
      height[(yi | 0) * S + (xi | 0)] -= 0.09 * depth * w;
      // faint branch
      if (rng.bool(0.06)) {
        const bx = xi + rng.int(-2, 2);
        const by = yi + rng.int(-2, 2);
        px.mul(bx % S, by % S, 0.9);
        height[(by % S) * S + (bx % S)] -= 0.03;
      }
    }
  }
  // water stains: vertical streaks running down
  for (let n = 0; n < 9; n++) {
    const cx = rng.next() * S;
    const width = rng.range(6, 30);
    const startY = rng.next() * S * 0.6;
    const len = rng.range(S * 0.25, S * 0.9);
    const strength = rng.range(0.06, 0.2);
    for (let yy = 0; yy < len; yy++) {
      const y = ((startY + yy) % S) | 0;
      const fade = 1 - yy / len;
      for (let xx = -width; xx <= width; xx++) {
        const x = ((cx + xx) % S + S) % S;
        const fall = Math.exp(-(xx * xx) / (width * width * 0.35));
        px.mul(x, y, 1 - strength * fall * fade, -2 * fall, -1 * fall, 1 * fall);
        rough[y * S + x] -= 0.16 * fall * fade;
      }
    }
  }
  // formwork seams (construction joints)
  for (const yy of [0, S >> 1]) {
    for (let x = 0; x < S; x++) {
      const y = (yy + x) % S;
      px.mul(x, y, 0.9, -8, -8, -7);
      px.mul(x, (y + 1) % S, 1.06, 8, 8, 8);
      height[y * S + x] -= 0.08;
      height[((y + 1) % S) * S + x] += 0.05;
      rough[y * S + x] += 0.08;
    }
  }
  for (const xx of [0, S >> 1]) {
    for (let y = 0; y < S; y++) {
      px.mul(xx, y, 0.92, -6, -6, -5);
      height[y * S + xx] -= 0.05;
    }
  }
  for (let i = 0; i < rough.length; i++) rough[i] = Math.max(0.35, Math.min(1, rough[i]));
  return surf(S, px.data, height, rough, 2.1);
});

/* -------------------------- FLOOR CONCRETE ------------------------ */
register("floorConcrete", () => {
  const S = 512;
  const rng = new Rng(202);
  const px = new Px(S);
  const height = new Float32Array(S * S);
  const rough = new Float32Array(S * S);
  const base = fractal(S, S, rng.fork(11), 5, 5, 0.5);
  const fine = fractal(S, S, rng.fork(12), 6, 32, 0.55);
  const dust = fractal(S, S, rng.fork(13), 3, 2, 0.5);
  for (let i = 0; i < S * S; i++) {
    const x = i % S;
    const y = (i / S) | 0;
    const shade = 0.72 + base[i] * 0.22 + (fine[i] - 0.5) * 0.1 + (dust[i] - 0.5) * 0.16;
    px.set(x, y, 118 * shade, 117 * shade, 112 * shade);
    height[i] = base[i] * 0.4 + fine[i] * 0.6;
    rough[i] = 0.82 + (dust[i] - 0.5) * 0.2;
  }
  // scouring / wear paths
  for (let n = 0; n < 14; n++) {
    let x = rng.next() * S;
    let y = rng.next() * S;
    let ang = rng.next() * Math.PI * 2;
    for (let s = 0; s < 260; s++) {
      ang += rng.gauss(0, 0.1);
      x += Math.cos(ang);
      y += Math.sin(ang);
      const w = 2 + rng.next() * 4;
      for (let d = -w; d <= w; d++) {
        const xx = ((x + Math.cos(ang + Math.PI / 2) * d) | 0 + S) % S;
        const yy = ((y + Math.sin(ang + Math.PI / 2) * d) | 0 + S) % S;
        px.mul(xx, yy, 0.94);
        rough[yy * S + xx] -= 0.06;
      }
    }
  }
  // cracks + chips
  for (let n = 0; n < 20; n++) {
    let x = rng.next() * S;
    let y = rng.next() * S;
    let ang = rng.next() * Math.PI * 2;
    for (let s = 0; s < rng.int(50, 200); s++) {
      ang += rng.gauss(0, 0.2);
      x += Math.cos(ang) * 1.2;
      y += Math.sin(ang) * 1.2;
      const xi = ((x | 0) + S) % S;
      const yi = ((y | 0) + S) % S;
      px.mul(xi, yi, 0.72, -12, -12, -11);
      height[yi * S + xi] -= 0.12;
    }
  }
  for (let n = 0; n < 3000; n++) {
    const x = rng.int(0, S - 1);
    const y = rng.int(0, S - 1);
    px.mul(x, y, rng.range(0.8, 0.95));
    height[y * S + x] -= 0.04;
  }
  for (let i = 0; i < rough.length; i++) rough[i] = Math.max(0.3, Math.min(1, rough[i]));
  return surf(S, px.data, height, rough, 2.6);
});

/* ---------------------------- CEILING ----------------------------- */
register("ceiling", () => {
  const S = 256;
  const rng = new Rng(303);
  const px = new Px(S);
  const height = new Float32Array(S * S);
  const rough = new Float32Array(S * S);
  const base = fractal(S, S, rng.fork(21), 4, 4, 0.5);
  const fine = fractal(S, S, rng.fork(22), 5, 18, 0.6);
  for (let i = 0; i < S * S; i++) {
    const shade = 0.66 + base[i] * 0.24 + (fine[i] - 0.5) * 0.12;
    const x = i % S;
    const y = (i / S) | 0;
    px.set(x, y, 108 * shade, 107 * shade, 102 * shade);
    height[i] = base[i] * 0.6 + fine[i] * 0.4;
    rough[i] = 0.9;
  }
  // damp patches
  for (let n = 0; n < 6; n++) {
    const cx = rng.next() * S;
    const cy = rng.next() * S;
    const rad = rng.range(20, 60);
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const d = Math.hypot(x - cx, y - cy) / rad;
        if (d < 1) {
          const f = (1 - d) * (1 - d) * 0.4;
          px.mul(x, y, 1 - f, -6 * f, -5 * f, -2 * f);
          rough[y * S + x] -= 0.2 * f;
        }
      }
  }
  return surf(S, px.data, height, rough, 1.6);
});

/* -------------------------- METAL PANEL --------------------------- */
register("metalPanel", () => {
  const S = 512;
  const rng = new Rng(404);
  const px = new Px(S);
  const height = new Float32Array(S * S);
  const rough = new Float32Array(S * S);
  const rustMask = fractal(S, S, rng.fork(31), 5, 6, 0.55);
  const fine = fractal(S, S, rng.fork(32), 6, 40, 0.5);
  for (let i = 0; i < S * S; i++) {
    const x = i % S;
    const y = (i / S) | 0;
    const panel = 0.9 + fine[i] * 0.12;
    const r = 116 * panel;
    const g = 120 * panel;
    const b = 118 * panel;
    px.set(x, y, r, g, b);
    height[i] = 0.5 + fine[i] * 0.1;
    rough[i] = 0.42 + fine[i] * 0.2;
    // rust blotches
    const rv = rustMask[i] + (0.5 - y / S) * 0.12;
    if (rv > 0.62) {
      const k = Math.min(1, (rv - 0.62) / 0.22);
      const o = i * 4;
      px.data[o] = px.data[o] * (1 - k) + 122 * k;
      px.data[o + 1] = px.data[o + 1] * (1 - k) + 66 * k;
      px.data[o + 2] = px.data[o + 2] * (1 - k) + 34 * k;
      rough[i] = Math.max(rough[i], 0.7 + k * 0.25);
      height[i] += k * 0.06;
    }
  }
  // panel seams (2x2 panels per tile)
  for (const p of [0, S / 2]) {
    for (let i = 0; i < S; i++) {
      const a = (p + i) % S;
      for (const [x, y] of [
        [a, p],
        [p, a],
      ] as [number, number][]) {
        px.mul(x, y, 0.55, -30, -30, -28);
        height[y * S + x] -= 0.3;
        rough[y * S + x] = Math.min(1, rough[y * S + x] + 0.25);
      }
    }
  }
  // rivets
  for (let py = 0; py < 2; py++)
    for (let pxl = 0; pxl < 2; pxl++) {
      const ox = pxl * (S / 2);
      const oy = py * (S / 2);
      for (const [dx, dy] of [
        [22, 22],
        [S / 2 - 22, 22],
        [22, S / 2 - 22],
        [S / 2 - 22, S / 2 - 22],
      ]) {
        const cx = (ox + dx) % S;
        const cy = (oy + dy) % S;
        for (let y = -5; y <= 5; y++)
          for (let x = -5; x <= 5; x++) {
            const d = Math.hypot(x, y);
            if (d > 5) continue;
            const xx = (cx + x + S) % S;
            const yy = (cy + y + S) % S;
            const k = 1 - d / 5;
            px.mul(xx, yy, 1 - 0.45 * (1 - k) + 0.25 * k, 12 * k, 12 * k, 12 * k);
            height[yy * S + xx] += k * 0.25;
            rough[yy * S + xx] -= 0.12 * k;
          }
        // rust ring under fastener
        for (let y = -9; y <= 9; y++)
          for (let x = -9; x <= 9; x++) {
            const d = Math.hypot(x, y);
            if (d < 5.5 || d > 9) continue;
            const xx = (cx + x + S) % S;
            const yy = (cy + y + S) % S;
            const k = 1 - Math.abs(d - 7) / 2.5;
            const o = (yy * S + xx) * 4;
            px.data[o] = px.data[o] * (1 - k) + 108 * k;
            px.data[o + 1] = px.data[o + 1] * (1 - k) + 58 * k;
            px.data[o + 2] = px.data[o + 2] * (1 - k) + 30 * k;
            rough[yy * S + xx] += 0.2 * k;
          }
      }
    }
  // directional scratches
  for (let n = 0; n < 180; n++) {
    let x = rng.next() * S;
    const y = rng.next() * S;
    const len = rng.range(8, 60);
    const dir = rng.bool(0.75) ? 1 : -1;
    for (let s = 0; s < len; s++) {
      const xx = ((x + s * dir) | 0 + S) % S;
      const yy = ((y + rng.gauss(0, 0.4)) | 0 + S) % S;
      px.mul(xx, yy, 1.18, 10, 10, 10);
      rough[yy * S + xx] -= 0.15;
    }
  }
  for (let i = 0; i < rough.length; i++) rough[i] = Math.max(0.18, Math.min(1, rough[i]));
  return surf(S, px.data, height, rough, 1.4);
});

/* --------------------------- METAL FLOOR -------------------------- */
register("metalFloor", () => {
  const S = 256;
  const rng = new Rng(505);
  const px = new Px(S);
  const height = new Float32Array(S * S);
  const rough = new Float32Array(S * S);
  const grime = fractal(S, S, rng.fork(41), 5, 7, 0.55);
  const fine = fractal(S, S, rng.fork(42), 5, 30, 0.6);
  for (let i = 0; i < S * S; i++) {
    const x = i % S;
    const y = (i / S) | 0;
    const v = 0.8 + fine[i] * 0.16;
    px.set(x, y, 92 * v, 96 * v, 94 * v);
    height[i] = 0.4 + fine[i] * 0.2;
    rough[i] = 0.55 + fine[i] * 0.2;
    if (grime[i] > 0.6) {
      const k = Math.min(1, (grime[i] - 0.6) / 0.3);
      const o = i * 4;
      px.data[o] = px.data[o] * (1 - k) + 70 * k;
      px.data[o + 1] = px.data[o + 1] * (1 - k) + 64 * k;
      px.data[o + 2] = px.data[o + 2] * (1 - k) + 52 * k;
      rough[i] += 0.3 * k;
    }
  }
  // tread plate chevrons
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const t = ((x + y) % 64) / 64;
      const bar = Math.abs(t - 0.5) < 0.09 ? 1 : 0;
      if (bar) {
        px.mul(x, y, 1.22, 12, 12, 12);
        height[y * S + x] += 0.3;
        rough[y * S + x] -= 0.16;
      }
    }
  for (let i = 0; i < rough.length; i++) rough[i] = Math.max(0.25, Math.min(1, rough[i]));
  return surf(S, px.data, height, rough, 2.4);
});

/* ------------------------------ BRICK ----------------------------- */
register("brick", () => {
  const S = 512;
  const rng = new Rng(606);
  const px = new Px(S);
  const height = new Float32Array(S * S);
  const rough = new Float32Array(S * S);
  const COURSES = 5;
  const ch = S / COURSES;
  const bw = S / 2.5;
  const grain = fractal(S, S, rng.fork(51), 6, 30, 0.6);
  const damp = fractal(S, S, rng.fork(52), 4, 3, 0.5);
  for (let y = 0; y < S; y++) {
    const row = Math.floor(y / ch);
    const offset = row % 2 === 0 ? 0 : bw / 2;
    for (let x = 0; x < S; x++) {
      const bx = (x + offset) % bw;
      const by = y % ch;
      const mortar = by < 3 || by > ch - 3 || bx < 3 || bx > bw - 3;
      const i = y * S + x;
      const g = grain[i];
      if (mortar) {
        const v = 0.62 + g * 0.2;
        px.set(x, y, 96 * v, 92 * v, 84 * v);
        height[i] = 0.16 + g * 0.12;
        rough[i] = 0.95;
      } else {
        // per-brick colour jitter
        const seedBrick = Math.floor((x + offset) / bw) * 7 + row * 13;
        const rj = new Rng(seedBrick * 977 + 13);
        const tint = 0.78 + rj.next() * 0.4;
        const hue = rj.next();
        const v = tint * (0.82 + g * 0.3);
        px.set(x, y, (150 + hue * 30) * v, (74 + hue * 22) * v, (56 + hue * 14) * v);
        height[i] = 0.72 + g * 0.24;
        rough[i] = 0.72 + g * 0.2;
        // rounded brick edges
        const edge = Math.min(bx, by, bw - bx, ch - by);
        if (edge < 5) {
          const k = edge / 5;
          px.mul(x, y, 0.85 + 0.15 * k);
          height[i] *= 0.6 + 0.4 * k;
        }
      }
      // damp and moss low on the wall
      const dv = damp[i];
      if (dv > 0.58) {
        const k = Math.min(1, (dv - 0.58) / 0.3) * 0.5;
        const o = i * 4;
        px.data[o] = px.data[o] * (1 - k) + 58 * k;
        px.data[o + 1] = px.data[o + 1] * (1 - k) + 66 * k;
        px.data[o + 2] = px.data[o + 2] * (1 - k) + 46 * k;
        rough[i] += 0.2 * k;
      }
    }
  }
  // damaged / missing bricks
  for (let n = 0; n < 5; n++) {
    const row = rng.int(0, COURSES - 1);
    const col = rng.int(0, 2);
    const x0 = col * bw + (row % 2 === 0 ? 0 : bw / 2);
    const y0 = row * ch;
    for (let y = 4; y < ch - 4; y++)
      for (let x = 4; x < bw - 4; x++) {
        const xx = (x0 + x) % S;
        const yy = (y0 + y) % S;
        const k = rng.range(0.5, 0.8);
        px.mul(xx, yy, k, -20 * (1 - k), -18 * (1 - k), -14 * (1 - k));
        height[yy * S + xx] *= 0.4;
        rough[yy * S + xx] = 0.95;
      }
  }
  return surf(S, px.data, height, rough, 3.2);
});

/* ------------------------------ STONE ----------------------------- */
register("stone", () => {
  const S = 512;
  const rng = new Rng(707);
  const px = new Px(S);
  const height = new Float32Array(S * S);
  const rough = new Float32Array(S * S);
  const grain = fractal(S, S, rng.fork(61), 6, 26, 0.6);
  const blotch = fractal(S, S, rng.fork(62), 4, 3, 0.5);
  const ROWS = 7;
  for (let row = 0; row < ROWS; row++) {
    const y0 = (row * S) / ROWS;
    const rh = S / ROWS;
    let x = 0;
    const widths: number[] = [];
    while (x < S) {
      const w = S * rng.range(0.16, 0.36);
      widths.push(w);
      x += w;
    }
    const offset = row % 2 === 0 ? 0 : widths[0] * 0.5;
    let cx = -offset;
    for (const w of widths.concat(widths)) {
      const x0 = cx;
      cx += w;
      if (x0 > S) break;
      const rj = new Rng(Math.floor(x0 * 3 + row * 17) * 7717 + 5);
      const tint = 0.72 + rj.next() * 0.45;
      const warm = rj.next();
      const x0p = ((x0 % S) + S) % S;
      for (let y = 0; y < rh; y++) {
        for (let xx = 0; xx < w; xx++) {
          const px2 = (x0p + xx) % S;
          const py = (y0 + y) % S;
          const i = py * S + px2;
          const g = grain[i];
          // irregular block silhouette
          const ex = Math.min(xx, w - xx) / (w * 0.12);
          const ey = Math.min(y, rh - y) / (rh * 0.25);
          const edge = Math.min(1, Math.min(ex, ey));
          const v = tint * (0.78 + g * 0.34) * (0.7 + 0.3 * edge);
          px.set(px2, py, (126 + warm * 22) * v, (120 + warm * 16) * v, (110 + warm * 10) * v);
          height[i] = (0.35 + 0.5 * edge) * (0.8 + g * 0.3);
          rough[i] = 0.86 + g * 0.14;
          if (blotch[i] > 0.62) {
            const k = Math.min(1, (blotch[i] - 0.62) / 0.3) * 0.45;
            const o = i * 4;
            px.data[o] = px.data[o] * (1 - k) + 62 * k;
            px.data[o + 1] = px.data[o + 1] * (1 - k) + 70 * k;
            px.data[o + 2] = px.data[o + 2] * (1 - k) + 52 * k;
            rough[i] = Math.min(1, rough[i] + 0.12);
          }
        }
      }
    }
  }
  return surf(S, px.data, height, rough, 3.6);
});

/* ------------------------------ SOIL ------------------------------ */
register("soil", () => {
  const S = 512;
  const rng = new Rng(808);
  const px = new Px(S);
  const height = new Float32Array(S * S);
  const rough = new Float32Array(S * S);
  const base = fractal(S, S, rng.fork(71), 5, 6, 0.55);
  const fine = fractal(S, S, rng.fork(72), 6, 40, 0.6);
  for (let i = 0; i < S * S; i++) {
    const x = i % S;
    const y = (i / S) | 0;
    const v = 0.7 + base[i] * 0.4 + (fine[i] - 0.5) * 0.2;
    px.set(x, y, 84 * v, 66 * v, 46 * v);
    height[i] = base[i] * 0.5 + fine[i] * 0.5;
    rough[i] = 0.95;
  }
  // pebbles
  for (let n = 0; n < 900; n++) {
    const cx = rng.next() * S;
    const cy = rng.next() * S;
    const rad = rng.range(1.2, 3.6);
    const shade = rng.range(0.8, 1.5);
    for (let y = -4; y <= 4; y++)
      for (let x = -4; x <= 4; x++) {
        const d = Math.hypot(x / rad, y / (rad * rng.range(0.6, 1)));
        if (d > 1) continue;
        const xx = ((cx + x) | 0 + S) % S;
        const yy = ((cy + y) | 0 + S) % S;
        px.mul(xx, yy, shade, 6, 6, 6);
        height[yy * S + xx] += 0.3 * (1 - d);
      }
  }
  // leaf litter
  for (let n = 0; n < 260; n++) {
    const cx = rng.next() * S;
    const cy = rng.next() * S;
    const rot = rng.next() * Math.PI;
    const len = rng.range(5, 14);
    const wid = len * rng.range(0.35, 0.6);
    const dry = rng.bool(0.5);
    const cr = dry ? 150 : 96;
    const cg = dry ? 118 : 104;
    const cb = dry ? 62 : 52;
    const ca = Math.cos(rot);
    const sa = Math.sin(rot);
    for (let y = -16; y <= 16; y++)
      for (let x = -16; x <= 16; x++) {
        const rx = x * ca + y * sa;
        const ry = -x * sa + y * ca;
        const d = Math.hypot(rx / len, ry / wid);
        if (d > 1) continue;
        const xx = ((cx + x) | 0 + S) % S;
        const yy = ((cy + y) | 0 + S) % S;
        const k = 1 - d * d;
        const o = (yy * S + xx) * 4;
        px.data[o] = px.data[o] * (1 - k) + cr * k;
        px.data[o + 1] = px.data[o + 1] * (1 - k) + cg * k;
        px.data[o + 2] = px.data[o + 2] * (1 - k) + cb * k;
        height[yy * S + xx] += 0.12 * k;
        rough[yy * S + xx] = 0.95;
      }
  }
  return surf(S, px.data, height, rough, 3.0);
});

/* ---------------------------- HEDGE WALL -------------------------- */
export interface FoliageSurface extends Surface {
  alphaMap: THREE.Texture;
}

register("hedge", () => {
  const S = 512;
  const rng = new Rng(909);
  const size = S;
  const alb = document.createElement("canvas");
  alb.width = alb.height = size;
  const a = alb.getContext("2d")!;
  a.fillStyle = "#0c1408";
  a.fillRect(0, 0, size, size);
  const alpha = document.createElement("canvas");
  alpha.width = alpha.height = size;
  const al = alpha.getContext("2d")!;
  al.fillStyle = "#000";
  al.fillRect(0, 0, size, size);
  const height = new Float32Array(size * size);

  // dense leaf clusters
  const leaf = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    len: number,
    rot: number,
    col: string,
  ) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.beginPath();
    ctx.ellipse(0, 0, len, len * 0.42, 0, 0, Math.PI * 2);
    ctx.fillStyle = col;
    ctx.fill();
    ctx.restore();
  };
  for (let n = 0; n < 2600; n++) {
    const x = rng.next() * size;
    const y = rng.next() * size;
    const l = rng.range(6, 20);
    const t = rng.next();
    const light = 0.35 + t * 0.55;
    const col = `rgb(${(34 + t * 46) | 0}, ${(66 + t * 66) | 0}, ${(26 + t * 34) | 0})`;
    leaf(a, x, y, l, rng.next() * Math.PI * 2, col);
    al.save();
    al.translate(x, y);
    al.fillStyle = `rgba(255,255,255,${light})`;
    al.beginPath();
    al.ellipse(0, 0, l, l * 0.42, rng.next() * Math.PI * 2, 0, Math.PI * 2);
    al.fill();
    al.restore();
    const cx = x | 0;
    const cy = y | 0;
    height[cy * size + cx] += 0.2;
  }
  const map = new THREE.CanvasTexture(alb);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace;
  const alphaMap = new THREE.CanvasTexture(alpha);
  alphaMap.wrapS = alphaMap.wrapT = THREE.RepeatWrapping;
  return { map, normalMap: heightToNormal(height, size, 3.2), roughnessMap: greyToTexture(new Float32Array(size * size).fill(0.95), size), alphaMap };
});

/* --------------------------- LEAF CLUSTER ------------------------- */
register("leafTuft", () => {
  const map = canvasTex(256, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    const rng = new Rng(1111);
    for (let n = 0; n < 26; n++) {
      const x = s / 2 + rng.gauss(0, s * 0.18);
      const y = s / 2 + rng.gauss(0, s * 0.2);
      const len = rng.range(s * 0.06, s * 0.16);
      const rot = rng.next() * Math.PI * 2;
      const t = rng.next();
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      ctx.beginPath();
      ctx.ellipse(0, 0, len, len * 0.34, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgb(${(40 + t * 60) | 0}, ${(78 + t * 70) | 0}, ${(30 + t * 36) | 0})`;
      ctx.fill();
      ctx.strokeStyle = `rgba(${(90 + t * 40) | 0},${(120 + t * 40) | 0},60,0.5)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(-len, 0);
      ctx.lineTo(len, 0);
      ctx.stroke();
      ctx.restore();
    }
  });
  const blank = new Float32Array(64 * 64).fill(0.5);
  return { map, normalMap: heightToNormal(blank, 64, 0.01), roughnessMap: greyToTexture(new Float32Array(64 * 64).fill(0.9), 64) };
});

/* ----------------------------- RUST METAL ------------------------- */
register("rust", () => {
  const S = 256;
  const rng = new Rng(1212);
  const px = new Px(S);
  const height = new Float32Array(S * S);
  const rough = new Float32Array(S * S);
  const base = fractal(S, S, rng.fork(81), 5, 7, 0.55);
  const fine = fractal(S, S, rng.fork(82), 6, 34, 0.6);
  for (let i = 0; i < S * S; i++) {
    const x = i % S;
    const y = (i / S) | 0;
    const k = Math.min(1, Math.max(0, (base[i] - 0.42) / 0.4));
    const v = 0.8 + fine[i] * 0.3;
    const r = (78 + k * 82) * v;
    const g = (74 - k * 26) * v;
    const b = (72 - k * 40) * v;
    px.set(x, y, r, g, b);
    height[i] = fine[i] * 0.7 + k * 0.2;
    rough[i] = 0.6 + k * 0.35;
  }
  for (let i = 0; i < rough.length; i++) rough[i] = Math.max(0.3, Math.min(1, rough[i]));
  return surf(S, px.data, height, rough, 1.8);
});

/* --------------------------- PAINTED METAL ------------------------ */
register("paintedMetal", () => {
  const S = 256;
  const rng = new Rng(1313);
  const px = new Px(S);
  const height = new Float32Array(S * S);
  const rough = new Float32Array(S * S);
  const wear = fractal(S, S, rng.fork(91), 5, 8, 0.55);
  const fine = fractal(S, S, rng.fork(92), 5, 26, 0.6);
  for (let i = 0; i < S * S; i++) {
    const x = i % S;
    const y = (i / S) | 0;
    const v = 0.85 + fine[i] * 0.2;
    px.set(x, y, 70 * v, 76 * v, 74 * v);
    height[i] = 0.45 + fine[i] * 0.1;
    rough[i] = 0.45 + fine[i] * 0.25;
    if (wear[i] > 0.6) {
      const k = Math.min(1, (wear[i] - 0.6) / 0.28);
      const o = i * 4;
      px.data[o] = px.data[o] * (1 - k) + 96 * k;
      px.data[o + 1] = px.data[o + 1] * (1 - k) + 74 * k;
      px.data[o + 2] = px.data[o + 2] * (1 - k) + 56 * k;
      rough[i] += 0.3 * k;
      height[i] -= k * 0.1;
    }
  }
  for (let i = 0; i < rough.length; i++) rough[i] = Math.max(0.25, Math.min(1, rough[i]));
  return surf(S, px.data, height, rough, 1.2);
});

/* --------------------------- WATER NORMALS ------------------------ */
register("water", (): Surface => {
  const S = 256;
  const height = new Float32Array(S * S);
  const rng = new Rng(1414);
  const n1 = fractal(S, S, rng.fork(1), 4, 6, 0.5);
  const n2 = fractal(S, S, rng.fork(2), 3, 12, 0.5);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      height[i] =
        0.5 +
        0.22 * Math.sin((x / S) * Math.PI * 6 + n1[i] * 5) +
        0.16 * Math.sin((y / S) * Math.PI * 8 + n2[i] * 5) +
        (n1[i] - 0.5) * 0.4 +
        (n2[i] - 0.5) * 0.25;
    }
  const rough = new Float32Array(S * S).fill(0.08);
  return { map: greyToTexture(new Float32Array(S * S).fill(0.5), S), normalMap: heightToNormal(height, S, 2.4), roughnessMap: greyToTexture(rough, S) };
});

/* --------------------- LABEL / SIGN TEXTURES ---------------------- */
export function makeSignTexture(lines: string[], style: "warn" | "label" | "stencil"): THREE.CanvasTexture {
  return canvasTex(256, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    if (style === "warn") {
      ctx.fillStyle = "#b99a24";
      ctx.fillRect(0, 0, s, s * 0.34);
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, s, s * 0.34);
      ctx.clip();
      ctx.fillStyle = "#191713";
      for (let i = -s; i < s * 2; i += 34) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i + 16, 0);
        ctx.lineTo(i + 16 + s * 0.34, s * 0.34);
        ctx.lineTo(i + s * 0.34, s * 0.34);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
      ctx.fillStyle = "#e8e4da";
      ctx.fillRect(0, s * 0.34, s, s * 0.66);
      ctx.fillStyle = "#191713";
      ctx.font = `bold ${s * 0.13}px "Arial Narrow", Impact, sans-serif`;
      ctx.textAlign = "center";
      lines.forEach((l, i) => ctx.fillText(l, s / 2, s * (0.53 + i * 0.14)));
      ctx.strokeStyle = "rgba(20,20,20,0.35)";
      ctx.lineWidth = 3;
      ctx.strokeRect(2, 2, s - 4, s - 4);
    } else if (style === "stencil") {
      ctx.fillStyle = "rgba(0,0,0,0)";
      ctx.clearRect(0, 0, s, s);
      ctx.strokeStyle = "#d8d2c4";
      ctx.fillStyle = "#d8d2c4";
      ctx.font = `bold ${s * 0.2}px "Courier New", monospace`;
      ctx.textAlign = "center";
      lines.forEach((l, i) => ctx.fillText(l, s / 2, s * (0.4 + i * 0.22)));
    } else {
      ctx.fillStyle = "#cfd6d4";
      ctx.fillRect(0, 0, s, s);
      ctx.fillStyle = "#1c2024";
      ctx.font = `bold ${s * 0.11}px "Arial Narrow", sans-serif`;
      ctx.textAlign = "center";
      lines.forEach((l, i) => ctx.fillText(l, s / 2, s * (0.2 + i * 0.13)));
      ctx.strokeStyle = "#1c2024";
      ctx.lineWidth = 2;
      ctx.strokeRect(s * 0.06, s * 0.06, s * 0.88, s * 0.88);
    }
    // grime
    const rng = new Rng(77);
    ctx.globalAlpha = 0.25;
    for (let n = 0; n < 60; n++) {
      ctx.fillStyle = rng.bool() ? "#3a3128" : "#6b6357";
      ctx.beginPath();
      ctx.ellipse(rng.next() * s, rng.next() * s, rng.range(3, 26), rng.range(3, 26), rng.next() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  });
}

/** Hand-written note rendered on stained paper. */
export function makePaperTexture(title: string, body: string): THREE.CanvasTexture {
  return canvasTex(512, (ctx, s) => {
    ctx.fillStyle = "#cdc3ab";
    ctx.fillRect(0, 0, s, s);
    const rng = new Rng(31);
    for (let n = 0; n < 90; n++) {
      ctx.fillStyle = `rgba(${120 + rng.int(0, 40)},${104 + rng.int(0, 30)},${80 + rng.int(0, 30)},0.12)`;
      ctx.beginPath();
      ctx.ellipse(rng.next() * s, rng.next() * s, rng.range(6, 60), rng.range(6, 50), rng.next() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "rgba(60,44,28,0.12)";
    for (let y = s * 0.22; y < s * 0.95; y += s * 0.055) {
      ctx.fillRect(s * 0.08, y, s * 0.84, 1.4);
    }
    ctx.fillStyle = "#2a2018";
    ctx.font = `bold ${s * 0.045}px "Courier New", monospace`;
    ctx.fillText(title, s * 0.08, s * 0.13);
    ctx.strokeStyle = "rgba(42,32,24,0.5)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(s * 0.08, s * 0.16);
    ctx.lineTo(s * 0.6, s * 0.16);
    ctx.stroke();
    ctx.font = `${s * 0.036}px Georgia, serif`;
    const words = body.split(/\s+/);
    let line = "";
    let y = s * 0.25;
    for (const w of words) {
      if ((line + w).length > 46) {
        ctx.fillText(line, s * 0.08, y);
        y += s * 0.048;
        line = "";
      }
      line += w + " ";
      if (y > s * 0.9) break;
    }
    if (y <= s * 0.9) ctx.fillText(line, s * 0.08, y);
  });
}

/** Chalk / paint markings painted straight onto walls (decal). */
export function makeMarkTexture(kind: "arrow" | "digits" | "cross" | "chalk", arg = ""): THREE.CanvasTexture {
  return canvasTex(256, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    ctx.strokeStyle = "rgba(226,222,210,0.9)";
    ctx.fillStyle = "rgba(226,222,210,0.9)";
    ctx.lineCap = "round";
    const rng = new Rng(kind.length * 991 + 7);
    if (kind === "arrow") {
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.moveTo(s * 0.2, s * 0.5);
      ctx.lineTo(s * 0.75, s * 0.5);
      ctx.stroke();
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.moveTo(s * 0.55, s * 0.3);
      ctx.lineTo(s * 0.78, s * 0.5);
      ctx.lineTo(s * 0.55, s * 0.7);
      ctx.stroke();
    } else if (kind === "digits") {
      ctx.font = `bold ${s * 0.42}px "Courier New", monospace`;
      ctx.textAlign = "center";
      ctx.fillText(arg, s / 2, s * 0.62);
    } else if (kind === "cross") {
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.moveTo(s * 0.3, s * 0.3);
      ctx.lineTo(s * 0.7, s * 0.7);
      ctx.moveTo(s * 0.7, s * 0.3);
      ctx.lineTo(s * 0.3, s * 0.7);
      ctx.stroke();
    } else {
      ctx.font = `italic ${s * 0.14}px Georgia, serif`;
      ctx.textAlign = "center";
      ctx.fillText(arg || "the walls lie", s / 2, s * 0.55);
    }
    // chalk dust
    ctx.globalAlpha = 0.25;
    for (let n = 0; n < 40; n++) {
      ctx.fillStyle = "#e8e4d8";
      ctx.beginPath();
      ctx.arc(rng.next() * s, rng.next() * s, rng.range(1, 5), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  });
}

/* ------------------------------------------------------------------ *
 * Async build with progress (keeps the loading screen responsive)
 * ------------------------------------------------------------------ */
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

export async function buildSurfaces(onProgress?: (frac: number, label: string) => void): Promise<void> {
  for (let i = 0; i < jobs.length; i++) {
    const j = jobs[i];
    if (!cache.has(j.name)) {
      onProgress?.(i / jobs.length, j.name);
      await tick();
      cache.set(j.name, j.build());
    }
  }
  onProgress?.(1, "done");
}

export function surface(name: string): Surface {
  const s = cache.get(name);
  if (!s) throw new Error(`surface "${name}" not built`);
  return s;
}

export function foliageSurface(name: string): FoliageSurface {
  return surface(name) as FoliageSurface;
}

export function disposeSurfaces() {
  for (const s of cache.values()) {
    s.map.dispose();
    s.normalMap.dispose();
    s.roughnessMap.dispose();
  }
  cache.clear();
}

export function textureAnisotropy(max: number) {
  for (const s of cache.values()) {
    s.map.anisotropy = max;
    s.normalMap.anisotropy = Math.min(2, max);
    s.roughnessMap.anisotropy = Math.min(2, max);
    s.map.needsUpdate = true;
  }
}
