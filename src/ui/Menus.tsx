import { useState } from "react";
import { QUALITY_PRESETS, type HudState, type Settings } from "@/engine/types";

/* ------------------------------------------------------------------ */
export function Btn({
  children,
  onClick,
  disabled,
  primary,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`group relative w-full overflow-hidden border px-5 py-3 text-left text-sm tracking-[0.2em] transition-all duration-200 ${
        disabled
          ? "cursor-not-allowed border-white/5 text-white/20"
          : primary
            ? "border-amber/40 text-amber hover:border-amber hover:bg-amber/10"
            : "hairline border text-white/70 hover:border-white/40 hover:bg-white/5 hover:text-white"
      }`}
    >
      <span className="relative z-10">{children}</span>
      {!disabled && (
        <span className="absolute left-0 top-0 h-full w-[2px] scale-y-0 bg-amber transition-transform duration-200 group-hover:scale-y-100" />
      )}
    </button>
  );
}

export function Title() {
  return (
    <div className="select-none">
      <h1 className="text-[clamp(3rem,9vw,7rem)] font-extralight leading-[0.9] tracking-[0.18em] text-white/95 drop-shadow-[0_6px_30px_rgba(0,0,0,0.9)]">
        THE MAZE
      </h1>
      <div className="mt-3 flex items-center gap-4">
        <span className="h-[1px] w-16 bg-amber/60" />
        <p className="text-[11px] tracking-[0.42em] text-amber/85">THERE IS ALWAYS A WAY OUT.</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
export function MainMenu({
  hasSave,
  onNew,
  onCustomSeed,
  onContinue,
  onPanel,
  busy,
  onMultiplayer,
}: {
  hasSave: boolean;
  onNew: () => void;
  onCustomSeed: () => void;
  onContinue: () => void;
  onPanel: (p: "settings" | "controls" | "credits") => void;
  busy: boolean;
  onMultiplayer: () => void;
}) {
  return (
    <div className="fade-up w-[320px]">
      <div className="mb-8 flex flex-col gap-2">
        <Btn primary onClick={onNew} disabled={busy}>
          NEW GAME
        </Btn>
        <Btn onClick={onCustomSeed} disabled={busy}>
          CUSTOM SEED
        </Btn>
        <Btn onClick={onContinue} disabled={!hasSave || busy}>
          CONTINUE
        </Btn>
        <Btn onClick={onMultiplayer} disabled={busy}>
          CO-OP ESCAPE
        </Btn>
        <div className="h-3" />
        <Btn onClick={() => onPanel("settings")}>SETTINGS</Btn>
        <Btn onClick={() => onPanel("controls")}>CONTROLS</Btn>
        <Btn onClick={() => onPanel("credits")}>CREDITS</Btn>
      </div>
      <p className="text-[10px] leading-relaxed tracking-widest text-white/25">
        HEADPHONES RECOMMENDED · MOUSE + KEYBOARD REQUIRED
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
export function SeedPanel({
  onStart,
  onBack,
}: {
  onStart: (seed: number) => void;
  onBack: () => void;
}) {
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleStart = () => {
    const trimmed = input.trim();
    if (!trimmed) {
      setError("Please enter a numeric seed or text.");
      return;
    }
    // Number check or string hash
    let parsed: number;
    if (/^\d+$/.test(trimmed)) {
      parsed = parseInt(trimmed, 10);
      if (parsed <= 0 || parsed > 2147483647) {
        setError("Seed must be between 1 and 2147483647.");
        return;
      }
    } else {
      let h = 2166136261 >>> 0;
      for (let i = 0; i < trimmed.length; i++) {
        h ^= trimmed.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      parsed = (h >>> 0) % 1000000000 || 123456789;
    }
    onStart(parsed);
  };

  const handleRandom = () => {
    const rnd = Math.floor(100000 + Math.random() * 899999999);
    setInput(String(rnd));
    setError(null);
  };

  return (
    <div className="fade-up w-[360px]">
      <h2 className="mb-1 text-lg tracking-[0.3em] text-white/85">CUSTOM SEED</h2>
      <p className="mb-6 text-[11px] leading-relaxed tracking-wide text-white/40">
        Enter a number or text phrase to generate a reproducible maze, entrance, and exit.
      </p>
      <div className="mb-4">
        <input
          value={input}
          placeholder="e.g. 482910 or LABYRINTH"
          onChange={(e) => {
            setInput(e.target.value);
            setError(null);
          }}
          className="w-full border hairline bg-black/30 px-3 py-2 font-mono text-sm tracking-widest text-white/85 outline-none placeholder:text-white/20 focus:border-amber/40"
        />
        {error && <p className="mt-2 text-[11px] text-red-300/80">{error}</p>}
      </div>
      <div className="flex flex-col gap-2">
        <Btn primary onClick={handleStart} disabled={!input.trim()}>
          PLAY WITH SEED
        </Btn>
        <Btn onClick={handleRandom}>RANDOMIZE</Btn>
        <div className="h-2" />
        <Btn onClick={onBack}>BACK</Btn>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
function Row({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-6 border-b hairline py-3">
      <div>
        <div className="text-[12px] tracking-widest text-white/70">{label}</div>
        {hint && <div className="mt-[2px] text-[10px] tracking-wide text-white/25">{hint}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-3">{children}</div>
    </div>
  );
}

function Slider({ value, min, max, step, onChange, fmt }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void; fmt?: (v: number) => string }) {
  return (
    <>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} className="w-40" />
      <span className="w-12 text-right font-mono text-[11px] text-white/50">{fmt ? fmt(value) : value.toFixed(2)}</span>
    </>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={`w-[54px] rounded-sm border px-2 py-1 text-[10px] tracking-widest transition-colors ${
        on ? "border-amber/50 text-amber" : "hairline border text-white/35"
      }`}
    >
      {on ? "ON" : "OFF"}
    </button>
  );
}

export function SettingsPanel({ settings, onChange, onBack }: { settings: Settings; onChange: (s: Settings) => void; onBack: () => void }) {
  const s = settings;
  const set = (patch: Partial<Settings>) => onChange({ ...s, ...patch });
  return (
    <div className="fade-up w-[560px]">
      <div className="mb-5 flex items-baseline justify-between">
        <h2 className="text-lg tracking-[0.3em] text-white/85">SETTINGS</h2>
        <button onClick={onBack} className="text-[11px] tracking-widest text-amber hover:text-amber/80">
          ← BACK
        </button>
      </div>
      <div className="max-h-[62vh] overflow-y-auto pr-2">
        <Row label="GRAPHICS QUALITY" hint={`${QUALITY_PRESETS[s.quality].shadows} shadow lights · pixel ratio ${QUALITY_PRESETS[s.quality].pixelRatio}`}>
          <div className="flex gap-1">
            {(["low", "medium", "high"] as const).map((q) => (
              <button
                key={q}
                onClick={() => set({ quality: q })}
                className={`border px-3 py-1 text-[10px] tracking-widest uppercase ${
                  s.quality === q ? "border-amber/50 text-amber" : "hairline border text-white/40 hover:text-white/70"
                }`}
              >
                {q}
              </button>
            ))}
          </div>
        </Row>
        <Row label="RENDER SCALE" hint="lower = faster, softer">
          <Slider value={s.renderScale} min={0.6} max={1.5} step={0.05} onChange={(v) => set({ renderScale: v })} fmt={(v) => `${Math.round(v * 100)}%`} />
        </Row>
        <Row label="FIELD OF VIEW">
          <Slider value={s.fov} min={60} max={100} step={1} onChange={(v) => set({ fov: v })} fmt={(v) => `${v}°`} />
        </Row>
        <Row label="MOUSE SENSITIVITY">
          <Slider value={s.sensitivity} min={0.2} max={3} step={0.05} onChange={(v) => set({ sensitivity: v })} />
        </Row>
        <Row label="INVERT Y">
          <Toggle on={s.invertY} onChange={(v) => set({ invertY: v })} />
        </Row>
        <Row label="HEAD BOB" hint="0 disables camera bob entirely">
          <Slider value={s.headBob} min={0} max={1} step={0.05} onChange={(v) => set({ headBob: v })} />
        </Row>
        <Row label="MOTION EFFECTS" hint="subtle sway and lean while walking">
          <Toggle on={s.motionEffects} onChange={(v) => set({ motionEffects: v })} />
        </Row>
        <Row label="MASTER VOLUME">
          <Slider value={s.master} min={0} max={1} step={0.02} onChange={(v) => set({ master: v })} fmt={(v) => `${Math.round(v * 100)}`} />
        </Row>
        <Row label="AMBIENCE">
          <Slider value={s.ambience} min={0} max={1} step={0.02} onChange={(v) => set({ ambience: v })} fmt={(v) => `${Math.round(v * 100)}`} />
        </Row>
        <Row label="SOUND EFFECTS">
          <Slider value={s.sfx} min={0} max={1} step={0.02} onChange={(v) => set({ sfx: v })} fmt={(v) => `${Math.round(v * 100)}`} />
        </Row>
        <Row label="MUSIC">
          <Slider value={s.music} min={0} max={1} step={0.02} onChange={(v) => set({ music: v })} fmt={(v) => `${Math.round(v * 100)}`} />
        </Row>
        <Row label="AMBIENT EVENTS" hint="distant creaks, sputtering lamps">
          <Toggle on={s.events} onChange={(v) => set({ events: v })} />
        </Row>
        <Row label="SHOW FRAME RATE">
          <Toggle on={s.showFps} onChange={(v) => set({ showFps: v })} />
        </Row>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
const CONTROLS: [string, string][] = [
  ["W A S D", "Walk"],
  ["MOUSE", "Look around"],
  ["SHIFT", "Sprint"],
  ["F", "Flashlight"],
  ["M", "Map of explored passages"],
  ["ESC", "Pause"],
];

export function ControlsPanel({ onBack }: { onBack: () => void }) {
  return (
    <div className="fade-up w-[460px]">
      <div className="mb-5 flex items-baseline justify-between">
        <h2 className="text-lg tracking-[0.3em] text-white/85">CONTROLS</h2>
        <button onClick={onBack} className="text-[11px] tracking-widest text-amber hover:text-amber/80">
          ← BACK
        </button>
      </div>
      <div className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3">
        {CONTROLS.map(([k, v]) => (
          <div key={k} className="contents">
            <div className="min-w-[92px] rounded border hairline px-3 py-1 text-center font-mono text-[11px] tracking-widest text-amber/80">{k}</div>
            <div className="self-center text-[12px] tracking-wide text-white/65">{v}</div>
          </div>
        ))}
      </div>
      <p className="mt-6 text-[11px] leading-relaxed tracking-wide text-white/35">
        You wake up somewhere inside a 26 × 26 maze. Somewhere in it there is one way out. Nothing needs to be
        collected or unlocked — just find it. Click the view to capture the mouse; the map only shows passages you
        have actually walked.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
export function CreditsPanel({ onBack }: { onBack: () => void }) {
  return (
    <div className="fade-up w-[520px]">
      <div className="mb-5 flex items-baseline justify-between">
        <h2 className="text-lg tracking-[0.3em] text-white/85">CREDITS</h2>
        <button onClick={onBack} className="text-[11px] tracking-widest text-amber hover:text-amber/80">
          ← BACK
        </button>
      </div>
      <div className="space-y-4 text-[12px] leading-relaxed tracking-wide text-white/60">
        <p>
          <span className="text-amber/80">ENGINE</span> — three.js (WebGL2), custom fixed-step character controller,
          grid collision solver, merged static geometry, procedural light pooling.
        </p>
        <p>
          <span className="text-amber/80">ART</span> — every surface in this maze is generated at load time in a
          canvas: concrete, brick, stone, tread plate, soil, hedge foliage, water and paper. No external textures.
        </p>
        <p>
          <span className="text-amber/80">AUDIO</span> — synthesised in the Web Audio graph: filtered noise for
          footsteps per surface, convolution reverb from a generated impulse response, spatial drips, creaks and
          electrical hum. No audio files.
        </p>
        <p>
          <span className="text-amber/80">LEVEL</span> — seeded recursive-backtracker maze per sector, braided for
          loops, joined by open doorways. Before you spawn, every layout is checked by breadth-first search (exit
          reachable, boundary sealed, enough dead ends, junctions and loops) and the built geometry is swept with
          the player's collision capsule along every passage.
        </p>
        <p className="text-white/30">Built with React, Vite and Tailwind CSS. Runs entirely in your browser.</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
export function LoadingScreen({ frac, label }: { frac: number; label: string }) {
  return (
    <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-[#05070a]">
      <Title />
      <div className="mt-12 w-[340px]">
        <div className="h-[2px] w-full bg-white/10">
          <div className="h-full bg-amber transition-all duration-300" style={{ width: `${Math.round(frac * 100)}%` }} />
        </div>
        <div className="mt-3 flex justify-between font-mono text-[10px] tracking-widest text-white/35">
          <span>{label.toUpperCase()}</span>
          <span>{Math.round(frac * 100)}%</span>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
export function PauseMenu({
  onResume,
  onRestart,
  onMenu,
  onPanel,
  panel,
  settings,
  onSettings,
  confirm,
  onConfirm,
  coop,
  seed,
  onCopySeed,
}: {
  onResume: () => void;
  onRestart: () => void;
  onMenu: () => void;
  onPanel: (p: "main" | "settings" | "controls") => void;
  panel: "main" | "settings" | "controls";
  settings: Settings;
  onSettings: (s: Settings) => void;
  confirm: null | "restart" | "menu";
  onConfirm: (v: null | "restart" | "menu") => void;
  coop?: boolean;
  seed?: number;
  onCopySeed?: (s: number) => void;
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    if (!seed) return;
    onCopySeed?.(seed);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/65 backdrop-blur-[3px]">
      <div className="panel fade-up w-[360px] p-8">
        {panel === "main" && !confirm && (
          <>
            <h2 className="mb-1 text-lg tracking-[0.3em] text-white/85">PAUSED</h2>
            <p className="mb-4 text-[11px] tracking-widest text-white/30">SIMULATION HALTED</p>
            {seed != null && seed > 0 && (
              <div className="mb-5 flex items-center justify-between border-y hairline py-2.5 text-[11px] tracking-widest text-white/45">
                <span>SEED <span className="font-mono text-white/80">{seed}</span></span>
                <button
                  onClick={handleCopy}
                  className="rounded border hairline px-2 py-0.5 font-mono text-[9px] text-white/60 transition hover:border-amber/40 hover:text-amber"
                >
                  {copied ? "COPIED" : "COPY SEED"}
                </button>
              </div>
            )}
            <div className="flex flex-col gap-2">
              <Btn primary onClick={onResume}>
                RESUME
              </Btn>
              <Btn onClick={() => onPanel("settings")}>SETTINGS</Btn>
              <Btn onClick={() => onPanel("controls")}>CONTROLS</Btn>
              <div className="h-3" />
              {!coop && <Btn onClick={() => onConfirm("restart")}>RESTART RUN</Btn>}
              <Btn onClick={() => onConfirm("menu")}>{coop ? "LEAVE SESSION" : "MAIN MENU"}</Btn>
            </div>
          </>
        )}
        {panel === "settings" && <SettingsPanel settings={settings} onChange={onSettings} onBack={() => onPanel("main")} />}
        {panel === "controls" && <ControlsPanel onBack={() => onPanel("main")} />}
        {confirm && (
          <div>
            <h2 className="mb-2 text-lg tracking-[0.3em] text-white/85">{confirm === "restart" ? "RESTART?" : "LEAVE RUN?"}</h2>
            <p className="mb-6 text-[12px] leading-relaxed tracking-wide text-white/45">
              {confirm === "restart"
                ? "Back to the starting point of this same maze. The timer resets to 00:00."
                : "Progress is saved automatically, so you can continue from here later."}
            </p>
            <div className="flex flex-col gap-2">
              <Btn
                primary
                onClick={() => {
                  const c = confirm;
                  onConfirm(null);
                  if (c === "restart") onRestart();
                  else onMenu();
                }}
              >
                CONFIRM
              </Btn>
              <Btn onClick={() => onConfirm(null)}>CANCEL</Btn>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
export function EndingScreen({
  ending,
  onRestart,
  onMenu,
  seed,
  onCopySeed,
}: {
  ending: NonNullable<HudState["ending"]>;
  onRestart: () => void;
  onMenu: () => void;
  seed?: number;
  onCopySeed?: (s: number) => void;
}) {
  const [copied, setCopied] = useState(false);
  const t = Math.max(0, Math.floor(ending.time));
  const mm = Math.floor(t / 60);
  const ss = t % 60;

  const handleCopy = () => {
    if (!seed) return;
    onCopySeed?.(seed);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/75 backdrop-blur-md">
      <div className="fade-up px-8 text-center">
        <h2 className="text-[clamp(2.4rem,6vw,4.2rem)] font-extralight tracking-[0.22em] text-white/95">YOU ESCAPED.</h2>
        <div className="mx-auto mt-4 h-[1px] w-24 bg-amber/60" />
        <div className="mt-8 text-[11px] tracking-[0.4em] text-white/40">TIME</div>
        <div className="mt-2 font-mono text-3xl tracking-widest text-white/85">
          {String(mm).padStart(2, "0")}:{String(ss).padStart(2, "0")}
        </div>
        {seed != null && seed > 0 && (
          <div className="mt-6 flex items-center justify-center gap-3 text-[11px] tracking-widest text-white/45">
            <span>SEED <span className="font-mono text-white/80">{seed}</span></span>
            <button
              onClick={handleCopy}
              className="rounded border hairline px-2 py-0.5 font-mono text-[9px] text-white/60 transition hover:border-amber/40 hover:text-amber"
            >
              {copied ? "COPIED" : "COPY SEED"}
            </button>
          </div>
        )}
        <div className="mt-10 flex justify-center gap-3">
          <div className="w-[180px]">
            <Btn primary onClick={onRestart}>
              PLAY AGAIN
            </Btn>
          </div>
          <div className="w-[180px]">
            <Btn onClick={onMenu}>MAIN MENU</Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
export function ErrorScreen({ message }: { message: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-[#05070a] p-8">
      <div className="panel max-w-[520px] p-8">
        <h2 className="text-lg tracking-[0.3em] text-red-300/80">CANNOT START</h2>
        <p className="mt-4 text-[13px] leading-relaxed tracking-wide text-white/60">{message}</p>
        <p className="mt-4 text-[12px] leading-relaxed tracking-wide text-white/35">
          THE MAZE needs WebGL 2 and a desktop browser with mouse and keyboard. Try Chrome, Edge or Firefox with
          hardware acceleration enabled.
        </p>
        <button onClick={() => setOpen(!open)} className="mt-6 text-[11px] tracking-widest text-amber">
          {open ? "HIDE DETAILS" : "SHOW DETAILS"}
        </button>
        {open && <pre className="mt-3 max-h-[160px] overflow-auto whitespace-pre-wrap font-mono text-[10px] text-white/30">{message}</pre>}
      </div>
    </div>
  );
}
