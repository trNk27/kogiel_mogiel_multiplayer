/**
 * Krówki in 3D: a meadow with a fence round it, a pen in every player's colour, a herd of low-poly cows
 * with patches in their owner's colour, pierogi cowboys twirling lassos, and ropes that sag when slack
 * and pull straight (and a little thinner) when stretched.
 */
import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  NearestFilter,
  Object3D,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  Vector3,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ArenaStage, blobShadow, buildPierogi, flat, groundTexture, nameTag, noise, pixelTexture, type PierogiModel } from '../arena/kit';
import { Puffs } from '../arena/puffs';
import { GATE, PEN, ROPE_LEN, ROPE_MAX, THROW_TIME, type CowsEvent, type CowsSim } from './logic';

export interface Contender {
  name: string;
  color: string;
}

/** Rope segments per rope. */
const SEGS = 14;
const RETRACT = 0.25;
const CHAR_SCALE = 1.05;

/** Collects coloured, transformed pieces and merges them into one vertex-coloured geometry. */
class Parts {
  private list: BufferGeometry[] = [];
  private m = new Matrix4();
  private q = new Quaternion();
  private e = new Euler();
  private v = new Vector3();
  private s = new Vector3();

  add(geo: BufferGeometry, color: string, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) {
    const g = geo.clone();
    this.q.setFromEuler(this.e.set(rx, ry, rz));
    this.m.compose(this.v.set(x, y, z), this.q, this.s.set(sx, sy, sz));
    g.applyMatrix4(this.m);
    const c = new Color(color);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new Float32BufferAttribute(col, 3));
    this.list.push(g);
  }

  merge(): BufferGeometry {
    const out = mergeGeometries(this.list);
    this.list.forEach((g) => g.dispose());
    this.list = [];
    return out;
  }
}

const BOX = new BoxGeometry(1, 1, 1);
const BALL = new SphereGeometry(1, 7, 5);
const CONE = new ConeGeometry(1, 1, 6);
const CYL = new CylinderGeometry(1, 1, 1, 7);

interface PlayerView {
  model: PierogiModel;
  /** The loop twirling over the head while the lasso is ready. */
  twirl: Mesh;
  /** The loop in flight, and round a caught cow's neck. */
  loop: Mesh;
  neck: Mesh;
  aim: Mesh;
  aimMat: MeshBasicMaterial;
  color: Color;
  rot: number;
  bob: number;
  /** A missed throw reeling back in: seconds left and where from. */
  retract: number;
  rx: number;
  rz: number;
  squash: number;
}

interface CowView {
  root: Group;
  body: Mesh;
  legs: Mesh[];
  tail: Mesh;
  shadow: Mesh;
  phase: number;
  /** Little hop when penned. */
  hop: number;
  sink: number;
}

interface PenView {
  label: Sprite;
  tex: CanvasTexture;
  ctx: CanvasRenderingContext2D;
  shown: string;
  flag: Mesh;
}

const ease = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

export class CowsScene {
  readonly stage: ArenaStage;
  private players: PlayerView[] = [];
  private cows: CowView[] = [];
  private pens: PenView[] = [];
  private cowGeo: BufferGeometry[] = [];
  private legGeo: BufferGeometry;
  private tailGeo: BufferGeometry;
  private cowMat: MeshLambertMaterial;
  private cowGroup = new Group();
  private rope: InstancedMesh;
  private dust: Puffs;
  private confetti: Puffs;
  private colors: Color[];
  private who: Contender[];
  private dummy = new Object3D();
  private tmpColor = new Color();
  private white = new Color('#fff8ea');
  private clock = 0;
  private shake = 0;
  private camBase = new Vector3();
  private camTarget = new Vector3();
  private dustT = 0;
  private w: number;
  private h: number;

  constructor(canvas: HTMLCanvasElement, who: Contender[], sim: CowsSim) {
    this.who = who;
    this.w = sim.w;
    this.h = sim.h;
    this.colors = who.map((c) => new Color(c.color));
    this.stage = new ArenaStage(canvas, { sky: '#a9d6ee', fog: [110, 240], fov: 38 });
    const st = this.stage;
    st.sun.position.set(-0.45, 1, 0.5);
    const keep = <T extends { dispose(): void }>(x: T) => st.keep(x);

    this.cowMat = keep(new MeshLambertMaterial({ vertexColors: true, flatShading: true }));
    this.buildGround();
    this.buildFence();
    sim.pens.forEach((pen, i) => this.buildPen(pen.x, pen.z, pen.dir, i));
    this.buildFarm();

    // Cow geometry: one merged mesh per colour (patches and bell in the owner's colour), legs and tail apart.
    this.cowGeo = who.map((w) => keep(this.cowBody(w.color)));
    const lp = new Parts();
    lp.add(BOX, '#f6f1e4', 0, -0.26, 0, 0.22, 0.42, 0.22);
    lp.add(BOX, '#3a2a22', 0, -0.56, 0, 0.24, 0.18, 0.24);
    this.legGeo = keep(lp.merge());
    const tp = new Parts();
    tp.add(BOX, '#f6f1e4', 0, -0.3, 0, 0.07, 0.6, 0.07);
    tp.add(BOX, '#3a2a22', 0, -0.66, 0, 0.13, 0.2, 0.13);
    this.tailGeo = keep(tp.merge());
    st.add(this.cowGroup);

    // Ropes: every segment of every rope is one instance.
    const ropeGeo = keep(new CylinderGeometry(1, 1, 1, 5));
    const ropeMat = keep(new MeshLambertMaterial({ flatShading: true }));
    this.rope = new InstancedMesh(ropeGeo, ropeMat, Math.max(1, who.length) * SEGS);
    this.rope.frustumCulled = false;
    for (let i = 0; i < who.length * SEGS; i++) this.rope.setColorAt(i, this.colors[Math.floor(i / SEGS)]);
    this.rope.count = 0;
    st.add(this.rope);

    this.dust = new Puffs(220, -0.6, 2.4);
    this.confetti = new Puffs(260, 9, 0.6);
    st.add(this.dust.mesh, this.confetti.mesh);

    const loopGeo = keep(new TorusGeometry(0.5, 0.06, 4, 14));
    loopGeo.rotateX(Math.PI / 2);
    const neckGeo = keep(new TorusGeometry(0.42, 0.07, 4, 12));
    const ringGeo = keep(new RingGeometry(1.0, 1.25, 22));
    ringGeo.rotateX(-Math.PI / 2);
    const hatGeo = keep(new CylinderGeometry(1, 1, 1, 7));
    who.forEach((w, i) => {
      const model = buildPierogi(w.color);
      const tag = nameTag(w.name.slice(0, 10), '#fff4dc', 4.2);
      tag.position.y = 2.6;
      model.root.add(tag);
      // A little cowboy hat.
      const hatMat = keep(flat(new Color(w.color).multiplyScalar(0.72).getStyle()));
      const brim = new Mesh(hatGeo, hatMat);
      brim.scale.set(0.52, 0.06, 0.52);
      brim.position.set(0, 0.95, 0);
      const crown = new Mesh(hatGeo, hatMat);
      crown.scale.set(0.3, 0.3, 0.3);
      crown.position.set(0, 1.12, 0);
      const band = new Mesh(hatGeo, keep(flat('#fff4dc')));
      band.scale.set(0.31, 0.07, 0.31);
      band.position.set(0, 1.0, 0);
      model.body.add(brim, crown, band);
      const ropeMatI = keep(flat(new Color(w.color).lerp(this.white, 0.15).getStyle()));
      const twirl = new Mesh(loopGeo, ropeMatI);
      twirl.position.set(0.15, 1.85, 0);
      model.root.add(twirl);
      st.add(model.root);
      const loop = new Mesh(loopGeo, ropeMatI);
      loop.visible = false;
      const neck = new Mesh(neckGeo, ropeMatI);
      neck.visible = false;
      const aimMat = keep(new MeshBasicMaterial({ color: w.color, transparent: true, opacity: 0.8, depthWrite: false, side: DoubleSide }));
      const aim = new Mesh(ringGeo, aimMat);
      aim.visible = false;
      st.add(loop, neck, aim);
      this.players.push({ model, twirl, loop, neck, aim, aimMat, color: this.colors[i], rot: 0, bob: i, retract: 0, rx: 0, rz: 0, squash: 0 });
    });

    this.frame();
    this.reset(sim);
  }

  /** Aim the camera so the whole meadow and a little farm around it fill the TV. */
  private frame() {
    const dist = Math.max(this.w * 0.78 + 5, this.h * 1.52 + 5);
    this.camTarget.set(0, 0, this.h * 0.07);
    this.stage.lookAt(this.camTarget, dist, 0.98);
    this.camBase.copy(this.stage.camera.position);
  }

  // ---- building ----------------------------------------------------------------

  private cowBody(color: string): BufferGeometry {
    const p = new Parts();
    const W = '#f6f1e4';
    const pink = '#f2a5a0';
    const dark = '#2a1a14';
    // Body and head (faces +z).
    p.add(BOX, W, 0, 1.0, 0, 1.0, 0.82, 1.7);
    p.add(BOX, W, 0, 1.32, 1.02, 0.62, 0.6, 0.7);
    p.add(BOX, pink, 0, 1.16, 1.42, 0.56, 0.32, 0.22);
    p.add(BOX, dark, -0.12, 1.2, 1.54, 0.08, 0.08, 0.02);
    p.add(BOX, dark, 0.12, 1.2, 1.54, 0.08, 0.08, 0.02);
    p.add(BALL, dark, -0.2, 1.46, 1.37, 0.07, 0.08, 0.04);
    p.add(BALL, dark, 0.2, 1.46, 1.37, 0.07, 0.08, 0.04);
    p.add(BOX, W, -0.42, 1.5, 0.92, 0.3, 0.1, 0.16, 0, 0, 0.3);
    p.add(BOX, W, 0.42, 1.5, 0.92, 0.3, 0.1, 0.16, 0, 0, -0.3);
    p.add(CONE, '#efe0b8', -0.2, 1.72, 0.96, 0.07, 0.22, 0.07);
    p.add(CONE, '#efe0b8', 0.2, 1.72, 0.96, 0.07, 0.22, 0.07);
    p.add(BALL, pink, 0, 0.58, -0.25, 0.22, 0.12, 0.26);
    // Patches in the owner's colour: on both flanks, the back and the forehead.
    p.add(BOX, color, -0.51, 1.08, 0.25, 0.04, 0.56, 0.7);
    p.add(BOX, color, 0.51, 0.98, -0.3, 0.04, 0.52, 0.8);
    p.add(BOX, color, 0.12, 1.42, -0.15, 0.78, 0.04, 0.82);
    p.add(BOX, color, -0.2, 1.42, 0.55, 0.5, 0.04, 0.36);
    p.add(BOX, color, -0.51, 0.9, -0.55, 0.04, 0.32, 0.36);
    p.add(BOX, color, 0, 1.63, 1.12, 0.36, 0.04, 0.3);
    // Collar and bell.
    p.add(BOX, color, 0, 1.05, 0.74, 0.72, 0.12, 0.14);
    p.add(BALL, '#ffd23f', 0, 0.86, 0.84, 0.13, 0.13, 0.13);
    return p.merge();
  }

  private buildGround() {
    const st = this.stage;
    const outer = new Mesh(st.keep(new PlaneGeometry(320, 240)), st.keep(new MeshLambertMaterial({ map: st.keep(groundTexture('grass', 80, 11)), color: '#cfe0a8' })));
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -0.02;
    st.add(outer);
    const meadowTex = st.keep(
      pixelTexture(
        16,
        (ctx, rnd) => {
          noise(ctx, rnd, 16, [104, 166, 70], 30);
          ctx.fillStyle = 'rgba(255,240,150,.55)';
          for (let k = 0; k < 4; k++) ctx.fillRect(Math.floor(rnd() * 16), Math.floor(rnd() * 16), 1, 1);
        },
        14,
        1,
      ),
    );
    meadowTex.repeat.set(this.w / 2.4, this.h / 2.4);
    const meadow = new Mesh(st.keep(new PlaneGeometry(this.w, this.h)), st.keep(new MeshLambertMaterial({ map: meadowTex })));
    meadow.rotation.x = -Math.PI / 2;
    st.add(meadow);
    // Flowers dotted over the meadow.
    const fp = new Parts();
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < Math.round(this.w * this.h * 0.08); k++) {
      const x = (rnd() - 0.5) * this.w * 0.97;
      const z = (rnd() - 0.5) * this.h * 0.97;
      fp.add(BALL, ['#fff8ea', '#ffd23f', '#f28ab0', '#b9a3ff'][k % 4], x, 0.06, z, 0.09, 0.06, 0.09);
    }
    st.add(new Mesh(st.keep(fp.merge()), this.cowMat));
  }

  /** The fence round the meadow, posts and two rails, in one mesh. */
  private buildFence() {
    const p = new Parts();
    const hw = this.w / 2;
    const hh = this.h / 2;
    const post = (x: number, z: number) => p.add(BOX, '#7a4f2c', x, 0.6, z, 0.24, 1.2, 0.24);
    const rails = (ax: number, az: number, bx: number, bz: number) => {
      const len = Math.hypot(bx - ax, bz - az);
      const ry = Math.atan2(bx - ax, bz - az);
      for (const y of [0.45, 0.9]) p.add(BOX, '#a8743f', (ax + bx) / 2, y, (az + bz) / 2, 0.1, 0.12, len, 0, ry, 0);
    };
    for (const [ax, az, bx, bz] of [
      [-hw, -hh, hw, -hh],
      [-hw, hh, hw, hh],
      [-hw, -hh, -hw, hh],
      [hw, -hh, hw, hh],
    ]) {
      rails(ax, az, bx, bz);
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.round(len / 2.5);
      for (let k = 0; k <= n; k++) post(ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n);
    }
    this.stage.add(new Mesh(this.stage.keep(p.merge()), this.cowMat));
  }

  /** A pen: straw floor, fence with rails in the player's colour, a flag and a count over it. */
  private buildPen(x: number, z: number, dir: 1 | -1, i: number) {
    const st = this.stage;
    const color = this.who[i].color;
    const s = PEN / 2;
    const g = GATE / 2;
    const p = new Parts();
    // Straw floor with a coloured border.
    p.add(BOX, new Color(color).lerp(new Color('#e8cf7a'), 0.55).getStyle(), x, 0.015, z, PEN - 0.1, 0.03, PEN - 0.1);
    p.add(BOX, '#e8cf7a', x, 0.03, z, PEN - 0.9, 0.03, PEN - 0.9);
    for (let k = 0; k < 10; k++) p.add(BOX, '#d4b45a', x + Math.sin(k * 2.3 + i) * s * 0.7, 0.05, z + Math.cos(k * 1.7 + i) * s * 0.7, 0.5, 0.02, 0.06, 0, k, 0);
    const back = z - dir * s;
    const front = z + dir * s;
    const post = (px: number, pz: number, h = 1.35) => p.add(BOX, '#6b4426', px, h / 2, pz, 0.26, h, 0.26);
    const rail = (ax: number, az: number, bx: number, bz: number) => {
      const len = Math.hypot(bx - ax, bz - az);
      const ry = Math.atan2(bx - ax, bz - az);
      for (const y of [0.5, 1.0]) p.add(BOX, color, (ax + bx) / 2, y, (az + bz) / 2, 0.12, 0.14, len, 0, ry, 0);
    };
    rail(x - s, back, x + s, back);
    rail(x - s, back, x - s, front);
    rail(x + s, back, x + s, front);
    rail(x - s, front, x - g, front);
    rail(x + g, front, x + s, front);
    for (const [px, pz] of [
      [x - s, back],
      [x + s, back],
      [x - s, front],
      [x + s, front],
      [x - s, z],
      [x + s, z],
      [x, back],
    ])
      post(px, pz);
    // Gate posts, taller, with a sign board over the gate.
    post(x - g, front, 2.3);
    post(x + g, front, 2.3);
    p.add(BOX, '#8a5a30', x, 2.15, front, GATE + 0.5, 0.42, 0.12);
    // A water trough at the back.
    p.add(BOX, '#7a8590', x + s * 0.45, 0.3, back + dir * 0.6, 1.6, 0.6, 0.6);
    p.add(BOX, '#4f9dff', x + s * 0.45, 0.58, back + dir * 0.6, 1.4, 0.04, 0.42);
    // Flagpole at the back corner.
    p.add(CYL, '#d8d2c4', x - s + 0.3, 1.9, back + dir * 0.3, 0.06, 3.8, 0.06);
    st.add(new Mesh(st.keep(p.merge()), this.cowMat));
    const flagGeo = st.keep(new PlaneGeometry(1.3, 0.8, 4, 1));
    flagGeo.translate(0.65, 0, 0);
    const flag = new Mesh(flagGeo, st.keep(new MeshBasicMaterial({ color, side: DoubleSide })));
    flag.position.set(x - s + 0.36, 3.35, back + dir * 0.3);
    st.add(flag);
    // The count, floating over the pen.
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 64;
    const ctx = c.getContext('2d')!;
    const tex = st.keep(new CanvasTexture(c));
    tex.magFilter = tex.minFilter = NearestFilter;
    tex.colorSpace = SRGBColorSpace;
    const label = new Sprite(st.keep(new SpriteMaterial({ map: tex, depthTest: false, fog: false })));
    label.scale.set(4.4, 2.2, 1);
    label.position.set(x, 3.4, z + 1.2);
    label.renderOrder = 9;
    st.add(label);
    this.pens.push({ label, tex, ctx, shown: '', flag });
  }

  private drawLabel(i: number, text: string) {
    const pv = this.pens[i];
    if (pv.shown === text) return;
    pv.shown = text;
    const ctx = pv.ctx;
    ctx.clearRect(0, 0, 128, 64);
    ctx.fillStyle = 'rgba(30,12,16,.78)';
    ctx.beginPath();
    ctx.roundRect(14, 8, 100, 48, 16);
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = this.who[i].color;
    ctx.stroke();
    ctx.font = '800 32px "Fraunces Variable", Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff4dc';
    ctx.fillText(text, 64, 34);
    pv.tex.needsUpdate = true;
  }

  /** A barn, a silo, a farmhouse, hay bales and trees round the meadow. */
  private buildFarm() {
    const p = new Parts();
    const hw = this.w / 2;
    const hh = this.h / 2;
    // Barn behind the top-left corner.
    const bx = -hw + 6;
    const bz = -hh - 9;
    p.add(BOX, '#b8362e', bx, 3, bz, 10, 6, 7);
    p.add(BOX, '#f6f1e4', bx, 1.8, bz + 3.52, 3.6, 3.6, 0.06);
    p.add(BOX, '#7a1f1a', bx, 1.8, bz + 3.56, 3.0, 3.2, 0.06);
    p.add(BOX, '#f6f1e4', bx, 1.8, bz + 3.6, 0.2, 3.4, 0.06, 0, 0, 0.75);
    p.add(BOX, '#f6f1e4', bx, 1.8, bz + 3.6, 0.2, 3.4, 0.06, 0, 0, -0.75);
    p.add(BOX, '#5a3a2a', bx, 6.9, bz, 10.6, 0.3, 5.2, 0.62, 0, 0);
    p.add(BOX, '#5a3a2a', bx, 6.9, bz - 1.6, 10.6, 0.3, 5.2, -0.62, 0, 0);
    p.add(BOX, '#b8362e', bx, 7.2, bz - 0.8, 9.9, 2.6, 2.4);
    p.add(BOX, '#f6f1e4', bx, 7.3, bz + 0.45, 1.2, 1.2, 0.06);
    // Silo.
    p.add(CYL, '#c9ccd3', bx + 7.5, 4.5, bz - 1, 2, 9, 2);
    p.add(CONE, '#8c909a', bx + 7.5, 9.8, bz - 1, 2.2, 1.6, 2.2);
    // Farmhouse behind the top-right corner.
    const fx = hw - 7;
    const fz = -hh - 8;
    p.add(BOX, '#f2e3c0', fx, 2.2, fz, 8, 4.4, 5.5);
    p.add(BOX, '#6b8f3a', fx, 5.2, fz, 8.6, 0.25, 4.6, 0.7, 0, 0);
    p.add(BOX, '#6b8f3a', fx, 5.2, fz - 2, 8.6, 0.25, 4.6, -0.7, 0, 0);
    p.add(BOX, '#f2e3c0', fx, 5, fz - 1, 7.8, 1.6, 2.6);
    for (const dx of [-2.4, 2.4]) {
      p.add(BOX, '#7fc3e8', fx + dx, 2.6, fz + 2.77, 1.3, 1.2, 0.05);
      p.add(BOX, '#2f5fae', fx + dx - 0.95, 2.6, fz + 2.78, 0.5, 1.3, 0.05);
      p.add(BOX, '#2f5fae', fx + dx + 0.95, 2.6, fz + 2.78, 0.5, 1.3, 0.05);
    }
    p.add(BOX, '#5a3a2a', fx, 1.1, fz + 2.77, 1.2, 2.2, 0.05);
    p.add(BOX, '#a33a2e', fx + 2.6, 5.8, fz - 1, 0.7, 2, 0.7);
    // Hay bales along the sides.
    for (const [x, z] of [
      [-hw - 3, -2],
      [-hw - 3.2, 1.2],
      [-hw - 5.4, -0.4],
      [hw + 3, 3],
      [hw + 3.4, -0.6],
      [-hw + 14, -hh - 3.4],
    ]) {
      p.add(CYL, '#e2c25a', x, 0.7, z, 0.9, 1.6, 0.9, Math.PI / 2, 0, 0);
      p.add(CYL, '#c9a640', x, 0.7, z, 0.6, 1.62, 0.6, Math.PI / 2, 0, 0);
    }
    // Trees all around, kept out of the camera's way at the front.
    let seed = 3;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const tree = (x: number, z: number, s: number) => {
      p.add(CYL, '#6b4426', x, 0.9 * s, z, 0.25 * s, 1.8 * s, 0.25 * s);
      const green = ['#3f7d34', '#4f9a3c', '#357030'][Math.floor(rnd() * 3)];
      p.add(CONE, green, x, 2.6 * s, z, 1.5 * s, 2.4 * s, 1.5 * s);
      p.add(CONE, green, x, 3.8 * s, z, 1.1 * s, 2 * s, 1.1 * s);
    };
    for (let k = 0; k < 26; k++) {
      const x = -hw - 30 + rnd() * (this.w + 60);
      const z = -hh - 14 - rnd() * 20;
      if (Math.abs(x - bx) < 9 && z > bz - 6) continue;
      if (Math.abs(x - fx) < 7 && z > fz - 6) continue;
      tree(x, z, 1 + rnd() * 0.8);
    }
    for (const s of [-1, 1])
      for (let k = 0; k < 8; k++) tree(s * (hw + 7 + rnd() * 16), -hh - 4 + rnd() * (this.h + 10), 0.9 + rnd() * 0.7);
    this.stage.add(new Mesh(this.stage.keep(p.merge()), this.cowMat));
  }

  // ---- rounds -----------------------------------------------------------------

  /** A new herd (the colours are shuffled every round). */
  reset(sim: CowsSim) {
    this.cowGroup.clear();
    this.cows = sim.cows.map((c, k) => {
      const root = new Group();
      const body = new Mesh(this.cowGeo[c.owner], this.cowMat);
      root.add(body);
      const legs: Mesh[] = [];
      for (const [x, z] of [
        [-0.32, 0.58],
        [0.32, 0.58],
        [-0.32, -0.6],
        [0.32, -0.6],
      ]) {
        const leg = new Mesh(this.legGeo, this.cowMat);
        leg.position.set(x, 0.65, z);
        root.add(leg);
        legs.push(leg);
      }
      const tail = new Mesh(this.tailGeo, this.cowMat);
      tail.position.set(0, 1.3, -0.86);
      tail.rotation.x = -0.25;
      root.add(tail);
      const shadow = blobShadow(1.0, 0.3);
      shadow.scale.set(0.7, 1.15, 1);
      root.add(shadow);
      root.position.set(c.x, 0, c.z);
      root.rotation.y = c.rot;
      this.cowGroup.add(root);
      return { root, body, legs, tail, shadow, phase: k * 0.7, hop: 0, sink: 0 };
    });
    for (const pv of this.players) {
      pv.retract = 0;
      pv.loop.visible = false;
      pv.neck.visible = false;
      pv.aim.visible = false;
    }
    this.rope.count = 0;
  }

  // ---- events -----------------------------------------------------------------

  events(ev: CowsEvent[], sim: CowsSim) {
    for (const e of ev) {
      switch (e.t) {
        case 'miss': {
          const p = sim.players[e.p];
          const pv = this.players[e.p];
          pv.retract = RETRACT;
          pv.rx = p.tx;
          pv.rz = p.tz;
          for (let k = 0; k < 5; k++) this.dust.spawn(p.tx, 0.2, p.tz, (Math.random() - 0.5) * 2, 0.6 + Math.random(), (Math.random() - 0.5) * 2, 0.35, 0.6, '#d9c7a0');
          break;
        }
        case 'catch': {
          const c = sim.cows[e.cow];
          this.cows[e.cow].hop = 1;
          const col = this.who[e.p].color;
          for (let k = 0; k < 10; k++) {
            const a = (k / 10) * Math.PI * 2;
            this.confetti.spawn(c.x, 1.6, c.z, Math.cos(a) * 3, 3 + Math.random() * 2, Math.sin(a) * 3, 0.16, 0.6, k % 2 ? col : '#fff8ea', 0);
          }
          this.players[e.p].squash = 1;
          break;
        }
        case 'pen': {
          const c = sim.cows[e.cow];
          this.cows[e.cow].hop = 1;
          const col = this.who[e.p].color;
          for (let k = 0; k < 26; k++) {
            const a = Math.random() * Math.PI * 2;
            const s = 2 + Math.random() * 4;
            this.confetti.spawn(c.x, 1.5, c.z, Math.cos(a) * s, 6 + Math.random() * 5, Math.sin(a) * s, 0.2, 1.3, ['#ffd23f', '#fff8ea', col][k % 3], 0);
          }
          this.shake = Math.max(this.shake, 0.15);
          break;
        }
        case 'done': {
          const pen = sim.pens[e.p];
          for (let k = 0; k < 90; k++) {
            const a = Math.random() * Math.PI * 2;
            const s = 2 + Math.random() * 7;
            this.confetti.spawn(pen.x, 2, pen.z, Math.cos(a) * s, 8 + Math.random() * 8, Math.sin(a) * s, 0.22, 2, ['#ffd23f', '#fff8ea', '#ff3d6e', '#4f9dff', this.who[e.p].color][k % 5], 0);
          }
          this.shake = Math.max(this.shake, 0.4);
          break;
        }
        case 'moo':
          this.cows[e.cow].hop = Math.max(this.cows[e.cow].hop, 0.6);
          break;
        default:
          break;
      }
    }
  }

  // ---- per frame ----------------------------------------------------------------

  render(sim: CowsSim, dt: number) {
    this.clock += dt;
    this.updateCows(sim, dt);
    this.updatePlayers(sim, dt);
    this.updateRopes(sim);
    sim.pens.forEach((_, i) => this.drawLabel(i, `${sim.players[i]?.penned ?? 0}/${sim.cowsEach}`));
    this.pens.forEach((pv, i) => {
      pv.flag.rotation.y = Math.sin(this.clock * 3 + i) * 0.25;
      pv.label.visible = sim.players[i]?.alive ?? false;
    });
    this.dust.update(dt);
    this.confetti.update(dt);
    this.shake = Math.max(0, this.shake - dt * 1.6);
    const cam = this.stage.camera;
    const s = this.shake * 0.5;
    cam.position.set(this.camBase.x + (Math.random() - 0.5) * s, this.camBase.y + (Math.random() - 0.5) * s, this.camBase.z + (Math.random() - 0.5) * s);
    cam.lookAt(this.camTarget);
    this.stage.render();
  }

  private updateCows(sim: CowsSim, dt: number) {
    this.dustT -= dt;
    const puff = this.dustT <= 0;
    if (puff) this.dustT = 0.08;
    sim.cows.forEach((c, k) => {
      const v = this.cows[k];
      if (!v) return;
      if (!c.alive) {
        v.sink = Math.min(1, v.sink + dt * 1.5);
        v.root.scale.setScalar(1 - ease(v.sink));
        v.root.visible = v.sink < 1;
        return;
      }
      const sp = Math.hypot(c.vx, c.vz);
      v.phase += dt * (2 + sp * 4.5);
      const swing = Math.min(0.7, sp * 0.35) * Math.sin(v.phase);
      v.legs[0].rotation.x = swing;
      v.legs[3].rotation.x = swing;
      v.legs[1].rotation.x = -swing;
      v.legs[2].rotation.x = -swing;
      v.tail.rotation.z = Math.sin(this.clock * 2.4 + k) * 0.35;
      v.hop = Math.max(0, v.hop - dt * 2.2);
      const hop = Math.sin(v.hop * Math.PI) * 0.5;
      const graze = sp < 0.2 && c.heldBy < 0 ? Math.max(0, Math.sin(this.clock * 0.6 + k * 1.9)) : 0;
      v.root.position.set(c.x, hop + Math.abs(Math.sin(v.phase)) * Math.min(0.08, sp * 0.03), c.z);
      v.root.rotation.y = c.rot;
      // Being dragged: lean back against the rope.
      v.body.rotation.x = c.heldBy >= 0 ? -Math.min(0.18, sp * 0.04) : graze * 0.12;
      v.shadow.scale.set(0.7 - hop * 0.2, 1.15 - hop * 0.3, 1);
      if (puff && c.heldBy >= 0 && sp > 1.5) this.dust.spawn(c.x - Math.sin(c.rot) * 0.8, 0.2, c.z - Math.cos(c.rot) * 0.8, (Math.random() - 0.5) * 0.6, 0.4, (Math.random() - 0.5) * 0.6, 0.35, 0.7, '#d9c7a0');
    });
  }

  private updatePlayers(sim: CowsSim, dt: number) {
    this.players.forEach((pv, i) => {
      const p = sim.players[i];
      const root = pv.model.root;
      if (!p || !p.alive) {
        root.visible = pv.loop.visible = pv.neck.visible = pv.aim.visible = false;
        return;
      }
      root.visible = true;
      pv.bob += dt * (p.speed > 0 ? 9 + p.speed * 5 : 0);
      const hop = p.speed > 0 ? Math.abs(Math.sin(pv.bob)) * 0.18 * p.speed : 0;
      pv.squash = Math.max(0, pv.squash - dt * 3.2);
      const sq = Math.sin(pv.squash * Math.PI) * 0.22;
      // Face where you walk, or the cow you're hauling when standing still.
      let fx = p.fx;
      let fz = p.fz;
      if (p.hold >= 0 && p.speed === 0) {
        const c = sim.cows[p.hold];
        fx = c.x - p.x;
        fz = c.z - p.z;
      }
      const target = Math.atan2(fx, fz);
      let d = target - pv.rot;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      pv.rot += d * Math.min(1, dt * 16);
      root.position.set(p.x, hop, p.z);
      root.rotation.y = pv.rot;
      root.scale.setScalar(CHAR_SCALE);
      pv.model.body.scale.set(1 + sq, 1 - sq, 1 + sq);
      // Lean into the pull while dragging.
      pv.model.body.rotation.x = p.hold >= 0 && p.speed > 0 ? 0.22 : p.speed > 0 ? 0.1 : 0;
      pv.model.body.rotation.z = p.speed > 0 ? Math.sin(pv.bob) * 0.08 : 0;

      // The lasso: twirling over the head when ready, flying out, reeling back after a miss.
      pv.retract = Math.max(0, pv.retract - dt);
      const ready = p.hold < 0 && p.throwT <= 0 && pv.retract <= 0;
      pv.twirl.visible = ready;
      if (ready) {
        pv.twirl.rotation.y += dt * (p.cd > 0 ? 4 : 11);
        pv.twirl.rotation.x = 0.25;
        pv.twirl.scale.setScalar(p.cd > 0 ? 0.6 : 1);
      }
      if (p.throwT > 0) {
        const u = Math.min(1, p.throwT / THROW_TIME);
        pv.loop.visible = true;
        pv.loop.position.set(p.x + (p.tx - p.x) * u, 1.9 + Math.sin(u * Math.PI) * 1.4 - u * 0.6, p.z + (p.tz - p.z) * u);
        pv.loop.rotation.set(0, this.clock * 9, 0);
        pv.loop.scale.setScalar(1 + u * 0.3);
      } else if (pv.retract > 0) {
        const u = 1 - pv.retract / RETRACT;
        pv.loop.visible = true;
        pv.loop.position.set(pv.rx + (p.x - pv.rx) * u, 0.3 + u * 1.5, pv.rz + (p.z - pv.rz) * u);
        pv.loop.scale.setScalar(1 - u * 0.4);
      } else pv.loop.visible = false;

      // Round the neck of the cow on the rope.
      if (p.hold >= 0) {
        const c = sim.cows[p.hold];
        pv.neck.visible = true;
        pv.neck.position.set(c.x + Math.sin(c.rot) * 0.72, 1.12 + this.cows[p.hold].root.position.y, c.z + Math.cos(c.rot) * 0.72);
        pv.neck.rotation.set(0, c.rot, 0);
      } else pv.neck.visible = false;

      // Which cow a throw would catch right now.
      if (p.aim >= 0) {
        const c = sim.cows[p.aim];
        pv.aim.visible = true;
        pv.aim.position.set(c.x, 0.06, c.z);
        pv.aim.scale.setScalar(1 + Math.sin(this.clock * 8) * 0.06);
        pv.aimMat.opacity = 0.65 + Math.sin(this.clock * 8) * 0.25;
      } else pv.aim.visible = false;
    });
  }

  private hand = new Vector3();
  private end = new Vector3();
  private a = new Vector3();
  private b = new Vector3();
  private up = new Vector3(0, 1, 0);
  private q = new Quaternion();

  /** Every rope as a chain of short cylinders: a sagging curve when slack, a straight, thinner line when stretched. */
  private updateRopes(sim: CowsSim) {
    let n = 0;
    const d = this.dummy;
    this.players.forEach((pv, i) => {
      const p = sim.players[i];
      if (!p || !p.alive) return;
      let tension = 0;
      let sag = 0;
      this.hand.set(p.x + Math.sin(pv.rot) * 0.55 + Math.cos(pv.rot) * 0.35, 1.0, p.z + Math.cos(pv.rot) * 0.55 - Math.sin(pv.rot) * 0.35);
      if (p.hold >= 0) {
        this.end.copy(pv.neck.position);
        const dist = Math.hypot(p.x - sim.cows[p.hold].x, p.z - sim.cows[p.hold].z);
        tension = Math.min(1, Math.max(0, (dist - ROPE_LEN) / (ROPE_MAX - ROPE_LEN)));
        sag = Math.max(0, ROPE_LEN + 0.2 - dist) * 0.5 + (1 - tension) * 0.15;
      } else if (pv.loop.visible) {
        this.end.copy(pv.loop.position);
        sag = 0.25;
      } else return;
      const r = 0.12 * (1 - 0.35 * tension);
      this.tmpColor.copy(pv.color).lerp(this.white, 0.08 + tension * 0.4);
      for (let k = 0; k < SEGS; k++) {
        this.point(k / SEGS, sag, tension, this.a);
        this.point((k + 1) / SEGS, sag, tension, this.b);
        const len = this.a.distanceTo(this.b);
        d.position.copy(this.a).add(this.b).multiplyScalar(0.5);
        this.b.sub(this.a).normalize();
        this.q.setFromUnitVectors(this.up, this.b);
        d.quaternion.copy(this.q);
        d.scale.set(r, len + 0.02, r);
        d.updateMatrix();
        this.rope.setMatrixAt(n, d.matrix);
        this.rope.setColorAt(n, this.tmpColor);
        n++;
      }
    });
    this.rope.count = n;
    this.rope.instanceMatrix.needsUpdate = true;
    if (this.rope.instanceColor) this.rope.instanceColor.needsUpdate = true;
  }

  private point(t: number, sag: number, tension: number, out: Vector3) {
    out.lerpVectors(this.hand, this.end, t);
    out.y = Math.max(0.05, out.y - sag * 4 * t * (1 - t));
    // A stretched rope hums a little.
    if (tension > 0.6) out.y += Math.sin(this.clock * 60 + t * 9) * 0.03 * tension * Math.sin(t * Math.PI);
    return out;
  }

  dispose() {
    this.stage.dispose();
  }
}
