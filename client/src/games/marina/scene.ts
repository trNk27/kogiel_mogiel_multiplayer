/**
 * Przystań in 3D: a little Baltic marina on a sunny afternoon. Gabled harbour houses in Gdańsk
 * colours stand on a stone quay at the top of the TV, wooden pontoons and a jetty stick out into
 * gently swelling water, stone breakwaters close it in, and a lighthouse watches from the corner.
 * Every player's berth is painted on the water in their colour with a flag and their name on the
 * pier. The boats are small motorboats with a pierogi at the wheel; they pitch, heel, bob, leave a
 * V-shaped wake and churn the water at the stern. Same PS2 look as the other arena games.
 */
import {
  AmbientLight,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  ExtrudeGeometry,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  Shape,
  SphereGeometry,
  Vector3,
  type Material,
  type Sprite,
} from 'three';
import { ArenaStage, box, buildPierogi, flat, groundTexture, nameTag, noise, pixelTexture, type PierogiModel } from '../arena/kit';
import { Puffs } from '../arena/puffs';
import { mulberry32 } from '../rng';
import { BOAT_HL, BOAT_HW, DOCK_HOLD, HALF_W, QUAY_Z, SHORE_Z, fwd, stbd, type Berth, type MarinaSim } from './logic';

export interface PlayerLook {
  name: string;
  color: string;
}

/** Height of the water at rest; the quay top, pontoon decks and painted lines. */
const QUAY_TOP = 1.0;
const DECK_Y = 0.5;
const LINE_Y = 0.16;
const WATER_COLOR = '#2f8fb0';

const smooth = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

// ---- the boat model ---------------------------------------------------------------------------------

interface BoatModel {
  root: Group;
  /** Pitch and roll go on this (the root only turns). */
  tilt: Group;
  skipper: PierogiModel | null;
  prop: Mesh;
}

/** A hull outline in the x/z plane, bow at +z, as a Shape (shape y = −z; see the extrude below). */
function hullShape(hl: number, hw: number, inset = 0) {
  const w = hw - inset;
  const l = hl - inset;
  const s = new Shape();
  s.moveTo(-w, l * 1);
  s.lineTo(w, l);
  s.lineTo(w, -l * 0.42);
  s.quadraticCurveTo(w * 0.95, -l * 0.86, 0, -l);
  s.quadraticCurveTo(-w * 0.95, -l * 0.86, -w, -l * 0.42);
  s.lineTo(-w, l);
  return s;
}

function extrudeHull(hl: number, hw: number, height: number, inset = 0) {
  const g = new ExtrudeGeometry(hullShape(hl, hw, inset), { depth: height, bevelEnabled: false, curveSegments: 3 });
  // Extruded along +z; stand it up so it rises along +y, with shape y becoming −z (the bow at +z).
  g.rotateX(-Math.PI / 2);
  return g;
}

/**
 * A small motorboat, BOAT_LEN × BOAT_BEAM, facing +z: a hull in `color` with a cream deck, a
 * console with a windscreen, an outboard at the stern, and (for players) a pierogi at the wheel.
 */
function buildBoat(color: string, keep: <T extends { dispose(): void }>(x: T) => T, opts: { skipper: boolean; hl?: number; hw?: number; sail?: boolean; deck?: string }) {
  const hl = opts.hl ?? BOAT_HL;
  const hw = opts.hw ?? BOAT_HW;
  const root = new Group();
  const tilt = new Group();
  root.add(tilt);
  const hullMat = keep(flat(color));
  const dark = keep(flat(new Color(color).multiplyScalar(0.62).getStyle()));
  const deckMat = keep(flat(opts.deck ?? '#f4ead6'));
  const white = keep(flat('#fbf6ec'));
  const grey = keep(flat('#3b3f48'));
  const glass = keep(new MeshLambertMaterial({ color: '#a9dcf0', transparent: true, opacity: 0.75, flatShading: true }));

  const hull = new Mesh(keep(extrudeHull(hl, hw, 0.62)), hullMat);
  hull.position.y = -0.22;
  const stripe = new Mesh(keep(extrudeHull(hl + 0.02, hw + 0.02, 0.1)), dark);
  stripe.position.y = 0.3;
  const deck = new Mesh(keep(extrudeHull(hl, hw, 0.06, 0.12)), deckMat);
  deck.position.y = 0.4;
  tilt.add(hull, stripe, deck);
  // Console and windscreen amidships.
  const consoleBox = box(hw * 1.0, 0.5, 0.55, white);
  consoleBox.position.set(0, 0.42, hl * 0.05);
  const screen = new Mesh(keep(new BoxGeometry(hw * 1.15, 0.38, 0.06)), glass);
  screen.position.set(0, 1.06, hl * 0.05 + 0.3);
  screen.rotation.x = -0.45;
  tilt.add(consoleBox, screen);
  // Outboard.
  const motor = box(0.42, 0.62, 0.38, grey);
  motor.position.set(0, 0.25, -hl - 0.1);
  const cowl = box(0.46, 0.22, 0.42, hullMat);
  cowl.position.set(0, 0.85, -hl - 0.1);
  const prop = new Mesh(keep(new BoxGeometry(0.5, 0.08, 0.08)), grey);
  prop.position.set(0, -0.25, -hl - 0.18);
  tilt.add(motor, cowl, prop);
  // Fenders.
  const fenderGeo = keep(new CylinderGeometry(0.1, 0.1, 0.36, 6));
  for (const sx of [-1, 1])
    for (const z of [-0.5, 0.6]) {
      const f = new Mesh(fenderGeo, white);
      f.position.set(sx * (hw + 0.06), 0.22, z * hl);
      tilt.add(f);
    }
  if (opts.sail) {
    const mast = new Mesh(keep(new CylinderGeometry(0.06, 0.08, 7, 5)), white);
    mast.position.set(0, 3.9, hl * 0.25);
    const boom = new Mesh(keep(new CylinderGeometry(0.05, 0.05, hl * 1.1, 5)), white);
    boom.rotation.x = Math.PI / 2;
    boom.position.set(0, 1.5, -hl * 0.25);
    const furled = new Mesh(keep(new CylinderGeometry(0.16, 0.12, hl * 1.0, 6)), keep(flat('#2f4f7a')));
    furled.rotation.x = Math.PI / 2;
    furled.position.set(0, 1.68, -hl * 0.25);
    tilt.add(mast, boom, furled);
  }
  let skipper: PierogiModel | null = null;
  if (opts.skipper) {
    skipper = buildPierogi(color);
    skipper.root.scale.setScalar(0.58);
    skipper.root.position.set(0, 0.44, -hl * 0.32);
    skipper.shadow.visible = false;
    tilt.add(skipper.root);
  }
  return { root, tilt, skipper, prop } satisfies BoatModel;
}

// ---- foam -------------------------------------------------------------------------------------------

/** Flat foam patches on the water (wake, bow wave, churn): one InstancedMesh; they shrink as they fade. */
class Foam {
  readonly mesh: InstancedMesh;
  private x: Float32Array;
  private z: Float32Array;
  private vx: Float32Array;
  private vz: Float32Array;
  private life: Float32Array;
  private max: Float32Array;
  private size: Float32Array;
  private grow: Float32Array;
  private next = 0;
  private m = new Matrix4();
  private q = new Quaternion();
  private s = new Vector3();
  private p = new Vector3();

  constructor(
    private count: number,
    color: string,
    private y: number,
  ) {
    const geo = new CircleGeometry(0.5, 6);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new InstancedMesh(geo, new MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false }), count);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.renderOrder = 2;
    this.x = new Float32Array(count);
    this.z = new Float32Array(count);
    this.vx = new Float32Array(count);
    this.vz = new Float32Array(count);
    this.life = new Float32Array(count);
    this.max = new Float32Array(count).fill(1);
    this.size = new Float32Array(count);
    this.grow = new Float32Array(count);
    this.m.makeScale(0, 0, 0);
    for (let i = 0; i < count; i++) this.mesh.setMatrixAt(i, this.m);
  }

  spawn(x: number, z: number, vx: number, vz: number, size: number, life: number, grow = 1.2) {
    const i = this.next;
    this.next = (this.next + 1) % this.count;
    this.x[i] = x;
    this.z[i] = z;
    this.vx[i] = vx;
    this.vz[i] = vz;
    this.life[i] = this.max[i] = life;
    this.size[i] = size;
    this.grow[i] = grow;
  }

  update(dt: number, wave: (x: number, z: number) => number) {
    const damp = Math.exp(-1.6 * dt);
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.m.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, this.m);
        continue;
      }
      this.vx[i] *= damp;
      this.vz[i] *= damp;
      this.x[i] += this.vx[i] * dt;
      this.z[i] += this.vz[i] * dt;
      const k = this.life[i] / this.max[i];
      const sz = this.size[i] * (1 + (1 - k) * this.grow[i]) * Math.min(1, k * 1.6);
      this.p.set(this.x[i], this.y + wave(this.x[i], this.z[i]), this.z[i]);
      this.s.set(sz, 1, sz);
      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ---- per-player bits ----------------------------------------------------------------------------------

interface Actor {
  model: BoatModel;
  tag: Sprite;
  color: string;
  /** Smoothed motion for the look: surge speed, its rate of change, yaw rate. */
  u: number;
  accel: number;
  yaw: number;
  phase: number;
  /** Seconds since docking (−1: not docked), for the settle, rope and confetti. */
  docked: number;
  /** A little shove when bumped (decays). */
  jolt: number;
  foamAcc: number;
}

interface BerthMark {
  owner: number;
  group: Group;
  fill: MeshBasicMaterial;
  /** Solid strips round the outline, filling up while the boat holds still. */
  solid: Mesh[];
  flag: Mesh;
  pole: Group;
  tag: Sprite;
  rope: Mesh;
  ropeMat: MeshLambertMaterial;
}

interface Ripple {
  mesh: Mesh;
  mat: MeshBasicMaterial;
  t: number;
  max: number;
  grow: number;
}

export class MarinaScene {
  readonly stage: ArenaStage;
  private keep: <T extends { dispose(): void }>(x: T) => T;
  private actors: Actor[] = [];
  private looks: PlayerLook[];
  /** Everything that changes with the layout (rebuilt every round). */
  private harbour = new Group();
  private harbourStuff: { dispose(): void }[] = [];
  private marks: BerthMark[] = [];
  private flags: { mesh: Mesh; base: number; phase: number }[] = [];
  private streaks: { mesh: Mesh; x: number; z: number; s: number }[] = [];
  private buoyMeshes: Mesh[] = [];
  private moored: { g: Group; phase: number; y: number }[] = [];
  private layoutRef: unknown = null;
  private water!: Mesh;
  private waterGeo!: PlaneGeometry;
  private waterBase!: Float32Array;
  private foam = new Foam(900, '#f4fbff', 0.1);
  private churn = new Foam(300, '#d9f1f7', 0.12);
  private puffs = new Puffs(260, 9, 1.2);
  private confetti = new Puffs(260, 5, 0.8);
  private ripples: Ripple[] = [];
  private wind = { x: 0, z: 0 };
  private time = 0;
  private shake = 0;

  constructor(canvas: HTMLCanvasElement, looks: PlayerLook[]) {
    this.stage = new ArenaStage(canvas, { sky: '#9fd3ec', fog: [90, 220], fov: 36 });
    const stage = this.stage;
    this.keep = <T extends { dispose(): void }>(x: T) => stage.keep(x);
    this.looks = looks;
    this.light();
    this.buildSky();
    this.buildWater();
    this.buildQuay();
    this.buildTown();
    this.buildBreakwaters();
    stage.add(this.harbour, this.foam.mesh, this.churn.mesh, this.puffs.mesh, this.confetti.mesh);
    this.keep(this.foam.mesh.geometry);
    this.keep(this.foam.mesh.material as Material);
    this.keep(this.churn.mesh.geometry);
    this.keep(this.churn.mesh.material as Material);
    looks.forEach((l, i) => {
      const model = buildBoat(l.color, this.keep, { skipper: true, deck: new Color(l.color).lerp(new Color('#ffffff'), 0.35).getStyle() });
      const tag = nameTag(l.name, l.color);
      tag.position.set(0, 3.4, 0);
      tag.scale.set(5.2, 1.3, 1);
      model.root.add(tag);
      stage.add(model.root);
      this.actors.push({ model, tag, color: l.color, u: 0, accel: 0, yaw: 0, phase: i * 1.7, docked: -1, jolt: 0, foamAcc: 0 });
    });
  }

  // ---- static scenery -------------------------------------------------------------------------------
  private light() {
    const stage = this.stage;
    stage.sun.color.set('#fff3dc');
    stage.sun.intensity = 1.7;
    stage.sun.position.set(-0.5, 1, 0.55);
    for (const o of stage.scene.children) {
      if (o instanceof HemisphereLight) {
        o.color.set('#e6f4ff');
        o.groundColor.set('#46606a');
        o.intensity = 1.3;
      }
      if (o instanceof AmbientLight) o.intensity = 0.38;
    }
  }

  private buildSky() {
    const geo = this.keep(new SphereGeometry(320, 16, 10));
    const pos = geo.attributes.position as BufferAttribute;
    const cols = new Float32Array(pos.count * 3);
    const top = new Color('#4b9fd8');
    const low = new Color('#d8f0fa');
    const c = new Color();
    for (let i = 0; i < pos.count; i++) {
      const h = Math.max(0, pos.getY(i) / 320);
      c.copy(low).lerp(top, Math.min(1, h * 2.2));
      cols.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new BufferAttribute(cols, 3));
    const sky = new Mesh(geo, this.keep(new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false, depthWrite: false })));
    sky.renderOrder = -10;
    this.stage.add(sky);
  }

  /** The water: a flat-shaded grid that swells gently (the vertices move every frame). */
  private buildWater() {
    const W = 150;
    const D = 110;
    const g = this.keep(new PlaneGeometry(W, D, 75, 55));
    g.rotateX(-Math.PI / 2);
    g.translate(0, 0, -2);
    const pos = g.attributes.position as BufferAttribute;
    pos.setUsage(DynamicDrawUsage);
    this.waterBase = new Float32Array(pos.array as Float32Array);
    // Vertex colours: a little variation, darker in the deep middle, lighter at the edges.
    const cols = new Float32Array(pos.count * 3);
    const base = new Color(WATER_COLOR);
    const shallow = new Color('#4fb6c4');
    const rnd = mulberry32(12);
    const c = new Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const edge = Math.max(Math.abs(x) - (HALF_W - 4), z - (SHORE_Z - 3), QUAY_Z + 3 - z, 0);
      c.copy(base).lerp(shallow, Math.min(1, edge / 5) * 0.6);
      c.offsetHSL(0, 0, (rnd() - 0.5) * 0.04);
      cols.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new BufferAttribute(cols, 3));
    this.waterGeo = g;
    this.water = new Mesh(g, this.keep(new MeshLambertMaterial({ vertexColors: true, flatShading: true, emissive: '#0b2f40' })));
    this.stage.add(this.water);
  }

  /** The water height (swell) at a point. Small inside the harbour so the paint stays on top. */
  wave(x: number, z: number, t = this.time) {
    return 0.045 * Math.sin(x * 0.42 + t * 1.25) + 0.035 * Math.sin(z * 0.55 - t * 0.95 + x * 0.12) + 0.02 * Math.sin((x + z) * 0.9 + t * 2.1);
  }

  private updateWater() {
    const pos = this.waterGeo.attributes.position as BufferAttribute;
    const arr = pos.array as Float32Array;
    const b = this.waterBase;
    for (let i = 0; i < pos.count; i++) {
      const x = b[i * 3];
      const z = b[i * 3 + 2];
      // Outside the breakwaters the sea rolls a bit more.
      const out = Math.max(0, Math.abs(x) - HALF_W - 6, z - SHORE_Z - 5) * 0.03;
      arr[i * 3 + 1] = this.wave(x, z) * (1 + Math.min(4, out * 10));
    }
    pos.needsUpdate = true;
  }

  private buildQuay() {
    const stage = this.stage;
    const stone = this.keep(
      pixelTexture(
        16,
        (ctx, rnd) => {
          noise(ctx, rnd, 16, [176, 162, 140], 24);
          ctx.fillStyle = 'rgba(60,45,35,.45)';
          ctx.fillRect(0, 7, 16, 1);
          ctx.fillRect(0, 15, 16, 1);
          ctx.fillRect(5, 0, 1, 7);
          ctx.fillRect(12, 8, 1, 7);
        },
        4,
        1,
      ),
    );
    stone.repeat.set(30, 1);
    const wall = box(HALF_W * 2 + 30, QUAY_TOP + 1.4, 1.2, this.keep(flat('#ffffff', { map: stone })));
    wall.position.set(0, -1.4, QUAY_Z - 0.6);
    const topTex = this.keep(groundTexture('stone', 1, 9));
    topTex.repeat.set(40, 6);
    const top = box(HALF_W * 2 + 30, 0.3, 14, this.keep(flat('#c9b89c', { map: topTex })));
    top.position.set(0, QUAY_TOP - 0.3, QUAY_Z - 7);
    const edge = box(HALF_W * 2 + 30, 0.18, 0.5, this.keep(flat('#8a6a4a')));
    edge.position.set(0, QUAY_TOP, QUAY_Z - 0.3);
    stage.add(wall, top, edge);
    // Bollards and lamp posts along the edge.
    const iron = this.keep(flat('#2d3138'));
    const bollGeo = this.keep(new CylinderGeometry(0.2, 0.26, 0.5, 7));
    const capGeo = this.keep(new SphereGeometry(0.24, 7, 4));
    for (let x = -HALF_W - 8; x <= HALF_W + 8; x += 4.5) {
      const b = new Mesh(bollGeo, iron);
      b.position.set(x, QUAY_TOP + 0.25, QUAY_Z - 0.8);
      const c = new Mesh(capGeo, iron);
      c.position.set(x, QUAY_TOP + 0.5, QUAY_Z - 0.8);
      stage.add(b, c);
    }
    const lampMat = this.keep(new MeshBasicMaterial({ color: '#fff2c4' }));
    const lampGeo = this.keep(new SphereGeometry(0.3, 6, 4));
    for (let x = -HALF_W + 2; x <= HALF_W; x += 12) {
      const p = box(0.14, 3.6, 0.14, iron);
      p.position.set(x, QUAY_TOP, QUAY_Z - 2.6);
      const l = new Mesh(lampGeo, lampMat);
      l.position.set(x, QUAY_TOP + 3.75, QUAY_Z - 2.6);
      stage.add(p, l);
    }
  }

  /** Gabled houses along the quay, Gdańsk style, with the old wooden crane. */
  private buildTown() {
    const stage = this.stage;
    const rnd = mulberry32(77);
    const colours = ['#e5b54a', '#c8553d', '#4f8a8b', '#e9dcc0', '#b5664a', '#7f9f5a', '#d9935a', '#5b7fa8', '#efe3c8', '#a84a5a'].map((c) => this.keep(flat(c)));
    const roof = this.keep(flat('#7a3a2c'));
    const win = this.keep(flat('#2c3a4a'));
    const winLit = this.keep(flat('#f6e3a6'));
    const trim = this.keep(flat('#fbf4e4'));
    const gable = (w: number, h: number) => {
      const g = new BufferGeometry();
      const v = new Float32Array([-w / 2, 0, 0, w / 2, 0, 0, 0, h, 0]);
      g.setAttribute('position', new BufferAttribute(v, 3));
      g.computeVertexNormals();
      return this.keep(g);
    };
    let x = -HALF_W - 14;
    while (x < HALF_W + 14) {
      const w = 3.4 + rnd() * 1.6;
      const h = 6 + rnd() * 4;
      const d = 7;
      const g = new Group();
      const mat = colours[Math.floor(rnd() * colours.length)];
      g.add(box(w, h, d, mat));
      // Stepped or pointed gable facing the water.
      const gh = 1.8 + rnd() * 1.4;
      const tri = new Mesh(gable(w, gh), mat);
      tri.position.set(0, h, d / 2 + 0.01);
      tri.material = mat;
      (tri.material as MeshLambertMaterial).side = DoubleSide;
      g.add(tri);
      const rf = new Mesh(this.keep(new ConeGeometry(w * 0.72, gh, 4)), roof);
      rf.rotation.y = Math.PI / 4;
      rf.scale.set(1, 1, d / w);
      rf.position.set(0, h + gh / 2, 0);
      g.add(rf);
      for (let fy = 1.4; fy < h - 0.6; fy += 1.9)
        for (const fx of [-w * 0.25, w * 0.25]) {
          const pane = box(0.6, 0.9, 0.08, rnd() < 0.12 ? winLit : win);
          pane.position.set(fx, fy, d / 2 + 0.03);
          const sill = box(0.8, 0.1, 0.12, trim);
          sill.position.set(fx, fy - 0.1, d / 2 + 0.05);
          g.add(pane, sill);
        }
      const door = box(0.9, 1.6, 0.1, roof);
      door.position.set(0, 0, d / 2 + 0.03);
      g.add(door);
      g.position.set(x + w / 2, QUAY_TOP - 0.15, QUAY_Z - 11.5 - rnd() * 0.6);
      stage.add(g);
      x += w + 0.05;
    }
    // The Crane (Żuraw): a dark timber tower between two brick towers, on the left.
    const brick = this.keep(flat('#9a4a32'));
    const timber = this.keep(flat('#4a3326'));
    const cx = -HALF_W + 9;
    const cz = QUAY_Z - 9.5;
    for (const dx of [-3.2, 3.2]) {
      const t = box(3, 11, 5, brick);
      t.position.set(cx + dx, QUAY_TOP - 0.15, cz);
      stage.add(t);
    }
    const mid = box(3.4, 15, 5.6, timber);
    mid.position.set(cx, QUAY_TOP - 0.15, cz + 0.6);
    const cap = new Mesh(this.keep(new ConeGeometry(3.2, 3, 4)), roof);
    cap.rotation.y = Math.PI / 4;
    cap.position.set(cx, QUAY_TOP + 16.3, cz + 0.6);
    stage.add(mid, cap);
  }

  /** Stone breakwaters down both sides, rocks along the bottom, and a lighthouse. */
  private buildBreakwaters() {
    const stage = this.stage;
    const rnd = mulberry32(5);
    const rockMats = ['#8f8a82', '#a59f94', '#7a766f'].map((c) => this.keep(flat(c)));
    const rockGeo = this.keep(new IcosahedronGeometry(1, 0));
    const rock = (x: number, z: number, s: number) => {
      const m = new Mesh(rockGeo, rockMats[Math.floor(rnd() * 3)]);
      m.position.set(x, -0.2 + s * 0.25, z);
      m.scale.set(s * (0.9 + rnd() * 0.5), s * (0.6 + rnd() * 0.4), s * (0.9 + rnd() * 0.5));
      m.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
      stage.add(m);
    };
    for (const sx of [-1, 1]) {
      for (let z = QUAY_Z; z <= SHORE_Z + 3; z += 1.6) {
        rock(sx * (HALF_W + 0.9 + rnd() * 0.5), z, 1.2 + rnd() * 0.4);
        rock(sx * (HALF_W + 2.6 + rnd() * 1.2), z + 0.6, 1.5 + rnd() * 0.6);
      }
      // A concrete path on top.
      const path = box(3, 0.4, SHORE_Z - QUAY_Z + 4, this.keep(flat('#cfc6b4')));
      path.position.set(sx * (HALF_W + 5), 0.9, (SHORE_Z + QUAY_Z) / 2 + 2);
      stage.add(path);
    }
    for (let x = -HALF_W - 2; x <= HALF_W + 2; x += 1.7) rock(x, SHORE_Z + 0.9 + rnd() * 0.6, 1.1 + rnd() * 0.5);
    // Lighthouse on the right breakwater, near the camera.
    const lx = HALF_W + 5;
    const lz = SHORE_Z - 2;
    const red = this.keep(flat('#d6403a'));
    const wht = this.keep(flat('#fbf6ec'));
    for (let k = 0; k < 4; k++) {
      const seg = new Mesh(this.keep(new CylinderGeometry(1.1 - k * 0.12, 1.25 - k * 0.12, 2.2, 8)), k % 2 ? wht : red);
      seg.position.set(lx, 1.1 + 1.1 + k * 2.2, lz);
      stage.add(seg);
    }
    const lantern = new Mesh(this.keep(new CylinderGeometry(0.7, 0.7, 1, 8)), this.keep(new MeshBasicMaterial({ color: '#fff4b8' })));
    lantern.position.set(lx, 11.7, lz);
    const hat = new Mesh(this.keep(new ConeGeometry(0.95, 1.1, 8)), red);
    hat.position.set(lx, 12.75, lz);
    stage.add(lantern, hat);
  }

  // ---- the harbour (per round) ----------------------------------------------------------------------
  private kept<T extends { dispose(): void }>(x: T): T {
    this.harbourStuff.push(x);
    return x;
  }

  private clearHarbour() {
    for (const d of this.harbourStuff) d.dispose();
    this.harbourStuff = [];
    this.harbour.clear();
    this.marks = [];
    this.flags = [];
    this.streaks = [];
    this.buoyMeshes = [];
    this.moored = [];
  }

  /** Rebuild the piers, berths, moored boats and buoys for this round's layout. */
  reset(sim: MarinaSim) {
    this.clearHarbour();
    this.layoutRef = sim.layout;
    const L = sim.layout;
    const H = this.harbour;
    const k = <T extends { dispose(): void }>(x: T) => this.kept(x);
    this.wind = { ...L.wind };
    const woodTex = k(groundTexture('wood', 1, 4));
    woodTex.repeat.set(1, 4);
    const wood = k(flat('#ffffff', { map: woodTex }));
    const post = k(flat('#6b4a2e'));
    const postGeo = k(new CylinderGeometry(0.16, 0.16, 1.8, 6));
    const float = k(flat('#e8e2d4'));
    // Jetty.
    for (const s of L.solids) {
      if (s.kind !== 'jetty' && s.kind !== 'finger') continue;
      const thick = s.kind === 'jetty' ? 0.45 : 0.32;
      const g = new Group();
      const deck = new Mesh(k(new BoxGeometry(s.hw * 2, thick, s.hl * 2)), wood);
      deck.position.y = DECK_Y - thick / 2;
      const under = new Mesh(k(new BoxGeometry(s.hw * 2 - 0.1, 0.3, s.hl * 2 - 0.1)), float);
      under.position.y = DECK_Y - thick - 0.1;
      g.add(deck, under);
      // Posts at the ends (and along the jetty).
      const n = s.kind === 'jetty' ? Math.max(2, Math.round(s.hl / 2.5)) : 1;
      for (let j = 0; j <= n; j++) {
        if (s.kind === 'finger' && j === 0) continue;
        const zz = -s.hl + (2 * s.hl * j) / n;
        for (const sx of s.kind === 'jetty' ? [-1, 1] : [0]) {
          const p = new Mesh(postGeo, post);
          p.position.set(sx * (s.hw - 0.1), DECK_Y + 0.1, s.kind === 'finger' ? -s.hl + 0.15 : zz);
          g.add(p);
        }
      }
      g.position.set(s.x, 0, s.z);
      g.rotation.y = s.a;
      H.add(g);
    }
    // Moored boats.
    const hulls = ['#fbf6ec', '#21406b', '#b7352e', '#e9e2cf'];
    for (const [j, m] of L.moored.entries()) {
      const model = buildBoat(hulls[m.hue % hulls.length], k, { skipper: false, hl: m.hl, hw: m.hw, sail: m.sail, deck: m.hue === 1 ? '#e8dcc0' : '#d7cdb8' });
      model.root.position.set(m.x, 0, m.z);
      model.root.rotation.y = m.a;
      H.add(model.root);
      this.moored.push({ g: model.tilt, phase: j * 2.3, y: 0 });
    }
    // Buoys.
    const red = k(flat('#e2483d'));
    const wht = k(flat('#fbf6ec'));
    for (const b of L.buoys) {
      const g = new Mesh(k(new SphereGeometry(b.r, 8, 6)), red);
      const band = new Mesh(k(new CylinderGeometry(b.r * 1.02, b.r * 1.02, 0.16, 8)), wht);
      band.position.y = 0.1;
      const stick = new Mesh(k(new CylinderGeometry(0.05, 0.05, 1.1, 4)), wht);
      stick.position.y = 0.6;
      g.add(band, stick);
      g.position.set(b.x, 0.12, b.z);
      H.add(g);
      this.buoyMeshes.push(g);
    }
    // Players' berths.
    for (const [i, b] of L.berths.entries()) {
      const p = sim.boats[i];
      if (!p || p.gone || !this.looks[i]) continue;
      this.marks.push(this.buildMark(i, b, k));
    }
    // Flags along the quay show the wind.
    const poleMat = k(flat('#f2efe6'));
    const flagCols = ['#ffffff', '#d6403a', '#2f6fb0', '#f2c84b'];
    for (let x = -HALF_W + 6; x <= HALF_W - 4; x += 10) {
      const pole = new Mesh(k(new CylinderGeometry(0.06, 0.08, 5, 5)), poleMat);
      pole.position.set(x, QUAY_TOP + 2.5, QUAY_Z - 4.6);
      H.add(pole);
      const flag = this.flagMesh(flagCols[Math.abs(Math.round(x / 10)) % flagCols.length], 1.8, 1.1, k);
      flag.position.set(x, QUAY_TOP + 4.4, QUAY_Z - 4.6);
      H.add(flag);
      this.flags.push({ mesh: flag, base: 0, phase: x * 0.3 });
    }
    // Wind streaks on the water.
    if (this.wind.x !== 0 || this.wind.z !== 0) {
      const sm = k(new MeshBasicMaterial({ color: '#e9f8ff', transparent: true, opacity: 0.55, depthWrite: false }));
      const sg = k(new PlaneGeometry(3.2, 0.12));
      sg.rotateX(-Math.PI / 2);
      const rnd = mulberry32(3);
      for (let j = 0; j < 46; j++) {
        const m = new Mesh(sg, sm);
        const st = { mesh: m, x: (rnd() * 2 - 1) * (HALF_W + 4), z: QUAY_Z + 2 + rnd() * (SHORE_Z - QUAY_Z), s: 0.7 + rnd() * 0.6 };
        m.rotation.y = Math.atan2(this.wind.x, this.wind.z) + Math.PI / 2;
        H.add(m);
        this.streaks.push(st);
      }
    }
    // Boats back to their starting places.
    this.actors.forEach((a, i) => {
      const b = sim.boats[i];
      a.model.root.visible = !!b && !b.gone;
      a.docked = b?.docked ? 99 : -1;
      a.u = a.accel = a.yaw = a.jolt = 0;
    });
  }

  private flagMesh(color: string, w: number, h: number, k: <T extends { dispose(): void }>(x: T) => T) {
    const g = k(new PlaneGeometry(w, h, 4, 1));
    g.translate(w / 2, 0, 0);
    const pos = g.attributes.position as BufferAttribute;
    pos.setUsage(DynamicDrawUsage);
    const m = new Mesh(g, k(new MeshLambertMaterial({ color, side: DoubleSide, flatShading: true })));
    m.userData.base = new Float32Array(pos.array as Float32Array);
    return m;
  }

  /** A berth: dashed floating outline in the player's colour, a tinted fill, a flag and the name on the pier. */
  private buildMark(owner: number, b: Berth, k: <T extends { dispose(): void }>(x: T) => T): BerthMark {
    const look = this.looks[owner];
    const col = new Color(look.color);
    const g = new Group();
    g.position.set(b.x, 0, b.z);
    g.rotation.y = b.a;
    const fill = k(new MeshBasicMaterial({ color: col, transparent: true, opacity: 0.2, depthWrite: false }));
    const fillMesh = new Mesh(k(new PlaneGeometry(b.hw * 2, b.hl * 2)), fill);
    fillMesh.rotation.x = -Math.PI / 2;
    fillMesh.position.y = LINE_Y - 0.03;
    fillMesh.renderOrder = 1;
    g.add(fillMesh);
    // Dashes all round (floats on a line), then solid strips that run round the outline as you hold.
    const dash = k(flat(look.color, { emissive: col.clone().multiplyScalar(0.35) }));
    const bright = k(new MeshBasicMaterial({ color: col.clone().lerp(new Color('#ffffff'), 0.35) }));
    // Each side from its start corner, going round: stern, starboard… (local +x, +z), with the
    // rotation that turns local +x along it.
    const sides = [
      { x: -b.hw, z: -b.hl, len: b.hw * 2, rot: 0 },
      { x: b.hw, z: -b.hl, len: b.hl * 2, rot: -Math.PI / 2 },
      { x: b.hw, z: b.hl, len: b.hw * 2, rot: Math.PI },
      { x: -b.hw, z: b.hl, len: b.hl * 2, rot: Math.PI / 2 },
    ];
    const dashGeo = k(new BoxGeometry(0.42, 0.12, 0.16));
    const solid: Mesh[] = [];
    for (const sd of sides) {
      const dir = { x: Math.cos(sd.rot), z: -Math.sin(sd.rot) };
      const n = Math.max(2, Math.round(sd.len / 0.75));
      for (let j = 0; j < n; j++) {
        const d = ((j + 0.5) / n) * sd.len;
        const m = new Mesh(dashGeo, dash);
        m.position.set(sd.x + dir.x * d, LINE_Y, sd.z + dir.z * d);
        m.rotation.y = sd.rot;
        g.add(m);
      }
      const geo = k(new BoxGeometry(sd.len + 0.2, 0.13, 0.2));
      geo.translate(sd.len / 2, 0, 0);
      const st = new Mesh(geo, bright);
      st.position.set(sd.x - dir.x * 0.1, LINE_Y + 0.02, sd.z - dir.z * 0.1);
      st.rotation.y = sd.rot;
      st.scale.x = 0.0001;
      g.add(st);
      solid.push(st);
    }
    this.harbour.add(g);
    // Flag on the pier at the bow end, and the name over it.
    const f = fwd(b.a);
    const pole = new Group();
    const top = b.row === 'quay' ? QUAY_TOP : DECK_Y;
    pole.position.set(b.bollard.x + f.x * 0.2, top, b.bollard.z + f.z * 0.2);
    const stick = box(0.12, 3.4, 0.12, k(flat('#f4efe4')));
    pole.add(stick);
    const bollard = new Mesh(k(new CylinderGeometry(0.2, 0.25, 0.5, 7)), k(flat('#2d3138')));
    bollard.position.set(-f.x * 0.45, 0.25, -f.z * 0.45);
    pole.add(bollard);
    const flag = this.flagMesh(look.color, 1.7, 1.0, k);
    flag.position.set(0, 2.9, 0);
    pole.add(flag);
    this.flags.push({ mesh: flag, base: 0, phase: owner * 1.1 });
    // The name floats low over the middle of the berth, so it's plain whose box it is.
    const tag = nameTag(look.name, look.color, 4.4);
    tag.position.set(0, 1.3, 0);
    g.add(tag);
    this.harbour.add(pole);
    // The mooring line, hidden until docked.
    const ropeMat = k(flat('#d8c39a'));
    const rope = new Mesh(k(new CylinderGeometry(0.05, 0.05, 1, 4)), ropeMat);
    rope.visible = false;
    this.harbour.add(rope);
    return { owner, group: g, fill, solid, flag, pole, tag, rope, ropeMat };
  }

  // ---- events ----------------------------------------------------------------------------------------
  hide(i: number) {
    const a = this.actors[i];
    if (a) a.model.root.visible = false;
    const m = this.marks.find((x) => x.owner === i);
    if (m) {
      m.group.visible = false;
      m.pole.visible = false;
      m.rope.visible = false;
    }
  }

  /** Something hit something: a ripple, spray and a little shake for hard ones. */
  bumped(i: number, x: number, z: number, v: number, hard: boolean) {
    this.ripple(x, z, hard ? 1.4 : 0.9, hard ? 3.2 : 2.2);
    const n = hard ? 14 : 6;
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 1 + Math.random() * v;
      this.puffs.spawn(x, 0.3, z, Math.cos(a) * sp, 2 + Math.random() * 3, Math.sin(a) * sp, 0.14 + Math.random() * 0.12, 0.7, k % 3 ? '#f2fbff' : '#9fd6ea', 0.5);
    }
    const a = this.actors[i];
    if (a) a.jolt = Math.min(1, a.jolt + v * 0.25);
    if (hard) this.shake = Math.min(0.8, this.shake + 0.3);
  }

  /** Parked: the line goes over to the bollard, the boat settles, confetti. */
  docked(i: number) {
    const a = this.actors[i];
    if (!a) return;
    a.docked = 0;
    const p = a.model.root.position;
    const cols = [a.color, '#ffd23f', '#ffffff', a.color];
    for (let k = 0; k < 40; k++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = 1.5 + Math.random() * 3;
      this.confetti.spawn(p.x, 1.2, p.z, Math.cos(ang) * sp, 5 + Math.random() * 4, Math.sin(ang) * sp, 0.16 + Math.random() * 0.1, 1.6 + Math.random() * 0.6, cols[k % cols.length], 0);
    }
    this.ripple(p.x, p.z, 1.2, 3.5);
  }

  horn(i: number) {
    const a = this.actors[i];
    if (!a) return;
    const p = a.model.root.position;
    this.ripple(p.x, p.z, 1.6, 4.5, a.color);
  }

  private ripple(x: number, z: number, max: number, grow: number, color = '#f2fbff') {
    let r = this.ripples.find((q) => q.t < 0);
    if (!r) {
      const mat = this.keep(new MeshBasicMaterial({ color, transparent: true, depthWrite: false }));
      const mesh = new Mesh(this.keep(new RingGeometry(0.85, 1.05, 18)), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.renderOrder = 3;
      this.stage.add(mesh);
      r = { mesh, mat, t: -1, max, grow };
      this.ripples.push(r);
    }
    r.mat.color.set(color);
    r.t = 0;
    r.max = max;
    r.grow = grow;
    r.mesh.position.set(x, 0.2, z);
    r.mesh.visible = true;
  }

  /** Where a world point is on the 1920×1080 stage. */
  toStage(x: number, y: number, z: number) {
    return this.stage.toStage(new Vector3(x, y, z));
  }

  // ---- drawing ---------------------------------------------------------------------------------------
  render(sim: MarinaSim, dt: number) {
    this.time += dt;
    if (sim.layout !== this.layoutRef) this.reset(sim);
    const t = this.time;
    this.updateWater();
    this.renderBoats(sim, dt);
    this.renderMarks(sim, dt);

    // Flags flutter downwind (they hang and stir a little on a calm day).
    const wl = Math.hypot(this.wind.x, this.wind.z);
    // The flag cloth runs along its local +x: turn that downwind.
    const windYaw = wl > 0 ? Math.atan2(-this.wind.z, this.wind.x) : 0;
    for (const f of this.flags) {
      const pos = f.mesh.geometry.attributes.position as BufferAttribute;
      const base = f.mesh.userData.base as Float32Array;
      const arr = pos.array as Float32Array;
      const amp = wl > 0 ? 0.22 : 0.06;
      for (let i = 0; i < pos.count; i++) {
        const x = base[i * 3];
        arr[i * 3 + 2] = Math.sin(x * 3.2 - t * (wl > 0 ? 9 : 2.5) + f.phase) * amp * x;
        arr[i * 3 + 1] = base[i * 3 + 1] - (wl > 0 ? 0 : x * 0.55);
      }
      pos.needsUpdate = true;
      f.mesh.rotation.y = wl > 0 ? windYaw : 0.4;
    }
    for (const s of this.streaks) {
      s.x += (this.wind.x / Math.max(wl, 1e-6)) * 3.2 * s.s * dt;
      s.z += (this.wind.z / Math.max(wl, 1e-6)) * 3.2 * s.s * dt;
      if (s.x > HALF_W + 4) s.x = -HALF_W - 4;
      if (s.x < -HALF_W - 4) s.x = HALF_W + 4;
      s.mesh.position.set(s.x, 0.11 + this.wave(s.x, s.z), s.z);
    }
    for (const [j, b] of this.buoyMeshes.entries()) {
      const p = b.position;
      p.y = 0.12 + this.wave(p.x, p.z) * 1.5;
      b.rotation.z = Math.sin(t * 1.6 + j) * 0.12;
      b.rotation.x = Math.cos(t * 1.3 + j) * 0.1;
    }
    for (const m of this.moored) {
      m.g.position.y = Math.sin(t * 1.4 + m.phase) * 0.04;
      m.g.rotation.z = Math.sin(t * 1.1 + m.phase) * 0.03;
    }
    for (const r of this.ripples) {
      if (r.t < 0) continue;
      r.t += dt;
      const k = r.t / 1.3;
      if (k >= 1) {
        r.t = -1;
        r.mesh.visible = false;
        continue;
      }
      r.mesh.scale.setScalar(r.max * (0.6 + k * r.grow));
      r.mat.opacity = 0.85 * (1 - k);
    }
    const wave = (x: number, z: number) => this.wave(x, z);
    this.foam.update(dt, wave);
    this.churn.update(dt, wave);
    this.puffs.update(dt);
    this.confetti.update(dt);

    // Camera: the whole harbour, from above the near breakwater.
    const stage = this.stage;
    stage.lookAt(new Vector3(0, 0, -3.2), 55, 0.96);
    if (this.shake > 0.01) {
      stage.camera.position.x += (Math.random() - 0.5) * this.shake * 0.6;
      stage.camera.position.y += (Math.random() - 0.5) * this.shake * 0.6;
      this.shake *= Math.exp(-7 * dt);
    }
    stage.render();
  }

  private renderBoats(sim: MarinaSim, dt: number) {
    const t = this.time;
    this.actors.forEach((a, i) => {
      const b = sim.boats[i];
      const root = a.model.root;
      if (!b || b.gone) {
        root.visible = false;
        return;
      }
      root.visible = true;
      const f = fwd(b.a);
      const s = stbd(b.a);
      const u = b.vx * f.x + b.vz * f.z;
      const sp = Math.hypot(b.vx, b.vz);
      const du = (u - a.u) / Math.max(dt, 1e-3);
      a.u = u;
      a.accel += (Math.max(-6, Math.min(6, du)) - a.accel) * Math.min(1, dt * 4);
      a.yaw += (b.w - a.yaw) * Math.min(1, dt * 6);
      a.jolt *= Math.exp(-4 * dt);
      if (a.docked >= 0) a.docked += dt;

      const bob = Math.sin(t * 1.9 + a.phase) * 0.05 + this.wave(b.x, b.z);
      root.position.set(b.x, bob, b.z);
      root.rotation.y = b.a;
      // Bow lifts as it accelerates and at speed (planing); dips on the brake; heels into turns.
      const pitch = a.accel * 0.025 + Math.max(0, u) * 0.022 + Math.sin(t * 1.4 + a.phase) * 0.02 + a.jolt * Math.sin(t * 22) * 0.05;
      const roll = -a.yaw * Math.max(0, Math.abs(u)) * 0.06 + Math.sin(t * 1.2 + a.phase * 2) * 0.025;
      a.model.tilt.rotation.x = -Math.max(-0.12, Math.min(0.2, pitch));
      a.model.tilt.rotation.z = Math.max(-0.22, Math.min(0.22, roll));
      // Settle when parked: a little dip, then calm.
      if (a.docked >= 0 && a.docked < 1.2) a.model.tilt.position.y = -Math.sin(a.docked * Math.PI * 2) * 0.12 * (1 - a.docked / 1.2);
      else a.model.tilt.position.y = 0;
      a.model.prop.rotation.z += b.throttle * dt * 40;
      if (a.model.skipper) {
        const sk = a.model.skipper;
        sk.body.rotation.z = -b.rudder * 0.18;
        sk.body.position.y = a.docked >= 0 && a.docked < 1.5 ? Math.abs(Math.sin(a.docked * 9)) * 0.5 * (1 - a.docked / 1.5) : 0;
      }

      // Wake, bow wave and churn.
      if (dt > 0) {
        const stern = { x: b.x - f.x * (BOAT_HL + 0.25), z: b.z - f.z * (BOAT_HL + 0.25) };
        const bow = { x: b.x + f.x * (BOAT_HL - 0.4), z: b.z + f.z * (BOAT_HL - 0.4) };
        a.foamAcc += dt * (sp * 14 + Math.abs(b.throttle) * 10);
        while (a.foamAcc > 1) {
          a.foamAcc -= 1;
          if (sp > 0.5) {
            // Bow wave: peels off both sides and spreads, so the wake opens out into a V.
            for (const side of [-1, 1]) {
              const out = 0.55 + sp * 0.18;
              this.foam.spawn(
                bow.x + s.x * side * (BOAT_HW - 0.1) + (Math.random() - 0.5) * 0.3,
                bow.z + s.z * side * (BOAT_HW - 0.1) + (Math.random() - 0.5) * 0.3,
                s.x * side * out - f.x * 0.2,
                s.z * side * out - f.z * 0.2,
                0.22 + sp * 0.05,
                1.6 + sp * 0.25,
                1.4,
              );
            }
            // The trail straight behind.
            this.foam.spawn(stern.x + (Math.random() - 0.5) * 0.6, stern.z + (Math.random() - 0.5) * 0.6, -f.x * 0.3 + (Math.random() - 0.5) * 0.4, -f.z * 0.3 + (Math.random() - 0.5) * 0.4, 0.3 + sp * 0.06, 2.2, 1.8);
          }
          if (Math.abs(b.throttle) > 0.08) {
            // The prop churns: backwards when going ahead, forward along the hull going astern.
            const dir = b.throttle > 0 ? -1 : 0.9;
            const k = Math.abs(b.throttle);
            this.churn.spawn(
              stern.x + (Math.random() - 0.5) * 0.5,
              stern.z + (Math.random() - 0.5) * 0.5,
              f.x * dir * (1 + k * 2.5) + (Math.random() - 0.5) * 1.4 - s.x * b.rudder * 1.2,
              f.z * dir * (1 + k * 2.5) + (Math.random() - 0.5) * 1.4 - s.z * b.rudder * 1.2,
              0.18 + k * 0.22,
              0.6 + k * 0.5,
              1.6,
            );
          }
        }
      }
    });
  }

  private renderMarks(sim: MarinaSim, dt: number) {
    const t = this.time;
    for (const m of this.marks) {
      const b = sim.boats[m.owner];
      const berth = sim.layout.berths[m.owner];
      if (!b || b.gone) continue;
      const hold = b.docked ? 1 : Math.min(1, b.hold / DOCK_HOLD);
      // The solid lines run round the outline as the hold fills.
      m.solid.forEach((st, k) => {
        st.scale.x = Math.max(0.0001, Math.min(1, hold * 4 - k));
      });
      const near = Math.hypot(b.x - berth.x, b.z - berth.z);
      const pulse = b.docked ? 0.42 : b.inLines ? 0.38 + Math.sin(t * 10) * 0.08 : 0.17 + Math.max(0, 1 - near / 14) * 0.12 * (0.5 + 0.5 * Math.sin(t * 4));
      m.fill.opacity += (pulse - m.fill.opacity) * Math.min(1, dt * 8);
      m.tag.visible = !b.docked;
      // The mooring line from the bow (or stern) to the bollard.
      const a = this.actors[m.owner];
      if (b.docked && a) {
        const f = fwd(b.a);
        const toB = (berth.bollard.x - b.x) * f.x + (berth.bollard.z - b.z) * f.z;
        const end = toB >= 0 ? 1 : -1;
        const sx = b.x + f.x * end * (BOAT_HL - 0.3);
        const sz = b.z + f.z * end * (BOAT_HL - 0.3);
        const top = berth.row === 'quay' ? QUAY_TOP : DECK_Y;
        const from = new Vector3(sx, 0.6, sz);
        const to = new Vector3(berth.bollard.x - fwd(berth.a).x * 0.25, top + 0.4, berth.bollard.z - fwd(berth.a).z * 0.25);
        const k = smooth((a.docked < 0 ? 1 : a.docked) / 0.45);
        to.lerp(from, 1 - k);
        const mid = from.clone().add(to).multiplyScalar(0.5);
        const len = from.distanceTo(to);
        m.rope.visible = len > 0.05;
        m.rope.position.copy(mid);
        m.rope.scale.set(1, len, 1);
        m.rope.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), to.clone().sub(from).normalize());
      } else m.rope.visible = false;
    }
  }

  dispose() {
    this.clearHarbour();
    this.puffs.mesh.geometry.dispose();
    (this.puffs.mesh.material as Material).dispose();
    this.confetti.mesh.geometry.dispose();
    (this.confetti.mesh.material as Material).dispose();
    this.stage.dispose();
  }
}
