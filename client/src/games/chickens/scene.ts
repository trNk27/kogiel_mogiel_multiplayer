/**
 * Kurnik in 3D: a fenced farmyard on a sunny afternoon. A little coop for every player stands on the
 * fence, painted in their colour with their name on a sign; a well, a hay cart, a muddy puddle and a
 * dog kennel stand in the yard, and low-poly hens peck about and flap away from the pierogi.
 * Same PS2 look as the other arena games.
 */
import {
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  NearestFilter,
  PlaneGeometry,
  SphereGeometry,
  SRGBColorSpace,
  Vector3,
  type BufferGeometry,
  type Material,
  type Sprite,
} from 'three';
import { ArenaStage, blobShadow, box, buildPierogi, flat, groundTexture, nameTag, type PierogiModel } from '../arena/kit';
import { buildBabcia } from '../arena/babcia';
import { Puffs } from '../arena/puffs';
import { mulberry32 } from '../rng';
import {
  DOG,
  GATE_W,
  GATE_X,
  HALF_D,
  HALF_W,
  LUNGE_T,
  OBSTACLES,
  PUDDLE,
  type ChickEvent,
  type ChickSim,
  type Coop,
  type Hen,
  type HenKind,
} from './logic';

export interface PlayerLook {
  name: string;
  color: string;
}

type Keep = <T extends { dispose(): void }>(x: T) => T;

/** Hens are drawn a bit bigger than life, so they read from the sofa. */
const HEN_SCALE = 1.35;

const FEATHER: Record<HenKind, string> = { white: '#f7f0e2', brown: '#a85d2e', gold: '#ffc531' };

interface HenModel {
  root: Group;
  body: Group;
  head: Group;
  wings: Group[];
  legs: Mesh[];
  shadow: Mesh;
}

interface HenActor {
  model: HenModel;
  kind: HenKind;
  /** Walk cycle phase. */
  step: number;
  /** Flight into a coop: seconds since it started, and where it goes. -1: not delivering. */
  home: number;
  from: Vector3;
  to: Vector3;
  last: Vector3;
  seed: number;
}

interface Actor {
  model: PierogiModel;
  tag: Sprite;
  color: string;
  step: number;
  /** Seconds since the last shove hit this player (-1: none). */
  hit: number;
  hitDir: number;
}

const smooth = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

/** Shared meshes for the hens: built once, reused by every bird. */
class HenKit {
  readonly body: BufferGeometry;
  readonly head: BufferGeometry;
  readonly beak: BufferGeometry;
  readonly comb: BufferGeometry;
  readonly tail: BufferGeometry;
  readonly wing: BufferGeometry;
  readonly leg: BufferGeometry;
  readonly eye: BufferGeometry;
  readonly feathers: Record<HenKind, Material>;
  readonly dark: Record<HenKind, Material>;
  readonly red: Material;
  readonly orange: Material;
  readonly black: Material;

  constructor(keep: Keep) {
    this.body = keep(new SphereGeometry(0.32, 7, 5));
    this.head = keep(new SphereGeometry(0.16, 6, 4));
    this.beak = keep(new ConeGeometry(0.06, 0.16, 4));
    this.beak.rotateX(Math.PI / 2);
    this.comb = keep(new SphereGeometry(0.07, 4, 3));
    this.tail = keep(new ConeGeometry(0.16, 0.34, 4));
    this.wing = keep(new SphereGeometry(0.2, 5, 3));
    this.leg = keep(new CylinderGeometry(0.025, 0.025, 0.24, 4));
    this.eye = keep(new SphereGeometry(0.03, 4, 2));
    const mk = (k: HenKind, mul: number) => {
      const c = new Color(FEATHER[k]).multiplyScalar(mul).getStyle();
      return keep(new MeshLambertMaterial({ color: c, flatShading: true, emissive: k === 'gold' ? '#6a4300' : '#000000' }));
    };
    this.feathers = { white: mk('white', 1), brown: mk('brown', 1), gold: mk('gold', 1) };
    this.dark = { white: mk('white', 0.86), brown: mk('brown', 0.75), gold: mk('gold', 0.85) };
    this.red = keep(flat('#e0302a'));
    this.orange = keep(flat('#f5a020'));
    this.black = keep(new MeshBasicMaterial({ color: '#1d0f0a' }));
  }

  /** A hen, facing +z, about 0.75 m tall. */
  build(kind: HenKind): HenModel {
    const root = new Group();
    const body = new Group();
    const f = this.feathers[kind];
    const d = this.dark[kind];
    const torso = new Mesh(this.body, f);
    torso.scale.set(0.95, 0.85, 1.15);
    torso.position.y = 0.42;
    const tail = new Mesh(this.tail, d);
    tail.position.set(0, 0.6, -0.33);
    tail.rotation.x = -0.75;
    const head = new Group();
    head.position.set(0, 0.7, 0.24);
    const skull = new Mesh(this.head, f);
    const beak = new Mesh(this.beak, this.orange);
    beak.position.set(0, -0.02, 0.17);
    const comb1 = new Mesh(this.comb, this.red);
    comb1.position.set(0, 0.15, 0.02);
    comb1.scale.set(0.6, 1, 1.4);
    const wattle = new Mesh(this.comb, this.red);
    wattle.position.set(0, -0.1, 0.11);
    wattle.scale.set(0.5, 0.9, 0.5);
    head.add(skull, beak, comb1, wattle);
    for (const x of [-0.1, 0.1]) {
      const e = new Mesh(this.eye, this.black);
      e.position.set(x, 0.04, 0.11);
      head.add(e);
    }
    const wings: Group[] = [];
    for (const s of [-1, 1]) {
      const pivot = new Group();
      pivot.position.set(0.27 * s, 0.5, 0);
      const w = new Mesh(this.wing, d);
      w.scale.set(0.25, 0.75, 1.2);
      w.position.set(0.03 * s, -0.08, -0.02);
      pivot.add(w);
      body.add(pivot);
      wings.push(pivot);
    }
    const legs: Mesh[] = [];
    for (const x of [-0.1, 0.1]) {
      const l = new Mesh(this.leg, this.orange);
      l.position.set(x, 0.12, 0.02);
      body.add(l);
      legs.push(l);
    }
    body.add(torso, tail, head);
    root.add(body);
    const shadow = blobShadow(0.36, 0.3);
    root.add(shadow);
    return { root, body, head, wings, legs, shadow };
  }
}

/** A sign board with a name painted on it. */
function signBoard(keep: Keep, text: string, color: string) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 40;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#f3e3c0';
  ctx.fillRect(0, 0, 128, 40);
  ctx.fillStyle = 'rgba(90,50,20,.25)';
  ctx.fillRect(0, 13, 128, 1);
  ctx.fillRect(0, 27, 128, 1);
  ctx.strokeStyle = '#5a3418';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, 124, 36);
  ctx.font = '800 25px "Fraunces Variable", Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let size = 25;
  while (size > 12 && ctx.measureText(text).width > 112) {
    size--;
    ctx.font = `800 ${size}px "Fraunces Variable", Georgia, serif`;
  }
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#2a120a';
  ctx.strokeText(text, 64, 21);
  ctx.fillStyle = color;
  ctx.fillText(text, 64, 21);
  const t = keep(new CanvasTexture(c));
  t.magFilter = t.minFilter = NearestFilter;
  t.colorSpace = SRGBColorSpace;
  return new Mesh(keep(new PlaneGeometry(1.9, 0.6)), keep(new MeshBasicMaterial({ map: t })));
}

export class ChickScene {
  readonly stage: ArenaStage;
  private actors: Actor[] = [];
  private hens = new Map<number, HenActor>();
  private kit: HenKit;
  private puffs = new Puffs(260, 3.5, 2);
  private coopDoors: Group[] = [];
  private coopRoots: Group[] = [];
  private coopBump: number[] = [];
  private dog!: { root: Group; head: Group; tail: Group; bark: number };
  private babcia!: PierogiModel;
  private gate: Group[] = [];
  private gateOpen = 0;
  private sunflowers: Group[] = [];
  private time = 0;
  private shake = 0;

  constructor(
    canvas: HTMLCanvasElement,
    looks: PlayerLook[],
    private coops: Coop[],
  ) {
    this.stage = new ArenaStage(canvas, { sky: '#a8d8f0', fog: [55, 130], fov: 36 });
    const keep: Keep = (x) => this.stage.keep(x);
    this.kit = new HenKit(keep);
    this.buildYard(keep);
    this.buildCoops(keep, looks);
    this.stage.add(this.puffs.mesh);
    looks.forEach((l) => {
      const model = buildPierogi(l.color);
      model.mats.forEach((m) => keep(m));
      const tag = nameTag(l.name, l.color);
      tag.position.set(0, 3.4, 0);
      tag.scale.set(2.8, 0.7, 1);
      model.root.scale.setScalar(0.95);
      model.root.add(tag);
      this.stage.add(model.root);
      this.actors.push({ model, tag, color: l.color, step: 0, hit: -1, hitDir: 0 });
    });
  }

  // ---- scenery ----------------------------------------------------------------------------------
  private buildYard(keep: Keep) {
    const stage = this.stage;
    const grass = keep(groundTexture('grass', 26, 5));
    const g = keep(new PlaneGeometry(160, 110));
    g.rotateX(-Math.PI / 2);
    const ground = new Mesh(g, keep(flat('#ffffff', { map: grass })));
    ground.position.set(0, -0.01, -12);
    stage.add(ground);
    // The trodden dirt of the yard.
    const dirt = keep(groundTexture('sand', 12, 11));
    const yg = keep(new PlaneGeometry(HALF_W * 2, HALF_D * 2));
    yg.rotateX(-Math.PI / 2);
    const yard = new Mesh(yg, keep(flat('#c79a68', { map: dirt })));
    yard.position.y = 0.005;
    stage.add(yard);
    // A path out of the gate.
    const pg = keep(new PlaneGeometry(GATE_W + 0.6, 10));
    pg.rotateX(-Math.PI / 2);
    const path = new Mesh(pg, keep(flat('#c79a68', { map: dirt })));
    path.position.set(GATE_X, 0.004, HALF_D + 5);
    stage.add(path);

    // The fence: posts and two rails, with gaps for the coop doors and the gate.
    const wood = keep(flat('#9a6a3e'));
    const woodDark = keep(flat('#7a5030'));
    const postGeo = keep(new CylinderGeometry(0.11, 0.13, 1.25, 5));
    const gaps: { edge: 'L' | 'B' | 'R' | 'F'; at: number; w: number }[] = this.coops.map((c) => ({ edge: c.edge, at: c.edge === 'B' ? c.x : c.z, w: 2.4 }));
    gaps.push({ edge: 'F', at: GATE_X, w: GATE_W });
    const run = (edge: 'L' | 'B' | 'R' | 'F', from: number, to: number) => {
      const segs: [number, number][] = [];
      let start = from;
      const mine = gaps.filter((g) => g.edge === edge).sort((a, b) => a.at - b.at);
      for (const gp of mine) {
        segs.push([start, gp.at - gp.w / 2]);
        start = gp.at + gp.w / 2;
      }
      segs.push([start, to]);
      for (const [a, b] of segs) {
        const len = b - a;
        if (len < 0.2) continue;
        const mid = (a + b) / 2;
        const place = (m: Mesh, t: number, y: number) => {
          if (edge === 'L' || edge === 'R') {
            m.position.set(edge === 'L' ? -HALF_W : HALF_W, y, t);
          } else m.position.set(t, y, edge === 'B' ? -HALF_D : HALF_D);
        };
        for (const y of [0.45, 0.95]) {
          const r = edge === 'L' || edge === 'R' ? box(0.08, 0.14, len, woodDark) : box(len, 0.14, 0.08, woodDark);
          place(r, mid, y);
          stage.add(r);
        }
        const posts = Math.max(1, Math.round(len / 1.6));
        for (let k = 0; k <= posts; k++) {
          const p = new Mesh(postGeo, wood);
          place(p, a + (len * k) / posts, 0.62);
          stage.add(p);
        }
      }
    };
    run('L', -HALF_D, HALF_D);
    run('R', -HALF_D, HALF_D);
    run('B', -HALF_W, HALF_W);
    run('F', -HALF_W, HALF_W);
    // The gate: two leaves swung open outwards.
    for (const s of [-1, 1]) {
      const hinge = new Group();
      hinge.position.set(GATE_X + (s * GATE_W) / 2, 0, HALF_D);
      const leaf = new Group();
      for (const y of [0.35, 0.8]) {
        const r = box(GATE_W / 2 - 0.1, 0.12, 0.07, wood);
        r.position.set((-s * (GATE_W / 2 - 0.1)) / 2, y, 0);
        leaf.add(r);
      }
      const diag = box(0.08, 0.12, 1.5, woodDark);
      diag.rotation.y = Math.PI / 2 - s * 0.3;
      diag.rotation.z = 0;
      diag.position.set((-s * (GATE_W / 2 - 0.1)) / 2, 0.58, 0);
      diag.scale.set(1, 1, 0.95);
      leaf.add(diag);
      hinge.add(leaf);
      stage.add(hinge);
      this.gate.push(hinge);
    }

    // The well.
    const stone = keep(flat('#a49a8c'));
    const wellAt = OBSTACLES.find((o) => o.what === 'well')!;
    const well = new Group();
    const ring = new Mesh(keep(new CylinderGeometry(1.25, 1.35, 1.0, 10)), stone);
    ring.position.y = 0.5;
    const water = new Mesh(keep(new CylinderGeometry(1.0, 1.0, 0.05, 10)), keep(flat('#2e5f86')));
    water.position.y = 0.92;
    const posts = [-1.05, 1.05].map((x) => {
      const p = box(0.18, 2.5, 0.18, wood);
      p.position.set(x, 0, 0);
      return p;
    });
    const beam = new Mesh(keep(new CylinderGeometry(0.1, 0.1, 2.3, 6)), woodDark);
    beam.rotation.z = Math.PI / 2;
    beam.position.y = 2.0;
    const wroof = new Mesh(keep(new ConeGeometry(1.85, 1.0, 4)), keep(flat('#b0473a')));
    wroof.rotation.y = Math.PI / 4;
    wroof.scale.z = 0.6;
    wroof.position.y = 2.9;
    const bucket = new Mesh(keep(new CylinderGeometry(0.26, 0.2, 0.36, 7)), wood);
    bucket.position.set(0, 1.55, 0);
    well.add(ring, water, ...posts, beam, wroof, bucket);
    well.position.set(wellAt.x, 0, wellAt.z);
    stage.add(well);

    // The hay cart.
    const carts = OBSTACLES.filter((o) => o.what === 'cart');
    const cx = (carts[0].x + carts[1].x) / 2;
    const cz = carts[0].z;
    const cart = new Group();
    const bed = box(3.4, 0.25, 1.9, wood);
    bed.position.y = 0.75;
    const sideA = box(3.4, 0.4, 0.1, woodDark);
    sideA.position.set(0, 1.0, 0.92);
    const sideB = sideA.clone();
    sideB.position.z = -0.92;
    const hay = keep(flat('#e3c06a'));
    const hayLoad = new Mesh(keep(new SphereGeometry(1, 7, 4)), hay);
    hayLoad.scale.set(1.75, 0.8, 0.95);
    hayLoad.position.y = 1.2;
    const wheelGeo = keep(new CylinderGeometry(0.55, 0.55, 0.14, 10));
    for (const [x, z] of [
      [-1.0, 1.02],
      [-1.0, -1.02],
      [1.0, 1.02],
      [1.0, -1.02],
    ] as const) {
      const w = new Mesh(wheelGeo, woodDark);
      w.rotation.x = Math.PI / 2;
      w.position.set(x, 0.55, z);
      cart.add(w);
    }
    for (const z of [-0.5, 0.5]) {
      const shaft = box(1.8, 0.1, 0.1, wood);
      shaft.position.set(-2.5, 0.55, z);
      shaft.rotation.z = -0.25;
      cart.add(shaft);
    }
    cart.add(bed, sideA, sideB, hayLoad);
    cart.position.set(cx, 0, cz);
    stage.add(cart);
    // Loose hay round it.
    const tuftGeo = keep(new SphereGeometry(0.35, 5, 3));
    const rnd = mulberry32(23);
    for (let k = 0; k < 6; k++) {
      const t = new Mesh(tuftGeo, hay);
      t.scale.set(1.2, 0.35, 1);
      t.position.set(cx + (rnd() - 0.5) * 5, 0.05, cz + 1.3 + rnd() * 1.2 * (k % 2 ? 1 : -2.2));
      stage.add(t);
    }

    // The puddle: dark, shiny mud.
    const pud = new Mesh(keep(new CylinderGeometry(1, 1, 0.02, 16)), keep(flat('#5b7f96', { transparent: true, opacity: 0.82 })));
    pud.scale.set(PUDDLE.rx, 1, PUDDLE.rz);
    pud.position.set(PUDDLE.x, 0.02, PUDDLE.z);
    const rim = new Mesh(keep(new CylinderGeometry(1, 1, 0.015, 16)), keep(flat('#7a5532')));
    rim.scale.set(PUDDLE.rx + 0.35, 1, PUDDLE.rz + 0.3);
    rim.position.set(PUDDLE.x, 0.012, PUDDLE.z);
    const shine = box(0.9, 0.01, 0.12, keep(new MeshBasicMaterial({ color: '#d8eef8' })));
    shine.position.set(PUDDLE.x - 0.6, 0.035, PUDDLE.z - 0.4);
    shine.rotation.y = 0.3;
    stage.add(rim, pud, shine);

    // The dog kennel and the dog on its chain.
    const kAt = OBSTACLES.find((o) => o.what === 'kennel')!;
    const kennel = new Group();
    const kb = box(1.5, 1.0, 1.3, keep(flat('#8f5c34')));
    const kroof = new Mesh(keep(new ConeGeometry(1.25, 0.75, 4)), keep(flat('#b0473a')));
    kroof.rotation.y = Math.PI / 4;
    kroof.scale.z = 0.8;
    kroof.position.y = 1.35;
    const hole = new Mesh(keep(new CylinderGeometry(0.32, 0.32, 0.05, 8, 1, false, 0, Math.PI)), keep(new MeshBasicMaterial({ color: '#1d0f0a' })));
    hole.rotation.set(0, 0, Math.PI / 2);
    hole.position.set(-0.76, 0.03, 0);
    kennel.add(kb, kroof, hole);
    kennel.position.set(kAt.x, 0, kAt.z);
    stage.add(kennel);
    const bowl = new Mesh(keep(new CylinderGeometry(0.25, 0.18, 0.14, 8)), keep(flat('#3568b8')));
    bowl.position.set(kAt.x - 1.2, 0.07, kAt.z + 1.0);
    stage.add(bowl);
    const dogRoot = new Group();
    const fur = keep(flat('#c08850'));
    const furDark = keep(flat('#6a4426'));
    const torso = new Mesh(keep(new SphereGeometry(0.4, 6, 4)), fur);
    torso.scale.set(0.8, 0.75, 1.3);
    torso.position.y = 0.55;
    const head = new Group();
    head.position.set(0, 0.85, 0.5);
    const skull = new Mesh(keep(new SphereGeometry(0.26, 6, 4)), fur);
    const snout = box(0.2, 0.16, 0.24, furDark);
    snout.position.set(0, -0.12, 0.22);
    const nose = new Mesh(keep(new SphereGeometry(0.05, 4, 2)), this.kit.black);
    nose.position.set(0, -0.02, 0.35);
    const earGeo = keep(new ConeGeometry(0.1, 0.25, 4));
    for (const x of [-0.17, 0.17]) {
      const ear = new Mesh(earGeo, furDark);
      ear.position.set(x, 0.2, -0.02);
      ear.rotation.z = -x * 2;
      head.add(ear);
      const eye = new Mesh(this.kit.eye, this.kit.black);
      eye.position.set(x * 0.6, 0.06, 0.22);
      head.add(eye);
    }
    head.add(skull, snout, nose);
    const tail = new Group();
    tail.position.set(0, 0.7, -0.5);
    const tm = box(0.08, 0.4, 0.08, fur);
    tm.position.y = 0;
    tail.add(tm);
    tail.rotation.x = -0.6;
    const legGeo = keep(new CylinderGeometry(0.07, 0.07, 0.35, 4));
    for (const [x, z] of [
      [-0.16, 0.3],
      [0.16, 0.3],
      [-0.16, -0.3],
      [0.16, -0.3],
    ] as const) {
      const l = new Mesh(legGeo, furDark);
      l.position.set(x, 0.18, z);
      dogRoot.add(l);
    }
    dogRoot.add(torso, head, tail, blobShadow(0.6, 0.3));
    dogRoot.position.set(DOG.x, 0, DOG.z);
    dogRoot.rotation.y = -Math.PI / 2 - 0.4;
    stage.add(dogRoot);
    this.dog = { root: dogRoot, head, tail, bark: 0 };

    // Outside the fence: a cottage, a barn, trees, sunflowers and Babcia scattering grain.
    const cottage = new Group();
    const wall = box(9, 3.4, 5.5, keep(flat('#f6efe2')));
    const base = box(9.2, 0.5, 5.7, keep(flat('#8a6f5a')));
    const roof = new Mesh(keep(new ConeGeometry(6.8, 3.4, 4)), keep(flat('#c9a05a')));
    roof.rotation.y = Math.PI / 4;
    roof.scale.set(1.0, 1, 0.62);
    roof.position.y = 3.4 + 1.6;
    const band = box(9.05, 0.25, 5.55, keep(flat('#cf3a2c')));
    band.position.y = 2.95;
    const blue = keep(flat('#3568b8'));
    const pane = keep(flat('#fff4c8'));
    for (const x of [-2.5, 0, 2.5]) {
      const w = box(1.1, 1.1, 0.1, pane);
      w.position.set(x, 1.3, 2.78);
      const s1 = box(0.45, 1.2, 0.08, blue);
      s1.position.set(x - 0.8, 1.25, 2.8);
      const s2 = s1.clone();
      s2.position.x = x + 0.8;
      cottage.add(w, s1, s2);
    }
    cottage.add(base, wall, band, roof);
    cottage.position.set(-9, 0, -HALF_D - 9);
    stage.add(cottage);
    const barn = new Group();
    const bw = box(8, 4.5, 6, keep(flat('#a8322a')));
    const broof = new Mesh(keep(new ConeGeometry(6.2, 3, 4)), keep(flat('#5a3a2a')));
    broof.rotation.y = Math.PI / 4;
    broof.scale.set(1, 1, 0.75);
    broof.position.y = 4.5 + 1.4;
    const bdoor = box(3, 3.2, 0.1, keep(flat('#f4ecdc')));
    bdoor.position.set(0, 0, 3.02);
    const bx1 = box(0.18, 3.6, 0.12, keep(flat('#a8322a')));
    bx1.rotation.z = 0.75;
    bx1.position.set(0, -0.2, 3.08);
    const bx2 = bx1.clone();
    bx2.rotation.z = -0.75;
    barn.add(bw, broof, bdoor, bx1, bx2);
    barn.position.set(10, 0, -HALF_D - 10);
    barn.rotation.y = -0.15;
    stage.add(barn);
    const trunk = keep(new CylinderGeometry(0.25, 0.35, 2, 5));
    const crown = keep(new ConeGeometry(2, 4.5, 6));
    const trunkMat = keep(flat('#6a4426'));
    const leaves = [keep(flat('#3f7a34')), keep(flat('#4f8a3a')), keep(flat('#356a2e'))];
    const trng = mulberry32(41);
    const treeAt: [number, number][] = [
      [-27, -14],
      [-22, -22],
      [-1, -26],
      [22, -24],
      [27, -12],
      [-28, 2],
      [28, 3],
      [-26, 13],
      [27, 14],
      [-19, -27],
      [3, -31],
    ];
    for (const [x, z] of treeAt) {
      const t = new Group();
      const tr = new Mesh(trunk, trunkMat);
      tr.position.y = 1;
      const s = 0.8 + trng() * 0.6;
      const cr = new Mesh(crown, leaves[Math.floor(trng() * 3)]);
      cr.position.y = 2 + 2.25 * s;
      cr.scale.setScalar(s);
      t.add(tr, cr);
      t.position.set(x, 0, z);
      stage.add(t);
    }
    // Sunflowers along the back, behind the coops.
    const stem = keep(new CylinderGeometry(0.06, 0.08, 1, 5));
    const stemMat = keep(flat('#4f8a2c'));
    const petals = keep(new CylinderGeometry(0.55, 0.55, 0.08, 10));
    const petalMat = keep(flat('#ffc72c'));
    const middle = keep(new CylinderGeometry(0.27, 0.27, 0.12, 8));
    const middleMat = keep(flat('#5a3418'));
    const srnd = mulberry32(17);
    for (let k = 0; k < 12; k++) {
      const x = -17 + k * 3 + srnd() * 1.2;
      const h = 2.4 + srnd() * 1.1;
      const f = new Group();
      const s = new Mesh(stem, stemMat);
      s.scale.y = h;
      s.position.y = h / 2;
      const headF = new Group();
      const p = new Mesh(petals, petalMat);
      p.rotation.x = Math.PI / 2;
      const m = new Mesh(middle, middleMat);
      m.rotation.x = Math.PI / 2;
      m.position.z = 0.05;
      headF.add(p, m);
      headF.position.y = h;
      headF.rotation.x = -0.2;
      f.add(s, headF);
      f.position.set(x, 0, -HALF_D - 4.2 - srnd() * 0.8);
      stage.add(f);
      this.sunflowers.push(headF);
    }
    this.babcia = buildBabcia(keep, '#cf3a2c');
    this.babcia.root.scale.setScalar(1.3);
    this.babcia.root.position.set(GATE_X + 4.2, 0, HALF_D + 2.6);
    this.babcia.root.rotation.y = Math.PI + 0.5;
    stage.add(this.babcia.root);
  }

  private buildCoops(keep: Keep, looks: PlayerLook[]) {
    const roofGeo = keep(new ConeGeometry(2.05, 1.2, 4));
    const legGeo = keep(new CylinderGeometry(0.09, 0.09, 0.5, 4));
    const black = keep(new MeshBasicMaterial({ color: '#24120c' }));
    const plank = keep(flat('#a5774a'));
    const straw = keep(flat('#e9cc72'));
    this.coops.forEach((c, i) => {
      const look = looks[i] ?? { name: '?', color: '#fff4dc' };
      const col = new Color(look.color);
      const paint = keep(flat(look.color));
      const roofMat = keep(flat(col.clone().multiplyScalar(0.55).getStyle()));
      const trim = keep(flat('#fbf0d9'));
      const root = new Group();
      const house = new Group();
      // On little legs, a painted box with a pointed roof, a dark doorway and a ramp down to the yard.
      for (const [x, z] of [
        [-1.0, -0.75],
        [1.0, -0.75],
        [-1.0, 0.75],
        [1.0, 0.75],
      ] as const) {
        const l = new Mesh(legGeo, plank);
        l.position.set(x, 0.25, z);
        house.add(l);
      }
      const body = box(2.4, 1.6, 1.8, paint);
      body.position.y = 0.5 + 0.8;
      const band = box(2.46, 0.14, 1.86, trim);
      band.position.y = 2.05;
      const roof = new Mesh(roofGeo, roofMat);
      roof.rotation.y = Math.PI / 4;
      roof.scale.set(1, 1, 0.78);
      roof.position.y = 2.1 + 0.6;
      const door = box(0.85, 1.0, 0.05, black);
      door.position.set(0, 0.55, 0.91);
      const frame = box(1.05, 0.12, 0.08, trim);
      frame.position.set(0, 1.6, 0.92);
      const ramp = box(0.8, 0.06, 1.3, plank);
      ramp.position.set(0, 0.25, 1.45);
      ramp.rotation.x = 0.4;
      const strawPile = new Mesh(keep(new SphereGeometry(0.5, 5, 3)), straw);
      strawPile.scale.set(1.2, 0.3, 0.8);
      strawPile.position.set(0.0, 0.58, 0.85);
      const sign = signBoard(keep, look.name, look.color);
      sign.position.set(0, 2.45, 0.73);
      sign.rotation.x = -0.12;
      // A round window under the roof.
      const win = new Mesh(keep(new CylinderGeometry(0.2, 0.2, 0.05, 8)), black);
      win.rotation.x = Math.PI / 2;
      win.position.set(0.75, 1.55, 0.91);
      house.add(body, band, roof, door, frame, ramp, strawPile, win);
      root.add(house, sign);
      // A doormat in the player's colour, inside the fence: the spot to walk into.
      const mat = new Mesh(keep(new CylinderGeometry(1.25, 1.25, 0.02, 14)), keep(new MeshBasicMaterial({ color: look.color, transparent: true, opacity: 0.35, depthWrite: false })));
      mat.position.set(0, 0.02, 1.4 + 0.7);
      root.add(mat);
      root.position.set(c.x, 0, c.z);
      root.rotation.y = Math.atan2(c.nx, c.nz);
      this.stage.add(root);
      this.coopRoots.push(root);
      this.coopDoors.push(house);
      this.coopBump.push(-1);
    });
  }

  // ---- hens ---------------------------------------------------------------------------------------
  private henActor(h: Hen) {
    let a = this.hens.get(h.id);
    if (!a) {
      const model = this.kit.build(h.kind);
      model.root.scale.setScalar(h.kind === 'gold' ? HEN_SCALE * 1.1 : HEN_SCALE);
      this.stage.add(model.root);
      a = { model, kind: h.kind, step: Math.random() * 6, home: -9, from: new Vector3(), to: new Vector3(), last: new Vector3(h.x, h.y, h.z), seed: Math.random() * 100 };
      this.hens.set(h.id, a);
    }
    return a;
  }

  /** Reset for a new round: every hen is new, every coop shut. */
  reset() {
    for (const a of this.hens.values()) this.stage.world.remove(a.model.root);
    this.hens.clear();
    this.actors.forEach((a) => {
      a.hit = -1;
      a.model.body.rotation.set(0, 0, 0);
      a.model.body.position.set(0, 0, 0);
      a.model.body.scale.set(1, 1, 1);
    });
  }

  hide(i: number) {
    const a = this.actors[i];
    if (a) a.model.root.visible = false;
  }

  feathers(x: number, y: number, z: number, kind: HenKind, n = 10, power = 1) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const s = (1 + Math.random() * 2) * power;
      this.puffs.spawn(x, y, z, Math.cos(a) * s, 1.2 + Math.random() * 2.2 * power, Math.sin(a) * s, 0.13 + Math.random() * 0.1, 0.9 + Math.random() * 0.5, k % 3 === 0 ? '#fff8ec' : FEATHER[kind], 0.3);
    }
  }

  events(ev: ChickEvent[], sim: ChickSim) {
    for (const e of ev) {
      switch (e.t) {
        case 'grab': {
          const p = sim.players[e.p];
          this.feathers(p.x, 1.2, p.z, e.kind, 6, 0.6);
          break;
        }
        case 'deliver': {
          const c = this.coops[e.p];
          e.hens.forEach((id, k) => {
            const a = this.hens.get(id);
            if (!a) return;
            a.home = -k * 0.1;
            a.from.copy(a.model.root.position);
            a.to.set(c.x + c.nx * 0.6, 0.6, c.z + c.nz * 0.6);
          });
          this.coopBump[e.p] = 0;
          break;
        }
        case 'shove': {
          const p = sim.players[e.p];
          const a = this.actors[e.p];
          if (a) {
            a.hit = 0;
            a.hitDir = Math.atan2(p.vx, p.vz);
          }
          this.shake = Math.min(1, this.shake + (e.dropped.length ? 0.55 : 0.3));
          for (let k = 0; k < 8; k++) {
            const ang = (k / 8) * Math.PI * 2;
            this.puffs.spawn(p.x, 0.5, p.z, Math.cos(ang) * 3, 1.5 + Math.random(), Math.sin(ang) * 3, 0.32, 0.55, '#e6cf9f', 1.2);
          }
          for (const id of e.dropped) {
            const h = sim.hen(id);
            if (h) this.feathers(h.x, h.y, h.z, h.kind, 8, 1);
          }
          break;
        }
        case 'drop':
          for (const id of e.hens) {
            const h = sim.hen(id);
            if (h) this.feathers(h.x, h.y, h.z, h.kind, 8, 1);
          }
          break;
        case 'lunge': {
          const p = sim.players[e.p];
          for (let k = 0; k < 5; k++) this.puffs.spawn(p.x - p.fx * 0.5 + (Math.random() - 0.5) * 0.6, 0.15, p.z - p.fz * 0.5, -p.fx * 2, 0.8, -p.fz * 2, 0.3, 0.45, '#dcc597');
          break;
        }
        case 'hop': {
          const h = sim.hen(e.hen);
          if (h) this.feathers(h.x, 0.5, h.z, h.kind, 3, 0.5);
          break;
        }
        case 'land': {
          const h = sim.hen(e.hen);
          if (h) for (let k = 0; k < 3; k++) this.puffs.spawn(h.x, 0.08, h.z, (Math.random() - 0.5) * 1.5, 0.4, (Math.random() - 0.5) * 1.5, 0.18, 0.4, '#dcc597');
          break;
        }
        case 'spawn':
          this.gateOpen = 1.2;
          break;
        default:
          break;
      }
    }
  }

  /** Where a world point is on the 1920×1080 stage. */
  toStage(x: number, y: number, z: number) {
    return this.stage.toStage(new Vector3(x, y, z));
  }

  // ---- drawing ------------------------------------------------------------------------------------
  render(sim: ChickSim, dt: number) {
    this.time += dt;
    const t = this.time;

    // Pierogi.
    this.actors.forEach((ac, i) => {
      const p = sim.players[i];
      if (!p || p.gone) {
        ac.model.root.visible = false;
        return;
      }
      const root = ac.model.root;
      const body = ac.model.body;
      root.visible = true;
      root.position.set(p.x, 0, p.z);
      const sp = Math.hypot(p.vx, p.vz);
      const want = Math.atan2(p.fx, p.fz);
      let d = want - root.rotation.y;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      root.rotation.y += d * Math.min(1, dt * 14);
      ac.step += dt * (4 + sp * 2.2);
      const bob = Math.abs(Math.sin(ac.step)) * Math.min(1, sp / 3) * 0.16;
      body.position.y = bob;
      body.rotation.z = Math.sin(ac.step) * Math.min(1, sp / 3) * 0.1;
      body.rotation.x = p.lunge > 0 ? 0.45 * Math.sin((p.lunge / LUNGE_T) * Math.PI) + 0.25 : Math.min(0.15, sp * 0.02);
      body.scale.set(1, 1 - p.carry.length * 0.04, 1);
      if (p.stun > 0) {
        if (ac.hit < 0) ac.hit = 0;
        ac.hit += dt;
        body.rotation.y = ac.hit * 14;
        body.rotation.x = -0.25;
        if (Math.random() < dt * 6) this.puffs.spawn(p.x + (Math.random() - 0.5) * 0.8, 1.6, p.z, 0, 0.8, 0, 0.16, 0.5, '#fff4c8', 0.2);
      } else {
        ac.hit = -1;
        body.rotation.y = 0;
      }
      // Mud flies up when you skid through the puddle.
      if (sp > 2 && Math.abs((p.x - PUDDLE.x) / PUDDLE.rx) < 1 && Math.abs((p.z - PUDDLE.z) / PUDDLE.rz) < 1 && Math.random() < dt * 14)
        this.puffs.spawn(p.x, 0.1, p.z, -p.vx * 0.2 + (Math.random() - 0.5), 1.6, -p.vz * 0.2, 0.16, 0.5, '#6a5232');
      else if (sp > 4 && Math.random() < dt * 5) this.puffs.spawn(p.x, 0.08, p.z, -p.vx * 0.1, 0.4, -p.vz * 0.1, 0.2, 0.4, '#dcc597');
    });

    // Hens.
    const seen = new Set<number>();
    for (const h of sim.hens) {
      seen.add(h.id);
      const a = this.henActor(h);
      this.drawHen(a, h, sim, dt);
    }
    for (const [id, a] of this.hens) {
      if (seen.has(id)) continue;
      // Delivered: hop into the coop and vanish with a puff of feathers.
      if (a.home < -1.5) {
        a.home = 0;
        a.from.copy(a.model.root.position);
        a.to.copy(a.from);
      }
      a.home += dt;
      const k = Math.max(0, a.home) / 0.4;
      const r = a.model.root;
      if (k >= 1) {
        this.feathers(a.to.x, a.to.y + 0.4, a.to.z, a.kind, 10, 0.8);
        this.stage.world.remove(r);
        this.hens.delete(id);
        continue;
      }
      r.position.lerpVectors(a.from, a.to, smooth(k));
      r.position.y += Math.sin(k * Math.PI) * 1.2;
      r.scale.setScalar((a.kind === 'gold' ? HEN_SCALE * 1.1 : HEN_SCALE) * (1 - k * 0.6));
      a.model.wings.forEach((w, s) => (w.rotation.z = (s ? -1 : 1) * (0.4 + Math.sin(t * 40) * 0.7)));
      a.model.shadow.visible = false;
    }

    // Coops wobble when hens go in.
    this.coopDoors.forEach((house, i) => {
      if (this.coopBump[i] < 0) return;
      this.coopBump[i] += dt;
      const k = this.coopBump[i] / 0.5;
      if (k >= 1) {
        this.coopBump[i] = -1;
        house.scale.set(1, 1, 1);
        return;
      }
      const s = Math.sin(k * Math.PI) * 0.12 * (1 - k);
      house.scale.set(1 + s, 1 - s, 1 + s);
    });

    // The dog barks when someone comes close, and wags otherwise.
    const dog = this.dog;
    const near = sim.players.some((p) => !p.gone && Math.hypot(p.x - DOG.x, p.z - DOG.z) < 3.2);
    if (near) dog.bark += dt;
    else dog.bark = 0;
    const barking = near && Math.sin(dog.bark * 9) > 0.3;
    dog.root.position.y = barking ? 0.12 : 0;
    dog.head.rotation.x = barking ? -0.35 : Math.sin(t * 1.3) * 0.08;
    dog.tail.rotation.z = Math.sin(t * (near ? 18 : 9)) * 0.6;

    // The gate swings a little as a hen comes through.
    if (this.gateOpen > 0) this.gateOpen = Math.max(0, this.gateOpen - dt);
    const open = 1.25 + Math.sin(this.gateOpen * 9) * 0.12 * this.gateOpen;
    this.gate.forEach((g, k) => (g.rotation.y = (k === 0 ? 1 : -1) * open));

    // Babcia scatters grain.
    const bb = this.babcia;
    bb.body.rotation.z = Math.sin(t * 2.2) * 0.08;
    bb.body.position.y = Math.abs(Math.sin(t * 2.2)) * 0.05;
    if (Math.random() < dt * 4) {
      const bp = bb.root.position;
      this.puffs.spawn(bp.x - 0.9, 1.1, bp.z - 0.6, -1.2 - Math.random(), 1.5, -1.5 - Math.random(), 0.08, 0.8, '#f2d36a', 0);
    }
    this.sunflowers.forEach((h, i) => (h.rotation.z = Math.sin(t * 1.3 + i) * 0.08));
    this.puffs.update(dt);

    // Camera: the whole yard from the front, a little above.
    const stage = this.stage;
    stage.lookAt(new Vector3(0, 0, -1.6), 39, 1.0);
    if (this.shake > 0.01) {
      stage.camera.position.x += (Math.random() - 0.5) * this.shake * 0.5;
      stage.camera.position.y += (Math.random() - 0.5) * this.shake * 0.5;
      this.shake *= Math.exp(-7 * dt);
    }
    stage.render();
  }

  private drawHen(a: HenActor, h: Hen, sim: ChickSim, dt: number) {
    const m = a.model;
    const r = m.root;
    const t = this.time + a.seed;
    // Carried hens sit in a stack on the pierogi's head (spaced for their drawn size).
    r.position.set(h.x, h.state === 'carried' ? 0.98 + h.slot * 0.6 : h.y, h.z);
    let d = h.dir - r.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    r.rotation.y += d * Math.min(1, dt * (h.fleeing ? 16 : 7));
    const sp = Math.hypot(h.vx, h.vz);
    a.step += dt * (3 + sp * 5);
    m.shadow.visible = h.state !== 'carried';
    m.shadow.position.y = 0.03 - h.y;
    const sh = 1 - Math.min(0.6, h.y * 0.35);
    m.shadow.scale.set(sh, sh, sh);
    let flap = 0;
    let lean = 0;
    let headDip = 0;
    if (h.state === 'carried') {
      // Perched on a head: settles down, flaps now and then.
      flap = Math.sin(t * 0.9) > 0.85 ? Math.sin(t * 38) * 0.8 + 0.6 : 0.1;
      m.body.position.y = -0.12;
      m.legs.forEach((l) => (l.visible = false));
      const p = sim.players[h.carrier];
      m.body.rotation.z = p ? Math.sin(t * 3) * 0.06 + (p.stun > 0 ? 0.4 : 0) : 0;
    } else {
      m.legs.forEach((l) => (l.visible = true));
      m.body.position.y = 0;
      m.body.rotation.z = 0;
      if (h.state === 'air') {
        flap = Math.sin(t * 42) * 0.9 + 0.7;
        lean = -0.2;
      } else if (h.fleeing || sp > 2) {
        flap = Math.sin(t * 30) * 0.5 + 0.5;
        lean = 0.35;
        m.body.position.y = Math.abs(Math.sin(a.step)) * 0.08;
      } else if (sp > 0.2) {
        m.body.position.y = Math.abs(Math.sin(a.step)) * 0.04;
        headDip = Math.sin(a.step * 2) * 0.12;
      } else if (h.peck > 0) {
        // Pecking at the ground.
        const pk = Math.max(0, Math.sin(t * 7));
        headDip = pk * pk * 1.1;
      }
      const sw = sp > 0.2 ? Math.sin(a.step) * 0.6 : 0;
      m.legs[0].rotation.x = sw;
      m.legs[1].rotation.x = -sw;
    }
    m.body.rotation.x = lean;
    m.head.rotation.x = headDip;
    m.head.position.z = 0.24 + headDip * 0.1;
    m.wings.forEach((w, s) => (w.rotation.z = (s ? -1 : 1) * flap));
    if (a.kind === 'gold' && Math.random() < dt * 5) this.puffs.spawn(h.x + (Math.random() - 0.5) * 0.6, h.y + 0.4 + Math.random() * 0.5, h.z + (Math.random() - 0.5) * 0.6, 0, 0.6, 0, 0.1, 0.6, '#fff3a0', 0.2);
  }

  dispose() {
    this.stage.dispose();
  }
}
