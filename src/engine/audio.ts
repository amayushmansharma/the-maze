import * as THREE from "three";
import { Rng } from "./rng";
import type { Settings } from "./types";

type Surface = "concrete" | "metal" | "water" | "soil";

/** Fully procedural audio: no external files, everything synthesised. */
export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private ambBus!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private reverbSend!: GainNode;
  private noise!: AudioBuffer;
  private rumbleGain!: GainNode;
  private windGain!: GainNode;
  private humGain!: GainNode;
  private humOsc: OscillatorNode[] = [];
  private droneNodes: { osc: OscillatorNode[]; gain: GainNode } | null = null;
  private rng = new Rng(9182);
  private listenerPos = new THREE.Vector3();
  private forward = new THREE.Vector3(0, 0, -1);
  private nextDrip = 0;
  private nextCreak = 0;
  private nextFoot = 0;
  private settings: Settings;
  private started = false;

  constructor(settings: Settings) {
    this.settings = settings;
  }

  get ready() {
    return !!this.ctx && this.started;
  }

  /** Must be called from a user gesture. */
  async init() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") await this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = new Ctor();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.settings.master;
    this.master.connect(ctx.destination);

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 18;
    comp.ratio.value = 4;
    comp.connect(this.master);

    this.ambBus = ctx.createGain();
    this.ambBus.gain.value = this.settings.ambience;
    this.ambBus.connect(comp);
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = this.settings.sfx;
    this.sfxBus.connect(comp);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.settings.music;
    this.musicBus.connect(comp);

    // procedural impulse response for a small concrete room
    const conv = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 1.9);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      const r = new Rng(77 + ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        d[i] = (r.next() * 2 - 1) * Math.pow(1 - t, 2.6) * (i < 400 ? i / 400 : 1);
      }
    }
    conv.buffer = ir;
    const revGain = ctx.createGain();
    revGain.gain.value = 0.55;
    conv.connect(revGain).connect(comp);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.5;
    this.reverbSend.connect(conv);

    // white noise buffer reused by every effect
    const nlen = Math.floor(ctx.sampleRate * 3);
    const nb = ctx.createBuffer(1, nlen, ctx.sampleRate);
    const nd = nb.getChannelData(0);
    let last = 0;
    for (let i = 0; i < nlen; i++) {
      const w = Math.random() * 2 - 1;
      last = (last + 0.02 * w) / 1.02;
      nd[i] = w * 0.6 + last * 2.2;
    }
    this.noise = nb;

    this.buildAmbience();
    this.started = true;
  }

  private buildAmbience() {
    const ctx = this.ctx!;
    // low rumble
    const rsrc = ctx.createBufferSource();
    rsrc.buffer = this.noise;
    rsrc.loop = true;
    const rlp = ctx.createBiquadFilter();
    rlp.type = "lowpass";
    rlp.frequency.value = 120;
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0.1;
    rsrc.connect(rlp).connect(this.rumbleGain).connect(this.ambBus);
    rsrc.start();

    // wind (outdoor / hedges)
    const wsrc = ctx.createBufferSource();
    wsrc.buffer = this.noise;
    wsrc.loop = true;
    const wbp = ctx.createBiquadFilter();
    wbp.type = "bandpass";
    wbp.frequency.value = 620;
    wbp.Q.value = 0.7;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    wsrc.connect(wbp).connect(this.windGain).connect(this.ambBus);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.08;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 260;
    lfo.connect(lfoGain).connect(wbp.frequency);
    lfo.start();
    wsrc.start();

    // electrical / ventilation hum
    this.humGain = ctx.createGain();
    this.humGain.gain.value = 0;
    this.humGain.connect(this.ambBus);
    for (const f of [58, 116, 233]) {
      const o = ctx.createOscillator();
      o.type = f > 200 ? "triangle" : "sawtooth";
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = f === 58 ? 0.05 : f === 116 ? 0.022 : 0.008;
      o.connect(g).connect(this.humGain);
      o.start();
      this.humOsc.push(o);
    }
  }

  setVolumes(s: Settings) {
    this.settings = s;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.master, t, 0.05);
    this.ambBus.gain.setTargetAtTime(s.ambience, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(s.sfx, t, 0.05);
    this.musicBus.gain.setTargetAtTime(s.music, t, 0.05);
  }

  suspend() {
    this.ctx?.suspend();
  }
  resume() {
    if (this.ctx?.state === "suspended") void this.ctx.resume();
  }

  setListener(pos: THREE.Vector3, forward: THREE.Vector3) {
    this.listenerPos.copy(pos);
    this.forward.copy(forward);
  }

  private pan(gainValue: number, pos?: THREE.Vector3, refDist = 5): { node: GainNode; pan: StereoPannerNode } {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    const p = ctx.createStereoPanner();
    let vol = gainValue;
    if (pos) {
      const rel = pos.clone().sub(this.listenerPos);
      const d = rel.length();
      vol *= 1 / (1 + (d * d) / (refDist * refDist * 1.6));
      const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), this.forward).normalize();
      p.pan.value = Math.max(-1, Math.min(1, rel.normalize().dot(right)));
    } else {
      p.pan.value = this.rng.range(-0.25, 0.25);
    }
    g.gain.value = vol;
    g.connect(p);
    p.connect(this.sfxBus);
    p.connect(this.reverbSend);
    return { node: g, pan: p };
  }

  private noiseBurst(dur: number, type: BiquadFilterType, freq: number, q: number, gain: number, pos?: THREE.Vector3, refDist = 5, sweepTo?: number) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = this.rng.range(0.85, 1.2);
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(Math.max(40, sweepTo), ctx.currentTime + dur);
    const { node } = this.pan(gain, pos, refDist);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, ctx.currentTime);
    env.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0008, ctx.currentTime + dur);
    src.connect(f).connect(env).connect(node);
    src.start(ctx.currentTime, this.rng.next() * 2, dur + 0.05);
    src.stop(ctx.currentTime + dur + 0.06);
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType = "sine", pos?: THREE.Vector3, glideTo?: number) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, ctx.currentTime);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, glideTo), ctx.currentTime + dur);
    const { node } = this.pan(gain, pos, 4);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, ctx.currentTime);
    env.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0007, ctx.currentTime + dur);
    o.connect(env).connect(node);
    o.start();
    o.stop(ctx.currentTime + dur + 0.05);
  }

  /* --------------------------- game sounds -------------------------- */
  footstep(surface: Surface, intensity: number) {
    if (!this.ctx) return;
    const t = performance.now();
    if (t - this.nextFoot < 90) return;
    this.nextFoot = t;
    const g = 0.1 + intensity * 0.12;
    switch (surface) {
      case "concrete":
        this.noiseBurst(0.085, "bandpass", 1500, 1.1, g * 0.8, undefined, 2);
        this.tone(92, 0.09, g * 0.5, "sine", undefined, 60);
        break;
      case "metal":
        this.noiseBurst(0.07, "bandpass", 2600, 2.2, g * 0.6, undefined, 2);
        this.tone(240, 0.16, g * 0.32, "triangle", undefined, 180);
        this.tone(430, 0.1, g * 0.14, "sine");
        break;
      case "water":
        this.noiseBurst(0.22, "lowpass", 2400, 0.8, g * 0.9, undefined, 2, 500);
        this.tone(320, 0.09, g * 0.25, "sine", undefined, 140);
        break;
      case "soil":
        this.noiseBurst(0.13, "bandpass", 900, 0.9, g * 0.85, undefined, 2);
        this.tone(74, 0.08, g * 0.35, "sine", undefined, 50);
        break;
    }
  }

  cloth(intensity: number) {
    this.noiseBurst(0.16, "bandpass", 3800, 0.6, 0.02 + intensity * 0.02, undefined, 1.5);
  }

  flashlight(on: boolean) {
    this.tone(on ? 2100 : 1500, 0.035, 0.09, "square");
    this.noiseBurst(0.03, "highpass", 3000, 1, 0.05);
  }

  door(kind: "metal" | "rusty" | "exit", pos?: THREE.Vector3) {
    this.noiseBurst(0.9, "bandpass", kind === "exit" ? 900 : 520, 6, 0.12, pos, 6, kind === "exit" ? 400 : 260);
    this.tone(kind === "exit" ? 520 : 180, 0.7, 0.05, "triangle", pos, kind === "exit" ? 300 : 110);
    this.tone(70, 0.5, 0.07, "sine", pos, 45);
  }

  gate(pos?: THREE.Vector3) {
    // motor + chain lifting a heavy gate
    this.tone(48, 2.6, 0.09, "sawtooth", pos, 62);
    this.noiseBurst(2.4, "bandpass", 700, 3, 0.09, pos, 6);
    for (let i = 0; i < 5; i++) {
      const d = 0.25 + i * 0.42;
      setTimeout(() => this.tone(120 - i * 8, 0.16, 0.05, "square", pos, 70), d * 1000);
    }
    setTimeout(() => this.tone(64, 0.7, 0.1, "sine", pos, 40), 2500);
  }

  locked(pos?: THREE.Vector3) {
    this.noiseBurst(0.18, "bandpass", 2000, 5, 0.12, pos, 3);
    this.tone(140, 0.16, 0.06, "square", pos, 90);
  }

  unlock(pos?: THREE.Vector3) {
    this.tone(900, 0.06, 0.07, "square", pos);
    setTimeout(() => this.tone(1300, 0.08, 0.06, "square", pos), 90);
    setTimeout(() => this.tone(420, 0.4, 0.06, "triangle", pos, 260), 200);
  }

  pickup() {
    this.tone(660, 0.09, 0.07, "triangle");
    setTimeout(() => this.tone(990, 0.14, 0.05, "sine"), 70);
  }

  paper() {
    this.noiseBurst(0.35, "highpass", 2200, 0.7, 0.09, undefined, 2);
  }

  breaker(on: boolean) {
    this.tone(on ? 90 : 70, 0.35, 0.14, "square", undefined, 50);
    this.noiseBurst(0.2, "bandpass", 1800, 2, 0.16, undefined, 3);
    setTimeout(() => {
      this.tone(58, 2.4, 0.05, "sawtooth");
      this.noiseBurst(1.2, "bandpass", 400, 1.5, 0.05);
    }, 220);
  }

  jump() {
    this.noiseBurst(0.12, "bandpass", 700, 1, 0.04);
  }
  land(force: number) {
    this.tone(66, 0.14, 0.06 + force * 0.05, "sine", undefined, 42);
    this.noiseBurst(0.1, "bandpass", 900, 1, 0.05);
  }

  exitSting() {
    if (!this.ctx) return;
    const notes = [196, 261.6, 329.6, 392, 523.3];
    notes.forEach((f, i) => {
      setTimeout(() => {
        this.tone(f, 2.6, 0.06, "sine");
        this.tone(f * 2, 2.0, 0.02, "sine");
      }, i * 260);
    });
    this.noiseBurst(3.4, "lowpass", 900, 0.6, 0.05, undefined, 2, 200);
  }

  drone(on: boolean) {
    if (!this.ctx) return;
    if (on && !this.droneNodes) {
      const ctx = this.ctx;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.gain.setTargetAtTime(0.16, ctx.currentTime, 2.5);
      gain.connect(this.musicBus);
      const osc: OscillatorNode[] = [];
      for (const [f, t, g] of [
        [55, "sine", 0.5],
        [82.4, "sine", 0.28],
        [110, "triangle", 0.12],
        [164.8, "sine", 0.06],
      ] as [number, OscillatorType, number][]) {
        const o = ctx.createOscillator();
        o.type = t;
        o.frequency.value = f;
        const og = ctx.createGain();
        og.gain.value = g;
        o.connect(og).connect(gain);
        o.start();
        osc.push(o);
      }
      this.droneNodes = { osc, gain };
    } else if (!on && this.droneNodes) {
      const { osc, gain } = this.droneNodes;
      gain.gain.setTargetAtTime(0, this.ctx.currentTime, 1.2);
      setTimeout(() => {
        osc.forEach((o) => {
          try {
            o.stop();
          } catch {
            /* already stopped */
          }
        });
        gain.disconnect();
      }, 4000);
      this.droneNodes = null;
    }
  }

  /** scripted atmosphere: distant metal creak / slam */
  creak(pos?: THREE.Vector3) {
    const ctx = this.ctx;
    if (!ctx) return;
    this.noiseBurst(1.4, "bandpass", this.rng.range(300, 900), 9, 0.08, pos, 14, this.rng.range(150, 400));
    this.tone(this.rng.range(90, 200), 1.1, 0.03, "sawtooth", pos, 60);
  }

  slam(pos?: THREE.Vector3) {
    this.tone(56, 0.9, 0.12, "sine", pos, 34);
    this.noiseBurst(0.4, "lowpass", 1200, 1, 0.12, pos, 12, 200);
  }

  silhouette() {
    this.noiseBurst(1.8, "bandpass", 240, 4, 0.06, undefined, 16, 120);
    this.tone(41, 2.4, 0.05, "sine", undefined, 34);
  }

  /* ----------------------------- update ----------------------------- */
  update(dt: number, zone: string, inWater: boolean, speed: number, outdoors: number) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const target = {
      rumble: zone === "C" ? 0.02 : zone === "E" ? 0.13 : zone === "D" ? 0.11 : 0.085,
      wind: outdoors * 0.16,
      hum: zone === "B" ? 0.85 : zone === "A" ? 0.35 : zone === "D" ? 0.2 : 0.05,
    };
    this.rumbleGain.gain.setTargetAtTime(target.rumble, t, 0.8);
    this.windGain.gain.setTargetAtTime(target.wind, t, 1.2);
    this.humGain.gain.setTargetAtTime(target.hum * 0.5, t, 1.0);

    this.nextDrip -= dt;
    if (this.nextDrip <= 0) {
      this.nextDrip = this.rng.range(zone === "D" ? 2.2 : zone === "E" ? 4 : 12, zone === "D" ? 6 : 20);
      if (zone === "D" || zone === "E" || this.rng.bool(0.3)) {
        const p = this.listenerPos
          .clone()
          .add(new THREE.Vector3(this.rng.range(-6, 6), this.rng.range(1.5, 3), this.rng.range(-6, 6)));
        this.tone(this.rng.range(900, 1700), 0.22, 0.05, "sine", p, 320);
        if (inWater) this.noiseBurst(0.16, "bandpass", 1400, 1.4, 0.03, p, 5);
      }
    }
    this.nextCreak -= dt;
    if (this.nextCreak <= 0) {
      this.nextCreak = this.rng.range(22, 55);
      const p = this.listenerPos
        .clone()
        .add(new THREE.Vector3(this.rng.range(-12, 12), 1.5, this.rng.range(-12, 12)));
      if (this.rng.bool(0.6)) this.creak(p);
      else this.slam(p);
    }
    // fabric rustle while walking
    if (speed > 0.6 && this.rng.bool(dt * 1.4)) this.cloth(Math.min(1, speed / 4));
  }
}
