/**
 * Obrona Wawelu on the TV: a Canvas 2D drawing of the field, the castle wall, the archers and the
 * monsters. The field and the wall are painted once to an offscreen canvas; everything else is
 * redrawn every frame. All art is drawn by hand here (no sprites), in the house style: flat shapes,
 * ink outlines, hard shadows.
 */
import { PIEROGI_PATH } from '../../lib/art';
import { mulberry32 } from '../rng';
import {
  H,
  MONSTERS,
  W,
  WALL_Y,
  aimVector,
  depthScale,
  ghostVisible,
  rangeFor,
  type Archer,
  type CastleSim,
  type Monster,
} from './logic';

type Ctx = CanvasRenderingContext2D;

const INK = '#2a120a';
/** Top of the battlements' outer face, the walkway and the inner edge. */
const MERLON_Y = WALL_Y - 6;
const WALK_Y = WALL_Y + 44;
const INNER_Y = 1000;

let bodyPath: Path2D | null = null;
const body = () => (bodyPath ??= new Path2D(PIEROGI_PATH));

function ellipse(ctx: Ctx, x: number, y: number, rx: number, ry: number) {
  ctx.beginPath();
  ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2);
}

function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function inked(ctx: Ctx, fill: string, width = 4) {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = width;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// The static layer: forest, meadow, paths and the castle wall
// ---------------------------------------------------------------------------

export function drawBackground(ctx: Ctx) {
  const rng = mulberry32(1257);
  // Meadow, darker towards the forest.
  const g = ctx.createLinearGradient(0, 0, 0, WALL_Y);
  g.addColorStop(0, '#2c5530');
  g.addColorStop(0.5, '#4a7d3b');
  g.addColorStop(1, '#6a9a45');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, WALL_Y + 40);
  // Mown stripes.
  for (let i = 0; i < 12; i++) {
    ctx.fillStyle = i % 2 ? 'rgba(255, 244, 200, 0.035)' : 'rgba(0, 30, 0, 0.04)';
    ctx.fillRect(i * 160, 0, 160, WALL_Y + 40);
  }
  // Dirt paths from the forest to the gate.
  ctx.lineCap = 'round';
  for (const [x0, cx, x1] of [
    [420, 300, 760],
    [1500, 1650, 1160],
    [960, 1060, 960],
  ]) {
    ctx.strokeStyle = 'rgba(70, 40, 15, 0.35)';
    ctx.lineWidth = 86;
    ctx.beginPath();
    ctx.moveTo(x0, 60);
    ctx.quadraticCurveTo(cx, 450, x1, WALL_Y + 20);
    ctx.stroke();
    ctx.strokeStyle = '#b48a55';
    ctx.lineWidth = 70;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 230, 180, 0.18)';
    ctx.lineWidth = 30;
    ctx.stroke();
  }
  // Tufts, flowers and stones.
  for (let i = 0; i < 260; i++) {
    const x = rng() * W;
    const y = 120 + rng() * (WALL_Y - 140);
    const k = rng();
    if (k < 0.62) {
      ctx.strokeStyle = `rgba(20, 50, 15, ${0.3 + rng() * 0.3})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (const d of [-6, 0, 6]) {
        ctx.moveTo(x + d * 0.4, y);
        ctx.lineTo(x + d, y - 9 - rng() * 6);
      }
      ctx.stroke();
    } else if (k < 0.9) {
      ctx.fillStyle = ['#fff4dc', '#ffd23f', '#ff7ad1', '#e8335a', '#4f9dff'][Math.floor(rng() * 5)];
      for (let p = 0; p < 5; p++) {
        ellipse(ctx, x + Math.cos((p * Math.PI * 2) / 5) * 4, y + Math.sin((p * Math.PI * 2) / 5) * 4, 3.2, 3.2);
        ctx.fill();
      }
      ctx.fillStyle = '#ffd23f';
      ellipse(ctx, x, y, 2.4, 2.4);
      ctx.fill();
    } else {
      ellipse(ctx, x, y, 9 + rng() * 8, 6 + rng() * 4);
      inked(ctx, '#9a9486', 2.5);
    }
  }
  // The forest along the top, three rows of firs.
  for (let row = 0; row < 3; row++) {
    const y = 30 + row * 42;
    for (let x = -30; x < W + 60; x += 58 + rng() * 22) {
      const h = 120 + rng() * 50;
      const w = 70 + rng() * 20;
      ctx.beginPath();
      ctx.moveTo(x, y - h * 0.75);
      ctx.lineTo(x + w / 2, y + h * 0.25);
      ctx.lineTo(x - w / 2, y + h * 0.25);
      ctx.closePath();
      inked(ctx, ['#173a24', '#1d4a2c', '#235634'][row], 3);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
      ctx.beginPath();
      ctx.moveTo(x, y - h * 0.75);
      ctx.lineTo(x + w / 2, y + h * 0.25);
      ctx.lineTo(x, y + h * 0.25);
      ctx.closePath();
      ctx.fill();
    }
  }
  // Mist where the monsters come out.
  const mist = ctx.createLinearGradient(0, 120, 0, 260);
  mist.addColorStop(0, 'rgba(210, 225, 230, 0.35)');
  mist.addColorStop(1, 'rgba(210, 225, 230, 0)');
  ctx.fillStyle = mist;
  ctx.fillRect(0, 120, W, 140);

  drawWall(ctx);
}

function drawWall(ctx: Ctx) {
  const rng = mulberry32(77);
  // Shadow the wall casts onto the meadow.
  ctx.fillStyle = 'rgba(20, 30, 10, 0.3)';
  ctx.fillRect(0, MERLON_Y - 16, W, 18);
  // Outer face with the merlons (seen from above and behind: a row of stone teeth).
  ctx.fillStyle = '#8e8371';
  ctx.fillRect(0, MERLON_Y, W, WALK_Y - MERLON_Y);
  for (let x = 0; x < W; x += 96) {
    rr(ctx, x + 6, MERLON_Y - 4, 60, 40, 6);
    inked(ctx, '#b9ab92', 3.5);
    ctx.fillStyle = 'rgba(255, 250, 230, 0.25)';
    ctx.fillRect(x + 12, MERLON_Y, 48, 7);
  }
  // The walkway: wooden boards.
  ctx.fillStyle = '#a0703e';
  ctx.fillRect(0, WALK_Y, W, INNER_Y - WALK_Y);
  for (let y = WALK_Y; y < INNER_Y; y += 30) {
    ctx.strokeStyle = 'rgba(60, 30, 10, 0.45)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
    for (let x = rng() * 200; x < W; x += 160 + rng() * 140) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + 30);
      ctx.stroke();
    }
  }
  ctx.fillStyle = 'rgba(0, 0, 0, 0.22)';
  ctx.fillRect(0, WALK_Y, W, 10);
  // Inner edge: brick, then the castle roofs below.
  ctx.fillStyle = '#6e4a3a';
  ctx.fillRect(0, INNER_Y, W, H - INNER_Y);
  for (let y = INNER_Y; y < H; y += 22) {
    for (let x = ((y - INNER_Y) / 22) % 2 ? -30 : 0; x < W; x += 60) {
      rr(ctx, x + 2, y + 2, 56, 18, 3);
      ctx.fillStyle = (x + y) % 3 ? '#8a5a44' : '#7c503c';
      ctx.fill();
    }
  }
  ctx.fillStyle = INK;
  ctx.fillRect(0, INNER_Y - 3, W, 5);
  // Towers in the corners, with Wawel's red-and-gold roofs.
  for (const x of [70, W - 70]) tower(ctx, x, MERLON_Y + 40);
}

function tower(ctx: Ctx, x: number, y: number, k = 1, roof = '#c2412d') {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(k, k);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.28)';
  ellipse(ctx, 10, 14, 112, 92);
  ctx.fill();
  ellipse(ctx, 0, 0, 108, 88);
  inked(ctx, '#b9ab92', 5);
  // Conical roof seen from above: slices.
  for (let i = 0; i < 12; i++) {
    const a0 = (i / 12) * Math.PI * 2;
    const a1 = ((i + 1) / 12) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(Math.cos(a0) * 88, Math.sin(a0) * 72);
    ctx.lineTo(Math.cos(a1) * 88, Math.sin(a1) * 72);
    ctx.closePath();
    ctx.fillStyle = i % 2 ? roof : shade(roof, 0.82);
    ctx.fill();
  }
  ellipse(ctx, 0, 0, 88, 72);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 4;
  ctx.stroke();
  ellipse(ctx, 0, -6, 13, 13);
  inked(ctx, '#ffc93c', 3);
  ctx.restore();
}

function shade(hex: string, k: number) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${c(n >> 16)}, ${c((n >> 8) & 255)}, ${c(n & 255)})`;
}

/** Cracks in the merlons as the wall wears down (0 = whole, 1 = rubble). */
export function drawCracks(ctx: Ctx, worn: number) {
  if (worn <= 0.05) return;
  const rng = mulberry32(99);
  const n = Math.floor(worn * 26);
  ctx.strokeStyle = 'rgba(40, 20, 10, 0.8)';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    let x = 40 + rng() * (W - 80);
    let y = MERLON_Y + 4 + rng() * 30;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let s = 0; s < 4; s++) {
      x += (rng() - 0.5) * 30;
      y += 4 + rng() * 10;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  if (worn > 0.5) {
    // Fallen stones.
    for (let i = 0; i < Math.floor((worn - 0.5) * 30); i++) {
      ellipse(ctx, 40 + rng() * (W - 80), MERLON_Y - 20 - rng() * 30, 10 + rng() * 6, 7 + rng() * 4);
      inked(ctx, '#b9ab92', 2.5);
    }
  }
}

// ---------------------------------------------------------------------------
// Archers
// ---------------------------------------------------------------------------

export interface ArcherLook {
  color: string;
  name: string;
  connected: boolean;
}

export function drawArcher(ctx: Ctx, a: Archer, look: ArcherLook, t: number, ready: boolean) {
  const [dx, dy] = aimVector(a.aim);
  // Aim guide: where the arrow would land.
  if (a.aiming && a.draw > 0.05 && a.active) {
    const len = rangeFor(a.draw) + 30;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.setLineDash([4, 18]);
    ctx.lineDashOffset = -t * 60;
    ctx.strokeStyle = a.charged ? '#ffd23f' : look.color;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = a.charged ? 9 : 6;
    ctx.beginPath();
    ctx.moveTo(a.x + dx * 50, a.y - 26 + dy * 50);
    ctx.lineTo(a.x + dx * len, a.y - 26 + dy * len);
    ctx.stroke();
    ctx.setLineDash([]);
    const ex = a.x + dx * len;
    const ey = a.y - 26 + dy * len;
    ellipse(ctx, ex, ey, 16, 16);
    ctx.lineWidth = 5;
    ctx.stroke();
    if (a.charged) {
      ctx.globalAlpha = 0.35 + 0.25 * Math.sin(t * 18);
      ellipse(ctx, ex, ey, 26, 26);
      ctx.fillStyle = '#ffd23f';
      ctx.fill();
    }
    ctx.restore();
  }
  ctx.save();
  ctx.translate(a.x, a.y);
  ctx.scale(1.25, 1.25);
  // Shadow.
  ctx.fillStyle = 'rgba(30, 10, 0, 0.35)';
  ellipse(ctx, 6, 34, 46, 14);
  ctx.fill();
  // The pierogi, seen from behind (no face – it's looking at the monsters).
  ctx.save();
  ctx.translate(-48, -34);
  ctx.scale(0.8, 0.8);
  ctx.globalAlpha = a.active ? (look.connected ? 1 : 0.5) : 0.25;
  ctx.fillStyle = look.color;
  ctx.strokeStyle = 'rgba(40, 16, 8, 0.75)';
  ctx.lineWidth = 6;
  ctx.fill(body());
  ctx.stroke(body());
  ctx.fillStyle = 'rgba(40, 16, 8, 0.16)';
  ctx.beginPath();
  ctx.moveTo(12, 70);
  ctx.quadraticCurveTo(60, 92, 108, 70);
  ctx.quadraticCurveTo(60, 84, 12, 70);
  ctx.fill();
  // A little quiver on its back.
  ctx.fillStyle = '#7a4a24';
  rr(ctx, 74, 24, 18, 40, 6);
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.strokeStyle = '#fff4dc';
  ctx.lineWidth = 4;
  ctx.beginPath();
  for (const x of [78, 84, 90]) {
    ctx.moveTo(x, 24);
    ctx.lineTo(x - 2, 12);
  }
  ctx.stroke();
  ctx.restore();
  // The bow, held up in front, turned to the aim.
  if (a.active) {
    ctx.save();
    ctx.translate(0, -26);
    ctx.rotate(Math.atan2(dy, dx) + Math.PI / 2);
    const pull = a.aiming ? 6 + a.draw * 26 : 6;
    // Limbs.
    ctx.strokeStyle = INK;
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-34, 4);
    ctx.quadraticCurveTo(0, -38, 34, 4);
    ctx.stroke();
    ctx.strokeStyle = '#c98a4b';
    ctx.lineWidth = 5;
    ctx.stroke();
    // String.
    ctx.strokeStyle = 'rgba(255, 244, 220, 0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-34, 4);
    ctx.lineTo(0, pull);
    ctx.lineTo(34, 4);
    ctx.stroke();
    // A nocked arrow when the bow is ready.
    if (ready) {
      ctx.strokeStyle = a.charged ? '#ffd23f' : '#fff4dc';
      ctx.lineWidth = a.charged ? 5 : 4;
      ctx.beginPath();
      ctx.moveTo(0, pull);
      ctx.lineTo(0, -44);
      ctx.stroke();
      ctx.fillStyle = '#c9ccd3';
      ctx.beginPath();
      ctx.moveTo(0, -54);
      ctx.lineTo(7, -42);
      ctx.lineTo(-7, -42);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = look.color;
      ctx.fillRect(-6, pull - 2, 12, 8);
    }
    ctx.restore();
  }
  // Name tag.
  ctx.font = '800 22px "Fraunces Variable", Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const w = Math.max(60, ctx.measureText(look.name).width + 26);
  ctx.globalAlpha = a.active ? 1 : 0.4;
  rr(ctx, -w / 2, 42, w, 30, 15);
  ctx.fillStyle = 'rgba(20, 6, 10, 0.82)';
  ctx.fill();
  ctx.fillStyle = look.color;
  ctx.fillText(look.name, 0, 58);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Monsters (front-facing: they're walking towards the wall)
// ---------------------------------------------------------------------------

/** Zmora's opacity: fades in and out smoothly around ghostVisible(). */
function ghostAlpha(m: Monster) {
  if (m.atWall) return 1;
  const p = (m.age + m.ph * 3.6) % 3.6;
  if (p < 0.3) return 0.15 + (p / 0.3) * 0.85;
  if (p < 2.0) return 1;
  if (p < 2.3) return 1 - ((p - 2.0) / 0.3) * 0.85;
  return 0.15;
}

export function drawMonster(ctx: Ctx, m: Monster, t: number) {
  const info = MONSTERS[m.kind];
  const s = depthScale(m.y);
  const r = info.r * s;
  ctx.save();
  // Shadow (flyers cast theirs further down).
  if (m.kind !== 'fireball') {
    ctx.fillStyle = 'rgba(10, 25, 5, 0.32)';
    ellipse(ctx, m.x, m.y + r * (info.fly ? 1.6 : 0.85), r * 0.95, r * 0.32);
    ctx.fill();
  }
  ctx.translate(m.x, m.y);
  ctx.scale(r / 50, r / 50);
  if (m.kind === 'ghost') ctx.globalAlpha = ghostAlpha(m);
  if (m.hurt < 0.12) ctx.filter = 'brightness(2.2)';
  const step = Math.sin(m.age * 9 + m.ph * 6);
  switch (m.kind) {
    case 'imp':
      imp(ctx, step, m.atWall ? Math.sin(t * 14 + m.ph * 6) : 0);
      break;
    case 'wolf':
      wolf(ctx, step, m.atWall);
      break;
    case 'knight':
      knight(ctx, step, m.atWall ? Math.sin(t * 6 + m.ph * 6) : 0);
      break;
    case 'bat':
      bat(ctx, Math.sin(m.age * 16 + m.ph * 6));
      break;
    case 'ghost':
      ghost(ctx, m.age + m.ph * 6);
      break;
    case 'giant':
      giant(ctx, step, m.atWall ? Math.sin(t * 3 + m.ph * 6) : 0);
      break;
    case 'dragon':
      dragon(ctx, Math.sin(m.age * 4), m.next < 0.6);
      break;
    case 'fireball':
      fireball(ctx, t + m.ph * 6);
      break;
  }
  ctx.restore();
  // Health bar for the tough ones once they've been hit.
  if (m.maxHp > 1 && m.hp < m.maxHp && m.kind !== 'dragon' && ghostVisible(m)) {
    const w = Math.max(50, r * 1.4);
    const y = m.y - r * 1.25 - 14;
    rr(ctx, m.x - w / 2 - 3, y - 3, w + 6, 16, 8);
    ctx.fillStyle = 'rgba(20, 6, 10, 0.85)';
    ctx.fill();
    rr(ctx, m.x - w / 2, y, Math.max(4, (w * m.hp) / m.maxHp), 10, 5);
    ctx.fillStyle = m.hp / m.maxHp > 0.5 ? '#a3e048' : m.hp / m.maxHp > 0.25 ? '#ffc93c' : '#e8335a';
    ctx.fill();
  }
}

function eyes(ctx: Ctx, x: number, y: number, gap: number, r: number, iris: string, pupil = INK) {
  for (const k of [-1, 1]) {
    ellipse(ctx, x + k * gap, y, r, r * 1.1);
    inked(ctx, iris, 2.5);
    ellipse(ctx, x + k * gap, y + r * 0.15, r * 0.45, r * 0.6);
    ctx.fillStyle = pupil;
    ctx.fill();
  }
}

/** Bies: a little red devil with horns and a pitchfork grin. */
function imp(ctx: Ctx, step: number, bash: number) {
  // Feet.
  for (const k of [-1, 1]) {
    ellipse(ctx, k * 18, 40 + (k * step > 0 ? -5 : 0), 12, 8);
    inked(ctx, '#5a1a1a', 3);
  }
  // Tail.
  ctx.strokeStyle = INK;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(30, 20);
  ctx.quadraticCurveTo(62, 14 + step * 8, 56, -10);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(56, -22);
  ctx.lineTo(64, -6);
  ctx.lineTo(48, -6);
  ctx.closePath();
  inked(ctx, '#b8432f', 3);
  // Horns.
  for (const k of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(k * 16, -30);
    ctx.quadraticCurveTo(k * 34, -50, k * 28, -66);
    ctx.quadraticCurveTo(k * 22, -46, k * 4, -36);
    ctx.closePath();
    inked(ctx, '#f3e3c3', 3);
  }
  // Body.
  ellipse(ctx, 0, 4, 40, 42);
  inked(ctx, '#b8432f');
  ellipse(ctx, 0, 18, 24, 20);
  ctx.fillStyle = '#d9735a';
  ctx.fill();
  // Arms (pounding the wall when there).
  for (const k of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(k * 34, 6);
    ctx.lineTo(k * 48, 16 - (bash * k > 0 ? 18 : 0));
    ctx.strokeStyle = INK;
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.strokeStyle = '#b8432f';
    ctx.lineWidth = 5;
    ctx.stroke();
  }
  eyes(ctx, 0, -10, 14, 9, '#ffd23f');
  // Grin with fangs.
  ctx.beginPath();
  ctx.moveTo(-16, 8);
  ctx.quadraticCurveTo(0, 22, 16, 8);
  ctx.closePath();
  inked(ctx, '#3a0a0a', 3);
  ctx.fillStyle = '#fff';
  for (const k of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(k * 9, 9);
    ctx.lineTo(k * 5, 16);
    ctx.lineTo(k * 2, 10);
    ctx.closePath();
    ctx.fill();
  }
}

/** A grey wolf, head on. */
function wolf(ctx: Ctx, step: number, biting: boolean) {
  // Legs.
  for (const k of [-1, 1]) {
    rr(ctx, k * 20 - 7, 22 + (k * step > 0 ? -6 : 0), 14, 26, 6);
    inked(ctx, '#5f6472', 3);
  }
  // Body behind.
  ellipse(ctx, 0, 14, 36, 26);
  inked(ctx, '#6f7484');
  // Ears.
  for (const k of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(k * 12, -34);
    ctx.lineTo(k * 34, -64);
    ctx.lineTo(k * 38, -24);
    ctx.closePath();
    inked(ctx, '#8a8fa0', 3);
    ctx.beginPath();
    ctx.moveTo(k * 20, -34);
    ctx.lineTo(k * 32, -54);
    ctx.lineTo(k * 33, -32);
    ctx.closePath();
    ctx.fillStyle = '#e59aa8';
    ctx.fill();
  }
  // Head.
  ctx.beginPath();
  ctx.moveTo(-40, -30);
  ctx.quadraticCurveTo(0, -52, 40, -30);
  ctx.quadraticCurveTo(44, 0, 0, 20);
  ctx.quadraticCurveTo(-44, 0, -40, -30);
  inked(ctx, '#8a8fa0');
  // Muzzle.
  ellipse(ctx, 0, 2, 17, 15);
  inked(ctx, '#d8d6cf', 3);
  ellipse(ctx, 0, -6, 8, 5.5);
  ctx.fillStyle = INK;
  ctx.fill();
  if (biting) {
    ellipse(ctx, 0, 10, 10, 6);
    ctx.fillStyle = '#7a1020';
    ctx.fill();
  }
  eyes(ctx, 0, -22, 15, 6.5, '#ff5a3c');
}

/** Czarny Rycerz: plate armour, a red plume and a shield. */
function knight(ctx: Ctx, step: number, swing: number) {
  for (const k of [-1, 1]) {
    rr(ctx, k * 18 - 9, 26 + (k * step > 0 ? -5 : 0), 18, 24, 5);
    inked(ctx, '#3b4252', 3);
  }
  // Sword arm.
  ctx.save();
  ctx.translate(36, 0);
  ctx.rotate(-0.6 + swing * 0.9);
  rr(ctx, -4, -64, 8, 60, 3);
  inked(ctx, '#d4dae3', 3);
  rr(ctx, -14, -8, 28, 7, 3);
  inked(ctx, '#ffc93c', 2.5);
  ctx.restore();
  // Body.
  rr(ctx, -36, -14, 72, 50, 18);
  inked(ctx, '#4a5160');
  ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
  ctx.fillRect(-26, -8, 14, 36);
  // Helmet with the plume.
  ctx.beginPath();
  ctx.moveTo(0, -56);
  ctx.quadraticCurveTo(10, -86, 30, -80);
  ctx.quadraticCurveTo(18, -72, 10, -54);
  ctx.closePath();
  inked(ctx, '#e8335a', 3);
  rr(ctx, -26, -60, 52, 52, 22);
  inked(ctx, '#6b7487');
  rr(ctx, -18, -40, 36, 8, 4);
  ctx.fillStyle = '#12141a';
  ctx.fill();
  ctx.fillStyle = '#ff3d3d';
  ellipse(ctx, -8, -36, 3, 2);
  ctx.fill();
  ellipse(ctx, 8, -36, 3, 2);
  ctx.fill();
  // Shield.
  ctx.beginPath();
  ctx.moveTo(-58, -12);
  ctx.lineTo(-22, -12);
  ctx.lineTo(-22, 18);
  ctx.quadraticCurveTo(-40, 42, -40, 42);
  ctx.quadraticCurveTo(-58, 18, -58, 18);
  ctx.closePath();
  inked(ctx, '#2b2f3a');
  ctx.fillStyle = '#e8335a';
  ctx.fillRect(-44, -12, 8, 46);
}

/** A bat: big ears, flapping wings. */
function bat(ctx: Ctx, flap: number) {
  const up = flap * 22;
  for (const k of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(k * 14, -4);
    ctx.quadraticCurveTo(k * 50, -36 - up, k * 82, -18 - up);
    ctx.quadraticCurveTo(k * 70, -2, k * 74, 10 - up * 0.3);
    ctx.quadraticCurveTo(k * 56, 2, k * 50, 18 - up * 0.2);
    ctx.quadraticCurveTo(k * 36, 6, k * 14, 14);
    ctx.closePath();
    inked(ctx, '#4a2c66', 3.5);
  }
  for (const k of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(k * 6, -20);
    ctx.lineTo(k * 22, -46);
    ctx.lineTo(k * 24, -14);
    ctx.closePath();
    inked(ctx, '#6b4590', 3);
  }
  ellipse(ctx, 0, 0, 26, 28);
  inked(ctx, '#6b4590');
  eyes(ctx, 0, -6, 10, 6, '#ff5a3c');
  ctx.fillStyle = '#fff';
  for (const k of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(k * 7, 8);
    ctx.lineTo(k * 4, 16);
    ctx.lineTo(k * 1, 8);
    ctx.closePath();
    ctx.fill();
  }
}

/** Zmora: a nightmare in a bedsheet that comes and goes. */
function ghost(ctx: Ctx, t: number) {
  ctx.beginPath();
  ctx.moveTo(-40, 30);
  ctx.lineTo(-40, -14);
  ctx.quadraticCurveTo(-40, -58, 0, -58);
  ctx.quadraticCurveTo(40, -58, 40, -14);
  ctx.lineTo(40, 30);
  for (let i = 0; i < 4; i++) {
    const x0 = 40 - i * 20;
    ctx.quadraticCurveTo(x0 - 5, 44 + Math.sin(t * 6 + i) * 6, x0 - 10, 30);
    ctx.quadraticCurveTo(x0 - 15, 20, x0 - 20, 30);
  }
  ctx.closePath();
  inked(ctx, '#eef3ff');
  ctx.fillStyle = 'rgba(120, 140, 200, 0.2)';
  ctx.fill();
  for (const k of [-1, 1]) {
    ellipse(ctx, k * 14, -22, 8, 11);
    ctx.fillStyle = '#1b1f3a';
    ctx.fill();
  }
  ellipse(ctx, 0, 4, 8, 10 + Math.sin(t * 3) * 3);
  ctx.fillStyle = '#1b1f3a';
  ctx.fill();
  // Little arms reaching out.
  for (const k of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(k * 36, -4);
    ctx.quadraticCurveTo(k * 56, -12 + Math.sin(t * 4 + k) * 6, k * 60, 2);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.strokeStyle = '#eef3ff';
    ctx.lineWidth = 5;
    ctx.stroke();
  }
}

/** A mountain giant with a club. */
function giant(ctx: Ctx, step: number, swing: number) {
  for (const k of [-1, 1]) {
    rr(ctx, k * 20 - 12, 26 + (k * step > 0 ? -4 : 0), 24, 26, 8);
    inked(ctx, '#5e6b34', 3);
  }
  // Club arm.
  ctx.save();
  ctx.translate(40, -6);
  ctx.rotate(-0.4 - swing * 0.9);
  ctx.beginPath();
  ctx.moveTo(-6, 0);
  ctx.lineTo(-10, -58);
  ctx.quadraticCurveTo(0, -78, 12, -58);
  ctx.lineTo(6, 0);
  ctx.closePath();
  inked(ctx, '#8a5a34', 3);
  for (const [x, y] of [
    [-6, -52],
    [6, -62],
    [4, -44],
  ]) {
    ellipse(ctx, x, y, 2.5, 2.5);
    ctx.fillStyle = INK;
    ctx.fill();
  }
  ctx.restore();
  ellipse(ctx, 0, 0, 46, 44);
  inked(ctx, '#7d8f4a');
  ellipse(ctx, 0, 14, 30, 24);
  ctx.fillStyle = '#9fae6a';
  ctx.fill();
  // A belt with a buckle.
  ctx.fillStyle = '#5a3a1e';
  ctx.fillRect(-42, 18, 84, 9);
  rr(ctx, -7, 16, 14, 13, 3);
  inked(ctx, '#ffc93c', 2);
  // Head.
  ellipse(ctx, 0, -40, 26, 22);
  inked(ctx, '#8b9d55');
  eyes(ctx, 0, -44, 9, 4.5, '#fff4dc');
  ctx.strokeStyle = INK;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(-14, -52);
  ctx.lineTo(-4, -49);
  ctx.moveTo(14, -52);
  ctx.lineTo(4, -49);
  ctx.stroke();
  ctx.fillStyle = '#fff4dc';
  for (const k of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(k * 10, -30);
    ctx.lineTo(k * 13, -40);
    ctx.lineTo(k * 6, -31);
    ctx.closePath();
    ctx.fill();
  }
}

/** Smok Wawelski. */
function dragon(ctx: Ctx, flap: number, breathing: boolean) {
  const up = flap * 26;
  // Wings.
  for (const k of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(k * 26, -18);
    ctx.lineTo(k * 70, -70 - up);
    ctx.lineTo(k * 118, -54 - up);
    ctx.quadraticCurveTo(k * 104, -24 - up * 0.5, k * 112, 4 - up * 0.3);
    ctx.quadraticCurveTo(k * 90, -6, k * 84, 18);
    ctx.quadraticCurveTo(k * 66, 4, k * 58, 24);
    ctx.quadraticCurveTo(k * 44, 10, k * 26, 18);
    ctx.closePath();
    inked(ctx, '#245a33', 4);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(k * 70, -70 - up);
    ctx.lineTo(k * 84, 18);
    ctx.moveTo(k * 70, -70 - up);
    ctx.lineTo(k * 58, 24);
    ctx.stroke();
  }
  // Tail curling out to one side.
  ctx.strokeStyle = INK;
  ctx.lineWidth = 16;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(10, 40);
  ctx.quadraticCurveTo(54, 70, 70, 46 + flap * 4);
  ctx.stroke();
  ctx.strokeStyle = '#3f8a4a';
  ctx.lineWidth = 10;
  ctx.stroke();
  // Body and belly scales.
  ellipse(ctx, 0, 14, 44, 38);
  inked(ctx, '#3f8a4a');
  ellipse(ctx, 0, 20, 26, 26);
  ctx.fillStyle = '#e8c96a';
  ctx.fill();
  ctx.strokeStyle = 'rgba(120, 80, 20, 0.5)';
  ctx.lineWidth = 2.5;
  for (const y of [8, 18, 28, 38]) {
    ctx.beginPath();
    ctx.moveTo(-18, y);
    ctx.quadraticCurveTo(0, y + 6, 18, y);
    ctx.stroke();
  }
  // Head with horns.
  for (const k of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(k * 14, -50);
    ctx.quadraticCurveTo(k * 30, -76, k * 22, -88);
    ctx.quadraticCurveTo(k * 18, -70, k * 4, -56);
    ctx.closePath();
    inked(ctx, '#f3e3c3', 3);
  }
  ellipse(ctx, 0, -34, 32, 28);
  inked(ctx, '#4c9f58');
  // Snout.
  ellipse(ctx, 0, -18, 22, 14);
  inked(ctx, '#5bb367', 3);
  for (const k of [-1, 1]) {
    ellipse(ctx, k * 8, -20, 3, 2.5);
    ctx.fillStyle = INK;
    ctx.fill();
  }
  eyes(ctx, 0, -42, 13, 7, '#ffd23f');
  // Spikes along the head.
  ctx.fillStyle = '#e8335a';
  for (const x of [-10, 0, 10]) {
    ctx.beginPath();
    ctx.moveTo(x - 5, -60);
    ctx.lineTo(x, -72);
    ctx.lineTo(x + 5, -60);
    ctx.closePath();
    ctx.fill();
  }
  if (breathing) {
    const g = ctx.createRadialGradient(0, -2, 2, 0, -2, 24);
    g.addColorStop(0, '#fff4c8');
    g.addColorStop(0.5, '#ffb03c');
    g.addColorStop(1, 'rgba(232, 51, 40, 0)');
    ctx.fillStyle = g;
    ellipse(ctx, 0, -2, 24, 24);
    ctx.fill();
  }
}

function fireball(ctx: Ctx, t: number) {
  // A tail of flame up behind it (it falls towards the wall).
  for (let i = 3; i >= 1; i--) {
    ellipse(ctx, Math.sin(t * 20 + i) * 5, -i * 22, 40 - i * 8, 40 - i * 8);
    ctx.fillStyle = `rgba(255, ${90 + i * 30}, 40, ${0.25 + 0.1 * (3 - i)})`;
    ctx.fill();
  }
  const g = ctx.createRadialGradient(0, 0, 4, 0, 0, 50);
  g.addColorStop(0, '#fff8d0');
  g.addColorStop(0.35, '#ffd23f');
  g.addColorStop(0.7, '#ff7a1a');
  g.addColorStop(1, 'rgba(232, 51, 40, 0)');
  ctx.fillStyle = g;
  ellipse(ctx, 0, 0, 50 + Math.sin(t * 30) * 4, 50);
  ctx.fill();
}

// ---------------------------------------------------------------------------
// Arrows and effects
// ---------------------------------------------------------------------------

export function drawArrow(ctx: Ctx, x: number, y: number, dx: number, dy: number, color: string, charged: boolean, alpha = 1) {
  const len = 46;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = 'round';
  if (charged) {
    ctx.strokeStyle = 'rgba(255, 210, 63, 0.45)';
    ctx.lineWidth = 16;
    ctx.beginPath();
    ctx.moveTo(x - dx * 90, y - dy * 90);
    ctx.lineTo(x, y);
    ctx.stroke();
  }
  ctx.strokeStyle = INK;
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(x - dx * len, y - dy * len);
  ctx.lineTo(x, y);
  ctx.stroke();
  ctx.strokeStyle = charged ? '#ffd23f' : '#e8d2a8';
  ctx.lineWidth = 3.5;
  ctx.stroke();
  // Head.
  const nx = -dy;
  const ny = dx;
  ctx.beginPath();
  ctx.moveTo(x + dx * 12, y + dy * 12);
  ctx.lineTo(x + nx * 7, y + ny * 7);
  ctx.lineTo(x - nx * 7, y - ny * 7);
  ctx.closePath();
  ctx.fillStyle = '#c9ccd3';
  ctx.fill();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.stroke();
  // Fletching in the archer's colour.
  const bx = x - dx * len;
  const by = y - dy * len;
  ctx.fillStyle = color;
  for (const k of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(bx + dx * 14, by + dy * 14);
    ctx.lineTo(bx + nx * k * 9 - dx * 2, by + ny * k * 9 - dy * 2);
    ctx.lineTo(bx + dx * 2, by + dy * 2);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  r: number;
  color: string;
}

interface Pop {
  x: number;
  y: number;
  text: string;
  color: string;
  age: number;
  big: boolean;
}

/** Bursts, dust, floating points and a little screen shake. */
export class Effects {
  parts: Particle[] = [];
  pops: Pop[] = [];
  shake = 0;

  burst(x: number, y: number, color: string, n = 14, speed = 260) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random() * 0.8);
      this.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: 0.45 + Math.random() * 0.35, r: 5 + Math.random() * 7, color });
    }
  }

  dust(x: number) {
    for (let i = 0; i < 8; i++)
      this.parts.push({
        x: x + (Math.random() - 0.5) * 50,
        y: MERLON_Y + 6,
        vx: (Math.random() - 0.5) * 140,
        vy: -60 - Math.random() * 120,
        life: 0,
        max: 0.6 + Math.random() * 0.4,
        r: 8 + Math.random() * 8,
        color: '#cbbd9f',
      });
  }

  pop(x: number, y: number, text: string, color: string, big = false) {
    this.pops.push({ x, y, text, color, age: 0, big });
  }

  step(dt: number) {
    for (const p of this.parts) {
      p.life += dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 1 - dt * 3;
      p.vy = p.vy * (1 - dt * 3) + 200 * dt;
    }
    this.parts = this.parts.filter((p) => p.life < p.max);
    for (const p of this.pops) p.age += dt;
    this.pops = this.pops.filter((p) => p.age < 1.2);
    this.shake = Math.max(0, this.shake - dt * 30);
  }

  draw(ctx: Ctx) {
    for (const p of this.parts) {
      ctx.globalAlpha = 1 - p.life / p.max;
      ellipse(ctx, p.x, p.y, p.r, p.r);
      ctx.fillStyle = p.color;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of this.pops) {
      const k = p.age / 1.2;
      ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      ctx.font = `900 ${p.big ? 64 : 36}px "Fraunces Variable", Georgia, serif`;
      ctx.lineWidth = p.big ? 10 : 7;
      ctx.strokeStyle = INK;
      const y = p.y - 70 * Math.min(1, k * 2);
      ctx.strokeText(p.text, p.x, y);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, y);
    }
    ctx.globalAlpha = 1;
  }
}

/** Everything that moves, in depth order (things lower on screen are in front). */
export function drawScene(ctx: Ctx, bg: HTMLCanvasElement, sim: CastleSim, looks: ArcherLook[], fx: Effects, t: number) {
  ctx.save();
  if (fx.shake > 0) ctx.translate((Math.random() - 0.5) * fx.shake, (Math.random() - 0.5) * fx.shake);
  ctx.drawImage(bg, 0, 0);
  drawCracks(ctx, 1 - sim.wall / sim.wallMax);
  // Arrows stuck in the ground first, then walkers, then flyers.
  for (const ar of sim.arrows) if (ar.stuck >= 0) drawArrow(ctx, ar.x, ar.y, ar.dx, ar.dy, looks[ar.owner]?.color ?? '#fff', false, Math.max(0, 1 - ar.stuck / 1.4));
  const walkers = sim.monsters.filter((m) => !MONSTERS[m.kind].fly).sort((a, b) => a.y - b.y);
  const flyers = sim.monsters.filter((m) => MONSTERS[m.kind].fly).sort((a, b) => a.y - b.y);
  for (const m of walkers) drawMonster(ctx, m, t);
  for (const m of flyers) drawMonster(ctx, m, t);
  for (const ar of sim.arrows) if (ar.stuck < 0) drawArrow(ctx, ar.x, ar.y, ar.dx, ar.dy, looks[ar.owner]?.color ?? '#fff', ar.charged);
  sim.archers.forEach((a, i) => looks[i] && drawArcher(ctx, a, looks[i], t, sim.t >= a.readyAt && !sim.over));
  fx.draw(ctx);
  ctx.restore();
}

