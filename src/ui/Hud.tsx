import { useState } from "react";
import type { HudState } from "@/engine/types";

function fmt(t: number) {
  const s = Math.max(0, Math.floor(t));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** The whole HUD: a timer, a tiny reticle, the opening instruction, seed display, and a
 *  one-line control hint. Nothing else competes with the maze. */
export function Hud({ hud, onCopySeed }: { hud: HudState; onCopySeed?: (seed: number) => void }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!hud.seed) return;
    onCopySeed?.(hud.seed);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <div className="pointer-events-none absolute inset-0 z-10 select-none">
      <div className="vignette absolute inset-0" />
      <div className="grain absolute inset-0" />

      {/* reticle */}
      <div className="absolute left-1/2 top-1/2 h-[3px] w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/40 shadow-[0_0_4px_rgba(0,0,0,0.9)]" />

      {/* timer */}
      <div className="absolute right-6 top-5 text-right">
        <div className="font-mono text-sm tracking-widest text-white/65 drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]">{fmt(hud.time)}</div>
        {hud.coop && (
          <div className="mt-1 text-[10px] tracking-widest text-amber/70">
            {hud.coop.escaped}/{hud.coop.total} ESCAPED
          </div>
        )}
        {hud.showFps && <div className="mt-1 font-mono text-[10px] text-white/30">{hud.fps} FPS</div>}
      </div>

      {/* opening instruction, fades out on its own */}
      <div
        className="absolute inset-x-0 top-[30%] flex flex-col items-center transition-opacity duration-[1400ms] ease-out"
        style={{ opacity: hud.intro ? 1 : 0 }}
      >
        <div className="text-[clamp(1.6rem,4vw,2.8rem)] font-extralight tracking-[0.42em] text-white/90 drop-shadow-[0_4px_24px_rgba(0,0,0,0.95)]">
          FIND THE EXIT.
        </div>
        <div className="mt-3 h-[1px] w-24 bg-amber/60" />
      </div>

      {/* seed display & copy button */}
      {hud.seed > 0 && (
        <div className="pointer-events-auto absolute bottom-6 left-6 flex items-center gap-2 text-[10px] tracking-widest text-white/40">
          <span className="font-mono">SEED {hud.seed}</span>
          <button
            onClick={handleCopy}
            className="rounded border hairline px-1.5 py-0.5 font-mono text-[9px] text-white/50 transition hover:border-amber/40 hover:text-amber"
            title="Copy maze seed"
          >
            {copied ? "COPIED" : "COPY"}
          </button>
        </div>
      )}

      <div className="absolute bottom-6 right-6 text-[10px] tracking-widest text-white/25">
        WASD MOVE · SHIFT SPRINT · F LIGHT · M MAP · ESC PAUSE
      </div>
    </div>
  );
}
