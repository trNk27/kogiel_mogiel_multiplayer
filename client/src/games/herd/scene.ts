/**
 * Zgodni in 3D: a Podhale meadow under the Tatras. A wooden bacówka (shepherd's hut), spruces, a
 * rail fence, crocuses in the grass and a few sheep. The pierogi graze while they think, then run
 * together into herds, one per answer, each round a wooden signpost (the answer itself is a DOM
 * label the game puts over the sign). The Pink Cow follows whoever holds it.
 * Same PS2 look as the other arena games.
 */
import {
  AdditiveBlending,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  RingGeometry,
  SphereGeometry,
  Vector3,
  type Sprite,
} from 'three';
import { ArenaStage, blobShadow, box, buildPierogi, flat, groundTexture, nameTag, type PierogiModel } from '../arena/kit';
import { Puffs } from '../arena/puffs';
import { mulberry32 } from '../rng';
import type { Spot } from './logic';

export interface PlayerLook {
  name: string;
  color: string;
}

type Keep = <T extends { dispose(): void }>(x: T) => T;

const RUN_SPEED = 7.5;
const PIEROGI_SCALE = 0.8;
/** Where the cow grazes while nobody has it. */
const COW_HOME = { x: 12.5, z: -7.5 };

interface Actor {
  model: PierogiModel;
  tag: Sprite;
  color: string;
  x: number;
  z: number;
  tx: number;
  tz: number;
  /** Seconds before it sets off for its target. */
  delay: number;
  /** Seconds left of a happy hop, or 0. */
  hop: number;
  /** Seconds left of cheering, or 0. */
  cheer: number;
  /** Seconds until it picks a new grazing spot. */
  graze: number;
  homeX: number;
  homeZ: number;
  /** Wander about its home spot. */
  wander: boolean;
  /** Face the camera (once it's answered, or in a herd). */
  facing: number;
  visible: boolean;
  /** Was running last frame (for the arrival puff). */
  running: boolean;
}

interface Sign {
  root: Group;
  t: number;
}

const smooth = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

export class HerdScene {
  readonly stage: ArenaStage;
  private actors: Actor[] = [];
  private signs: Sign[] = [];
  private signParts: { post: CylinderGeometry; wood: MeshLambertMaterial; plank: MeshLambertMaterial; blank: MeshLambertMaterial };
  private glow: Mesh;
  private glowMat: MeshBasicMaterial;
  private glowOn = false;
  private cow: Group;
  private cowBody: Group;
  private cowTail: Mesh;
  private cowBell: Mesh;
  private cowPos = new Vector3(COW_HOME.x, 0, COW_HOME.z);
  private cowTarget = new Vector3(COW_HOME.x, 0, COW_HOME.z);
  private cowHolder = -1;
  private cowWalk = 0;
  private sheep: { g: Group; phase: number }[] = [];
  private puffs = new Puffs(220, 7, 1.4);
  private rnd = mulberry32(99);
  private time = 0;
  private shake = 0;

  constructor(canvas: HTMLCanvasElement, looks: PlayerLook[], homes: Spot[]) {
    this.stage = new ArenaStage(canvas, { sky: '#a9d8f2', fog: [55, 150], fov: 38 });
    const stage = this.stage;
    const keep: Keep = (x) => stage.keep(x);
    this.buildMeadow(keep);

    this.signParts = {
      post: keep(new CylinderGeometry(0.13, 0.15, 2.3, 6)),
      wood: keep(flat('#7a4e2a')),
      plank: keep(flat('#c99a5e')),
      blank: keep(flat('#8f8577')),
    };

    // The glow under the winning herd.
    this.glowMat = keep(new MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending }));
    const gg = keep(new RingGeometry(0.2, 1, 28));
    gg.rotateX(-Math.PI / 2);
    this.glow = new Mesh(gg, this.glowMat);
    this.glow.position.y = 0.05;
    this.glow.renderOrder = 2;
    stage.add(this.glow);

    const cow = this.buildCow(keep);
    this.cow = cow.root;
    this.cowBody = cow.body;
    this.cowTail = cow.tail;
    this.cowBell = cow.bell;
    this.cow.position.copy(this.cowPos);
    stage.add(this.cow);

    stage.add(this.puffs.mesh);
    looks.forEach((l, i) => {
      const model = buildPierogi(l.color);
      model.mats.forEach((m) => keep(m));
      const tag = nameTag(l.name, l.color);
      tag.position.set(0, 1.95, 0);
      tag.scale.set(2.8, 0.7, 1);
      model.root.scale.setScalar(PIEROGI_SCALE);
      model.root.add(tag);
      const h = homes[i] ?? { x: 0, z: 0 };
      model.root.position.set(h.x, 0, h.z);
      stage.add(model.root);
      this.actors.push({
        model,
        tag,
        color: l.color,
        x: h.x,
        z: h.z,
        tx: h.x,
        tz: h.z,
        delay: 0,
        hop: 0,
        cheer: 0,
        graze: 1 + this.rnd() * 3,
        homeX: h.x,
        homeZ: h.z,
        wander: true,
        facing: 0,
        visible: true,
        running: false,
      });
    });
    stage.lookAt(new Vector3(0, 1, -1.5), 30, 0.5);
  }

  // ---- scenery ----------------------------------------------------------------------------------------
  private buildMeadow(keep: Keep) {
    const stage = this.stage;
    const grass = keep(groundTexture('grass', 30, 7));
    const g = keep(new PlaneGeometry(220, 140));
    g.rotateX(-Math.PI / 2);
    const ground = new Mesh(g, keep(flat('#ffffff', { map: grass })));
    ground.position.set(0, 0, -30);
    stage.add(ground);

    // Rolling green hills behind the meadow, the Tatras behind them.
    const hillMat = [keep(flat('#5e9a3e')), keep(flat('#6ba847')), keep(flat('#558a38'))];
    const hillGeo = keep(new SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2));
    for (const [x, z, sx, sy, k] of [
      [-34, -40, 26, 7, 0],
      [-8, -46, 24, 9, 1],
      [20, -42, 28, 7.5, 2],
      [44, -38, 20, 6, 0],
    ] as const) {
      const h = new Mesh(hillGeo, hillMat[k]);
      h.scale.set(sx, sy, 10);
      h.position.set(x, -0.2, z);
      stage.add(h);
    }
    const rock = [keep(flat('#8d8f99')), keep(flat('#7a7c88'))];
    const snow = keep(flat('#f4f6fb'));
    const peakGeo = keep(new ConeGeometry(1, 1, 5));
    for (const [x, z, r, h, k] of [
      [-52, -78, 20, 30, 0],
      [-24, -86, 24, 42, 1],
      [2, -80, 18, 34, 0],
      [26, -88, 26, 46, 1],
      [54, -80, 20, 32, 0],
      [-70, -70, 14, 20, 1],
      [74, -72, 16, 24, 1],
    ] as const) {
      const p = new Mesh(peakGeo, rock[k]);
      p.scale.set(r, h, r * 0.7);
      p.position.set(x, h / 2 - 1, z);
      const cap = new Mesh(peakGeo, snow);
      cap.scale.set(r * 0.36, h * 0.34, r * 0.36 * 0.7);
      cap.position.set(x, h - 1 - (h * 0.34) / 2 + 0.3, z);
      stage.add(p, cap);
    }

    // Spruces round the meadow.
    const spruceMat = [keep(flat('#2f5e34')), keep(flat('#28502e'))];
    const trunkMat = keep(flat('#5a3a22'));
    const coneGeo = keep(new ConeGeometry(1, 1, 7));
    const trunkGeo = keep(new CylinderGeometry(0.2, 0.25, 1, 5));
    const rnd = mulberry32(31);
    const spruce = (x: number, z: number, s: number) => {
      const t = new Group();
      const trunk = new Mesh(trunkGeo, trunkMat);
      trunk.scale.set(1, 1.2, 1);
      trunk.position.y = 0.6;
      t.add(trunk);
      for (let k = 0; k < 3; k++) {
        const c = new Mesh(coneGeo, spruceMat[k % 2]);
        const w = 1.9 - k * 0.5;
        c.scale.set(w, 2.2, w);
        c.position.y = 1.6 + k * 1.25;
        t.add(c);
      }
      t.scale.setScalar(s);
      t.position.set(x, 0, z);
      t.add(blobShadow(1.6, 0.25));
      stage.add(t);
    };
    for (let k = 0; k < 14; k++) spruce(-32 + k * 4.8 + rnd() * 2, -19 - rnd() * 6, 1 + rnd() * 0.5);
    for (const [x, z] of [
      [-21, -9],
      [-23.5, -3],
      [-22, 3],
      [21, -11],
      [23.5, -2],
      [22, 4],
    ] as const)
      spruce(x, z, 0.9 + rnd() * 0.4);

    // A rail fence (żerdzie) across the back of the meadow.
    const wood = keep(flat('#8a5a32'));
    const fenceZ = -12;
    for (let x = -18; x <= 18; x += 3) {
      const post = box(0.22, 1.4, 0.22, wood);
      post.position.set(x, 0, fenceZ);
      stage.add(post);
    }
    for (const y of [0.55, 1.1]) {
      const rail = box(36.5, 0.14, 0.12, wood);
      rail.position.set(0, y, fenceZ);
      rail.rotation.z = 0.01;
      stage.add(rail);
    }

    // A bacówka: a log shepherd's hut with a steep shingle roof and a smoking chimney.
    const hut = new Group();
    const logs = keep(flat('#9b6a3c'));
    const logs2 = keep(flat('#875a30'));
    for (let k = 0; k < 6; k++) {
      const l = box(7, 0.5, 5, k % 2 ? logs : logs2);
      l.position.y = k * 0.5;
      hut.add(l);
    }
    const shingle = keep(flat('#4a3a32'));
    const roofGeo = keep(new ConeGeometry(5.6, 3.8, 4));
    const roof = new Mesh(roofGeo, shingle);
    roof.rotation.y = Math.PI / 4;
    roof.scale.set(1.0, 1, 0.75);
    roof.position.y = 3 + 1.9;
    const door = box(1.1, 1.9, 0.1, keep(flat('#5a3a22')));
    door.position.set(0.8, 0, 2.52);
    const win = box(0.9, 0.8, 0.1, keep(flat('#ffe9a8')));
    win.position.set(-1.9, 1.2, 2.52);
    const chimney = box(0.6, 1.6, 0.6, keep(flat('#a49a8c')));
    chimney.position.set(-1.5, 4.4, 0);
    hut.add(roof, door, win, chimney);
    hut.position.set(-15, 0, -15.5);
    hut.rotation.y = 0.3;
    stage.add(hut);
    this.chimney = new Vector3(-15 - 1.5 * Math.cos(0.3), 6.2, -15.5 + 1.5 * Math.sin(0.3));

    // A milk churn and a bench by the hut.
    const churn = new Mesh(keep(new CylinderGeometry(0.35, 0.4, 1, 8)), keep(flat('#c9ccd2')));
    churn.position.set(-10.4, 0.5, -12.6);
    const bench = box(2.2, 0.15, 0.6, wood);
    bench.position.set(-12.2, 0.45, -12.4);
    stage.add(churn, bench);

    // Crocuses (purple, the Tatra spring) and white daisies in the grass.
    const crocus = keep(flat('#9b6bd6'));
    const daisy = keep(flat('#fff8ea'));
    const flowerGeo = keep(new IcosahedronGeometry(0.12, 0));
    for (let k = 0; k < 140; k++) {
      const f = new Mesh(flowerGeo, k % 3 ? crocus : daisy);
      f.position.set((rnd() - 0.5) * 44, 0.08, -11 + rnd() * 17);
      f.scale.y = 0.6;
      stage.add(f);
    }

    // A few sheep grazing up by the fence.
    const wool = keep(flat('#f3efe6'));
    const face = keep(flat('#3a2a22'));
    const woolGeo = keep(new IcosahedronGeometry(0.5, 0));
    const headGeo = keep(new SphereGeometry(0.24, 5, 3));
    const legGeo = keep(new CylinderGeometry(0.06, 0.06, 0.4, 4));
    for (const [x, z, r] of [
      [5, -10, 0.6],
      [7.4, -9.2, 2.6],
      [9.2, -10.6, -0.4],
      [-4, -10.2, 3.4],
    ] as const) {
      const sh = new Group();
      const body = new Group();
      for (const [bx, by, bs] of [
        [0, 0.62, 1],
        [0.35, 0.7, 0.8],
        [-0.35, 0.68, 0.85],
      ] as const) {
        const w = new Mesh(woolGeo, wool);
        w.position.set(bx, by, 0);
        w.scale.setScalar(bs);
        body.add(w);
      }
      const head = new Mesh(headGeo, face);
      head.position.set(0.72, 0.6, 0);
      body.add(head);
      for (const [lx, lz] of [
        [0.3, 0.2],
        [0.3, -0.2],
        [-0.3, 0.2],
        [-0.3, -0.2],
      ] as const) {
        const l = new Mesh(legGeo, face);
        l.position.set(lx, 0.2, lz);
        sh.add(l);
      }
      sh.add(body, blobShadow(0.7, 0.25));
      sh.position.set(x, 0, z);
      sh.rotation.y = r;
      stage.add(sh);
      this.sheep.push({ g: body, phase: rnd() * 6 });
    }
  }

  private chimney = new Vector3();

  /** Różowa Krowa: a pink low-poly cow with darker spots, little horns and a góral bell. */
  private buildCow(keep: Keep) {
    const root = new Group();
    const body = new Group();
    const pink = keep(flat('#ff8fc8'));
    const spot = keep(flat('#e0559c'));
    const snout = keep(flat('#ffc2df'));
    const horn = keep(flat('#fff4dc'));
    const dark = keep(new MeshBasicMaterial({ color: '#1d0f0a' }));
    const white = keep(new MeshBasicMaterial({ color: '#fff8ea' }));
    const torso = box(2.2, 1.1, 1.2, pink);
    torso.position.y = 1.0;
    body.add(torso);
    for (const [x, y, z, s] of [
      [0.4, 1.56, 0.2, 0.5],
      [-0.6, 1.2, 0.61, 0.45],
      [-0.3, 0.95, -0.61, 0.5],
      [0.7, 1.1, 0.61, 0.35],
    ] as const) {
      const sp = box(s, 0.04, s * 0.8, spot);
      sp.position.set(x, y - 0.02, z);
      if (Math.abs(z) > 0.5) {
        sp.rotation.x = Math.PI / 2;
        sp.position.y = y;
      }
      body.add(sp);
    }
    const head = new Group();
    const skull = box(0.8, 0.8, 0.8, pink);
    const muzzle = box(0.5, 0.4, 0.86, snout);
    muzzle.position.set(0.28, 0.05, 0);
    head.add(skull, muzzle);
    for (const z of [-0.22, 0.22]) {
      const e = new Mesh(keep(new SphereGeometry(0.11, 5, 3)), white);
      e.position.set(0.3, 0.55, z);
      const p = new Mesh(keep(new SphereGeometry(0.06, 4, 2)), dark);
      p.position.set(0.39, 0.56, z);
      const h = new Mesh(keep(new ConeGeometry(0.09, 0.35, 4)), horn);
      h.position.set(-0.05, 0.95, z * 1.4);
      h.rotation.x = z > 0 ? 0.5 : -0.5;
      const ear = box(0.12, 0.2, 0.32, spot);
      ear.position.set(-0.1, 0.62, z * 2.3);
      head.add(e, p, h, ear);
    }
    head.position.set(1.35, 1.25, 0);
    body.add(head);
    // The bell on a red strap.
    const strap = box(0.12, 0.1, 0.9, keep(flat('#cf3a2c')));
    strap.position.set(1.05, 0.95, 0);
    const bell = new Mesh(keep(new ConeGeometry(0.2, 0.32, 6)), keep(flat('#e3b341')));
    bell.position.set(1.15, 0.7, 0);
    body.add(strap, bell);
    const udder = new Mesh(keep(new SphereGeometry(0.28, 6, 4)), snout);
    udder.position.set(-0.4, 0.45, 0);
    body.add(udder);
    const legGeo = keep(new CylinderGeometry(0.13, 0.12, 0.6, 5));
    for (const [x, z] of [
      [0.75, 0.4],
      [0.75, -0.4],
      [-0.75, 0.4],
      [-0.75, -0.4],
    ] as const) {
      const l = new Mesh(legGeo, pink);
      l.position.set(x, 0.3, z);
      body.add(l);
    }
    const tail = new Mesh(keep(new CylinderGeometry(0.04, 0.04, 0.8, 4)), spot);
    tail.position.set(-1.15, 1.1, 0);
    tail.rotation.z = -0.4;
    body.add(tail);
    root.add(body, blobShadow(1.4, 0.3));
    root.scale.setScalar(0.85);
    return { root, body, tail, bell };
  }

  // ---- what the game asks for -------------------------------------------------------------------------

  /** Everyone back to grazing round their home spot (a new question). */
  home() {
    this.actors.forEach((a) => {
      a.tx = a.homeX;
      a.tz = a.homeZ;
      a.delay = this.rnd() * 0.4;
      a.wander = true;
      a.cheer = 0;
    });
    this.clearSigns();
    this.setGlow(null);
  }

  /** A happy hop when a player's answer is in. */
  answered(i: number) {
    const a = this.actors[i];
    if (!a) return;
    a.hop = 0.5;
    a.wander = false;
    a.tx = a.x;
    a.tz = a.z;
    const r = a.model.root.position;
    for (let k = 0; k < 5; k++) this.puffs.spawn(r.x, 1.6, r.z, (this.rnd() - 0.5) * 2, 2.5, (this.rnd() - 0.5) * 1, 0.16, 0.6, a.color);
  }

  /** Run to a spot (after `delay` seconds) and stay there. */
  runTo(i: number, x: number, z: number, delay = 0) {
    const a = this.actors[i];
    if (!a) return;
    a.wander = false;
    a.tx = x;
    a.tz = z;
    a.delay = delay;
  }

  /** Put up a signpost for a herd (the answer is drawn over it by the game). */
  sign(x: number, z: number, blank: boolean) {
    const p = this.signParts;
    const root = new Group();
    const post = new Mesh(p.post, p.wood);
    post.position.y = 1.15;
    const board = box(2.4, 1.0, 0.14, blank ? p.blank : p.plank);
    board.position.y = 1.9;
    root.add(post, board);
    root.position.set(x, 0, z);
    root.scale.setScalar(0.01);
    this.stage.add(root);
    this.signs.push({ root, t: 0 });
    for (let k = 0; k < 6; k++) this.puffs.spawn(x + (this.rnd() - 0.5) * 1.5, 0.1, z, (this.rnd() - 0.5) * 2, 1.2, (this.rnd() - 0.5), 0.3, 0.6, '#cdb98a');
  }

  clearSigns() {
    for (const s of this.signs) {
      this.stage.world.remove(s.root);
      s.root.traverse((o) => {
        const m = o as Mesh;
        if (m.geometry && m.geometry !== this.signParts.post) m.geometry.dispose();
      });
    }
    this.signs = [];
  }

  /** Light up the ground under the winning herd (null: off). */
  setGlow(at: { x: number; z: number; r: number } | null) {
    this.glowOn = !!at;
    if (at) {
      this.glow.position.set(at.x, 0.05, at.z);
      this.glow.scale.set(at.r * 1.25, 1, at.r);
    }
  }

  /** Cheer: jump up and down with confetti in their colour. */
  cheer(i: number) {
    const a = this.actors[i];
    if (!a) return;
    a.cheer = 2.6;
    const r = a.model.root.position;
    for (let k = 0; k < 12; k++) {
      const ang = (k / 12) * Math.PI * 2;
      this.puffs.spawn(r.x, 1.4, r.z, Math.cos(ang) * 2.5, 4 + this.rnd() * 2, Math.sin(ang) * 1.5, 0.14, 1.2, k % 3 ? a.color : '#ffd23f');
    }
  }

  /** The cow follows player `i` (-1: back to grazing by the hut). */
  setCow(i: number, instant = false) {
    const changed = i !== this.cowHolder;
    this.cowHolder = i;
    if (changed && i >= 0) {
      this.shake = 0.4;
      const p = this.cowPos;
      for (let k = 0; k < 10; k++) this.puffs.spawn(p.x, 0.3, p.z, (this.rnd() - 0.5) * 4, 2, (this.rnd() - 0.5) * 3, 0.32, 0.7, '#ffc2df');
    }
    this.updateCowTarget();
    if (instant) this.cowPos.copy(this.cowTarget);
  }

  private updateCowTarget() {
    const a = this.actors[this.cowHolder];
    if (a && a.visible) this.cowTarget.set(a.tx + 1.9, 0, a.tz - 0.9);
    else this.cowTarget.set(COW_HOME.x, 0, COW_HOME.z);
  }

  hide(i: number) {
    const a = this.actors[i];
    if (!a) return;
    a.visible = false;
    a.model.root.visible = false;
    if (this.cowHolder === i) this.setCow(-1);
  }

  /** Where a world point is on the 1920×1080 stage. */
  toStage(x: number, y: number, z: number) {
    return this.stage.toStage(new Vector3(x, y, z));
  }

  /** Where player `i`'s head is on the stage (for the "+1"). */
  headOf(i: number) {
    const a = this.actors[i];
    return a ? this.toStage(a.x, 2.2, a.z) : null;
  }

  // ---- drawing ----------------------------------------------------------------------------------------
  render(dt: number) {
    this.time += dt;
    const t = this.time;

    this.actors.forEach((a, i) => {
      if (!a.visible) return;
      const root = a.model.root;
      const body = a.model.body;
      // Grazing: amble to a new spot near home every few seconds.
      if (a.wander) {
        a.graze -= dt;
        if (a.graze <= 0) {
          a.graze = 2 + this.rnd() * 3;
          a.tx = a.homeX + (this.rnd() - 0.5) * 2.4;
          a.tz = a.homeZ + (this.rnd() - 0.5) * 1.4;
        }
      }
      if (a.delay > 0) a.delay -= dt;
      const dx = a.tx - a.x;
      const dz = a.tz - a.z;
      const d = Math.hypot(dx, dz);
      const speed = a.wander ? 1.1 : RUN_SPEED;
      const moving = a.delay <= 0 && d > 0.05;
      let y = 0;
      let sy = 1;
      if (moving) {
        const step = Math.min(d, speed * dt);
        a.x += (dx / d) * step;
        a.z += (dz / d) * step;
        const want = Math.atan2(dx, dz);
        a.facing = turn(a.facing, want, dt * 10);
        // Hop as they go: little ones when grazing, big bounds when running.
        const f = a.wander ? 5 : 11;
        y = Math.abs(Math.sin(t * f + i)) * (a.wander ? 0.08 : 0.45);
      } else {
        a.facing = turn(a.facing, 0, dt * 6);
        if (a.running && !a.wander) {
          const r = root.position;
          for (let k = 0; k < 4; k++) this.puffs.spawn(r.x + (this.rnd() - 0.5), 0.1, r.z + (this.rnd() - 0.5) * 0.4, (this.rnd() - 0.5) * 1.5, 0.7, (this.rnd() - 0.5), 0.24, 0.45, '#cdb98a');
        }
        sy = 1 - 0.03 * Math.abs(Math.sin(t * 2 + i));
      }
      a.running = moving;
      if (a.hop > 0) {
        a.hop = Math.max(0, a.hop - dt);
        y += Math.sin((1 - a.hop / 0.5) * Math.PI) * 0.8;
      }
      if (a.cheer > 0) {
        a.cheer = Math.max(0, a.cheer - dt);
        y += Math.abs(Math.sin(a.cheer * 7)) * 0.9 * Math.min(1, a.cheer);
        sy *= 1 + 0.08 * Math.sin(a.cheer * 14);
      }
      root.position.set(a.x, y, a.z);
      root.rotation.y = a.facing;
      body.scale.set(1 / Math.sqrt(sy), sy, 1 / Math.sqrt(sy));
      body.rotation.z = moving ? Math.sin(t * 11 + i) * 0.1 : Math.sin(t * 1.5 + i) * 0.03;
      a.model.shadow.position.y = (0.03 - y) / PIEROGI_SCALE;
    });

    // Signs pop up out of the ground.
    for (const s of this.signs) {
      s.t += dt;
      const k = Math.min(1, s.t / 0.35);
      const over = 1 + Math.sin(k * Math.PI) * 0.25;
      s.root.scale.set(over, smooth(k) * over, over);
    }

    // The glow pulses.
    const go = this.glowOn ? 0.55 + 0.25 * Math.sin(t * 5) : 0;
    this.glowMat.opacity += (go - this.glowMat.opacity) * Math.min(1, dt * 6);
    this.glow.visible = this.glowMat.opacity > 0.01;
    this.glow.rotation.y = t * 0.6;

    // The cow ambles after its holder (or grazes by the hut), swishing its tail.
    this.updateCowTarget();
    const cdx = this.cowTarget.x - this.cowPos.x;
    const cdz = this.cowTarget.z - this.cowPos.z;
    const cd = Math.hypot(cdx, cdz);
    if (cd > 0.08) {
      const step = Math.min(cd, (cd > 6 ? 8 : 4.5) * dt);
      this.cowPos.x += (cdx / cd) * step;
      this.cowPos.z += (cdz / cd) * step;
      this.cowWalk += dt * 9;
      this.cow.rotation.y = turn(this.cow.rotation.y, Math.atan2(-cdz, cdx), dt * 6);
    } else {
      this.cow.rotation.y = turn(this.cow.rotation.y, this.cowHolder >= 0 ? -Math.PI / 2 + 0.5 : 2.6, dt * 2);
    }
    this.cow.position.set(this.cowPos.x, Math.abs(Math.sin(this.cowWalk)) * (cd > 0.08 ? 0.18 : 0), this.cowPos.z);
    this.cowBody.rotation.z = cd > 0.08 ? Math.sin(this.cowWalk) * 0.05 : 0;
    this.cowTail.rotation.x = Math.sin(t * 3) * 0.5;
    this.cowBell.rotation.x = Math.sin(t * 4 + this.cowWalk) * 0.25;

    this.sheep.forEach((s) => {
      // Heads down to graze now and then.
      s.g.rotation.z = -Math.max(0, Math.sin(t * 0.7 + s.phase)) * 0.25;
    });
    if (this.rnd() < dt * 3) this.puffs.spawn(this.chimney.x, this.chimney.y, this.chimney.z, 0.3, 1.2, 0, 0.35, 2.2, '#d8d4cc');
    this.puffs.update(dt);

    const stage = this.stage;
    stage.lookAt(new Vector3(0, 1, -1.5), 30, 0.5);
    if (this.shake > 0.01) {
      stage.camera.position.x += (this.rnd() - 0.5) * this.shake * 0.5;
      stage.camera.position.y += (this.rnd() - 0.5) * this.shake * 0.5;
      this.shake *= Math.exp(-7 * dt);
    }
    stage.render();
  }

  dispose() {
    this.stage.dispose();
  }
}

/** Turn an angle towards another by at most `k` (radians), the short way round. */
function turn(from: number, to: number, k: number) {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return from + Math.max(-k, Math.min(k, d));
}
