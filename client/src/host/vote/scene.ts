/**
 * The party-mode vote's three.js scene: a cobbled village square at dusk with a market stall for each
 * game on offer, a mat in front of each stall to stand on, bunting, lanterns and a few trees.
 */
import {
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  PlaneGeometry,
  RingGeometry,
  SphereGeometry,
  Vector3,
} from 'three';
import { ArenaStage, blobShadow, box, buildPierogi, flat, groundTexture, nameTag, pixelTexture, type PierogiModel } from '../../games/arena/kit';
import { mulberry32 } from '../../games/rng';
import { BACK_Z, FRONT_Z, HALF_W, MAT_R, matPos, type VoteSim } from './logic';

const TAU = Math.PI * 2;
const dummy = new Object3D();

/** One colour per stall: beetroot, blueberry, pickle (and egg yolk if there were ever four). */
export const CHOICE_COLORS = ['#e8335a', '#3d7eff', '#4caf50', '#f2b705'] as const;

function angleDiff(a: number, b: number) {
  let d = b - a;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
}

/** Striped awning canvas in a stall's colour. */
function stripeTexture(hex: string, seed: number) {
  return pixelTexture(
    16,
    (ctx, rnd) => {
      const base = new Color(hex);
      for (let y = 0; y < 16; y++)
        for (let x = 0; x < 16; x++) {
          const v = 0.92 + rnd() * 0.12;
          const white = Math.floor(x / 4) % 2 === 1;
          ctx.fillStyle = white ? `rgb(${246 * v},${236 * v},${214 * v})` : `rgb(${base.r * 255 * v},${base.g * 255 * v},${base.b * 255 * v})`;
          ctx.fillRect(x, y, 1, 1);
        }
    },
    seed,
    1,
  );
}

interface Stall {
  group: Group;
  mat: Mesh;
  matMat: MeshLambertMaterial;
  ring: Mesh;
  ringMat: MeshBasicMaterial;
  beam: Mesh;
  beamMat: MeshBasicMaterial;
  /** Where the label goes (top of the stall). */
  top: Vector3;
  pulse: number;
}

interface WalkerView {
  model: PierogiModel;
  phase: number;
  facing: number;
  hop: number;
}

interface Bit {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
  size: number;
}

export class VoteScene {
  readonly stage: ArenaStage;
  private stalls: Stall[] = [];
  private walkers: WalkerView[] = [];
  private lanterns: MeshBasicMaterial[] = [];
  private bits: InstancedMesh;
  private bitsLife: Bit[] = [];
  private time = 0;
  private lastLit = -1;
  private base = new Vector3(0, 0, -2.4);

  constructor(
    canvas: HTMLCanvasElement,
    players: { name: string; color: string }[],
    public sim: VoteSim,
  ) {
    const stage = (this.stage = new ArenaStage(canvas, { sky: '#f0a27e', fog: [40, 95], fov: 40 }));
    stage.sun.color.set('#ffc890');
    stage.sun.intensity = 1.8;
    stage.sun.position.set(-0.6, 0.7, 0.45);
    stage.lookAt(this.base, 28, 0.9);
    const keep = <T extends { dispose(): void }>(x: T) => stage.keep(x);

    // ---- ground: grass all round, cobbles on the square ----------------------------------
    const grass = new Mesh(keep(new PlaneGeometry(220, 220)), keep(new MeshLambertMaterial({ map: keep(groundTexture('grass', 80)), color: '#e2d48a' })));
    grass.rotation.x = -Math.PI / 2;
    const w = 2 * HALF_W + 3;
    const d = FRONT_Z - BACK_Z + 6.5;
    const cobbles = new Mesh(keep(new PlaneGeometry(w, d)), keep(new MeshLambertMaterial({ map: keep(groundTexture('stone', 12, 9)), color: '#f1dcc2' })));
    cobbles.rotation.x = -Math.PI / 2;
    cobbles.position.set(0, 0.02, (FRONT_Z + BACK_Z) / 2 - 1.2);
    // A low kerb round the square.
    const kerbMat = keep(flat('#a99683'));
    const kerbs = [
      box(w + 0.6, 0.22, 0.4, kerbMat),
      box(w + 0.6, 0.22, 0.4, kerbMat),
      box(0.4, 0.22, d, kerbMat),
      box(0.4, 0.22, d, kerbMat),
    ];
    kerbs[0].position.set(0, 0.11, cobbles.position.z - d / 2);
    kerbs[1].position.set(0, 0.11, cobbles.position.z + d / 2);
    kerbs[2].position.set(-w / 2, 0.11, cobbles.position.z);
    kerbs[3].position.set(w / 2, 0.11, cobbles.position.z);
    stage.add(grass, cobbles, ...kerbs);

    this.buildStalls(keep);
    this.buildDecor(keep);

    // ---- confetti --------------------------------------------------------------------------
    this.bits = new InstancedMesh(keep(new IcosahedronGeometry(0.5, 0)), keep(new MeshBasicMaterial({ color: '#fff' })), 160);
    this.bits.frustumCulled = false;
    for (let i = 0; i < 160; i++) {
      this.put(i, 0, -50, 0, 0);
      this.bits.setColorAt(i, new Color('#fff'));
      this.bitsLife.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 0 });
    }
    stage.add(this.bits);

    // ---- the players -------------------------------------------------------------------------
    players.forEach((pl, i) => {
      const model = buildPierogi(pl.color);
      model.body.rotation.order = 'YXZ';
      const tag = nameTag(pl.name, pl.color, 3.2);
      tag.position.set(0, 2.1 + (i % 2) * 0.4, 0);
      model.root.add(tag);
      model.root.position.set(sim.players[i].x, 0, sim.players[i].z);
      stage.add(model.root);
      this.walkers.push({ model, phase: 0, facing: Math.PI, hop: 0 });
    });
  }

  private buildStalls(keep: <T extends { dispose(): void }>(x: T) => T) {
    const n = this.sim.choices;
    const wood = keep(flat('#8a5a34'));
    const counterMat = keep(flat('#c08a56'));
    const postGeo = keep(new CylinderGeometry(0.13, 0.15, 3.4, 6));
    for (let i = 0; i < n; i++) {
      const hex = CHOICE_COLORS[i % CHOICE_COLORS.length];
      const m = matPos(i, n);
      const group = new Group();
      group.position.set(m.x, 0, m.z - 3.1);

      // Posts, counter, and a striped awning sloping towards the square.
      for (const [x, z] of [
        [-2.2, -0.9],
        [2.2, -0.9],
        [-2.2, 0.9],
        [2.2, 0.9],
      ]) {
        const p = new Mesh(postGeo, wood);
        p.position.set(x, 1.7, z);
        group.add(p);
      }
      const counter = box(4.6, 1.05, 1.0, counterMat);
      counter.position.set(0, 0.52, 0.75);
      const front = box(4.62, 0.3, 1.02, keep(flat(new Color(hex).multiplyScalar(0.8).getStyle())));
      front.position.set(0, 0.9, 0.75);
      const back = box(4.6, 2.6, 0.2, keep(flat('#6d4528')));
      back.position.set(0, 1.3, -0.95);
      const awnMat = keep(new MeshLambertMaterial({ map: keep(stripeTexture(hex, 20 + i)), flatShading: true, side: DoubleSide }));
      const awning = new Mesh(keep(new PlaneGeometry(5.2, 2.6)), awnMat);
      awning.position.set(0, 3.45, 0.2);
      awning.rotation.x = -Math.PI / 2 + 0.38;
      // Scalloped edge along the front.
      const scallop = keep(new ConeGeometry(0.32, 0.5, 4));
      for (let k = 0; k < 8; k++) {
        const s = new Mesh(scallop, awnMat);
        s.position.set(-2.3 + k * (4.6 / 7), 2.85, 1.4);
        s.rotation.x = Math.PI;
        group.add(s);
      }
      // Goods on the counter: little jars and loaves in the stall's colour.
      const jarGeo = keep(new CylinderGeometry(0.2, 0.2, 0.42, 6));
      const jarMat = keep(flat(new Color(hex).lerp(new Color('#fff4dc'), 0.35).getStyle()));
      for (let k = 0; k < 5; k++) {
        const j = new Mesh(jarGeo, jarMat);
        j.position.set(-1.6 + k * 0.8, 1.27, 0.7);
        group.add(j);
      }
      group.add(counter, front, back, awning);

      // The mat to stand on, a ring round it, and a light beam for the winner.
      const matMat = keep(new MeshLambertMaterial({ color: hex, flatShading: true }));
      const mat = new Mesh(keep(new CylinderGeometry(MAT_R, MAT_R, 0.12, 20)), matMat);
      mat.position.set(m.x, 0.07, m.z);
      const ringMat = keep(new MeshBasicMaterial({ color: '#fff4dc', transparent: true, opacity: 0.85, side: DoubleSide }));
      const ring = new Mesh(keep(new RingGeometry(MAT_R - 0.18, MAT_R + 0.08, 28)), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(m.x, 0.15, m.z);
      const beamMat = keep(new MeshBasicMaterial({ color: '#fff1b8', transparent: true, opacity: 0, depthWrite: false, side: DoubleSide, fog: false }));
      const beam = new Mesh(keep(new CylinderGeometry(MAT_R * 0.9, MAT_R * 1.05, 16, 20, 1, true)), beamMat);
      beam.position.set(m.x, 8, m.z);
      this.stage.add(group, mat, ring, beam);
      this.stalls.push({ group, mat, matMat, ring, ringMat, beam, beamMat, top: new Vector3(m.x, 3.9, m.z - 3.1), pulse: 0 });
    }
  }

  private buildDecor(keep: <T extends { dispose(): void }>(x: T) => T) {
    const rnd = mulberry32(31);
    // Trees round the square.
    const trunk = keep(new CylinderGeometry(0.22, 0.3, 1.6, 6));
    const crown = keep(new ConeGeometry(1.5, 3.4, 7));
    const ball = keep(new IcosahedronGeometry(1.5, 0));
    const trunkMat = keep(flat('#6b4426'));
    const leafMats = ['#3f7a3a', '#4f8d3f', '#5d9a3a', '#c98a2a'].map((c) => keep(flat(c)));
    const spots: [number, number][] = [];
    for (let k = 0; k < 26; k++) {
      const side = k % 2 ? 1 : -1;
      spots.push([side * (HALF_W + 3 + rnd() * 9), BACK_Z - 9 + rnd() * 24]);
    }
    for (let k = 0; k < 16; k++) spots.push([-26 + rnd() * 52, BACK_Z - 9 - rnd() * 10]);
    for (const [x, z] of spots) {
      const t = new Group();
      const tr = new Mesh(trunk, trunkMat);
      tr.position.y = 0.8;
      const round = rnd() < 0.4;
      const c = new Mesh(round ? ball : crown, leafMats[Math.floor(rnd() * leafMats.length)]);
      c.position.y = round ? 2.6 : 3.1;
      const s = 0.8 + rnd() * 0.6;
      t.scale.setScalar(s);
      t.position.set(x, 0, z);
      t.rotation.y = rnd() * TAU;
      t.add(tr, c, blobShadow(1.4, 0.25));
      this.stage.add(t);
    }

    // Bunting strung across the back of the square, and lanterns on poles at the front corners.
    const flagGeo = keep(new ConeGeometry(0.26, 0.55, 3));
    const flagMats = ['#e8335a', '#f2b705', '#3d7eff', '#4caf50', '#fff4dc'].map((c) => keep(flat(c)));
    const poleGeo = keep(new CylinderGeometry(0.1, 0.12, 6, 6));
    const poleMat = keep(flat('#5a3a22'));
    const lampGeo = keep(new SphereGeometry(0.34, 6, 4));
    const poles: [number, number][] = [
      [-HALF_W - 0.6, BACK_Z - 5],
      [HALF_W + 0.6, BACK_Z - 5],
      [-HALF_W - 0.6, FRONT_Z + 1.4],
      [HALF_W + 0.6, FRONT_Z + 1.4],
    ];
    for (const [x, z] of poles) {
      const p = new Mesh(poleGeo, poleMat);
      p.position.set(x, 3, z);
      const lampMat = keep(new MeshBasicMaterial({ color: '#ffd77a' }));
      this.lanterns.push(lampMat);
      const lamp = new Mesh(lampGeo, lampMat);
      lamp.position.set(x, 6.1, z);
      this.stage.add(p, lamp);
    }
    const strings: [[number, number], [number, number]][] = [
      [poles[0], poles[1]],
      [poles[0], poles[2]],
      [poles[1], poles[3]],
    ];
    let f = 0;
    for (const [[x0, z0], [x1, z1]] of strings) {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const count = Math.round(len / 0.9);
      for (let k = 1; k < count; k++) {
        const u = k / count;
        const flag = new Mesh(flagGeo, flagMats[f++ % flagMats.length]);
        flag.position.set(x0 + (x1 - x0) * u, 5.7 - Math.sin(u * Math.PI) * 1.1, z0 + (z1 - z0) * u);
        flag.rotation.set(Math.PI, Math.atan2(x1 - x0, z1 - z0), 0);
        this.stage.add(flag);
      }
    }
  }

  /** Where a stall's label goes on the 1920×1080 stage. */
  labelAt(i: number) {
    const s = this.stalls[i];
    return s ? this.stage.toStage(s.top) : null;
  }

  private put(i: number, x: number, y: number, z: number, s: number) {
    dummy.position.set(x, y, z);
    dummy.rotation.set(s * 3, s * 5, 0);
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    this.bits.setMatrixAt(i, dummy.matrix);
  }

  private confetti(x: number, z: number) {
    const cols = ['#e8335a', '#f2b705', '#3d7eff', '#4caf50', '#fff4dc', '#ff7ad1'];
    let made = 0;
    for (let i = 0; i < this.bitsLife.length && made < 120; i++) {
      const b = this.bitsLife[i];
      if (b.life > 0) continue;
      const a = Math.random() * TAU;
      const sp = 2 + Math.random() * 5;
      Object.assign(b, { x, y: 1, z, vx: Math.cos(a) * sp, vz: Math.sin(a) * sp, vy: 6 + Math.random() * 7, life: 1.6 + Math.random(), size: 0.12 + Math.random() * 0.12 });
      b.max = b.life;
      this.bits.setColorAt(i, new Color(cols[i % cols.length]));
      made++;
    }
    if (this.bits.instanceColor) this.bits.instanceColor.needsUpdate = true;
  }

  render(dt: number) {
    const sim = this.sim;
    this.time += dt;
    const t = this.time;
    const counts = sim.counts();
    const winner = sim.winner();
    const lit = sim.lit();
    const litChoice = lit >= 0 ? sim.tickets[lit] : -1;
    if (lit !== this.lastLit && litChoice >= 0) this.stalls[litChoice].pulse = 1;
    if (sim.phase === 'chosen' && this.lastLit !== -2 && winner !== null) {
      const m = matPos(winner, sim.choices);
      this.confetti(m.x, m.z);
    }
    this.lastLit = sim.phase === 'chosen' ? -2 : lit;

    this.stalls.forEach((s, i) => {
      const hex = CHOICE_COLORS[i % CHOICE_COLORS.length];
      s.pulse = Math.max(0, s.pulse - dt * 4);
      const won = sim.phase === 'chosen' && winner === i;
      const lost = sim.phase === 'chosen' && winner !== i;
      const busy = sim.phase === 'vote' && counts[i] > 0;
      const glow = won ? 0.55 + Math.sin(t * 8) * 0.15 : s.pulse * 0.6 + (busy ? 0.18 + Math.sin(t * 5) * 0.06 : 0);
      s.matMat.color.set(hex).lerp(new Color('#ffffff'), Math.max(0, glow));
      if (lost) s.matMat.color.multiplyScalar(0.45);
      const pop = 1 + s.pulse * 0.12 + (won ? 0.06 : 0);
      s.mat.scale.set(pop, 1, pop);
      s.ring.scale.set(pop, pop, 1);
      s.ring.rotation.z = t * (busy || won ? 1.2 : 0.3);
      s.ringMat.opacity = lost ? 0.25 : 0.85;
      s.beamMat.opacity = won ? 0.32 + Math.sin(t * 6) * 0.06 : s.pulse * 0.22;
      s.group.position.y = won ? Math.abs(Math.sin(t * 6)) * 0.12 : 0;
      s.group.scale.setScalar(lost ? 0.96 : 1);
    });
    this.lanterns.forEach((m, k) => m.color.set('#ffd77a').multiplyScalar(0.85 + Math.sin(t * 2.3 + k * 1.9) * 0.15));

    this.updateWalkers(dt, t);
    this.updateBits(dt);
    this.stage.lookAt(this.base, 28, 0.9);
    this.stage.render();
  }

  private updateWalkers(dt: number, t: number) {
    const sim = this.sim;
    const winner = sim.winner();
    sim.players.forEach((p, i) => {
      const v = this.walkers[i];
      const m = v.model;
      m.root.visible = p.present;
      if (!p.present) return;
      const speed = Math.hypot(p.vx, p.vz);
      v.phase += dt * (3 + speed * 1.6);
      let bob = Math.sin(t * 3 + i) * 0.015;
      let roll = 0;
      let tilt = 0;
      if (speed > 0.8) {
        bob = Math.abs(Math.sin(v.phase)) * 0.13 * Math.min(1, speed / 4);
        roll = Math.sin(v.phase) * 0.09;
        tilt = Math.min(1, speed / 6) * 0.16;
      }
      // Cheer when your game wins: hop up and down.
      const cheer = sim.phase === 'chosen' && winner !== null && sim.votes()[i] === winner;
      if (cheer) bob = Math.abs(Math.sin(t * 9 + i)) * 0.6;
      let face = p.face;
      // Standing on a mat: look at the stall.
      if (speed < 0.5 && p.on !== null) face = Math.PI;
      if (sim.phase !== 'vote') face = Math.PI;
      v.facing += angleDiff(v.facing, face) * Math.min(1, dt * 12);
      m.root.position.set(p.x, bob, p.z);
      m.body.rotation.set(tilt, v.facing, roll);
      m.shadow.scale.set(1 - bob * 0.4, 0.6, 1);
    });
  }

  private updateBits(dt: number) {
    for (let i = 0; i < this.bitsLife.length; i++) {
      const b = this.bitsLife[i];
      if (b.life <= 0) continue;
      b.life -= dt;
      if (b.life <= 0) {
        this.put(i, 0, -50, 0, 0);
        continue;
      }
      b.vy -= 12 * dt;
      b.vx *= 1 - dt * 0.8;
      b.vz *= 1 - dt * 0.8;
      b.x += b.vx * dt;
      b.y = Math.max(0.05, b.y + b.vy * dt);
      b.z += b.vz * dt;
      const k = b.life / b.max;
      this.put(i, b.x, b.y, b.z, b.size * (k < 0.3 ? k / 0.3 : 1));
    }
    this.bits.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.stage.dispose();
  }
}

