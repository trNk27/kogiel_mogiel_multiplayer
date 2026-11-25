import { useEffect, useRef } from 'preact/hooks';
import { BAJA_LEAP_MS } from '../../../shared/cosmetics';
import { BajaPatrol, resources } from '../lib/assets';

const CAMEO_W = 640;
const CAMEO_H = 44;
const STAGE_W = 640;
const STAGE_H = 360;
const GROUND_Y = 41;

const LEFT_BAG_X = 36;
const LEFT_WAYPOINTS: readonly (readonly [number, number])[] = [
  [76, 0],
  [118, 0],
  [154, 0],
];

const RIGHT_BAG_X = 604;
const RIGHT_WAYPOINTS: readonly (readonly [number, number])[] = [
  [564, 0],
  [522, 0],
  [486, 0],
];

const WIN_WAYPOINTS: readonly (readonly [number, number])[] = [
  [112, 0],
  [235, 0],
  [405, 0],
  [528, 0],
];

export interface BajaLobbyVisit {
  key: number;
  playerId: string;
  phase: 'leap' | 'phone';
  startedAt: number;
}

export interface BajaCameoProps {
  mode: 'menu' | 'celebrate';
  visit?: BajaLobbyVisit | null;
}

function measureSlotTarget(stageEl: HTMLElement | null, playerId: string): { x: number; y: number } {
  if (!stageEl) return { x: STAGE_W * 0.65, y: 120 };
  const stageRect = stageEl.getBoundingClientRect();
  const slot = stageEl.querySelector<HTMLElement>(`[data-player-id="${playerId}"]`);
  if (!slot || stageRect.width <= 0 || stageRect.height <= 0) {
    return { x: STAGE_W * 0.65, y: 120 };
  }
  const r = slot.getBoundingClientRect();
  return {
    x: ((r.left + r.width * 0.5 - stageRect.left) / stageRect.width) * STAGE_W,
    y: ((r.top + r.height * 0.58 - stageRect.top) / stageRect.height) * STAGE_H,
  };
}

/**
 * Purely cosmetic overlay rendering Baja & her quilted brown/tan carrier bag running around
 * intermittently along the bottom stage edge on menu and win/results screens, plus her joyful leap
 * onto a lobby player's Pierogi card when the phone feeding minigame starts.
 */
export function BajaCameo({ mode, visit = null }: BajaCameoProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const leapCanvasRef = useRef<HTMLCanvasElement>(null);
  const lastXRef = useRef(LEFT_BAG_X);
  const visibleRef = useRef(false);

  const inPhone = visit?.phase === 'phone';
  const leaping = visit?.phase === 'leap';

  useEffect(() => {
    if (inPhone || leaping) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let alive = true;
    let rafId = 0;
    let side: 'left' | 'right' = 'left';

    const patrol = new BajaPatrol({
      bagX: LEFT_BAG_X,
      waypoints: mode === 'celebrate' ? WIN_WAYPOINTS : LEFT_WAYPOINTS,
      speed: mode === 'celebrate' ? 84 : 64,
      hopHeight: 8,
      hopSpan: 11,
      hideBetweenVisits: true,
      initialHidden: mode === 'celebrate' ? 0.85 : 2.8,
      hiddenRange: mode === 'celebrate' ? [4.5, 7.5] : [11, 18],
      inBagRange: mode === 'celebrate' ? [1.2, 2.0] : [2.2, 3.6],
      stopsRange: mode === 'celebrate' ? [2, 3] : [1, 2],
      seed: mode === 'celebrate' ? 314 : 108,
      onCycleHidden: () => {
        side = side === 'left' ? 'right' : 'left';
        const bagX = side === 'left' ? LEFT_BAG_X : RIGHT_BAG_X;
        const wps = mode === 'celebrate' ? WIN_WAYPOINTS : side === 'left' ? LEFT_WAYPOINTS : RIGHT_WAYPOINTS;
        patrol.setSide(bagX, wps);
      },
    });

    if (mode === 'celebrate') {
      patrol.celebrate();
    }

    void resources.preload(['pixel-common']);

    let last = performance.now();
    const frame = (now: number) => {
      if (!alive) return;
      rafId = requestAnimationFrame(frame);
      const dt = Math.min(0.08, Math.max(0, (now - last) / 1000));
      last = now;
      patrol.update(dt);

      visibleRef.current = patrol.bagVisible;
      lastXRef.current = patrol.bagVisible ? patrol.x : side === 'left' ? LEFT_BAG_X : RIGHT_BAG_X;

      ctx.clearRect(0, 0, CAMEO_W, CAMEO_H);
      ctx.imageSmoothingEnabled = false;

      if (!patrol.bagVisible) return;

      const bagX = Math.round(side === 'left' ? LEFT_BAG_X : RIGHT_BAG_X);
      const slideOffset = Math.round((1 - patrol.bagAlpha) * 6);
      const bagY = GROUND_Y + slideOffset;
      const inBag = patrol.phase === 'inBag' || patrol.phase === 'entering' || patrol.phase === 'leaving';

      // Soft pixel shadow under the carrier bag
      ctx.save();
      ctx.globalAlpha = patrol.bagAlpha * 0.32;
      ctx.fillStyle = '#0e070a';
      ctx.fillRect(bagX - 9, GROUND_Y, 18, 2);
      ctx.restore();

      if (inBag) {
        resources.draw(ctx, 'pixel-common', 'baja-bag', bagX, bagY, {
          anchor: 'bottom',
          time: patrol.time,
          flipX: side === 'right',
          alpha: patrol.bagAlpha,
        });
      } else {
        resources.draw(ctx, 'pixel-common', 'baja-bag-empty', bagX, bagY, {
          anchor: 'bottom',
          flipX: side === 'right',
          alpha: patrol.bagAlpha,
        });

        const bx = Math.round(patrol.x);
        const by = Math.round(GROUND_Y - patrol.hopY);

        ctx.fillStyle = 'rgba(14, 7, 10, 0.34)';
        ctx.fillRect(bx - 7, GROUND_Y, 14, 2);

        resources.draw(ctx, 'pixel-common', patrol.running ? 'baja-run' : 'baja-idle', bx, by, {
          anchor: 'bottom',
          flipX: patrol.facing < 0,
          time: patrol.time,
        });

        if (patrol.showHeart || mode === 'celebrate') {
          const lift = Math.round(Math.sin(patrol.time * 6) * 2);
          const heartY = by - 21 + lift;
          resources.draw(ctx, 'pixel-common', 'heart', bx, heartY, { anchor: 'center' });
          if (mode === 'celebrate') {
            resources.draw(ctx, 'pixel-common', 'sparkle', bx + 11, heartY - 2, {
              anchor: 'center',
              time: patrol.time,
            });
          }
        }
      }
    };

    rafId = requestAnimationFrame(frame);
    return () => {
      alive = false;
      cancelAnimationFrame(rafId);
    };
  }, [mode, inPhone, leaping]);

  useEffect(() => {
    if (!leaping || !visit) return;
    const canvas = leapCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    void resources.preload(['pixel-common']);

    let alive = true;
    let rafId = 0;
    const startX = visibleRef.current ? lastXRef.current : LEFT_BAG_X;
    const startY = 355;
    const t0 = performance.now();

    const frame = (now: number) => {
      if (!alive) return;
      rafId = requestAnimationFrame(frame);
      const elapsedS = (now - t0) / 1000;
      const p = Math.min(1, (now - t0) / BAJA_LEAP_MS);

      const stageEl = canvas.closest<HTMLElement>('.stage');
      const target = measureSlotTarget(stageEl, visit.playerId);

      ctx.clearRect(0, 0, STAGE_W, STAGE_H);
      ctx.imageSmoothingEnabled = false;

      // Empty bag stays anchored at bottom start spot during the leap
      const bagAlpha = p < 0.75 ? 1 : Math.max(0, 1 - (p - 0.75) / 0.25);
      if (bagAlpha > 0) {
        ctx.save();
        ctx.globalAlpha = bagAlpha * 0.3;
        ctx.fillStyle = '#0e070a';
        ctx.fillRect(Math.round(startX) - 9, startY, 18, 2);
        ctx.restore();
        resources.draw(ctx, 'pixel-common', p < 0.14 ? 'baja-bag' : 'baja-bag-empty', Math.round(startX), startY, {
          anchor: 'bottom',
          time: elapsedS,
          alpha: bagAlpha,
        });
      }

      if (p < 0.14) return;

      const facing = target.x >= startX ? 1 : -1;
      if (p < 0.85) {
        const u = (p - 0.14) / 0.71;
        const ease = 1 - Math.pow(1 - u, 2);
        const arc = Math.sin(u * Math.PI) * 96;
        const bx = startX + (target.x - startX) * ease;
        const by = startY + (target.y - startY) * ease - arc;
        const scale = 1 + 0.45 * Math.sin(u * Math.PI);

        // Sparkle trail
        for (let i = 1; i <= 2; i++) {
          const tu = Math.max(0, u - i * 0.08);
          const tease = 1 - Math.pow(1 - tu, 2);
          const tx = startX + (target.x - startX) * tease;
          const ty = startY + (target.y - startY) * tease - Math.sin(tu * Math.PI) * 96 - 8;
          resources.draw(ctx, 'pixel-common', 'sparkle', Math.round(tx), Math.round(ty), {
            anchor: 'center',
            time: elapsedS + i * 0.2,
            alpha: 0.7,
          });
        }

        resources.draw(ctx, 'pixel-common', 'baja-run', Math.round(bx), Math.round(by), {
          anchor: 'bottom',
          flipX: facing < 0,
          scale,
          time: elapsedS,
        });
      } else {
        // Landed on player card with heart & sparkle burst before hopping onto their phone
        const landU = (p - 0.85) / 0.15;
        const scale = 1.18 - 0.18 * landU;
        ctx.fillStyle = 'rgba(14, 7, 10, 0.34)';
        ctx.fillRect(Math.round(target.x) - 8, Math.round(target.y), 16, 2);
        resources.draw(ctx, 'pixel-common', 'baja-idle', Math.round(target.x), Math.round(target.y), {
          anchor: 'bottom',
          flipX: facing < 0,
          scale,
          time: elapsedS,
        });
        resources.draw(ctx, 'pixel-common', 'heart', Math.round(target.x), Math.round(target.y - 24), {
          anchor: 'center',
        });
        resources.draw(ctx, 'pixel-common', 'sparkle', Math.round(target.x + 12), Math.round(target.y - 22), {
          anchor: 'center',
          time: elapsedS,
        });
      }
    };

    rafId = requestAnimationFrame(frame);
    return () => {
      alive = false;
      cancelAnimationFrame(rafId);
    };
  }, [leaping, visit?.key, visit?.playerId]);

  if (leaping) {
    return <canvas ref={leapCanvasRef} class="baja-leap-canvas" width={STAGE_W} height={STAGE_H} aria-hidden="true" />;
  }
  if (inPhone) return null;
  return <canvas ref={canvasRef} class="baja-cameo" width={CAMEO_W} height={CAMEO_H} aria-hidden="true" />;
}
