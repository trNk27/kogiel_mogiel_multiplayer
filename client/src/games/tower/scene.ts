import type { ColorId } from '../../../../shared/protocol';
import { BajaPatrol, PIXEL_H, PIXEL_W, ditherBand, drawPixelText, resources } from '../../lib/assets';
import { mulberry32 } from '../rng';
import {
  FLOORS,
  FLOOR_STEP,
  GROUND_Y,
  SUMMIT_Y,
  WALL_L,
  WALL_R,
  type PlatformKind,
  type TowerEvent,
  type TowerSim,
  type TowerTheme,
} from './logic';
import { TOWER_PACK_ID } from './sprites';

export interface TowerLook {
  name: string;
  color: string;
  colorId: ColorId;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

interface Callout {
  text: string;
  x: number;
  y: number;
  color: string;
  life: number;
  maxLife: number;
}

interface SnowFlake {
  x: number;
  y: number;
  vy: number;
  vx: number;
  size: 1 | 2;
}

interface TrailSample {
  x: number;
  y: number;
  frame: number;
  flipX: boolean;
  alpha: number;
}

const THEME_PALETTES: Record<TowerTheme, { sky: [string, string, string, string]; mountainA: string; mountainB: string; snowRim: string; hill: string; shaftTint: string }> = {
  frost: {
    sky: ['#0b0f26', '#131b42', '#1d2b61', '#2c4180'],
    mountainA: '#18224a',
    mountainB: '#25356b',
    snowRim: '#ccecff',
    hill: '#d9f2ff',
    shaftTint: 'rgba(10, 14, 34, 0.25)',
  },
  aurora: {
    sky: ['#071224', '#0e243d', '#163c54', '#1d5466'],
    mountainA: '#102940',
    mountainB: '#1c405c',
    snowRim: '#a3ffeb',
    hill: '#cceeff',
    shaftTint: 'rgba(12, 32, 46, 0.24)',
  },
  blizzard: {
    sky: ['#11172b', '#1b2545', '#2a3963', '#3b4e7a'],
    mountainA: '#1d2747',
    mountainB: '#2d3b66',
    snowRim: '#e8f7ff',
    hill: '#e6f7ff',
    shaftTint: 'rgba(20, 28, 52, 0.22)',
  },
};

const PLAT_SPRITE: Record<PlatformKind, string> = {
  ground: 'plat-stone',
  stone: 'plat-stone',
  ice: 'plat-ice',
  crumble: 'plat-crumble',
  moving: 'plat-moving',
  summit: 'summit-plat',
};

const TORCH_POSITIONS: readonly [number, number][] = [
  [WALL_L + 8, 92],
  [WALL_R - 8, 92],
  [WALL_L + 8, 192],
  [WALL_R - 8, 192],
  [WALL_L + 8, 292],
  [WALL_R - 8, 292],
];

export class TowerScene {
  private ctx: CanvasRenderingContext2D;
  private staticCanvas: HTMLCanvasElement;
  private hidden = new Set<number>();
  private visTime = 0;
  private shakeTime = 0;
  private shakeAmp = 0;
  private particles: Particle[] = [];
  private callouts: Callout[] = [];
  private snow: SnowFlake[] = [];
  private trails: TrailSample[][] = [];
  private trailTimer = 0;
  private builtTheme: TowerTheme | null = null;
  private baja: BajaPatrol;

  constructor(
    canvas: HTMLCanvasElement,
    private looks: TowerLook[],
  ) {
    this.ctx = resources.prepareCanvas(canvas, 'pixel')!;
    this.staticCanvas = document.createElement('canvas');
    this.staticCanvas.width = PIXEL_W;
    this.staticCanvas.height = PIXEL_H;
    this.trails = looks.map(() => []);
    this.baja = new BajaPatrol({
      bagX: 542,
      waypoints: [
        [568, 0],
        [596, 0],
        [620, 0],
        [578, 0],
      ],
      speed: 38,
      hopHeight: 7,
      hopSpan: 11,
      hideBetweenVisits: false,
      initialInBag: 2.2,
      inBagRange: [4.5, 8.5],
      stopsRange: [2, 3],
      seed: 17,
    });
    this.initSnow();
    void resources.preload(['pixel-common', TOWER_PACK_ID]);
  }

  private initSnow() {
    const rnd = mulberry32(42);
    this.snow = Array.from({ length: 52 }, () => ({
      x: Math.floor(rnd() * PIXEL_W),
      y: Math.floor(rnd() * PIXEL_H),
      vy: 14 + rnd() * 22,
      vx: -6 - rnd() * 8,
      size: rnd() < 0.22 ? 2 : 1,
    }));
  }

  reset(sim: TowerSim) {
    this.particles = [];
    this.callouts = [];
    this.shakeTime = 0;
    this.shakeAmp = 0;
    this.trails = this.looks.map(() => []);
    this.builtTheme = null;
    this.buildStatic(sim.theme);
  }

  hide(idx: number) {
    this.hidden.add(idx);
  }

  dispose() {
    this.particles = [];
    this.callouts = [];
    this.trails = [];
  }

  private buildStatic(theme: TowerTheme) {
    if (this.builtTheme === theme) return;
    this.builtTheme = theme;
    const ctx = this.staticCanvas.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    const pal = THEME_PALETTES[theme];
    const rnd = mulberry32(theme === 'frost' ? 101 : theme === 'aurora' ? 202 : 303);

    // 1. Dithered winter twilight sky bands.
    const bandH = 68;
    ctx.fillStyle = pal.sky[0];
    ctx.fillRect(0, 0, PIXEL_W, bandH);
    ditherBand(ctx, 0, bandH, PIXEL_W, 18, pal.sky[0], pal.sky[1], 0.5);
    ctx.fillStyle = pal.sky[1];
    ctx.fillRect(0, bandH + 18, PIXEL_W, bandH);
    ditherBand(ctx, 0, bandH * 2 + 18, PIXEL_W, 18, pal.sky[1], pal.sky[2], 0.5);
    ctx.fillStyle = pal.sky[2];
    ctx.fillRect(0, bandH * 2 + 36, PIXEL_W, bandH);
    ditherBand(ctx, 0, bandH * 3 + 36, PIXEL_W, 18, pal.sky[2], pal.sky[3], 0.5);
    ctx.fillStyle = pal.sky[3];
    ctx.fillRect(0, bandH * 3 + 54, PIXEL_W, PIXEL_H - (bandH * 3 + 54));

    // Twinkling pixel stars on the flanks.
    for (let k = 0; k < 56; k++) {
      const sx = rnd() < 0.5 ? Math.floor(8 + rnd() * 140) : Math.floor(492 + rnd() * 140);
      const sy = Math.floor(10 + rnd() * 210);
      ctx.fillStyle = k % 5 === 0 ? '#ffd23f' : '#d6f0ff';
      ctx.fillRect(sx, sy, 1, 1);
      if (k % 9 === 0) {
        ctx.fillStyle = 'rgba(214, 240, 255, 0.45)';
        ctx.fillRect(sx - 1, sy, 1, 1);
        ctx.fillRect(sx + 1, sy, 1, 1);
        ctx.fillRect(sx, sy - 1, 1, 1);
        ctx.fillRect(sx, sy + 1, 1, 1);
      }
    }

    // Crescent moon on right sky.
    if (theme !== 'blizzard') {
      const mx = 590;
      const my = 44;
      for (let dy = -12; dy <= 12; dy++) {
        for (let dx = -12; dx <= 12; dx++) {
          if (dx * dx + dy * dy <= 144 && (dx - 5) * (dx - 5) + (dy + 2) * (dy + 2) > 100) {
            ctx.fillStyle = dy < -2 ? '#fff9d6' : '#ffe48a';
            ctx.fillRect(mx + dx, my + dy, 1, 1);
          }
        }
      }
    }

    // Distant Tatra mountain silhouettes across the bottom third.
    const drawRidge = (baseY: number, amp: number, freq: number, fill: string, snowCap: boolean) => {
      for (let x = 0; x < PIXEL_W; x++) {
        if (x >= WALL_L - 16 && x < WALL_R + 16) continue;
        const n = Math.abs(Math.sin(x * freq + 0.6)) * amp + Math.abs(Math.sin(x * freq * 2.3 + 1.4)) * (amp * 0.45);
        const topY = Math.round(baseY - n);
        ctx.fillStyle = fill;
        ctx.fillRect(x, topY, 1, PIXEL_H - topY);
        if (snowCap && n > amp * 0.62) {
          ctx.fillStyle = pal.snowRim;
          ctx.fillRect(x, topY, 1, 3);
        }
      }
    };
    drawRidge(308, 48, 0.021, pal.mountainA, true);
    drawRidge(324, 34, 0.032, pal.mountainB, false);

    // Snow banks + pixel pines on left and right flanks.
    ctx.fillStyle = pal.hill;
    ctx.fillRect(0, 338, PIXEL_W, 22);
    ctx.fillStyle = '#9ac8e8';
    ctx.fillRect(0, 348, PIXEL_W, 12);

    for (const px of [124, 146, 494, 518]) {
      resources.draw(ctx, TOWER_PACK_ID, 'pine', px, 340, { anchor: 'bottom' });
    }

    // 2. Central Tower Interior Brick Shaft.
    for (let y = 0; y < PIXEL_H; y += 16) {
      for (let x = WALL_L; x < WALL_R; x += 16) {
        resources.draw(ctx, TOWER_PACK_ID, 'brick-bg', x, y, { anchor: 'topleft' });
      }
    }
    ctx.fillStyle = pal.shaftTint;
    ctx.fillRect(WALL_L, 0, WALL_R - WALL_L, PIXEL_H);

    // Gothic windows at symmetric bays.
    for (const wy of [64, 162, 260]) {
      resources.draw(ctx, TOWER_PACK_ID, 'window', 238, wy, { anchor: 'center' });
      resources.draw(ctx, TOWER_PACK_ID, 'window', 402, wy, { anchor: 'center' });
    }

    // Outer border outlines + Left & Right bounceable stone brick walls.
    ctx.fillStyle = '#0c0e1c';
    ctx.fillRect(WALL_L - 18, 0, 18, PIXEL_H);
    ctx.fillRect(WALL_R, 0, 18, PIXEL_H);
    for (let y = 0; y < PIXEL_H; y += 16) {
      resources.draw(ctx, TOWER_PACK_ID, 'wall-block', WALL_L - 16, y, { anchor: 'topleft' });
      resources.draw(ctx, TOWER_PACK_ID, 'wall-block', WALL_R, y, { anchor: 'topleft', flipX: true });
    }

    // Floor milestone plaques (5, 10, 15) inlaid on the left stone wall so platforms never cover them.
    for (const mf of [5, 10, 15]) {
      const py = GROUND_Y - mf * FLOOR_STEP;
      ctx.fillStyle = '#120d1b';
      ctx.fillRect(WALL_L - 16, py - 5, 16, 11);
      ctx.fillStyle = '#2d355e';
      ctx.fillRect(WALL_L - 15, py - 4, 14, 9);
      drawPixelText(ctx, `${mf}`, WALL_L - 8, py, { align: 'center', baseline: 'middle', color: '#ffd23f' });
    }

    // Floor 0 ground threshold & foundation.
    ctx.fillStyle = '#141830';
    ctx.fillRect(WALL_L, GROUND_Y, WALL_R - WALL_L, PIXEL_H - GROUND_Y);
    resources.drawTileRow(ctx, TOWER_PACK_ID, 'plat-stone', WALL_L, GROUND_Y, WALL_R - WALL_L);
    ditherBand(ctx, WALL_L, GROUND_Y + 8, WALL_R - WALL_L, PIXEL_H - (GROUND_Y + 8), '#202647', '#13162b', 0.5);
  }

  onEvent(ev: TowerEvent, sim: TowerSim) {
    switch (ev.t) {
      case 'jump':
        this.spawnBurst(ev.x, ev.y, 4, '#eefaff', 38, 0.35);
        break;
      case 'superJump':
        this.spawnBurst(ev.x, ev.y, 9, '#ffd23f', 65, 0.45);
        break;
      case 'wallBounce':
        this.spawnBurst(ev.x, ev.y, 10, '#79d2ff', 75, 0.45);
        this.shake(0.1, 1.5);
        this.addCallout('BOUNCE!', ev.x + ev.dir * 22, ev.y - 8, '#79d2ff');
        break;
      case 'spring':
        this.spawnBurst(ev.x, ev.y, 12, '#ff5c8a', 85, 0.5);
        this.shake(0.12, 2);
        this.addCallout('BOING!', ev.x, ev.y - 14, '#ffd23f');
        break;
      case 'bonk':
        this.spawnBurst(ev.x, ev.y, 6, '#fff6b3', 55, 0.35);
        break;
      case 'combo': {
        const col = this.looks[ev.i]?.color ?? '#ffd23f';
        this.spawnBurst(ev.x, ev.y, 14, col, 90, 0.65);
        this.shake(0.14, 2);
        this.addCallout(`${ev.label} +${ev.pts}`, ev.x, ev.y - 12, '#ffd23f', 1.15);
        break;
      }
      case 'crumble':
        this.spawnBurst(ev.x, ev.y + 3, 10, '#d4e2f2', 55, 0.45);
        break;
      case 'crown': {
        const name = this.looks[ev.i]?.name ?? '';
        const text = ev.place === 1 ? `${name.slice(0, 8)} CROWNED!` : `#${ev.place} SUMMIT!`;
        this.spawnBurst(ev.x, ev.y, 24, '#ffd23f', 110, 0.9);
        this.shake(0.22, 3);
        this.addCallout(text, Math.max(WALL_L + 48, Math.min(WALL_R - 48, ev.x)), ev.y - 14, '#ffd23f', 1.35);
        this.baja.celebrate();
        break;
      }
      case 'freeze':
        this.spawnBurst(ev.x, ev.y - 4, 14, '#9ee6ff', 75, 0.65);
        this.shake(0.12, 2);
        this.addCallout('FROZEN!', ev.x, ev.y - 16, '#9ee6ff');
        break;
      case 'hurry':
        this.shake(0.2, 2.5);
        this.addCallout('HURRY UP!', 320, Math.min(260, sim.frostY - 24), '#ff5c8a', 1.4);
        break;
      case 'over':
        break;
    }
  }

  private shake(dur: number, amp: number) {
    this.shakeTime = Math.max(this.shakeTime, dur);
    this.shakeAmp = Math.max(this.shakeAmp, amp);
  }

  private spawnBurst(x: number, y: number, count: number, color: string, speed: number, life: number) {
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2 + Math.random() * 0.5;
      const spd = speed * (0.4 + Math.random() * 0.7);
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd - 22,
        life,
        maxLife: life,
        color,
        size: Math.random() < 0.35 ? 2 : 1,
      });
    }
  }

  private addCallout(text: string, x: number, y: number, color: string, life = 0.95) {
    const cx = Math.max(WALL_L + 36, Math.min(WALL_R - 36, x));
    const cy = Math.max(18, Math.min(GROUND_Y - 12, y));
    this.callouts.push({ text, x: cx, y: cy, color, life, maxLife: life });
  }

  render(sim: TowerSim, dt: number) {
    const stepDt = Math.min(0.08, Math.max(0, dt));
    this.visTime += stepDt;
    if (this.builtTheme !== sim.theme) this.buildStatic(sim.theme);

    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;

    // Update ambient snow, trails, particles, callouts, shake.
    const snowBoost = sim.theme === 'blizzard' ? 1.8 : 1;
    for (const s of this.snow) {
      s.x += s.vx * snowBoost * stepDt;
      s.y += s.vy * snowBoost * stepDt;
      if (s.y >= PIXEL_H) {
        s.y = -2;
        s.x = (s.x + PIXEL_W) % PIXEL_W;
      }
      if (s.x < 0) s.x += PIXEL_W;
    }

    this.trailTimer += stepDt;
    const recordTrail = this.trailTimer >= 0.035;
    if (recordTrail) this.trailTimer = 0;
    for (let i = 0; i < sim.players.length; i++) {
      const p = sim.players[i];
      const list = (this.trails[i] ??= []);
      for (let k = list.length - 1; k >= 0; k--) {
        list[k].alpha -= stepDt * 4.2;
        if (list[k].alpha <= 0) list.splice(k, 1);
      }
      if (recordTrail && p && p.alive && !p.gone && !p.finished && p.spinning) {
        list.push({
          x: p.x,
          y: p.y,
          frame: Math.floor(this.visTime * 18) % 4,
          flipX: p.facing < 0,
          alpha: 0.45,
        });
      }
    }

    for (let k = this.particles.length - 1; k >= 0; k--) {
      const pt = this.particles[k];
      pt.life -= stepDt;
      if (pt.life <= 0) {
        this.particles.splice(k, 1);
        continue;
      }
      pt.vy += 190 * stepDt;
      pt.x += pt.vx * stepDt;
      pt.y += pt.vy * stepDt;
    }
    for (let k = this.callouts.length - 1; k >= 0; k--) {
      const c = this.callouts[k];
      c.life -= stepDt;
      c.y -= 18 * stepDt;
      if (c.life <= 0) this.callouts.splice(k, 1);
    }

    let sx = 0;
    let sy = 0;
    if (this.shakeTime > 0) {
      this.shakeTime = Math.max(0, this.shakeTime - stepDt);
      sx = Math.round((Math.random() - 0.5) * 2 * this.shakeAmp);
      sy = Math.round((Math.random() - 0.5) * 2 * this.shakeAmp);
    } else {
      this.shakeAmp = 0;
    }

    ctx.clearRect(0, 0, PIXEL_W, PIXEL_H);
    ctx.save();
    if (sx !== 0 || sy !== 0) ctx.translate(sx, sy);

    // 1. Static winter night + brick shaft backdrop.
    ctx.drawImage(this.staticCanvas, 0, 0);

    // 2. Shimmering aurora ribbons or blizzard wind streaks on flanks.
    if (sim.theme === 'aurora') {
      for (const sideX of [10, 492]) {
        for (let i = 0; i < 14; i++) {
          const rx = sideX + i * 10;
          const ry = 32 + Math.round(Math.sin(this.visTime * 1.4 + i * 0.5) * 10);
          ctx.fillStyle = i % 2 === 0 ? 'rgba(47, 214, 168, 0.24)' : 'rgba(157, 123, 255, 0.2)';
          ctx.fillRect(rx, ry, 6, 22);
        }
      }
    }

    // Falling snow behind walls on the outer sky flanks.
    ctx.fillStyle = 'rgba(235, 249, 255, 0.85)';
    for (const s of this.snow) {
      if (s.x >= WALL_L - 16 && s.x < WALL_R + 16) continue;
      ctx.fillRect(Math.round(s.x), Math.round(s.y), s.size, s.size);
    }

    // Cosmetic mascot Baja on the right snowy foreground bank.
    this.baja.update(stepDt);
    const bajaY = 356;
    const bagX = 542;
    ctx.fillStyle = 'rgba(20, 28, 56, 0.28)';
    ctx.fillRect(bagX - 9, bajaY - 1, 18, 2);
    if (this.baja.phase === 'inBag') {
      resources.draw(ctx, 'pixel-common', 'baja-bag', bagX, bajaY, { anchor: 'bottom', time: this.visTime });
    } else {
      resources.draw(ctx, 'pixel-common', 'baja-bag-empty', bagX, bajaY, { anchor: 'bottom' });
      const bx = Math.round(this.baja.x);
      const by = Math.round(bajaY - this.baja.hopY);
      ctx.fillStyle = 'rgba(20, 28, 56, 0.28)';
      ctx.fillRect(bx - 7, bajaY - 1, 14, 2);
      resources.draw(ctx, 'pixel-common', this.baja.running ? 'baja-run' : 'baja-idle', bx, by, {
        anchor: 'bottom',
        flipX: this.baja.facing < 0,
        time: this.visTime,
      });
      if (this.baja.showHeart) {
        const lift = Math.round(Math.sin(this.visTime * 6) * 2);
        resources.draw(ctx, 'pixel-common', 'heart', bx, by - 20 + lift, { anchor: 'center' });
      }
    }

    // 3. Animated wall torches with stepped pixel glow.
    for (const [tx, ty] of TORCH_POSITIONS) {
      const pulse = Math.sin(this.visTime * 11 + ty) > 0 ? 1 : 0;
      ctx.fillStyle = 'rgba(255, 170, 60, 0.14)';
      ctx.fillRect(tx - 10 - pulse, ty - 10 - pulse, 20 + pulse * 2, 20 + pulse * 2);
      ctx.fillStyle = 'rgba(255, 215, 100, 0.18)';
      ctx.fillRect(tx - 6, ty - 6, 12, 12);
      resources.draw(ctx, TOWER_PACK_ID, 'torch', tx, ty, { anchor: 'center', time: this.visTime + ty * 0.1 });
    }

    // 4. Platforms (floors 1..FLOORS; floor 0 is part of static base).
    for (let f = 1; f < sim.platforms.length; f++) {
      const plat = sim.platforms[f];
      if (plat.kind === 'moving') {
        ctx.fillStyle = 'rgba(111, 240, 255, 0.28)';
        const lo = Math.round(plat.baseX - plat.moveAmp + 4);
        const hi = Math.round(plat.baseX + plat.w + plat.moveAmp - 4);
        for (let dx = lo; dx <= hi; dx += 6) ctx.fillRect(dx, Math.round(plat.y + 4), 2, 1);
      }

      if (plat.kind === 'crumble' && plat.crumbleState === 'gone') {
        ctx.fillStyle = 'rgba(212, 226, 242, 0.22)';
        for (let dx = Math.round(plat.x); dx < Math.round(plat.x + plat.w); dx += 4) {
          ctx.fillRect(dx, Math.round(plat.y), 2, 1);
        }
        continue;
      }

      const jitter = plat.kind === 'crumble' && plat.crumbleState === 'shaking' ? (Math.floor(this.visTime * 45) % 2 === 0 ? -1 : 1) : 0;
      const px = Math.round(plat.x + jitter);
      const py = Math.round(plat.y);
      resources.drawTileRow(ctx, TOWER_PACK_ID, PLAT_SPRITE[plat.kind], px, py, plat.w);

      if (plat.springOffset !== null) {
        resources.draw(ctx, TOWER_PACK_ID, 'spring', Math.round(px + plat.springOffset + 6), py + 1, {
          anchor: 'bottom',
          frame: plat.springTimer > 0 ? 1 : 0,
        });
      }
    }

    // 5. Summit Polish flags + unclaimed Golden Crown.
    const summit = sim.platforms[FLOORS];
    if (summit) {
      resources.draw(ctx, 'pixel-common', 'flag', Math.round(summit.x + 10), Math.round(summit.y), {
        anchor: 'bottom',
        time: this.visTime,
      });
      resources.draw(ctx, 'pixel-common', 'flag', Math.round(summit.x + summit.w - 10), Math.round(summit.y), {
        anchor: 'bottom',
        time: this.visTime + 0.25,
      });
      if (sim.finishCount === 0) {
        const bobY = Math.round(SUMMIT_Y - 12 + Math.sin(this.visTime * 4) * 1.5);
        resources.draw(ctx, 'pixel-common', 'crown', 320, bobY, { anchor: 'center', time: this.visTime });
        resources.draw(ctx, 'pixel-common', 'sparkle', 320 + Math.round(Math.cos(this.visTime * 3) * 10), bobY - 5, {
          anchor: 'center',
          time: this.visTime,
        });
      }
    }

    // 6. Spin after-image trails.
    for (let i = 0; i < sim.players.length; i++) {
      if (this.hidden.has(i)) continue;
      const look = this.looks[i];
      if (!look) continue;
      for (const tr of this.trails[i] ?? []) {
        resources.draw(ctx, 'pixel-common', 'pierogi-spin', Math.round(tr.x), Math.round(tr.y), {
          anchor: 'bottom',
          color: look.color,
          frame: tr.frame,
          flipX: tr.flipX,
          alpha: tr.alpha,
        });
      }
    }

    // 7. Players (frozen first, active climbers on top).
    const order = sim.players
      .map((p, idx) => ({ p, idx }))
      .filter(({ p, idx }) => p && !p.gone && !this.hidden.has(idx))
      .sort((a, b) => Number(a.p.alive) - Number(b.p.alive) || a.p.y - b.p.y);

    for (const { p, idx } of order) {
      const look = this.looks[idx];
      if (!look) continue;
      let sprite = 'pierogi-idle';
      if (!p.alive) sprite = 'pierogi-frozen';
      else if (p.finished) sprite = 'pierogi-win';
      else if (p.spinning) sprite = 'pierogi-spin';
      else if (!p.grounded && p.vy < 0) sprite = 'pierogi-jump';
      else if (!p.grounded) sprite = 'pierogi-fall';
      else if (Math.abs(p.vx) > 12) sprite = 'pierogi-run';

      const px = Math.round(p.x);
      const py = Math.round(p.y + (p.bonkTimer > 0 ? 2 : 0));
      resources.draw(ctx, 'pixel-common', sprite, px, py, {
        anchor: 'bottom',
        color: look.color,
        flipX: p.facing < 0,
        time: this.visTime + idx * 0.2,
      });

      if (p.finishOrder === 1) {
        resources.draw(ctx, 'pixel-common', 'crown', px, py - 14, { anchor: 'bottom', time: this.visTime });
      } else if (sim.phase === 'idle') {
        const bounce = Math.round(Math.sin(this.visTime * 7 + idx) * 2);
        ctx.fillStyle = '#120d1b';
        ctx.fillRect(px - 2, py - 30 + bounce, 5, 4);
        ctx.fillStyle = '#ffd23f';
        ctx.fillRect(px - 1, py - 29 + bounce, 3, 2);
      }

      if (p.comboFloors >= 2 && p.alive && !p.finished) {
        const ratio = Math.max(0.1, Math.min(1, p.comboTimer / 2.6));
        ctx.fillStyle = '#120d1b';
        ctx.fillRect(px - 8, py - 18, 16, 3);
        ctx.fillStyle = p.comboFloors >= 4 ? '#ffd23f' : '#79d2ff';
        ctx.fillRect(px - 7, py - 17, Math.round(14 * ratio), 1);
      }

      drawPixelText(ctx, look.name.slice(0, 8), px, py - (p.finishOrder === 1 ? 26 : 21), {
        align: 'center',
        baseline: 'bottom',
        color: p.alive ? look.color : '#a6d8f5',
        outline: '#120d1b',
        scale: 1,
      });
    }

    // 8. Rising frost wave inside the tower shaft.
    if (sim.frostY < PIXEL_H + 4) {
      const fy = Math.round(sim.frostY);
      for (let x = WALL_L; x < WALL_R; x += 16) {
        resources.draw(ctx, TOWER_PACK_ID, 'frost-wave', x, fy - 4, { anchor: 'topleft', time: this.visTime });
      }
      if (fy + 8 < PIXEL_H) {
        ctx.fillStyle = 'rgba(29, 86, 150, 0.78)';
        ctx.fillRect(WALL_L, fy + 8, WALL_R - WALL_L, PIXEL_H - (fy + 8));
      }
    }

    // 9. Particles and pixel callouts.
    for (const pt of this.particles) {
      ctx.fillStyle = pt.color;
      ctx.globalAlpha = Math.max(0, Math.min(1, pt.life / pt.maxLife));
      ctx.fillRect(Math.round(pt.x), Math.round(pt.y), pt.size, pt.size);
    }
    ctx.globalAlpha = 1;

    for (const c of this.callouts) {
      ctx.globalAlpha = Math.min(1, (c.life / c.maxLife) * 1.4);
      drawPixelText(ctx, c.text, Math.round(c.x), Math.round(c.y), {
        align: 'center',
        baseline: 'middle',
        color: c.color,
        outline: '#120d1b',
        scale: 1,
      });
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }
}
