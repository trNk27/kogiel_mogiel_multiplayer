/**
 * Śladami Babci in 3D: a snowy clearing ringed by a wattle fence, Babcia's cottage and a rowan tree at the
 * top, pines all round. Babcia drops a line of red rowan berries as she walks; the players leave a line of
 * footprints in their colour. When the time's up for looking, snow falls on the berries and they sink out
 * of sight; at the end they pop back up along the trail so everyone can compare.
 */
import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Euler,
  Float32BufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  Vector3,
  CircleGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ArenaStage, buildPierogi, nameTag, noise, pixelTexture, type PierogiModel } from '../arena/kit';
import { buildBabcia } from '../arena/babcia';
import { Puffs } from '../arena/puffs';
import { ARENA_R, DOT_GAP, MAX_DOTS, resample, type FootEvent, type FootstepsSim } from './logic';

export interface Contender {
  name: string;
  color: string;
}

const BERRY = '#d8321f';
const CHAR_SCALE = 0.95;

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
const CONE = new ConeGeometry(1, 1, 7);
const CYL = new CylinderGeometry(1, 1, 1, 7);

interface WalkerView {
  model: PierogiModel;
  rot: number;
  bob: number;
  squash: number;
}

/** A steady random number per index (for berries that don't all sink at once). */
const jitter = (k: number) => {
  const s = Math.sin(k * 12.9898) * 43758.5453;
  return s - Math.floor(s);
};
const ease = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export class FootstepsScene {
  readonly stage: ArenaStage;
  private players: WalkerView[] = [];
  private babcia: PierogiModel;
  private babciaRot = 0;
  private babciaBob = 0;
  private berries: InstancedMesh;
  /** Where every berry lies, and how many there are this round. */
  private berryPts: number[] = [];
  private berryN = 0;
  private dots: InstancedMesh;
  /** Footprints already placed per player (so only new ones are written). */
  private placed: number[];
  private start: Mesh;
  private snow: Puffs;
  private sparkle: Puffs;
  private smoke: Puffs;
  private colors: Color[];
  private dummy = new Object3D();
  private clock = 0;
  private flakeT = 0;
  private smokeT = 0;
  private revealT = 0;
  private shake = 0;
  private camBase = new Vector3();
  private camTarget = new Vector3();

  constructor(canvas: HTMLCanvasElement, who: Contender[], sim: FootstepsSim) {
    this.colors = who.map((c) => new Color(c.color));
    this.stage = new ArenaStage(canvas, { sky: '#b9d0e6', fog: [80, 190], fov: 38 });
    const st = this.stage;
    st.sun.position.set(-0.4, 1, 0.6);
    const keep = <T extends { dispose(): void }>(x: T) => st.keep(x);
    const vmat = keep(new MeshLambertMaterial({ vertexColors: true, flatShading: true }));

    this.buildGround(vmat);
    this.buildFence(vmat);
    this.buildCottage(vmat);
    this.buildWoods(vmat);

    // Where everyone starts: a round straw mat.
    const matGeo = keep(new RingGeometry(0.55, 1.35, 20));
    matGeo.rotateX(-Math.PI / 2);
    this.start = new Mesh(matGeo, keep(new MeshBasicMaterial({ color: '#e7c25a', transparent: true, opacity: 0.85, side: DoubleSide, depthWrite: false })));
    this.start.position.y = 0.03;
    st.add(this.start);

    // Babcia's rowan berries: one instance each.
    const berryGeo = keep(new SphereGeometry(0.19, 6, 4));
    berryGeo.scale(1, 0.8, 1);
    this.berries = new InstancedMesh(berryGeo, keep(new MeshLambertMaterial({ color: BERRY, flatShading: true })), 1200);
    this.berries.frustumCulled = false;
    this.berries.count = 0;
    st.add(this.berries);

    // Footprints: a block of MAX_DOTS instances per player, in their colour.
    const dotGeo = keep(new CylinderGeometry(0.16, 0.16, 0.05, 8));
    this.dots = new InstancedMesh(dotGeo, keep(new MeshLambertMaterial({ flatShading: true })), Math.max(1, who.length) * MAX_DOTS);
    this.dots.frustumCulled = false;
    const zero = new Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < who.length * MAX_DOTS; i++) {
      this.dots.setMatrixAt(i, zero);
      this.dots.setColorAt(i, this.colors[Math.floor(i / MAX_DOTS)]);
    }
    st.add(this.dots);
    this.placed = who.map(() => 0);

    this.snow = new Puffs(500, 0.5, 0.35);
    this.sparkle = new Puffs(160, 3, 1.2);
    this.smoke = new Puffs(60, -0.5, 0.6);
    st.add(this.snow.mesh, this.sparkle.mesh, this.smoke.mesh);

    this.babcia = buildBabcia(keep);
    // A wicker basket of berries on her arm.
    const basket = new Mesh(keep(new CylinderGeometry(0.32, 0.24, 0.32, 8)), keep(new MeshLambertMaterial({ color: '#a8743f', flatShading: true })));
    basket.position.set(0.85, 0.35, 0.15);
    const fill = new Mesh(keep(new SphereGeometry(0.27, 6, 3)), keep(new MeshLambertMaterial({ color: BERRY, flatShading: true })));
    fill.scale.y = 0.4;
    fill.position.set(0.85, 0.5, 0.15);
    this.babcia.body.add(basket, fill);
    const tag = nameTag('Babcia', '#ffe3a0', 4);
    tag.position.y = 2.5;
    this.babcia.root.add(tag);
    this.babcia.root.scale.setScalar(1.2);
    st.add(this.babcia.root);

    who.forEach((w) => {
      const model = buildPierogi(w.color);
      model.mats.forEach((m) => keep(m));
      const t = nameTag(w.name.slice(0, 10), '#fff4dc', 4);
      t.position.y = 2.1;
      model.root.add(t);
      st.add(model.root);
      this.players.push({ model, rot: 0, bob: 0, squash: 0 });
    });

    this.frame();
    this.reset(sim);
  }

  /** Look down on the whole clearing, steep enough that the shapes read clearly. */
  private frame() {
    this.camTarget.set(0, 0, -1.2);
    this.stage.lookAt(this.camTarget, 40, 1.02);
    this.camBase.copy(this.stage.camera.position);
  }

  // ---- building ----------------------------------------------------------------

  private buildGround(vmat: MeshLambertMaterial) {
    const st = this.stage;
    const snowTex = (seed: number, base: [number, number, number], repeat: number) =>
      st.keep(
        pixelTexture(
          16,
          (ctx, rnd) => {
            noise(ctx, rnd, 16, base, 14);
            ctx.fillStyle = 'rgba(255,255,255,.9)';
            for (let k = 0; k < 5; k++) ctx.fillRect(Math.floor(rnd() * 16), Math.floor(rnd() * 16), 1, 1);
          },
          seed,
          repeat,
        ),
      );
    const outer = new Mesh(st.keep(new PlaneGeometry(340, 260)), st.keep(new MeshLambertMaterial({ map: snowTex(4, [214, 224, 238], 90) })));
    outer.rotation.x = -Math.PI / 2;
    outer.position.y = -0.02;
    st.add(outer);
    const clearing = new Mesh(st.keep(new CircleGeometry(ARENA_R + 0.4, 56)), st.keep(new MeshLambertMaterial({ map: snowTex(9, [238, 243, 250], 14) })));
    clearing.rotation.x = -Math.PI / 2;
    st.add(clearing);
    // A trodden path from the gap in the fence up to the cottage door.
    const p = new Parts();
    p.add(BOX, '#cfd8e6', 0, 0.005, -ARENA_R - 3, 3.2, 0.01, 6.5);
    // Little snow drifts here and there outside the fence.
    let seed = 5;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 40; k++) {
      const a = rnd() * Math.PI * 2;
      const r = ARENA_R + 2 + rnd() * 14;
      p.add(BALL, '#f4f8fd', Math.cos(a) * r, 0, Math.sin(a) * r, 1 + rnd() * 1.6, 0.35 + rnd() * 0.3, 0.8 + rnd() * 1.2);
    }
    st.add(new Mesh(st.keep(p.merge()), vmat));
  }

  /** A low wattle fence round the clearing with a gap at the top, snow on the posts. */
  private buildFence(vmat: MeshLambertMaterial) {
    const p = new Parts();
    const R = ARENA_R + 0.5;
    const n = 44;
    const open = (a: number) => Math.sin(a) < 0 && Math.abs(Math.cos(a) * R) < 3.6;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const b = ((k + 1) / n) * Math.PI * 2;
      const x = Math.cos(a) * R;
      const z = Math.sin(a) * R;
      if (!open(a)) {
        p.add(CYL, '#6b4426', x, 0.55, z, 0.12, 1.1, 0.12);
        p.add(BALL, '#ffffff', x, 1.12, z, 0.16, 0.08, 0.16);
      }
      if (open(a) || open(b)) continue;
      const mx = (x + Math.cos(b) * R) / 2;
      const mz = (z + Math.sin(b) * R) / 2;
      const len = Math.hypot(Math.cos(b) * R - x, Math.sin(b) * R - z);
      const ry = Math.atan2(Math.cos(b) * R - x, Math.sin(b) * R - z);
      // Woven withies: three bands of twigs, snow along the top.
      for (const [y, c] of [
        [0.3, '#8a5a30'],
        [0.55, '#9c6a3a'],
        [0.8, '#8a5a30'],
      ] as const)
        p.add(BOX, c, mx, y, mz, 0.1, 0.22, len, 0, ry, 0);
      p.add(BOX, '#ffffff', mx, 0.94, mz, 0.16, 0.06, len, 0, ry, 0);
    }
    this.stage.add(new Mesh(this.stage.keep(p.merge()), vmat));
  }

  /** Babcia's whitewashed cottage with a snowy thatch, a smoking chimney, and a rowan tree by the door. */
  private buildCottage(vmat: MeshLambertMaterial) {
    const p = new Parts();
    const cx = 0;
    const cz = -ARENA_R - 9;
    p.add(BOX, '#f2ead8', cx, 2, cz, 10, 4, 6);
    p.add(BOX, '#6b4426', cx, 0.2, cz, 10.2, 0.4, 6.2);
    // Roof: two thick slopes of thatch with snow on top, and the gable ends.
    p.add(BOX, '#b08a4a', cx, 5.1, cz + 1.55, 11, 0.5, 4.2, 0.85, 0, 0);
    p.add(BOX, '#b08a4a', cx, 5.1, cz - 1.55, 11, 0.5, 4.2, -0.85, 0, 0);
    p.add(BOX, '#ffffff', cx, 5.3, cz + 1.65, 11.1, 0.32, 4.0, 0.85, 0, 0);
    p.add(BOX, '#ffffff', cx, 5.3, cz - 1.65, 11.1, 0.32, 4.0, -0.85, 0, 0);
    p.add(BOX, '#f2ead8', cx, 4.6, cz, 9.6, 1.6, 3.2);
    // Blue door and windows with shutters.
    p.add(BOX, '#3d6db5', cx, 1.25, cz + 3.02, 1.3, 2.5, 0.06);
    p.add(BOX, '#ffd23f', cx + 0.4, 1.2, cz + 3.06, 0.12, 0.12, 0.04);
    for (const dx of [-3, 3]) {
      p.add(BOX, '#ffe7a0', cx + dx, 2.1, cz + 3.02, 1.3, 1.1, 0.05);
      p.add(BOX, '#3d6db5', cx + dx - 0.95, 2.1, cz + 3.03, 0.5, 1.3, 0.05);
      p.add(BOX, '#3d6db5', cx + dx + 0.95, 2.1, cz + 3.03, 0.5, 1.3, 0.05);
      p.add(BOX, '#ffffff', cx + dx, 1.45, cz + 3.1, 1.6, 0.12, 0.2);
    }
    // Chimney.
    p.add(BOX, '#b9b2a6', cx + 3, 6.6, cz - 0.8, 0.9, 2, 0.9);
    p.add(BOX, '#ffffff', cx + 3, 7.65, cz - 0.8, 1, 0.12, 1);
    // Doorstep.
    p.add(BOX, '#9a948a', cx, 0.12, cz + 3.6, 2, 0.24, 1);
    // Rowan tree (jarzębina) by the door: bare branches hung with red berry clusters.
    const rx = cx - 7.5;
    const rz = cz + 4;
    p.add(CYL, '#5a3a24', rx, 1.6, rz, 0.22, 3.2, 0.22);
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      p.add(CYL, '#5a3a24', rx + Math.cos(a) * 0.7, 3.5, rz + Math.sin(a) * 0.7, 0.07, 1.8, 0.07, Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6);
      p.add(BALL, '#ffffff', rx + Math.cos(a) * 1.2, 4.3, rz + Math.sin(a) * 1.2, 0.35, 0.12, 0.35);
      for (let j = 0; j < 3; j++) p.add(BALL, BERRY, rx + Math.cos(a + j * 0.3) * (1.1 + j * 0.12), 3.9 - j * 0.12, rz + Math.sin(a + j * 0.3) * (1.1 + j * 0.12), 0.17, 0.17, 0.17);
    }
    // A woodpile and a snowman.
    for (let k = 0; k < 6; k++) p.add(CYL, '#8a5a30', cx + 7 + (k % 3) * 0.55, 0.3 + Math.floor(k / 3) * 0.5, cz + 3.8, 0.26, 1.6, 0.26, Math.PI / 2, 0, 0);
    p.add(BOX, '#ffffff', cx + 7.55, 1.05, cz + 3.8, 1.8, 0.12, 1.7);
    const sx = ARENA_R + 3.5;
    const sz = 5;
    p.add(BALL, '#f7fbff', sx, 0.9, sz, 1, 0.9, 1);
    p.add(BALL, '#f7fbff', sx, 2.2, sz, 0.7, 0.65, 0.7);
    p.add(BALL, '#f7fbff', sx, 3.1, sz, 0.48, 0.46, 0.48);
    p.add(CONE, '#ff8a2b', sx - 0.1, 3.1, sz + 0.55, 0.1, 0.5, 0.1, Math.PI / 2, 0, 0);
    p.add(CYL, '#cf3a2c', sx, 2.75, sz, 0.55, 0.16, 0.55);
    p.add(CYL, '#2a1a14', sx, 3.6, sz, 0.36, 0.5, 0.36);
    this.stage.add(new Mesh(this.stage.keep(p.merge()), vmat));
  }

  /** Snowy pines all round, kept clear of the camera at the front. */
  private buildWoods(vmat: MeshLambertMaterial) {
    const p = new Parts();
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const pine = (x: number, z: number, s: number) => {
      p.add(CYL, '#5a3a24', x, 0.6 * s, z, 0.25 * s, 1.2 * s, 0.25 * s);
      const green = ['#2f5d3a', '#356b40', '#2a5233'][Math.floor(rnd() * 3)];
      for (const [y, r, h] of [
        [1.9, 1.7, 2.3],
        [3.1, 1.3, 2],
        [4.2, 0.9, 1.7],
      ]) {
        p.add(CONE, green, x, y * s, z, r * s, h * s, r * s);
        p.add(CONE, '#f4f8fd', x, (y + h * 0.22) * s, z, r * 0.62 * s, h * 0.55 * s, r * 0.62 * s);
      }
    };
    for (let k = 0; k < 70; k++) {
      const a = rnd() * Math.PI * 2;
      const r = ARENA_R + 6 + rnd() * 26;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (z > ARENA_R + 2) continue;
      if (Math.abs(x) < 9 && z < -ARENA_R - 3 && z > -ARENA_R - 15) continue;
      if (Math.abs(x - (ARENA_R + 3.5)) < 3 && Math.abs(z - 5) < 3) continue;
      pine(x, z, 1 + rnd() * 0.9);
    }
    this.stage.add(new Mesh(this.stage.keep(p.merge()), vmat));
  }

  // ---- rounds -----------------------------------------------------------------

  /** A new trail: the berries are laid out along it (hidden until Babcia drops them) and the footprints wiped. */
  reset(sim: FootstepsSim) {
    this.berryPts = resample(sim.shape.pts, DOT_GAP);
    this.berryN = Math.min(this.berries.instanceMatrix.count, this.berryPts.length / 2);
    this.berries.count = this.berryN;
    const zero = new Matrix4().makeScale(0, 0, 0);
    for (let k = 0; k < this.berries.instanceMatrix.count; k++) this.berries.setMatrixAt(k, zero);
    this.berries.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < this.placed.length * MAX_DOTS; i++) this.dots.setMatrixAt(i, zero);
    this.dots.instanceMatrix.needsUpdate = true;
    this.placed = this.placed.map(() => 0);
    this.start.position.set(sim.shape.pts[0], 0.03, sim.shape.pts[1]);
    this.revealT = 0;
    this.babciaRot = Math.atan2(sim.bfx, sim.bfz);
    this.players.forEach((pv, i) => {
      const p = sim.players[i];
      pv.rot = p ? Math.atan2(p.fx, p.fz) : 0;
    });
  }

  // ---- events -----------------------------------------------------------------

  events(ev: FootEvent[], sim: FootstepsSim) {
    for (const e of ev) {
      switch (e.t) {
        case 'go':
          this.shake = 0.15;
          break;
        case 'done': {
          const p = sim.players[e.p];
          this.players[e.p].squash = 1;
          const col = '#' + this.colors[e.p].getHexString();
          for (let k = 0; k < 14; k++) {
            const a = (k / 14) * Math.PI * 2;
            this.sparkle.spawn(p.x, 1.2, p.z, Math.cos(a) * 3, 3 + Math.random() * 2, Math.sin(a) * 3, 0.14, 0.7, k % 2 ? col : '#fff8ea', 0);
          }
          break;
        }
        case 'end':
          this.revealT = 0;
          break;
        default:
          break;
      }
    }
  }

  // ---- per frame ----------------------------------------------------------------

  /** `reveal`: the round is over and Babcia's trail comes back to compare. */
  render(sim: FootstepsSim, dt: number, reveal = false) {
    this.clock += dt;
    if (reveal) this.revealT += dt;
    this.updateBerries(sim, reveal, dt);
    this.updateDots(sim);
    this.updateBabcia(sim, dt);
    this.updatePlayers(sim, dt);
    this.weather(dt);
    this.start.visible = !reveal;
    (this.start.material as MeshBasicMaterial).opacity = 0.65 + Math.sin(this.clock * 4) * 0.2;
    this.snow.update(dt);
    this.sparkle.update(dt);
    this.smoke.update(dt);
    this.shake = Math.max(0, this.shake - dt * 1.4);
    const cam = this.stage.camera;
    const s = this.shake * 0.5;
    cam.position.set(this.camBase.x + (Math.random() - 0.5) * s, this.camBase.y + (Math.random() - 0.5) * s, this.camBase.z + (Math.random() - 0.5) * s);
    cam.lookAt(this.camTarget);
    this.stage.render();
  }

  private updateBerries(sim: FootstepsSim, reveal: boolean, dt: number) {
    const d = this.dummy;
    const laid = sim.laid;
    const hidden = 1 - sim.trailShown();
    // While the snow covers them, flakes come down thick over the trail.
    if (!reveal && hidden > 0 && hidden < 1 && this.berryN) {
      for (let k = 0; k < Math.ceil(90 * dt); k++) {
        const b = Math.floor(Math.random() * this.berryN);
        const x = this.berryPts[b * 2] + (Math.random() - 0.5) * 0.8;
        const z = this.berryPts[b * 2 + 1] + (Math.random() - 0.5) * 0.8;
        this.snow.spawn(x, 3 + Math.random() * 3, z, 0, -2.5, 0, 0.09 + Math.random() * 0.07, 1.6, '#ffffff', 0);
      }
    }
    for (let k = 0; k < this.berryN; k++) {
      const at = k * DOT_GAP;
      let scale: number;
      let y = 0.12;
      if (reveal) {
        // Back up again in a sweep along the trail.
        scale = ease(this.revealT * 2.2 - (k / this.berryN) * 1.6);
      } else {
        // Dropped as she passes (a little pop), then sunk into the snow one by one.
        const pop = clamp01((laid - at) / 0.7);
        const f = clamp01((hidden - jitter(k) * 0.45) / 0.55);
        scale = pop <= 0 ? 0 : (0.6 + 0.4 * ease(pop)) * (1 - ease(f));
        y -= f * 0.12;
      }
      d.position.set(this.berryPts[k * 2], y, this.berryPts[k * 2 + 1]);
      d.rotation.set(0, k, 0);
      d.scale.setScalar(Math.max(0, scale));
      d.updateMatrix();
      this.berries.setMatrixAt(k, d.matrix);
    }
    this.berries.instanceMatrix.needsUpdate = true;
  }

  private updateDots(sim: FootstepsSim) {
    const d = this.dummy;
    let changed = false;
    sim.players.forEach((p, i) => {
      if (!p) return;
      const n = Math.min(MAX_DOTS, p.trail.length / 2);
      if (n < this.placed[i]) {
        // The trail got shorter (a player left): wipe theirs.
        const zero = new Matrix4().makeScale(0, 0, 0);
        for (let k = 0; k < MAX_DOTS; k++) this.dots.setMatrixAt(i * MAX_DOTS + k, zero);
        this.placed[i] = 0;
        changed = true;
      }
      for (let k = this.placed[i]; k < n; k++) {
        d.position.set(p.trail[k * 2], 0.04 + i * 0.004, p.trail[k * 2 + 1]);
        d.rotation.set(0, 0, 0);
        d.scale.set(1, 1, 1);
        d.updateMatrix();
        this.dots.setMatrixAt(i * MAX_DOTS + k, d.matrix);
        changed = true;
      }
      this.placed[i] = n;
    });
    if (changed) this.dots.instanceMatrix.needsUpdate = true;
  }

  private updateBabcia(sim: FootstepsSim, dt: number) {
    const b = this.babcia;
    const target = Math.atan2(sim.bfx, sim.bfz);
    let d = target - this.babciaRot;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.babciaRot += d * Math.min(1, dt * 10);
    this.babciaBob += dt * (sim.bwalk ? 11 : 0);
    const hop = sim.bwalk ? Math.abs(Math.sin(this.babciaBob)) * 0.16 : 0;
    b.root.position.set(sim.bx, hop, sim.bz);
    b.root.rotation.y = this.babciaRot;
    b.body.rotation.z = sim.bwalk ? Math.sin(this.babciaBob) * 0.09 : Math.sin(this.clock * 1.5) * 0.03;
  }

  private updatePlayers(sim: FootstepsSim, dt: number) {
    this.players.forEach((pv, i) => {
      const p = sim.players[i];
      const root = pv.model.root;
      if (!p || !p.alive) {
        root.visible = false;
        return;
      }
      root.visible = true;
      pv.bob += dt * (p.speed > 0 ? 9 + p.speed * 5 : 0);
      const hop = p.speed > 0 ? Math.abs(Math.sin(pv.bob)) * 0.16 * p.speed : 0;
      pv.squash = Math.max(0, pv.squash - dt * 3);
      const sq = Math.sin(pv.squash * Math.PI) * 0.25;
      const target = Math.atan2(p.fx, p.fz);
      let d = target - pv.rot;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      pv.rot += d * Math.min(1, dt * 14);
      root.position.set(p.x, hop, p.z);
      root.rotation.y = pv.rot;
      root.scale.setScalar(CHAR_SCALE);
      pv.model.body.scale.set(1 + sq, 1 - sq, 1 + sq);
      pv.model.body.rotation.x = p.speed > 0 ? 0.1 : 0;
      pv.model.body.rotation.z = p.speed > 0 ? Math.sin(pv.bob) * 0.08 : 0;
    });
  }

  /** A few flakes drifting down all the time, and smoke from the chimney. */
  private weather(dt: number) {
    this.flakeT -= dt;
    while (this.flakeT <= 0) {
      this.flakeT += 0.05;
      this.snow.spawn((Math.random() - 0.5) * 50, 9 + Math.random() * 4, (Math.random() - 0.5) * 36, (Math.random() - 0.5) * 0.4, -1.2, 0, 0.07 + Math.random() * 0.05, 7, '#ffffff', 0);
    }
    this.smokeT -= dt;
    if (this.smokeT <= 0) {
      this.smokeT = 0.35;
      this.smoke.spawn(3 + (Math.random() - 0.5) * 0.3, 7.9, -ARENA_R - 9.8, 0.3 + Math.random() * 0.3, 0.6, 0, 0.35, 3.2, '#e6e8ee', 2.4);
    }
  }

  dispose() {
    this.stage.dispose();
  }
}
