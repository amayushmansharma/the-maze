import * as THREE from "three";

/**
 * Procedural casual adult male used for every remote player.
 * ~1.78 m tall, feet at y = 0, facing -Z (same convention as the camera).
 *
 * Layers: skin -> light-grey long-sleeve -> outer short-sleeve T-shirt
 * (the only part tinted by the player's colour) -> olive-grey jeans -> dark shoes.
 * Limbs hang from pivot groups so a simple gait can be driven from speed.
 */

/* ------------------------------------------------------------------ */
/* shared fabric textures (built once, reused by every player)         */
/* ------------------------------------------------------------------ */
let shared: {
  knit: THREE.CanvasTexture;
  denim: THREE.CanvasTexture;
  leather: THREE.CanvasTexture;
  hair: THREE.CanvasTexture;
  skin: THREE.MeshStandardMaterial;
  under: THREE.MeshStandardMaterial;
  jeans: THREE.MeshStandardMaterial;
  shoe: THREE.MeshStandardMaterial;
  sole: THREE.MeshStandardMaterial;
  hairMat: THREE.MeshStandardMaterial;
  eye: THREE.MeshStandardMaterial;
  brow: THREE.MeshStandardMaterial;
  lip: THREE.MeshStandardMaterial;
} | null = null;

function noiseCanvas(size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  draw(ctx, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function rand(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function getShared() {
  if (shared) return shared;
  // jersey knit: fine rows + soft horizontal fold bands
  const knit = noiseCanvas(256, (ctx, s) => {
    const r = rand(11);
    ctx.fillStyle = "#e6e6e6";
    ctx.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 2) {
      ctx.fillStyle = `rgba(0,0,0,${0.035 + r() * 0.03})`;
      ctx.fillRect(0, y, s, 1);
    }
    for (let i = 0; i < 9; i++) {
      const y = r() * s;
      const g = ctx.createLinearGradient(0, y - 10, 0, y + 10);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(0.5, `rgba(0,0,0,${0.12 + r() * 0.1})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, y - 10, s, 20);
    }
  });
  knit.repeat.set(3, 3);
  // denim twill + side seam
  const denim = noiseCanvas(256, (ctx, s) => {
    const r = rand(23);
    ctx.fillStyle = "#cfcfcf";
    ctx.fillRect(0, 0, s, s);
    for (let i = -s; i < s * 2; i += 3) {
      ctx.strokeStyle = `rgba(0,0,0,${0.07 + r() * 0.06})`;
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + s * 0.4, s);
      ctx.stroke();
    }
    for (let n = 0; n < 1500; n++) {
      ctx.fillStyle = `rgba(255,255,255,${r() * 0.12})`;
      ctx.fillRect(r() * s, r() * s, 1, 2);
    }
    ctx.fillStyle = "rgba(60,50,30,0.35)"; // stitched seam
    ctx.fillRect(s * 0.49, 0, 2, s);
    for (let y = 0; y < s; y += 6) {
      ctx.fillStyle = "rgba(200,170,110,0.35)";
      ctx.fillRect(s * 0.505, y, 1, 3);
    }
  });
  denim.repeat.set(2, 3);
  const leather = noiseCanvas(128, (ctx, s) => {
    const r = rand(5);
    ctx.fillStyle = "#bdbdbd";
    ctx.fillRect(0, 0, s, s);
    for (let n = 0; n < 900; n++) {
      ctx.fillStyle = `rgba(0,0,0,${r() * 0.15})`;
      ctx.fillRect(r() * s, r() * s, 2, 1);
    }
  });
  const hair = noiseCanvas(128, (ctx, s) => {
    const r = rand(7);
    ctx.fillStyle = "#8a8a8a";
    ctx.fillRect(0, 0, s, s);
    for (let n = 0; n < 700; n++) {
      ctx.strokeStyle = `rgba(0,0,0,${0.2 + r() * 0.4})`;
      const x = r() * s;
      const y = r() * s;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (r() - 0.5) * 4, y + 6 + r() * 6);
      ctx.stroke();
    }
  });
  hair.repeat.set(3, 2);

  const bump = (t: THREE.Texture) => {
    const b = t.clone();
    b.colorSpace = THREE.NoColorSpace;
    b.needsUpdate = true;
    return b;
  };

  shared = {
    knit,
    denim,
    leather,
    hair,
    skin: new THREE.MeshStandardMaterial({ color: 0xc89a7c, roughness: 0.62, metalness: 0 }),
    under: new THREE.MeshStandardMaterial({ color: 0xa9adb0, map: knit, bumpMap: bump(knit), bumpScale: 0.6, roughness: 0.93, metalness: 0 }),
    jeans: new THREE.MeshStandardMaterial({ color: 0x5d6152, map: denim, bumpMap: bump(denim), bumpScale: 0.8, roughness: 0.9, metalness: 0 }),
    shoe: new THREE.MeshStandardMaterial({ color: 0x2a2724, map: leather, bumpMap: bump(leather), bumpScale: 0.3, roughness: 0.6, metalness: 0 }),
    sole: new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.85 }),
    hairMat: new THREE.MeshStandardMaterial({ color: 0x241b15, map: hair, bumpMap: bump(hair), bumpScale: 1.2, roughness: 0.82, metalness: 0 }),
    eye: new THREE.MeshStandardMaterial({ color: 0x1c1612, roughness: 0.25 }),
    brow: new THREE.MeshStandardMaterial({ color: 0x1e1610, roughness: 0.9 }),
    lip: new THREE.MeshStandardMaterial({ color: 0xa96f62, roughness: 0.55 }),
  };
  return shared;
}

/* ------------------------------------------------------------------ */
/* geometry helpers                                                    */
/* ------------------------------------------------------------------ */
/** Smooth tapered limb hanging down from y = 0 to y = -len. radii: top -> bottom. */
function limb(len: number, radii: number[], seg = 14, depth = 1): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  const n = radii.length - 1;
  pts.push(new THREE.Vector2(0.0001, 0));
  for (let i = 0; i <= n; i++) pts.push(new THREE.Vector2(radii[i]!, -(i / n) * len));
  pts.push(new THREE.Vector2(0.0001, -len));
  const g = new THREE.LatheGeometry(pts, seg);
  if (depth !== 1) g.scale(1, 1, depth);
  g.computeVertexNormals();
  return g;
}

/** Torso shell from waist (y=0) to shoulders (y=len). widths/depths per ring. */
function torso(len: number, w: number[], d: number[], seg = 18): THREE.BufferGeometry {
  const rings = w.length;
  const pos: number[] = [];
  const uv: number[] = [];
  const idxs: number[] = [];
  for (let r = 0; r < rings; r++) {
    const y = (r / (rings - 1)) * len;
    for (let s = 0; s <= seg; s++) {
      const a = (s / seg) * Math.PI * 2;
      // slightly squared ellipse reads more like a chest than a tube
      const cx = Math.sign(Math.cos(a)) * Math.pow(Math.abs(Math.cos(a)), 0.8);
      const cz = Math.sign(Math.sin(a)) * Math.pow(Math.abs(Math.sin(a)), 0.9);
      pos.push(cx * w[r]!, y, cz * d[r]!);
      uv.push(s / seg, r / (rings - 1));
    }
  }
  for (let r = 0; r < rings - 1; r++)
    for (let s = 0; s < seg; s++) {
      const a = r * (seg + 1) + s;
      const b = a + seg + 1;
      idxs.push(a, b, a + 1, b, b + 1, a + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idxs);
  g.computeVertexNormals();
  return g;
}

function mesh(g: THREE.BufferGeometry, m: THREE.Material, shadow = true) {
  const o = new THREE.Mesh(g, m);
  o.castShadow = shadow;
  o.receiveShadow = true;
  return o;
}

/* ------------------------------------------------------------------ */
/* the character                                                       */
/* ------------------------------------------------------------------ */
export class Human {
  root = new THREE.Group();
  private hips = new THREE.Group();
  private chest = new THREE.Group();
  private head = new THREE.Group();
  private thigh: THREE.Group[] = [];
  private shin: THREE.Group[] = [];
  private upper: THREE.Group[] = [];
  private fore: THREE.Group[] = [];
  private foot: THREE.Group[] = [];
  private tee: THREE.MeshStandardMaterial;
  private phase = 0;
  private own: THREE.BufferGeometry[] = [];

  constructor(shirtColor: number) {
    const S = getShared();
    this.tee = new THREE.MeshStandardMaterial({
      color: shirtColor,
      map: S.knit,
      bumpMap: S.under.bumpMap,
      bumpScale: 0.7,
      roughness: 0.92,
      metalness: 0,
    });
    const g = (geo: THREE.BufferGeometry) => {
      this.own.push(geo);
      return geo;
    };

    const HIP_Y = 0.94;
    this.hips.position.y = HIP_Y;
    this.root.add(this.hips);

    // ---- pelvis in jeans + belt line
    this.hips.add(mesh(g(torso(0.16, [0.165, 0.17, 0.16], [0.11, 0.115, 0.11]).translate(0, -0.1, 0)), S.jeans));
    this.hips.add(mesh(g(torso(0.025, [0.163, 0.163], [0.112, 0.112]).translate(0, 0.045, 0)), S.sole));

    // ---- chest (rotates slightly with gait)
    this.chest.position.y = 0.05;
    this.hips.add(this.chest);
    // undershirt body (only visible at hem / neck)
    this.chest.add(mesh(g(torso(0.47, [0.15, 0.148, 0.16, 0.18, 0.19, 0.17, 0.08], [0.1, 0.098, 0.105, 0.115, 0.118, 0.1, 0.06])), S.under));
    // outer T-shirt shell, hem slightly below the belt
    this.chest.add(
      mesh(g(torso(0.46, [0.168, 0.162, 0.168, 0.186, 0.198, 0.18, 0.1], [0.116, 0.11, 0.114, 0.122, 0.125, 0.108, 0.072]).translate(0, -0.035, 0)), this.tee),
    );
    // grey crew-neck collar ring of the undershirt
    this.chest.add(mesh(g(new THREE.TorusGeometry(0.058, 0.012, 6, 18).rotateX(Math.PI / 2).translate(0, 0.43, 0.002)), S.under));

    // ---- neck + head
    this.chest.add(mesh(g(limb(0.1, [0.048, 0.05, 0.052]).translate(0, 0.53, 0)), S.skin));
    this.head.position.y = 0.6;
    this.chest.add(this.head);
    this.buildHead(S, g);

    // ---- arms
    for (const side of [-1, 1]) {
      const up = new THREE.Group();
      up.position.set(side * 0.205, 0.405, 0);
      this.chest.add(up);
      // shoulder cap so the sleeve joins the torso smoothly (fabric, not a pad)
      up.add(mesh(g(new THREE.SphereGeometry(0.062, 12, 10).scale(1, 0.85, 1)), this.tee));
      up.add(mesh(g(limb(0.29, [0.052, 0.05, 0.045, 0.04])), S.under)); // long sleeve
      up.add(mesh(g(limb(0.14, [0.064, 0.062, 0.058])), this.tee)); // short tee sleeve
      up.add(mesh(g(new THREE.TorusGeometry(0.058, 0.006, 5, 14).rotateX(Math.PI / 2).translate(0, -0.14, 0)), this.tee));
      const fo = new THREE.Group();
      fo.position.y = -0.29;
      up.add(fo);
      fo.add(mesh(g(limb(0.25, [0.04, 0.038, 0.033, 0.029])), S.under));
      fo.add(mesh(g(limb(0.022, [0.031, 0.032]).translate(0, -0.245, 0)), S.under)); // cuff
      // hand: palm + fingers + thumb, ~18 cm long
      const palm = mesh(g(new THREE.BoxGeometry(0.075, 0.085, 0.028, 2, 2, 1).translate(0, -0.3, 0)), S.skin);
      fo.add(palm);
      fo.add(mesh(g(new THREE.BoxGeometry(0.07, 0.075, 0.022).translate(0, -0.375, 0.004)), S.skin));
      fo.add(mesh(g(limb(0.055, [0.012, 0.011, 0.009]).rotateZ(side * 0.5).translate(side * 0.035, -0.275, -0.012)), S.skin));
      this.upper.push(up);
      this.fore.push(fo);
    }

    // ---- legs
    for (const side of [-1, 1]) {
      const th = new THREE.Group();
      th.position.set(side * 0.092, -0.06, 0);
      this.hips.add(th);
      th.add(mesh(g(limb(0.44, [0.088, 0.083, 0.072, 0.06, 0.054], 14, 1.05)), S.jeans));
      const sh = new THREE.Group();
      sh.position.y = -0.44;
      th.add(sh);
      sh.add(mesh(g(limb(0.42, [0.055, 0.056, 0.05, 0.046, 0.047], 14)), S.jeans));
      // shoe: rounded upper + sole, ~28 cm long, toe pointing -Z
      const shoe = new THREE.Group();
      shoe.position.y = -0.428; // sole bottom lands on y = 0
      sh.add(shoe);
      const upperGeo = g(new THREE.SphereGeometry(1, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.052, 0.075, 0.14).translate(0, 0.012, -0.045));
      shoe.add(mesh(upperGeo, S.shoe));
      shoe.add(mesh(g(new THREE.BoxGeometry(0.1, 0.025, 0.285).translate(0, 0.0, -0.045)), S.sole));
      this.foot.push(shoe);
      this.thigh.push(th);
      this.shin.push(sh);
    }

    // sanity: shoe sole bottom sits at y ≈ 0
    // HIP_Y(0.94) - 0.06 - 0.44 - 0.42 - 0.44*0 ... = 0.02, sole half-height 0.0125
    this.root.position.y = 0;
  }

  private buildHead(S: NonNullable<typeof shared>, g: (x: THREE.BufferGeometry) => THREE.BufferGeometry) {
    const h = this.head;
    // skull + jaw
    h.add(mesh(g(new THREE.SphereGeometry(1, 24, 18).scale(0.088, 0.112, 0.102).translate(0, 0.07, 0)), S.skin));
    h.add(mesh(g(new THREE.SphereGeometry(1, 18, 12).scale(0.072, 0.06, 0.078).translate(0, 0.02, -0.018)), S.skin));
    // nose
    h.add(mesh(g(new THREE.ConeGeometry(0.016, 0.042, 8).rotateX(-Math.PI / 2 + 0.25).translate(0, 0.055, -0.104)), S.skin));
    // eyes + brows
    for (const s of [-1, 1]) {
      h.add(mesh(g(new THREE.SphereGeometry(0.011, 10, 8).translate(s * 0.033, 0.085, -0.093)), S.eye, false));
      h.add(mesh(g(new THREE.BoxGeometry(0.03, 0.007, 0.01).rotateZ(s * -0.12).translate(s * 0.034, 0.104, -0.095)), S.brow, false));
      // ears
      h.add(mesh(g(new THREE.SphereGeometry(1, 10, 8).scale(0.012, 0.028, 0.018).translate(s * 0.09, 0.07, 0.0)), S.skin));
    }
    // mouth
    h.add(mesh(g(new THREE.BoxGeometry(0.036, 0.007, 0.01).translate(0, 0.022, -0.094)), S.lip, false));
    // short hair: cap over the crown, a little longer at the back, clear of the face
    h.add(
      mesh(
        g(new THREE.SphereGeometry(1, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.52).scale(0.094, 0.11, 0.108).rotateX(0.18).translate(0, 0.088, 0.006)),
        S.hairMat,
      ),
    );
  }

  setShirt(color: number) {
    this.tee.color.setHex(color);
  }

  /** speed in m/s from network motion; dt in seconds. */
  animate(dt: number, speed: number) {
    const moving = Math.min(1, speed / 1.2);
    const sprint = Math.min(1, Math.max(0, (speed - 3.2) / 1.5));
    this.phase += dt * (speed > 0.15 ? 2.2 + speed * 1.55 : 0);
    const s = Math.sin(this.phase);
    const amp = (0.42 + sprint * 0.25) * moving;
    for (let i = 0; i < 2; i++) {
      const sg = i === 0 ? 1 : -1;
      const sw = s * sg;
      this.thigh[i]!.rotation.x = sw * amp;
      // knee bends only backwards, mostly while the leg swings forward
      this.shin[i]!.rotation.x = Math.max(0, -Math.cos(this.phase + (i ? Math.PI : 0))) * (0.55 + sprint * 0.5) * moving + 0.03;
      this.upper[i]!.rotation.x = -sw * amp * 0.75;
      this.upper[i]!.rotation.z = (i === 0 ? 1 : -1) * 0.06; // arms hang just off the hips
      this.fore[i]!.rotation.x = -(0.15 + moving * (0.25 + sprint * 0.6));
    }
    // plant the stance foot: hip height = vertical reach of the longer leg
    let reach = 0;
    for (let i = 0; i < 2; i++) {
      const a = this.thigh[i]!.rotation.x;
      const k = this.shin[i]!.rotation.x;
      reach = Math.max(reach, 0.06 + 0.44 * Math.cos(a) + 0.428 * Math.cos(a + k));
    }
    this.hips.position.y = reach + 0.012;
    // shoes stay parallel to the floor (no toe digging through it)
    for (let i = 0; i < 2; i++) this.foot[i]!.rotation.x = -(this.thigh[i]!.rotation.x + this.shin[i]!.rotation.x);
    this.chest.rotation.y = s * 0.06 * moving;
    this.chest.rotation.x = -0.05 * sprint;
    // idle breathing
    this.chest.scale.setScalar(1 + Math.sin(performance.now() * 0.0018) * 0.004 * (1 - moving));
  }

  dispose() {
    for (const g of this.own) g.dispose();
    this.tee.dispose();
  }
}
