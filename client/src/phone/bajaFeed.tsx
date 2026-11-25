import { useEffect, useRef, useState } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { BAJA_FEED_ITEMS } from '../../../shared/cosmetics';
import { drawPixelText, resources } from '../lib/assets';
import {
  BAG_MOUTH_Y,
  BAG_START_Y,
  BajaFeedSim,
  bonePosition,
  FEED_H,
  FEED_W,
  LAUNCH_Y,
  PROMPT_Y,
  type TreatKind,
} from './bajaFeedLogic';

/** How long the "+X 🦴" box stays up before the minigame closes. */
const DONE_HOLD_MS = 1600;
/** Phases where Baja is still arriving. */
const ARRIVING = new Set(['bagIntro', 'drop', 'land', 'hopOut', 'runBack']);

/** A jagged "shout" outline around (100, 48), for the FEED ME! speech bubble. */
const SHOUT_PATH = (() => {
  const pts: string[] = [];
  const n = 26;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = i % 2 === 0 ? 1 : 0.8 + 0.06 * Math.sin(i * 2.3);
    pts.push(`${(100 + Math.cos(a) * 94 * r).toFixed(1)},${(48 + Math.sin(a) * 42 * r).toFixed(1)}`);
  }
  return `M${pts.join('L')}Z`;
})();

const TREAT_LABEL: Record<TreatKind, string> = {
  kielbasa: 'Kiełbasa',
  cheese: 'Cheese',
  chicken: 'Chicken',
  pierogi: 'Pierogi',
  biscuit: 'Treat',
};

function drawTreat(ctx: CanvasRenderingContext2D, kind: TreatKind, x: number, y: number, scale = 1, angle = 0) {
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  if (angle) ctx.rotate(angle);
  const s = Math.max(1, Math.round(scale * 2));
  ctx.scale(s, s);
  // Dark outline helper via centered pixel blocks
  switch (kind) {
    case 'kielbasa':
      ctx.fillStyle = '#2a120a';
      ctx.fillRect(-6, -3, 12, 6);
      ctx.fillStyle = '#a8442a';
      ctx.fillRect(-5, -2, 10, 4);
      ctx.fillStyle = '#d96f4a';
      ctx.fillRect(-4, -1, 7, 2);
      ctx.fillStyle = '#f4b590';
      ctx.fillRect(-3, -1, 3, 1);
      break;
    case 'cheese':
      ctx.fillStyle = '#2a120a';
      ctx.fillRect(-5, -4, 10, 8);
      ctx.fillStyle = '#f2b705';
      ctx.fillRect(-4, -3, 8, 6);
      ctx.fillStyle = '#ffe169';
      ctx.fillRect(-4, -3, 8, 2);
      ctx.fillStyle = '#c48300';
      ctx.fillRect(-2, 0, 2, 2);
      ctx.fillRect(1, -1, 2, 2);
      break;
    case 'chicken':
      ctx.fillStyle = '#2a120a';
      ctx.fillRect(-6, -3, 11, 6);
      ctx.fillStyle = '#fff4dc';
      ctx.fillRect(2, -1, 3, 2);
      ctx.fillStyle = '#c97234';
      ctx.fillRect(-5, -2, 7, 4);
      ctx.fillStyle = '#eba05b';
      ctx.fillRect(-4, -2, 4, 2);
      break;
    case 'pierogi':
      ctx.fillStyle = '#2a120a';
      ctx.fillRect(-6, -3, 12, 6);
      ctx.fillStyle = '#ffd23f';
      ctx.fillRect(-5, -2, 10, 4);
      ctx.fillStyle = '#ffe999';
      ctx.fillRect(-4, -2, 8, 1);
      break;
    case 'biscuit':
      ctx.fillStyle = '#2a120a';
      ctx.fillRect(-6, -3, 12, 6);
      ctx.fillRect(-6, -4, 3, 2);
      ctx.fillRect(3, -4, 3, 2);
      ctx.fillRect(-6, 2, 3, 2);
      ctx.fillRect(3, 2, 3, 2);
      ctx.fillStyle = '#fff1d0';
      ctx.fillRect(-5, -2, 10, 4);
      ctx.fillRect(-5, -3, 2, 1);
      ctx.fillRect(3, -3, 2, 1);
      ctx.fillRect(-5, 2, 2, 1);
      ctx.fillRect(3, 2, 2, 1);
      break;
  }
  ctx.restore();
}

/** A little pixel bone (Baja's currency). */
function drawBone(ctx: CanvasRenderingContext2D, x: number, y: number, scale = 2, angle = 0) {
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  if (angle) ctx.rotate(angle);
  ctx.scale(scale, scale);
  ctx.fillStyle = '#2a120a';
  ctx.fillRect(-6, -2, 12, 4);
  ctx.fillRect(-7, -4, 4, 8);
  ctx.fillRect(3, -4, 4, 8);
  ctx.fillStyle = '#fff4dc';
  ctx.fillRect(-5, -1, 10, 2);
  ctx.fillRect(-6, -3, 2, 2);
  ctx.fillRect(-6, 1, 2, 2);
  ctx.fillRect(4, -3, 2, 2);
  ctx.fillRect(4, 1, 2, 2);
  ctx.fillStyle = '#d9c6a0';
  ctx.fillRect(-5, 0, 10, 1);
  ctx.restore();
}

/** The thump of Baja landing in her bag: dust clouds rolling out and short impact lines. */
function drawImpact(ctx: CanvasRenderingContext2D, x: number, u: number) {
  const base = BAG_START_Y - 3;
  ctx.save();
  ctx.globalAlpha = Math.max(0, 1 - u);
  ctx.fillStyle = '#e8d6b4';
  for (const side of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const spread = 36 + k * 9 + 34 * u;
      const r = Math.round(3 + k + 6 * u);
      const px = Math.round(x + side * spread);
      const py = Math.round(base - k * 5 - 8 * u);
      ctx.fillRect(px - r, py - r, r * 2, r * 2);
    }
  }
  if (u < 0.45) {
    ctx.globalAlpha = 1 - u / 0.45;
    ctx.fillStyle = '#ffd23f';
    const top = BAG_MOUTH_Y - 18;
    for (const [dx, len] of [
      [-30, 10],
      [-14, 14],
      [14, 14],
      [30, 10],
    ]) {
      const lift = Math.round(u * 20);
      ctx.fillRect(Math.round(x + dx * (1 + u)), top - len - lift, 2, len);
    }
  }
  ctx.restore();
}

function drawRoom(ctx: CanvasRenderingContext2D) {
  // Cozy back wall + perspective wooden floor + rug leading to the back
  ctx.fillStyle = '#241830';
  ctx.fillRect(0, 0, FEED_W, 42);
  ctx.fillStyle = '#382547';
  ctx.fillRect(0, 42, FEED_W, 8);

  // Warm wooden floor from back (y=50) to front (y=280)
  ctx.fillStyle = '#5a3525';
  ctx.fillRect(0, 50, FEED_W, FEED_H - 50);

  // Subtle floor planks converging toward back-center vanishing point
  ctx.strokeStyle = 'rgba(22, 10, 12, 0.28)';
  ctx.lineWidth = 1;
  for (let i = -3; i <= 3; i++) {
    ctx.beginPath();
    ctx.moveTo(FEED_W / 2 + i * 24, 50);
    ctx.lineTo(FEED_W / 2 + i * 68, FEED_H);
    ctx.stroke();
  }

  // Striped perspective rug in the middle ground
  ctx.fillStyle = '#7e3046';
  ctx.beginPath();
  ctx.moveTo(46, 52);
  ctx.lineTo(134, 52);
  ctx.lineTo(168, 178);
  ctx.lineTo(12, 178);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = '#ffd23f';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(50, 55);
  ctx.lineTo(130, 55);
  ctx.lineTo(161, 174);
  ctx.lineTo(19, 174);
  ctx.closePath();
  ctx.stroke();

  // Soft dividing band above Baja's top zone
  ctx.fillStyle = 'rgba(255, 210, 63, 0.14)';
  ctx.fillRect(0, 49, FEED_W, 56);
  ctx.fillStyle = 'rgba(255, 210, 63, 0.25)';
  ctx.fillRect(0, 104, FEED_W, 1);

  // Bottom fling tray zone
  ctx.fillStyle = 'rgba(18, 10, 22, 0.52)';
  ctx.fillRect(0, 206, FEED_W, FEED_H - 206);
  ctx.fillStyle = 'rgba(255, 244, 220, 0.14)';
  ctx.fillRect(0, 206, FEED_W, 1);
}

interface BajaFeedModalProps {
  feedKey: number;
  onDone: (fed: number) => void;
}

export function BajaFeedModal({ feedKey, onDone }: BajaFeedModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  /** Covers the whole phone screen, so Baja can fall from its very top (over the header). */
  const dropRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<BajaFeedSim>(new BajaFeedSim(feedKey * 97 + 13));
  const dragRef = useRef<{
    id: number;
    startX: number;
    startY: number;
    curX: number;
    curY: number;
    startMs: number;
    moveMs: number;
  } | null>(null);
  const hintRef = useRef(0);
  const finishedSentRef = useRef(false);

  const [hud, setHud] = useState({
    phase: 'bagIntro',
    remaining: BAJA_FEED_ITEMS,
    fed: 0,
    treat: 'kielbasa' as TreatKind | null,
  });

  useEffect(() => {
    const sim = new BajaFeedSim(feedKey * 97 + 13);
    simRef.current = sim;
    finishedSentRef.current = false;
    hintRef.current = 0;
    dragRef.current = null;
    void resources.preload(['pixel-common']);

    let alive = true;
    let rafId = 0;
    let finishTimer = 0;
    let last = performance.now();
    let dropDrawn = false;
    let thumped = false;

    const frame = (now: number) => {
      if (!alive) return;
      rafId = requestAnimationFrame(frame);
      const dt = Math.min(0.08, Math.max(0, (now - last) / 1000));
      last = now;

      if (hintRef.current > 0) hintRef.current = Math.max(0, hintRef.current - dt);
      sim.update(dt);

      const nextTreat = sim.currentTreat();
      setHud((prev) =>
        prev.phase === sim.phase && prev.remaining === sim.remaining && prev.fed === sim.fed && prev.treat === nextTreat
          ? prev
          : { phase: sim.phase, remaining: sim.remaining, fed: sim.fed, treat: nextTreat },
      );

      if (sim.phase === 'done' && !finishedSentRef.current && !finishTimer) {
        finishTimer = window.setTimeout(() => {
          if (!alive || finishedSentRef.current) return;
          finishedSentRef.current = true;
          onDone(sim.fed);
        }, DONE_HOLD_MS);
      }
      if (sim.phase === 'land' && !thumped) {
        thumped = true;
        navigator.vibrate?.(40);
      }

      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;

      // Baja falling from the top of the phone screen into her bag, drawn over the whole page.
      const drop = dropRef.current;
      const dctx = drop?.getContext('2d');
      if (drop && dctx) {
        if (sim.phase === 'drop') {
          const rect = canvas.getBoundingClientRect();
          const px = rect.width / FEED_W || 1;
          const w = Math.ceil(window.innerWidth / px);
          const h = Math.ceil(window.innerHeight / px);
          if (drop.width !== w || drop.height !== h) {
            drop.width = w;
            drop.height = h;
          }
          dctx.imageSmoothingEnabled = false;
          dctx.clearRect(0, 0, w, h);
          const ox = rect.left / px;
          const oy = rect.top / px;
          const u = sim.dropProgress();
          const x = Math.round(ox + sim.bagX);
          const lip = oy + BAG_MOUTH_Y;
          // Falls like a stone (accelerating) and ends with her body inside the bag.
          const y = Math.round(lip + 26 - (lip + 26) * (1 - u * u));
          dctx.save();
          dctx.beginPath();
          dctx.rect(0, 0, w, Math.round(lip));
          dctx.clip();
          dctx.fillStyle = 'rgba(255, 244, 220, 0.55)';
          for (const dx of [-14, 0, 14]) {
            const len = Math.round(10 + 30 * u);
            dctx.fillRect(x + dx, y - 48 - len - 4, 2, len);
          }
          resources.draw(dctx, 'pixel-common', 'baja-run', x, y, { anchor: 'bottom', scale: 3, time: sim.time * 2 });
          dctx.restore();
          dropDrawn = true;
        } else if (dropDrawn) {
          dctx.clearRect(0, 0, drop.width, drop.height);
          dropDrawn = false;
        }
      }

      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, FEED_W, FEED_H);
      drawRoom(ctx);

      // Carrier bag (hero close-up during intro, sliding away on hop out)
      if (sim.bagVisible) {
        const bx = Math.round(sim.bagX);
        const by = Math.round(sim.bagY);
        ctx.fillStyle = 'rgba(12, 6, 10, 0.36)';
        ctx.fillRect(bx - Math.round(11 * sim.bagScale), by - 1, Math.round(22 * sim.bagScale), 4);
        const sq = sim.bagSquash * 0.28;
        const natH = sim.bagEmpty ? 16 : 22;
        resources.draw(ctx, 'pixel-common', sim.bagEmpty ? 'baja-bag-empty' : 'baja-bag', bx, by, {
          anchor: 'bottom',
          w: Math.round(22 * sim.bagScale * (1 + sq)),
          h: Math.round(natH * sim.bagScale * (1 - sq)),
          time: sim.time,
        });
      }
      if (sim.phase === 'land') drawImpact(ctx, sim.bagX, Math.min(1, sim.phaseTime / 0.5));

      // Baja (shrinks smoothly as she runs to the back, then patrols upper area)
      if (sim.bajaVisible) {
        const px = Math.round(sim.bajaX);
        const py = Math.round(sim.bajaY - sim.bajaHopY);
        ctx.fillStyle = 'rgba(12, 6, 10, 0.34)';
        const shW = Math.round(14 * sim.bajaScale);
        ctx.fillRect(px - Math.round(shW / 2), Math.round(sim.bajaY) - 1, shW, 3);

        resources.draw(ctx, 'pixel-common', sim.bajaRunning ? 'baja-run' : 'baja-idle', px, py, {
          anchor: 'bottom',
          scale: sim.bajaScale,
          flipX: sim.bajaFacing < 0,
          time: sim.time,
        });

        if (sim.bajaHappyTimer > 0 || ((sim.phase === 'done' || sim.phase === 'spit') && sim.fed > 0)) {
          const lift = Math.round(Math.sin(sim.time * 8) * 2);
          resources.draw(ctx, 'pixel-common', 'heart', px, Math.round(py - 21 * sim.bajaScale + lift), {
            anchor: 'center',
            scale: Math.max(1, sim.bajaScale * 0.75),
          });
          resources.draw(
            ctx,
            'pixel-common',
            'sparkle',
            px + Math.round(11 * sim.bajaScale),
            Math.round(py - 18 * sim.bajaScale - lift),
            {
              anchor: 'center',
              scale: Math.max(1, sim.bajaScale * 0.7),
              time: sim.time,
            },
          );
        }
      }

      // Active projectiles
      for (const p of sim.projectiles) {
        drawTreat(ctx, p.kind, p.x, p.y, p.scale * 1.15, p.angle);
      }

      // Bones Baja spat out, flying to (and lying on) the floor.
      for (const b of sim.bones) {
        const pos = bonePosition(b);
        drawBone(ctx, pos.x, pos.y, 2, pos.landed ? 0 : b.age * 14);
      }

      // Ready treat in bottom launch zone + live aim guide during swipe
      if (sim.phase === 'play' && sim.remaining > 0) {
        const drag = dragRef.current;
        const treat = sim.currentTreat();
        const readyX = drag ? Math.max(28, Math.min(FEED_W - 28, drag.startX)) : FEED_W / 2;
        if (drag && drag.curY < drag.startY - 8) {
          ctx.save();
          ctx.strokeStyle = 'rgba(255, 210, 63, 0.78)';
          ctx.lineWidth = 2;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(readyX, LAUNCH_Y);
          const dx = drag.curX - drag.startX;
          const dy = drag.curY - drag.startY;
          const len = Math.hypot(dx, dy) || 1;
          ctx.lineTo(readyX + (dx / len) * 64, LAUNCH_Y + (dy / len) * 64);
          ctx.stroke();
          ctx.restore();
        } else {
          // Gentle upward chevron cues
          const bob = Math.round(Math.sin(sim.time * 4.5) * 2);
          drawPixelText(ctx, '^', FEED_W / 2, LAUNCH_Y - 26 + bob, {
            align: 'center',
            color: 'rgba(255, 210, 63, 0.65)',
          });
        }
        if (treat) {
          drawTreat(ctx, treat, readyX, LAUNCH_Y, 1.4, Math.sin(sim.time * 3) * 0.08);
        }
      }

      // Floating cues ("NOM! +1 🦴" / "Missed!")
      for (const c of sim.cues) {
        drawPixelText(ctx, c.text.replace('🦴', ''), Math.round(c.x), Math.round(c.y), {
          align: 'center',
          color: c.good ? '#ffd23f' : '#ff8a8a',
          outline: '#120d1b',
        });
      }

      if (hintRef.current > 0 && sim.phase === 'play') {
        drawPixelText(ctx, 'FLING UP!', FEED_W / 2, LAUNCH_Y - 40, {
          align: 'center',
          color: '#ffd23f',
          outline: '#120d1b',
        });
      }
    };

    rafId = requestAnimationFrame(frame);
    return () => {
      alive = false;
      cancelAnimationFrame(rafId);
      clearTimeout(finishTimer);
    };
  }, [feedKey, onDone]);

  const toCanvasCoords = (clientX: number, clientY: number) => {
    const el = canvasRef.current;
    if (!el) return { x: FEED_W / 2, y: LAUNCH_Y };
    const rect = el.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / Math.max(1, rect.width)) * FEED_W,
      y: ((clientY - rect.top) / Math.max(1, rect.height)) * FEED_H,
    };
  };

  const onPointerDown = (e: PointerEvent) => {
    const sim = simRef.current;
    if (sim.phase !== 'play' || sim.remaining <= 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const pt = toCanvasCoords(e.clientX, e.clientY);
    dragRef.current = {
      id: e.pointerId,
      startX: pt.x,
      startY: pt.y,
      curX: pt.x,
      curY: pt.y,
      startMs: e.timeStamp || performance.now(),
      moveMs: e.timeStamp || performance.now(),
    };
  };

  const onPointerMove = (e: PointerEvent) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    const pt = toCanvasCoords(e.clientX, e.clientY);
    d.curX = pt.x;
    d.curY = pt.y;
    d.moveMs = e.timeStamp || performance.now();
  };

  const releaseDrag = (e: PointerEvent) => {
    const d = dragRef.current;
    if (!d || d.id !== e.pointerId) return;
    dragRef.current = null;
    const pt = toCanvasCoords(e.clientX, e.clientY);
    const dx = pt.x - d.startX;
    const dy = pt.y - d.startY;
    const dt = (e.timeStamp || performance.now()) - d.startMs;
    const ok = simRef.current.fling(dx, dy, dt, d.startX);
    if (!ok && simRef.current.phase === 'play' && simRef.current.remaining > 0) {
      hintRef.current = 0.9;
    }
  };

  const skip = () => {
    if (finishedSentRef.current) return;
    finishedSentRef.current = true;
    onDone(simRef.current.fed);
  };

  return (
    <div class="baja-feed-backdrop" role="dialog" aria-label="Feed Baja minigame">
      {/* On <body>, so falling Baja passes in front of the phone's name tag too. */}
      {createPortal(<canvas ref={dropRef} class="baja-drop-layer" aria-hidden="true" />, document.body)}
      <div class="baja-feed-card">
        <div class="baja-feed-head">
          <span class="baja-feed-title">
            {ARRIVING.has(hud.phase)
              ? '🐾 Baja hopped onto your phone!'
              : hud.phase === 'done' || hud.phase === 'spit'
                ? `🎉 Fed Baja ${hud.fed} ${hud.fed === 1 ? 'time' : 'times'}!`
                : '🐾 Feed Baja!'}
          </span>
          <span class="baja-feed-score">🦴 {hud.fed}</span>
          <button type="button" class="baja-feed-close" onClick={skip} aria-label="Close">
            ✕
          </button>
        </div>

        <div class={`baja-feed-stage ${hud.phase === 'land' ? 'thump' : ''}`}>
          <canvas
            ref={canvasRef}
            class="baja-feed-canvas"
            width={FEED_W}
            height={FEED_H}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={releaseDrag}
            onPointerCancel={releaseDrag}
          />
          {hud.phase === 'prompt' && (
            // A shouty speech bubble whose tail points down at Baja's head.
            <div class="baja-shout" style={{ bottom: `${((FEED_H - (PROMPT_Y - 30)) / FEED_H) * 100}%` }}>
              <svg class="baja-shout-in" viewBox="0 0 200 116" aria-label="FEED ME!">
                <path d="M84,80 L100,114 L112,78Z" class="baja-shout-shape" />
                <path d={SHOUT_PATH} class="baja-shout-shape" />
                <path d="M86,78 L100,108 L110,76Z" class="baja-shout-fill" />
                <text x="100" y="61" text-anchor="middle" transform="rotate(-5 100 48)">
                  FEED ME!
                </text>
              </svg>
            </div>
          )}
          {hud.phase === 'done' && (
            <div class="baja-feed-banner pop-in done">
              <b>{`+${hud.fed} 🦴`}</b>
            </div>
          )}
        </div>

        <div class="baja-feed-foot">
          <div class="baja-treats-left" aria-label={`${hud.remaining} treats left`}>
            {Array.from({ length: BAJA_FEED_ITEMS }, (_, i) => {
              const active = i < hud.remaining;
              return (
                <span class={`baja-treat-pip ${active ? 'on' : 'used'}`} key={i}>
                  {active ? '🦴' : '·'}
                </span>
              );
            })}
          </div>
          <span class="baja-feed-hint">
            {hud.phase === 'play' && hud.treat
              ? `Swipe up to toss ${TREAT_LABEL[hud.treat]} directly at Baja`
              : hud.phase === 'spit'
                ? 'Ptoo! Here are your bones…'
                : hud.phase === 'done'
                  ? hud.fed > 0
                    ? 'Look at the TV!'
                    : 'No bones this time – maybe next time!'
                  : 'Watch her…'}
          </span>
        </div>
      </div>
    </div>
  );
}
