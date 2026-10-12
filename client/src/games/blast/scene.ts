/**
 * Petarda in 3D: a snowy village square on New Year’s Eve. A giant firecracker stands on a crate at
 * the back, wired to a row of detonator plungers; the pierogi wait their turn behind the plungers while
 * fireworks go off over the rooftops. Same PS2 look as the other arena games, at night.
 */
import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  PointLight,
  RingGeometry,
  SphereGeometry,
  Vector3,
  type MeshLambertMaterial,
  type Sprite,
} from 'three';
import { ArenaStage, box, buildPierogi, flat, nameTag, noise, pixelTexture, type PierogiModel } from '../arena/kit';
import { Puffs } from '../arena/puffs';
import { mulberry32 } from '../rng';
import { BOOM_TIME, FUSE_TIME, SETUP_TIME, type BlastSim } from './logic';

export interface PlayerLook {
  name: string;
  color: string;
}

/** Plungers stand in a row along x at this z; the pierogi queue behind them. */
const PLUNGER_Z = 1.3;
const PLUNGER_GAP = 1.95;
const QUEUE_Z = -2.3;
const QUEUE_GAP = 1.7;
/** Where blasted pierogi sit, sooty, out at the sides past the queue. */
const BENCH_Z = -4.4;
const CRACKER_Z = -7.6;
/** Top of a plunger's handle (where the pusher stands), up and pushed down. */
const HANDLE_UP = 1.55;
const HANDLE_DOWN = 1.05;
const SOOT = new Color('#4a4440');
const FIREWORK_COLORS = ['#ff3d6e', '#ffd23f', '#4f9dff', '#a3e048', '#ff8a2a', '#b27bff', '#fff4dc'];

const smooth = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

interface PlungerModel {
  root: Group;
  handle: Group;
  boxMat: MeshLambertMaterial;
  wire: Mesh;
  /** 0 up, 1 pushed. */
  down: number;
}

interface Actor {
  model: PierogiModel;
  tag: Sprite;
  colors: Color[];
  /** Where the pierogi is drawn (smoothed). */
  pos: Vector3;
  /** Seconds since being blasted, or -1. */
  blast: number;
  from: Vector3;
  bench: Vector3;
  spin: number;
}

export class BlastScene {
  readonly stage: ArenaStage;
  private actors: Actor[] = [];
  private plungers: PlungerModel[] = [];
  private plungerGroup = new Group();
  private cracker = new Group();
  private crackerGone = -1;
  private cursorRing: Mesh;
  private cursorMat: MeshBasicMaterial;
  private arrow: Mesh;
  private spark: Mesh;
  private flash: PointLight;
  private puffs = new Puffs(220, 6, 1.4);
  private sky = new Puffs(360, 1.6, 1.3);
  private snow = new Puffs(260, 0, 0);
  private bulbs: Mesh[] = [];
  private shownSet = -1;
  private time = 0;
  private nextFirework = 1;
  private shake = 0;
  private wireMat: MeshLambertMaterial;
  private keep: <T extends { dispose(): void }>(x: T) => T;
  private benchCount = 0;
  /** Camera distance: enough for everybody's plunger. */
  private dist: number;

  constructor(canvas: HTMLCanvasElement, looks: PlayerLook[]) {
    this.stage = new ArenaStage(canvas, { sky: '#1b1838', fog: [45, 120], fov: 38 });
    this.dist = 12.5 + looks.length * 0.9;
    const stage = this.stage;
    this.keep = <T extends { dispose(): void }>(x: T) => stage.keep(x);
    const keep = this.keep;
    // Night: a cold moon and a dim sky instead of the afternoon sun.
    stage.sun.color.set('#b9c8ff');
    stage.sun.intensity = 1.3;
    stage.scene.traverse((o) => {
      if (o instanceof HemisphereLight) {
        o.color.set('#8a90c8');
        o.groundColor.set('#3a3050');
        o.intensity = 1.6;
      }
    });
    this.flash = new PointLight('#ffb35a', 0, 40, 1.4);
    this.flash.position.set(0, 4, CRACKER_Z + 2);
    stage.scene.add(this.flash);

    this.buildSquare(keep);
    this.buildCracker(keep);
    this.wireMat = keep(flat('#2a2422'));
    stage.add(this.plungerGroup);

    this.cursorMat = new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.85, depthWrite: false });
    const rg = keep(new RingGeometry(0.75, 1.0, 20));
    rg.rotateX(-Math.PI / 2);
    this.cursorRing = new Mesh(rg, this.cursorMat);
    this.cursorRing.position.y = 0.04;
    this.cursorRing.renderOrder = 2;
    this.arrow = new Mesh(keep(new ConeGeometry(0.35, 0.6, 4)), this.cursorMat);
    this.arrow.rotation.x = Math.PI;
    stage.add(this.cursorRing, this.arrow);
    this.spark = new Mesh(keep(new SphereGeometry(0.2, 6, 4)), keep(new MeshBasicMaterial({ color: '#fff2a8' })));
    this.spark.visible = false;
    stage.add(this.spark);
    stage.add(this.puffs.mesh, this.sky.mesh, this.snow.mesh);
    for (let k = 0; k < 160; k++) this.snowflake(Math.random() * 9);

    looks.forEach((l) => {
      const model = buildPierogi(l.color);
      const tag = nameTag(l.name, l.color);
      tag.position.set(0, 1.95, 0);
      tag.scale.set(2.6, 0.65, 1);
      model.root.scale.setScalar(0.8);
      model.root.add(tag);
      stage.add(model.root);
      const colors = model.mats.slice(0, 2).map((m) => (m as MeshLambertMaterial).color.clone());
      this.actors.push({ model, tag, colors, pos: new Vector3(), blast: -1, from: new Vector3(), bench: new Vector3(), spin: 0 });
    });
  }

  // ---- scenery ----------------------------------------------------------------------------------------
  private buildSquare(keep: <T extends { dispose(): void }>(x: T) => T) {
    const stage = this.stage;
    const snowTex = keep(
      pixelTexture(
        16,
        (ctx, rnd) => {
          noise(ctx, rnd, 16, [222, 230, 246], 18);
          ctx.fillStyle = 'rgba(255,255,255,.8)';
          ctx.fillRect(3, 4, 2, 1);
          ctx.fillRect(10, 11, 3, 1);
        },
        4,
        20,
      ),
    );
    const g = keep(new PlaneGeometry(140, 90));
    g.rotateX(-Math.PI / 2);
    const ground = new Mesh(g, keep(flat('#ffffff', { map: snowTex })));
    ground.position.set(0, 0, -12);
    stage.add(ground);
    // Cobbles swept clear where the plungers stand.
    const cob = keep(
      pixelTexture(
        16,
        (ctx, rnd) => {
          noise(ctx, rnd, 16, [120, 112, 118], 26);
          ctx.fillStyle = 'rgba(30,24,30,.5)';
          for (const y of [3, 8, 13]) ctx.fillRect(0, y, 16, 1);
          for (const [x, y] of [
            [4, 0],
            [11, 4],
            [6, 9],
            [13, 9],
            [2, 14],
          ])
            ctx.fillRect(x, y, 1, 4);
        },
        6,
        8,
      ),
    );
    const cg = keep(new PlaneGeometry(22, 15));
    cg.rotateX(-Math.PI / 2);
    const cobbles = new Mesh(cg, keep(flat('#ffffff', { map: cob })));
    cobbles.position.set(0, 0.01, -2.5);
    stage.add(cobbles);

    // Houses round the square: painted walls, snowy roofs, warm windows.
    const snowMat = keep(flat('#f2f5ff'));
    const lit = keep(new MeshBasicMaterial({ color: '#ffd27a' }));
    const walls = ['#e8a0a0', '#f2d48a', '#9fc4e8', '#c9e0a8', '#e6c2e8'];
    const rnd = mulberry32(31);
    for (let k = 0; k < 7; k++) {
      const x = -24 + k * 8 + (rnd() - 0.5) * 1.5;
      const w = 6.5;
      const h = 5 + rnd() * 2.5;
      const house = new Group();
      const wall = box(w, h, 5, keep(flat(walls[k % walls.length])));
      const roof = new Mesh(keep(new ConeGeometry(w * 0.78, 2.6, 4)), snowMat);
      roof.rotation.y = Math.PI / 4;
      roof.scale.z = 0.7;
      roof.position.y = h + 1.3;
      house.add(wall, roof);
      for (let r = 0; r < 2; r++)
        for (const wx of [-1.6, 1.6]) {
          if (rnd() < 0.25) continue;
          const win = box(1.0, 1.1, 0.1, lit);
          win.position.set(wx, 1.2 + r * 2.1, 2.52);
          house.add(win);
        }
      house.position.set(x, 0, -19 - rnd() * 3);
      stage.add(house);
    }
    // A Christmas tree with blinking bulbs, and snow heaps.
    const tree = new Group();
    const green = keep(flat('#2f6b3a'));
    for (let k = 0; k < 4; k++) {
      const c = new Mesh(keep(new ConeGeometry(2.6 - k * 0.55, 2.4, 7)), green);
      c.position.y = 1.6 + k * 1.45;
      tree.add(c);
    }
    const trunk = new Mesh(keep(new CylinderGeometry(0.35, 0.4, 1.2, 6)), keep(flat('#6b4222')));
    trunk.position.y = 0.6;
    const star = new Mesh(keep(new IcosahedronGeometry(0.45, 0)), keep(new MeshBasicMaterial({ color: '#ffd23f' })));
    star.position.y = 7.6;
    tree.add(trunk, star);
    const bulbGeo = keep(new SphereGeometry(0.16, 5, 3));
    for (let k = 0; k < 22; k++) {
      const y = 1.2 + rnd() * 5.6;
      const r = (2.6 - ((y - 1.0) / 6.2) * 2.2) * 0.92;
      const a = rnd() * Math.PI * 2;
      const b = new Mesh(bulbGeo, keep(new MeshBasicMaterial({ color: FIREWORK_COLORS[k % 5] })));
      b.position.set(Math.cos(a) * r, y, Math.sin(a) * r);
      tree.add(b);
      this.bulbs.push(b);
    }
    tree.position.set(13, 0, -10);
    stage.add(tree);
    const heap = keep(new IcosahedronGeometry(1, 1));
    for (const [x, z, s] of [
      [-13, -6, 1.8],
      [-15.5, -3, 1.2],
      [15.5, -4, 1.4],
      [-12, 4, 1.1],
      [14, 5, 1.6],
      [9, -12, 1.2],
    ] as const) {
      const m = new Mesh(heap, snowMat);
      m.scale.set(s * 1.5, s * 0.55, s);
      m.position.set(x, 0, z);
      stage.add(m);
    }
    // Lamp posts.
    const iron = keep(flat('#2a2630'));
    const glow = keep(new MeshBasicMaterial({ color: '#ffe3a0' }));
    for (const x of [-11, 11]) {
      const post = new Mesh(keep(new CylinderGeometry(0.1, 0.14, 4.4, 6)), iron);
      post.position.set(x, 2.2, -1);
      const lamp = new Mesh(keep(new BoxGeometry(0.55, 0.7, 0.55)), glow);
      lamp.position.set(x, 4.6, -1);
      const cap = new Mesh(keep(new ConeGeometry(0.5, 0.4, 4)), iron);
      cap.rotation.y = Math.PI / 4;
      cap.position.set(x, 5.15, -1);
      stage.add(post, lamp, cap);
      const light = new PointLight('#ffcf7a', 1.4, 14, 1.5);
      light.position.set(x, 4.4, -1);
      stage.add(light);
    }
  }

  private buildCracker(keep: <T extends { dispose(): void }>(x: T) => T) {
    const c = this.cracker;
    const crate = box(4.2, 1.4, 3.2, keep(flat('#9a6a3a')));
    const plank = keep(flat('#7a4e28'));
    for (const y of [0.25, 1.15]) {
      const p = box(4.3, 0.18, 3.3, plank);
      p.position.y = y;
      c.add(p);
    }
    const tube = new Mesh(keep(new CylinderGeometry(1.45, 1.45, 5.2, 12)), keep(flat('#d8322a')));
    tube.position.y = 1.4 + 2.6;
    const gold = keep(flat('#ffc93c'));
    for (const y of [1.9, 4.0, 6.1]) {
      const band = new Mesh(keep(new CylinderGeometry(1.5, 1.5, 0.35, 12)), gold);
      band.position.y = y;
      c.add(band);
    }
    const cap = new Mesh(keep(new CylinderGeometry(1.2, 1.45, 0.5, 12)), keep(flat('#f4ecdc')));
    cap.position.y = 6.85;
    const fuse = new Mesh(keep(new CylinderGeometry(0.08, 0.08, 1.1, 5)), keep(flat('#e9d7a8')));
    fuse.position.y = 7.6;
    fuse.rotation.z = 0.3;
    // A white-and-red star on the front, like a sticker.
    const sticker = new Mesh(keep(new CylinderGeometry(0.75, 0.75, 0.05, 5)), keep(flat('#fff4dc')));
    sticker.rotation.x = Math.PI / 2;
    sticker.position.set(0, 4.0, 1.46);
    c.add(crate, tube, cap, fuse, sticker);
    c.position.set(0, 0, CRACKER_Z);
    this.stage.add(c);
  }

  /** Rebuild the plungers and their wires for a new set. */
  private buildPlungers(count: number) {
    const keep = this.keep;
    this.plungerGroup.clear();
    this.plungers = [];
    const rod = keep(new CylinderGeometry(0.07, 0.07, 0.9, 5));
    const bar = keep(new CylinderGeometry(0.11, 0.11, 1.1, 6));
    const steel = keep(flat('#c9ccd3'));
    const grip = keep(flat('#2a2630'));
    for (let j = 0; j < count; j++) {
      const x = this.plungerX(j, count);
      const root = new Group();
      const boxMat = keep(flat('#b5412e'));
      const body = box(0.95, 0.75, 0.7, boxMat);
      const lid = box(1.05, 0.12, 0.8, keep(flat('#7a2a1e')));
      lid.position.y = 0.75;
      root.add(body, lid);
      const handle = new Group();
      const r = new Mesh(rod, steel);
      r.position.y = 0.45;
      const b = new Mesh(bar, grip);
      b.rotation.z = Math.PI / 2;
      b.position.y = 0.9;
      handle.add(r, b);
      handle.position.y = 0.6;
      root.add(handle);
      root.position.set(x, 0, PLUNGER_Z);
      // The wire runs back to the firecracker's crate.
      const dx = x * 0.3 - x;
      const dz = CRACKER_Z + 1.6 - PLUNGER_Z;
      const len = Math.hypot(dx, dz);
      const wire = new Mesh(keep(new BoxGeometry(0.08, 0.05, len)), this.wireMat);
      wire.position.set(x + dx / 2, 0.04, PLUNGER_Z + dz / 2);
      wire.rotation.y = Math.atan2(dx, dz);
      this.plungerGroup.add(root, wire);
      this.plungers.push({ root, handle, boxMat, wire, down: 0 });
    }
  }

  private plungerX(j: number, count: number) {
    return (j - (count - 1) / 2) * PLUNGER_GAP;
  }

  /** The start and end of plunger j's wire. */
  private wireEnds(j: number) {
    const x = this.plungerX(j, this.plungers.length);
    return { a: new Vector3(x, 0.1, PLUNGER_Z - 0.4), b: new Vector3(x * 0.3, 0.1, CRACKER_Z + 1.6) };
  }

  // ---- events ----------------------------------------------------------------------------------------
  reset(sim: BlastSim) {
    this.shownSet = -1;
    this.crackerGone = -1;
    this.cracker.visible = true;
    this.cracker.position.y = 0;
    this.benchCount = 0;
    this.actors.forEach((a, i) => {
      const p = sim.players[i];
      a.blast = -1;
      a.model.mats.slice(0, 2).forEach((m, k) => (m as MeshLambertMaterial).color.copy(a.colors[k]));
      a.model.body.rotation.set(0, 0, 0);
      a.model.body.scale.set(1, 1, 1);
      a.model.root.rotation.set(0, 0, 0);
      a.model.root.visible = !p?.gone;
      a.tag.visible = !p?.gone;
      a.pos.copy(this.queueSpot(sim, i));
      a.model.root.position.copy(a.pos);
    });
  }

  hide(i: number) {
    const a = this.actors[i];
    if (a) a.model.root.visible = false;
  }

  pushed(j: number) {
    const p = this.plungers[j];
    if (!p) return;
    const at = p.root.position;
    for (let k = 0; k < 6; k++) this.puffs.spawn(at.x + (Math.random() - 0.5), 0.2, at.z + (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 2, 1, (Math.random() - 0.5) * 2, 0.3, 0.5, '#f2f5ff');
  }

  fizzled(j: number) {
    const at = this.sparkAt(j, 0.55);
    for (let k = 0; k < 10; k++) this.puffs.spawn(at.x, 0.3, at.z, (Math.random() - 0.5) * 1.2, 1.2 + Math.random(), (Math.random() - 0.5) * 1.2, 0.3, 0.9, '#8a8590', -0.5);
  }

  boom(i: number) {
    this.crackerGone = 0;
    this.shake = 1.6;
    const c = new Vector3(0, 4, CRACKER_Z);
    for (let k = 0; k < 80; k++) {
      const a = Math.random() * Math.PI * 2;
      const up = Math.random();
      const s = 6 + Math.random() * 9;
      const col = k % 3 === 0 ? '#ffd23f' : k % 3 === 1 ? '#ff8a2a' : '#fff4dc';
      this.puffs.spawn(c.x, c.y, c.z, Math.cos(a) * s * (1 - up * 0.5), up * 12, Math.sin(a) * s * 0.6 + 2, 0.45 + Math.random() * 0.5, 0.9 + Math.random() * 0.7, col, 1.2);
    }
    for (let k = 0; k < 24; k++) this.puffs.spawn(c.x + (Math.random() - 0.5) * 3, 1 + Math.random() * 4, c.z, (Math.random() - 0.5) * 2, 2 + Math.random() * 2, Math.random() * 2, 1.1, 2.4, '#4a4450', -0.4);
    for (let k = 0; k < 3; k++) this.firework(-6 + k * 6, 13 + Math.random() * 3, -18, 70);
    const a = this.actors[i];
    if (!a) return;
    a.blast = 0;
    a.from.copy(a.pos);
    a.tag.visible = false;
    this.benchSpot(a.bench);
  }

  /** The next free seat for a blasted pierogi: out at the sides, left and right in turn. */
  private benchSpot(out: Vector3) {
    const side = this.benchCount % 2 === 0 ? -1 : 1;
    const k = Math.floor(this.benchCount / 2);
    out.set(side * (7.2 + k * 1.4), 0, BENCH_Z + (k % 2) * 0.6);
    this.benchCount++;
  }

  toStage(x: number, y: number, z: number) {
    return this.stage.toStage(new Vector3(x, y, z));
  }

  /** Where the current pierogi stands over plunger j. */
  plungerTop(j: number) {
    const p = this.plungers[j];
    if (!p) return new Vector3();
    return new Vector3(p.root.position.x, HANDLE_UP - (HANDLE_UP - HANDLE_DOWN) * p.down, PLUNGER_Z);
  }

  private queueSpot(sim: BlastSim, i: number) {
    const live = sim.players.map((_, k) => k).filter((k) => !sim.players[k].gone && sim.players[k].alive);
    const k = live.indexOf(i);
    const n = Math.max(1, live.length);
    return new Vector3((Math.max(0, k) - (n - 1) / 2) * QUEUE_GAP, 0, QUEUE_Z - (k % 2) * 0.35);
  }

  private sparkAt(j: number, f: number) {
    const { a, b } = this.wireEnds(j);
    return a.lerp(b, f);
  }

  private snowflake(age = 0) {
    const x = (Math.random() - 0.5) * 50;
    const z = -20 + Math.random() * 28;
    const y = 16 - age * 1.6;
    this.snow.spawn(x, y, z, (Math.random() - 0.5) * 0.4, -1.6, 0, 0.09 + Math.random() * 0.06, 10 - age, '#ffffff', 0);
  }

  private firework(x: number, y: number, z: number, n = 46) {
    const col = FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)];
    const col2 = FIREWORK_COLORS[Math.floor(Math.random() * FIREWORK_COLORS.length)];
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const e = Math.acos(2 * Math.random() - 1);
      const s = 5 + Math.random() * 2;
      this.sky.spawn(x, y, z, Math.sin(e) * Math.cos(a) * s, Math.cos(e) * s, Math.sin(e) * Math.sin(a) * s, 0.28, 1.2 + Math.random() * 0.6, k % 3 ? col : col2, 0);
    }
  }

  // ---- drawing ----------------------------------------------------------------------------------------
  render(sim: BlastSim, dt: number) {
    this.time += dt;
    if (sim.set !== this.shownSet && sim.plungers.length) {
      this.shownSet = sim.set;
      this.buildPlungers(sim.plungers.length);
      if (this.crackerGone >= 0) {
        this.crackerGone = -1;
        this.cracker.visible = true;
      }
    }
    const setupK = sim.phase === 'setup' ? smooth(sim.phaseT / SETUP_TIME) : 1;

    // Plungers: rise up for a new set, pushed ones stay down.
    this.plungers.forEach((p, j) => {
      const s = sim.plungers[j];
      const target = s?.used ? 1 : 0;
      p.down += (target - p.down) * Math.min(1, dt * 16);
      p.handle.position.y = 0.6 - 0.5 * p.down;
      p.root.scale.set(1, Math.max(0.01, setupK), 1);
      p.boxMat.color.set(s?.dud ? '#5a4a48' : s?.used ? '#6e3a30' : '#b5412e');
      p.root.visible = !s?.dud;
      p.wire.visible = !s?.dud;
    });

    // The firecracker drops back in for a new set after a blast.
    if (sim.phase === 'setup' && sim.set > 1) {
      const t = Math.min(1, sim.phaseT / (SETUP_TIME * 0.8));
      this.cracker.position.y = 14 * (1 - t) * (1 - t);
    } else if (this.crackerGone < 0) this.cracker.position.y = 0;
    if (this.crackerGone >= 0) {
      this.crackerGone += dt;
      const t = this.crackerGone;
      this.cracker.visible = t < 0.12;
      this.cracker.scale.setScalar(1 + t * 3);
      this.flash.intensity = 60 * Math.max(0, 1 - t / 0.8);
    } else {
      this.cracker.scale.setScalar(1);
      this.flash.intensity = 0;
    }

    // The cursor and the spark.
    const cur = sim.current;
    const choosing = sim.phase === 'choose' && cur >= 0;
    this.cursorRing.visible = this.arrow.visible = choosing || sim.phase === 'fuse';
    if (cur >= 0 && this.plungers[sim.cursor]) {
      const at = this.plungers[sim.cursor].root.position;
      this.cursorRing.position.x += (at.x - this.cursorRing.position.x) * Math.min(1, dt * 18);
      this.cursorRing.position.z = PLUNGER_Z;
      const look = this.actors[cur];
      if (look) this.cursorMat.color.copy(look.colors[0]);
      this.arrow.position.set(this.cursorRing.position.x, 4.0 + Math.sin(this.time * 6) * 0.15, PLUNGER_Z);
      this.cursorRing.scale.setScalar(1 + Math.sin(this.time * 8) * 0.06);
    }
    const fusing = sim.phase === 'fuse' && sim.pushed >= 0;
    this.spark.visible = fusing && (sim.pushed === sim.bomb || sim.phaseT / FUSE_TIME < 0.55);
    if (fusing) {
      const live = sim.pushed === sim.bomb;
      const f = live ? sim.phaseT / FUSE_TIME : Math.min(0.55, sim.phaseT / FUSE_TIME);
      const at = this.sparkAt(sim.pushed, f);
      this.spark.position.copy(at);
      this.spark.scale.setScalar(1 + Math.sin(this.time * 40) * 0.3);
      if (this.spark.visible && Math.random() < 0.9)
        this.puffs.spawn(at.x, at.y + 0.1, at.z, (Math.random() - 0.5) * 3, 1 + Math.random() * 2.5, (Math.random() - 0.5) * 3, 0.1, 0.35, Math.random() < 0.5 ? '#ffd23f' : '#ff8a2a', 0);
    }

    // Pierogi.
    this.actors.forEach((a, i) => {
      const sp = sim.players[i];
      if (!sp || sp.gone) return;
      const root = a.model.root;
      const body = a.model.body;
      if (a.blast >= 0 || (!sp.alive && sp.outAt !== null)) {
        if (a.blast < 0) {
          // Already out when this screen started drawing: straight to the bench.
          a.blast = BOOM_TIME;
          this.benchSpot(a.bench);
          a.from.copy(a.bench);
        }
        a.blast += dt;
        // Up into the sky, spinning, and down onto the bench at the side, covered in soot.
        const flight = 1.6;
        const t = Math.min(1, Math.max(0, a.blast - 0.05) / flight);
        const p = a.from.clone().lerp(a.bench, smooth(t));
        p.y = Math.sin(t * Math.PI) * 11 + a.from.y * (1 - t);
        root.position.copy(p);
        a.spin += dt * 14 * (1 - t);
        body.rotation.set(a.spin, 0, a.spin * 0.4);
        if (t >= 1) {
          body.rotation.set(-0.15, 0, 0.25);
          body.scale.set(1.1, 0.8, 1.1);
        }
        const soot = Math.min(1, a.blast * 4);
        a.model.mats.slice(0, 2).forEach((m, k) => (m as MeshLambertMaterial).color.copy(a.colors[k]).lerp(SOOT, soot * 0.7));
        if (t < 1 && Math.random() < 0.6) this.puffs.spawn(p.x, p.y, p.z, 0, 0.5, 0, 0.35, 0.8, '#4a4450', -0.3);
        if (t >= 1 && Math.random() < dt * 2) this.puffs.spawn(p.x, p.y + 1, p.z, 0, 0.6, 0, 0.25, 1.2, '#6a6470', -0.5);
        a.pos.copy(p);
        return;
      }
      let target: Vector3;
      if (i === cur && (sim.phase === 'choose' || sim.phase === 'fuse' || sim.phase === 'safe')) target = this.plungerTop(sim.cursor);
      else target = this.queueSpot(sim, i);
      const dist = a.pos.distanceTo(target);
      a.pos.lerp(target, Math.min(1, dt * (dist > 3 ? 7 : 11)));
      // A little hop while moving.
      const hop = dist > 0.08 ? Math.abs(Math.sin(this.time * 14)) * Math.min(0.5, dist * 0.4) : 0;
      root.position.set(a.pos.x, a.pos.y + hop, a.pos.z);
      root.rotation.y = 0;
      let sy = 1;
      let sxz = 1;
      if (i === cur && sim.phase === 'fuse') {
        // Pushing down, then shaking with nerves while the spark runs.
        const k = Math.min(1, sim.phaseT / 0.15);
        sy = 1 - 0.25 * Math.sin(k * Math.PI);
        body.rotation.z = Math.sin(this.time * 40) * 0.05;
      } else if (i === cur && sim.phase === 'safe') {
        // Phew!
        const k = Math.min(1, sim.phaseT / 0.5);
        root.position.y += Math.sin(k * Math.PI) * 0.7;
        body.rotation.z = 0;
      } else if (i === cur && sim.phase === 'choose') {
        // Fidgeting.
        body.rotation.z = Math.sin(this.time * 5) * 0.08;
        sy = 1 + Math.sin(this.time * 10) * 0.03;
      } else {
        body.rotation.z = Math.sin(this.time * 2 + i) * 0.04;
      }
      body.scale.set(sxz, sy, sxz);
      a.tag.visible = true;
    });

    // Ambient fireworks over the rooftops, snow, tree lights.
    this.nextFirework -= dt;
    if (this.nextFirework <= 0) {
      this.nextFirework = 1.2 + Math.random() * 2.2;
      this.firework((Math.random() - 0.5) * 40, 12 + Math.random() * 6, -24 - Math.random() * 6);
    }
    if (Math.random() < dt * 22) this.snowflake();
    this.bulbs.forEach((b, k) => (b.visible = Math.sin(this.time * 3 + k * 1.7) > -0.4));
    this.puffs.update(dt);
    this.sky.update(dt);
    this.snow.update(dt);

    // Camera: the plungers in front, the firecracker behind, the sky above.
    const stage = this.stage;
    const target = new Vector3(0, 2.6, -2.2);
    stage.lookAt(target, this.dist, 0.36);
    if (this.shake > 0.01) {
      stage.camera.position.x += (Math.random() - 0.5) * this.shake * 0.8;
      stage.camera.position.y += (Math.random() - 0.5) * this.shake * 0.8;
      this.shake *= Math.exp(-4 * dt);
    }
    stage.render();
  }

  dispose() {
    this.stage.dispose();
  }
}
