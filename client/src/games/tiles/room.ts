/** The kitchen around the tiled floor: wooden border, wallpaper, and furniture standing in for walls. */
import {
  BoxGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  RepeatWrapping,
  type Material,
  type Texture,
} from 'three';
import { flat, noise, pixelTexture } from '../arena/kit';
import { TILE } from './logic';

type Keep = <T extends { dispose(): void }>(x: T) => T;

const unit = new BoxGeometry(1, 1, 1);
const disc = new CylinderGeometry(1, 1, 1, 12);

/** A box with its feet at y and centre at (x, z). */
function blk(parent: Group, w: number, h: number, d: number, mat: Material, x: number, y: number, z: number) {
  const m = new Mesh(unit, mat);
  m.scale.set(w, h, d);
  m.position.set(x, y + h / 2, z);
  parent.add(m);
  return m;
}

function cyl(parent: Group, r: number, h: number, mat: Material, x: number, y: number, z: number) {
  const m = new Mesh(disc, mat);
  m.scale.set(r, h, r);
  m.position.set(x, y + h / 2, z);
  parent.add(m);
  return m;
}

function tex(keep: Keep, size: number, paint: (ctx: CanvasRenderingContext2D, rnd: () => number) => void, seed: number, rx = 1, ry = rx): Texture {
  const t = keep(pixelTexture(size, paint, seed, 1));
  t.repeat.set(rx, ry);
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

const lam = (map: Texture, color = '#ffffff') => new MeshLambertMaterial({ map, color, flatShading: true });

/**
 * Builds the room around a floor of `cols × rows` tiles centred on the origin.
 * Returns the group; textures and materials are registered with `keep`.
 */
export function buildRoom(cols: number, rows: number, keep: Keep) {
  const g = new Group();
  const W = cols * TILE;
  const H = rows * TILE;
  const hx = W / 2;
  const hz = H / 2;
  const mat = <T extends Material>(m: T) => keep(m);

  const wood = mat(lam(tex(keep, 16, (ctx, r) => {
    noise(ctx, r, 16, [150, 98, 58], 22);
    ctx.fillStyle = 'rgba(50,25,10,.4)';
    ctx.fillRect(0, 0, 16, 1);
    ctx.fillRect(0, 8, 16, 1);
  }, 5, 12, 12)));
  const darkWood = mat(flat('#6a3d22'));
  const cream = mat(flat('#efe1c2'));
  const metal = mat(flat('#b8bcc4'));
  const dark = mat(flat('#2b1a14'));
  const white = mat(flat('#f6f1e4'));
  const blueGlaze = mat(new MeshBasicMaterial({ color: '#2f5fae' }));
  const red = mat(flat('#cf3a47'));

  // ---- the pit under the tiles, and the wooden border around them ---------------
  const pit = new Mesh(new PlaneGeometry(W + 2, H + 2), mat(new MeshLambertMaterial({ color: '#2a1610' })));
  pit.rotation.x = -Math.PI / 2;
  pit.position.y = -0.4;
  g.add(pit);
  const top = 0.12;
  const bw = 1.1; // border width right around the tiles
  const ext = 9;
  blk(g, W + 2 * bw + 2 * ext, 1.1 + top, ext, wood, 0, -1.1, -hz - bw - ext / 2);
  blk(g, W + 2 * bw + 2 * ext, 1.1 + top, ext, wood, 0, -1.1, hz + bw + ext / 2);
  blk(g, ext, 1.1 + top, H + 2 * bw, wood, -hx - bw - ext / 2, -1.1, 0);
  blk(g, ext, 1.1 + top, H + 2 * bw, wood, hx + bw + ext / 2, -1.1, 0);
  // Skirting frame, a little proud of the border.
  blk(g, W + 2 * bw, 0.25, bw * 0.55, darkWood, 0, 0, -hz - bw * 0.72);
  blk(g, W + 2 * bw, 0.25, bw * 0.55, darkWood, 0, 0, hz + bw * 0.72);
  blk(g, bw * 0.55, 0.25, H, darkWood, -hx - bw * 0.72, 0, 0);
  blk(g, bw * 0.55, 0.25, H, darkWood, hx + bw * 0.72, 0, 0);

  // ---- walls -------------------------------------------------------------------
  const paper = mat(lam(tex(keep, 16, (ctx, r) => {
    noise(ctx, r, 16, [240, 222, 176], 10);
    ctx.fillStyle = '#c4473a';
    for (const [x, y] of [[3, 3], [11, 11]]) {
      ctx.fillRect(x, y, 2, 2);
      ctx.fillRect(x - 1, y + 1, 4, 0);
    }
    ctx.fillStyle = '#4a7bb5';
    for (const [x, y] of [[11, 3], [3, 11]]) ctx.fillRect(x, y, 2, 2);
    ctx.fillStyle = 'rgba(120,60,30,.18)';
    ctx.fillRect(0, 7, 16, 1);
  }, 8, W / 3.2, 2.4)));
  const backZ = -hz - bw - ext + 0.5;
  const wall = new Mesh(new PlaneGeometry(W + 2 * (bw + ext), 14), paper);
  wall.position.set(0, 6.5, backZ - 0.6);
  g.add(wall);
  const sideWallMat = mat(lam(tex(keep, 16, (ctx, r) => noise(ctx, r, 16, [236, 214, 168], 10), 9, 6, 2.4)));
  for (const s of [-1, 1]) {
    const sw = new Mesh(new PlaneGeometry(H + 2 * (bw + ext) + 6, 14), sideWallMat);
    sw.rotation.y = -s * Math.PI / 2;
    sw.position.set(s * (hx + bw + ext - 0.5), 6.5, 0);
    g.add(sw);
  }

  // ---- back wall: dresser, tiled stove, window, cupboards ----------------------
  const zb = -hz - bw - 0.2; // furniture front line (towards the floor)

  // Cupboard fronts share one texture: two doors and handles.
  const doorTex = tex(keep, 16, (ctx, r) => {
    noise(ctx, r, 16, [60, 128, 140], 10);
    ctx.fillStyle = 'rgba(15,40,50,.6)';
    ctx.fillRect(0, 0, 16, 1);
    ctx.fillRect(0, 15, 16, 1);
    ctx.fillRect(0, 0, 1, 16);
    ctx.fillRect(15, 0, 1, 16);
    ctx.fillRect(7, 0, 2, 16);
    ctx.fillStyle = 'rgba(15,40,50,.35)';
    ctx.fillRect(2, 2, 5, 12);
    ctx.fillRect(9, 2, 5, 12);
    ctx.fillStyle = '#f0d58c';
    ctx.fillRect(6, 6, 1, 4);
    ctx.fillRect(9, 6, 1, 4);
  }, 21);
  const cabMat = mat(lam(doorTex));
  const counter = mat(flat('#e2cba0'));
  const cabinet = (x: number, z: number, w: number, d: number, rot = 0) => {
    const c = new Group();
    const body = blk(c, w, 2.2, d, cabMat, 0, 0, 0);
    body.position.z = 0;
    blk(c, w + 0.15, 0.2, d + 0.2, counter, 0, 2.2, 0);
    c.position.set(x, 0, z);
    c.rotation.y = rot;
    g.add(c);
    return c;
  };
  const upper = (x: number, z: number, w: number) => {
    const u = blk(g, w, 1.6, 0.9, cabMat, x, 3.6, z);
    return u;
  };

  // Layout along the back from left to right, scaled to the floor width.
  const left = -hx - bw;
  const span = W + 2 * bw;
  const place = (frac: number) => left + span * frac;
  const dz = zb - 0.9;

  // Dresser with plates (kredens).
  const dresserX = place(0.1);
  const dw = Math.min(4.2, span * 0.17);
  blk(g, dw, 4.6, 1.5, mat(flat('#9b5c34')), dresserX, 0, dz);
  blk(g, dw + 0.3, 0.2, 1.7, darkWood, dresserX, 4.6, dz);
  blk(g, dw - 0.4, 1.6, 0.1, dark, dresserX, 0.3, dz + 0.78); // lower doors (dark gap)
  for (const sx of [-1, 1]) blk(g, 0.12, 1.4, 0.1, mat(flat('#f0d58c')), dresserX + sx * 0.3, 0.4, dz + 0.84);
  for (const sy of [2.7, 3.7]) {
    blk(g, dw - 0.3, 0.1, 1.2, darkWood, dresserX, sy - 0.05, dz + 0.1);
    for (let k = 0; k < 3; k++) {
      const px = dresserX - dw / 2 + 0.7 + k * ((dw - 1.4) / 2);
      const rim = cyl(g, 0.45, 0.07, white, px, sy + 0.05, dz + 0.7);
      rim.rotation.x = Math.PI / 2 - 0.12;
      rim.position.y = sy + 0.5;
      const mid = cyl(g, 0.3, 0.09, blueGlaze, px, 0, dz + 0.7);
      mid.rotation.x = Math.PI / 2 - 0.12;
      mid.position.set(px, sy + 0.5, dz + 0.72);
    }
  }

  // Tiled stove (piec kaflowy).
  const stoveX = place(0.3);
  const sw = Math.min(3.6, span * 0.14);
  const stoveTex = tex(keep, 16, (ctx, r) => {
    noise(ctx, r, 16, [240, 238, 228], 8);
    ctx.fillStyle = '#b7c3d6';
    ctx.fillRect(0, 0, 16, 1);
    ctx.fillRect(0, 8, 16, 1);
    ctx.fillRect(0, 0, 1, 16);
    ctx.fillRect(8, 0, 1, 16);
    ctx.fillStyle = '#2f5fae';
    for (const [cx, cy] of [[4, 4], [12, 4], [4, 12], [12, 12]]) {
      ctx.fillRect(cx - 1, cy, 3, 1);
      ctx.fillRect(cx, cy - 1, 1, 3);
    }
  }, 31, 3, 4);
  const stoveMat = mat(lam(stoveTex));
  blk(g, sw, 4.8, 2.4, stoveMat, stoveX, 0, dz + 0.1);
  blk(g, sw + 0.3, 0.35, 2.7, dark, stoveX, 4.8, dz + 0.1);
  blk(g, 1.1, 0.9, 0.12, dark, stoveX, 1.4, dz + 1.35); // oven door
  blk(g, 0.9, 0.12, 0.14, metal, stoveX, 2.15, dz + 1.38);
  cyl(g, 0.4, 3.6, mat(flat('#4a4048')), stoveX + sw * 0.25, 5.1, dz - 0.3); // flue

  // Window.
  const winX = place(0.5);
  blk(g, 3.4, 3.2, 0.2, mat(flat('#5a3a22')), winX, 3.0, backZ - 0.5);
  blk(g, 2.9, 2.7, 0.22, mat(new MeshBasicMaterial({ color: '#bfe3f2' })), winX, 3.25, backZ - 0.44);
  blk(g, 0.16, 2.7, 0.26, mat(flat('#5a3a22')), winX, 3.25, backZ - 0.4);
  blk(g, 2.9, 0.16, 0.26, mat(flat('#5a3a22')), winX, 4.5, backZ - 0.4);
  const curtainTex = tex(keep, 16, (ctx) => {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 16, 16);
    ctx.fillStyle = '#d6334a';
    for (let y = 0; y < 16; y += 8) for (let x = 0; x < 16; x += 8) ctx.fillRect(x, y, 4, 4), ctx.fillRect(x + 4, y + 4, 4, 4);
  }, 33, 1, 1);
  const curtain = mat(lam(curtainTex));
  for (const s of [-1, 1]) blk(g, 0.9, 3.0, 0.3, curtain, winX + s * 1.75, 3.1, backZ - 0.35);

  // Cupboards.
  const cabW = 2.4;
  const rightStart = place(0.62);
  let cx = rightStart;
  const n = Math.max(2, Math.floor((left + span - rightStart - 0.5) / cabW));
  for (let k = 0; k < n; k++) {
    const x = cx + cabW / 2;
    cabinet(x, dz, cabW - 0.05, 1.7);
    if (k % 2 === 0) upper(x, dz - 0.4, cabW - 0.05);
    cx += cabW;
  }
  // A pot and a bowl of pierogi on the counter.
  cyl(g, 0.55, 0.8, mat(flat('#c9ccd3')), rightStart + 1.2, 2.4, dz);
  cyl(g, 0.62, 0.1, mat(flat('#8c909a')), rightStart + 1.2, 3.2, dz);
  cyl(g, 0.5, 0.2, red, rightStart + cabW * 2 + 1, 2.4, dz + 0.1);

  // ---- side walls: long cupboard runs ------------------------------------------
  for (const s of [-1, 1]) {
    const x = s * (hx + bw + 0.9);
    const len = Math.floor((H + 2 * bw - 2) / cabW);
    for (let k = 0; k < len; k++) {
      const z = -((len * cabW) / 2) + cabW * (k + 0.5) + (s > 0 ? -0.6 : 0.6);
      // The table takes the middle of the right side.
      if (s > 0 && Math.abs(z) < 2.6) continue;
      cabinet(x, z, cabW - 0.05, 1.7, -s * Math.PI / 2);
    }
  }

  // ---- table with a checked tablecloth (right side) -----------------------------
  {
    const tx = hx + bw + 2.0;
    const clothTex = tex(keep, 16, (ctx) => {
      ctx.fillStyle = '#fffaf0';
      ctx.fillRect(0, 0, 16, 16);
      ctx.fillStyle = '#d6334a';
      ctx.fillRect(0, 0, 8, 8);
      ctx.fillRect(8, 8, 8, 8);
      ctx.fillStyle = '#ee8d98';
      ctx.fillRect(8, 0, 8, 8);
      ctx.fillRect(0, 8, 8, 8);
    }, 41, 3, 3);
    const cloth = mat(lam(clothTex));
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) blk(g, 0.28, 2.0, 0.28, darkWood, tx + sx * 1.1, 0, sz * 2.0);
    blk(g, 3.2, 0.25, 5.2, darkWood, tx, 2.0, 0);
    blk(g, 3.5, 0.18, 5.5, cloth, tx, 2.25, 0);
    // Skirt hanging over the edge facing the room.
    blk(g, 0.12, 0.9, 5.5, cloth, tx - 1.75, 1.4, 0);
    cyl(g, 0.7, 0.08, white, tx - 0.4, 2.43, 0.3);
    for (let k = 0; k < 3; k++) {
      const p = new Mesh(unit, cream);
      p.scale.set(0.5, 0.3, 0.3);
      p.position.set(tx - 0.7 + k * 0.35, 2.65, 0.3);
      p.rotation.y = k * 0.5;
      g.add(p);
    }
    cyl(g, 0.4, 0.7, red, tx + 0.7, 2.43, -1.4);
    // Stools.
    for (const sz of [-3.9, 3.9]) {
      cyl(g, 0.55, 0.15, wood, tx, 1.6, sz);
      cyl(g, 0.12, 1.6, darkWood, tx, 0, sz);
    }
  }

  // ---- the doormat at the front --------------------------------------------------
  const mat1 = mat(flat('#a64b3c'));
  blk(g, 4.5, 0.08, 2.2, mat1, 0, top - 0.02, hz + bw + 2.0);
  blk(g, 3.9, 0.1, 1.6, mat(flat('#e7c887')), 0, top - 0.02, hz + bw + 2.0);
  return g;
}
