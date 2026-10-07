/**
 * Pushy Pierogi in 3D: a frozen pond in a snowy village at dusk. Same PS2 look as Maluch Rally
 * (low internal resolution, flat shading, tiny nearest-filtered textures) via the arena kit.
 */
import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  HemisphereLight,
  AmbientLight,
  IcosahedronGeometry,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  PlaneGeometry,
  Points,
  PointsMaterial,
  RingGeometry,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  CircleGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ARENA_SCALE, ArenaStage, buildPierogi, flat, groundTexture, nameTag, noise, pixelTexture, blobShadow, type PierogiModel } from '../arena/kit';
import { mulberry32 } from '../rng';
import { BIG_BUMP, FLOE_R, STONE_R, STONE_START, type Chunk, type PushyEvent, type PushySim, type Stone } from './logic';

export { ARENA_SCALE };

const TAU = Math.PI * 2;
export const WATER_Y = -0.32;
const ICE_THICK = 0.75;
const CAM_DIST = 36;
const CAM_TILT = 0.8;
const CAM_Z = 0.5;

// ---- the pond and its banks ---------------------------------------------------------------------

/** Distance from the middle of the pond to the shore in direction `a` (the shore is wobbly). */
export function bankR(a: number) {
  return 13.6 + 0.9 * Math.sin(3 * a + 0.6) + 0.6 * Math.sin(5 * a + 2.1) + 0.35 * Math.sin(9 * a + 4);
}
/** Rows of the bank, outwards from the shore: [metres from the shore, height]. */
const BANK_ROWS: [number, number][] = [
  [-0.3, -0.9],
  [0, 0.15],
  [1, 0.32],
  [5, 0.55],
  [14, 1.5],
  [34, 3.6],
  [95, 11],
];
/** Ground height at (x, z) on the bank, or WATER_Y in the pond. */
export function groundY(x: number, z: number) {
  const d = Math.hypot(x, z) - bankR(Math.atan2(z, x));
  if (d < 0) return WATER_Y;
  for (let i = 1; i < BANK_ROWS.length; i++) {
    if (d <= BANK_ROWS[i][0]) {
      const [d0, y0] = BANK_ROWS[i - 1];
      const [d1, y1] = BANK_ROWS[i];
      return y0 + ((d - d0) / (d1 - d0)) * (y1 - y0);
    }
  }
  return BANK_ROWS[BANK_ROWS.length - 1][1];
}

function bankGeometry() {
  const A = 72;
  const rnd = mulberry32(4);
  const pos: number[] = [];
  const uv: number[] = [];
  for (let row = 0; row < BANK_ROWS.length; row++) {
    for (let i = 0; i <= A; i++) {
      const a = (i / A) * TAU;
      const [d, y] = BANK_ROWS[row];
      const r = bankR(a) + d;
      const j = row >= 3 ? (rnd() - 0.5) * 0.22 * row : 0;
      pos.push(Math.cos(a) * r, y + j, Math.sin(a) * r);
      uv.push(Math.cos(a) * r * 0.16, Math.sin(a) * r * 0.16);
    }
  }
  // Close the seam: the last column copies the first one's height.
  for (let row = 0; row < BANK_ROWS.length; row++) pos[(row * (A + 1) + A) * 3 + 1] = pos[(row * (A + 1)) * 3 + 1];
  const idx: number[] = [];
  for (let row = 0; row < BANK_ROWS.length - 1; row++)
    for (let i = 0; i < A; i++) {
      const a = row * (A + 1) + i;
      const b = a + 1;
      const c = a + (A + 1);
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---- the floe ------------------------------------------------------------------------------------

/** One annular sector of ice, built around its own centre so it can tip and sink on its own. */
function chunkGeometry(c: Chunk) {
  const GAP = 0.035;
  const full = c.ring === 0;
  const r0 = full ? 0 : c.r0 + GAP;
  const r1 = c.r1 - GAP;
  const span = c.a1 - c.a0;
  const mid = (c.a0 + c.a1) / 2;
  const rm = full ? 0 : (c.r0 + c.r1) / 2;
  const cx = Math.cos(mid) * rm;
  const cz = Math.sin(mid) * rm;
  const segs = full ? 18 : Math.max(1, Math.ceil(span / 0.22));
  const pos: number[] = [];
  const uv: number[] = [];
  const col: number[] = [];
  const top = new Color('#ffffff');
  const side = new Color('#9bbdd8');
  const pt = (r: number, a: number, y: number): [number, number, number] => [Math.cos(a) * r - cx, y, Math.sin(a) * r - cz];
  const push = (p: [number, number, number], c2: Color, u?: [number, number]) => {
    pos.push(...p);
    col.push(c2.r, c2.g, c2.b);
    const wx = p[0] + cx;
    const wz = p[2] + cz;
    uv.push(u ? u[0] : (wx + FLOE_R) / (2 * FLOE_R), u ? u[1] : 1 - (wz + FLOE_R) / (2 * FLOE_R));
  };
  const quad = (a: [number, number, number], b: [number, number, number], c3: [number, number, number], d: [number, number, number], col2: Color) => {
    for (const p of [a, b, c3, a, c3, d]) push(p, col2);
  };
  const tri = (a: [number, number, number], b: [number, number, number], c3: [number, number, number], col2: Color) => {
    for (const p of [a, b, c3]) push(p, col2);
  };
  const aa = (i: number) => (full ? (i / segs) * TAU : c.a0 + (span * i) / segs + (i === 0 ? GAP / rm : i === segs ? -GAP / rm : 0));
  for (let i = 0; i < segs; i++) {
    const a0 = aa(i);
    const a1 = aa(i + 1);
    const o0 = pt(r1, a0, 0);
    const o1 = pt(r1, a1, 0);
    if (full) {
      tri(pt(0, 0, 0), o1, o0, top);
    } else {
      const i0 = pt(r0, a0, 0);
      const i1 = pt(r0, a1, 0);
      quad(i0, o0, o1, i1, top);
      // Inner wall
      quad(pt(r0, a0, -ICE_THICK), i0, i1, pt(r0, a1, -ICE_THICK), side);
    }
    // Outer wall
    quad(o0, pt(r1, a0, -ICE_THICK), pt(r1, a1, -ICE_THICK), o1, side);
  }
  if (!full) {
    for (const [a, flip] of [[aa(0), 1] as const, [aa(segs), -1] as const]) {
      const p0 = pt(r0, a, 0);
      const p1 = pt(r1, a, 0);
      const q0 = pt(r0, a, -ICE_THICK);
      const q1 = pt(r1, a, -ICE_THICK);
      if (flip > 0) quad(p0, q0, q1, p1, side);
      else quad(p1, q1, q0, p0, side);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return { geo: g, cx, cz };
}

/** Jagged crack lines across a chunk's top, as thin flat ribbons. */
function crackGeometry(c: Chunk, cx: number, cz: number, rnd: () => number) {
  const verts: number[] = [];
  const W = 0.07;
  const ribbon = (pts: [number, number][]) => {
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x0, z0] = pts[i];
      const [x1, z1] = pts[i + 1];
      const dx = x1 - x0;
      const dz = z1 - z0;
      const l = Math.hypot(dx, dz) || 1;
      const nx = (-dz / l) * W;
      const nz = (dx / l) * W;
      const y = 0.025;
      const a = [x0 + nx, y, z0 + nz];
      const b = [x0 - nx, y, z0 - nz];
      const c2 = [x1 + nx, y, z1 + nz];
      const d = [x1 - nx, y, z1 - nz];
      verts.push(...a, ...b, ...c2, ...b, ...d, ...c2);
    }
  };
  const full = c.ring === 0;
  const n = full ? 5 : 3;
  for (let k = 0; k < n; k++) {
    // Start somewhere along the outer rim and wander inwards.
    const a = full ? rnd() * TAU : c.a0 + (c.a1 - c.a0) * (0.15 + rnd() * 0.7);
    let r = full ? 2.6 : c.r1 - 0.05;
    let ang = a;
    const pts: [number, number][] = [[Math.cos(ang) * r - cx, Math.sin(ang) * r - cz]];
    const steps = 5 + Math.floor(rnd() * 3);
    for (let s = 0; s < steps; s++) {
      r -= ((c.r1 - c.r0) / steps) * (0.6 + rnd() * 0.7);
      ang += (rnd() - 0.5) * 0.18;
      if (r < c.r0 + 0.05) break;
      pts.push([Math.cos(ang) * r - cx, Math.sin(ang) * r - cz]);
    }
    ribbon(pts);
    if (pts.length > 3) {
      // A little side branch.
      const [bx, bz] = pts[2];
      const dir = rnd() < 0.5 ? 1 : -1;
      ribbon([
        [bx, bz],
        [bx + dir * 0.5, bz + 0.3 * (rnd() - 0.3)],
        [bx + dir * 0.9, bz + 0.5 * (rnd() - 0.3)],
      ]);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(verts, 3));
  return g;
}

function iceTexture() {
  return pixelTexture(
    128,
    (ctx, rnd) => {
      noise(ctx, rnd, 128, [190, 223, 244], 16);
      for (let i = 0; i < 22; i++) {
        ctx.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,.10)' : 'rgba(80,140,205,.10)';
        ctx.fillRect(rnd() * 128, rnd() * 128, 8 + rnd() * 26, 8 + rnd() * 26);
      }
      // Skate marks: long pale arcs.
      ctx.lineWidth = 1;
      for (let i = 0; i < 20; i++) {
        ctx.strokeStyle = `rgba(255,255,255,${0.35 + rnd() * 0.3})`;
        ctx.beginPath();
        const a0 = rnd() * TAU;
        ctx.arc(rnd() * 128, rnd() * 128, 18 + rnd() * 70, a0, a0 + 0.5 + rnd() * 1.2);
        ctx.stroke();
      }
      // Scratches: short darker lines.
      for (let i = 0; i < 16; i++) {
        ctx.strokeStyle = 'rgba(70,120,175,.5)';
        ctx.beginPath();
        const x = rnd() * 128;
        const y = rnd() * 128;
        ctx.moveTo(x, y);
        ctx.lineTo(x + (rnd() - 0.5) * 22, y + (rnd() - 0.5) * 22);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(255,255,255,.9)';
      for (let i = 0; i < 40; i++) ctx.fillRect(Math.floor(rnd() * 128), Math.floor(rnd() * 128), 1, 1);
    },
    11,
    1,
  );
}

function snowTexture() {
  return pixelTexture(
    16,
    (ctx, rnd) => {
      noise(ctx, rnd, 16, [236, 241, 252], 14);
      ctx.fillStyle = 'rgba(160,185,225,.35)';
      for (let i = 0; i < 6; i++) ctx.fillRect(Math.floor(rnd() * 16), Math.floor(rnd() * 16), 2, 1);
    },
    5,
    1,
  );
}

function glowTexture(inner: string) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 31);
  g.addColorStop(0, inner);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

// ---- tools ---------------------------------------------------------------------------------------

interface Part {
  alive: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
  g: number;
  r: number;
  gr: number;
  b: number;
  spin: number;
}
const PARTS = 360;

interface ChunkVis {
  chunk: Chunk;
  mesh: Mesh;
  mat: MeshLambertMaterial;
  cracks: Mesh;
  cx: number;
  cz: number;
  /** Seconds since the cracks showed (−1: not cracked) and since the chunk let go (−1: still there). */
  crackT: number;
  sinkT: number;
  tilt: Vector3;
}

interface Actor {
  unit: Group;
  lean: Group;
  model: PierogiModel;
  tag: Object3D;
  ring: Mesh;
  squash: number;
  squashV: number;
  lx: number;
  lz: number;
  /** Seconds in the water (−1: still on the ice), and the offset swum so far. */
  outT: number;
  swx: number;
  swz: number;
  landed: boolean;
  seed: number;
  trail: number;
  face: number;
}

interface StoneVis {
  group: Group;
  arrow: Mesh;
  lane: Mesh;
  body: Group;
}

export interface PushyScenePlayer {
  name: string;
  color: string;
}

export class PushyScene {
  readonly stage: ArenaStage;
  private readonly rnd = mulberry32(99);
  private t = 0;
  private shake = 0;
  private chunkVis: ChunkVis[] = [];
  private actors: Actor[] = [];
  private stoneVis = new Map<number, StoneVis>();
  private parts: Part[] = [];
  private partMesh!: InstancedMesh;
  private ripples: { mesh: Mesh; t: number; dur: number; max: number; active: boolean }[] = [];
  private flakes!: Points;
  private flakeData!: Float32Array;
  private water!: Mesh;
  private waterMap: CanvasTexture;
  private smokeT = 0;
  private dummy = new Object3D();
  private v = new Vector3();
  private floe = new Group();
  private stoneMats!: { granite: MeshLambertMaterial; band: MeshLambertMaterial; cap: MeshLambertMaterial; red: MeshLambertMaterial; yellow: MeshLambertMaterial };
  private arrowMat = new MeshBasicMaterial({ color: '#ff4a3a', side: DoubleSide });
  private laneMat = new MeshBasicMaterial({ color: '#ff5a3a', transparent: true, opacity: 0.2, depthWrite: false });
  private arrowGeo: BufferGeometry;

  constructor(
    canvas: HTMLCanvasElement,
    private players: PushyScenePlayer[],
  ) {
    const sky = '#5a5a94';
    this.stage = new ArenaStage(canvas, { sky, fog: [55, 150], fov: 40 });
    const { stage } = this;
    // Dusk lighting instead of the rally's afternoon.
    for (const l of stage.scene.children) {
      if (l instanceof HemisphereLight) {
        l.color.set('#8fb8ff');
        l.groundColor.set('#2c3a66');
        l.intensity = 1.1;
      }
      if (l instanceof AmbientLight) l.intensity = 0.5;
    }
    stage.sun.color.set('#ffb689');
    stage.sun.intensity = 1.5;
    stage.sun.position.set(-0.8, 0.9, 0.5);
    stage.lookAt(new Vector3(0, 0, CAM_Z), CAM_DIST, CAM_TILT);
    stage.scene.add(this.floe);

    this.waterMap = groundTexture('water', 22, 8);
    this.buildSky();
    this.buildWater();
    this.buildBank();
    this.buildVillage();
    this.buildFloe();
    this.buildParticles();
    this.buildSnow();
    this.buildStones();
    this.arrowGeo = this.makeArrow();
    this.buildActors();
  }

  // ---- building the world --------------------------------------------------------------------------

  private keep<T extends { dispose(): void }>(x: T) {
    return this.stage.keep(x);
  }

  private buildSky() {
    const g = this.keep(new SphereGeometry(300, 20, 10));
    const col: number[] = [];
    const top = new Color('#1b2352');
    const mid = new Color('#7a5a9e');
    const hor = new Color('#f0a077');
    const c = new Color();
    const p = g.attributes.position as BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const h = Math.max(0, p.getY(i) / 300);
      if (h < 0.18) c.copy(hor).lerp(mid, h / 0.18);
      else c.copy(mid).lerp(top, Math.min(1, (h - 0.18) / 0.5));
      col.push(c.r, c.g, c.b);
    }
    g.setAttribute('color', new Float32BufferAttribute(col, 3));
    const m = this.keep(new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false, depthWrite: false }));
    const sky = new Mesh(g, m);
    sky.renderOrder = -10;
    this.stage.scene.add(sky);
    // A moon.
    const moon = new Mesh(this.keep(new SphereGeometry(7, 8, 6)), this.keep(new MeshBasicMaterial({ color: '#fff4d6', fog: false })));
    moon.position.set(-120, 120, -230);
    this.stage.scene.add(moon);
  }

  private buildWater() {
    const geo = this.keep(new CircleGeometry(120, 28));
    geo.rotateX(-Math.PI / 2);
    const mat = this.keep(new MeshLambertMaterial({ map: this.waterMap, color: '#5d86b8', emissive: '#0b1b3a' }));
    this.water = new Mesh(geo, mat);
    this.water.position.y = WATER_Y;
    this.stage.add(this.water);
    this.keep(this.waterMap);
  }

  private buildBank() {
    const snow = this.keep(snowTexture());
    const mat = this.keep(new MeshLambertMaterial({ map: snow, color: '#aebbe0', flatShading: true, side: DoubleSide }));
    const mesh = new Mesh(this.keep(bankGeometry()), mat);
    this.stage.add(mesh);
  }

  private buildVillage() {
    const stage = this.stage;
    const wood = this.keep(groundTexture('wood', 1, 4));
    const woodMat = this.keep(new MeshLambertMaterial({ map: wood, color: '#b98a60', flatShading: true }));
    const darkWood = flat('#5b3a26');
    const roofMat = flat('#8c3b36');
    const snowMat = flat('#f4f7ff');
    const warm = new MeshBasicMaterial({ color: '#ffd37a' });
    this.keep(darkWood);
    this.keep(roofMat);
    this.keep(snowMat);
    this.keep(warm);

    // Hut on the far shore, facing the pond.
    const hut = new Group();
    const base = groundY(-15, -17.5);
    hut.position.set(-15, base - 0.1, -17.5);
    hut.rotation.y = 0.22;
    const walls = new Mesh(this.keep(new BoxGeometry(8, 3.6, 5.6)), woodMat);
    walls.position.y = 1.8;
    hut.add(walls);
    // log ends: a few horizontal beams on the front to read as logs
    for (let k = 0; k < 4; k++) {
      const beam = new Mesh(this.keep(new BoxGeometry(8.3, 0.18, 0.2)), darkWood);
      beam.position.set(0, 0.5 + k * 0.9, 2.8);
      hut.add(beam);
    }
    // roof: two slabs
    for (const s of [-1, 1]) {
      const slab = new Mesh(this.keep(new BoxGeometry(9.2, 0.35, 4.2)), roofMat);
      slab.position.set(0, 4.35, s * 1.85);
      slab.rotation.x = s * 0.62;
      hut.add(slab);
      const cap = new Mesh(this.keep(new BoxGeometry(9.3, 0.3, 3.9)), snowMat);
      cap.position.set(0, 4.62, s * 1.8);
      cap.rotation.x = s * 0.62;
      hut.add(cap);
    }
    const gable = new Mesh(this.keep(new ConeGeometry(3.4, 2.3, 4)), woodMat);
    gable.rotation.y = Math.PI / 4;
    gable.scale.set(1.2, 1, 0.35);
    gable.position.set(0, 4.8, 2.7);
    hut.add(gable);
    // chimney
    const chim = new Mesh(this.keep(new BoxGeometry(0.9, 2.4, 0.9)), flat('#8a7f78'));
    chim.position.set(2.2, 5.2, -0.8);
    hut.add(chim);
    const chimCap = new Mesh(this.keep(new BoxGeometry(1.05, 0.25, 1.05)), snowMat);
    chimCap.position.set(2.2, 6.45, -0.8);
    hut.add(chimCap);
    // windows and door on the +z face
    for (const x of [-2.4, 2.4]) {
      const w = new Mesh(this.keep(new PlaneGeometry(1.5, 1.2)), warm);
      w.position.set(x, 2.0, 2.82);
      hut.add(w);
      const frameH = new Mesh(this.keep(new BoxGeometry(1.7, 0.12, 0.1)), darkWood);
      frameH.position.set(x, 2.0, 2.84);
      const frameV = new Mesh(this.keep(new BoxGeometry(0.12, 1.4, 0.1)), darkWood);
      frameV.position.set(x, 2.0, 2.84);
      const sill = new Mesh(this.keep(new BoxGeometry(1.9, 0.12, 0.3)), snowMat);
      sill.position.set(x, 1.35, 2.9);
      hut.add(frameH, frameV, sill);
    }
    const door = new Mesh(this.keep(new BoxGeometry(1.3, 2.3, 0.15)), darkWood);
    door.position.set(0, 1.15, 2.82);
    hut.add(door);
    const knob = new Mesh(this.keep(new SphereGeometry(0.08, 4, 3)), warm);
    knob.position.set(0.4, 1.1, 2.93);
    hut.add(knob);
    stage.add(hut);
    // warm light spilling on the snow
    const glowTex = this.keep(glowTexture('rgba(255,200,110,0.9)'));
    const glow = new Mesh(
      this.keep(new PlaneGeometry(13, 8)),
      this.keep(new MeshBasicMaterial({ map: glowTex, transparent: true, opacity: 0.55, blending: AdditiveBlending, depthWrite: false, fog: false })),
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(-13.8, groundY(-13.8, -12.2) + 0.12, -12.2);
    stage.add(glow);
    this.chimney = new Vector3(-15 + 2.2 * Math.cos(0.22) - 0.8 * Math.sin(0.22), base + 6.7, -17.5 - 2.2 * Math.sin(0.22) - 0.8 * Math.cos(0.22));

    // Pine trees, one instanced mesh each for trunks, needles and snow.
    const rnd = mulberry32(21);
    const cone = (r: number, h: number, y: number) => {
      const g = new ConeGeometry(r, h, 7);
      g.translate(0, y + h / 2, 0);
      return g;
    };
    const needles = mergeGeometries([cone(1.7, 2.3, 1.1), cone(1.3, 2.1, 2.5), cone(0.9, 1.9, 3.8)])!;
    const caps = mergeGeometries([cone(1.18, 1.0, 2.35), cone(0.92, 0.95, 3.6), cone(0.62, 0.9, 4.85)])!;
    const trunk = new CylinderGeometry(0.28, 0.36, 1.3, 6);
    trunk.translate(0, 0.65, 0);
    this.keep(needles);
    this.keep(caps);
    this.keep(trunk);
    const spots: { x: number; z: number; s: number }[] = [];
    let guard = 0;
    while (spots.length < 46 && guard++ < 800) {
      const a = rnd() * TAU;
      const r = 19 + rnd() * 30;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (z > 9) continue;
      if (z > 0 && Math.abs(x) < 24) continue;
      if (Math.hypot(x + 15, z + 17.5) < 8) continue;
      if (spots.some((p) => Math.hypot(p.x - x, p.z - z) < 4)) continue;
      spots.push({ x, z, s: 0.75 + rnd() * 0.8 });
    }
    const treeMat = this.keep(new MeshLambertMaterial({ color: '#ffffff', flatShading: true }));
    const trunkMat = this.keep(new MeshLambertMaterial({ color: '#5b3a26', flatShading: true }));
    const capMat = this.keep(new MeshLambertMaterial({ color: '#f7f9ff', flatShading: true }));
    const foliage = new InstancedMesh(needles, treeMat, spots.length);
    const snowCaps = new InstancedMesh(caps, capMat, spots.length);
    const trunks = new InstancedMesh(trunk, trunkMat, spots.length);
    const col = new Color();
    spots.forEach((sp, i) => {
      const y = groundY(sp.x, sp.z) - 0.15;
      this.dummy.position.set(sp.x, y, sp.z);
      this.dummy.rotation.set(0, rnd() * TAU, 0);
      this.dummy.scale.set(sp.s, sp.s * (0.9 + rnd() * 0.3), sp.s);
      this.dummy.updateMatrix();
      foliage.setMatrixAt(i, this.dummy.matrix);
      snowCaps.setMatrixAt(i, this.dummy.matrix);
      trunks.setMatrixAt(i, this.dummy.matrix);
      col.set('#2f6b4a').offsetHSL((rnd() - 0.5) * 0.04, 0, (rnd() - 0.5) * 0.08);
      foliage.setColorAt(i, col);
    });
    stage.add(foliage, snowCaps, trunks);

    // Rocks / drifts
    const rockGeo = this.keep(new IcosahedronGeometry(1, 0));
    const rockMat = this.keep(new MeshLambertMaterial({ color: '#e8eefb', flatShading: true }));
    const rocks = new InstancedMesh(rockGeo, rockMat, 14);
    for (let i = 0; i < 14; i++) {
      const a = rnd() * TAU;
      const x = Math.cos(a) * (bankR(a) + 1.5 + rnd() * 3);
      const z = Math.sin(a) * (bankR(a) + 1.5 + rnd() * 3);
      this.dummy.position.set(x, groundY(x, z) + 0.1, z);
      this.dummy.rotation.set(rnd(), rnd() * TAU, rnd());
      const s = 0.5 + rnd() * 1.0;
      this.dummy.scale.set(s * 1.4, s * 0.7, s);
      this.dummy.updateMatrix();
      rocks.setMatrixAt(i, this.dummy.matrix);
    }
    stage.add(rocks);

    // A snowman on the near bank (right), looking at the fight.
    const sm = new Group();
    const wx = 15.5;
    const wz = 7.5;
    sm.position.set(wx, groundY(wx, wz), wz);
    sm.rotation.y = -2.2;
    const white = flat('#f8fbff');
    this.keep(white);
    const parts: [number, number, number][] = [
      [0.8, 0.75, 0],
      [0.6, 1.8, 0],
      [0.42, 2.65, 0],
    ];
    for (const [r, y] of parts) {
      const b = new Mesh(this.keep(new IcosahedronGeometry(r, 1)), white);
      b.position.y = y;
      sm.add(b);
    }
    const carrot = new Mesh(this.keep(new ConeGeometry(0.08, 0.45, 5)), flat('#ff8a2b'));
    carrot.rotation.x = Math.PI / 2;
    carrot.position.set(0, 2.65, 0.5);
    const scarf = new Mesh(this.keep(new CylinderGeometry(0.46, 0.46, 0.14, 8)), flat('#d8283a'));
    scarf.position.y = 2.27;
    const hat = new Mesh(this.keep(new CylinderGeometry(0.3, 0.34, 0.36, 8)), flat('#2a2530'));
    hat.position.y = 3.15;
    const eyeMat = flat('#1d0f0a');
    for (const x of [-0.14, 0.14]) {
      const e = new Mesh(this.keep(new SphereGeometry(0.05, 4, 3)), eyeMat);
      e.position.set(x, 2.76, 0.37);
      sm.add(e);
    }
    sm.add(carrot, scarf, hat);
    stage.add(sm);

    // Lamp posts with warm bulbs.
    for (const [x, z] of [
      [-16.5, -4.5],
      [17.5, -9],
    ]) {
      const lamp = new Group();
      lamp.position.set(x, groundY(x, z), z);
      const pole = new Mesh(this.keep(new CylinderGeometry(0.1, 0.13, 3.6, 5)), darkWood);
      pole.position.y = 1.8;
      const bulb = new Mesh(this.keep(new SphereGeometry(0.34, 6, 4)), warm);
      bulb.position.y = 3.8;
      const capL = new Mesh(this.keep(new ConeGeometry(0.5, 0.35, 6)), snowMat);
      capL.position.y = 4.25;
      const halo = new Mesh(
        this.keep(new PlaneGeometry(6, 6)),
        this.keep(new MeshBasicMaterial({ map: glowTex, transparent: true, opacity: 0.5, blending: AdditiveBlending, depthWrite: false, fog: false })),
      );
      halo.rotation.x = -Math.PI / 2;
      halo.position.y = 0.2;
      lamp.add(pole, bulb, capL, halo);
      stage.add(lamp);
    }

    // A little wooden jetty on the left.
    const jetty = new Group();
    const jx = -(bankR(Math.PI) + 0.3);
    jetty.position.set(jx, 0.18, 4);
    for (let k = 0; k < 6; k++) {
      const plank = new Mesh(this.keep(new BoxGeometry(0.55, 0.1, 1.6)), woodMat);
      plank.position.set(k * 0.62 + 0.3, 0, 0);
      jetty.add(plank);
    }
    for (const z of [-0.7, 0.7]) {
      const post = new Mesh(this.keep(new CylinderGeometry(0.08, 0.08, 1.2, 5)), darkWood);
      post.position.set(3.5, -0.3, z);
      jetty.add(post);
    }
    jetty.rotation.y = 0;
    jetty.scale.x = -1;
    stage.add(jetty);
  }
  private chimney = new Vector3();

  private buildFloe() {
    const rnd = mulberry32(31);
    const tex = this.keep(iceTexture());
    // The chunks come from the sim, but the layout is built when a round is set up.
    this.iceTex = tex;
    this.crackRnd = rnd;
    this.crackMat = this.keep(new MeshBasicMaterial({ color: '#1d3b5e', side: DoubleSide }));
  }
  private iceTex!: CanvasTexture;
  private crackRnd!: () => number;
  private crackMat!: MeshBasicMaterial;

  private buildParticles() {
    const geo = this.keep(new IcosahedronGeometry(0.5, 0));
    const mat = this.keep(new MeshBasicMaterial({ color: '#ffffff' }));
    this.partMesh = new InstancedMesh(geo, mat, PARTS);
    this.partMesh.frustumCulled = false;
    for (let i = 0; i < PARTS; i++) {
      this.parts.push({ alive: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 0.2, g: 9, r: 1, gr: 1, b: 1, spin: 0 });
      this.partMesh.setColorAt(i, new Color(1, 1, 1));
      this.dummy.scale.set(0, 0, 0);
      this.dummy.updateMatrix();
      this.partMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.stage.add(this.partMesh);
    const ringGeo = this.keep(new RingGeometry(0.82, 1, 24));
    ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 14; i++) {
      const m = new Mesh(ringGeo, this.keep(new MeshBasicMaterial({ color: '#e8f6ff', transparent: true, opacity: 0, depthWrite: false })));
      m.visible = false;
      this.stage.add(m);
      this.ripples.push({ mesh: m, t: 0, dur: 1, max: 3, active: false });
    }
  }

  private buildSnow() {
    const N = 260;
    this.flakeData = new Float32Array(N * 4);
    const pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      this.flakeData[i * 4] = (this.rnd() - 0.5) * 70;
      this.flakeData[i * 4 + 1] = this.rnd() * 22;
      this.flakeData[i * 4 + 2] = (this.rnd() - 0.5) * 50;
      this.flakeData[i * 4 + 3] = 1.2 + this.rnd() * 1.4;
    }
    const g = this.keep(new BufferGeometry());
    g.setAttribute('position', new BufferAttribute(pos, 3));
    const m = this.keep(new PointsMaterial({ color: '#ffffff', size: 0.2, sizeAttenuation: true, fog: false }));
    this.flakes = new Points(g, m);
    this.flakes.frustumCulled = false;
    this.stage.add(this.flakes);
  }

  private buildStones() {
    const granite = this.keep(
      new MeshLambertMaterial({
        map: this.keep(pixelTexture(16, (ctx, rnd) => noise(ctx, rnd, 16, [128, 130, 140], 60), 9, 2)),
        color: '#b4b6c0',
        flatShading: true,
      }),
    );
    this.stoneMats = {
      granite,
      band: this.keep(flat('#575963')),
      cap: this.keep(flat('#9c9ea8')),
      red: this.keep(flat('#d8283a')),
      yellow: this.keep(flat('#ffd23f')),
    };
  }

  private makeArrow() {
    const s = new Shape();
    s.moveTo(0, 2.2);
    s.lineTo(1.6, 0.2);
    s.lineTo(0.6, 0.2);
    s.lineTo(0.6, -1.6);
    s.lineTo(-0.6, -1.6);
    s.lineTo(-0.6, 0.2);
    s.lineTo(-1.6, 0.2);
    s.closePath();
    const g = new ShapeGeometry(s);
    g.rotateX(-Math.PI / 2); // lies flat; the tip points to -z
    return this.keep(g);
  }

  private buildActors() {
    const ringGeo = this.keep(new RingGeometry(0.95, 1.3, 20));
    ringGeo.rotateX(-Math.PI / 2);
    const bladeGeo = this.keep(new BoxGeometry(0.07, 0.06, 0.8));
    const bladeMat = this.keep(new MeshBasicMaterial({ color: '#e6edf5' }));
    const hatGeo = this.keep(new ConeGeometry(0.3, 0.6, 7));
    const bandGeo = this.keep(new CylinderGeometry(0.31, 0.33, 0.12, 7));
    const pomGeo = this.keep(new IcosahedronGeometry(0.11, 0));
    const cream = this.keep(flat('#fff4dc'));
    this.players.forEach((p, i) => {
      const model = buildPierogi(p.color);
      for (const m of model.mats.slice(0, 2)) (m as MeshLambertMaterial).emissive.set(p.color).multiplyScalar(0.28);
      const unit = new Group();
      const lean = new Group();
      model.root.remove(model.shadow);
      model.shadow.scale.set(1.15, 0.8, 1);
      unit.add(model.shadow);
      lean.add(model.root);
      model.root.scale.setScalar(1.12);
      lean.position.y = 0.05;
      unit.add(lean);
      for (const x of [-0.34, 0.34]) {
        const b = new Mesh(bladeGeo, bladeMat);
        b.position.set(x, 0.0, 0);
        model.body.add(b);
      }
      // Knitted hat: a cone in a darker shade with a cream band and a pompom.
      const hatMat = this.keep(flat(new Color(p.color).multiplyScalar(0.55).getStyle()));
      const hat = new Group();
      const cone = new Mesh(hatGeo, hatMat);
      cone.position.y = 0.3;
      const band = new Mesh(bandGeo, cream);
      band.position.y = 0.04;
      const pom = new Mesh(pomGeo, cream);
      pom.position.y = 0.64;
      hat.add(cone, band, pom);
      hat.position.set(0.08, 0.86, -0.06);
      hat.rotation.set(-0.12, 0, -0.28);
      model.body.add(hat);
      const tag = nameTag(p.name, p.color, 3.4);
      tag.position.y = 2.15;
      unit.add(tag);
      const ring = new Mesh(ringGeo, this.keep(new MeshBasicMaterial({ color: '#4f9dff', transparent: true, opacity: 0.8, depthWrite: false })));
      ring.position.y = 0.07;
      ring.visible = false;
      unit.add(ring);
      this.stage.add(unit);
      this.actors.push({ unit, lean, model, tag, ring, squash: 0, squashV: 0, lx: 0, lz: 0, outT: -1, swx: 0, swz: 0, landed: false, seed: i * 1.7, trail: 0, face: 0 });
    });
  }

  // ---- per round -------------------------------------------------------------------------------------

  setup(sim: PushySim) {
    for (const cv of this.chunkVis) {
      this.floe.remove(cv.mesh);
      cv.mesh.geometry.dispose();
      cv.mat.dispose();
      cv.cracks.geometry.dispose();
    }
    this.chunkVis = [];
    for (const c of sim.chunks) {
      const { geo, cx, cz } = chunkGeometry(c);
      const mat = new MeshLambertMaterial({ map: this.iceTex, color: '#dff8ff', emissive: '#0b2a3d', vertexColors: true, flatShading: true, side: DoubleSide });
      const mesh = new Mesh(geo, mat);
      mesh.position.set(cx, 0, cz);
      const cracks = new Mesh(crackGeometry(c, cx, cz, this.crackRnd), this.crackMat);
      cracks.visible = false;
      mesh.add(cracks);
      this.floe.add(mesh);
      this.chunkVis.push({ chunk: c, mesh, mat, cracks, cx, cz, crackT: -1, sinkT: -1, tilt: new Vector3(this.crackRnd() - 0.5, 0, this.crackRnd() - 0.5) });
    }
    for (const sv of this.stoneVis.values()) {
      this.stage.world.remove(sv.group);
      sv.group.traverse((o) => {
        const m = o as Mesh;
        if (m.isMesh && m.geometry && m.geometry !== this.arrowGeo) m.geometry.dispose?.();
      });
    }
    this.stoneVis.clear();
    for (const p of this.parts) p.alive = false;
    for (const r of this.ripples) {
      r.active = false;
      r.mesh.visible = false;
    }
    this.actors.forEach((a, i) => {
      a.outT = -1;
      a.swx = a.swz = 0;
      a.landed = false;
      a.squash = a.squashV = 0;
      a.lx = a.lz = 0;
      a.trail = 0;
      a.unit.visible = !sim.players[i]?.removed;
      a.model.body.scale.set(1, 1, 1);
      a.model.body.rotation.set(0, 0, 0);
      a.lean.quaternion.identity();
      a.face = sim.players[i]?.face ?? 0;
      a.model.root.rotation.y = a.face;
      const p = sim.players[i];
      if (p) a.unit.position.set(p.x, 0, p.z);
    });
    this.shake = 0;
  }

  // ---- events ----------------------------------------------------------------------------------------

  handle(events: PushyEvent[], sim: PushySim) {
    for (const e of events) {
      switch (e.k) {
        case 'bump': {
          const big = e.power >= BIG_BUMP;
          const n = Math.min(26, Math.round(4 + e.power * 1.6));
          this.burst(e.x, 0.5, e.z, n, 2 + e.power * 0.5, [0.85, 0.95, 1], 0.2, 3.5, 0.6, 10);
          if (big) this.burst(e.x, 0.6, e.z, 5, 3, [1, 1, 1], 0.32, 2, 0.5, 8);
          const k = Math.min(0.5, e.power / 22);
          this.actors[e.a].squashV += k * 14;
          this.actors[e.b].squashV += k * 14;
          if (big) this.shake = Math.min(1, this.shake + e.power / 26);
          break;
        }
        case 'stoneHit': {
          this.burst(e.x, 0.6, e.z, 22, 6, [0.88, 0.94, 1], 0.28, 4, 0.7, 10);
          this.actors[e.i].squashV += 7;
          this.shake = Math.min(1, this.shake + 0.5);
          break;
        }
        case 'shove': {
          const p = sim.players[e.i];
          this.burst(p.x, 0.15, p.z, 8, 3.5, [0.9, 0.97, 1], 0.16, 1.2, 0.4, 8, -Math.sin(p.face), -Math.cos(p.face));
          this.actors[e.i].squashV -= 5;
          break;
        }
        case 'brace': {
          const p = sim.players[e.i];
          const sp = Math.hypot(p.vx, p.vz);
          const dx = sp > 0.1 ? p.vx / sp : Math.sin(p.face);
          const dz = sp > 0.1 ? p.vz / sp : Math.cos(p.face);
          if (sp > 1.2) {
            // Skate stop: a spray of ice flying out sideways.
            for (const side of [-1, 1]) this.burst(p.x, 0.12, p.z, 7, 4 + sp * 0.4, [0.9, 0.98, 1], 0.18, 1.6, 0.5, 9, -dz * side + dx * 0.3, dx * side + dz * 0.3);
          } else this.burst(p.x, 0.12, p.z, 6, 2, [0.9, 0.98, 1], 0.15, 1.2, 0.4, 8);
          this.actors[e.i].squashV += 4;
          break;
        }
        case 'crack': {
          const cv = this.chunkVis[e.c];
          cv.crackT = 0;
          cv.cracks.visible = true;
          const mid = (cv.chunk.a0 + cv.chunk.a1) / 2;
          const rm = (cv.chunk.r0 + cv.chunk.r1) / 2;
          this.burst(Math.cos(mid) * rm, 0.1, Math.sin(mid) * rm, 6, 2, [0.85, 0.93, 1], 0.14, 2, 0.5, 9);
          break;
        }
        case 'break': {
          const cv = this.chunkVis[e.c];
          cv.sinkT = 0;
          const c = cv.chunk;
          const n = 10;
          for (let k = 0; k < n; k++) {
            const a = c.a0 + ((c.a1 - c.a0) * (k + 0.5)) / n;
            const r = (c.r0 + c.r1) / 2 + (k % 2 ? 0.7 : -0.7);
            this.burst(Math.cos(a) * r, -0.2, Math.sin(a) * r, 2, 3.5, [0.7, 0.88, 1], 0.2, 5, 0.8, 11);
          }
          const mid = (c.a0 + c.a1) / 2;
          const rm = (c.r0 + c.r1) / 2;
          this.ripple(Math.cos(mid) * rm, Math.sin(mid) * rm, 5.5 + (c.r1 - c.r0), 1.8);
          this.shake = Math.min(1, this.shake + 0.12);
          break;
        }
        case 'fall': {
          const a = this.actors[e.i];
          a.outT = 0;
          a.landed = false;
          a.squashV += 4;
          break;
        }
        case 'splash': {
          const p = sim.players[e.i];
          this.burst(p.x, -0.2, p.z, 20, 5, [0.75, 0.9, 1], 0.26, 7, 0.9, 12);
          this.burst(p.x, -0.2, p.z, 8, 3, [1, 1, 1], 0.34, 5, 0.8, 10);
          this.ripple(p.x, p.z, 3.2, 1.3);
          this.ripple(p.x, p.z, 2.0, 0.9);
          break;
        }
      }
    }
  }

  // ---- particles -----------------------------------------------------------------------------------------

  /** Throw `n` bits from a point. `dirx/dirz`, if given, bias the sideways direction. */
  burst(x: number, y: number, z: number, n: number, speed: number, rgb: [number, number, number], size: number, up: number, life: number, gravity: number, dirx = 0, dirz = 0) {
    for (let k = 0; k < n; k++) {
      const p = this.parts.find((q) => !q.alive);
      if (!p) return;
      const a = this.rnd() * TAU;
      const s = speed * (0.35 + this.rnd() * 0.65);
      p.alive = true;
      p.x = x + (this.rnd() - 0.5) * 0.3;
      p.y = y;
      p.z = z + (this.rnd() - 0.5) * 0.3;
      p.vx = Math.cos(a) * s + dirx * speed * 0.6;
      p.vz = Math.sin(a) * s + dirz * speed * 0.6;
      p.vy = up * (0.4 + this.rnd() * 0.8);
      p.life = p.max = life * (0.6 + this.rnd() * 0.6);
      p.size = size * (0.6 + this.rnd() * 0.8);
      p.g = gravity;
      p.r = rgb[0];
      p.gr = rgb[1];
      p.b = rgb[2];
      p.spin = this.rnd() * TAU;
    }
  }

  private ripple(x: number, z: number, max: number, dur: number) {
    const r = this.ripples.find((q) => !q.active) ?? this.ripples[0];
    r.active = true;
    r.t = 0;
    r.dur = dur;
    r.max = max;
    r.mesh.position.set(x, WATER_Y + 0.04, z);
    r.mesh.visible = true;
  }

  // ---- frame -------------------------------------------------------------------------------------------------

  /** Where the actor is on the 1920×1080 stage (for DOM labels). */
  labelAt(x: number, y: number, z: number) {
    return this.stage.toStage(this.v.set(x, y, z));
  }

  actorPos(i: number) {
    const u = this.actors[i].unit.position;
    return { x: u.x, z: u.z };
  }

  render(sim: PushySim, dt: number) {
    this.t += dt;
    const t = this.t;
    // water drifts
    this.waterMap.offset.set(t * 0.012, t * 0.007);
    this.updateChunks(dt);
    this.updateActors(sim, dt);
    this.updateStones(sim, dt);
    this.updateParts(dt);
    this.updateRipples(dt);
    this.updateSnow(dt);
    // chimney smoke
    this.smokeT -= dt;
    if (this.smokeT <= 0) {
      this.smokeT = 0.45;
      const p = this.parts.find((q) => !q.alive);
      if (p) {
        p.alive = true;
        p.x = this.chimney.x + (this.rnd() - 0.5) * 0.3;
        p.y = this.chimney.y;
        p.z = this.chimney.z;
        p.vx = 0.5 + this.rnd() * 0.4;
        p.vz = 0.1;
        p.vy = 1.1;
        p.life = p.max = 3.2;
        p.size = 0.9;
        p.g = -0.1;
        p.r = p.gr = p.b = 0.78;
        p.spin = 0;
      }
    }
    // camera
    this.shake = Math.max(0, this.shake - dt * 2.4);
    const sh = this.shake * this.shake;
    this.stage.lookAt(this.v.set((this.rnd() - 0.5) * sh * 1.2, 0, CAM_Z + (this.rnd() - 0.5) * sh * 1.2), CAM_DIST, CAM_TILT);
    this.stage.render();
  }

  private updateChunks(dt: number) {
    for (const cv of this.chunkVis) {
      if (cv.sinkT >= 0) {
        cv.sinkT += dt;
        const s = cv.sinkT;
        cv.mesh.position.y = -(s * s * 3.2) - s * 0.5;
        cv.mesh.rotation.set(cv.tilt.x * s * 1.6, 0, cv.tilt.z * s * 1.6);
        cv.mat.emissive.setRGB(0, 0, 0);
        if (s > 1.5) cv.mesh.visible = false;
        continue;
      }
      if (cv.crackT >= 0) {
        cv.crackT += dt;
        // Flash faster and faster, and shiver.
        const rate = 4 + cv.crackT * 4;
        const f = (Math.sin(cv.crackT * rate * Math.PI) + 1) / 2;
        cv.mat.emissive.setRGB(f * 0.55, f * 0.18, f * 0.12);
        const sh = Math.min(1, cv.crackT / 2) * 0.035;
        cv.mesh.position.set(cv.cx + (this.rnd() - 0.5) * sh, -0.02 * Math.min(1, cv.crackT / 2), cv.cz + (this.rnd() - 0.5) * sh);
      }
    }
  }

  private updateActors(sim: PushySim, dt: number) {
    const t = this.t;
    this.actors.forEach((a, i) => {
      const p = sim.players[i];
      if (!p || p.removed) {
        a.unit.visible = false;
        return;
      }
      a.unit.visible = true;
      const speed = Math.hypot(p.vx, p.vz);
      // Face angle: smooth the sim's.
      let d = p.face - a.face;
      d = ((((d % TAU) + 3 * Math.PI) % TAU) - Math.PI);
      a.face += d * Math.min(1, dt * 18);
      a.model.root.rotation.y = a.face;
      // squash spring
      a.squashV += (-a.squash * 220 - a.squashV * 14) * dt;
      a.squash += a.squashV * dt;
      a.squash = Math.max(-0.4, Math.min(0.5, a.squash));

      if (a.outT < 0) {
        // On the ice.
        const braced = sim.isBraced(i);
        const dashing = sim.isDashing(i);
        a.unit.position.set(p.x, 0, p.z);
        // lean into the way we are sliding
        const k = 0.05;
        const tx = Math.max(-0.35, Math.min(0.35, p.vx * k));
        const tz = Math.max(-0.35, Math.min(0.35, p.vz * k));
        a.lx += (tx - a.lx) * Math.min(1, dt * 8);
        a.lz += (tz - a.lz) * Math.min(1, dt * 8);
        const ang = Math.hypot(a.lx, a.lz);
        if (ang > 1e-4) {
          this.v.set(a.lz / ang, 0, -a.lx / ang);
          a.lean.quaternion.setFromAxisAngle(this.v, ang);
        } else a.lean.quaternion.identity();
        const sq = a.squash;
        let sx = 1 + sq * 0.5;
        let sy = 1 - sq;
        let sz = 1 + sq * 0.5;
        if (braced) {
          sx *= 1.14;
          sz *= 1.14;
          sy *= 0.84;
        } else if (dashing) {
          sz *= 1.22;
          sy *= 0.9;
          sx *= 0.92;
        }
        a.model.body.scale.set(sx, sy, sz);
        a.model.body.rotation.z = braced ? Math.sin(t * 60 + a.seed) * 0.03 : Math.sin(t * 2 + a.seed) * 0.02;
        a.ring.visible = braced;
        if (braced) {
          const pulse = 1 + Math.sin(t * 14) * 0.06;
          a.ring.scale.set(pulse, 1, pulse);
          (a.ring.material as MeshBasicMaterial).opacity = 0.55 + Math.sin(t * 10) * 0.2;
        }
        // trail of ice dust when dashing / sliding fast
        a.trail -= dt;
        if (a.trail <= 0 && (dashing || speed > 6.2)) {
          a.trail = dashing ? 0.03 : 0.09;
          this.burst(p.x, 0.12, p.z, 1, 0.8, [0.9, 0.97, 1], dashing ? 0.2 : 0.13, 0.5, 0.45, 4, -p.vx / (speed + 1) * 0.5, -p.vz / (speed + 1) * 0.5);
        }
        a.model.shadow.visible = true;
        a.unit.rotation.set(0, 0, 0);
      } else {
        this.updateSwimmer(sim, a, i, dt);
      }
    });
  }

  /** A pierogi in the pond: slips in, bobs, paddles to the bank and climbs out. */
  private updateSwimmer(sim: PushySim, a: Actor, i: number, dt: number) {
    const p = sim.players[i];
    a.outT += dt;
    const s = a.outT;
    a.ring.visible = false;
    a.model.body.scale.set(1 + a.squash * 0.4, 1 - a.squash * 0.4, 1 + a.squash * 0.4);
    let x = p.x + a.swx;
    let z = p.z + a.swz;
    const r = Math.hypot(x, z) || 1;
    const ang = Math.atan2(z, x);
    const shore = bankR(ang) - 0.35;
    let y: number;
    let tilt = 0;
    if (s < 0.35) {
      // slipping over the edge
      const k = s / 0.35;
      y = -0.3 * k * k;
      tilt = k * 0.9;
    } else if (!a.landed) {
      const ss = s - 0.35;
      // bob
      const bob = Math.sin(ss * 5 + a.seed) * 0.07;
      y = WATER_Y - 0.5 + bob + Math.min(1, ss / 0.3) * 0.0;
      tilt = 0.25 + Math.sin(ss * 4 + a.seed) * 0.12;
      if (ss > 0.9 && r < shore) {
        // swim towards the nearest bank point
        const sp = 1.7 * dt;
        a.swx += (x / r) * sp;
        a.swz += (z / r) * sp;
        x = p.x + a.swx;
        z = p.z + a.swz;
        if (Math.random() < 0.15) this.burst(x, WATER_Y, z, 1, 1, [0.8, 0.92, 1], 0.12, 1.2, 0.4, 7);
      } else if (r >= shore) a.landed = true;
    } else {
      // climb out and wait on the bank
      const gy = groundY(x, z);
      y = y0(a, gy, dt);
      tilt = 0;
    }
    a.unit.position.set(x, y, z);
    a.model.shadow.visible = a.landed;
    // face the floe when out, face outward while swimming
    const target = a.landed ? Math.atan2(-x, -z) : Math.atan2(x, z);
    let d = target - a.face;
    d = ((((d % TAU) + 3 * Math.PI) % TAU) - Math.PI);
    a.face += d * Math.min(1, dt * 5);
    a.model.root.rotation.y = a.face;
    a.lean.quaternion.setFromAxisAngle(this.v.set(Math.cos(a.face), 0, -Math.sin(a.face)), -tilt);
    a.model.body.rotation.z = a.landed ? Math.sin(this.t * 3 + a.seed) * 0.05 : Math.sin(s * 9 + a.seed) * 0.15;
  }

  private updateStones(sim: PushySim, dt: number) {
    for (const s of sim.stones) {
      let sv = this.stoneVis.get(s.id);
      if (!sv) {
        sv = this.makeStone(s);
        this.stoneVis.set(s.id, sv);
      }
      const warn = !s.running && !s.done;
      sv.arrow.visible = warn;
      sv.lane.visible = warn || (s.running && !s.done);
      sv.body.visible = s.running && !s.done;
      if (warn) {
        const pulse = 1 + Math.sin(this.t * 14) * 0.12;
        sv.arrow.scale.set(pulse, 1, pulse);
        this.laneMat.opacity = 0.14 + (Math.sin(this.t * 14) + 1) * 0.07;
      } else if (s.running) {
        sv.body.position.set(s.x, groundY(s.x, s.z) < 0 ? 0.2 : Math.max(0.2, groundY(s.x, s.z) + 0.2), s.z);
        sv.body.rotation.y = s.spin;
        this.laneMat.opacity = 0.1;
        // frosty trail
        if (Math.random() < 0.5 && Math.hypot(s.x, s.z) < FLOE_R + 1) this.burst(s.x, 0.1, s.z, 1, 1, [0.9, 0.97, 1], 0.15, 0.6, 0.4, 4);
      }
      void dt;
    }
  }

  private makeStone(s: Stone): StoneVis {
    const g = new Group();
    this.stage.add(g);
    const m = this.stoneMats;
    const body = new Group();
    const bodyGeo = this.keep(new CylinderGeometry(STONE_R * 0.95, STONE_R, 0.42, 14));
    const base = new Mesh(bodyGeo, m.granite);
    base.position.y = 0.21;
    const belt = new Mesh(this.keep(new CylinderGeometry(STONE_R * 1.02, STONE_R * 1.02, 0.1, 14)), m.band);
    belt.position.y = 0.2;
    const top = new Mesh(this.keep(new CylinderGeometry(STONE_R * 0.62, STONE_R * 0.8, 0.16, 12)), m.cap);
    top.position.y = 0.5;
    const handleMat = s.id % 2 ? m.yellow : m.red;
    const stem = new Mesh(this.keep(new CylinderGeometry(0.12, 0.16, 0.32, 6)), handleMat);
    stem.position.y = 0.72;
    const bar = new Mesh(this.keep(new BoxGeometry(0.95, 0.16, 0.2)), handleMat);
    bar.position.y = 0.92;
    const bar2 = new Mesh(this.keep(new SphereGeometry(0.16, 5, 4)), handleMat);
    bar2.position.set(0.5, 0.92, 0);
    const bar3 = bar2.clone();
    bar3.position.x = -0.5;
    body.add(base, belt, top, stem, bar, bar2, bar3);
    const sh = blobShadow(1.3, 0.4);
    sh.position.y = 0.05 - 0.2;
    body.add(sh);
    body.visible = false;
    g.add(body);
    // warning arrow on the bank, a bit in from the start of the run
    const arrow = new Mesh(this.arrowGeo, this.arrowMat);
    const ax = s.sx + s.dx * (STONE_START - 17.2);
    const az = s.sz + s.dz * (STONE_START - 17.2);
    arrow.position.set(ax, groundY(ax, az) + 0.35, az);
    arrow.rotation.y = Math.atan2(-s.dx, -s.dz);
    arrow.scale.set(1.3, 1, 1.3);
    g.add(arrow);
    // lane over the floe
    const lane = new Mesh(this.keep(new PlaneGeometry(2.1, 2 * STONE_START + 2)), this.laneMat);
    lane.rotation.x = -Math.PI / 2;
    lane.rotation.z = 0;
    const mid = new Vector3(s.sx + s.dx * STONE_START, 0.05, s.sz + s.dz * STONE_START);
    lane.position.copy(mid);
    lane.rotation.order = 'YXZ';
    lane.rotation.set(-Math.PI / 2, Math.atan2(s.dx, s.dz), 0);
    lane.visible = false;
    g.add(lane);
    return { group: g, arrow, lane, body };
  }

  private updateParts(dt: number) {
    const col = new Color();
    for (let i = 0; i < this.parts.length; i++) {
      const p = this.parts[i];
      if (p.alive) {
        p.life -= dt;
        if (p.life <= 0) p.alive = false;
        else {
          p.vy -= p.g * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.z += p.vz * dt;
          if (p.y < WATER_Y - 0.3 && p.g > 0) p.alive = false;
          p.vx *= 1 - 1.2 * dt;
          p.vz *= 1 - 1.2 * dt;
        }
      }
      if (p.alive) {
        const k = p.life / p.max;
        const s = p.size * (p.g < 0 ? 1.8 - k : Math.min(1, k * 2.4));
        this.dummy.position.set(p.x, p.y, p.z);
        this.dummy.rotation.set(p.spin + p.life * 4, p.spin, 0);
        this.dummy.scale.set(s, s, s);
        col.setRGB(p.r, p.gr, p.b);
        this.partMesh.setColorAt(i, col);
      } else this.dummy.scale.set(0, 0, 0);
      this.dummy.updateMatrix();
      this.partMesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.partMesh.instanceMatrix.needsUpdate = true;
    if (this.partMesh.instanceColor) this.partMesh.instanceColor.needsUpdate = true;
  }

  private updateRipples(dt: number) {
    for (const r of this.ripples) {
      if (!r.active) continue;
      r.t += dt;
      const k = r.t / r.dur;
      if (k >= 1) {
        r.active = false;
        r.mesh.visible = false;
        continue;
      }
      const s = 0.4 + r.max * (1 - (1 - k) * (1 - k));
      r.mesh.scale.set(s, 1, s);
      (r.mesh.material as MeshBasicMaterial).opacity = (1 - k) * 0.75;
    }
  }

  private updateSnow(dt: number) {
    const pos = this.flakes.geometry.attributes.position as BufferAttribute;
    const d = this.flakeData;
    for (let i = 0; i < d.length / 4; i++) {
      d[i * 4 + 1] -= d[i * 4 + 3] * dt;
      if (d[i * 4 + 1] < 0) {
        d[i * 4 + 1] += 22;
        d[i * 4] = (this.rnd() - 0.5) * 70;
        d[i * 4 + 2] = (this.rnd() - 0.5) * 50;
      }
      pos.setXYZ(i, d[i * 4] + Math.sin(this.t * 0.8 + i) * 0.6, d[i * 4 + 1], d[i * 4 + 2] + Math.cos(this.t * 0.6 + i * 1.3) * 0.5);
    }
    pos.needsUpdate = true;
  }

  dispose() {
    for (const cv of this.chunkVis) {
      cv.mesh.geometry.dispose();
      cv.mat.dispose();
      cv.cracks.geometry.dispose();
    }
    this.chunkVis = [];
    this.stage.dispose();
  }
}

/** Climb out onto the bank: ease up to the ground height. */
function y0(a: Actor, ground: number, dt: number) {
  const cur = a.unit.position.y;
  return cur + (ground + 0.05 - cur) * Math.min(1, dt * 4);
}
