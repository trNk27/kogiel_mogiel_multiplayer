/**
 * Malbork Castle on the TV, in the arena games' low-poly 3D (the shared kit: same look as Czołgi and
 * Fajki). The camera stands behind the archers on the red-brick battlements and looks out over the
 * meadow to the forest the monsters come from.
 *
 * The sim's 1920 × 1080 plan lies flat on the ground: 40 px to the metre, the foot of the wall on
 * z = 0, the forest towards −z. Flyers hover over their spot on the plan; arrows dip from the bow to
 * monster height and only drop to the ground at the end of their flight.
 */
import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  PlaneGeometry,
  RingGeometry,
  Shape,
  ShapeGeometry,
  TorusGeometry,
  Vector3,
  type Material,
  type Sprite,
  type Texture,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ARENA_SCALE, ArenaStage, blobShadow, buildPierogi, flat, groundTexture, nameTag, noise, pixelTexture, type PierogiModel } from '../arena/kit';
import { mulberry32 } from '../rng';
import { ARCHER_Y, MONSTERS, W, WALL_Y, aimVector, rangeFor, type Archer, type CEvent, type CastleSim, type Monster, type MonsterKind } from './logic';

export { ARENA_SCALE };

/** Sim pixels per metre. */
const PX = 40;
const wx = (x: number) => (x - W / 2) / PX;
const wz = (y: number) => (y - WALL_Y) / PX;

/** The wall: its outer face, the walkway's height and the back face; it runs this far each way. */
const FACE_Z = 0.6;
const WALK_H = 1.9;
const BACK_Z = 3.6;
const WALL_HALF = 46;
/** Corner towers, just outside the field. */
const TOWER_X = 27.5;
const ARCHER_Z = wz(ARCHER_Y);
/** Arrows leave the bow this high and cruise at monster height. */
const BOW_H = WALK_H + 0.65;
const CRUISE_H = 1.05;
/** Flyers hover this high (bats, Smok). */
const BAT_H = 1.55;
const DRAGON_H = 3.6;
const GOLD = '#ffd23f';

export interface ArcherLook {
  color: string;
  name: string;
  connected: boolean;
}

/** How high an arrow is `d` metres into its flight with `left` metres still to go. */
function arrowHeight(d: number, left: number) {
  const k = Math.max(0, 1 - d / 6);
  const h = CRUISE_H + (BOW_H - CRUISE_H) * k * k;
  return 0.12 + (h - 0.12) * Math.min(1, left / 2.2);
}

/** Zmora's opacity: fades smoothly in and out around ghostVisible(). */
function ghostAlpha(m: Monster) {
  if (m.atWall) return 1;
  const p = (m.age + m.ph * 3.6) % 3.6;
  if (p < 0.3) return 0.12 + (p / 0.3) * 0.88;
  if (p < 2.0) return 1;
  if (p < 2.3) return 1 - ((p - 2.0) / 0.3) * 0.88;
  return 0.12;
}

/** Where the monster's body is (for the flyers: in the air). */
function hoverHeight(m: Monster, t: number) {
  switch (m.kind) {
    case 'bat':
      return BAT_H + Math.sin(m.age * 5 + m.ph * 6) * 0.18;
    case 'dragon':
      return DRAGON_H + Math.sin(t * 1.6 + m.ph * 6) * 0.35;
    case 'ghost':
      return 0.25 + Math.sin(m.age * 2.4 + m.ph * 6) * 0.12;
    case 'fireball': {
      // From the dragon's mouth down to the top of the wall.
      const k = Math.max(0, Math.min(1, (m.ty - m.y) / Math.max(1, m.ty - 300)));
      return WALK_H + 0.6 + (DRAGON_H + 0.8 - WALK_H - 0.6) * k;
    }
    default:
      return 0;
  }
}

/** Top of each model in body radii (for health bars and points). */
const TOP: Record<MonsterKind, number> = { imp: 2.0, wolf: 1.6, knight: 2.6, bat: 1.0, ghost: 2.1, giant: 2.8, dragon: 1.4, fireball: 0.6 };

// ---------------------------------------------------------------------------
// textures
// ---------------------------------------------------------------------------

function brickTexture(seed = 11) {
  return pixelTexture(
    16,
    (ctx, rnd) => {
      noise(ctx, rnd, 16, [170, 70, 46], 28);
      ctx.fillStyle = 'rgba(232, 200, 170, .55)';
      for (let y = 0; y < 16; y += 4) {
        ctx.fillRect(0, y, 16, 1);
        const off = (y / 4) % 2 ? 4 : 0;
        for (let x = off; x < 16; x += 8) ctx.fillRect(x, y, 1, 4);
      }
      // A few dark glazed bricks, as on the real castle.
      ctx.fillStyle = 'rgba(40, 20, 20, .45)';
      for (let i = 0; i < 4; i++) ctx.fillRect(1 + Math.floor(rnd() * 3) * 5, 1 + Math.floor(rnd() * 4) * 4, 3, 3);
    },
    seed,
  );
}

/** Scale a box's UVs so a texture tiles once per `k` metres whatever the box size. */
function scaleUV(geo: BoxGeometry, w: number, h: number, d: number, k: number) {
  const uv = geo.attributes.uv;
  const dims: [number, number][] = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  for (let f = 0; f < 6; f++)
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, (uv.getX(i) * dims[f][0]) / k, (uv.getY(i) * dims[f][1]) / k);
    }
  uv.needsUpdate = true;
  return geo;
}

function texBox(w: number, h: number, d: number, mat: Material, k = 1.4) {
  const m = new Mesh(scaleUV(new BoxGeometry(w, h, d), w, h, d, k), mat);
  m.position.y = h / 2;
  return m;
}

// ---------------------------------------------------------------------------
// particles: one instanced mesh per material, so the whole show is two draw calls
// ---------------------------------------------------------------------------

interface P {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  s0: number;
  s1: number;
  color: Color;
  g: number;
}

class Particles {
  readonly mesh: InstancedMesh;
  private list: P[] = [];
  private tmp = new Object3D();

  constructor(
    mat: Material,
    private max: number,
  ) {
    this.mesh = new InstancedMesh(new IcosahedronGeometry(1, 0), mat, max);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.setColorAt(0, new Color('#fff'));
  }

  add(pos: [number, number, number], vel: [number, number, number], life: number, s0: number, s1: number, color: string, g = 0) {
    if (this.list.length >= this.max) return;
    this.list.push({ x: pos[0], y: pos[1], z: pos[2], vx: vel[0], vy: vel[1], vz: vel[2], life, max: life, s0, s1, color: new Color(color), g });
  }

  update(dt: number) {
    const keep: P[] = [];
    let n = 0;
    for (const p of this.list) {
      p.life -= dt;
      if (p.life <= 0) continue;
      const drag = Math.exp(-2.5 * dt);
      p.vx *= drag;
      p.vz *= drag;
      p.vy = p.vy * drag - p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.y < 0.05) {
        p.y = 0.05;
        p.vy *= -0.3;
      }
      const k = 1 - p.life / p.max;
      this.tmp.position.set(p.x, p.y, p.z);
      this.tmp.rotation.set(p.life * 5, p.life * 3, 0);
      this.tmp.scale.setScalar(Math.max(0.001, p.s0 + (p.s1 - p.s0) * k));
      this.tmp.updateMatrix();
      this.mesh.setMatrixAt(n, this.tmp.matrix);
      this.mesh.setColorAt(n, p.color);
      n++;
      keep.push(p);
    }
    this.list = keep;
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.dispose();
  }
}

// ---------------------------------------------------------------------------
// shared bits: a few unit shapes scaled into every monster, and cached materials
// ---------------------------------------------------------------------------

class Parts {
  readonly ball = new IcosahedronGeometry(1, 1);
  readonly gem = new IcosahedronGeometry(1, 0);
  readonly cube = new BoxGeometry(1, 1, 1);
  readonly cone = new ConeGeometry(1, 1, 6);
  readonly cone4 = new ConeGeometry(1, 1, 4);
  readonly cyl = new CylinderGeometry(1, 1, 1, 8);
  readonly sheet = new CylinderGeometry(0.55, 0.85, 1.3, 9, 1, true);
  readonly club = new CylinderGeometry(0.24, 0.09, 1.5, 6).translate(0, 0.75, 0);
  readonly batWing = wingGeometry([
    [0, 0.15],
    [0.5, 0.45],
    [1.5, 0.25],
    [1.3, -0.12],
    [1.0, 0],
    [0.8, -0.35],
    [0.45, -0.1],
    [0, -0.22],
  ]);
  readonly dragonWing = wingGeometry([
    [0, 0.35],
    [0.8, 1.05],
    [2.5, 0.75],
    [2.25, -0.25],
    [1.75, 0.05],
    [1.35, -0.5],
    [0.9, -0.12],
    [0.5, -0.55],
    [0, -0.3],
  ]);
  private mats = new Map<string, Material>();

  lam(color: string) {
    const k = `l${color}`;
    let m = this.mats.get(k);
    if (!m) this.mats.set(k, (m = flat(color, { side: DoubleSide })));
    return m;
  }

  basic(color: string, opacity = 1) {
    const k = `b${color}${opacity}`;
    let m = this.mats.get(k);
    if (!m) this.mats.set(k, (m = new MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 })));
    return m;
  }

  dispose() {
    for (const g of [this.ball, this.gem, this.cube, this.cone, this.cone4, this.cyl, this.sheet, this.club, this.batWing, this.dragonWing]) g.dispose();
    for (const m of this.mats.values()) m.dispose();
    this.mats.clear();
  }
}

/** A flat wing lying in the x–z plane, reaching out along +x with its leading edge towards +z. */
function wingGeometry(pts: [number, number][]) {
  const s = new Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (const [x, y] of pts.slice(1)) s.lineTo(x, y);
  s.closePath();
  return new ShapeGeometry(s).rotateX(Math.PI / 2);
}

function put(parent: Object3D, geo: BufferGeometry, mat: Material, pos: [number, number, number], scale: [number, number, number] | number = 1, rot?: [number, number, number]) {
  const m = new Mesh(geo, mat);
  m.position.set(...pos);
  if (typeof scale === 'number') m.scale.setScalar(scale);
  else m.scale.set(...scale);
  if (rot) m.rotation.set(...rot);
  parent.add(m);
  return m;
}

function pivot(parent: Object3D, pos: [number, number, number]) {
  const g = new Group();
  g.position.set(...pos);
  parent.add(g);
  return g;
}

interface MonsterVis {
  /** On the ground at the monster's spot, sized by its radius. */
  root: Group;
  /** Lifted for flyers; bobs and squashes. */
  body: Group;
  parts: Record<string, Object3D>;
  /** Materials of its own (Zmory fade on their own), disposed with it. */
  own: Material[];
  bar: { group: Group; fill: Mesh } | null;
  lastX: number;
  yaw: number;
}

interface ArrowVis {
  group: Group;
  total: number;
}

interface ArcherVis {
  pier: PierogiModel;
  bow: Group;
  string: Line;
  nocked: Group;
  tag: Sprite;
  ring: Mesh;
  guide: InstancedMesh;
  target: Mesh;
  guideMat: MeshBasicMaterial;
  fletch: MeshBasicMaterial;
}

const GUIDE_DASHES = 44;

export class CastleScene {
  readonly stage: ArenaStage;
  private parts = new Parts();
  private glow: Particles;
  private puffs: Particles;
  private monsters = new Map<number, MonsterVis>();
  private arrows = new Map<number, ArrowVis>();
  private archers: ArcherVis[] = [];
  private merlons: { mesh: Mesh; wear: number }[] = [];
  private rubble: InstancedMesh;
  private camBase = new Vector3();
  private camTarget = new Vector3(0, 0, -10.5);
  private clock = 0;
  private tmp = new Object3D();
  private bars = new Map<string, MeshBasicMaterial>();
  private templates = new Map<MonsterKind, { root: Group; own: Material[] }>();
  private arrowTemplates = new Map<string, Group>();
  private vertexLit = flat('#ffffff', { vertexColors: true, side: DoubleSide });
  private vertexUnlit = new MeshBasicMaterial({ vertexColors: true });
  private tex: Texture[] = [];
  private own: { dispose(): void }[] = [];
  shake = 0;

  constructor(
    canvas: HTMLCanvasElement,
    private looks: ArcherLook[],
  ) {
    this.stage = new ArenaStage(canvas, { sky: '#cfdcd8', fog: [42, 86], fov: 38 });
    const s = this.stage;
    // From behind the archers: the wall along the bottom, the forest along the top.
    s.lookAt(this.camTarget, 46, 0.9);
    this.camBase.copy(s.camera.position);
    const glowMat = new MeshBasicMaterial({ color: '#fff' });
    const puffMat = new MeshLambertMaterial({ color: '#fff', flatShading: true });
    this.own.push(glowMat, puffMat, this.vertexLit, this.vertexUnlit);
    this.glow = new Particles(glowMat, 500);
    this.puffs = new Particles(puffMat, 400);
    this.rubble = new InstancedMesh(this.parts.gem, this.parts.lam('#8c3a28'), 60);
    this.rubble.count = 0;
    this.rubble.frustumCulled = false;
    this.buildField();
    this.buildWall();
    s.add(this.glow.mesh, this.puffs.mesh, this.rubble);
    looks.forEach((l, i) => this.archers.push(this.buildArcher(l, i)));
    s.keep({ dispose: () => this.disposeAll() });
  }

  private disposeAll() {
    for (const v of this.monsters.values()) v.own.forEach((m) => m.dispose());
    this.glow.dispose();
    this.puffs.dispose();
    for (const a of this.archers) {
      a.pier.mats.forEach((m) => m.dispose());
      a.guideMat.dispose();
      a.fletch.dispose();
      (a.string.material as Material).dispose();
      a.string.geometry.dispose();
    }
    for (const t of this.tex) t.dispose();
    for (const o of this.own) o.dispose();
    this.parts.dispose();
  }

  dispose() {
    this.stage.dispose();
  }

  // ---- scenery -----------------------------------------------------------------------

  private keepTex<T extends Texture>(t: T) {
    this.tex.push(t);
    return t;
  }

  private buildField() {
    const s = this.stage;
    const rng = mulberry32(1257);
    // The meadow in front of the wall and the courtyard behind it.
    const grass = this.keepTex(groundTexture('grass', 1, 5));
    grass.repeat.set(60, 40);
    const meadow = new Mesh(new PlaneGeometry(170, 110), new MeshLambertMaterial({ map: grass }));
    meadow.rotation.x = -Math.PI / 2;
    meadow.position.z = FACE_Z - 55;
    const yard = this.keepTex(groundTexture('stone', 1, 8));
    yard.repeat.set(40, 8);
    const court = new Mesh(new PlaneGeometry(170, 30), new MeshLambertMaterial({ map: yard }));
    court.rotation.x = -Math.PI / 2;
    court.position.set(0, -0.01, BACK_Z + 14);
    s.add(meadow, court);

    // Dirt paths from the forest to the wall (the same curves as the sim's plan).
    const dirt = new MeshLambertMaterial({ color: '#b48a55', side: DoubleSide });
    this.own.push(dirt);
    for (const [x0, cx, x1] of [
      [420, 300, 760],
      [1500, 1650, 1160],
      [960, 1060, 960],
    ]) {
      const pts: Vector3[] = [];
      for (let k = 0; k <= 24; k++) {
        const t = k / 24;
        const x = (1 - t) * (1 - t) * x0 + 2 * (1 - t) * t * cx + t * t * x1;
        const y = (1 - t) * (1 - t) * -200 + 2 * (1 - t) * t * 450 + t * t * (WALL_Y + 10);
        pts.push(new Vector3(wx(x), 0.02, wz(y)));
      }
      s.add(new Mesh(ribbon(pts, 1.8), dirt));
    }

    // Tufts, flowers and stones.
    const d = new Object3D();
    const flowers = new InstancedMesh(this.parts.gem, this.parts.basic('#fff'), 110);
    const stones = new InstancedMesh(this.parts.gem, this.parts.lam('#9a9486'), 70);
    const tufts = new InstancedMesh(this.parts.cone4, this.parts.lam('#3f6f2c'), 260);
    let nf = 0;
    let ns = 0;
    let nt = 0;
    const petals = ['#fff4dc', '#ffd23f', '#ff7ad1', '#e8335a', '#4f9dff'].map((c) => new Color(c));
    for (let i = 0; i < 560; i++) {
      const x = (rng() - 0.5) * 70;
      const z = FACE_Z - 0.8 - rng() * 30;
      const k = rng();
      if (k < 0.45 && nt < 260) {
        d.position.set(x, 0.12, z);
        d.rotation.set(0, rng() * 3, 0);
        d.scale.set(0.12, 0.3 + rng() * 0.2, 0.12);
        d.updateMatrix();
        tufts.setMatrixAt(nt++, d.matrix);
      } else if (k < 0.88 && nf < 110) {
        d.position.set(x, 0.06, z);
        d.scale.setScalar(0.07 + rng() * 0.04);
        d.updateMatrix();
        flowers.setMatrixAt(nf, d.matrix);
        flowers.setColorAt(nf++, petals[Math.floor(rng() * petals.length)]);
      } else if (ns < 70) {
        d.position.set(x, 0.05, z);
        d.rotation.set(rng() * 3, rng() * 3, 0);
        d.scale.set(0.25 + rng() * 0.25, 0.14 + rng() * 0.1, 0.2 + rng() * 0.2);
        d.updateMatrix();
        stones.setMatrixAt(ns++, d.matrix);
      }
    }
    flowers.count = nf;
    stones.count = ns;
    tufts.count = nt;
    s.add(flowers, stones, tufts);

    // The forest: firs along the far edge and down both sides of the meadow.
    const firs: [number, number, number][] = [];
    for (let row = 0; row < 7; row++) {
      const z = wz(-60) - 1.2 - row * 2.6;
      for (let x = -62; x < 62; x += 2.4 + rng() * 1.6) firs.push([x + (rng() - 0.5) * 1.2, z + (rng() - 0.5) * 1.4, 1 + rng() * 0.5 + row * 0.04]);
    }
    for (const side of [-1, 1])
      for (let z = wz(-60); z < -1; z += 2.2 + rng() * 1.4)
        for (let k = 0; k < 6; k++) firs.push([side * (29 + k * 2.6 + rng() * 1.5 + Math.max(0, z + 8) * 0.25), z + (rng() - 0.5) * 1.4, 0.9 + rng() * 0.5]);
    const needles = new InstancedMesh(this.parts.cone, this.parts.lam('#1f4a2c'), firs.length * 2);
    const trunks = new InstancedMesh(this.parts.cyl, this.parts.lam('#5a3a22'), firs.length);
    const shades = ['#173a24', '#1d4a2c', '#235634', '#2b6239'].map((c) => new Color(c));
    firs.forEach(([x, z, k], i) => {
      d.rotation.set(0, rng() * 3, 0);
      d.position.set(x, 0.6 * k, z);
      d.scale.set(0.22 * k, 1.2 * k, 0.22 * k);
      d.updateMatrix();
      trunks.setMatrixAt(i, d.matrix);
      const c = shades[Math.floor(rng() * shades.length)];
      for (const [y, r, h, j] of [
        [2.3, 1.55, 3.0, 0],
        [3.9, 1.1, 2.4, 1],
      ] as const) {
        d.position.set(x, y * k, z);
        d.scale.set(r * k, h * k, r * k);
        d.updateMatrix();
        needles.setMatrixAt(i * 2 + j, d.matrix);
        needles.setColorAt(i * 2 + j, c);
      }
    });
    s.add(needles, trunks);

    // Mist where the monsters come out of the trees.
    const mistTex = this.keepTex(
      pixelTexture(16, (ctx) => {
        for (let y = 0; y < 16; y++) {
          ctx.fillStyle = `rgba(226, 236, 236, ${(y / 15) ** 1.6 * 0.5})`;
          ctx.fillRect(0, y, 16, 1);
        }
      }),
    );
    mistTex.repeat.set(1, 1);
    const mistMat = new MeshBasicMaterial({ map: mistTex, transparent: true, depthWrite: false });
    this.own.push(mistMat);
    const mist = new Mesh(new PlaneGeometry(130, 3.2), mistMat);
    mist.position.set(0, 1.6, wz(-30));
    s.add(mist);
  }

  private buildWall() {
    const s = this.stage;
    const brickTex = this.keepTex(brickTexture());
    const brick = new MeshLambertMaterial({ map: brickTex, flatShading: true });
    const cap = this.parts.lam('#7c3022');
    const wood = new MeshLambertMaterial({ map: this.keepTex(groundTexture('wood', 1, 9)), flatShading: true });
    this.own.push(brick, wood);
    const depth = BACK_Z - FACE_Z;
    const body = texBox(WALL_HALF * 2, WALK_H, depth, brick);
    body.position.z = FACE_Z + depth / 2;
    // A plinth of dark field stone along the foot.
    const plinth = new Mesh(new BoxGeometry(WALL_HALF * 2, 0.5, 0.3), this.parts.lam('#6d6458'));
    plinth.position.set(0, 0.25, FACE_Z + 0.05);
    // The walkway: boards on top, behind the parapet.
    const walk = texBox(WALL_HALF * 2, 0.08, depth - 0.6, wood, 1.2);
    walk.position.set(0, WALK_H, FACE_Z + 0.6 + (depth - 0.6) / 2);
    // The parapet: a low wall along the outer edge, and merlons on it that fall as the wall wears.
    const low = texBox(WALL_HALF * 2, 0.3, 0.6, brick);
    low.position.set(0, WALK_H, FACE_Z + 0.3);
    const lowCap = new Mesh(new BoxGeometry(WALL_HALF * 2, 0.1, 0.7), cap);
    lowCap.position.set(0, WALK_H + 0.35, FACE_Z + 0.3);
    s.add(body, plinth, walk, low, lowCap);
    const rng = mulberry32(77);
    for (let x = -WALL_HALF + 1.2; x < WALL_HALF; x += 2.4) {
      const m = texBox(1.3, 0.5, 0.6, brick);
      m.position.set(x, WALK_H + 0.35, FACE_Z + 0.3);
      const c = new Mesh(new BoxGeometry(1.4, 0.1, 0.7), cap);
      c.position.y = 0.3;
      m.add(c);
      s.add(m);
      // Merlons in front of the field go first; the ones off-screen stay up.
      this.merlons.push({ mesh: m, wear: Math.abs(x) < 24 ? 0.08 + rng() * 0.9 : 2 });
    }
    // Arrow slits along the face.
    for (let x = -WALL_HALF + 2.4; x < WALL_HALF; x += 4.8) put(s.world, this.parts.cube, this.parts.basic('#2a1410'), [x, 1.1, FACE_Z - 0.01], [0.14, 0.6, 0.04]);
    // Corner towers with steep roofs and a gold ball.
    for (const sx of [-1, 1]) {
      const t = new Group();
      t.position.set(sx * TOWER_X, 0, FACE_Z + 1.4);
      const r = 2.8;
      const h = 6.4;
      const tube = new Mesh(new CylinderGeometry(r, r * 1.06, h, 10), brick);
      tube.position.y = h / 2;
      const ring = new Mesh(new CylinderGeometry(r + 0.25, r + 0.25, 0.4, 10), cap);
      ring.position.y = h;
      t.add(tube, ring);
      for (let k = 0; k < 10; k++) {
        const a = (k / 10) * Math.PI * 2;
        put(t, this.parts.cube, brick, [Math.cos(a) * (r + 0.05), h + 0.55, Math.sin(a) * (r + 0.05)], [0.9, 0.7, 0.5], [0, -a, 0]);
      }
      const roof = new Mesh(new ConeGeometry(r + 0.3, 5.6, 10), this.parts.lam('#6e2c22'));
      roof.position.y = h + 0.4 + 2.8;
      const ball = put(t, this.parts.ball, this.parts.lam('#ffc93c'), [0, h + 6.4, 0], 0.3);
      for (const k of [-1, 1]) put(t, this.parts.cube, this.parts.basic('#2a1410'), [k * 0.9, h * 0.6, r * 0.98 * (sx < 0 ? 1 : 1)], [0.3, 0.9, 0.1]);
      t.add(roof, ball);
      s.add(t);
    }
  }

  // ---- archers -----------------------------------------------------------------------

  private buildArcher(look: ArcherLook, i: number): ArcherVis {
    const pier = buildPierogi(look.color);
    for (const m of pier.mats) m.transparent = true;
    pier.root.scale.setScalar(1.25);
    // The bow, held level in front: the limbs bend towards the target, the string pulls back.
    const bow = new Group();
    bow.position.set(0, 0.62, 0.12);
    const limbs = new TorusGeometry(0.62, 0.05, 3, 12, 2.2).rotateZ(Math.PI / 2 - 1.1).rotateX(Math.PI / 2);
    this.own.push(limbs);
    bow.add(new Mesh(limbs, this.parts.lam('#c98a4b')));
    put(bow, this.parts.cube, this.parts.lam('#7a4a24'), [0, 0, 0.62], [0.2, 0.12, 0.14]);
    const sgeo = new BufferGeometry();
    sgeo.setAttribute('position', new Float32BufferAttribute(new Float32Array(9), 3));
    const string = new Line(sgeo, new LineBasicMaterial({ color: '#fff4dc' }));
    string.frustumCulled = false;
    bow.add(string);
    const fletch = new MeshBasicMaterial({ color: look.color });
    const nocked = new Group();
    put(nocked, this.parts.cube, this.parts.lam('#e8d2a8'), [0, 0, 0.45], [0.05, 0.05, 0.9]);
    put(nocked, this.parts.cone4, this.parts.lam('#c9ccd3'), [0, 0, 0.95], [0.08, 0.2, 0.08], [Math.PI / 2, 0, 0]);
    put(nocked, this.parts.cube, fletch, [0, 0, 0.06], [0.18, 0.03, 0.14]);
    bow.add(nocked);
    pier.body.add(bow);
    pier.root.position.set(wx(this.archerX(i)), WALK_H + 0.04, ARCHER_Z);
    const tag = nameTag(look.name, look.color, 3.2 / 1.25);
    tag.position.set(0, 1.75, 0);
    pier.root.add(tag);
    // Volley: a gold ring under the archer.
    const ring = new Mesh(new RingGeometry(0.95, 1.2, 20), this.parts.basic(GOLD, 0.85));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06;
    ring.visible = false;
    pier.root.add(ring);
    this.own.push(ring.geometry);
    this.stage.add(pier.root);
    // Aim guide: dashes along the arrow's flight and a ring where it lands.
    const guideMat = new MeshBasicMaterial({ color: look.color, transparent: true, opacity: 0.9, depthWrite: false });
    const guide = new InstancedMesh(this.parts.cube, guideMat, GUIDE_DASHES);
    guide.count = 0;
    guide.frustumCulled = false;
    const target = new Mesh(new RingGeometry(0.42, 0.6, 16), guideMat);
    target.rotation.x = -Math.PI / 2;
    target.visible = false;
    this.own.push(target.geometry);
    this.stage.add(guide, target);
    return { pier, bow, string, nocked, tag, ring, guide, target, guideMat, fletch };
  }

  /** Archers stand where the sim puts them; until the first frame, spread like the sim does. */
  private archerX(i: number) {
    const n = this.looks.length;
    return n <= 1 ? W / 2 : 300 + ((W - 600) * i) / (n - 1);
  }

  setLooks(looks: ArcherLook[]) {
    this.looks = looks;
  }

  private updateArcher(v: ArcherVis, a: Archer, look: ArcherLook | undefined, ready: boolean, t: number) {
    const [dx, dy] = aimVector(a.aim);
    const root = v.pier.root;
    root.position.x = wx(a.x);
    // Face the aim: the pierogi's front (+z) turns to (dx, −dy) on the plan.
    root.rotation.y = Math.atan2(dx, dy);
    const alpha = a.active ? (look?.connected === false ? 0.5 : 1) : 0.25;
    for (const m of v.pier.mats) m.opacity = alpha;
    v.tag.material.opacity = a.active ? 1 : 0.4;
    v.bow.visible = a.active;
    const pull = a.aiming ? 0.06 + a.draw * 0.42 : 0.06;
    const tipZ = 0.62 * Math.cos(1.1);
    const tipX = 0.62 * Math.sin(1.1);
    const pos = v.string.geometry.attributes.position as Float32BufferAttribute;
    pos.setXYZ(0, -tipX, 0, tipZ);
    pos.setXYZ(1, 0, 0, tipZ - pull);
    pos.setXYZ(2, tipX, 0, tipZ);
    pos.needsUpdate = true;
    v.nocked.visible = ready;
    v.nocked.position.z = tipZ - pull;
    v.ring.visible = a.active && a.volley > 0;
    if (v.ring.visible) v.ring.scale.setScalar(1 + 0.12 * Math.sin(t * 9));
    // Hop a little while drawing.
    v.pier.body.position.y = a.aiming ? Math.abs(Math.sin(t * 3)) * 0.04 : 0;

    // The aim guide.
    const show = a.active && a.aiming && a.draw > 0.05;
    v.target.visible = show;
    if (!show) {
      v.guide.count = 0;
      return;
    }
    const full = a.charged;
    v.guideMat.color.set(full ? GOLD : look?.color ?? '#fff');
    const len = (rangeFor(a.draw) * (full ? 1.1 : 1) + 30) / PX;
    const sx = root.position.x + dx * 0.75;
    const sz = wz(a.y - 26) + dy * 0.75;
    const tmp = this.tmp;
    const step = 0.85;
    const off = (t * 3) % step;
    let n = 0;
    for (let d = off; d < len && n < GUIDE_DASHES; d += step) {
      const left = len - d;
      const y0 = arrowHeight(d, left);
      const y1 = arrowHeight(d + 0.4, left - 0.4);
      tmp.position.set(sx + dx * d, y0, sz + dy * d);
      tmp.lookAt(sx + dx * (d + 0.4), y1, sz + dy * (d + 0.4));
      const w = full ? 0.16 : 0.1;
      tmp.scale.set(w, w, 0.42);
      tmp.updateMatrix();
      v.guide.setMatrixAt(n++, tmp.matrix);
    }
    v.guide.count = n;
    v.guide.instanceMatrix.needsUpdate = true;
    v.target.position.set(sx + dx * len, 0.07, sz + dy * len);
    v.target.scale.setScalar(full ? 1.3 + 0.2 * Math.sin(t * 18) : 1);
  }

  // ---- monsters ----------------------------------------------------------------------

  /** A monster from its template (built once per kind), with materials of its own where it fades. */
  private buildMonster(m: Monster): MonsterVis {
    let tpl = this.templates.get(m.kind);
    if (!tpl) this.templates.set(m.kind, (tpl = this.buildTemplate(m.kind)));
    const root = tpl.root.clone();
    const parts: Record<string, Object3D> = {};
    root.traverse((o) => {
      if (o.name) parts[o.name] = o;
    });
    const own = new Map<Material, Material>();
    if (tpl.own.length)
      root.traverse((o) => {
        const mesh = o as Mesh;
        const mat = mesh.material as Material;
        if (!mesh.isMesh || !tpl.own.includes(mat)) return;
        if (!own.has(mat)) own.set(mat, mat.clone());
        mesh.material = own.get(mat)!;
      });
    this.stage.add(root);
    return { root, body: parts.body as Group, parts, own: [...own.values()], bar: null, lastX: m.x, yaw: 0 };
  }

  private buildTemplate(kind: MonsterKind): { root: Group; own: Material[] } {
    const P = this.parts;
    const root = new Group();
    const body = new Group();
    root.add(body);
    const parts: Record<string, Object3D> = {};
    const own: Material[] = [];
    const eyes = (parent: Object3D, x: number, y: number, z: number, r: number, iris: string, glow = false) => {
      for (const k of [-1, 1]) {
        if (!glow) put(parent, P.ball, P.lam('#fff8ea'), [k * x, y, z], [r, r * 1.1, r * 0.6]);
        put(parent, P.ball, glow ? P.basic(iris) : P.lam(iris), [k * x, y, z + r * 0.35], [r * 0.7, r * 0.8, r * 0.5]);
        if (!glow) put(parent, P.ball, P.basic('#1d0f0a'), [k * x, y, z + r * 0.62], [r * 0.32, r * 0.42, r * 0.3]);
      }
    };
    switch (kind) {
      case 'imp': {
        const red = P.lam('#b8432f');
        put(body, P.ball, red, [0, 0.95, 0], [0.8, 0.85, 0.7]);
        put(body, P.ball, P.lam('#d9735a'), [0, 0.72, 0.4], [0.5, 0.45, 0.32]);
        for (const k of [-1, 1]) put(body, P.cone, P.lam('#f3e3c3'), [k * 0.36, 1.82, 0], [0.13, 0.5, 0.13], [0, 0, -k * 0.45]);
        eyes(body, 0.26, 1.16, 0.55, 0.18, '#ffd23f');
        put(body, P.cube, P.basic('#3a0a0a'), [0, 0.78, 0.66], [0.36, 0.1, 0.05]);
        for (const k of [-1, 1]) {
          put(body, P.cone4, P.basic('#ffffff'), [k * 0.1, 0.72, 0.69], [0.05, 0.12, 0.04], [Math.PI, 0, 0]);
          const foot = put(body, P.ball, P.lam('#5a1a1a'), [k * 0.36, 0.12, 0.12], [0.24, 0.14, 0.32]);
          parts[k < 0 ? 'footL' : 'footR'] = foot;
          const arm = pivot(body, [k * 0.74, 1.05, 0]);
          put(arm, P.cube, red, [k * 0.1, -0.28, 0.05], [0.18, 0.55, 0.18]);
          parts[k < 0 ? 'armL' : 'armR'] = arm;
        }
        put(body, P.cone, red, [0.45, 0.55, -0.6], [0.08, 0.7, 0.08], [-0.9, 0, -0.5]);
        put(body, P.cone4, red, [0.68, 0.9, -0.85], [0.14, 0.24, 0.06], [-0.9, 0, -0.5]);
        break;
      }
      case 'wolf': {
        const fur = P.lam('#6f7484');
        const light = P.lam('#8a8fa0');
        put(body, P.cube, fur, [0, 0.8, -0.25], [0.75, 0.6, 1.35]);
        const head = pivot(body, [0, 1.05, 0.55]);
        parts.head = head;
        put(head, P.cube, light, [0, 0, 0], [0.7, 0.62, 0.6]);
        put(head, P.cube, P.lam('#d8d6cf'), [0, -0.12, 0.42], [0.36, 0.3, 0.4]);
        put(head, P.cube, P.basic('#1d0f0a'), [0, -0.02, 0.64], [0.14, 0.1, 0.06]);
        for (const k of [-1, 1]) put(head, P.cone4, light, [k * 0.24, 0.45, -0.05], [0.14, 0.38, 0.1]);
        eyes(head, 0.18, 0.13, 0.31, 0.08, '#ff5a3c', true);
        parts.jaw = put(head, P.cube, P.basic('#7a1020'), [0, -0.3, 0.42], [0.26, 0.08, 0.3]);
        const legs: Object3D[] = [];
        for (const [x, z] of [
          [-0.26, 0.3],
          [0.26, 0.3],
          [-0.26, -0.75],
          [0.26, -0.75],
        ]) {
          const leg = pivot(body, [x, 0.6, z]);
          put(leg, P.cube, fur, [0, -0.3, 0], [0.18, 0.6, 0.2]);
          legs.push(leg);
        }
        legs.forEach((l, k) => (parts[`leg${k}`] = l));
        put(body, P.cone, fur, [0, 1.05, -1.05], [0.12, 0.6, 0.12], [-1.1, 0, 0]);
        break;
      }
      case 'knight': {
        const plate = P.lam('#4a5160');
        for (const k of [-1, 1]) {
          const leg = pivot(body, [k * 0.28, 0.62, 0]);
          put(leg, P.cube, P.lam('#3b4252'), [0, -0.3, 0], [0.32, 0.62, 0.36]);
          parts[k < 0 ? 'legL' : 'legR'] = leg;
        }
        put(body, P.cube, plate, [0, 1.1, 0], [1.1, 0.9, 0.62]);
        put(body, P.cube, P.lam('#5d6578'), [-0.25, 1.15, 0.32], [0.2, 0.7, 0.04]);
        put(body, P.cyl, P.lam('#6b7487'), [0, 1.85, 0], [0.42, 0.62, 0.42]);
        put(body, P.ball, P.lam('#6b7487'), [0, 2.15, 0], [0.42, 0.22, 0.42]);
        put(body, P.cube, P.basic('#12141a'), [0, 1.9, 0.4], [0.55, 0.12, 0.08]);
        for (const k of [-1, 1]) put(body, P.cube, P.basic('#ff3d3d'), [k * 0.13, 1.9, 0.45], [0.08, 0.06, 0.04]);
        put(body, P.cone, P.lam('#e8335a'), [0, 2.45, -0.1], [0.14, 0.6, 0.3], [-0.5, 0, 0]);
        const shield = pivot(body, [-0.68, 1.05, 0.38]);
        put(shield, P.cube, P.lam('#2b2f3a'), [0, 0, 0], [0.62, 0.9, 0.1]);
        put(shield, P.cube, P.lam('#e8335a'), [0, 0, 0.06], [0.14, 0.9, 0.04]);
        put(shield, P.cube, P.lam('#e8335a'), [0, 0.12, 0.06], [0.62, 0.14, 0.04]);
        const sword = pivot(body, [0.68, 1.3, 0.1]);
        put(sword, P.cube, plate, [0, -0.15, 0], [0.24, 0.5, 0.24]);
        put(sword, P.cube, P.lam('#ffc93c'), [0, 0.12, 0.1], [0.42, 0.08, 0.1]);
        put(sword, P.cube, P.lam('#d4dae3'), [0, 0.75, 0.1], [0.12, 1.2, 0.05]);
        parts.sword = sword;
        break;
      }
      case 'bat': {
        const fur = P.lam('#6b4590');
        put(body, P.ball, fur, [0, 0, 0], [0.5, 0.55, 0.48]);
        for (const k of [-1, 1]) put(body, P.cone4, fur, [k * 0.22, 0.6, 0], [0.14, 0.36, 0.1]);
        eyes(body, 0.17, 0.1, 0.42, 0.1, '#ff5a3c', true);
        for (const k of [-1, 1]) put(body, P.cone4, P.basic('#ffffff'), [k * 0.08, -0.15, 0.44], [0.04, 0.12, 0.04], [Math.PI, 0, 0]);
        for (const k of [-1, 1]) {
          const wing = pivot(body, [k * 0.35, 0.05, 0]);
          wing.scale.x = k;
          put(wing, P.batWing, P.lam('#4a2c66'), [0, 0, 0]);
          parts[k < 0 ? 'wingL' : 'wingR'] = wing;
        }
        break;
      }
      case 'ghost': {
        const sheetMat = new MeshLambertMaterial({ color: '#eef3ff', transparent: true, flatShading: true, side: DoubleSide });
        const faceMat = new MeshBasicMaterial({ color: '#1b1f3a', transparent: true });
        own.push(sheetMat, faceMat);
        put(body, P.sheet, sheetMat, [0, 0.85, 0]);
        put(body, P.ball, sheetMat, [0, 1.5, 0], [0.56, 0.55, 0.56]);
        for (const k of [-1, 1]) put(body, P.ball, faceMat, [k * 0.2, 1.58, 0.46], [0.1, 0.15, 0.05]);
        parts.mouth = put(body, P.ball, faceMat, [0, 1.24, 0.5], [0.1, 0.15, 0.05]);
        for (const k of [-1, 1]) {
          const arm = pivot(body, [k * 0.55, 1.1, 0.1]);
          put(arm, P.cube, sheetMat, [k * 0.1, 0, 0.3], [0.16, 0.16, 0.6]);
          parts[k < 0 ? 'armL' : 'armR'] = arm;
        }
        break;
      }
      case 'giant': {
        const skin = P.lam('#7d8f4a');
        for (const k of [-1, 1]) {
          const leg = pivot(body, [k * 0.42, 0.72, 0]);
          put(leg, P.cube, P.lam('#5e6b34'), [0, -0.36, 0], [0.45, 0.72, 0.5]);
          parts[k < 0 ? 'legL' : 'legR'] = leg;
        }
        put(body, P.ball, skin, [0, 1.35, 0], [0.95, 0.85, 0.75]);
        put(body, P.ball, P.lam('#9fae6a'), [0, 1.15, 0.42], [0.6, 0.5, 0.38]);
        put(body, P.cyl, P.lam('#5a3a1e'), [0, 1.0, 0], [0.88, 0.16, 0.7]);
        put(body, P.cube, P.lam('#ffc93c'), [0, 1.0, 0.7], [0.22, 0.2, 0.06]);
        const head = pivot(body, [0, 2.3, 0.1]);
        put(head, P.ball, P.lam('#8b9d55'), [0, 0, 0], [0.5, 0.45, 0.45]);
        eyes(head, 0.18, 0.08, 0.38, 0.1, '#fff4dc');
        for (const k of [-1, 1]) {
          put(head, P.cube, P.basic('#2a120a'), [k * 0.18, 0.22, 0.4], [0.24, 0.06, 0.05], [0, 0, k * 0.3]);
          put(head, P.cone4, P.lam('#fff4dc'), [k * 0.14, -0.12, 0.4], [0.06, 0.18, 0.06]);
        }
        put(body, P.cube, skin, [-0.95, 1.3, 0], [0.32, 0.9, 0.32], [0, 0, -0.2]);
        const club = pivot(body, [0.95, 1.7, 0]);
        put(club, P.cube, skin, [0.05, -0.35, 0], [0.32, 0.8, 0.32]);
        const stick = put(club, P.club, P.lam('#8a5a34'), [0.1, -0.6, 0.1], 1, [0.4, 0, 0]);
        for (const [x, y, z] of [
          [0.12, 1.2, 0.15],
          [-0.12, 1.0, 0.1],
          [0.05, 1.35, -0.12],
        ])
          put(stick, P.gem, P.basic('#2a120a'), [x, y, z], 0.06);
        parts.club = club;
        break;
      }
      case 'dragon': {
        const scale = P.lam('#3f8a4a');
        const wingMat = P.lam('#245a33');
        put(body, P.ball, scale, [0, 0, 0], [0.8, 0.7, 1.0]);
        put(body, P.ball, P.lam('#e8c96a'), [0, -0.18, 0.35], [0.55, 0.48, 0.62]);
        for (const z of [0.4, 0, -0.4, -0.8]) put(body, P.cone4, P.lam('#e8335a'), [0, 0.68 - Math.abs(z) * 0.12, z], [0.12, 0.3, 0.12]);
        const head = pivot(body, [0, 0.45, 1.0]);
        parts.head = head;
        put(head, P.ball, P.lam('#4c9f58'), [0, 0, 0], [0.55, 0.48, 0.55]);
        put(head, P.cube, P.lam('#5bb367'), [0, -0.12, 0.52], [0.6, 0.36, 0.6]);
        for (const k of [-1, 1]) {
          put(head, P.cube, P.basic('#1d0f0a'), [k * 0.14, 0.03, 0.83], [0.08, 0.06, 0.04]);
          put(head, P.cone, P.lam('#f3e3c3'), [k * 0.3, 0.55, -0.15], [0.09, 0.5, 0.09], [-0.5, 0, -k * 0.35]);
        }
        eyes(head, 0.24, 0.2, 0.42, 0.13, '#ffd23f');
        parts.breath = put(head, P.ball, P.basic('#ffb03c', 0.85), [0, -0.12, 0.95], 0.32);
        for (const k of [-1, 1]) {
          const wing = pivot(body, [k * 0.55, 0.3, 0]);
          wing.scale.x = k;
          put(wing, P.dragonWing, wingMat, [0, 0, 0]);
          parts[k < 0 ? 'wingL' : 'wingR'] = wing;
          put(body, P.cube, scale, [k * 0.45, -0.65, 0.4], [0.2, 0.4, 0.25]);
        }
        const tail = pivot(body, [0, -0.1, -0.85]);
        parts.tail = tail;
        put(tail, P.cone, scale, [0, 0, -0.55], [0.28, 1.2, 0.28], [-Math.PI / 2, 0, 0]);
        put(tail, P.cone4, P.lam('#e8335a'), [0, 0, -1.2], [0.2, 0.3, 0.06], [-Math.PI / 2, 0, 0]);
        break;
      }
      case 'fireball': {
        put(body, P.ball, P.basic('#fff1b0'), [0, 0, 0], 0.5);
        parts.halo = put(body, P.ball, P.basic('#ff7a1a', 0.55), [0, 0, 0], 0.9);
        break;
      }
    }
    if (kind !== 'fireball') {
      const shadow = blobShadow(kind === 'dragon' ? 1.1 : 0.85, kind === 'dragon' || kind === 'bat' ? 0.22 : 0.32);
      root.add(shadow);
      parts.shadow = shadow;
      this.own.push(shadow.geometry, shadow.material as Material);
    }
    body.name = 'body';
    for (const [k, o] of Object.entries(parts)) o.name = k;
    this.bake(body);
    return { root, own };
  }

  /**
   * Merge the parts that never move on their own (everything not named) into one mesh per group:
   * a monster is a handful of draw calls instead of twenty, which matters with a field full of them.
   */
  private bake(group: Object3D) {
    const lit: BufferGeometry[] = [];
    const unlit: BufferGeometry[] = [];
    for (const child of [...group.children]) {
      const mesh = child as Mesh;
      if (!mesh.isMesh) {
        this.bake(child);
        continue;
      }
      const mat = mesh.material as MeshLambertMaterial | MeshBasicMaterial;
      if (mesh.name || mat.transparent || mat.map) continue;
      mesh.updateMatrix();
      const g = (mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone()).applyMatrix4(mesh.matrix);
      const n = g.attributes.position.count;
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) col.set([mat.color.r, mat.color.g, mat.color.b], i * 3);
      g.setAttribute('color', new Float32BufferAttribute(col, 3));
      g.deleteAttribute('uv');
      (mat.type === 'MeshBasicMaterial' ? unlit : lit).push(g);
      group.remove(mesh);
    }
    for (const [list, mat] of [
      [lit, this.vertexLit],
      [unlit, this.vertexUnlit],
    ] as const) {
      if (!list.length) continue;
      const merged = mergeGeometries(list);
      list.forEach((g) => g.dispose());
      this.own.push(merged);
      group.add(new Mesh(merged, mat));
    }
  }

  private updateMonster(v: MonsterVis, m: Monster, t: number, dt: number) {
    const info = MONSTERS[m.kind];
    const s = info.r / PX;
    v.root.position.set(wx(m.x), 0, wz(m.y));
    v.root.scale.setScalar(s);
    v.body.position.y = hoverHeight(m, t) / s;
    // Turn a little into a sideways step (wolves and bats weave).
    const vx = (m.x - v.lastX) / Math.max(dt, 1e-3);
    v.lastX = m.x;
    const want = m.atWall || m.kind === 'dragon' || m.kind === 'fireball' ? 0 : Math.atan2(vx, Math.max(20, m.speed)) * 0.8;
    v.yaw += (want - v.yaw) * Math.min(1, dt * 8);
    v.root.rotation.y = v.yaw;
    // A squash when an arrow hits.
    const hurt = Math.max(0, 1 - m.hurt / 0.16);
    v.body.scale.set(1 + hurt * 0.2, 1 - hurt * 0.2, 1 + hurt * 0.2);
    const p = v.parts;
    const step = Math.sin(m.age * 9 + m.ph * 6);
    const walk = m.atWall ? 0 : step;
    switch (m.kind) {
      case 'imp': {
        const bash = m.atWall ? Math.sin(t * 14 + m.ph * 6) : 0;
        p.footL.position.y = 0.12 + Math.max(0, walk) * 0.15;
        p.footR.position.y = 0.12 + Math.max(0, -walk) * 0.15;
        p.armL.rotation.x = m.atWall ? -1.6 - Math.max(0, bash) * 1.1 : walk * 0.5;
        p.armR.rotation.x = m.atWall ? -1.6 - Math.max(0, -bash) * 1.1 : -walk * 0.5;
        v.body.position.y += Math.abs(walk) * 0.06;
        break;
      }
      case 'wolf': {
        const run = Math.sin(m.age * 14 + m.ph * 6);
        for (let k = 0; k < 4; k++) p[`leg${k}`].rotation.x = m.atWall ? 0 : run * (k === 0 || k === 3 ? 0.7 : -0.7);
        const bite = m.atWall ? Math.max(0, Math.sin(t * 8 + m.ph * 6)) : 0;
        p.head.rotation.x = -bite * 0.4;
        p.head.position.z = 0.55 + bite * 0.15;
        p.jaw.visible = m.atWall;
        v.body.position.y += Math.abs(run) * 0.05;
        break;
      }
      case 'knight': {
        const swing = m.atWall ? Math.sin(t * 6 + m.ph * 6) : 0;
        p.legL.rotation.x = walk * 0.5;
        p.legR.rotation.x = -walk * 0.5;
        p.sword.rotation.x = m.atWall ? 0.6 + swing * 1.1 : 0.25;
        break;
      }
      case 'bat': {
        const flap = Math.sin(m.age * 16 + m.ph * 6);
        p.wingR.rotation.z = flap * 0.7;
        p.wingL.rotation.z = -flap * 0.7;
        break;
      }
      case 'ghost': {
        const a = ghostAlpha(m);
        for (const mat of v.own) mat.opacity = a;
        p.armL.rotation.y = Math.sin(m.age * 4) * 0.3;
        p.armR.rotation.y = -Math.sin(m.age * 4 + 1) * 0.3;
        p.mouth.scale.y = 0.15 + Math.sin(m.age * 3) * 0.05;
        p.shadow.visible = a > 0.5;
        break;
      }
      case 'giant': {
        const swing = m.atWall ? Math.sin(t * 3 + m.ph * 6) : 0;
        p.legL.rotation.x = walk * 0.35;
        p.legR.rotation.x = -walk * 0.35;
        p.club.rotation.x = m.atWall ? -0.8 - swing * 1.1 : -0.2;
        v.body.position.y += Math.abs(walk) * 0.05;
        break;
      }
      case 'dragon': {
        const flap = Math.sin(m.age * 4);
        p.wingR.rotation.z = flap * 0.55 + 0.1;
        p.wingL.rotation.z = -flap * 0.55 - 0.1;
        p.tail.rotation.y = Math.sin(t * 2) * 0.4;
        const breathing = m.next < 0.6;
        p.breath.visible = breathing;
        if (breathing) p.breath.scale.setScalar(0.25 + (0.6 - m.next) * 0.6 + Math.sin(t * 40) * 0.04);
        p.head.rotation.x = breathing ? 0.35 : 0.1 + Math.sin(t * 1.3) * 0.08;
        break;
      }
      case 'fireball':
        p.halo.scale.setScalar(0.85 + Math.sin(t * 30 + m.ph * 6) * 0.1);
        if (Math.random() < 0.7) {
          const y = hoverHeight(m, t);
          this.glow.add([v.root.position.x + (Math.random() - 0.5) * 0.4, y, v.root.position.z + (Math.random() - 0.5) * 0.4], [0, 0.6, 0], 0.4, 0.45, 0.05, Math.random() < 0.5 ? '#ff9a3c' : '#ffd23f');
        }
        break;
    }
    // A health bar for the tough ones once they've been hit.
    const showBar = m.maxHp > 1 && m.hp < m.maxHp && m.kind !== 'dragon' && (m.kind !== 'ghost' || ghostAlpha(m) > 0.5);
    if (showBar && !v.bar) {
      const group = new Group();
      const back = put(group, this.parts.cube, this.barMat('#14060a'), [0, 0, -0.01], [1, 0.26, 0.01]);
      const fill = put(group, this.parts.cube, this.barMat('#a3e048'), [0, 0, 0], [0.92, 0.16, 0.01]);
      back.renderOrder = 5;
      fill.renderOrder = 6;
      this.stage.add(group);
      v.bar = { group, fill };
    }
    if (v.bar) {
      v.bar.group.visible = showBar;
      if (showBar) {
        const w = Math.max(1.3, (info.r * 1.5) / PX);
        const k = Math.max(0, m.hp / m.maxHp);
        v.bar.group.position.set(v.root.position.x, hoverHeight(m, t) + TOP[m.kind] * s + 0.35, v.root.position.z);
        v.bar.group.quaternion.copy(this.stage.camera.quaternion);
        v.bar.group.scale.set(w, w, 1);
        v.bar.fill.scale.x = 0.92 * k;
        v.bar.fill.position.x = -0.46 * (1 - k);
        v.bar.fill.material = this.barMat(k > 0.5 ? '#a3e048' : k > 0.25 ? '#ffc93c' : '#e8335a');
      }
    }
  }

  /** Health bar colours: drawn over everything. */
  private barMat(color: string) {
    let m = this.bars.get(color);
    if (!m) {
      this.bars.set(color, (m = new MeshBasicMaterial({ color, depthTest: false })));
      this.own.push(m);
    }
    return m;
  }

  private removeMonster(v: MonsterVis) {
    v.root.removeFromParent();
    v.bar?.group.removeFromParent();
    v.own.forEach((m) => m.dispose());
  }

  // ---- arrows ------------------------------------------------------------------------

  private buildArrow(owner: number, charged: boolean): Group {
    const key = `${owner}|${charged}`;
    let tpl = this.arrowTemplates.get(key);
    if (!tpl) this.arrowTemplates.set(key, (tpl = this.arrowTemplate(owner, charged)));
    const g = tpl.clone();
    this.stage.add(g);
    return g;
  }

  private arrowTemplate(owner: number, charged: boolean): Group {
    const P = this.parts;
    const g = new Group();
    // Chunky, so it reads from the far end of the room.
    put(g, P.cube, P.lam(charged ? GOLD : '#e8d2a8'), [0, 0, -0.65], [0.13, 0.13, 1.4]);
    put(g, P.cone4, P.lam('#c9ccd3'), [0, 0, 0.18], [0.17, 0.36, 0.17], [Math.PI / 2, 0, 0]);
    const fletch = this.archers[owner]?.fletch ?? P.basic('#fff');
    put(g, P.cube, fletch, [0, 0, -1.2], [0.4, 0.05, 0.3]);
    put(g, P.cube, fletch, [0, 0, -1.2], [0.05, 0.4, 0.3]);
    if (charged) put(g, P.cube, P.basic(GOLD, 0.35), [0, 0, -1.6], [0.32, 0.32, 2.6]);
    this.bake(g);
    return g;
  }

  // ---- per frame ---------------------------------------------------------------------

  update(sim: CastleSim, dt: number) {
    this.clock += dt;
    const t = sim.t;
    // The wall: merlons crumble as it wears down, and lie in front of it.
    const worn = 1 - sim.wall / sim.wallMax;
    let fallen = 0;
    for (const mm of this.merlons) {
      mm.mesh.visible = worn < mm.wear;
      if (!mm.mesh.visible) fallen++;
    }
    if (fallen !== this.rubble.count) {
      const rng = mulberry32(99);
      const d = new Object3D();
      const down = this.merlons.filter((mm) => !mm.mesh.visible);
      down.forEach((mm, k) => {
        if (k >= 60) return;
        d.position.set(mm.mesh.position.x + (rng() - 0.5) * 1.4, 0.18, FACE_Z - 0.4 - rng() * 1.2);
        d.rotation.set(rng() * 3, rng() * 3, rng() * 3);
        d.scale.set(0.45, 0.3, 0.35);
        d.updateMatrix();
        this.rubble.setMatrixAt(k, d.matrix);
      });
      this.rubble.count = Math.min(60, down.length);
      this.rubble.instanceMatrix.needsUpdate = true;
    }

    sim.archers.forEach((a, i) => {
      const v = this.archers[i];
      if (v) this.updateArcher(v, a, this.looks[i], sim.t >= a.readyAt && !sim.over, this.clock);
    });

    const seen = new Set<number>();
    for (const m of sim.monsters) {
      seen.add(m.id);
      let v = this.monsters.get(m.id);
      if (!v) this.monsters.set(m.id, (v = this.buildMonster(m)));
      this.updateMonster(v, m, t, dt);
    }
    for (const [id, v] of this.monsters)
      if (!seen.has(id)) {
        this.removeMonster(v);
        this.monsters.delete(id);
      }

    const flying = new Set<number>();
    for (const ar of sim.arrows) {
      flying.add(ar.id);
      let v = this.arrows.get(ar.id);
      if (!v) this.arrows.set(ar.id, (v = { group: this.buildArrow(ar.owner, ar.charged), total: ar.left + ar.speed / 60 }));
      const d = v.total - ar.left;
      const x = wx(ar.x);
      const z = wz(ar.y);
      if (ar.stuck >= 0) {
        // Stuck in the ground, tail up, sinking away.
        v.group.position.set(x, 0.3 - ar.stuck * 0.25, z);
        v.group.lookAt(x + ar.dx * 0.6, -0.3 - ar.stuck * 0.25, z + ar.dy * 0.6);
      } else {
        const y = arrowHeight(d, ar.left);
        const y1 = arrowHeight(d + 0.3, ar.left - 0.3);
        v.group.position.set(x, y, z);
        v.group.lookAt(x + ar.dx * 0.3, y1, z + ar.dy * 0.3);
        if (ar.charged && Math.random() < 0.6) this.glow.add([x, y, z], [0, 0.3, 0], 0.35, 0.12, 0.02, GOLD);
      }
    }
    for (const [id, v] of this.arrows)
      if (!flying.has(id)) {
        v.group.removeFromParent();
        this.arrows.delete(id);
      }

    this.glow.update(dt);
    this.puffs.update(dt);
    this.shake = Math.max(0, this.shake - dt * 30);
    const cam = this.stage.camera;
    const k = this.shake / 60;
    cam.position.set(this.camBase.x + (Math.random() - 0.5) * k, this.camBase.y + (Math.random() - 0.5) * k, this.camBase.z);
    this.stage.render();
  }

  /** Bursts, dust and sparks for what just happened. */
  handle(events: CEvent[], sim: CastleSim, colorOf: (i: number) => string) {
    for (const ev of events) {
      switch (ev.e) {
        case 'shoot': {
          const a = sim.archers[ev.by];
          if (!a) break;
          const [dx, dy] = aimVector(a.aim);
          this.puff(wx(a.x) + dx * 0.8, BOW_H, ARCHER_Z + dy * 0.8, 2, '#f3ead8', 0.6, 0.18);
          break;
        }
        case 'skill':
          if (ev.on) {
            const a = sim.archers[ev.by];
            if (a) this.sparks(wx(a.x), WALK_H + 0.8, ARCHER_Z, 24, GOLD, 5);
          }
          break;
        case 'hit':
          this.sparks(wx(ev.x), this.bodyY(ev.kind), wz(ev.y), 8, '#fff4dc', 4);
          break;
        case 'kill': {
          const big = ev.kind === 'dragon';
          const y = this.bodyY(ev.kind);
          this.sparks(wx(ev.x), y, wz(ev.y), big ? 70 : 16, colorOf(ev.by), big ? 12 : 6);
          this.puff(wx(ev.x), y, wz(ev.y), big ? 26 : 7, ev.kind === 'fireball' ? '#5a4a40' : '#efe6d6', big ? 3 : 1.4, big ? 1.2 : 0.45);
          if (big) this.shake = 24;
          break;
        }
        case 'wall':
          if (ev.kind === 'fireball') {
            this.sparks(wx(ev.x), WALK_H + 0.8, FACE_Z + 0.3, 30, '#ff9a3c', 8);
            this.puff(wx(ev.x), WALK_H + 0.6, FACE_Z, 10, '#4a3a33', 2, 0.7);
            this.shake = Math.max(this.shake, 14);
          } else {
            this.puff(wx(ev.x), 1.2, FACE_Z - 0.2, 5, '#cbbd9f', 1.5, 0.4);
            this.shake = Math.max(this.shake, ev.kind === 'giant' ? 12 : 3);
          }
          break;
        case 'fire':
          this.sparks(wx(ev.x), DRAGON_H + 0.6, wz(ev.y) + 2.6, 14, '#ffb03c', 4);
          break;
        case 'summon':
          this.puff(wx(ev.x), DRAGON_H, wz(ev.y), 14, '#6b4590', 2.5, 0.6);
          break;
        case 'lost':
          this.shake = 30;
          for (let k = 0; k < 16; k++) this.puff(wx(W * Math.random()), WALK_H, FACE_Z + 0.5, 4, '#b8a58a', 2.5, 0.8);
          break;
      }
    }
  }

  /** Roughly where a monster of this kind has its middle, above the ground. */
  private bodyY(kind: MonsterKind) {
    const s = MONSTERS[kind].r / PX;
    switch (kind) {
      case 'bat':
        return BAT_H;
      case 'dragon':
        return DRAGON_H;
      case 'fireball':
        return WALK_H + 1;
      default:
        return s;
    }
  }

  private sparks(x: number, y: number, z: number, n: number, color: string, speed: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const up = Math.random();
      const v = speed * (0.4 + Math.random() * 0.8);
      this.glow.add([x, y, z], [Math.cos(a) * v * (1 - up * 0.5), up * v, Math.sin(a) * v * (1 - up * 0.5)], 0.35 + Math.random() * 0.35, 0.12 + Math.random() * 0.1, 0.02, color, 9);
    }
  }

  private puff(x: number, y: number, z: number, n: number, color: string, spread: number, size: number) {
    for (let i = 0; i < n; i++)
      this.puffs.add(
        [x + (Math.random() - 0.5) * spread * 0.5, y + Math.random() * 0.3, z + (Math.random() - 0.5) * spread * 0.5],
        [(Math.random() - 0.5) * spread, 0.6 + Math.random() * 1.2, (Math.random() - 0.5) * spread],
        0.6 + Math.random() * 0.5,
        size,
        size * 1.8,
        color,
        -0.4,
      );
  }

  /** Where the spot just over a monster of this kind at (x, y) on the plan lands on the stage. */
  pointOver(kind: MonsterKind, x: number, y: number) {
    const s = MONSTERS[kind].r / PX;
    const h = this.bodyY(kind) + TOP[kind] * s * 0.6 + 0.4;
    return this.stage.toStage(new Vector3(wx(x), h, wz(y)));
  }

  /** Over an archer's head. */
  pointOverArcher(x: number) {
    return this.stage.toStage(new Vector3(wx(x), WALK_H + 3, ARCHER_Z));
  }
}

/** A flat strip along a path on the ground, `w` metres wide. */
function ribbon(pts: Vector3[], w: number) {
  const pos: number[] = [];
  const idx: number[] = [];
  pts.forEach((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l = Math.hypot(dx, dz) || 1;
    const nx = (-dz / l) * (w / 2);
    const nz = (dx / l) * (w / 2);
    pos.push(p.x + nx, p.y, p.z + nz, p.x - nx, p.y, p.z - nz);
    if (i > 0) {
      const k = i * 2;
      idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
    }
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Face up whichever way the strip was wound.
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return g;
}
