/** Canvas renderer for the Pierogi Panic kitchen (TV only). A 3/4 top-down view with painted sprites. */
import type { Filling, KitchenItem } from '../../../../shared/protocol';
import { PIEROGI_PATH } from '../../lib/art';
import { GRID_H, GRID_W, type Cook, type KitchenSim, type Station } from './logic';
import { itemBadge, itemSprite, spriteImage, type Sprite } from './art';

/** Pixels per tile. */
export const T = 90;
export const CANVAS_W = GRID_W * T;
export const CANVAS_H = GRID_H * T;
/** Height of a counter's front face. */
const D = 16;

type Ctx = CanvasRenderingContext2D;

const WOOD = { top: '#c98a4b', front: '#874c22', edge: '#e2ab6c' };
const STEEL = { top: '#b6bfcb', front: '#6b7487', edge: '#e4e9f0' };
const STOVE = { top: '#43434f', front: '#24242c', edge: '#686880' };
const INK = '#2a120a';

/** Floor tiles and wall colours per level. */
const THEMES = [
  // Babcia's kitchen: cream and biscuit tiles with folk diamonds.
  { a: '#f8ecd2', b: '#ecd5aa', motif: 'rgba(214, 58, 79, 0.16)', dot: 'rgba(47, 95, 174, 0.18)', wall: '#5b2333', trim: '#e8335a' },
  // The village inn: warm terracotta.
  { a: '#f0cfa8', b: '#e2b68a', motif: 'rgba(120, 60, 20, 0.14)', dot: 'rgba(255, 244, 220, 0.4)', wall: '#3f2a1c', trim: '#ffc93c' },
  // The wedding hall: white and cobalt, like Boleslawiec pottery.
  { a: '#f6f3ec', b: '#dfe7f4', motif: 'rgba(47, 95, 174, 0.22)', dot: 'rgba(232, 51, 90, 0.25)', wall: '#26304f', trim: '#4f9dff' },
];

let bodyPath: Path2D | null = null;
const body = () => (bodyPath ??= new Path2D(PIEROGI_PATH));

function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function ellipse(ctx: Ctx, x: number, y: number, rx: number, ry: number) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
}

/** Is the tile walkable floor? */
function isFloor(sim: KitchenSim, x: number, y: number) {
  return x >= 0 && y >= 0 && x < GRID_W && y < GRID_H && !sim.stationAt(x, y) && !sim.isWall(x, y);
}

/** Does this station show its front face (floor in front of it)? */
function hasFront(sim: KitchenSim, s: Station) {
  return s.y + 1 >= GRID_H || isFloor(sim, s.x, s.y + 1);
}

/** The station's top face rectangle. */
export function topRect(sim: KitchenSim, s: Station) {
  const h = hasFront(sim, s) ? T - D : T;
  return { x: s.x * T, y: s.y * T, w: T, h, cx: s.x * T + T / 2, cy: s.y * T + h / 2 };
}

function sprite(ctx: Ctx, name: Sprite, cx: number, cy: number, size: number) {
  const img = spriteImage(name);
  if (!img.complete || img.naturalWidth === 0) return;
  ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size);
}

/** A filling badge: the ingredient in a white circle. */
function fillingBadge(ctx: Ctx, f: Filling, x: number, y: number, r: number) {
  ctx.fillStyle = '#fff';
  ellipse(ctx, x, y, r, r);
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.stroke();
  sprite(ctx, `ing-${f}`, x, y, r * 1.75);
}

export function drawItem(ctx: Ctx, it: KitchenItem, cx: number, cy: number, size: number) {
  sprite(ctx, itemSprite(it), cx, cy, size);
  const f = itemBadge(it);
  if (f) fillingBadge(ctx, f, cx + size * 0.36, cy - size * 0.3, Math.max(11, size * 0.2));
  if (it.k === 'dirty' && it.n > 1) countBadge(ctx, it.n, cx + size * 0.38, cy - size * 0.3);
}

function countBadge(ctx: Ctx, n: number, x: number, y: number) {
  ctx.fillStyle = INK;
  ellipse(ctx, x, y, 13, 13);
  ctx.fill();
  ctx.fillStyle = '#fff4dc';
  ctx.font = '700 17px "Fredoka Variable", "Fredoka", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(n), x, y + 1);
}

// ---------------------------------------------------------------------------
// Static layer: floor, walls and station bodies (drawn once per level)
// ---------------------------------------------------------------------------

export function drawStatic(ctx: Ctx, sim: KitchenSim) {
  const th = THEMES[sim.levelIndex % THEMES.length];
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      if (sim.isWall(x, y)) {
        drawWall(ctx, sim, x, y, th);
        continue;
      }
      if (sim.stationAt(x, y)) continue;
      const dark = (x + y) % 2 === 1;
      ctx.fillStyle = dark ? th.b : th.a;
      ctx.fillRect(x * T, y * T, T, T);
      if (dark) {
        const cx = x * T + T / 2;
        const cy = y * T + T / 2;
        ctx.fillStyle = th.motif;
        ctx.beginPath();
        ctx.moveTo(cx, cy - 13);
        ctx.lineTo(cx + 13, cy);
        ctx.lineTo(cx, cy + 13);
        ctx.lineTo(cx - 13, cy);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = th.dot;
        ellipse(ctx, cx, cy, 4, 4);
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(120, 80, 40, 0.14)';
      ctx.lineWidth = 2;
      ctx.strokeRect(x * T + 1, y * T + 1, T - 2, T - 2);
    }
  }
  // Soft shadows cast onto the floor by counters and walls.
  for (let y = 0; y < GRID_H - 1; y++)
    for (let x = 0; x < GRID_W; x++) {
      if (isFloor(sim, x, y) || !isFloor(sim, x, y + 1)) continue;
      const g = ctx.createLinearGradient(0, (y + 1) * T, 0, (y + 1) * T + 18);
      g.addColorStop(0, 'rgba(70, 30, 10, 0.28)');
      g.addColorStop(1, 'rgba(70, 30, 10, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(x * T, (y + 1) * T, T, 18);
    }
  for (const s of sim.stations) drawStationBase(ctx, sim, s);
}

function drawWall(ctx: Ctx, sim: KitchenSim, x: number, y: number, th: (typeof THEMES)[number]) {
  ctx.fillStyle = th.wall;
  ctx.fillRect(x * T, y * T, T, T);
  // Vertical boards…
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.22)';
  ctx.lineWidth = 2;
  for (let i = 1; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(x * T + (T * i) / 3, y * T);
    ctx.lineTo(x * T + (T * i) / 3, y * T + T);
    ctx.stroke();
  }
  // …and a folk-painted trim where the wall meets the floor.
  if (y + 1 < GRID_H && isFloor(sim, x, y + 1)) {
    ctx.fillStyle = th.trim;
    ctx.fillRect(x * T, y * T + T - 10, T, 6);
  }
  ctx.fillStyle = 'rgba(255, 244, 220, 0.12)';
  for (let i = 0; i < 3; i++) {
    ellipse(ctx, x * T + T / 6 + (T * i) / 3, y * T + T / 2, 3, 3);
    ctx.fill();
  }
}

function drawStationBase(ctx: Ctx, sim: KitchenSim, s: Station) {
  const r = topRect(sim, s);
  const pal = s.kind === 'stove' || s.kind === 'pan' ? STOVE : s.kind === 'sink' ? STEEL : WOOD;
  ctx.fillStyle = pal.top;
  ctx.fillRect(r.x, r.y, T, r.h);
  if (hasFront(sim, s)) {
    ctx.fillStyle = pal.front;
    ctx.fillRect(r.x, r.y + r.h, T, D);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(r.x, r.y + r.h, T, 3);
  }
  // Wood grain / bevel
  if (pal === WOOD) {
    ctx.strokeStyle = 'rgba(110, 58, 18, 0.16)';
    ctx.lineWidth = 2;
    for (let i = 1; i < 4; i++) {
      ctx.beginPath();
      const yy = r.y + (r.h * i) / 4 + ((s.x * 7 + i * 3) % 6) - 3;
      ctx.moveTo(r.x + 4, yy);
      ctx.bezierCurveTo(r.x + T * 0.3, yy - 3, r.x + T * 0.6, yy + 3, r.x + T - 4, yy);
      ctx.stroke();
    }
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.22)';
  ctx.lineWidth = 2;
  ctx.strokeRect(r.x + 1, r.y + 1, T - 2, r.h - 2);
  ctx.strokeStyle = pal.edge;
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  ctx.moveTo(r.x + 3, r.y + 3);
  ctx.lineTo(r.x + T - 3, r.y + 3);
  ctx.stroke();
  ctx.globalAlpha = 1;

  const { cx, cy } = r;
  switch (s.kind) {
    case 'flour':
      sprite(ctx, 'flour', cx, cy, T * 0.86);
      break;
    case 'crate':
      sprite(ctx, `crate-${s.crate!}`, cx, cy, T * 0.98);
      break;
    case 'roll':
    case 'fold':
      ctx.fillStyle = s.kind === 'roll' ? '#ead0a0' : '#f3dfb5';
      rr(ctx, r.x + 9, r.y + 9, T - 18, r.h - 18, 12);
      ctx.fill();
      ctx.strokeStyle = 'rgba(120, 70, 20, 0.35)';
      ctx.lineWidth = 2.5;
      ctx.stroke();
      if (s.kind === 'fold') {
        // A dashed pierogi outline marks the folding boards.
        ctx.save();
        ctx.translate(cx, cy + 4);
        ctx.scale(0.42, 0.42);
        ctx.translate(-60, -56);
        ctx.setLineDash([9, 8]);
        ctx.strokeStyle = 'rgba(150, 90, 30, 0.6)';
        ctx.lineWidth = 6;
        ctx.stroke(body());
        ctx.restore();
      }
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      for (let i = 0; i < 9; i++) {
        ellipse(ctx, r.x + 18 + ((i * 37) % (T - 36)), r.y + 16 + ((i * 23) % (r.h - 32)), 1.6, 1.6);
        ctx.fill();
      }
      break;
    case 'stove':
    case 'pan':
      ctx.strokeStyle = '#1b1b22';
      ctx.lineWidth = 5;
      ellipse(ctx, cx, cy, T * 0.36, T * 0.3);
      ctx.stroke();
      if (hasFront(sim, s)) {
        ctx.fillStyle = '#c9ccd3';
        for (const k of [-1, 1]) {
          ellipse(ctx, cx + k * 18, r.y + r.h + D / 2, 4.5, 4.5);
          ctx.fill();
        }
      }
      break;
    case 'sink':
      ctx.fillStyle = '#7e8ea3';
      rr(ctx, r.x + 10, r.y + 14, T - 20, r.h - 22, 12);
      ctx.fill();
      ctx.fillStyle = '#9fd0ea';
      rr(ctx, r.x + 14, r.y + 18, T - 28, r.h - 30, 10);
      ctx.fill();
      ctx.fillStyle = '#d4dae3';
      ctx.fillRect(cx - 4, r.y + 2, 8, 14);
      ellipse(ctx, cx, r.y + 4, 9, 5);
      ctx.fill();
      break;
    case 'rack':
      ctx.strokeStyle = '#7a4318';
      ctx.lineWidth = 4;
      for (let i = 0; i < 5; i++) {
        const xx = r.x + 16 + i * ((T - 32) / 4);
        ctx.beginPath();
        ctx.moveTo(xx, r.y + 10);
        ctx.lineTo(xx, r.y + r.h - 8);
        ctx.stroke();
      }
      break;
    case 'hatch': {
      // A red-and-cream checked tablecloth and a little service bell.
      const n = 6;
      const cw = (T - 12) / n;
      const ch = (r.h - 12) / n;
      for (let i = 0; i < n; i++)
        for (let j = 0; j < n; j++) {
          ctx.fillStyle = (i + j) % 2 ? '#d63a4f' : '#fff4dc';
          ctx.fillRect(r.x + 6 + i * cw, r.y + 6 + j * ch, cw + 0.5, ch + 0.5);
        }
      sprite(ctx, 'bell', r.x + T - 24, r.y + 22, 40);
      break;
    }
    case 'return':
      ctx.fillStyle = '#8b8f99';
      rr(ctx, r.x + 8, r.y + 10, T - 16, r.h - 18, 10);
      ctx.fill();
      ctx.fillStyle = '#a7abb5';
      rr(ctx, r.x + 13, r.y + 15, T - 26, r.h - 28, 8);
      ctx.fill();
      break;
    case 'trash':
      sprite(ctx, 'bin', cx, cy, T * 0.8);
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Dynamic layer
// ---------------------------------------------------------------------------

export interface CookLook {
  color: string;
  name: string;
  offline: boolean;
  /** The action button would do something right now. */
  canAct: boolean;
}

export interface Popup {
  text: string;
  x: number;
  y: number;
  color: string;
  t0: number;
}

const POT_SPRITE = { none: 'pot', raw: 'pot-raw', cooked: 'pot-cooked', mushy: 'mushy' } as const;
const PAN_SPRITE = { none: 'pan', raw: 'pan-raw', cooked: 'fried-pan', mushy: 'burnt' } as const;

function drawStationContents(ctx: Ctx, sim: KitchenSim, s: Station, now: number) {
  const r = topRect(sim, s);
  const { cx, cy } = r;
  switch (s.kind) {
    case 'counter':
    case 'roll':
      if (s.item) drawItem(ctx, s.item, cx, cy, T * 0.78);
      else if (s.kind === 'roll') sprite(ctx, 'pin', cx, cy, T * 0.8);
      break;
    case 'fold':
      if (s.item) drawItem(ctx, s.item, cx, cy, T * 0.78);
      else {
        if (s.dough) drawItem(ctx, { k: 'dough' }, s.fill ? cx - 12 : cx, cy + 4, T * 0.66);
        if (s.fill) drawItem(ctx, { k: 'fill', f: s.fill }, s.dough ? cx + 14 : cx, cy - 4, T * 0.6);
      }
      break;
    case 'stove':
    case 'pan': {
      const pot = s.pot;
      const busy = !!s.busy;
      if (busy) {
        const g = ctx.createRadialGradient(cx, cy, 10, cx, cy, T * 0.55);
        g.addColorStop(0, 'rgba(255, 150, 40, 0.95)');
        g.addColorStop(1, 'rgba(255, 80, 20, 0)');
        ctx.fillStyle = g;
        ellipse(ctx, cx, cy, T * 0.56, T * 0.5);
        ctx.fill();
      }
      const names = s.kind === 'pan' ? PAN_SPRITE : POT_SPRITE;
      const bob = pot?.state === 'cooked' || busy ? Math.sin(now / 160) * 1.5 : 0;
      const size = s.kind === 'pan' ? T * 1.04 : T * 0.98;
      sprite(ctx, names[pot?.state ?? 'none'], cx + (s.kind === 'pan' ? 6 : 0), cy - 4 + bob, size);
      if (pot) {
        if (pot.state === 'cooked') {
          // Warning: about to turn to mush / burn.
          const left = sim.tuning.overcookMs - (sim.t - pot.since);
          if (left < 8000 && Math.floor(now / 220) % 2 === 0) {
            ctx.strokeStyle = '#ff3d6e';
            ctx.lineWidth = 5;
            ellipse(ctx, cx, cy, T * 0.46, T * 0.4);
            ctx.stroke();
          }
        }
        if (busy) {
          ctx.fillStyle = 'rgba(255,255,255,0.85)';
          for (let i = 0; i < 5; i++) {
            const a = now / 150 + i * 1.7;
            ellipse(ctx, cx + Math.cos(a * 1.3) * 16, cy - 4 + Math.sin(a) * 10, 2.5, 2.5);
            ctx.fill();
          }
        }
        fillingBadge(ctx, pot.f, r.x + T - 14, r.y + 13, 13);
      }
      break;
    }
    case 'sink':
      for (let i = 0; i < Math.min(3, s.count); i++) drawItem(ctx, { k: 'dirty', n: 1 }, cx - 6 + i * 6, cy + 4 - i * 5, T * 0.6);
      if (s.count > 1) countBadge(ctx, s.count, r.x + T - 14, r.y + 14);
      break;
    case 'rack':
    case 'return': {
      const it: KitchenItem = s.kind === 'rack' ? { k: 'plate' } : { k: 'dirty', n: 1 };
      for (let i = 0; i < Math.min(6, s.count); i++) drawItem(ctx, it, cx, cy + 6 - i * 5, T * 0.74);
      if (s.count > 1) countBadge(ctx, s.count, r.x + T - 14, r.y + 14);
      if (s.kind === 'rack' && s.count === 0) {
        ctx.font = '700 16px "Fredoka Variable", "Fredoka", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 5;
        ctx.strokeStyle = '#fff4dc';
        ctx.strokeText('no plates', cx, cy);
        ctx.fillStyle = '#a51c3d';
        ctx.fillText('no plates', cx, cy);
      }
      break;
    }
    default:
      break;
  }
}

function drawCook(ctx: Ctx, c: Cook, look: CookLook, now: number, seed: number) {
  const x = c.x * T;
  const y = c.y * T;
  const w = T * 0.84;
  const phase = now / 85 + seed;
  const bob = c.moving ? Math.abs(Math.sin(phase)) * 5 : Math.sin(now / 500 + seed) * 1.2;
  const tilt = c.moving ? Math.sin(phase) * 0.12 : 0;
  const by = y - T * 0.12 - bob;
  const back = c.fy < -0.6;
  ctx.globalAlpha = look.offline ? 0.45 : 1;

  // Shadow + a facing chevron on the floor
  ctx.fillStyle = 'rgba(60, 30, 10, 0.25)';
  ellipse(ctx, x, y + T * 0.24, T * 0.32, T * 0.11);
  ctx.fill();
  if (!c.hold && !c.mini) {
    const fx = x + c.fx * T * 0.44;
    const fy = y + T * 0.2 + c.fy * T * 0.3;
    ctx.fillStyle = look.color;
    ctx.beginPath();
    ctx.moveTo(fx + c.fx * 9, fy + c.fy * 7);
    ctx.lineTo(fx - c.fy * 7, fy + c.fx * 5);
    ctx.lineTo(fx + c.fy * 7, fy - c.fx * 5);
    ctx.closePath();
    ctx.fill();
  }

  // Carried items sit at hand height in front; facing away they are held up over the shoulder.
  const holdX = back ? x + c.fx * T * 0.2 : x + c.fx * T * 0.36;
  const holdY = back ? by - T * 0.3 : by + T * 0.12 + c.fy * T * 0.16;

  ctx.save();
  ctx.translate(x, by);
  ctx.rotate(tilt);
  ctx.scale(w / 120, w / 120);
  ctx.translate(-60, -56);
  ctx.fillStyle = look.color;
  ctx.strokeStyle = 'rgba(40, 16, 8, 0.7)';
  ctx.lineWidth = 5;
  ctx.lineJoin = 'round';
  ctx.fill(body());
  ctx.stroke(body());
  ctx.fillStyle = 'rgba(40, 16, 8, 0.14)';
  ctx.beginPath();
  ctx.moveTo(12, 70);
  ctx.quadraticCurveTo(60, 92, 108, 70);
  ctx.quadraticCurveTo(60, 84, 12, 70);
  ctx.fill();
  if (!back) {
    const ex = c.fx * 9;
    const ey = c.fy * 4;
    ctx.fillStyle = INK;
    ellipse(ctx, 43 + ex, 52 + ey, 6, 7);
    ctx.fill();
    ellipse(ctx, 77 + ex, 52 + ey, 6, 7);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ellipse(ctx, 45 + ex, 49 + ey, 2.2, 2.2);
    ctx.fill();
    ellipse(ctx, 79 + ex, 49 + ey, 2.2, 2.2);
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    if (c.mini) {
      ctx.moveTo(52 + ex, 68 + ey);
      ctx.lineTo(68 + ex, 68 + ey);
    } else ctx.arc(60 + ex, 62 + ey, 9, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255, 90, 122, 0.45)';
    ellipse(ctx, 31 + ex, 63 + ey, 7, 4);
    ctx.fill();
    ellipse(ctx, 89 + ex, 63 + ey, 7, 4);
    ctx.fill();
  }
  // Chef's hat
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = 'rgba(40, 16, 8, 0.55)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(38, 26);
  ctx.lineTo(40, 6);
  ctx.lineTo(80, 6);
  ctx.lineTo(82, 26);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  for (const [hx, hy, hr] of [
    [44, 0, 13],
    [60, -6, 15],
    [76, 0, 13],
  ]) {
    ctx.beginPath();
    ctx.arc(hx, hy, hr, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(41, 0, 38, 10);
  ctx.fillStyle = look.color;
  ctx.fillRect(39, 18, 42, 7);
  ctx.restore();

  if (c.hold) drawItem(ctx, c.hold, holdX, holdY, back ? T * 0.46 : T * 0.52);

  // Name tag
  ctx.font = '700 21px "Fredoka Variable", "Fredoka", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(42, 18, 10, 0.9)';
  ctx.lineJoin = 'round';
  const name = look.offline ? `${look.name} 💤` : look.name;
  ctx.strokeText(name, x, y + T * 0.32);
  ctx.fillStyle = look.color;
  ctx.fillText(name, x, y + T * 0.32);
  ctx.globalAlpha = 1;
}

function progressRing(ctx: Ctx, x: number, y: number, p: number, color: string) {
  ctx.fillStyle = 'rgba(42, 18, 10, 0.85)';
  ellipse(ctx, x, y, 21, 21);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 244, 220, 0.25)';
  ctx.lineWidth = 6;
  ellipse(ctx, x, y, 14, 14);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(x, y, 14, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.02, p));
  ctx.stroke();
}

export function drawDynamic(ctx: Ctx, sim: KitchenSim, looks: Map<string, CookLook>, popups: Popup[], now: number) {
  for (const s of sim.stations) drawStationContents(ctx, sim, s, now);

  // Who is aiming at what
  const aimed = new Map<number, number>();
  for (const c of sim.cooks) {
    if (c.target === null || c.mini) continue;
    const look = looks.get(c.id);
    if (!look || look.offline) continue;
    const s = sim.stations[c.target];
    const r = topRect(sim, s);
    const k = aimed.get(s.id) ?? 0;
    aimed.set(s.id, k + 1);
    const inset = 3 + k * 6;
    ctx.save();
    ctx.strokeStyle = look.color;
    ctx.lineWidth = look.canAct ? 6 : 3;
    ctx.globalAlpha = look.canAct ? 1 : 0.55;
    if (look.canAct) {
      ctx.shadowColor = look.color;
      ctx.shadowBlur = 14;
    }
    rr(ctx, r.x + inset, r.y + inset, T - inset * 2, r.h - inset * 2, 10);
    ctx.stroke();
    ctx.restore();
  }

  const order = [...sim.cooks].sort((a, b) => a.y - b.y);
  for (const c of order) {
    const look = looks.get(c.id);
    if (look) drawCook(ctx, c, look, now, sim.cooks.indexOf(c) * 1.7);
  }

  // Minigame progress above the cook's head
  for (const c of sim.cooks) {
    if (!c.mini) continue;
    const s = sim.stations[c.mini.station];
    progressRing(ctx, c.x * T, c.y * T - T * 0.86, s.progress, looks.get(c.id)?.color ?? '#fff');
  }

  // Floating texts
  for (let i = popups.length - 1; i >= 0; i--) {
    const p = popups[i];
    const k = (now - p.t0) / 1400;
    if (k >= 1) {
      popups.splice(i, 1);
      continue;
    }
    ctx.globalAlpha = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;
    ctx.font = '700 34px "Fredoka Variable", "Fredoka", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 7;
    ctx.strokeStyle = INK;
    const yy = p.y * T - 20 - k * 60;
    const xx = Math.min(CANVAS_W - 110, Math.max(110, p.x * T));
    ctx.strokeText(p.text, xx, yy);
    ctx.fillStyle = p.color;
    ctx.fillText(p.text, xx, yy);
    ctx.globalAlpha = 1;
  }
}
