import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { AudioEngine } from "./audio";
import { buildLevel, circleFree, probeLevel, type BuiltLevel, type LampFixture } from "./world";
import { CELL, GRID, ZONES, cellCenter, generateMaze, hasWall, idx, mazeFingerprint, type Edge, type MazeData } from "./maze";
import { Player } from "./player";
import { RemoteRoster } from "./remotes";
import { buildSurfaces } from "./textures";
import { QUALITY_PRESETS, DEFAULT_SETTINGS, type HudState, type SaveData, type Settings } from "./types";
import { clearSave, loadSave, writeSave } from "./save";
import { buildMaterials, disposeMaterials, updateWind } from "./materials";
import { generateFreshSeed, recordConfigUsed } from "./configHistory";

export type Phase = "boot" | "idle" | "loading" | "playing" | "paused" | "map" | "ending";

/** seconds the "FIND THE EXIT." instruction stays on screen */
const INTRO_SECONDS = 4;
const MOVE_KEYS = new Set([
  "KeyW", "KeyA", "KeyS", "KeyD",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "ShiftLeft", "ShiftRight",
]);

export class Game {
  // rendering
  private renderer!: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera!: THREE.PerspectiveCamera;
  private composer: EffectComposer | null = null;
  private canvas: HTMLCanvasElement;
  private settings: Settings;
  private fog = new THREE.FogExp2(0x0d1116, 0.055);
  private fogTargetColor = new THREE.Color(0x0d1116);
  private fogTargetDensity = 0.055;

  // world
  maze!: MazeData;
  private level: BuiltLevel | null = null;
  private player = new Player();
  private audio: AudioEngine;

  // lights (fixed pools => shaders never recompile while walking)
  private pointLights: THREE.PointLight[] = [];
  private spotLights: THREE.SpotLight[] = [];
  private flashlight!: THREE.SpotLight;
  private flashTarget = new THREE.Object3D();
  private flashOn = false;
  private flashDir = new THREE.Vector3(0, 0, -1);
  private lightTimer = 0;

  // run state
  phase: Phase = "boot";
  private elapsed = 0;
  private visited: Uint8Array = new Uint8Array(GRID * GRID);
  private ending: HudState["ending"] = null;
  private fps = 60;
  private frameTimes: number[] = [];
  private time = 0;
  private saveTimer = 0;
  private eventTimer = 40;
  private hudTimer = 0;
  private ripples: { mesh: THREE.Mesh; life: number }[] = [];
  private ripplePool: THREE.Mesh[] = [];
  private spawnPos = new THREE.Vector3();
  private spawnYaw = 0;

  private remotes = new RemoteRoster();
  private coop = false;
  private coopEscaped = false;
  private coopStartAt = 0;
  private coopOffset = 0;
  private coopSlot = 0;
  private posSeq = 0;
  private posAcc = 0;
  onPos: ((p: { x: number; y: number; z: number; yaw: number; pitch: number; sprint: boolean; seq: number }) => void) | null = null;
  onCoopEscape: ((time: number) => void) | null = null;
  coopHud: HudState["coop"] = null;

  // input
  private keys = new Set<string>();
  private pointerLocked = false;
  private listeners: (() => void)[] = [];

  // callbacks
  onHud: (s: HudState) => void = () => {};
  onPhase: (p: Phase) => void = () => {};
  onLoading: (frac: number, label: string) => void = () => {};

  private rafId = 0;
  private lastTime = 0;
  private disposed = false;
  private currentSeed = 1;
  private tmp = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement, settings: Settings) {
    this.canvas = canvas;
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.audio = new AudioEngine(this.settings);
    this.player.onStep = (surface, speed) => this.audio.footstep(surface, speed);
  }

  /* ------------------------------------------------------------ *
   * boot
   * ------------------------------------------------------------ */
  async init() {
    const supported = (() => {
      try {
        const c = document.createElement("canvas");
        return !!(window.WebGLRenderingContext && (c.getContext("webgl2") || c.getContext("webgl")));
      } catch {
        return false;
      }
    })();
    if (!supported) throw new Error("WebGL is not available in this browser.");

    const preset = QUALITY_PRESETS[this.settings.quality];
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: this.settings.quality !== "low",
      powerPreference: "high-performance",
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, preset.pixelRatio) * this.settings.renderScale);
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;
    this.renderer.shadowMap.enabled = preset.shadows > 0;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.camera = new THREE.PerspectiveCamera(this.settings.fov, window.innerWidth / window.innerHeight, 0.08, 220);
    this.scene.fog = this.fog;
    this.scene.background = new THREE.Color(0x05070a);
    this.scene.add(this.camera);
    this.scene.add(this.remotes.root);

    for (let i = 0; i < 9; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 11, 2);
      l.castShadow = false;
      this.scene.add(l);
      this.pointLights.push(l);
    }
    const spotShadows = Math.max(0, preset.shadows - 1);
    for (let i = 0; i < 2; i++) {
      const l = new THREE.SpotLight(0xffffff, 0, 16, 0.9, 0.65, 1.8);
      l.castShadow = i < spotShadows;
      l.shadow.mapSize.set(preset.shadowMapSize, preset.shadowMapSize);
      l.shadow.camera.near = 0.3;
      l.shadow.camera.far = 18;
      l.shadow.bias = -0.0012;
      l.shadow.normalBias = 0.05;
      this.scene.add(l, l.target);
      this.spotLights.push(l);
    }

    this.flashlight = new THREE.SpotLight(0xfff1d6, 0, 34, 0.46, 0.62, 1.55);
    this.flashlight.castShadow = preset.shadows > 0;
    this.flashlight.shadow.mapSize.set(1024, 1024);
    this.flashlight.shadow.camera.near = 0.2;
    this.flashlight.shadow.camera.far = 32;
    this.flashlight.shadow.bias = -0.0015;
    this.flashlight.shadow.normalBias = 0.06;
    this.scene.add(this.flashlight, this.flashTarget);
    this.flashlight.target = this.flashTarget;

    await buildSurfaces((f, label) => this.onLoading(f, label));
    // React StrictMode may have disposed this instance while textures were
    // being generated: never bind listeners or start a loop for a dead game.
    if (this.disposed) return;
    buildMaterials();
    if (this.settings.quality === "high") this.setupComposer();
    this.bindEvents();
    this.startLoop();
  }

  private setupComposer() {
    try {
      const size = new THREE.Vector2();
      this.renderer.getSize(size);
      const composer = new EffectComposer(this.renderer);
      composer.addPass(new RenderPass(this.scene, this.camera));
      composer.addPass(new UnrealBloomPass(size, 0.42, 0.72, 0.82));
      composer.addPass(new OutputPass());
      composer.setPixelRatio(this.renderer.getPixelRatio());
      composer.setSize(size.x, size.y);
      this.composer = composer;
    } catch {
      this.composer = null;
    }
  }

  get isDisposed() {
    return this.disposed;
  }

  /* ------------------------------------------------------------ *
   * level construction (validated before the player ever sees it)
   * ------------------------------------------------------------ */
  private buildValidated(seed: number): number {
    for (let attempt = 0; attempt < 6; attempt++) {
      const s = seed + attempt * 104729;
      this.disposeLevel();
      const maze = generateMaze(s);
      const level = buildLevel(maze, QUALITY_PRESETS[this.settings.quality]);
      const probe = probeLevel(level, maze);
      this.maze = maze;
      this.level = level;
      this.scene.add(level.root);
      if (maze.report.ok && probe.ok) {
        console.info(
          `[THE MAZE] seed ${s} validated — exit ${maze.report.exitDistance} cells from spawn, ` +
            `${maze.report.deadEnds} dead ends, ${maze.report.tJunctions} T-junctions, ` +
            `${maze.report.crossings} crossings, ${maze.report.loops} loops; ` +
            `${probe.openEdges} passages swept clear, ${probe.wallEdges} walls solid.`,
        );
        return s;
      }
      console.warn(`[THE MAZE] seed ${s} rejected`, [...maze.report.problems, ...probe.problems]);
    }
    return seed; // last attempt is kept; warnings above explain why
  }

  /** Face the longest open corridor from the spawn so the first view invites exploring. */
  private computeSpawnYaw(): number {
    const [si, sj] = this.maze.spawn;
    let best = 0;
    let bestYaw = 0;
    for (const [dx, dz] of [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ]) {
      let run = 0;
      let i = si;
      let j = sj;
      for (;;) {
        const e: Edge =
          dx === 1 ? { axis: "V", i: i + 1, j } : dx === -1 ? { axis: "V", i, j } : dz === 1 ? { axis: "H", i, j: j + 1 } : { axis: "H", i, j };
        if (hasWall(this.maze, e)) break;
        i += dx;
        j += dz;
        if (i < 0 || j < 0 || i >= GRID || j >= GRID) break;
        run++;
      }
      if (run > best) {
        best = run;
        bestYaw = Math.atan2(-dx, -dz);
      }
    }
    return bestYaw;
  }

  /* ------------------------------------------------------------ *
   * co-op hooks
   * ------------------------------------------------------------ */
  fingerprint(): string {
    return this.maze ? mazeFingerprint(this.maze) : "";
  }

  beginCoop(opts: { slot: number; startAt: number; offset: number }) {
    this.coop = true;
    this.coopEscaped = false;
    this.coopSlot = opts.slot;
    this.coopStartAt = opts.startAt;
    this.coopOffset = opts.offset;
    this.ending = null;
  }

  endCoop() {
    this.coop = false;
    this.coopEscaped = false;
    this.onPos = null;
    this.onCoopEscape = null;
    this.coopHud = null;
    this.remotes.clear();
  }

  applyRemote(id: string, x: number, y: number, z: number, yaw: number, pitch: number, sprint: boolean) {
    this.remotes.push(id, x, y, z, yaw, pitch, sprint);
  }

  setRemoteMeta(id: string, name: string, color: number) {
    this.remotes.setMeta(id, name, color);
  }

  removeRemote(id: string) {
    this.remotes.remove(id);
  }

  /* ------------------------------------------------------------ *
   * session control
   * ------------------------------------------------------------ */
  async newGame(seed?: number) {
    this.endCoop();
    const s = seed != null && Number.isFinite(seed) && seed > 0 ? Math.floor(seed) : generateFreshSeed();
    await this.startSession(s, null);
    if (this.maze) recordConfigUsed(this.maze.spawn, this.maze.exitCell);
  }

  async continueGame() {
    this.endCoop();
    const save = loadSave();
    if (!save) return this.newGame();
    await this.startSession(save.seed, save);
    if (this.maze) recordConfigUsed(this.maze.spawn, this.maze.exitCell);
  }

  async startCoopRun(seed: number, slot: number, startAt: number, offset: number) {
    this.beginCoop({ slot, startAt, offset });
    await this.startSession(seed, null);
    if (this.maze) recordConfigUsed(this.maze.spawn, this.maze.exitCell);
  }

  private async startSession(seed: number, save: SaveData | null) {
    this.setPhase("loading");
    try {
      await this.audio.init();
    } catch {
      /* audio is optional */
    }
    this.audio.setVolumes(this.settings);
    this.audio.drone(false);
    this.onLoading(0.95, "building maze");
    await new Promise((r) => setTimeout(r, 30));
    if (this.disposed) return;
    this.currentSeed = this.buildValidated(seed);
    this.spawnPos.copy(this.level!.spawn).setY(0);
    if (this.coop) {
      const ox = ((this.coopSlot % 3) - 1) * 0.7;
      const oz = (Math.floor(this.coopSlot / 3) - 0.3) * 0.7;
      this.spawnPos.x += ox;
      this.spawnPos.z += oz;
    }
    this.spawnYaw = this.computeSpawnYaw();
    this.resetRun(this.coop ? null : save);
    this.setPhase("playing");
    this.requestPointerLock();
    if (!this.coop) this.autosave();
  }

  /** Puts the player back at the spawn of the current maze (or a save point). */
  private resetRun(save: SaveData | null) {
    if (!this.level) return;
    this.visited.fill(0);
    this.elapsed = 0;
    this.ending = null;
    this.eventTimer = 40;
    this.saveTimer = 20;
    this.keys.clear();
    for (const r of this.ripples) r.mesh.visible = false;
    this.ripplePool.push(...this.ripples.map((r) => r.mesh));
    this.ripples = [];

    const pos = this.spawnPos.clone();
    let yaw = this.spawnYaw;
    let pitch = 0;
    if (save && circleFree(this.level, save.pos[0], save.pos[2])) {
      pos.set(save.pos[0], 0, save.pos[2]);
      yaw = save.yaw;
      pitch = save.pitch;
      this.elapsed = Math.max(0, save.elapsed);
      this.flashOn = !!save.flashlight;
      this.restoreVisited(save.visited);
    }
    this.player.reset(pos, yaw);
    this.player.pitch = pitch;
    this.player.distanceWalked = 0;
    this.markVisited(true);

    const zone = ZONES[this.maze.zone[idx(this.player.cellI(), this.player.cellJ())]];
    this.fog.color.setHex(zone.fogColor);
    this.fog.density = zone.fog;
    this.fogTargetColor.setHex(zone.fogColor);
    this.fogTargetDensity = zone.fog;
    this.camera.position.copy(this.player.eyePosition(this.tmp));
    this.player.applyToCamera(this.camera);
    this.lightTimer = 0;
    this.assignLights();
  }

  private restoreVisited(words: number[]) {
    for (let n = 0; n < words.length && n * 32 < this.visited.length; n++) {
      const w = words[n];
      for (let b = 0; b < 32; b++) {
        const k = n * 32 + b;
        if (k < this.visited.length && w & (1 << b)) this.visited[k] = 1;
      }
    }
  }

  /** Restart: same maze, back to spawn, timer at zero. Nothing is rebuilt. */
  restart() {
    if (!this.level) return;
    this.resetRun(null);
    this.setPhase("playing");
    this.requestPointerLock();
    this.autosave();
  }

  /** Play again after escaping: a fresh layout avoiding recent configurations. */
  playAgain() {
    const s = generateFreshSeed();
    void this.startSession(s, null).then(() => {
      if (this.maze) recordConfigUsed(this.maze.spawn, this.maze.exitCell);
    });
  }

  /** Builds a real slice of the maze for the main-menu backdrop. */
  async showMenu(seed = 20260214) {
    if (!this.renderer || this.disposed) return;
    this.setPhase("loading");
    await new Promise((r) => setTimeout(r, 0));
    if (this.disposed) return;
    this.buildValidated(seed);
    const [x, z] = cellCenter(this.maze.spawn[0], this.maze.spawn[1]);
    this.spawnPos.set(x, 0, z);
    this.player.reset(this.spawnPos, this.computeSpawnYaw());
    this.camera.position.set(x, 1.62, z);
    this.player.applyToCamera(this.camera);
    const zone = ZONES[this.maze.zone[idx(this.maze.spawn[0], this.maze.spawn[1])]];
    this.fog.color.setHex(zone.fogColor);
    this.fog.density = zone.fog * 0.85;
    (this.scene.background as THREE.Color).setHex(0x05070a);
    this.assignLights();
    this.updateLights();
    this.flashlight.intensity = 0;
    this.setPhase("idle");
    if (this.audio.ready) this.audio.drone(true);
  }

  quitToMenu() {
    if (this.phase !== "ending") this.autosave();
    this.keys.clear();
    this.releasePointerLock();
  }

  setPhase(p: Phase) {
    this.phase = p;
    this.keys.clear(); // no key held in a menu can move the player afterwards
    this.onPhase(p);
    this.pushHud();
  }

  pause() {
    if (this.phase !== "playing" && this.phase !== "map") return;
    this.releasePointerLock();
    this.setPhase("paused");
    this.autosave();
  }

  resume() {
    if (this.phase !== "paused") return;
    this.setPhase("playing");
    this.requestPointerLock();
  }

  /* ------------------------------------------------------------ *
   * input (bound exactly once per Game instance)
   * ------------------------------------------------------------ */
  private bindEvents() {
    const kd = (e: KeyboardEvent) => {
      const k = e.code;
      const inGame = this.phase === "playing" || this.phase === "map";
      if (inGame && ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Tab"].includes(k)) e.preventDefault();
      if (this.phase === "playing") {
        if (MOVE_KEYS.has(k)) this.keys.add(k);
        if (e.repeat) return;
        if (k === "KeyF") this.toggleFlashlight();
        else if (k === "KeyM") this.toggleMap();
        else if (k === "Escape") this.pause();
      } else if (this.phase === "map") {
        if (e.repeat) return;
        if (k === "KeyM") this.toggleMap();
        else if (k === "Escape") this.pause();
      }
    };
    const ku = (e: KeyboardEvent) => this.keys.delete(e.code);
    const mm = (e: MouseEvent) => {
      if (!this.pointerLocked || this.phase !== "playing") return;
      this.player.look(e.movementX, e.movementY, this.settings.sensitivity, this.settings.invertY);
    };
    const plc = () => {
      this.pointerLocked = document.pointerLockElement === this.canvas;
      // Escape while locked is consumed by the browser: losing the lock = pause
      if (!this.pointerLocked && this.phase === "playing") this.pause();
    };
    const blur = () => {
      this.keys.clear();
      if (this.phase === "playing" || this.phase === "map") this.pause();
    };
    const vis = () => {
      this.keys.clear();
      if (document.hidden && (this.phase === "playing" || this.phase === "map")) this.pause();
    };
    const resize = () => this.resize();
    const ctx = (e: Event) => e.preventDefault();

    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    window.addEventListener("blur", blur);
    document.addEventListener("visibilitychange", vis);
    document.addEventListener("pointerlockchange", plc);
    document.addEventListener("mousemove", mm);
    window.addEventListener("resize", resize);
    this.canvas.addEventListener("contextmenu", ctx);
    this.listeners.push(() => {
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      window.removeEventListener("blur", blur);
      document.removeEventListener("visibilitychange", vis);
      document.removeEventListener("pointerlockchange", plc);
      document.removeEventListener("mousemove", mm);
      window.removeEventListener("resize", resize);
      this.canvas.removeEventListener("contextmenu", ctx);
    });
  }

  requestPointerLock() {
    if (this.pointerLocked || this.disposed) return;
    try {
      const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      if (p && typeof p.catch === "function") p.catch(() => undefined);
    } catch {
      /* no user activation yet: the UI shows "click to play" */
    }
  }
  releasePointerLock() {
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }
  canvasClick() {
    void this.audio.init();
    if (this.phase === "playing") this.requestPointerLock();
  }

  setSettings(s: Settings) {
    this.settings = s;
    this.audio.setVolumes(s);
    if (!this.renderer || !this.camera) return;
    this.camera.fov = s.fov;
    this.camera.updateProjectionMatrix();
    const preset = QUALITY_PRESETS[s.quality];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, preset.pixelRatio) * s.renderScale);
    this.renderer.shadowMap.enabled = preset.shadows > 0;
    this.spotLights.forEach((l, i) => (l.castShadow = i < Math.max(0, preset.shadows - 1)));
    this.flashlight.castShadow = preset.shadows > 0;
    if (s.quality === "high" && !this.composer) this.setupComposer();
    if (s.quality !== "high" && this.composer) {
      this.composer.dispose();
      this.composer = null;
    }
    this.composer?.setPixelRatio(this.renderer.getPixelRatio());
    this.resize();
  }

  toggleMap() {
    if (this.phase === "map") {
      this.setPhase("playing");
      this.requestPointerLock();
    } else if (this.phase === "playing") {
      this.setPhase("map");
      this.releasePointerLock();
    }
  }

  toggleFlashlight() {
    this.flashOn = !this.flashOn;
    this.audio.flashlight(this.flashOn);
  }

  resize() {
    if (!this.renderer || !this.camera) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.composer?.setSize(w, h);
  }

  /* ------------------------------------------------------------ *
   * map data (the real maze graph + fog of war; never the exit)
   * ------------------------------------------------------------ */
  getMapState() {
    return {
      maze: this.maze,
      visited: this.visited,
      player: { x: this.player.pos.x, z: this.player.pos.z, yaw: this.player.yaw },
      rooms: this.maze.rooms.filter((r) => {
        for (let j = r.j0; j < r.j0 + r.h; j++) for (let i = r.i0; i < r.i0 + r.w; i++) if (this.visited[idx(i, j)]) return true;
        return false;
      }),
    };
  }

  /* ------------------------------------------------------------ *
   * save (seed + position + timer + explored cells)
   * ------------------------------------------------------------ */
  autosave() {
    if (!this.level || this.phase === "ending" || this.phase === "idle" || this.phase === "loading") return;
    const words: number[] = [];
    for (let i = 0; i < this.visited.length; i += 32) {
      let w = 0;
      for (let b = 0; b < 32 && i + b < this.visited.length; b++) if (this.visited[i + b]) w |= 1 << b;
      words.push(w);
    }
    writeSave({
      version: 1,
      seed: this.currentSeed,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      elapsed: this.elapsed,
      steps: Math.round(this.player.distanceWalked),
      pos: [this.player.pos.x, 0, this.player.pos.z],
      yaw: this.player.yaw,
      pitch: this.player.pitch,
      objectives: {},
      items: [],
      unlocked: [],
      doorsOpen: [],
      visited: words,
      notesRead: [],
      flashlight: this.flashOn,
    });
  }

  /* ------------------------------------------------------------ *
   * main loop (single rAF, fixed for the lifetime of the Game)
   * ------------------------------------------------------------ */
  private startLoop() {
    const tick = (now: number) => {
      if (this.disposed) return;
      this.rafId = requestAnimationFrame(tick);
      const dtRaw = this.lastTime ? (now - this.lastTime) / 1000 : 0.016;
      this.lastTime = now;
      const dt = Math.min(0.05, Math.max(0.0005, dtRaw));
      this.frameTimes.push(dtRaw);
      if (this.frameTimes.length > 40) this.frameTimes.shift();
      this.fps = 1 / (this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length);
      this.time += dt;

      if (this.phase === "playing") this.step(dt);
      else if (this.phase === "map") {
        this.elapsed += dt; // the clock keeps running while reading the map
        this.ambientStep(dt);
      } else if (this.phase === "idle") {
        // slow cinematic drift behind the main menu only
        this.camera.position.y = 1.58 + Math.sin(this.time * 0.35) * 0.03;
        this.camera.rotateY(Math.sin(this.time * 0.08) * dt * 0.05);
        this.ambientStep(dt);
      } else if (this.level) {
        // paused / ending: world frozen, only rendering continues
      }

      this.render();
      this.hudTimer -= dt;
      if (this.hudTimer <= 0) {
        this.hudTimer = 0.1;
        this.pushHud();
      }
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private ambientStep(dt: number) {
    updateWind(this.time);
    this.level?.update(dt, this.time);
    this.updateLights();
    if (this.coop) this.remotes.update(dt, this.camera);
  }

  private step(dt: number) {
    if (!this.level) return;
    if (this.coop && this.coopStartAt) {
      this.elapsed = Math.max(0, (performance.now() + this.coopOffset - this.coopStartAt) / 1000);
    } else {
      this.elapsed += dt;
    }
    const k = this.keys;
    const frozen = this.coop && this.coopEscaped;
    const input = frozen
      ? { forward: 0, strafe: 0, sprint: false }
      : {
          forward: (k.has("KeyW") || k.has("ArrowUp") ? 1 : 0) - (k.has("KeyS") || k.has("ArrowDown") ? 1 : 0),
          strafe: (k.has("KeyD") || k.has("ArrowRight") ? 1 : 0) - (k.has("KeyA") || k.has("ArrowLeft") ? 1 : 0),
          sprint: k.has("ShiftLeft") || k.has("ShiftRight"),
        };
    if (!frozen) this.player.update(dt, input, this.level, this.settings.headBob, this.settings.motionEffects);

    // camera is always exactly the player's eye (plus the small optional bob)
    this.camera.position.copy(this.player.eyePosition(this.tmp));
    this.player.applyToCamera(this.camera);

    // flashlight trails the view very slightly, like a hand-held torch
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this.flashDir.lerp(fwd, 1 - Math.exp(-14 * dt));
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
    this.flashlight.position.copy(this.camera.position).addScaledVector(right, 0.2).addScaledVector(up, -0.14);
    this.flashTarget.position.copy(this.camera.position).addScaledVector(this.flashDir, 12);
    this.flashlight.intensity += ((this.flashOn ? 34 : 0) - this.flashlight.intensity) * (1 - Math.exp(-14 * dt));

    this.level.update(dt, this.time);
    updateWind(this.time);
    this.lightTimer -= dt;
    if (this.lightTimer <= 0) {
      this.lightTimer = 0.2;
      this.assignLights();
    }
    this.updateLights();
    this.updateRipples(dt);

    // audio
    const zinfo = ZONES[this.maze.zone[idx(this.player.cellI(), this.player.cellJ())]];
    this.audio.setListener(this.camera.position, fwd);
    this.audio.update(dt, zinfo.id, this.player.wet > 0.4, Math.hypot(this.player.vel.x, this.player.vel.z), zinfo.indoor ? 0 : 1);

    // fog / daylight blend per sector
    this.fogTargetColor.setHex(zinfo.fogColor);
    this.fogTargetDensity = zinfo.fog;
    const sunDist = Math.hypot(this.player.pos.x - this.level.sunCenter.x, this.player.pos.z - this.level.sunCenter.z);
    const sunFade = Math.max(0, Math.min(1, 1 - (sunDist - 26) / 22));
    const outdoor = Math.max(0, Math.min(1, 1 - (sunDist - 24) / 20));
    this.level.sun.intensity = 3.1 * sunFade;
    this.level.hemi.intensity = 0.5 * sunFade;
    this.level.sky.visible = sunFade > 0.01;
    const blend = 1 - Math.exp(-1.6 * dt);
    this.fog.color.lerp(this.fogTargetColor.clone().lerp(new THREE.Color(0x9db3bd), outdoor * 0.85), blend);
    this.fog.density += (this.fogTargetDensity * (1 - outdoor * 0.62) - this.fog.density) * blend;
    (this.scene.background as THREE.Color).copy(this.fog.color).multiplyScalar(0.45);

    this.markVisited(false);
    this.remotes.update(dt, this.camera);

    if (this.coop && this.onPos && !this.coopEscaped) {
      this.posAcc += dt;
      if (this.posAcc >= 1 / 18) {
        this.posAcc = 0;
        this.posSeq++;
        this.onPos({
          x: this.player.pos.x,
          y: this.player.pos.y,
          z: this.player.pos.z,
          yaw: this.player.yaw,
          pitch: this.player.pitch,
          sprint: input.sprint && input.forward > 0,
          seq: this.posSeq,
        });
      }
    }

    // WIN: only once the player has physically walked through the exit gate
    if (!this.coopEscaped && this.level.exitTrigger(this.player.pos)) {
      this.finish();
      return;
    }

    this.saveTimer -= dt;
    if (this.saveTimer <= 0) {
      this.saveTimer = 15;
      if (!this.coop) this.autosave();
    }
    this.eventTimer -= dt;
    if (this.eventTimer <= 0) {
      this.eventTimer = 45 + Math.random() * 55;
      if (this.settings.events) this.ambientEvent();
    }
  }

  private markVisited(force: boolean) {
    const ci = this.player.cellI();
    const cj = this.player.cellJ();
    this.visited[idx(ci, cj)] = 1;
    // reveal directly connected neighbours that are in view (no wall-hacks)
    const fwd = this.player.forward;
    const nbrs: [number, number, Edge][] = [
      [0, -1, { axis: "H", i: ci, j: cj }],
      [0, 1, { axis: "H", i: ci, j: cj + 1 }],
      [-1, 0, { axis: "V", i: ci, j: cj }],
      [1, 0, { axis: "V", i: ci + 1, j: cj }],
    ];
    for (const [dx, dz, e] of nbrs) {
      const ni = ci + dx;
      const nj = cj + dz;
      if (ni < 0 || nj < 0 || ni >= GRID || nj >= GRID) continue;
      const passable = !hasWall(this.maze, e) || this.maze.doors.some((d) => d.axis === e.axis && d.i === e.i && d.j === e.j);
      if (!passable) continue;
      if (!force && fwd.x * dx + fwd.z * dz < 0.2) {
        const d = Math.hypot(this.player.pos.x - (ni + 0.5) * CELL, this.player.pos.z - (nj + 0.5) * CELL);
        if (d > 2.6) continue;
      }
      this.visited[idx(ni, nj)] = 1;
    }
  }

  private assignLights() {
    if (!this.level) return;
    const p = this.player.pos;
    const lamps = this.level.lamps
      .filter((l) => l.on && l.power > 0)
      .map((l) => ({ l, d: l.pos.distanceToSquared(p) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, this.pointLights.length + this.spotLights.length);
    let pi = 0;
    let si = 0;
    for (const { l } of lamps) {
      if (si < this.spotLights.length && l.kind !== "lantern") {
        const s = this.spotLights[si++];
        s.position.set(l.pos.x, l.pos.y - 0.05, l.pos.z);
        s.target.position.set(l.pos.x, 0, l.pos.z);
        s.color.setHex(l.color);
        s.userData.fixture = l;
        s.angle = 0.95;
        s.penumbra = 0.75;
        s.distance = 15;
        s.decay = 1.9;
      } else if (pi < this.pointLights.length) {
        const pl = this.pointLights[pi++];
        pl.position.set(l.pos.x, l.pos.y, l.pos.z);
        pl.color.setHex(l.color);
        pl.distance = l.kind === "lantern" ? 9 : 12;
        pl.userData.fixture = l;
      }
    }
    for (; pi < this.pointLights.length; pi++) this.pointLights[pi].userData.fixture = null;
    for (; si < this.spotLights.length; si++) this.spotLights[si].userData.fixture = null;
  }

  private updateLights() {
    const t = this.time;
    for (const l of this.pointLights) {
      const f = l.userData.fixture as LampFixture | null;
      l.intensity = f ? 11 * f.power * (f.flicker > 0 ? this.flickerValue(f, t) : 1) : 0;
    }
    for (const s of this.spotLights) {
      const f = s.userData.fixture as LampFixture | null;
      s.intensity = f ? 26 * f.power * (f.flicker > 0 ? this.flickerValue(f, t) : 1) : 0;
    }
  }

  private flickerValue(f: { flicker: number; seed: number }, t: number) {
    const n = Math.sin(t * 13.7 + f.seed) * 0.5 + Math.sin(t * 27.3 + f.seed * 2.3) * 0.35 + Math.sin(t * 3.1 + f.seed) * 0.5;
    const gate = n > -0.55 * f.flicker ? 1 : 0.12;
    return 0.55 + 0.45 * gate * (0.6 + 0.4 * Math.abs(Math.sin(t * 5 + f.seed)));
  }

  /** Purely atmospheric: a distant creak, or a dead lamp briefly sputtering. */
  private ambientEvent() {
    if (!this.level) return;
    if (Math.random() < 0.7) {
      this.audio.creak();
      return;
    }
    this.audio.slam();
    const near = this.level.lamps
      .filter((l) => !l.on)
      .map((l) => ({ l, d: l.pos.distanceToSquared(this.player.pos) }))
      .sort((a, b) => a.d - b.d)[0];
    if (near && near.d < 400) {
      near.l.on = true;
      setTimeout(() => (near.l.on = false), 900);
    }
  }

  private updateRipples(dt: number) {
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const r = this.ripples[i];
      r.life -= dt;
      r.mesh.scale.setScalar(1 + (1 - r.life / 0.9) * 2.4);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, r.life / 0.9) * 0.35;
      if (r.life <= 0) {
        r.mesh.visible = false;
        this.ripplePool.push(r.mesh);
        this.ripples.splice(i, 1);
      }
    }
    if (this.player.wet > 0.5 && this.player.onGround) {
      const speed = Math.hypot(this.player.vel.x, this.player.vel.z);
      if (speed > 0.7 && Math.random() < dt * 3.2) this.spawnRipple(this.player.pos.x, this.player.pos.z);
    }
  }

  private spawnRipple(x: number, z: number) {
    let mesh = this.ripplePool.pop();
    if (!mesh) {
      mesh = new THREE.Mesh(
        new THREE.RingGeometry(0.18, 0.26, 18),
        new THREE.MeshBasicMaterial({ color: 0xbcd8dd, transparent: true, opacity: 0.3, side: THREE.DoubleSide }),
      );
      mesh.rotation.x = -Math.PI / 2;
      this.scene.add(mesh);
    }
    mesh.visible = true;
    mesh.position.set(x, 0.17, z);
    mesh.scale.setScalar(1);
    this.ripples.push({ mesh, life: 0.9 });
  }

  private finish() {
    this.ending = { time: this.elapsed };
    this.player.vel.set(0, 0, 0);
    this.audio.exitSting();
    this.releasePointerLock();
    if (this.coop) {
      this.coopEscaped = true;
      this.onCoopEscape?.(this.elapsed);
      this.pushHud();
      return;
    }
    clearSave();
    this.setPhase("ending");
  }

  /* ------------------------------------------------------------ *
   * hud
   * ------------------------------------------------------------ */
  private pushHud() {
    this.onHud({
      playing: this.phase === "playing",
      time: this.ending ? this.ending.time : this.elapsed,
      fps: Math.round(this.fps),
      showFps: this.settings.showFps,
      intro: (this.phase === "playing" || this.phase === "paused") && this.elapsed < INTRO_SECONDS,
      mapOpen: this.phase === "map",
      ending: this.coop ? null : this.ending,
      coop: this.coop ? this.coopHud : null,
      seed: this.currentSeed,
    });
  }

  private render() {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  /* ------------------------------------------------------------ *
   * teardown
   * ------------------------------------------------------------ */
  private disposeLevel() {
    if (!this.level) return;
    this.scene.remove(this.level.root);
    this.level.dispose();
    this.level = null;
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.rafId);
    for (const off of this.listeners) off();
    this.listeners = [];
    this.releasePointerLock();
    this.disposeLevel();
    this.composer?.dispose();
    this.renderer?.dispose();
    disposeMaterials();
    this.audio.drone(false);
    this.audio.suspend();
    this.remotes.dispose();
  }
}
