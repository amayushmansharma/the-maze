import { useEffect, useRef } from "react";
import { CELL, GRID, ZONES, hasWall, idx } from "@/engine/maze";
import type { Game } from "@/engine/game";

interface MapState {
  maze: import("@/engine/maze").MazeData;
  visited: Uint8Array;
  player: { x: number; z: number; yaw: number };
  rooms: import("@/engine/maze").Room[];
}

const CS = 15;

export function MapPanel({ game, onClose }: { game: Game; onClose: () => void }) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const canvas = ref.current;
      if (!canvas) return;
      const s = game.getMapState() as MapState;
      if (!s?.maze) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const pad = 14;
      const size = GRID * CS + pad * 2;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (canvas.width !== size * dpr) {
        canvas.width = size * dpr;
        canvas.height = size * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);

      // device background
      ctx.fillStyle = "rgba(9,13,15,0.92)";
      ctx.fillRect(0, 0, size, size);
      ctx.strokeStyle = "rgba(216,178,106,0.10)";
      ctx.lineWidth = 1;
      for (let i = 0; i <= GRID; i += 2) {
        ctx.beginPath();
        ctx.moveTo(pad + i * CS, pad);
        ctx.lineTo(pad + i * CS, size - pad);
        ctx.moveTo(pad, pad + i * CS);
        ctx.lineTo(size - pad, pad + i * CS);
        ctx.stroke();
      }

      const m = s.maze;
      const revealed = (i: number, j: number) => s.visited[idx(i, j)] === 1;

      // revealed floor
      for (let j = 0; j < GRID; j++) {
        for (let i = 0; i < GRID; i++) {
          if (!revealed(i, j)) continue;
          const z = ZONES[m.zone[idx(i, j)]];
          ctx.fillStyle =
            z.id === "C"
              ? "rgba(120,150,90,0.20)"
              : z.id === "D"
                ? "rgba(80,130,150,0.20)"
                : z.id === "E"
                  ? "rgba(160,110,70,0.18)"
                  : z.id === "B"
                    ? "rgba(110,140,170,0.16)"
                    : "rgba(150,165,175,0.13)";
          ctx.fillRect(pad + i * CS, pad + j * CS, CS, CS);
        }
      }

      // walls / openings of revealed cells
      ctx.lineCap = "square";
      for (let j = 0; j < GRID; j++) {
        for (let i = 0; i < GRID; i++) {
          if (!revealed(i, j)) continue;
          const edges: [{ axis: "H" | "V"; i: number; j: number }, number, number, number, number][] = [
            [{ axis: "H", i, j }, 0, 0, CS, 0],
            [{ axis: "H", i, j: j + 1 }, 0, CS, CS, CS],
            [{ axis: "V", i, j }, 0, 0, 0, CS],
            [{ axis: "V", i: i + 1, j }, CS, 0, CS, CS],
          ];
          for (const [e, x0, y0, x1, y1] of edges) {
            const solid = hasWall(m, e);
            if (!solid) {
              ctx.strokeStyle = "rgba(220,232,238,0.42)";
              ctx.lineWidth = 2;
            } else {
              ctx.strokeStyle = "rgba(200,210,220,0.75)";
              ctx.lineWidth = 3;
            }
            ctx.beginPath();
            ctx.moveTo(pad + i * CS + x0, pad + j * CS + y0);
            ctx.lineTo(pad + i * CS + x1, pad + j * CS + y1);
            ctx.stroke();
          }
        }
      }

      // landmarks
      ctx.font = "8px ui-monospace, monospace";
      ctx.fillStyle = "rgba(216,178,106,0.9)";
      ctx.textAlign = "center";
      for (const r of s.rooms) {
        const x = pad + (r.i0 + r.w / 2) * CS;
        const y = pad + (r.j0 + r.h / 2) * CS;
        ctx.fillStyle = "rgba(216,178,106,0.16)";
        ctx.fillRect(pad + r.i0 * CS + 1, pad + r.j0 * CS + 1, r.w * CS - 2, r.h * CS - 2);
        ctx.fillStyle = "rgba(230,205,150,0.85)";
        ctx.fillText(r.label.slice(0, 12), x, y + 3);
      }

      // player
      const px = pad + (s.player.x / CELL) * CS;
      const py = pad + (s.player.z / CELL) * CS;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(-s.player.yaw);
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.moveTo(0, -6.5);
      ctx.lineTo(4.5, 5);
      ctx.lineTo(0, 2.5);
      ctx.lineTo(-4.5, 5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      // sweep line
      const t = (performance.now() / 2600) % 1;
      const grad = ctx.createLinearGradient(0, pad + t * (size - pad * 2) - 20, 0, pad + t * (size - pad * 2) + 8);
      grad.addColorStop(0, "rgba(216,178,106,0)");
      grad.addColorStop(1, "rgba(216,178,106,0.16)");
      ctx.fillStyle = grad;
      ctx.fillRect(pad, pad + t * (size - pad * 2) - 20, size - pad * 2, 28);

      // frame
      ctx.strokeStyle = "rgba(216,178,106,0.5)";
      ctx.lineWidth = 1;
      ctx.strokeRect(pad - 6, pad - 6, size - pad * 2 + 12, size - pad * 2 + 12);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [game]);

  return (
    <div className="pointer-events-auto absolute inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="panel relative fade-up p-5">
        <div className="mb-3 flex items-baseline justify-between gap-8">
          <div>
            <div className="text-[11px] tracking-[0.35em] text-amber">FIELD NAVIGATION UNIT</div>
            <div className="text-xs text-white/40">survey of passages you have walked</div>
          </div>
          <button onClick={onClose} className="rounded border hairline px-3 py-1 text-xs tracking-widest text-white/70 hover:bg-white/5">
            CLOSE [M]
          </button>
        </div>
        <canvas ref={ref} style={{ width: GRID * CS + 28, height: GRID * CS + 28 }} className="scanlines rounded-sm" />
        <div className="mt-3 flex flex-wrap gap-4 text-[10px] tracking-widest text-white/45">
          <span>▢ SOLID WALL</span>
          <span className="text-white/70">▬ OPEN PASSAGE</span>
          <span className="text-amber">◆ LANDMARK</span>
        </div>
      </div>
    </div>
  );
}
