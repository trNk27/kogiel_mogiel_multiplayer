import { useEffect, useRef } from 'preact/hooks';
import { BajaPatrol, resources } from '../lib/assets';

const CAMEO_W = 640;
const CAMEO_H = 44;
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

export interface BajaCameoProps {
  mode: 'menu' | 'celebrate';
}

/**
 * Purely cosmetic overlay rendering Baja & her quilted brown/tan carrier bag running around
 * intermittently along the bottom stage edge on menu and win/results screens.
 */
export function BajaCameo({ mode }: BajaCameoProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
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
  }, [mode]);

  return <canvas ref={canvasRef} class="baja-cameo" width={CAMEO_W} height={CAMEO_H} aria-hidden="true" />;
}
