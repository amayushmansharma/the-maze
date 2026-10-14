import { useState } from "react";
import { Btn } from "@/ui/Menus";
import type { LobbyView } from "@/net/session";
import type { SessionResult } from "@/net/protocol";
import { MAX_PLAYERS } from "@/net/protocol";

function Field({ label, value, onChange, placeholder, disabled }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; disabled?: boolean }) {
  return (
    <label className="block">
      <div className="mb-1 text-[10px] tracking-[0.3em] text-white/35">{label}</div>
      <input
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border hairline bg-black/30 px-3 py-2 font-mono text-sm tracking-widest text-white/85 outline-none placeholder:text-white/20 focus:border-amber/40"
      />
    </label>
  );
}

export function MpHub({ onCreate, onJoin, onBack }: { onCreate: () => void; onJoin: () => void; onBack: () => void }) {
  return (
    <div className="fade-up w-[320px]">
      <h2 className="mb-1 text-lg tracking-[0.3em] text-white/85">CO-OP ESCAPE</h2>
      <p className="mb-6 text-[11px] leading-relaxed tracking-wide text-white/40">
        One maze. Up to {MAX_PLAYERS} wanderers. Everyone finds the exit at their own pace.
      </p>
      <div className="flex flex-col gap-2">
        <Btn primary onClick={onCreate}>
          CREATE ROOM
        </Btn>
        <Btn onClick={onJoin}>JOIN ROOM</Btn>
        <div className="h-3" />
        <Btn onClick={onBack}>BACK</Btn>
      </div>
    </div>
  );
}

export function MpCreate({
  name,
  onName,
  seedInput,
  onSeedInput,
  busy,
  error,
  onCreate,
  onBack,
}: {
  name: string;
  onName: (v: string) => void;
  seedInput: string;
  onSeedInput: (v: string) => void;
  busy: boolean;
  error: string | null;
  onCreate: () => void;
  onBack: () => void;
}) {
  return (
    <div className="fade-up w-[340px]">
      <h2 className="mb-6 text-lg tracking-[0.3em] text-white/85">CREATE ROOM</h2>
      <div className="flex flex-col gap-3">
        <Field label="DISPLAY NAME" value={name} onChange={onName} />
        <Field
          label="MAZE SEED (OPTIONAL)"
          value={seedInput}
          onChange={onSeedInput}
          placeholder="Leave blank for fresh seed"
        />
      </div>
      {error && <p className="mt-3 text-[12px] tracking-wide text-red-300/80">{error}</p>}
      <div className="mt-6 flex flex-col gap-2">
        <Btn primary onClick={onCreate} disabled={busy}>
          {busy ? "OPENING…" : "CREATE ROOM"}
        </Btn>
        <Btn onClick={onBack} disabled={busy}>
          BACK
        </Btn>
      </div>
    </div>
  );
}

export function MpJoin({
  name,
  onName,
  code,
  onCode,
  busy,
  error,
  onJoin,
  onBack,
}: {
  name: string;
  onName: (v: string) => void;
  code: string;
  onCode: (v: string) => void;
  busy: boolean;
  error: string | null;
  onJoin: () => void;
  onBack: () => void;
}) {
  return (
    <div className="fade-up w-[340px]">
      <h2 className="mb-6 text-lg tracking-[0.3em] text-white/85">JOIN ROOM</h2>
      <div className="flex flex-col gap-4">
        <Field label="DISPLAY NAME" value={name} onChange={onName} />
        <Field label="ROOM CODE" value={code} onChange={(v) => onCode(v.toUpperCase())} placeholder="XXXXXX" />
      </div>
      {error && <p className="mt-3 text-[12px] tracking-wide text-red-300/80">{error}</p>}
      <div className="mt-6 flex flex-col gap-2">
        <Btn primary onClick={onJoin} disabled={busy}>
          {busy ? "CONNECTING…" : "JOIN ROOM"}
        </Btn>
        <Btn onClick={onBack} disabled={busy}>
          BACK
        </Btn>
      </div>
    </div>
  );
}

export function MpLobby({
  view,
  onStart,
  onLeave,
  onCopyCode,
  onCopyLink,
  onCopySeed,
}: {
  view: LobbyView;
  onStart: () => void;
  onLeave: () => void;
  onCopyCode: () => void;
  onCopyLink: () => void;
  onCopySeed?: (seed: number) => void;
}) {
  const [seedCopied, setSeedCopied] = useState(false);
  const n = view.players.filter((p) => p.status !== "left" && p.status !== "disconnected").length;
  const canStart = view.host && n >= 2 && view.phase === "lobby";

  const handleCopySeed = () => {
    onCopySeed?.(view.seed);
    setSeedCopied(true);
    setTimeout(() => setSeedCopied(false), 1800);
  };

  return (
    <div className="fade-up w-[380px]">
      <div className="mb-1 text-[10px] tracking-[0.35em] text-amber">ROOM</div>
      <div className="flex items-baseline justify-between gap-4">
        <div className="font-mono text-3xl tracking-[0.28em] text-white/95">{view.code}</div>
        <div className="text-[11px] tracking-widest text-white/35">
          {n}/{MAX_PLAYERS}
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between">
        <div className="flex gap-2">
          <button onClick={onCopyCode} className="border hairline px-3 py-1 text-[10px] tracking-widest text-white/60 hover:text-white">
            COPY CODE
          </button>
          <button onClick={onCopyLink} className="border hairline px-3 py-1 text-[10px] tracking-widest text-white/60 hover:text-white">
            COPY LINK
          </button>
        </div>
        <button
          onClick={handleCopySeed}
          className="border hairline px-2.5 py-1 font-mono text-[9px] tracking-wider text-white/50 hover:border-amber/40 hover:text-amber"
          title="Copy room maze seed"
        >
          {seedCopied ? "SEED COPIED" : `SEED ${view.seed}`}
        </button>
      </div>
      <div className="mt-6 border-t hairline pt-4">
        {view.players
          .filter((p) => p.status !== "left")
          .map((p) => (
            <div key={p.id} className="flex items-center justify-between py-1.5 text-[12px] tracking-widest">
              <span className="flex items-center gap-2 text-white/75">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: "#" + p.color.toString(16).padStart(6, "0") }} />
                {p.name}
                {p.host && <span className="text-amber/70">HOST</span>}
                {p.id === view.selfId && <span className="text-white/30">YOU</span>}
              </span>
              <span className="text-[10px] text-white/30">{p.status === "disconnected" ? "LOST" : p.status.toUpperCase()}</span>
            </div>
          ))}
      </div>
      {view.error && <p className="mt-3 text-[12px] text-red-300/80">{view.error}</p>}
      <p className="mt-3 text-[11px] tracking-wide text-white/35">{view.status}</p>
      <div className="mt-6 flex flex-col gap-2">
        {view.host && (
          <Btn primary onClick={onStart} disabled={!canStart}>
            START GAME
          </Btn>
        )}
        {!view.host && <p className="text-[11px] tracking-widest text-white/30">WAITING FOR THE HOST TO START</p>}
        <Btn onClick={onLeave}>LEAVE ROOM</Btn>
      </div>
    </div>
  );
}

export function MpEscaped({
  time,
  exploring,
  escaped,
  total,
  onLeave,
}: {
  time: number;
  exploring: number;
  escaped: number;
  total: number;
  onLeave: () => void;
}) {
  const t = Math.max(0, Math.floor(time));
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/55 backdrop-blur-[2px]">
      <div className="fade-up px-8 text-center">
        <h2 className="text-[clamp(2rem,5vw,3.4rem)] font-extralight tracking-[0.22em] text-white/95">YOU ESCAPED.</h2>
        <div className="mx-auto mt-4 h-[1px] w-24 bg-amber/60" />
        <div className="mt-8 font-mono text-3xl tracking-widest text-white/85">
          {String(Math.floor(t / 60)).padStart(2, "0")}:{String(t % 60).padStart(2, "0")}
        </div>
        <p className="mt-6 text-[11px] tracking-widest text-white/45">
          {escaped}/{total} ESCAPED · {exploring} STILL EXPLORING
        </p>
        <div className="mx-auto mt-10 w-[200px]">
          <Btn onClick={onLeave}>LEAVE SESSION</Btn>
        </div>
      </div>
    </div>
  );
}

export function MpResults({
  results,
  duration,
  host,
  onAgain,
  onLeave,
}: {
  results: SessionResult[];
  duration: number;
  host: boolean;
  onAgain: () => void;
  onLeave: () => void;
}) {
  const t = Math.max(0, Math.floor(duration));
  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/75 backdrop-blur-md">
      <div className="fade-up w-[420px] px-6 text-center">
        <div className="text-[11px] tracking-[0.5em] text-emerald-300/70">SESSION COMPLETE</div>
        <h2 className="mt-3 text-[clamp(1.8rem,4vw,2.8rem)] font-extralight tracking-[0.18em] text-white/95">THE GATE IS QUIET</h2>
        <div className="mt-8 border-y hairline py-4 text-left">
          {results.map((r) => (
            <div key={r.id} className="flex justify-between py-1.5 text-[12px] tracking-widest text-white/70">
              <span>{r.name}</span>
              <span className="font-mono text-white/50">
                {r.status === "escaped" && r.escapeTime != null
                  ? `${String(Math.floor(r.escapeTime / 60)).padStart(2, "0")}:${String(Math.floor(r.escapeTime % 60)).padStart(2, "0")}`
                  : r.status === "disconnected"
                    ? "LEFT"
                    : r.status.toUpperCase()}
              </span>
            </div>
          ))}
        </div>
        <div className="mt-4 text-[11px] tracking-widest text-white/35">
          SESSION {String(Math.floor(t / 60)).padStart(2, "0")}:{String(t % 60).padStart(2, "0")}
        </div>
        <div className="mt-8 flex justify-center gap-3">
          {host && (
            <div className="w-[180px]">
              <Btn primary onClick={onAgain}>
                PLAY AGAIN
              </Btn>
            </div>
          )}
          <div className="w-[180px]">
            <Btn onClick={onLeave}>LEAVE SESSION</Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

export function MpHostGone({ reason, onMenu }: { reason: string; onMenu: () => void }) {
  const [open] = useState(true);
  if (!open) return null;
  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/75">
      <div className="panel fade-up w-[380px] p-8">
        <h2 className="text-lg tracking-[0.3em] text-white/85">HOST LEFT</h2>
        <p className="mt-4 text-[13px] leading-relaxed tracking-wide text-white/50">{reason}</p>
        <div className="mt-6">
          <Btn primary onClick={onMenu}>
            MAIN MENU
          </Btn>
        </div>
      </div>
    </div>
  );
}

export function inviteUrl(code: string) {
  return `${location.origin}${location.pathname}?room=${code}`;
}
