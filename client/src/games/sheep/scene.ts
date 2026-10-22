/**
 * Owieczki in 3D: a highland meadow in Podhale on a bright summer day. A wooden bacówka (shepherd's
 * hut) smokes behind the far fence, the Tatra peaks stand snow-capped behind the hills, wildflowers
 * and boulders dot the grass, and every player has a little pen in their colour round the edge.
 * Same PS2 look as the other arena games: sheep are instanced, flat-shaded and a bit lumpy.
 */
import {
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Euler,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  BoxGeometry,
  TorusGeometry,
  Vector3,
  type Material,
  type Sprite,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ArenaStage, blobShadow, box, buildPierogi, flat, groundTexture, nameTag, pixelTexture, noise, type PierogiModel } from '../arena/kit';
import { Puffs } from '../arena/puffs';
import { mulberry32 } from '../rng';
import { GAP_HALF, GATE_W, HUT, MAX_SHEEP, PEN_D, PEN_W, ROCKS, RX, RZ, WHISTLE_R, penWorld, type Pen, type SheepEvent, type SheepSim } from './logic';

export interface PlayerLook {
  name: string;
  color: string;
}

type Keep = <T extends { dispose(): void }>(x: T) => T;

const WOOL = '#f6f1e4';
const BLACK_WOOL = '#4a4244';
const FACE = '#efe1cf';
const LEG = '#3b2a22';
const WOOD = '#8a5a32';
const DARK_WOOD = '#5e3b20';

interface Actor {
  model: PierogiModel;
  tag: Sprite;
  color: string;
  yaw: number;
  walk: number;
  /** Seconds since the last whistle (for the puffed cheeks), or -1. */
  whistle: number;
}

interface Ring {
  mesh: Mesh;
  mat: MeshBasicMaterial;
  t: number;
}

interface PenLook {
  group: Group;
  leaves: Group[];
  rails: MeshLambertMaterial;
  color: Color;
  closed: boolean;
  shut: number;
}

/** Give every vertex of a geometry one colour (for merged, vertex-coloured models). */
function paint(geo: BufferGeometry, color: string, jitter = 0, seed = 1) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  const rnd = mulberry32(seed);
  // One shade per triangle, so the low-poly wool reads as lumpy.
  for (let i = 0; i < n; i += 3) {
    const k = 1 + (rnd() - 0.5) * jitter;
    for (let j = 0; j < 3 && i + j < n; j++) {
      arr[(i + j) * 3] = c.r * k;
      arr[(i + j) * 3 + 1] = c.g * k;
      arr[(i + j) * 3 + 2] = c.b * k;
    }
  }
  g.setAttribute('color', new BufferAttribute(arr, 3));
  g.deleteAttribute('uv');
  return g;
}

function placed(geo: BufferGeometry, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) {
  const m = new Matrix4().compose(new Vector3(x, y, z), new Quaternion().setFromEuler(new Euler(rx, ry, rz)), new Vector3(sx, sy, sz));
  geo.applyMatrix4(m);
  return geo;
}

/** The sheep's wool: a lumpy cloud of icosahedrons. Origin at the feet, facing +z. */
function woolGeometry() {
  const parts: BufferGeometry[] = [];
  const puff = (x: number, y: number, z: number, r: number, seed: number) => parts.push(paint(placed(new IcosahedronGeometry(r, 0), x, y, z, 1, 0.9, 1, seed, seed * 2, 0), WOOL, 0.16, seed));
  puff(0, 0.6, 0, 0.42, 1);
  puff(0, 0.62, 0.26, 0.34, 2);
  puff(0, 0.6, -0.28, 0.34, 3);
  puff(0.2, 0.74, 0.08, 0.26, 4);
  puff(-0.2, 0.74, -0.06, 0.26, 5);
  puff(0.24, 0.56, -0.18, 0.24, 6);
  puff(-0.24, 0.56, 0.18, 0.24, 7);
  puff(0, 0.84, -0.04, 0.24, 8);
  // The tail.
  puff(0, 0.62, -0.58, 0.12, 9);
  return mergeGeometries(parts)!;
}

/** The head, with its origin at the neck (so it can nod down to graze). */
function headGeometry() {
  const parts: BufferGeometry[] = [];
  parts.push(paint(placed(new SphereGeometry(0.17, 6, 4), 0, 0.02, 0.17, 0.85, 0.95, 1.25), FACE, 0.08, 11));
  // Ears stick out sideways.
  for (const s of [-1, 1]) parts.push(paint(placed(new SphereGeometry(0.08, 4, 3), s * 0.17, 0.08, 0.1, 1.6, 0.5, 0.9, 0, 0, s * 0.5), FACE, 0.05, 12));
  // A tuft of wool on top, eyes and a dark nose.
  parts.push(paint(placed(new IcosahedronGeometry(0.11, 0), 0, 0.16, 0.08), WOOL, 0.1, 13));
  for (const s of [-1, 1]) parts.push(paint(placed(new SphereGeometry(0.035, 4, 3), s * 0.09, 0.07, 0.3), '#120a08'));
  parts.push(paint(placed(new SphereGeometry(0.045, 4, 3), 0, -0.04, 0.37, 1.3, 0.7, 0.6), '#7a5a50'));
  return mergeGeometries(parts)!;
}

const LEG_HIPS: [number, number][] = [
  [-0.17, 0.27],
  [0.17, 0.27],
  [-0.17, -0.27],
  [0.17, -0.27],
];
const HIP_Y = 0.42;
const NECK = new Vector3(0, 0.66, 0.44);

export class SheepScene {
  readonly stage: ArenaStage;
  private actors: Actor[] = [];
  private pens: PenLook[] = [];
  private wool: InstancedMesh;
  private heads: InstancedMesh;
  private legs: InstancedMesh[] = [];
  private shadows: InstancedMesh;
  private rings: Ring[] = [];
  private puffs = new Puffs(260, 6, 1.8);
  private smoke = new Puffs(40, -0.6, 0.4);
  // Per-sheep animation state, by index in sim.sheep.
  private yaw = new Float32Array(MAX_SHEEP);
  private gait = new Float32Array(MAX_SHEEP);
  private hop = new Float32Array(MAX_SHEEP).fill(-1);
  private hopH = new Float32Array(MAX_SHEEP);
  private nod = new Float32Array(MAX_SHEEP);
  private known = 0;
  private time = 0;
  private shake = 0;
  private smokeT = 0;
  private m = new Matrix4();
  private m2 = new Matrix4();
  private q = new Quaternion();
  private v = new Vector3();
  private s = new Vector3();
  private e = new Euler();
  private white = new Color('#ffffff');
  private dark = new Color(BLACK_WOOL);
  private darkFace = new Color('#4a3c38');
  private hidden = new Matrix4().makeScale(0, 0, 0);

  constructor(canvas: HTMLCanvasElement, looks: PlayerLook[], pens: Pen[]) {
    this.stage = new ArenaStage(canvas, { sky: '#a6d6f0', fog: [70, 240], fov: 38 });
    const stage = this.stage;
    const keep: Keep = (x) => stage.keep(x);
    this.buildLand(keep);
    this.buildFence(keep);
    this.buildHut(keep);
    pens.forEach((p, i) => this.buildPen(keep, p, looks[i]?.color ?? '#cccccc'));

    // The flock, instanced.
    const woolMat = keep(new MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    this.wool = new InstancedMesh(keep(woolGeometry()), woolMat, MAX_SHEEP);
    this.heads = new InstancedMesh(keep(headGeometry()), woolMat, MAX_SHEEP);
    const legGeo = keep(new CylinderGeometry(0.055, 0.045, HIP_Y, 5));
    legGeo.translate(0, -HIP_Y / 2, 0);
    const legMat = keep(flat(LEG));
    for (let k = 0; k < 4; k++) this.legs.push(new InstancedMesh(legGeo, legMat, MAX_SHEEP));
    const shGeo = keep(new CircleGeometry(0.5, 8));
    shGeo.rotateX(-Math.PI / 2);
    this.shadows = new InstancedMesh(shGeo, keep(new MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.28, depthWrite: false })), MAX_SHEEP);
    for (const im of [this.wool, this.heads, ...this.legs, this.shadows]) {
      im.count = 0;
      im.frustumCulled = false;
      stage.add(im);
    }
    for (let i = 0; i < MAX_SHEEP; i++) {
      this.wool.setColorAt(i, this.white);
      this.heads.setColorAt(i, this.white);
    }

    // The dogs: pierogi in góral hats.
    looks.forEach((l) => {
      const model = buildPierogi(l.color);
      this.hat(keep, model);
      const tag = nameTag(l.name, l.color);
      tag.position.set(0, 2.25, 0);
      tag.scale.set(2.8, 0.7, 1);
      model.root.scale.setScalar(0.78);
      model.root.add(tag);
      stage.add(model.root);
      this.actors.push({ model, tag, color: l.color, yaw: 0, walk: 0, whistle: -1 });
    });

    // Whistle rings.
    const ringGeo = keep(new RingGeometry(0.86, 1, 28));
    ringGeo.rotateX(-Math.PI / 2);
    for (let k = 0; k < 8; k++) {
      const mat = keep(new MeshBasicMaterial({ color: '#fff', transparent: true, opacity: 0, depthWrite: false, side: DoubleSide }));
      const mesh = new Mesh(ringGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 2;
      stage.add(mesh);
      this.rings.push({ mesh, mat, t: -1 });
    }
    stage.add(this.puffs.mesh, this.smoke.mesh);
    stage.lookAt(new Vector3(0, 0, 1.2), 31, 0.74);
  }

  // ---- scenery ----------------------------------------------------------------------------------
  private buildLand(keep: Keep) {
    const stage = this.stage;
    const rnd = mulberry32(21);
    const g = keep(new PlaneGeometry(420, 300));
    g.rotateX(-Math.PI / 2);
    const ground = new Mesh(g, keep(flat('#ffffff', { map: keep(groundTexture('grass', 70, 5)) })));
    ground.position.set(0, -0.01, -60);
    stage.add(ground);
    // The meadow itself is a fresher green.
    const mg = keep(new CircleGeometry(1, 48));
    mg.rotateX(-Math.PI / 2);
    const meadow = new Mesh(mg, keep(flat('#cfe8a0', { map: keep(groundTexture('grass', 9, 8)) })));
    meadow.scale.set(RX + 0.4, 1, RZ + 0.4);
    meadow.position.y = 0.005;
    stage.add(meadow);
    // A dirt path from the hut to the gap in the fence.
    const pg = keep(new PlaneGeometry(2.2, 5));
    pg.rotateX(-Math.PI / 2);
    const path = new Mesh(pg, keep(flat('#c9a878', { map: keep(groundTexture('sand', 2, 4)) })));
    path.position.set(0, 0.012, -RZ - 1.6);
    stage.add(path);

    // Rolling hills round the meadow.
    const hillGeo = keep(new SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2));
    const hillMats = ['#6fae4c', '#5f9e42', '#80b956', '#4f8a3a'].map((c) => keep(flat(c)));
    const hills: [number, number, number, number, number][] = [
      [-30, -28, 20, 7, 12],
      [-8, -34, 22, 6, 10],
      [16, -30, 20, 8, 11],
      [36, -24, 16, 6, 12],
      [-44, -10, 14, 5, 16],
      [44, -6, 14, 5, 16],
      [-24, -46, 26, 10, 12],
      [26, -48, 28, 11, 12],
      [0, -52, 24, 9, 10],
    ];
    hills.forEach(([x, z, sx, sy, sz], k) => {
      const h = new Mesh(hillGeo, hillMats[k % hillMats.length]);
      h.scale.set(sx, sy, sz);
      h.position.set(x, -0.2, z);
      stage.add(h);
    });

    // The Tatras: grey peaks with snow on top, standing in a row beyond the hills.
    const rock = keep(flat('#8a93a3'));
    const rock2 = keep(flat('#79818f'));
    const snow = keep(flat('#f8fbff'));
    const peakGeo = keep(new ConeGeometry(1, 1, 5));
    const peaks: [number, number, number, number][] = [
      [-62, -78, 30, 34],
      [-40, -86, 40, 30],
      [-18, -80, 46, 28],
      [4, -90, 54, 34],
      [26, -82, 44, 28],
      [48, -88, 36, 30],
      [70, -80, 28, 30],
      [-84, -84, 24, 30],
      [90, -86, 22, 28],
    ];
    peaks.forEach(([x, z, h, r], k) => {
      const p = new Mesh(peakGeo, k % 2 ? rock : rock2);
      p.scale.set(r, h, r * 0.7);
      p.position.set(x, h / 2 - 2, z);
      p.rotation.y = k * 0.7;
      const cap = new Mesh(peakGeo, snow);
      const f = 0.32;
      cap.scale.set(r * f * 1.04, h * f, r * 0.7 * f * 1.04);
      cap.position.set(x, h - 2 - (h * f) / 2 + 0.05, z);
      cap.rotation.y = k * 0.7;
      stage.add(p, cap);
    });

    // Spruce woods on the hills.
    const cone = keep(new ConeGeometry(1, 1, 6));
    const trunk = keep(new CylinderGeometry(0.18, 0.24, 1, 5));
    const spruce = keep(flat('#2f5a35'));
    const spruce2 = keep(flat('#3b6b3c'));
    const bark = keep(flat('#5a3a22'));
    const trees: [number, number, number][] = [];
    for (let k = 0; k < 70; k++) {
      const x = (rnd() - 0.5) * 120;
      const z = -22 - rnd() * 36;
      if (Math.abs(x) < 9 && z > -26) continue;
      trees.push([x, z, 2.6 + rnd() * 2.6]);
    }
    for (let k = 0; k < 18; k++) {
      const s = k % 2 ? 1 : -1;
      trees.push([s * (RX + 5 + rnd() * 14), -12 + rnd() * 22, 2.4 + rnd() * 2]);
    }
    const ti = new InstancedMesh(trunk, bark, trees.length);
    const ci = new InstancedMesh(cone, spruce, trees.length * 2);
    trees.forEach(([x, z, h], k) => {
      this.m.compose(this.v.set(x, h * 0.15, z), this.q.identity(), this.s.set(1, h * 0.3, 1));
      ti.setMatrixAt(k, this.m);
      this.m.compose(this.v.set(x, h * 0.55, z), this.q.identity(), this.s.set(h * 0.32, h * 0.6, h * 0.32));
      ci.setMatrixAt(k * 2, this.m);
      this.m.compose(this.v.set(x, h * 0.85, z), this.q.identity(), this.s.set(h * 0.22, h * 0.42, h * 0.22));
      ci.setMatrixAt(k * 2 + 1, this.m);
    });
    const ci2 = ci.clone();
    ci2.material = spruce2;
    ci2.scale.set(1, 1, 1);
    stage.add(ti, ci);

    // Boulders: the ones the sheep walk round, and a few more outside.
    const stoneGeo = keep(new IcosahedronGeometry(1, 0));
    const stone = keep(flat('#a29d93'));
    const stoneDark = keep(flat('#8a857b'));
    ROCKS.forEach((r, k) => {
      const b = new Mesh(stoneGeo, stone);
      b.scale.set(r.r * 1.05, r.r * 0.75, r.r * 0.95);
      b.position.set(r.x, r.r * 0.3, r.z);
      b.rotation.set(0.3, k * 1.3, 0.2);
      const b2 = new Mesh(stoneGeo, stoneDark);
      b2.scale.setScalar(r.r * 0.45);
      b2.position.set(r.x + r.r * 0.8, r.r * 0.12, r.z + r.r * 0.5);
      stage.add(b, b2, placedShadow(r.x, r.z, r.r * 1.2));
    });
    for (const [x, z, s] of [
      [-RX - 3, 4, 1.1],
      [RX + 2.5, -3, 0.9],
      [-12, -RZ - 4, 0.8],
      [9, -RZ - 3.5, 1.2],
      [RX + 4, 7, 0.7],
    ] as const) {
      const b = new Mesh(stoneGeo, stone);
      b.scale.set(s * 1.1, s * 0.7, s);
      b.position.set(x, s * 0.25, z);
      b.rotation.y = x;
      stage.add(b);
    }

    // Wildflowers: white, yellow, violet and red specks all over the grass.
    const petal = keep(new IcosahedronGeometry(0.12, 0));
    const fm = keep(new MeshLambertMaterial({ color: '#ffffff', flatShading: true }));
    const COUNT = 420;
    const fl = new InstancedMesh(petal, fm, COUNT);
    const cols = ['#ffffff', '#fff3a0', '#ffd23f', '#b98cff', '#8f6be0', '#ff6b7a', '#ffffff', '#f7f0ff'].map((c) => new Color(c));
    const c = new Color();
    for (let k = 0; k < COUNT; k++) {
      let x: number;
      let z: number;
      if (k < 260) {
        // Inside the meadow, in little clumps.
        const a = rnd() * Math.PI * 2;
        const r = Math.sqrt(rnd()) * 0.93;
        x = Math.cos(a) * r * RX;
        z = Math.sin(a) * r * RZ;
      } else {
        x = (rnd() - 0.5) * 70;
        z = -RZ - 1 - rnd() * 18;
        if (rnd() < 0.4) z = RZ + 1 + rnd() * 8;
      }
      const s = 0.6 + rnd() * 0.8;
      this.m.compose(this.v.set(x, 0.06, z), this.q.identity(), this.s.set(s, 0.5 * s, s));
      fl.setMatrixAt(k, this.m);
      fl.setColorAt(k, c.copy(cols[Math.floor(rnd() * cols.length)]));
    }
    stage.add(fl);
    // A lone wooden cross-roads shrine (kapliczka) and a hay rack by the hut add Podhale flavour.
    const shrine = new Group();
    const post = box(0.22, 2.2, 0.22, keep(flat(DARK_WOOD)));
    const house = box(0.7, 0.7, 0.5, keep(flat('#f1e6d0')));
    house.position.y = 2.2;
    const roofS = new Mesh(keep(new ConeGeometry(0.62, 0.55, 4)), keep(flat('#4a3424')));
    roofS.rotation.y = Math.PI / 4;
    roofS.position.y = 3.15;
    const niche = box(0.36, 0.4, 0.05, keep(flat('#3568b8')));
    niche.position.set(0, 2.33, 0.26);
    shrine.add(post, house, roofS, niche);
    shrine.position.set(-RX - 3.5, 0, -4);
    shrine.rotation.y = 0.9;
    stage.add(shrine);
  }

  private buildFence(keep: Keep) {
    const parts: BufferGeometry[] = [];
    const N = 64;
    const pts: { x: number; z: number }[] = [];
    for (let k = 0; k < N; k++) {
      const t = (k / N) * Math.PI * 2;
      pts.push({ x: (RX + 0.35) * Math.cos(t), z: (RZ + 0.35) * Math.sin(t) });
    }
    const inGap = (x: number, z: number) => z < 0 && Math.abs(x) < GAP_HALF + 0.2;
    for (let k = 0; k < N; k++) {
      const a = pts[k];
      const b = pts[(k + 1) % N];
      if (!inGap(a.x, a.z)) parts.push(placed(new BoxGeometry(0.2, 1.1, 0.2), a.x, 0.55, a.z));
      if (inGap(a.x, a.z) || inGap(b.x, b.z)) continue;
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const yaw = Math.atan2(b.x - a.x, b.z - a.z);
      for (const y of [0.45, 0.85]) parts.push(placed(new BoxGeometry(0.08, 0.12, len), (a.x + b.x) / 2, y, (a.z + b.z) / 2, 1, 1, 1, 0, yaw, 0));
    }
    // Gate posts at the gap, with a little arch.
    for (const s of [-1, 1]) parts.push(placed(new BoxGeometry(0.26, 2.2, 0.26), s * (GAP_HALF + 0.15), 1.1, -RZ - 0.3));
    parts.push(placed(new BoxGeometry(GAP_HALF * 2 + 0.7, 0.24, 0.3), 0, 2.2, -RZ - 0.3));
    const geo = keep(mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)))!);
    this.stage.add(new Mesh(geo, keep(flat(WOOD))));
  }

  /** The bacówka: a log hut with a steep shingle roof, a smoking chimney and a bench out front. */
  private buildHut(keep: Keep) {
    const hut = new Group();
    const logs = keep(
      pixelTexture(
        16,
        (ctx, rnd) => {
          noise(ctx, rnd, 16, [150, 98, 56], 26);
          ctx.fillStyle = 'rgba(50,25,10,.55)';
          for (const y of [0, 4, 8, 12]) ctx.fillRect(0, y, 16, 1);
        },
        7,
        1,
      ),
    );
    logs.repeat.set(3, 1.5);
    const wall = box(6, 2.8, 4.2, keep(flat('#ffffff', { map: logs })));
    const found = box(6.3, 0.4, 4.5, keep(flat('#8f8a80')));
    const shingle = keep(flat('#5b4636'));
    // A steep two-sided roof.
    const roofGeo = keep(new BoxGeometry(0.22, 3.4, 4.9));
    for (const s of [-1, 1]) {
      const r = new Mesh(roofGeo, shingle);
      r.position.set(s * 1.55, 3.95, 0);
      r.rotation.z = s * 0.98;
      hut.add(r);
    }
    const gableGeo = keep(new ConeGeometry(3.4, 2.4, 3));
    const gable = new Mesh(gableGeo, keep(flat('#a8763f', { map: logs })));
    gable.scale.set(0.9, 1, 0.6);
    gable.rotation.y = Math.PI / 2;
    gable.position.y = 3.95;
    gable.scale.z = 0.62;
    const ridge = box(0.3, 0.3, 5, keep(flat('#3e2e22')));
    ridge.position.y = 5.05;
    const door = box(1.1, 2, 0.1, keep(flat(DARK_WOOD)));
    door.position.set(0.9, 0, 2.12);
    const win = box(0.9, 0.8, 0.1, keep(flat('#ffe9a8')));
    win.position.set(-1.6, 1.1, 2.12);
    const frame = box(1.1, 1.0, 0.06, keep(flat('#f2ead8')));
    frame.position.set(-1.6, 1.0, 2.1);
    const chimney = box(0.6, 1.6, 0.6, keep(flat('#9c968a')));
    chimney.position.set(-1.2, 4.3, -0.6);
    const bench = box(2, 0.12, 0.5, keep(flat(WOOD)));
    bench.position.set(-1.3, 0.45, 2.8);
    const legs = [-0.8, 0.8].map((x) => {
      const l = box(0.12, 0.45, 0.4, keep(flat(DARK_WOOD)));
      l.position.set(-1.3 + x, 0, 2.8);
      return l;
    });
    hut.add(found, wall, gable, ridge, door, frame, win, chimney, bench, ...legs);
    // Wheels of oscypek cheese drying on the bench.
    const cheese = keep(new CylinderGeometry(0.16, 0.16, 0.34, 7));
    const cheeseMat = keep(flat('#e9c27a'));
    for (let k = 0; k < 3; k++) {
      const c = new Mesh(cheese, cheeseMat);
      c.position.set(-1.9 + k * 0.5, 0.68, 2.8);
      hut.add(c);
    }
    hut.position.set(HUT.x - 0.9, 0, HUT.z - 1.4);
    this.stage.add(hut, placedShadow(HUT.x - 0.9, HUT.z - 1.4, 4.2));
  }

  private buildPen(keep: Keep, pen: Pen, color: string) {
    const g = new Group();
    const yaw = Math.atan2(pen.nx, pen.nz);
    g.position.set(pen.x, 0, pen.z);
    g.rotation.y = yaw;
    // Local frame: +z = into the pen (u), +x = -v (three's rotation turns +x towards -lateral).
    const lx = (v: number) => -v;
    const straw = new Mesh(keep(new PlaneGeometry(PEN_W, PEN_D)), keep(flat('#e7cf8a', { map: keep(groundTexture('sand', 3, 11)) })));
    straw.rotation.x = -Math.PI / 2;
    straw.position.set(0, 0.02, PEN_D / 2);
    g.add(straw);
    const postMat = keep(flat(DARK_WOOD));
    const rails = keep(flat(color));
    const hw = PEN_W / 2;
    const gw = GATE_W / 2;
    const post = (u: number, v: number, h = 1.2) => {
      const p = box(0.18, h, 0.18, postMat);
      p.position.set(lx(v), 0, u);
      g.add(p);
    };
    for (const [u, v] of [
      [0, -hw],
      [0, hw],
      [PEN_D, -hw],
      [PEN_D, hw],
      [PEN_D / 2, -hw],
      [PEN_D / 2, hw],
      [PEN_D, 0],
    ] as const)
      post(u, v);
    for (const v of [-gw, gw]) post(0, v, 1.35);
    const rail = (u1: number, v1: number, u2: number, v2: number) => {
      const len = Math.hypot(u2 - u1, v2 - v1);
      for (const y of [0.45, 0.9]) {
        const r = new Mesh(keep(new BoxGeometry(0.09, 0.14, len)), rails);
        r.position.set(lx((v1 + v2) / 2), y, (u1 + u2) / 2);
        r.rotation.y = Math.atan2(lx(v2) - lx(v1), u2 - u1);
        g.add(r);
      }
    };
    rail(0, -hw, PEN_D, -hw);
    rail(PEN_D, -hw, PEN_D, hw);
    rail(0, hw, PEN_D, hw);
    rail(0, -hw, 0, -gw);
    rail(0, gw, 0, hw);
    // Two gate leaves, hinged on the gate posts and swung open into the meadow.
    const leaves: Group[] = [];
    for (const s of [-1, 1]) {
      const leaf = new Group();
      leaf.position.set(lx(s * gw), 0, 0);
      const w = gw;
      for (const y of [0.4, 0.85]) {
        const b = new Mesh(keep(new BoxGeometry(w, 0.12, 0.07)), rails);
        b.position.set(-lx(s) * -w / 2, y, 0);
        leaf.add(b);
      }
      const brace = new Mesh(keep(new BoxGeometry(Math.hypot(w, 0.45), 0.08, 0.06)), postMat);
      brace.position.set(-lx(s) * -w / 2, 0.62, 0);
      brace.rotation.z = Math.atan2(0.45, w) * s;
      leaf.add(brace);
      g.add(leaf);
      leaves.push(leaf);
    }
    // A painted sign over the back fence.
    const sign = box(1.5, 0.55, 0.08, rails);
    sign.position.set(0, 1.15, PEN_D + 0.05);
    g.add(sign);
    this.stage.add(g);
    this.pens.push({ group: g, leaves, rails, color: new Color(color), closed: false, shut: 0 });
    this.setLeaves(this.pens[this.pens.length - 1]);
  }

  /** Gate leaves: open (swung out towards the meadow) or, once the owner has left, shut. */
  private setLeaves(p: PenLook) {
    p.leaves.forEach((leaf, k) => {
      const s = k === 0 ? -1 : 1;
      const open = 1.75 * (1 - p.shut);
      leaf.rotation.y = s * open;
    });
  }

  /** A pierogi in a black góral hat with a band of white shells. */
  private hat(keep: Keep, model: PierogiModel) {
    const black = keep(flat('#211816'));
    const shell = keep(flat('#fff4dc'));
    const h = new Group();
    const brim = new Mesh(keep(new CylinderGeometry(0.5, 0.5, 0.05, 12)), black);
    const crown = new Mesh(keep(new CylinderGeometry(0.27, 0.3, 0.26, 10)), black);
    crown.position.y = 0.15;
    h.add(brim, crown);
    const sg = keep(new SphereGeometry(0.045, 4, 3));
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2;
      const m = new Mesh(sg, shell);
      m.position.set(Math.cos(a) * 0.3, 0.06, Math.sin(a) * 0.3);
      h.add(m);
    }
    const feather = new Mesh(keep(new ConeGeometry(0.05, 0.4, 4)), keep(flat('#d8322a')));
    feather.position.set(0.24, 0.32, -0.05);
    feather.rotation.z = -0.5;
    h.add(feather);
    h.position.set(0, 0.86, 0);
    h.rotation.z = 0.12;
    model.body.add(h);
  }

  // ---- events -----------------------------------------------------------------------------------
  reset() {
    this.known = 0;
    this.hop.fill(-1);
    for (const p of this.pens) {
      p.shut = p.closed ? 1 : 0;
      this.setLeaves(p);
    }
  }

  /** A player left: shut their gate and fade their pen. */
  closePen(i: number) {
    const p = this.pens[i];
    if (!p || p.closed) return;
    p.closed = true;
    p.rails.color.set('#8b8378');
    const a = this.actors[i];
    if (a) a.model.root.visible = false;
  }

  events(ev: SheepEvent[], sim: SheepSim) {
    for (const e of ev) {
      switch (e.t) {
        case 'pen': {
          const k = sim.sheep.findIndex((s) => s.id === e.id);
          if (k >= 0) this.startHop(k, 0.9);
          const col = this.actors[e.pen]?.color ?? '#fff';
          for (let n = 0; n < 14; n++) {
            const a = (n / 14) * Math.PI * 2;
            this.puffs.spawn(e.x, 0.6, e.z, Math.cos(a) * 3, 3 + Math.random() * 2.5, Math.sin(a) * 3, n % 2 ? 0.22 : 0.16, 0.8, n % 3 ? col : e.black ? '#ffd23f' : '#ffffff', 0.4);
          }
          break;
        }
        case 'whistle': {
          const r = this.rings.find((x) => x.t < 0) ?? this.rings[0];
          r.t = 0;
          r.mat.color.set(this.actors[e.p]?.color ?? '#fff');
          r.mesh.position.set(e.x, 0.08, e.z);
          r.mesh.visible = true;
          const a = this.actors[e.p];
          if (a) a.whistle = 0;
          // Every sheep in reach jumps with fright.
          sim.sheep.forEach((s, k) => {
            if (s.state !== 'penned' && Math.hypot(s.x - e.x, s.z - e.z) <= WHISTLE_R) this.startHop(k, 0.45);
          });
          for (let n = 0; n < 6; n++) this.puffs.spawn(e.x, 1.6, e.z, (Math.random() - 0.5) * 2, 2.5, (Math.random() - 0.5) * 2, 0.14, 0.7, '#ffffff', 0.2);
          this.shake = Math.min(0.5, this.shake + 0.12);
          break;
        }
        case 'bump':
          this.shake = Math.min(0.8, this.shake + 0.08 * e.force);
          for (let n = 0; n < 8; n++) this.puffs.spawn(e.x, 0.4, e.z, (Math.random() - 0.5) * 4, 1.5 + Math.random() * 1.5, (Math.random() - 0.5) * 4, 0.25, 0.5, '#e8dcc0');
          break;
        case 'spook': {
          const k = sim.sheep.findIndex((s) => s.id === e.id);
          if (k >= 0 && Math.random() < 0.5) this.startHop(k, 0.3);
          break;
        }
        default:
          break;
      }
    }
  }

  private startHop(k: number, h: number) {
    if (this.hop[k] >= 0 && this.hopH[k] >= h) return;
    this.hop[k] = 0;
    this.hopH[k] = h;
  }

  /** Where a world point is on the 1920×1080 stage. */
  toStage(x: number, y: number, z: number) {
    return this.stage.toStage(new Vector3(x, y, z));
  }

  /** Where to draw pen i's count badge (over its back fence). */
  penBadge(pen: Pen) {
    const p = penWorld(pen, PEN_D + 0.2, 0);
    return this.toStage(p.x, 2.3, p.z);
  }

  // ---- drawing ----------------------------------------------------------------------------------
  render(sim: SheepSim, dt: number) {
    this.time += dt;
    this.drawSheep(sim, dt);
    this.drawDogs(sim, dt);

    for (const r of this.rings) {
      if (r.t < 0) continue;
      r.t += dt;
      const k = r.t / 0.5;
      if (k >= 1) {
        r.t = -1;
        r.mesh.visible = false;
        continue;
      }
      const rad = 0.8 + (WHISTLE_R - 0.8) * (1 - Math.pow(1 - k, 2.2));
      r.mesh.scale.set(rad, 1, rad);
      r.mat.opacity = 0.85 * (1 - k);
    }
    for (const p of this.pens) {
      if (p.closed && p.shut < 1) {
        p.shut = Math.min(1, p.shut + dt * 1.5);
        this.setLeaves(p);
      }
    }
    // Smoke from the hut's chimney.
    this.smokeT -= dt;
    if (this.smokeT <= 0) {
      this.smokeT = 0.35;
      this.smoke.spawn(HUT.x - 2.1, 5.3, HUT.z - 2, 0.25 + Math.random() * 0.2, 0.9, (Math.random() - 0.5) * 0.2, 0.32, 3.2, '#e9e6e0', 2.2);
    }
    this.smoke.update(dt);
    this.puffs.update(dt);

    const stage = this.stage;
    stage.lookAt(new Vector3(0, 0, 1.2), 31, 0.74);
    if (this.shake > 0.01) {
      stage.camera.position.x += (Math.random() - 0.5) * this.shake * 0.5;
      stage.camera.position.y += (Math.random() - 0.5) * this.shake * 0.5;
      this.shake *= Math.exp(-7 * dt);
    }
    stage.render();
  }

  private drawSheep(sim: SheepSim, dt: number) {
    const list = sim.sheep;
    const n = Math.min(MAX_SHEEP, list.length);
    for (let k = this.known; k < n; k++) {
      const s = list[k];
      this.yaw[k] = Math.atan2(-s.x, -s.z) + Math.random() * 2;
      this.gait[k] = Math.random() * 10;
      this.nod[k] = 0;
      this.wool.setColorAt(k, s.black ? this.dark : this.white);
      this.heads.setColorAt(k, s.black ? this.darkFace : this.white);
      if (this.wool.instanceColor) this.wool.instanceColor.needsUpdate = true;
      if (this.heads.instanceColor) this.heads.instanceColor.needsUpdate = true;
    }
    this.known = n;
    for (let k = 0; k < n; k++) {
      const s = list[k];
      const sp = Math.hypot(s.vx, s.vz);
      if (sp > 0.08) {
        const want = Math.atan2(s.vx, s.vz);
        let d = want - this.yaw[k];
        d = Math.atan2(Math.sin(d), Math.cos(d));
        this.yaw[k] += d * Math.min(1, dt * (4 + sp * 2));
      }
      this.gait[k] += dt * (2 + sp * 5.5);
      const move = Math.min(1, sp / 1.6);
      let y = Math.abs(Math.sin(this.gait[k])) * 0.09 * move;
      let tilt = 0;
      if (this.hop[k] >= 0) {
        this.hop[k] += dt;
        const dur = 0.25 + this.hopH[k] * 0.4;
        const t = this.hop[k] / dur;
        if (t >= 1) this.hop[k] = -1;
        else {
          y += Math.sin(t * Math.PI) * this.hopH[k];
          tilt = Math.sin(t * Math.PI * 2) * 0.25;
        }
      }
      // A penned sheep now and then gives a happy little skip.
      if (s.state === 'penned' && this.hop[k] < 0 && Math.random() < dt * 0.15) this.startHop(k, 0.35);
      const wantNod = s.grazing && sp < 0.25 ? 0.75 + Math.sin(this.time * 3 + k) * 0.12 : -0.1 * move;
      this.nod[k] += (wantNod - this.nod[k]) * Math.min(1, dt * 5);
      const roll = Math.sin(this.gait[k]) * 0.06 * move;
      this.q.setFromEuler(this.e.set(tilt - move * 0.05, this.yaw[k], roll));
      this.m.compose(this.v.set(s.x, y, s.z), this.q, this.s.set(1, 1, 1));
      this.wool.setMatrixAt(k, this.m);
      // Head nods about the neck.
      this.m2.compose(NECK, this.q.setFromEuler(this.e.set(this.nod[k], 0, 0)), this.s.set(1, 1, 1));
      this.m2.premultiply(this.m);
      this.heads.setMatrixAt(k, this.m2);
      const swing = Math.sin(this.gait[k] * 2) * 0.7 * move;
      for (let l = 0; l < 4; l++) {
        const [hx, hz] = LEG_HIPS[l];
        const sgn = l === 0 || l === 3 ? 1 : -1;
        this.m2.compose(this.v.set(hx, HIP_Y, hz), this.q.setFromEuler(this.e.set(swing * sgn, 0, 0)), this.s.set(1, 1, 1));
        this.m2.premultiply(this.m);
        this.legs[l].setMatrixAt(k, this.m2);
      }
      const sh = 1 - Math.min(0.5, y * 0.6);
      this.m.compose(this.v.set(s.x, 0.03, s.z), this.q.setFromEuler(this.e.set(0, this.yaw[k], 0)), this.s.set(0.85 * sh, 1, 1.25 * sh));
      this.shadows.setMatrixAt(k, this.m);
    }
    for (let k = n; k < this.wool.count; k++) {
      for (const im of [this.wool, this.heads, ...this.legs, this.shadows]) im.setMatrixAt(k, this.hidden);
    }
    for (const im of [this.wool, this.heads, ...this.legs, this.shadows]) {
      im.count = n;
      im.instanceMatrix.needsUpdate = true;
    }
    // Dust behind running sheep.
    for (let k = 0; k < n; k++) {
      const s = list[k];
      if (s.state === 'free' && s.alert > 0.6 && Math.random() < dt * 6) this.puffs.spawn(s.x - s.vx * 0.1, 0.12, s.z - s.vz * 0.1, -s.vx * 0.2, 0.6, -s.vz * 0.2, 0.18, 0.5, '#d9cba0');
    }
  }

  private drawDogs(sim: SheepSim, dt: number) {
    this.actors.forEach((a, i) => {
      const d = sim.dogs[i];
      if (!d) return;
      const root = a.model.root;
      root.visible = d.alive;
      if (!d.alive) return;
      const sp = Math.hypot(d.vx, d.vz);
      const want = Math.atan2(d.fx, d.fz);
      let dy = want - a.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      a.yaw += dy * Math.min(1, dt * 12);
      a.walk += dt * (sp * 2.2);
      const move = Math.min(1, sp / 4);
      const hop = Math.abs(Math.sin(a.walk * 2)) * 0.22 * move;
      root.position.set(d.x, hop, d.z);
      root.rotation.y = a.yaw;
      const body = a.model.body;
      body.rotation.z = Math.sin(a.walk * 2) * 0.12 * move;
      body.rotation.x = move * 0.15;
      let sy = 1;
      let sxz = 1;
      if (a.whistle >= 0) {
        a.whistle += dt;
        const t = a.whistle / 0.35;
        if (t >= 1) a.whistle = -1;
        else {
          const k = Math.sin(t * Math.PI);
          sy = 1 + 0.2 * k;
          sxz = 1 - 0.1 * k;
        }
      }
      body.scale.set(sxz, sy, sxz);
      a.model.shadow.position.y = (0.03 - hop) / root.scale.y;
    });
  }

  dispose() {
    this.stage.dispose();
  }
}

/** A soft shadow on the ground at (x, z). */
function placedShadow(x: number, z: number, r: number) {
  const s = blobShadow(r, 0.25);
  s.position.set(x, 0.02, z);
  return s;
}

export type { Material };
export { TorusGeometry };
