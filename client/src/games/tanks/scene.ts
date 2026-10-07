/** Czołgi on screen: farmyard arena, chunky toy tanks, shells, cabbage mortars and lots of puffs. */
import {
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  BackSide,
  DoubleSide,
  DynamicDrawUsage,
  Euler,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  NearestFilter,
  Object3D,
  PlaneGeometry,
  RepeatWrapping,
  RingGeometry,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  type BufferGeometry,
  type Material,
  type Sprite,
  type Texture,
} from 'three';
import { ARENA_SCALE, ArenaStage, blobShadow, buildPierogi, flat, groundTexture, nameTag, noise, pixelTexture, type PierogiModel } from '../arena/kit';
import { CRATE_HALF, HX, HZ, TUNING, type Layout, type Ob, type TankEvent, type TanksSim } from './logic';

export { ARENA_SCALE };

export interface Look {
  name: string;
  color: string;
}

// ---------------------------------------------------------------------------
// textures
// ---------------------------------------------------------------------------

function canvasTex(w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void, repeat = true) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  paint(c.getContext('2d')!);
  const t = new CanvasTexture(c);
  t.magFilter = t.minFilter = NearestFilter;
  if (repeat) t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Scale a box's UVs so a texture tiles once per `k` metres whatever the box size. */
function scaleUV(geo: BoxGeometry, w: number, h: number, d: number, k: number) {
  const uv = geo.attributes.uv;
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z; four vertices each.
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

function texBox(w: number, h: number, d: number, mat: Material, k = 1.6) {
  const m = new Mesh(scaleUV(new BoxGeometry(w, h, d), w, h, d, k), mat);
  m.position.y = h / 2;
  return m;
}

const charred = new Color('#2f2724');
const charredDark = new Color('#403632');

// ---------------------------------------------------------------------------
// particles: three instanced meshes (puffs, chunks, glow) so the whole show is three draw calls
// ---------------------------------------------------------------------------

interface P {
  kind: 0 | 1 | 2;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  rx: number;
  ry: number;
  rz: number;
  vr: number;
  life: number;
  max: number;
  s0: number;
  s1: number;
  color: Color;
  g: number;
  drag: number;
}

const KIND_MAX = [260, 200, 200];

class Particles {
  readonly group = new Group();
  private meshes: InstancedMesh[];
  private list: P[] = [];
  private counts = [0, 0, 0];
  private tmp = new Object3D();
  private euler = new Euler();

  constructor() {
    const geos: BufferGeometry[] = [new IcosahedronGeometry(1, 0), new BoxGeometry(1, 1, 1), new IcosahedronGeometry(1, 0)];
    const mats: Material[] = [
      new MeshLambertMaterial({ color: '#fff', flatShading: true }),
      new MeshLambertMaterial({ color: '#fff', flatShading: true }),
      new MeshBasicMaterial({ color: '#fff' }),
    ];
    this.meshes = geos.map((g, k) => {
      const m = new InstancedMesh(g, mats[k], KIND_MAX[k]);
      m.instanceMatrix.setUsage(DynamicDrawUsage);
      m.count = 0;
      m.frustumCulled = false;
      m.setColorAt(0, new Color('#fff'));
      this.group.add(m);
      return m;
    });
  }

  clear() {
    this.list = [];
    this.counts = [0, 0, 0];
  }

  add(
    kind: 0 | 1 | 2,
    pos: [number, number, number],
    vel: [number, number, number],
    life: number,
    s0: number,
    s1: number,
    color: string | Color,
    g = 0,
    drag = 0,
  ) {
    if (this.counts[kind] >= KIND_MAX[kind]) return;
    this.counts[kind]++;
    this.list.push({
      kind,
      x: pos[0],
      y: pos[1],
      z: pos[2],
      vx: vel[0],
      vy: vel[1],
      vz: vel[2],
      rx: Math.random() * 6,
      ry: Math.random() * 6,
      rz: Math.random() * 6,
      vr: (Math.random() - 0.5) * 12,
      life,
      max: life,
      s0,
      s1,
      color: new Color(color),
      g,
      drag,
    });
  }

  update(dt: number) {
    const idx = [0, 0, 0];
    const keep: P[] = [];
    for (const p of this.list) {
      p.life -= dt;
      if (p.life <= 0) {
        this.counts[p.kind]--;
        continue;
      }
      const dk = Math.exp(-p.drag * dt);
      p.vx *= dk;
      p.vz *= dk;
      p.vy = p.vy * dk - p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.kind === 1 && p.y < 0.12) {
        p.y = 0.12;
        p.vy *= -0.35;
        p.vx *= 0.6;
        p.vz *= 0.6;
        p.vr *= 0.5;
      }
      p.rx += p.vr * dt;
      p.rz += p.vr * dt * 0.7;
      const u = 1 - p.life / p.max;
      const fade = u > 0.65 ? (1 - u) / 0.35 : 1;
      const s = (p.s0 + (p.s1 - p.s0) * u) * fade;
      const m = this.meshes[p.kind];
      const i = idx[p.kind]++;
      this.tmp.position.set(p.x, p.y, p.z);
      this.euler.set(p.rx, p.ry, p.rz);
      this.tmp.rotation.copy(this.euler);
      this.tmp.scale.setScalar(Math.max(0.001, s));
      this.tmp.updateMatrix();
      m.setMatrixAt(i, this.tmp.matrix);
      m.setColorAt(i, p.color);
      keep.push(p);
    }
    this.list = keep;
    this.meshes.forEach((m, k) => {
      m.count = idx[k];
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    });
  }

  dispose() {
    for (const m of this.meshes) {
      m.geometry.dispose();
      (m.material as Material).dispose();
      m.dispose();
    }
  }
}

// ---------------------------------------------------------------------------
// tanks
// ---------------------------------------------------------------------------

interface TankVis {
  root: Group;
  hull: Group;
  turret: Group;
  barrel: Group;
  body: Group;
  pier: PierogiModel;
  pierHolder: Group;
  tag: Sprite;
  shadow: Mesh;
  shield: Mesh;
  mats: { main: MeshLambertMaterial; dark: MeshLambertMaterial };
  texL: Texture;
  texR: Texture;
  color: Color;
  recoil: number;
  smoke: number;
  dist: number;
  lastH: number;
  dead: boolean;
  /** Popped-out pierogi after the explosion. */
  flying: null | { x: number; y: number; z: number; vx: number; vy: number; vz: number; spin: number; landed: boolean };
  squash: number;
}

interface ShellVis {
  group: Group;
  mesh: Mesh;
}

interface MortarVis {
  cab: Group;
  shadow: Mesh;
  ring: Group;
  shrink: Mesh;
  disc: Mesh;
  outer: Mesh;
}

export class TanksScene {
  readonly stage: ArenaStage;
  private tanks: TankVis[] = [];
  private fx = new Particles();
  private obGroup = new Group();
  private obMeshes = new Map<number, Group>();
  private shellMeshes: ShellVis[] = [];
  private shellGeo = new SphereGeometry(0.4, 7, 5);
  private shellOutline: MeshBasicMaterial;
  private shellMats: MeshBasicMaterial[];
  private mortars = new Map<number, MortarVis>();
  private scorch: Mesh[] = [];
  private scorchAt = 0;
  private shocks: { mesh: Mesh; age: number; max: number; r: number }[] = [];
  private shake = 0;
  private cam = new Vector3();
  private camBase = new Vector3();
  private clock = 0;
  private tex: Record<string, Texture> = {};
  private mat: Record<string, MeshLambertMaterial> = {};
  private ringMat = new MeshBasicMaterial({ color: '#ff3b30', transparent: true, opacity: 0.8, depthWrite: false, side: DoubleSide });
  private discMat = new MeshBasicMaterial({ color: '#ff3b30', transparent: true, opacity: 0.2, depthWrite: false, side: DoubleSide });
  private shockMat = new MeshBasicMaterial({ color: '#ffe9a8', transparent: true, opacity: 0.6, depthWrite: false, side: DoubleSide });
  private scorchMat = new MeshBasicMaterial({ color: '#1b100b', transparent: true, opacity: 0.4, depthWrite: false });
  private cabGeo = new IcosahedronGeometry(0.62, 1);
  private cabCore = new IcosahedronGeometry(0.4, 0);
  private cabMats = [new MeshLambertMaterial({ color: '#79b936', flatShading: true }), new MeshLambertMaterial({ color: '#c9ec7a', flatShading: true })];

  constructor(
    canvas: HTMLCanvasElement,
    private looks: Look[],
  ) {
    this.stage = new ArenaStage(canvas, { sky: '#f2b38a', fog: [78, 200], fov: 40 });
    const s = this.stage;
    s.lookAt(new Vector3(0, 0, 0.9), 43, 1.04);
    this.camBase.copy(s.camera.position);
    this.buildGround();
    s.world.add(this.obGroup, this.fx.group);
    this.shellMats = looks.map((l) => new MeshBasicMaterial({ color: l.color }));
    const outline = new MeshBasicMaterial({ color: '#2a120a', side: BackSide });
    this.shellOutline = outline;
    for (let i = 0; i < 20; i++) {
      const group = new Group();
      const mesh = new Mesh(this.shellGeo, this.shellMats[0]);
      const rim = new Mesh(this.shellGeo, outline);
      rim.scale.setScalar(1.3);
      group.add(mesh, rim);
      group.visible = false;
      s.world.add(group);
      this.shellMeshes.push({ group, mesh });
    }
    for (let i = 0; i < 12; i++) {
      const m = new Mesh(new CircleGeometry(1, 9), this.scorchMat);
      m.rotation.x = -Math.PI / 2;
      m.position.y = 0.045;
      m.visible = false;
      s.world.add(m);
      this.scorch.push(m);
    }
    for (let i = 0; i < 6; i++) {
      const m = new Mesh(new RingGeometry(0.85, 1, 20), this.shockMat);
      m.rotation.x = -Math.PI / 2;
      m.position.y = 0.09;
      m.visible = false;
      s.world.add(m);
      this.shocks.push({ mesh: m, age: 9, max: 0.5, r: 3 });
    }
    s.keep({ dispose: () => this.disposeAll() });
    this.looks.forEach((l, i) => this.tanks.push(this.buildTank(l, i)));
  }

  private disposeAll() {
    this.fx.dispose();
    for (const t of Object.values(this.tex)) t.dispose();
    for (const m of Object.values(this.mat)) m.dispose();
    this.ringMat.dispose();
    this.discMat.dispose();
    this.shockMat.dispose();
    this.scorchMat.dispose();
    this.shellGeo.dispose();
    this.shellMats.forEach((m) => m.dispose());
    this.shellOutline.dispose();
    this.cabGeo.dispose();
    this.cabCore.dispose();
    this.cabMats.forEach((m) => m.dispose());
    for (const t of this.tanks) {
      t.texL.dispose();
      t.texR.dispose();
      t.mats.main.dispose();
      t.mats.dark.dispose();
      t.pier.mats.forEach((m) => m.dispose());
    }
  }

  dispose() {
    this.stage.dispose();
  }

  // ---- static scenery -----------------------------------------------------------

  private M(key: string, make: () => MeshLambertMaterial) {
    return (this.mat[key] ??= make());
  }

  private T(key: string, make: () => Texture) {
    return (this.tex[key] ??= make());
  }

  private buildGround() {
    const w = this.stage.world;
    // Packed earth with tufts of grass.
    const earth = this.T('earth', () => {
      const t = pixelTexture(
        16,
        (ctx, rnd) => {
          noise(ctx, rnd, 16, [176, 140, 92], 26);
          for (let i = 0; i < 26; i++) {
            ctx.fillStyle = rnd() < 0.5 ? 'rgba(98,140,60,.85)' : 'rgba(120,84,52,.55)';
            ctx.fillRect(Math.floor(rnd() * 16), Math.floor(rnd() * 16), 1, 1);
          }
        },
        7,
      );
      t.repeat.set(ARENA_W_TILES, ARENA_H_TILES);
      return t;
    });
    const ground = new Mesh(new PlaneGeometry(HX * 2, HZ * 2), new MeshLambertMaterial({ map: earth }));
    ground.rotation.x = -Math.PI / 2;
    w.add(ground);
    const grass = this.T('grass', () => {
      const t = groundTexture('grass', 1, 5);
      t.repeat.set(70, 40);
      return t;
    });
    const outer = new Mesh(new PlaneGeometry(260, 160), new MeshLambertMaterial({ map: grass }));
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -0.04;
    w.add(outer);

    // A low stone wall all the way round, with a cap and a post at each corner.
    const stone = this.M('stone', () => new MeshLambertMaterial({ map: this.T('stone', () => groundTexture('stone', 1, 4)), flatShading: true }));
    const cap = this.M('cap', () => new MeshLambertMaterial({ color: '#bdb2a0', flatShading: true }));
    const T = 1;
    const H = 1.05;
    const sides: [number, number, number, number][] = [
      [0, -HZ - T / 2, HX * 2 + T * 2, T],
      [0, HZ + T / 2, HX * 2 + T * 2, T],
      [-HX - T / 2, 0, T, HZ * 2],
      [HX + T / 2, 0, T, HZ * 2],
    ];
    for (const [x, z, sw, sd] of sides) {
      const m = texBox(sw, H, sd, stone);
      m.position.x = x;
      m.position.z = z;
      const c = new Mesh(new BoxGeometry(sw + 0.1, 0.18, sd + 0.1), cap);
      c.position.set(x, H + 0.09, z);
      w.add(m, c);
    }
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const p = texBox(1.5, 1.8, 1.5, stone);
        p.position.x = sx * (HX + T / 2);
        p.position.z = sz * (HZ + T / 2);
        const c = new Mesh(new BoxGeometry(1.7, 0.22, 1.7), cap);
        c.position.set(p.position.x, 1.91, p.position.z);
        w.add(p, c);
      }
    // Wooden fence behind the wall for the farmyard feel.
    const wood = this.M('fence', () => new MeshLambertMaterial({ color: '#8a5a33', flatShading: true }));
    const posts = new InstancedMesh(new BoxGeometry(0.3, 1.9, 0.3), wood, 120);
    const d = new Object3D();
    let n = 0;
    const FZ = HZ + T + 1.2;
    const FX = HX + T + 1.2;
    for (let x = -FX; x <= FX + 0.01; x += 2.2) for (const z of [-FZ, FZ]) {
      d.position.set(x, 0.95, z);
      d.updateMatrix();
      posts.setMatrixAt(n++, d.matrix);
    }
    for (let z = -FZ + 2.2; z < FZ - 0.01; z += 2.2) for (const x of [-FX, FX]) {
      d.position.set(x, 0.95, z);
      d.updateMatrix();
      posts.setMatrixAt(n++, d.matrix);
    }
    posts.count = n;
    posts.frustumCulled = false;
    w.add(posts);
    for (const y of [0.65, 1.35]) {
      for (const z of [-FZ, FZ]) {
        const r = new Mesh(new BoxGeometry(FX * 2, 0.14, 0.12), wood);
        r.position.set(0, y, z);
        w.add(r);
      }
      for (const x of [-FX, FX]) {
        const r = new Mesh(new BoxGeometry(0.12, 0.14, FZ * 2), wood);
        r.position.set(x, y, 0);
        w.add(r);
      }
    }
  }

  /** Build the obstacles of a new round and reset all the moving parts. */
  setLayout(layout: Layout) {
    this.obGroup.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh) m.geometry.dispose();
    });
    this.obGroup.clear();
    this.obMeshes.clear();
    for (const o of layout.obstacles) {
      const g = this.buildOb(o);
      this.obGroup.add(g);
      this.obMeshes.set(o.id, g);
    }
    this.fx.clear();
    for (const s of this.scorch) s.visible = false;
    for (const [, m] of this.mortars) this.removeMortar(m);
    this.mortars.clear();
    this.shake = 0;
    for (const t of this.tanks) this.reviveTank(t);
  }

  private buildOb(o: Ob): Group {
    const g = new Group();
    g.position.set(o.x, 0, o.z);
    const stone = this.M('stone', () => new MeshLambertMaterial({ map: this.T('stone', () => groundTexture('stone', 1, 4)), flatShading: true }));
    const cap = this.M('cap', () => new MeshLambertMaterial({ color: '#bdb2a0', flatShading: true }));
    const hayMat = this.M('hay', () => new MeshLambertMaterial({ map: this.T('hay', () => hayTexture()), flatShading: true }));
    const band = this.M('band', () => new MeshLambertMaterial({ color: '#a5462e', flatShading: true }));
    const wood = this.M('wood', () => new MeshLambertMaterial({ map: this.T('wood', () => groundTexture('wood', 1, 9)), flatShading: true }));
    const dark = this.M('darkwood', () => new MeshLambertMaterial({ color: '#6b4524', flatShading: true }));
    const roof = this.M('roof', () => new MeshLambertMaterial({ color: '#b5472f', flatShading: true }));
    if (o.kind === 'wall') {
      const h = 1.5;
      const w = texBox(o.hx * 2, h, o.hz * 2, stone);
      const c = new Mesh(new BoxGeometry(o.hx * 2 + 0.16, 0.2, o.hz * 2 + 0.16), cap);
      c.position.y = h + 0.1;
      g.add(w, c);
    } else if (o.kind === 'hay') {
      const r = o.hz / 2;
      const len = o.hx * 2;
      const bale = (z: number, y: number) => {
        const cyl = new Mesh(new CylinderGeometry(r, r, len, 9), hayMat);
        cyl.rotation.z = Math.PI / 2;
        cyl.position.set(0, y, z);
        g.add(cyl);
        for (const x of [-len * 0.28, len * 0.28]) {
          const b = new Mesh(new CylinderGeometry(r * 1.03, r * 1.03, 0.14, 9), band);
          b.rotation.z = Math.PI / 2;
          b.position.set(x, y, z);
          g.add(b);
        }
      };
      bale(-r, r);
      bale(r, r);
      bale(0, r + r * 1.62);
    } else if (o.kind === 'well') {
      const r = o.hx;
      const ring = new Mesh(new CylinderGeometry(r, r * 1.05, 1.0, 8), stone);
      ring.position.y = 0.5;
      const water = new Mesh(new CylinderGeometry(r * 0.78, r * 0.78, 0.05, 8), new MeshBasicMaterial({ color: '#2f6f96' }));
      water.position.y = 0.97;
      g.add(ring, water);
      for (const s of [-1, 1]) {
        const post = new Mesh(new BoxGeometry(0.18, 2.2, 0.18), dark);
        post.position.set(s * r * 0.82, 1.6, 0);
        g.add(post);
      }
      const beam = new Mesh(new BoxGeometry(r * 1.9, 0.16, 0.18), dark);
      beam.position.y = 2.6;
      const top = new Mesh(new ConeGeometry(r * 1.25, 0.8, 4), roof);
      top.rotation.y = Math.PI / 4;
      top.position.y = 3.05;
      const bucket = new Mesh(new CylinderGeometry(0.2, 0.16, 0.3, 6), wood);
      bucket.position.set(0, 1.9, 0);
      g.add(beam, top, bucket);
    } else if (o.kind === 'shed') {
      const h = 1.7;
      const body = texBox(o.hx * 2, h, o.hz * 2, wood);
      g.add(body);
      for (const s of [-1, 1]) {
        const slope = new Mesh(new BoxGeometry(o.hx * 2 + 0.5, 0.14, o.hz * 1.25), roof);
        slope.position.set(0, h + o.hz * 0.3, s * o.hz * 0.52);
        slope.rotation.x = -s * 0.5;
        g.add(slope);
      }
      const door = new Mesh(new BoxGeometry(Math.min(1.1, o.hx), 1.2, 0.06), dark);
      door.position.set(0, 0.6, o.hz + 0.02);
      g.add(door);
    } else if (o.kind === 'crate') {
      const s = CRATE_HALF * 2;
      const c = texBox(s, s, s, wood, 1.6);
      const t = 0.16;
      g.add(c);
      for (const [sx, sz] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ]) {
        const post = new Mesh(new BoxGeometry(t, s + 0.04, t), dark);
        post.position.set(sx * (CRATE_HALF - t / 2 + 0.01), s / 2, sz * (CRATE_HALF - t / 2 + 0.01));
        g.add(post);
      }
      for (const y of [0.1, s - 0.1]) {
        const rim = new Mesh(new BoxGeometry(s + 0.02, 0.12, s + 0.02), dark);
        rim.position.y = y;
        g.add(rim);
      }
    }
    return g;
  }

  // ---- tanks --------------------------------------------------------------------

  private buildTank(look: Look, i: number): TankVis {
    const base = new Color(look.color);
    const main = flat(look.color);
    const dark = flat(base.clone().multiplyScalar(0.78).getStyle());
    const metal = this.M('metal', () => flat('#4a4440'));
    const steel = this.M('steel', () => flat('#8a8480'));
    const trackSide = this.T('trackSide', () =>
      canvasTex(
        32,
        8,
        (ctx) => {
          ctx.fillStyle = '#2b2523';
          ctx.fillRect(0, 0, 32, 8);
          ctx.fillStyle = '#77706a';
          for (let k = 0; k < 4; k++) {
            const cx = 4 + k * 8;
            ctx.fillRect(cx - 2, 2, 4, 4);
            ctx.fillRect(cx - 1, 1, 2, 6);
          }
          ctx.fillStyle = '#3d3532';
          ctx.fillRect(0, 0, 32, 1);
          ctx.fillRect(0, 7, 32, 1);
        },
        false,
      ),
    );
    const cleat = () =>
      canvasTex(4, 8, (ctx) => {
        ctx.fillStyle = '#2b2523';
        ctx.fillRect(0, 0, 4, 8);
        ctx.fillStyle = '#4d4541';
        for (const y of [0, 4]) ctx.fillRect(0, y, 4, 2);
      });
    const texL = cleat();
    const texR = cleat();
    texL.repeat.set(1, 4);
    texR.repeat.set(1, 4);
    const sideMat = this.M('trackSideMat', () => new MeshLambertMaterial({ map: trackSide, flatShading: true }));
    const dkMat = this.M('trackDark', () => flat('#2b2523'));
    const trackMats = (tex: Texture) => [sideMat, sideMat, new MeshLambertMaterial({ map: tex, flatShading: true }), dkMat, dkMat, dkMat];

    const root = new Group();
    const hull = new Group();
    const body = new Group();
    hull.add(body);
    for (const [s, tex] of [
      [-1, texL],
      [1, texR],
    ] as const) {
      const tr = new Mesh(new BoxGeometry(0.56, 0.66, 2.7), trackMats(tex));
      tr.position.set(s * 0.98, 0.33, 0);
      body.add(tr);
    }
    const lower = new Mesh(new BoxGeometry(1.5, 0.5, 2.15), main);
    lower.position.y = 0.72;
    const deck = new Mesh(new BoxGeometry(1.7, 0.16, 2.35), dark);
    deck.position.y = 1.0;
    body.add(lower, deck);
    // Headlights and an engine grille so you can tell front from back.
    const lamp = this.M('lamp', () => new MeshLambertMaterial({ color: '#ffe9a0', emissive: '#ffd860', flatShading: true }));
    for (const s of [-1, 1]) {
      const l = new Mesh(new BoxGeometry(0.28, 0.2, 0.1), lamp);
      l.position.set(s * 0.5, 0.78, 1.1);
      body.add(l);
    }
    const grille = new Mesh(new BoxGeometry(1.1, 0.26, 0.1), metal);
    grille.position.set(0, 0.8, -1.1);
    body.add(grille);

    const turret = new Group();
    turret.position.y = 1.08;
    const ring = new Mesh(new CylinderGeometry(0.66, 0.78, 0.52, 8), main);
    ring.position.y = 0.26;
    const lid = new Mesh(new CylinderGeometry(0.5, 0.62, 0.12, 8), dark);
    lid.position.y = 0.58;
    turret.add(ring, lid);
    const barrel = new Group();
    barrel.position.set(0, 0.3, 0.45);
    const tube = new Mesh(new CylinderGeometry(0.14, 0.16, 1.5, 6), metal);
    tube.rotation.x = Math.PI / 2;
    tube.position.z = 0.75;
    const muzzle = new Mesh(new CylinderGeometry(0.2, 0.2, 0.3, 6), steel);
    muzzle.rotation.x = Math.PI / 2;
    muzzle.position.z = 1.45;
    barrel.add(tube, muzzle);
    turret.add(barrel);
    // The hatch, with the driver peeking out of it. It looks at the camera, which is friendlier.
    const hatch = new Mesh(new CylinderGeometry(0.34, 0.36, 0.16, 8), metal);
    hatch.position.set(0, 0.62, -0.18);
    turret.add(hatch);
    const pier = buildPierogi(look.color);
    pier.shadow.visible = false;
    const pierHolder = new Group();
    pierHolder.position.set(0, 0.5, -0.18);
    pierHolder.scale.setScalar(0.45);
    pierHolder.add(pier.root);
    turret.add(pierHolder);
    hull.add(turret);
    root.scale.setScalar(1.12);
    root.add(hull);

    const shadow = blobShadow(1.7, 0.38);
    shadow.scale.set(1, 1.2, 1);
    root.add(shadow);
    const tag = nameTag(look.name, look.color, 4.2);
    tag.position.y = 3.3;
    root.add(tag);
    const shield = new Mesh(
      new IcosahedronGeometry(1.9, 1),
      new MeshLambertMaterial({
        color: '#ffffff',
        emissive: base.clone().lerp(new Color('#ffffff'), 0.35),
        emissiveIntensity: 0.8,
        transparent: true,
        opacity: 0.33,
        depthWrite: false,
        flatShading: true,
      }),
    );
    shield.position.y = 1.1;
    shield.scale.set(1, 0.75, 1.2);
    root.add(shield);
    this.stage.world.add(root);
    void i;
    return {
      root,
      hull,
      turret,
      barrel,
      body,
      pier,
      pierHolder,
      tag,
      shadow,
      shield,
      mats: { main, dark },
      texL,
      texR,
      color: base,
      recoil: 0,
      smoke: 0,
      dist: 0,
      lastH: 0,
      dead: false,
      flying: null,
      squash: 0,
    };
  }

  private reviveTank(t: TankVis) {
    t.dead = false;
    t.flying = null;
    t.recoil = 0;
    t.smoke = 0;
    t.dist = 0;
    t.squash = 0;
    t.mats.main.color.set(t.color);
    t.mats.dark.color.copy(t.color).multiplyScalar(0.78);
    t.mats.main.emissive.setScalar(0);
    t.mats.dark.emissive.setScalar(0);
    if (t.pierHolder.parent !== t.turret) t.turret.add(t.pierHolder);
    t.pierHolder.position.set(0, 0.5, -0.18);
    t.pierHolder.rotation.set(0, 0, 0);
    t.pierHolder.scale.setScalar(0.45);
    t.pierHolder.visible = true;
    t.pier.body.children.forEach((c) => {
      if (c.name === 'ko') c.visible = false;
    });
    t.tag.visible = true;
    t.tag.material.opacity = 1;
    t.root.visible = true;
    t.shield.visible = true;
  }

  /** A pierogi's dead face: crossed-out eyes. */
  private deadFace(p: PierogiModel) {
    let ko = p.body.children.find((c) => c.name === 'ko');
    if (!ko) {
      const g = new Group();
      g.name = 'ko';
      const white = new MeshBasicMaterial({ color: '#fff8ea' });
      const black = new MeshBasicMaterial({ color: '#1d0f0a' });
      for (const x of [-0.24, 0.24]) {
        const disc = new Mesh(new CircleGeometry(0.19, 8), white);
        disc.position.set(x, 0.42, 0.37);
        g.add(disc);
        for (const a of [Math.PI / 4, -Math.PI / 4]) {
          const bar = new Mesh(new BoxGeometry(0.3, 0.06, 0.02), black);
          bar.position.set(x, 0.42, 0.385);
          bar.rotation.z = a;
          g.add(bar);
        }
      }
      p.mats.push(white, black);
      p.body.add(g);
      ko = g;
    }
    ko.visible = true;
  }

  // ---- events -------------------------------------------------------------------

  private dust(x: number, z: number, n: number, color = '#cfa97a', power = 1.4, y = 0.3) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const v = (0.4 + Math.random()) * power;
      this.fx.add(0, [x, y, z], [Math.cos(a) * v, 0.8 + Math.random() * 1.2, Math.sin(a) * v], 0.5 + Math.random() * 0.4, 0.3, 0.8, color, 0, 2);
    }
  }

  private sparks(x: number, y: number, z: number, n: number, color = '#ffd23f', power = 6) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const v = (0.3 + Math.random()) * power;
      this.fx.add(2, [x, y, z], [Math.cos(a) * v, 1 + Math.random() * power * 0.5, Math.sin(a) * v], 0.25 + Math.random() * 0.2, 0.2, 0.05, color, 12, 1);
    }
  }

  private chunks(x: number, y: number, z: number, n: number, colors: string[], power = 6, size = 0.28) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const v = (0.3 + Math.random()) * power;
      this.fx.add(1, [x, y, z], [Math.cos(a) * v, 2 + Math.random() * power * 0.8, Math.sin(a) * v], 1.1 + Math.random() * 0.6, size * (0.6 + Math.random() * 0.8), size * 0.5, colors[k % colors.length], 22, 0.3);
    }
  }

  private scorchAtSpot(x: number, z: number, r: number) {
    const m = this.scorch[this.scorchAt++ % this.scorch.length];
    m.visible = true;
    m.position.set(x, 0.045 + (this.scorchAt % 3) * 0.002, z);
    m.scale.setScalar(r);
    m.rotation.z = Math.random() * 6;
  }

  private blast(x: number, z: number, big: number) {
    // Fireball: a few expanding glow blobs, then smoke.
    this.fx.add(2, [x, 1.2, z], [0, 1, 0], 0.32, 0.7 * big, 2.5 * big, '#ffd23f');
    this.fx.add(2, [x, 1.0, z], [0, 0.5, 0], 0.4, 0.5 * big, 2.0 * big, '#ff8a2a');
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2 + Math.random();
      const v = (2 + Math.random() * 3) * big;
      this.fx.add(2, [x, 0.8, z], [Math.cos(a) * v, 2 + Math.random() * 3, Math.sin(a) * v], 0.5, 0.9 * big, 0.2, k % 2 ? '#ff6a2a' : '#ffb02e', 4, 2);
    }
    for (let k = 0; k < 8; k++) {
      const a = Math.random() * Math.PI * 2;
      const v = Math.random() * 3 * big;
      this.fx.add(0, [x, 1.2, z], [Math.cos(a) * v, 2 + Math.random() * 2, Math.sin(a) * v], 0.8 + Math.random() * 0.4, 0.6 * big, 1.5 * big, k % 3 ? '#6f655d' : '#9a8f84', -1, 1.5);
    }
  }

  private ring(x: number, z: number, r: number, max = 0.5) {
    const s = this.shocks.reduce((a, b) => (a.age > b.age ? a : b));
    s.age = 0;
    s.max = max;
    s.r = r;
    s.mesh.visible = true;
    s.mesh.position.set(x, 0.09, z);
  }

  handle(events: TankEvent[], sim: TanksSim) {
    for (const e of events) {
      switch (e.e) {
        case 'shot': {
          const t = this.tanks[e.idx];
          t.recoil = 1;
          this.fx.add(2, [e.x, 1.2, e.z], [Math.sin(e.h) * 3, 0.2, Math.cos(e.h) * 3], 0.14, 0.7, 0.2, '#fff2b0');
          this.dust(e.x, e.z, 3, '#d9d2c4', 1.5, 1.2);
          break;
        }
        case 'bounce':
          this.sparks(e.x, 1, e.z, 6, '#fff2b0', 5);
          this.dust(e.x, e.z, 2, '#d9d2c4', 1, 1);
          break;
        case 'pop':
          this.sparks(e.x, 1, e.z, 8, '#ffb02e', 6);
          this.fx.add(2, [e.x, 1, e.z], [0, 0, 0], 0.18, 0.5, 1.1, '#fff2b0');
          break;
        case 'clash':
          this.sparks(e.x, 1, e.z, 12, '#ffffff', 7);
          this.fx.add(2, [e.x, 1, e.z], [0, 0, 0], 0.22, 0.5, 1.5, '#fff2b0');
          break;
        case 'block': {
          const t = this.tanks[e.idx];
          this.sparks(t.root.position.x, 1.2, t.root.position.z, 6, '#cfe8ff', 5);
          break;
        }
        case 'hit': {
          const t = this.tanks[e.idx];
          t.squash = 1;
          this.sparks(e.x, 1.2, e.z, 10, '#ffffff', 7);
          this.fx.add(2, [e.x, 1.3, e.z], [0, 0, 0], 0.2, 0.6, 1.7, '#fff2b0');
          this.shake = Math.max(this.shake, e.kind === 'mortar' ? 0.5 : 0.3);
          break;
        }
        case 'ko':
          this.knockOut(e.idx, e.x, e.z);
          this.shake = Math.max(this.shake, 1);
          break;
        case 'crateHit':
          this.chunks(e.x, 1, e.z, 4, ['#a9743f', '#6b4524'], 4, 0.22);
          this.dust(e.x, e.z, 2);
          this.obMeshes.get(e.id)?.rotation.set(0, (Math.random() - 0.5) * 0.12, 0);
          break;
        case 'crate': {
          this.chunks(e.x, 1, e.z, 12, ['#a9743f', '#6b4524', '#c99358'], 6, 0.32);
          this.dust(e.x, e.z, 5);
          const g = this.obMeshes.get(e.id);
          if (g) g.visible = false;
          break;
        }
        case 'lob':
          this.dust(sim.tanks[e.idx].x, sim.tanks[e.idx].z, 3, '#d9d2c4', 1.5, 1.3);
          this.tanks[e.idx].recoil = 1.2;
          break;
        case 'splash':
          this.blast(e.x, e.z, 1);
          this.dust(e.x, e.z, 14, '#b08a5a', 5, 0.4);
          this.chunks(e.x, 0.5, e.z, 10, ['#8a6a43', '#5f8a3a', '#b08a5a'], 7, 0.3);
          this.ring(e.x, e.z, TUNING.mortarSplash * 1.15, 0.45);
          this.scorchAtSpot(e.x, e.z, 2.0);
          this.shake = Math.max(this.shake, 0.8);
          break;
      }
    }
  }

  private knockOut(idx: number, x: number, z: number) {
    const t = this.tanks[idx];
    if (t.dead) return;
    t.dead = true;
    this.blast(x, z, 1.35);
    this.chunks(x, 1.2, z, 14, [t.color.getStyle(), '#2f2724', '#403632', '#8a8480'], 9, 0.36);
    this.ring(x, z, 4.2, 0.55);
    this.scorchAtSpot(x, z, 1.5);
    t.mats.main.color.copy(charred);
    t.mats.dark.color.copy(charredDark);
    t.mats.main.emissive.setScalar(0);
    t.mats.dark.emissive.setScalar(0);
    t.shield.visible = false;
    t.tag.material.opacity = 0.55;
    // The driver pops out and lands beside the wreck with a dead face.
    const world = new Vector3();
    t.pierHolder.getWorldPosition(world);
    this.stage.world.add(t.pierHolder);
    t.pierHolder.position.copy(world);
    t.pierHolder.scale.setScalar(0.7);
    this.deadFace(t.pier);
    const a = Math.random() * Math.PI * 2;
    t.flying = { x: world.x, y: world.y, z: world.z, vx: Math.cos(a) * 3.2, vy: 9, vz: Math.sin(a) * 3.2, spin: (Math.random() < 0.5 ? -1 : 1) * 9, landed: false };
  }

  // ---- frame --------------------------------------------------------------------

  update(sim: TanksSim, dt: number) {
    this.clock += dt;
    const now = this.clock;
    // tanks
    for (const tv of this.tanks.keys()) {
      const v = this.tanks[tv];
      const t = sim.tanks[tv];
      if (!t || t.removed) {
        v.root.visible = false;
        if (v.pierHolder.parent === this.stage.world) v.pierHolder.visible = false;
        continue;
      }
      v.root.position.set(t.x, 0, t.z);
      v.hull.rotation.y = t.h;
      v.turret.rotation.y = t.t - t.h;
      // The driver always looks towards the camera.
      v.pier.root.rotation.y = -t.t;
      if (!v.dead) {
        const dh = ((t.h - v.lastH + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
        v.lastH = t.h;
        const spin = dt > 0 ? dh / dt : 0;
        const l = t.speed + spin * 0.95;
        const r = t.speed - spin * 0.95;
        v.texL.offset.y -= (l * dt) / 1.4;
        v.texR.offset.y -= (r * dt) / 1.4;
        v.dist += Math.abs(t.speed) * dt;
        v.body.position.y = t.speed > 0.4 ? Math.abs(Math.sin(v.dist * 2.6)) * 0.035 : 0;
        v.hull.rotation.z = Math.sin(now * 40) * 0.0 + (v.squash > 0 ? Math.sin(now * 50) * 0.04 * v.squash : 0);
        v.recoil = Math.max(0, v.recoil - dt * 6);
        v.squash = Math.max(0, v.squash - dt * 4);
        v.barrel.position.z = 0.45 - v.recoil * 0.35;
        v.turret.position.y = 1.08 - v.recoil * 0.05 - v.squash * 0.05;
        v.hull.scale.set(1 + v.squash * 0.08, 1 - v.squash * 0.1, 1 + v.squash * 0.08);
        const k = Math.max(0, 1 - t.hitAge / 0.28);
        v.mats.main.emissive.setScalar(k);
        v.mats.dark.emissive.setScalar(k);
        v.shield.visible = t.protect > 0 && (t.protect > 0.6 || Math.floor(now * 14) % 2 === 0);
        v.shield.scale.set(1 + Math.sin(now * 6) * 0.03, 0.75, 1.2 + Math.sin(now * 6) * 0.03);
        v.shield.rotation.y = now * 0.8;
        v.pierHolder.position.y = 0.5 + Math.max(0, Math.sin(v.dist * 2.6)) * 0.02 * (t.speed > 0.4 ? 1 : 0);
        // Damaged tanks smoke.
        if (t.armour === 1 && t.alive) {
          v.smoke -= dt;
          if (v.smoke <= 0) {
            v.smoke = 0.1;
            const bx = t.x - Math.sin(t.h) * 0.9;
            const bz = t.z - Math.cos(t.h) * 0.9;
            this.fx.add(0, [bx, 1.3, bz], [(Math.random() - 0.5) * 0.6, 1.8, (Math.random() - 0.5) * 0.6], 0.9, 0.35, 0.95, '#4b4440', -0.4, 0.5);
          }
        }
      } else {
        // Wreck: still, black, smouldering.
        v.hull.scale.set(1, 1, 1);
        v.smoke -= dt;
        if (v.smoke <= 0) {
          v.smoke = 0.18;
          this.fx.add(0, [t.x + (Math.random() - 0.5) * 0.8, 1.3, t.z + (Math.random() - 0.5) * 0.8], [0, 1.6, 0], 1.1, 0.25, 0.75, '#4a423d', -0.2, 0.4);
        }
        const f = v.flying;
        if (f) {
          if (!f.landed) {
            f.vy -= 24 * dt;
            f.x += f.vx * dt;
            f.y += f.vy * dt;
            f.z += f.vz * dt;
            v.pierHolder.rotation.z += f.spin * dt;
            v.pierHolder.rotation.x += f.spin * 0.4 * dt;
            if (f.y <= 0.35 && f.vy < 0) {
              f.landed = true;
              f.y = 0.35;
              v.pierHolder.rotation.set(0.0, Math.random() * 6, 1.35 * (Math.random() < 0.5 ? 1 : -1));
              this.dust(f.x, f.z, 3, '#cfa97a', 1.2, 0.2);
            }
          }
          v.pierHolder.position.set(f.x, f.y, f.z);
        }
      }
    }

    // shells
    this.shellMeshes.forEach((m, i) => {
      const s = sim.shells[i];
      m.group.visible = !!s;
      if (!s) return;
      m.mesh.material = this.shellMats[s.owner] ?? this.shellMats[0];
      m.group.position.set(s.x, 1.0, s.z);
      this.fx.add(2, [s.x, 1.0, s.z], [0, 0, 0], 0.22, 0.42, 0.05, this.looks[s.owner]?.color ?? '#fff');
    });

    // mortars: cabbages in the air and red target rings on the ground
    const live = new Set<number>();
    for (const m of sim.mortars) {
      live.add(m.id);
      let v = this.mortars.get(m.id);
      if (!v) {
        v = this.makeMortar();
        this.mortars.set(m.id, v);
        v.ring.position.set(m.tx, 0.07, m.tz);
      }
      const u = Math.min(1, m.t / m.T);
      const x = m.x0 + (m.tx - m.x0) * u;
      const z = m.z0 + (m.tz - m.z0) * u;
      const h = 1.3 + 40 * u * (1 - u) * 1;
      v.cab.position.set(x, h, z);
      v.cab.rotation.set(m.t * 7, m.t * 4, 0);
      v.shadow.position.set(x, 0.06, z);
      v.shadow.scale.setScalar(Math.max(0.3, 1.1 - (h - 1.3) / 20));
      const pulse = 0.5 + 0.5 * Math.sin(now * 14);
      v.shrink.scale.setScalar(Math.max(0.05, 1 - u * 0.92));
      v.outer.scale.setScalar(1 + pulse * 0.04);
      this.ringMat.opacity = 0.55 + pulse * 0.4;
      this.discMat.opacity = 0.1 + pulse * 0.16 + u * 0.14;
    }
    for (const [id, v] of this.mortars) {
      if (live.has(id)) continue;
      this.removeMortar(v);
      this.mortars.delete(id);
    }

    for (const s of this.shocks) {
      s.age += dt;
      s.mesh.visible = s.age < s.max;
      if (s.mesh.visible) {
        const u = s.age / s.max;
        s.mesh.scale.setScalar(0.5 + s.r * u);
      }
    }
    this.shockMat.opacity = 0.55;

    this.fx.update(dt);

    // camera shake
    this.shake *= Math.exp(-5.5 * dt);
    if (this.shake < 0.01) this.shake = 0;
    const cam = this.stage.camera;
    this.cam.copy(this.camBase);
    if (this.shake > 0) {
      this.cam.x += (Math.random() - 0.5) * this.shake * 0.8;
      this.cam.y += (Math.random() - 0.5) * this.shake * 0.5;
      this.cam.z += (Math.random() - 0.5) * this.shake * 0.5;
    }
    cam.position.copy(this.cam);
    this.stage.render();
  }

  private makeMortar(): MortarVis {
    const w = this.stage.world;
    const cab = new Group();
    cab.add(new Mesh(this.cabGeo, this.cabMats[0]), new Mesh(this.cabCore, this.cabMats[1]));
    const shadow = blobShadow(1, 0.4);
    const ring = new Group();
    const outer = new Mesh(new RingGeometry(TUNING.mortarSplash - 0.28, TUNING.mortarSplash, 28), this.ringMat);
    outer.rotation.x = -Math.PI / 2;
    const disc = new Mesh(new CircleGeometry(TUNING.mortarSplash - 0.28, 28), this.discMat);
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = -0.01;
    const shrink = new Mesh(new RingGeometry(TUNING.mortarSplash - 0.2, TUNING.mortarSplash - 0.04, 28), this.ringMat);
    shrink.rotation.x = -Math.PI / 2;
    shrink.position.y = 0.01;
    ring.add(outer, disc, shrink);
    w.add(cab, shadow, ring);
    return { cab, shadow, ring, shrink, disc, outer };
  }

  private removeMortar(v: MortarVis) {
    this.stage.world.remove(v.cab, v.shadow, v.ring);
    v.ring.traverse((o) => (o as Mesh).geometry?.dispose());
    v.shadow.geometry.dispose();
    (v.shadow.material as Material).dispose();
  }

  /** Where a ground point shows up on the 1920×1080 stage. */
  project(x: number, y: number, z: number) {
    return this.stage.toStage(new Vector3(x, y, z));
  }
}

const ARENA_W_TILES = (HX * 2) / 2.4;
const ARENA_H_TILES = (HZ * 2) / 2.4;

/** Hay: golden straw lines. */
function hayTexture() {
  return pixelTexture(
    16,
    (ctx, rnd) => {
      noise(ctx, rnd, 16, [226, 190, 92], 24);
      ctx.fillStyle = 'rgba(150,104,32,.5)';
      for (let i = 0; i < 12; i++) ctx.fillRect(Math.floor(rnd() * 14), Math.floor(rnd() * 16), 2 + Math.floor(rnd() * 3), 1);
    },
    11,
  );
}
