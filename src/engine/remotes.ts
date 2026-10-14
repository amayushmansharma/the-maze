import * as THREE from "three";
import { INTERP_DELAY_MS } from "@/net/protocol";
import { Human } from "./human";

interface Snap {
  t: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  sprint: boolean;
}

const PALETTE = [0xb08d4a, 0x7a9bb8, 0x8a6a78, 0x6b8f71, 0xc4a882, 0x6a7b8a];

function makeLabel(name: string, color: number): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext("2d")!;
  ctx.clearRect(0, 0, 256, 64);
  ctx.fillStyle = "rgba(8,10,12,0.55)";
  ctx.fillRect(16, 16, 224, 32);
  ctx.font = "600 22px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const hex = "#" + color.toString(16).padStart(6, "0");
  ctx.fillStyle = hex;
  ctx.fillText(name.slice(0, 16), 128, 34);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const spr = new THREE.Sprite(mat);
  spr.scale.set(1.6, 0.4, 1);
  spr.position.y = 2.15;
  spr.userData.tex = tex;
  return spr;
}

class RemoteAvatar {
  group = new THREE.Group();
  snaps: Snap[] = [];
  color: number;
  name: string;
  private shown = false;
  private human: Human;
  private lastX = 0;
  private lastZ = 0;
  private speed = 0;
  constructor(name: string, color: number) {
    this.name = name;
    this.color = color;
    this.human = new Human(color);
    this.group.add(this.human.root);
    this.group.add(makeLabel(name, color));
    this.group.visible = false;
  }
  push(s: Omit<Snap, "t">) {
    this.snaps.push({ ...s, t: performance.now() });
    if (this.snaps.length > 16) this.snaps.splice(0, this.snaps.length - 16);
    this.shown = true;
    this.group.visible = true;
  }
  sample(now: number): Snap | null {
    const t = now - INTERP_DELAY_MS;
    const a = this.snaps;
    if (!a.length) return null;
    if (a.length === 1 || t <= a[0]!.t) return a[0]!;
    if (t >= a[a.length - 1]!.t) {
      const last = a[a.length - 1]!;
      if (now - last.t > 1200) return last;
      return last;
    }
    for (let i = 1; i < a.length; i++) {
      if (a[i]!.t >= t) {
        const p = a[i - 1]!;
        const n = a[i]!;
        const u = (t - p.t) / Math.max(1, n.t - p.t);
        const lerp = (x: number, y: number) => x + (y - x) * u;
        let dyaw = n.yaw - p.yaw;
        while (dyaw > Math.PI) dyaw -= Math.PI * 2;
        while (dyaw < -Math.PI) dyaw += Math.PI * 2;
        return {
          t,
          x: lerp(p.x, n.x),
          y: lerp(p.y, n.y),
          z: lerp(p.z, n.z),
          yaw: p.yaw + dyaw * u,
          pitch: lerp(p.pitch, n.pitch),
          sprint: n.sprint,
        };
      }
    }
    return a[a.length - 1]!;
  }
  update(dt: number, cam: THREE.Camera) {
    if (!this.shown) return;
    const s = this.sample(performance.now());
    if (!s) return;
    const last = this.snaps[this.snaps.length - 1];
    if (last && performance.now() - last.t > 8000) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    // ground speed from the interpolated network position drives the gait
    const inst = dt > 0 ? Math.hypot(s.x - this.lastX, s.z - this.lastZ) / dt : 0;
    this.speed += (Math.min(7, inst) - this.speed) * Math.min(1, dt * 8);
    this.lastX = s.x;
    this.lastZ = s.z;
    this.group.position.set(s.x, s.y, s.z);
    this.group.rotation.y = s.yaw;
    this.human.animate(dt, this.speed);
    const spr = this.group.children[1];
    if (spr) spr.quaternion.copy(cam.quaternion);
  }
  dispose() {
    this.human.dispose();
    const label = this.group.children[1] as THREE.Sprite | undefined;
    label?.material.map?.dispose();
    label?.material.dispose();
  }

}

export class RemoteRoster {
  root = new THREE.Group();
  private avatars = new Map<string, RemoteAvatar>();
  constructor() {
    this.root.name = "remote-players";
  }
  setMeta(id: string, name: string, color: number) {
    let a = this.avatars.get(id);
    if (!a) {
      a = new RemoteAvatar(name, color || PALETTE[this.avatars.size % PALETTE.length]!);
      this.avatars.set(id, a);
      this.root.add(a.group);
    }
  }
  push(id: string, x: number, y: number, z: number, yaw: number, pitch: number, sprint: boolean) {
    const a = this.avatars.get(id);
    if (!a) {
      this.setMeta(id, "WANDERER", PALETTE[this.avatars.size % PALETTE.length]!);
    }
    this.avatars.get(id)!.push({ x, y, z, yaw, pitch, sprint });
  }
  remove(id: string) {
    const a = this.avatars.get(id);
    if (!a) return;
    this.root.remove(a.group);
    a.dispose();
    this.avatars.delete(id);
  }
  update(dt: number, cam: THREE.Camera) {
    for (const a of this.avatars.values()) a.update(dt, cam);
  }
  clear() {
    for (const id of [...this.avatars.keys()]) this.remove(id);
  }
  dispose() {
    this.clear();
  }
}
