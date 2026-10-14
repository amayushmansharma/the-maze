import * as THREE from "three";
import { CELL, GRID, zoneOfCell } from "./maze";
import type { BuiltLevel, Collider } from "./world";

export interface MoveInput {
  forward: number; // -1..1
  strafe: number; // -1..1
  sprint: boolean;
}

const GRAVITY = 20;
const WALK = 3.0; // m/s, brisk human walk
const SPRINT = 4.9; // moderate jog: fast, still easy to steer through junctions
const ACCEL = 13; // 1/s exponential approach to target velocity
const BRAKE = 16; // 1/s exponential stop when keys are released
const AIR_ACCEL = 2;

export class Player {
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  radius = 0.34;
  height = 1.78;
  eye = 1.63;
  onGround = true;
  bobPhase = 0;
  bobAmount = 0;
  roll = 0;
  landDip = 0;
  stepAccum = 0;
  distanceWalked = 0;
  wet = 0;
  /** fired when a footstep should play */
  onStep: (surface: "concrete" | "metal" | "water" | "soil", speed: number) => void = () => {};

  reset(pos: THREE.Vector3, yaw: number) {
    this.pos.copy(pos);
    this.pos.y = 0;
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.onGround = true;
    this.bobPhase = 0;
    this.bobAmount = 0;
    this.roll = 0;
    this.stepAccum = 0;
  }

  look(dx: number, dy: number, sensitivity: number, invertY: boolean) {
    // ignore the occasional bogus spike some browsers emit right after pointer lock
    if (Math.abs(dx) > 400 || Math.abs(dy) > 400) return;
    const s = sensitivity * 0.0021;
    this.yaw -= dx * s;
    this.pitch -= (invertY ? -dy : dy) * s;
    const lim = Math.PI / 2 - 0.06;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
  }

  get forward(): THREE.Vector3 {
    return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }
  get right(): THREE.Vector3 {
    return new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  eyePosition(out: THREE.Vector3): THREE.Vector3 {
    const bobY = Math.sin(this.bobPhase * 2) * this.bobAmount;
    const bobX = Math.cos(this.bobPhase) * this.bobAmount * 0.7;
    const r = this.right;
    out.set(
      this.pos.x + r.x * bobX,
      this.pos.y + this.eye + bobY - this.landDip,
      this.pos.z + r.z * bobX,
    );
    return out;
  }

  update(dt: number, input: MoveInput, level: BuiltLevel, headBob: number, motion: boolean) {
    // wish direction on the ground plane; normalised so diagonals are not faster
    const f = this.forward;
    const r = this.right;
    const wx = f.x * input.forward + r.x * input.strafe;
    const wz = f.z * input.forward + r.z * input.strafe;
    const wl = Math.hypot(wx, wz);
    const dirX = wl > 1e-6 ? wx / wl : 0;
    const dirZ = wl > 1e-6 ? wz / wl : 0;

    // sprint only while moving forwards (keeps backpedalling/strafing controlled)
    const sprinting = input.sprint && input.forward > 0;
    const speed = wl > 1e-6 ? (sprinting ? SPRINT : WALK) : 0;
    // exponential smoothing => identical feel at 30, 60 or 240 fps
    const rate = !this.onGround ? AIR_ACCEL : wl > 1e-6 ? ACCEL : BRAKE;
    const k = 1 - Math.exp(-rate * dt);
    this.vel.x += (dirX * speed - this.vel.x) * k;
    this.vel.z += (dirZ * speed - this.vel.z) * k;
    if (wl < 1e-6 && Math.hypot(this.vel.x, this.vel.z) < 0.05) {
      this.vel.x = 0;
      this.vel.z = 0;
    }
    this.vel.y -= GRAVITY * dt;

    // integrate with sub-steps so fast movement can never tunnel through walls
    const steps = Math.max(1, Math.min(6, Math.ceil(dt / 0.01)));
    const sdt = dt / steps;
    for (let s = 0; s < steps; s++) {
      this.pos.x += this.vel.x * sdt;
      this.pos.z += this.vel.z * sdt;
      this.collide(level);
      this.pos.y += this.vel.y * sdt;
      if (this.pos.y <= 0) {
        this.pos.y = 0;
        this.vel.y = 0;
        this.onGround = true;
      } else {
        this.onGround = false;
      }
    }

    // safety net: inside the maze, or inside the exit vestibule beyond any of the
    // 4 outer boundaries (walls and colliders do the real work)
    const minBound = -14;
    const maxBound = GRID * CELL + 14;
    this.pos.x = Math.max(minBound, Math.min(maxBound, this.pos.x));
    this.pos.z = Math.max(minBound, Math.min(maxBound, this.pos.z));

    // subtle head bob tied to actual ground speed
    const planar = Math.hypot(this.vel.x, this.vel.z);
    const bobScale = headBob * Math.min(1, planar / SPRINT) * (this.onGround ? 1 : 0);
    this.bobPhase += dt * (sprinting ? 10.5 : 8.0) * Math.min(1, planar / WALK);
    this.bobAmount += (bobScale * 0.03 - this.bobAmount) * (1 - Math.exp(-8 * dt));
    const targetRoll = motion ? -input.strafe * 0.008 * Math.min(1, planar / WALK) : 0;
    this.roll += (targetRoll - this.roll) * (1 - Math.exp(-6 * dt));
    this.landDip = 0;

    // footsteps
    if (this.onGround && planar > 0.4) {
      this.stepAccum += planar * dt;
      const stride = sprinting ? 1.9 : 1.45;
      if (this.stepAccum >= stride) {
        this.stepAccum = 0;
        const zone = zoneOfCell(this.cellI(), this.cellJ());
        const surface: "concrete" | "metal" | "water" | "soil" =
          zone.id === "B" ? "metal" : zone.id === "C" ? "soil" : this.wet > 0.4 ? "water" : "concrete";
        this.onStep(surface, Math.min(1, planar / SPRINT));
      }
    }
    this.distanceWalked += planar * dt;
    const inWater = level.waterCells.has(this.cellJ() * GRID + this.cellI());
    this.wet += ((inWater ? 1 : 0) - this.wet) * Math.min(1, dt * (inWater ? 6 : 0.25));
  }

  cellI(): number {
    return Math.max(0, Math.min(GRID - 1, Math.floor(this.pos.x / CELL)));
  }
  cellJ(): number {
    return Math.max(0, Math.min(GRID - 1, Math.floor(this.pos.z / CELL)));
  }

  /** Circle vs AABB resolution against nearby static colliders. */
  private collide(level: BuiltLevel) {
    const r = this.radius;
    for (let pass = 0; pass < 3; pass++) {
      let any = false;
      const ci = this.cellI();
      const cj = this.cellJ();
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          const list = level.grid.get((cj + dj) * GRID + (ci + di));
          if (!list) continue;
          for (const index of list) {
            const c: Collider = level.colliders[index];
            if (!c) continue;
            if (c.minX > c.maxX || c.minZ > c.maxZ) continue; // disabled (open door)
            const cx = Math.max(c.minX, Math.min(this.pos.x, c.maxX));
            const cz = Math.max(c.minZ, Math.min(this.pos.z, c.maxZ));
            let dx = this.pos.x - cx;
            let dz = this.pos.z - cz;
            const d2 = dx * dx + dz * dz;
            if (d2 >= r * r) continue;
            any = true;
            if (d2 > 1e-8) {
              const d = Math.sqrt(d2);
              const push = (r - d) / d;
              this.pos.x += dx * push;
              this.pos.z += dz * push;
              // kill velocity into the surface (wall sliding)
              const nx = dx / d;
              const nz = dz / d;
              const vn = this.vel.x * nx + this.vel.z * nz;
              if (vn < 0) {
                this.vel.x -= vn * nx;
                this.vel.z -= vn * nz;
              }
            } else {
              // centre inside the box: push out along the shallowest axis
              const toLeft = Math.abs(this.pos.x - c.minX);
              const toRight = Math.abs(c.maxX - this.pos.x);
              const toBack = Math.abs(this.pos.z - c.minZ);
              const toFront = Math.abs(c.maxZ - this.pos.z);
              const m = Math.min(toLeft, toRight, toBack, toFront);
              if (m === toLeft) {
                this.pos.x = c.minX - r;
                if (this.vel.x > 0) this.vel.x = 0;
              } else if (m === toRight) {
                this.pos.x = c.maxX + r;
                if (this.vel.x < 0) this.vel.x = 0;
              } else if (m === toBack) {
                this.pos.z = c.minZ - r;
                if (this.vel.z > 0) this.vel.z = 0;
              } else {
                this.pos.z = c.maxZ + r;
                if (this.vel.z < 0) this.vel.z = 0;
              }
            }
          }
        }
      }
      if (!any) break;
    }
  }

  /** Camera pitch/yaw applied to a quaternion (with restrained roll). */
  applyToCamera(camera: THREE.PerspectiveCamera) {
    const e = new THREE.Euler(this.pitch, this.yaw, this.roll, "YXZ");
    camera.quaternion.setFromEuler(e);
  }

  zoneId() {
    return zoneOfCell(this.cellI(), this.cellJ()).id;
  }

  zoneName() {
    return zoneOfCell(this.cellI(), this.cellJ()).name;
  }
}

