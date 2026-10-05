/** Canvas renderer for the Pierogi Panic kitchen (TV only). A 3/4 top-down view. */
import type { KitchenItem } from '../../../../shared/protocol';
import { PIEROGI_PATH } from '../../lib/art';
import { GRID_H, GRID_W, type Cook, type KitchenSim, type Station } from './logic';
import { fillingImage, itemImage } from './art';

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

/** Does this station show its front face (nothing solid in front of it)? */
function hasFront(sim: KitchenSim, s: Station) {
  return s.y + 1 >= GRID_H || !sim.stationAt(s.x, s.y + 1);
}

/** The station's top face rectangle. */
export function topRect(sim: KitchenSim, s: Station) {
  const h = hasFront(sim, s) ? T - D : T;
  return { x: s.x * T, y: s.y * T, w: T, h, cx: s.x * T + T / 2, cy: s.y * T + h / 2 };
}

function drawImg(ctx: Ctx, img: HTMLImageElement, cx: number, cy: number, size: number) {
  if (!img.complete || img.naturalWidth === 0) return;
  ctx.drawImage(img, cx - size / 2, cy - size / 2, size, size);
}

export function drawItem(ctx: Ctx, it: KitchenItem, cx: number, cy: number, size: number) {
  drawImg(ctx, itemImage(it), cx, cy, size);
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
// Static layer: floor and station bodies (drawn once)
// ---------------------------------------------------------------------------

export function drawStatic(ctx: Ctx, sim: KitchenSim) {
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
  // Kitchen tiles: cream and biscuit, with a little folk diamond on every other one.
  for (let y = 0; y < GRID_H; y++) {
    for (let x = 0; x < GRID_W; x++) {
      if (sim.stationAt(x, y)) continue;
      const dark = (x + y) % 2 === 1;
      ctx.fillStyle = dark ? '#ecd5aa' : '#f8ecd2';
      ctx.fillRect(x * T, y * T, T, T);
      if (dark) {
        const cx = x * T + T / 2;
        const cy = y * T + T / 2;
        ctx.fillStyle = 'rgba(214, 58, 79, 0.16)';
        ctx.beginPath();
        ctx.moveTo(cx, cy - 13);
        ctx.lineTo(cx + 13, cy);
        ctx.lineTo(cx, cy + 13);
        ctx.lineTo(cx - 13, cy);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = 'rgba(47, 95, 174, 0.18)';
        ellipse(ctx, cx, cy, 4, 4);
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(120, 80, 40, 0.14)';
      ctx.lineWidth = 2;
      ctx.strokeRect(x * T + 1, y * T + 1, T - 2, T - 2);
    }
  }
  // Soft shadows cast onto the floor by the counters.
  for (const s of sim.stations) {
    const below = s.y + 1 < GRID_H && !sim.stationAt(s.x, s.y + 1);
    if (below) {
      const g = ctx.createLinearGradient(0, (s.y + 1) * T, 0, (s.y + 1) * T + 18);
      g.addColorStop(0, 'rgba(70, 30, 10, 0.28)');
      g.addColorStop(1, 'rgba(70, 30, 10, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(s.x * T, (s.y + 1) * T, T, 18);
    }
  }
  for (const s of sim.stations) drawStationBase(ctx, sim, s);
}

function drawStationBase(ctx: Ctx, sim: KitchenSim, s: Station) {
  const r = topRect(sim, s);
  const pal = s.kind === 'stove' ? STOVE : s.kind === 'sink' ? STEEL : WOOD;
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
      drawImg(ctx, itemImage({ k: 'flour' }), cx, cy, T * 0.78);
      break;
    case 'crate': {
      // A slatted crate full of the filling.
      ctx.fillStyle = '#9b5e2c';
      rr(ctx, r.x + 8, r.y + 8, T - 16, r.h - 16, 8);
      ctx.fill();
      ctx.strokeStyle = '#6b3a14';
      ctx.lineWidth = 3;
      ctx.stroke();
      drawImg(ctx, fillingImage(s.crate!), cx, cy, T * 0.66);
      if (hasFront(sim, s)) {
        ctx.fillStyle = '#e8d7b0';
        ctx.fillRect(r.x + 14, r.y + r.h + 4, T - 28, D - 8);
      }
      break;
    }
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
      ctx.strokeStyle = '#1b1b22';
      ctx.lineWidth = 5;
      ellipse(ctx, cx, cy, T * 0.36, T * 0.3);
      ctx.stroke();
      ctx.strokeStyle = '#5c5c70';
      ctx.lineWidth = 2;
      ellipse(ctx, cx, cy, T * 0.26, T * 0.21);
      ctx.stroke();
      // Knobs on the front
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
      ctx.fillStyle = '#2f4a32';
      ellipse(ctx, cx, cy, T * 0.34, T * 0.28);
      ctx.fill();
      ctx.strokeStyle = '#1a2c1c';
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.fillStyle = '#4c7350';
      ellipse(ctx, cx, cy, T * 0.24, T * 0.19);
      ctx.fill();
      ctx.strokeStyle = '#a3e048';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(cx - 10, cy - 6);
      ctx.lineTo(cx + 10, cy + 6);
      ctx.moveTo(cx + 10, cy - 6);
      ctx.lineTo(cx - 10, cy + 6);
      ctx.stroke();
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

const COOKED = '#f1c46a';
const RAW = '#f7ead0';

function smallPierogi(ctx: Ctx, x: number, y: number, w: number, fill: string, rot = 0) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(w / 120, w / 120);
  ctx.translate(-60, -56);
  ctx.fillStyle = fill;
  ctx.strokeStyle = 'rgba(120, 70, 20, 0.7)';
  ctx.lineWidth = 6;
  ctx.fill(body());
  ctx.stroke(body());
  ctx.restore();
}

function drawStationContents(ctx: Ctx, sim: KitchenSim, s: Station, now: number) {
  const r = topRect(sim, s);
  const { cx, cy } = r;
  switch (s.kind) {
    case 'counter':
    case 'roll':
      if (s.item) drawItem(ctx, s.item, cx, cy, T * 0.74);
      else if (s.kind === 'roll') {
        // Rolling pin waiting on the board.
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(-0.5);
        ctx.fillStyle = '#d9a66a';
        rr(ctx, -26, -6, 52, 12, 6);
        ctx.fill();
        ctx.fillStyle = '#9b6230';
        rr(ctx, -36, -3.5, 12, 7, 3);
        ctx.fill();
        rr(ctx, 24, -3.5, 12, 7, 3);
        ctx.fill();
        ctx.restore();
      }
      break;
    case 'fold':
      if (s.item) drawItem(ctx, s.item, cx, cy, T * 0.74);
      else {
        if (s.dough) drawItem(ctx, { k: 'dough' }, s.fill ? cx - 12 : cx, cy + 4, T * 0.62);
        if (s.fill) drawItem(ctx, { k: 'fill', f: s.fill }, s.dough ? cx + 14 : cx, cy - 4, T * 0.56);
      }
      break;
    case 'stove': {
      const pot = s.pot;
      const boiling = !!s.busy;
      if (boiling) {
        const g = ctx.createRadialGradient(cx, cy, 10, cx, cy, T * 0.48);
        g.addColorStop(0, 'rgba(255, 150, 40, 0.9)');
        g.addColorStop(1, 'rgba(255, 80, 20, 0)');
        ctx.fillStyle = g;
        ellipse(ctx, cx, cy, T * 0.5, T * 0.44);
        ctx.fill();
      }
      // The pot
      ctx.fillStyle = '#9aa1ad';
      ctx.fillRect(cx - T * 0.44, cy - 5, T * 0.88, 10);
      ctx.fillStyle = '#dfe3e9';
      ellipse(ctx, cx, cy, T * 0.36, T * 0.31);
      ctx.fill();
      ctx.strokeStyle = '#6f7787';
      ctx.lineWidth = 3;
      ctx.stroke();
      const inner = pot?.state === 'mushy' ? '#8b7d5c' : '#86c4e4';
      ctx.fillStyle = inner;
      ellipse(ctx, cx, cy, T * 0.29, T * 0.24);
      ctx.fill();
      if (pot) {
        if (pot.state === 'mushy') {
          ctx.fillStyle = '#6e6448';
          for (const [dx, dy, rr2] of [
            [-8, -4, 7],
            [9, 3, 6],
            [-2, 8, 5],
          ])
            (ellipse(ctx, cx + dx, cy + dy, rr2, rr2 * 0.8), ctx.fill());
          ctx.strokeStyle = 'rgba(120, 170, 60, 0.85)';
          ctx.lineWidth = 3;
          for (const k of [-1, 0, 1]) {
            ctx.beginPath();
            const sx = cx + k * 14;
            const off = (now / 300 + k) % 1;
            ctx.moveTo(sx, cy - 14 - off * 10);
            ctx.bezierCurveTo(sx + 6, cy - 22 - off * 10, sx - 6, cy - 30 - off * 10, sx, cy - 38 - off * 10);
            ctx.stroke();
          }
        } else {
          const fill = pot.state === 'cooked' ? COOKED : RAW;
          const bobAmp = pot.state === 'cooked' || boiling ? 2.5 : 0;
          smallPierogi(ctx, cx - 9, cy + 4 + Math.sin(now / 200) * bobAmp, 26, fill, -0.2);
          smallPierogi(ctx, cx + 10, cy + 5 + Math.sin(now / 230 + 1) * bobAmp, 26, fill, 0.25);
          smallPierogi(ctx, cx, cy - 6 + Math.sin(now / 260 + 2) * bobAmp, 26, fill, 0);
          if (pot.state === 'cooked') {
            // Steam
            ctx.strokeStyle = 'rgba(255,255,255,0.7)';
            ctx.lineWidth = 3;
            for (const k of [-1, 1]) {
              const off = (now / 900 + (k + 1) * 0.3) % 1;
              ctx.globalAlpha = 1 - off;
              ctx.beginPath();
              const sx = cx + k * 12;
              ctx.moveTo(sx, cy - 16 - off * 24);
              ctx.bezierCurveTo(sx + 7, cy - 22 - off * 24, sx - 7, cy - 30 - off * 24, sx, cy - 36 - off * 24);
              ctx.stroke();
            }
            ctx.globalAlpha = 1;
            // Warning: about to turn to mush.
            const left = sim.tuning.overcookMs - (sim.t - pot.since);
            if (left < 8000 && Math.floor(now / 220) % 2 === 0) {
              ctx.strokeStyle = '#ff3d6e';
              ctx.lineWidth = 5;
              ellipse(ctx, cx, cy, T * 0.42, T * 0.37);
              ctx.stroke();
            }
          }
          if (boiling) {
            ctx.fillStyle = 'rgba(255,255,255,0.8)';
            for (let i = 0; i < 5; i++) {
              const a = now / 150 + i * 1.7;
              ellipse(ctx, cx + Math.cos(a * 1.3) * 16, cy + Math.sin(a) * 12, 2.5, 2.5);
              ctx.fill();
            }
          }
        }
        // Which filling is in there
        ctx.fillStyle = '#fff';
        ellipse(ctx, r.x + T - 16, r.y + 15, 13, 13);
        ctx.fill();
        ctx.strokeStyle = INK;
        ctx.lineWidth = 2;
        ctx.stroke();
        drawImg(ctx, fillingImage(pot.f), r.x + T - 16, r.y + 15, 21);
      }
      break;
    }
    case 'sink':
      for (let i = 0; i < Math.min(3, s.count); i++) drawItem(ctx, { k: 'dirty', n: 1 }, cx - 6 + i * 6, cy + 4 - i * 5, T * 0.55);
      if (s.count > 1) countBadge(ctx, s.count, r.x + T - 14, r.y + 14);
      break;
    case 'rack':
    case 'return': {
      const it: KitchenItem = s.kind === 'rack' ? { k: 'plate' } : { k: 'dirty', n: 1 };
      for (let i = 0; i < Math.min(6, s.count); i++) drawItem(ctx, it, cx, cy + 6 - i * 5, T * 0.7);
      if (s.count > 1) countBadge(ctx, s.count, r.x + T - 14, r.y + 14);
      if (s.kind === 'rack' && s.count === 0) {
        ctx.fillStyle = 'rgba(42, 18, 10, 0.55)';
        ctx.font = '700 15px "Fredoka Variable", "Fredoka", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('no plates', cx, cy);
      }
      break;
    }
    case 'hatch': {
      // Bell
      ctx.fillStyle = '#f2b705';
      ctx.beginPath();
      ctx.arc(r.x + T - 22, r.y + 26, 11, Math.PI, 0);
      ctx.fill();
      ctx.fillRect(r.x + T - 36, r.y + 26, 28, 4);
      ctx.fillStyle = '#c48a00';
      ellipse(ctx, r.x + T - 22, r.y + 13, 3, 3);
      ctx.fill();
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
