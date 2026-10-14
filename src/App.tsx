import { useCallback, useEffect, useRef, useState } from "react";
import { Game, type Phase } from "@/engine/game";
import { hasSave as hasSaveFile, loadSettings, saveSettings } from "@/engine/save";
import type { HudState, Settings } from "@/engine/types";
import { mazeFingerprint } from "@/engine/maze";
import { generateMaze } from "@/engine/maze";
import { Hud } from "@/ui/Hud";
import { MapPanel } from "@/ui/MapPanel";
import {
  ControlsPanel,
  CreditsPanel,
  EndingScreen,
  ErrorScreen,
  LoadingScreen,
  MainMenu,
  PauseMenu,
  SeedPanel,
  SettingsPanel,
  Title,
} from "@/ui/Menus";
import { MpCreate, MpEscaped, MpHostGone, MpHub, MpJoin, MpLobby, MpResults, inviteUrl } from "@/ui/Multiplayer";
import { NetSession, type LobbyView } from "@/net/session";
import { loadStoredName, storeName, type SessionResult } from "@/net/protocol";
import { parseSeedInput } from "@/engine/configHistory";

const EMPTY_HUD: HudState = {
  playing: false,
  time: 0,
  fps: 60,
  showFps: false,
  intro: false,
  mapOpen: false,
  ending: null,
  coop: null,
  seed: 0,
};

type MpScreen = "off" | "hub" | "create" | "join" | "lobby";
type MenuPanel = "main" | "seed" | "settings" | "controls" | "credits";

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const gameRef = useRef<Game | null>(null);
  const sessionRef = useRef<NetSession | null>(null);
  const [phase, setPhase] = useState<Phase>("boot");
  const [hud, setHud] = useState<HudState>(EMPTY_HUD);
  const [loading, setLoading] = useState({ frac: 0, label: "initialising" });
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [menuPanel, setMenuPanel] = useState<MenuPanel>("main");
  const [pausePanel, setPausePanel] = useState<"main" | "settings" | "controls">("main");
  const [confirm, setConfirm] = useState<null | "restart" | "menu">(null);
  const [saveExists, setSaveExists] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);

  const [mpScreen, setMpScreen] = useState<MpScreen>("off");
  const [mpName, setMpName] = useState(loadStoredName);
  const [mpCode, setMpCode] = useState("");
  const [mpSeedInput, setMpSeedInput] = useState("");
  const [mpBusy, setMpBusy] = useState(false);
  const [mpError, setMpError] = useState<string | null>(null);
  const [lobby, setLobby] = useState<LobbyView | null>(null);
  const [escapedLocal, setEscapedLocal] = useState(false);
  const [results, setResults] = useState<SessionResult[] | null>(null);
  const [sessionDuration, setSessionDuration] = useState(0);
  const [hostGone, setHostGone] = useState<string | null>(null);
  const [copied, setCopied] = useState("");

  const coopActive = !!sessionRef.current && (phase === "playing" || phase === "paused" || phase === "map" || escapedLocal || !!results);

  /* ---------------- boot ---------------- */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const g = new Game(canvas, loadSettings());
    gameRef.current = g;
    g.onPhase = (p) => setPhase(p);
    g.onHud = (s) => setHud(s);
    g.onLoading = (frac, label) => setLoading({ frac, label });
    g.init()
      .then(() => (g.isDisposed ? undefined : g.showMenu()))
      .then(() => {
        if (!g.isDisposed) setSaveExists(hasSaveFile());
      })
      .catch((e: unknown) => {
        if (!g.isDisposed) setError(e instanceof Error ? e.message : String(e));
      });
    const plc = () => setLocked(document.pointerLockElement === canvas);
    document.addEventListener("pointerlockchange", plc);

    const pre = new URLSearchParams(location.search).get("room");
    if (pre) {
      setMpCode(pre.toUpperCase());
      setMpScreen("join");
    }

    return () => {
      document.removeEventListener("pointerlockchange", plc);
      sessionRef.current?.close();
      sessionRef.current = null;
      g.dispose();
      if (gameRef.current === g) gameRef.current = null;
    };
  }, []);

  const applySettings = useCallback((s: Settings) => {
    setSettings(s);
    saveSettings(s);
    gameRef.current?.setSettings(s);
  }, []);

  const bindSession = useCallback((s: NetSession) => {
    sessionRef.current = s;
    s.on((e) => {
      const g = gameRef.current;
      if (e.type === "lobby") {
        setLobby(e.view);
        if (g) {
          g.coopHud = {
            escaped: e.view.players.filter((p) => p.status === "escaped").length,
            total: e.view.players.filter((p) => p.status !== "left").length,
            exploring: e.view.players.filter((p) => p.status === "playing" || p.status === "ready" || p.status === "lobby").length,
          };
          for (const p of e.view.players) {
            if (!p.host && p.id !== e.view.selfId) g.setRemoteMeta(p.id, p.name, p.color);
            if (p.id !== e.view.selfId) g.setRemoteMeta(p.id, p.name, p.color);
          }
        }
      }
      if (e.type === "start") {
        void (async () => {
          if (!g) return;
          setMpScreen("off");
          g.onPos = (p) => s.sendPos(p);
          g.onCoopEscape = (t) => {
            s.sendEscape(t);
            setEscapedLocal(true);
          };
          for (const p of s.view.players) if (p.id !== e.selfId) g.setRemoteMeta(p.id, p.name, p.color);
          await g.startCoopRun(e.seed, e.slot, e.at, e.offset);
          const fp = g.fingerprint();
          const expect = mazeFingerprint(generateMaze(e.seed));
          if (fp && expect && fp !== expect && fp !== e.hash && e.hash && fp !== e.hash) {
            console.warn("[CO-OP] maze fingerprint mismatch", fp, e.hash, expect);
          }
          s.sendReady(fp || e.hash);
        })();
      }
      if (e.type === "pos" && e.id !== s.view.selfId) g?.applyRemote(e.id, e.x, e.y, e.z, e.yaw, e.pitch, e.sprint);
      if (e.type === "left") g?.removeRemote(e.id);
      if (e.type === "escape") {
        setLobby((v) => v);
      }
      if (e.type === "end") {
        setResults(e.results);
        setSessionDuration(e.duration);
        setEscapedLocal(false);
      }
      if (e.type === "hostgone") {
        setHostGone(e.reason);
        g?.endCoop();
      }
      if (e.type === "rematch") {
        setResults(null);
        setEscapedLocal(false);
        setMpScreen("lobby");
        g?.endCoop();
        void g?.showMenu();
      }
      if (e.type === "error") setMpError(e.msg);
    });
  }, []);

  const handleCopySeed = useCallback((seed: number) => {
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(String(seed));
    }
    setCopied(`seed:${seed}`);
    setTimeout(() => setCopied(""), 2000);
  }, []);

  const newGame = useCallback(async (customSeed?: number) => {
    const g = gameRef.current;
    if (!g) return;
    setMenuPanel("main");
    setMpScreen("off");
    await g.newGame(customSeed);
    setSaveExists(true);
  }, []);

  const continueGame = useCallback(async () => {
    const g = gameRef.current;
    if (!g) return;
    setMenuPanel("main");
    await g.continueGame();
  }, []);

  const leaveMp = useCallback(async () => {
    sessionRef.current?.leave();
    sessionRef.current = null;
    setLobby(null);
    setMpScreen("off");
    setEscapedLocal(false);
    setResults(null);
    setHostGone(null);
    gameRef.current?.endCoop();
    setPausePanel("main");
    setConfirm(null);
    await gameRef.current?.showMenu();
    setSaveExists(hasSaveFile());
  }, []);

  const toMenu = useCallback(async () => {
    if (sessionRef.current) {
      await leaveMp();
      return;
    }
    const g = gameRef.current;
    if (!g) return;
    setPausePanel("main");
    setConfirm(null);
    g.quitToMenu();
    await g.showMenu();
    setSaveExists(hasSaveFile());
  }, [leaveMp]);

  const restart = useCallback(() => {
    setPausePanel("main");
    setConfirm(null);
    gameRef.current?.restart();
  }, []);

  const createRoom = useCallback(async () => {
    storeName(mpName);
    setMpBusy(true);
    setMpError(null);
    try {
      sessionRef.current?.close();
      const s = new NetSession();
      bindSession(s);
      const parsedSeed = mpSeedInput.trim() ? parseSeedInput(mpSeedInput) : undefined;
      const v = await s.createRoom(mpName, parsedSeed || undefined);
      setLobby(v);
      setMpScreen("lobby");
    } catch (e) {
      setMpError(e instanceof Error ? e.message : String(e));
      sessionRef.current = null;
    } finally {
      setMpBusy(false);
    }
  }, [mpName, mpSeedInput, bindSession]);

  const joinRoom = useCallback(async () => {
    storeName(mpName);
    setMpBusy(true);
    setMpError(null);
    try {
      sessionRef.current?.close();
      const s = new NetSession();
      bindSession(s);
      const v = await s.joinRoom(mpCode, mpName);
      setLobby(v);
      setMpScreen("lobby");
    } catch (e) {
      setMpError(e instanceof Error ? e.message : String(e));
      sessionRef.current = null;
    } finally {
      setMpBusy(false);
    }
  }, [mpName, mpCode, bindSession]);

  const inRun = phase === "playing" || phase === "map" || phase === "paused";
  const showMenu = phase === "idle" && !error && mpScreen === "off";

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#05070a]">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full"
        onClick={() => {
          if (phase === "playing" && !escapedLocal && !results) gameRef.current?.canvasClick();
        }}
      />

      {inRun && !results && <Hud hud={hud} onCopySeed={handleCopySeed} />}

      {phase === "map" && gameRef.current && <MapPanel game={gameRef.current} onClose={() => gameRef.current?.toggleMap()} />}

      {showMenu && (
        <div className="pointer-events-none absolute inset-0 z-20">
          <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/45 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/40" />
          <div className="grain absolute inset-0" />
          <div className="pointer-events-auto absolute left-[7vw] top-1/2 flex max-h-full -translate-y-1/2 flex-col justify-center py-10">
            <div className="mb-10">
              <Title />
            </div>
            {menuPanel === "main" && (
              <MainMenu
                hasSave={saveExists}
                busy={false}
                onNew={() => void newGame()}
                onCustomSeed={() => setMenuPanel("seed")}
                onContinue={continueGame}
                onMultiplayer={() => {
                  setMpError(null);
                  setMpScreen("hub");
                }}
                onPanel={(p) => setMenuPanel(p)}
              />
            )}
            {menuPanel === "seed" && (
              <SeedPanel
                onStart={(seed) => {
                  setMenuPanel("main");
                  void newGame(seed);
                }}
                onBack={() => setMenuPanel("main")}
              />
            )}
            {menuPanel === "settings" && <SettingsPanel settings={settings} onChange={applySettings} onBack={() => setMenuPanel("main")} />}
            {menuPanel === "controls" && <ControlsPanel onBack={() => setMenuPanel("main")} />}
            {menuPanel === "credits" && <CreditsPanel onBack={() => setMenuPanel("main")} />}
          </div>
        </div>
      )}

      {phase === "idle" && mpScreen !== "off" && !error && (
        <div className="pointer-events-none absolute inset-0 z-20">
          <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/45 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/40" />
          <div className="pointer-events-auto absolute left-[7vw] top-1/2 flex max-h-full -translate-y-1/2 flex-col justify-center py-10">
            <div className="mb-10">
              <Title />
            </div>
            {mpScreen === "hub" && (
              <MpHub onCreate={() => setMpScreen("create")} onJoin={() => setMpScreen("join")} onBack={() => setMpScreen("off")} />
            )}
            {mpScreen === "create" && (
              <MpCreate
                name={mpName}
                onName={setMpName}
                seedInput={mpSeedInput}
                onSeedInput={setMpSeedInput}
                busy={mpBusy}
                error={mpError}
                onCreate={createRoom}
                onBack={() => setMpScreen("hub")}
              />
            )}
            {mpScreen === "join" && (
              <MpJoin
                name={mpName}
                onName={setMpName}
                code={mpCode}
                onCode={setMpCode}
                busy={mpBusy}
                error={mpError}
                onJoin={joinRoom}
                onBack={() => setMpScreen("hub")}
              />
            )}
            {mpScreen === "lobby" && lobby && (
              <MpLobby
                view={lobby}
                onStart={() => sessionRef.current?.startGame()}
                onLeave={() => void leaveMp()}
                onCopyCode={() => {
                  void navigator.clipboard?.writeText(lobby.code);
                  setCopied(lobby.code);
                }}
                onCopyLink={() => {
                  void navigator.clipboard?.writeText(inviteUrl(lobby.code));
                  setCopied("link");
                }}
                onCopySeed={handleCopySeed}
              />
            )}
            {copied && (
              <p className="mt-3 text-[10px] tracking-widest text-amber/70">
                {copied.startsWith("seed:") ? `SEED ${copied.slice(5)} COPIED` : "COPIED"}
              </p>
            )}
          </div>
        </div>
      )}

      {phase === "paused" && (
        <PauseMenu
          onResume={() => gameRef.current?.resume()}
          onRestart={restart}
          onMenu={toMenu}
          onPanel={setPausePanel}
          panel={pausePanel}
          settings={settings}
          onSettings={applySettings}
          confirm={confirm}
          onConfirm={setConfirm}
          coop={coopActive}
          seed={hud.seed}
          onCopySeed={handleCopySeed}
        />
      )}

      {phase === "ending" && hud.ending && !coopActive && (
        <EndingScreen
          ending={hud.ending}
          onRestart={() => gameRef.current?.playAgain()}
          onMenu={toMenu}
          seed={hud.seed}
          onCopySeed={handleCopySeed}
        />
      )}

      {escapedLocal && !results && lobby && (
        <MpEscaped
          time={hud.ending?.time ?? hud.time}
          exploring={lobby.players.filter((p) => p.status === "playing").length}
          escaped={lobby.players.filter((p) => p.status === "escaped").length}
          total={lobby.players.filter((p) => p.status !== "left").length}
          onLeave={() => void leaveMp()}
        />
      )}

      {results && (
        <MpResults
          results={results}
          duration={sessionDuration}
          host={!!sessionRef.current?.isHost}
          onAgain={() => sessionRef.current?.rematch()}
          onLeave={() => void leaveMp()}
        />
      )}

      {hostGone && <MpHostGone reason={hostGone} onMenu={() => void leaveMp()} />}

      {(phase === "loading" || phase === "boot") && <LoadingScreen frac={loading.frac} label={loading.label} />}

      {phase === "playing" && !locked && !error && !escapedLocal && !results && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center">
          <div className="panel mt-48 px-6 py-3 text-center">
            <div className="text-[13px] tracking-[0.3em] text-white/85">CLICK TO PLAY</div>
            <div className="mt-1 text-[10px] tracking-widest text-white/35">captures the mouse for looking around · ESC releases it</div>
          </div>
        </div>
      )}

      {error && <ErrorScreen message={error} />}
    </div>
  );
}
