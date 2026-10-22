/**
 * Gorący Ziemniak in 3D: a village square on an autumn afternoon at harvest time. A bonfire crackles
 * in the middle, hay bales, a potato cart and a pile of sacks stand about, a wattle fence runs round
 * the cobbles, and behind it the potato field, a scarecrow, a cottage and trees gone orange. One
 * pierogi carries a steaming potato on its head that glows redder and redder until it bursts.
 * Same PS2 look as the other arena games.
 */
import {
  AdditiveBlending,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
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
import { ArenaStage, blobShadow, box, buildPierogi, flat, groundTexture, nameTag, pixelTexture, noise, type PierogiModel } from '../arena/kit';
import { Puffs } from '../arena/puffs';
import { mulberry32 } from '../rng';
import { FLIGHT, type Arena, type Obstacle, type PotatoSim } from './logic';

export interface PlayerLook {
  name: string;
  color: string;
}

type Keep = <T extends { dispose(): void }>(x: T) => T;

/** The pierogi are drawn at this scale (so they are about as wide as the sim’s circle). */
const SCALE = 0.85;
/** Where the potato sits on a pierogi’s head. */
const HEAD = 1.22;
const MASH = new Color('#f3e3b0');
const DROP_TIME = 0.45;

interface Actor {
  model: PierogiModel;
  tag: Sprite;
  colors: Color[];
  /** A dollop of mash on the head once mashed. */
  mash: Mesh;
  /** Seconds since bursting, or -1. */
  fly: number;
  from: Vector3;
  bench: Vector3;
  spin: number;
  yaw: number;
  /** Seconds since catching the potato (for a little jolt), or -1. */
  caught: number;
  pos: Vector3;
}

const smooth = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

export class PotatoScene {
  readonly stage: ArenaStage;
  private arena: Arena;
  private actors: Actor[] = [];
  /** Mash chunks (they fall), and steam, smoke and sparks (they rise), and autumn leaves (they drift down). */
  private chunks = new Puffs(220, 10, 1.2);
  private steam = new Puffs(260, -1.6, 1.4);
  private leaves = new Puffs(60, 0.5, 2.5);
  private potato = new Group();
  private potatoMat: MeshLambertMaterial;
  private glow: Mesh;
  private glowMat: MeshBasicMaterial;
  private ring: Mesh;
  private ringMat: MeshBasicMaterial;
  private flames: Mesh[] = [];
  private splats: Mesh[] = [];
  private splatGeo: CylinderGeometry;
  private splatMat: MeshBasicMaterial;
  private trees: Group[] = [];
  private scarecrow = new Group();
  private time = 0;
  private shake = 0;
  private benchCount = 0;
  private dist: number;

  constructor(canvas: HTMLCanvasElement, looks: PlayerLook[], arena: Arena) {
    this.stage = new ArenaStage(canvas, { sky: '#f4b98a', fog: [50, 120], fov: 38 });
    const stage = this.stage;
    const keep: Keep = (x) => stage.keep(x);
    this.arena = arena;
    this.dist = Math.max(arena.w * 1.08 + 6, arena.h * 2.1 + 6);

    this.buildSquare(keep);
    arena.obstacles.forEach((o) => this.buildObstacle(o, keep));

    // The potato: a lumpy spud with little eyes, a glow round it that warms up, and a ring on the ground under its holder.
    this.potatoMat = keep(new MeshLambertMaterial({ color: '#c9914e', flatShading: true, emissive: '#000000' }));
    const spudGeo = keep(new DodecahedronGeometry(0.36, 1));
    const pos = spudGeo.attributes.position;
    const rnd = mulberry32(4);
    for (let k = 0; k < pos.count; k++) {
      const j = 1 + (rnd() - 0.5) * 0.18;
      pos.setXYZ(k, pos.getX(k) * 1.35 * j, pos.getY(k) * 0.95 * j, pos.getZ(k) * j);
    }
    spudGeo.computeVertexNormals();
    const spud = new Mesh(spudGeo, this.potatoMat);
    const eyeMat = keep(flat('#6b4220'));
    const eyeGeo = keep(new SphereGeometry(0.05, 4, 3));
    for (const [x, y, z] of [
      [0.2, 0.15, 0.25],
      [-0.25, 0.05, 0.28],
      [0.05, -0.12, 0.33],
      [-0.1, 0.25, -0.2],
      [0.32, -0.05, -0.15],
    ] as const) {
      const e = new Mesh(eyeGeo, eyeMat);
      e.position.set(x, y, z);
      spud.add(e);
    }
    this.potato.add(spud);
    this.glowMat = new MeshBasicMaterial({ color: '#ff5a1a', transparent: true, opacity: 0, depthWrite: false, blending: AdditiveBlending });
    keep(this.glowMat);
    this.glow = new Mesh(keep(new SphereGeometry(0.75, 8, 6)), this.glowMat);
    this.glow.scale.set(1.3, 1, 1);
    this.potato.add(this.glow);
    this.potato.visible = false;
    stage.add(this.potato);
    this.ringMat = keep(new MeshBasicMaterial({ color: '#ff3b1f', transparent: true, opacity: 0.7, depthWrite: false }));
    const rg = keep(new RingGeometry(0.95, 1.2, 20));
    rg.rotateX(-Math.PI / 2);
    this.ring = new Mesh(rg, this.ringMat);
    this.ring.position.y = 0.04;
    this.ring.renderOrder = 2;
    this.ring.visible = false;
    stage.add(this.ring);

    // Splats of mash left on the cobbles.
    this.splatMat = keep(new MeshBasicMaterial({ color: '#f1dea2', transparent: true, opacity: 0.95, depthWrite: false }));
    this.splatGeo = keep(new CylinderGeometry(1, 1, 0.04, 9));

    stage.add(this.chunks.mesh, this.steam.mesh, this.leaves.mesh);
    looks.forEach((l) => {
      const model = buildPierogi(l.color);
      const tag = nameTag(l.name, l.color);
      tag.position.set(0, 2.55, 0);
      tag.scale.set(2.9, 0.72, 1);
      model.root.scale.setScalar(SCALE);
      model.root.add(tag);
      const mash = new Mesh(keep(new IcosahedronGeometry(0.42, 0)), keep(flat('#f3e3b0')));
      mash.scale.set(1.4, 0.6, 1);
      mash.position.set(0.1, 0.85, 0);
      mash.visible = false;
      model.body.add(mash);
      stage.add(model.root);
      const colors = model.mats.slice(0, 2).map((m) => (m as MeshLambertMaterial).color.clone());
      this.actors.push({ model, tag, colors, mash, fly: -1, from: new Vector3(), bench: new Vector3(), spin: 0, yaw: 0, caught: -1, pos: new Vector3() });
    });
  }

  // ---- scenery ------------------------------------------------------------------------------------------
  private buildSquare(keep: Keep) {
    const stage = this.stage;
    const { w, h } = this.arena;
    // Autumn grass all round, cobbles inside the fence.
    const grassTex = keep(groundTexture('grass', 26, 7));
    const g = keep(new PlaneGeometry(170, 110));
    g.rotateX(-Math.PI / 2);
    const ground = new Mesh(g, keep(flat('#d9c27a', { map: grassTex })));
    ground.position.set(0, -0.01, -14);
    stage.add(ground);
    const cobbles = keep(
      pixelTexture(
        16,
        (ctx, r) => {
          noise(ctx, r, 16, [168, 148, 122], 26);
          ctx.fillStyle = 'rgba(60,40,28,.4)';
          for (const y of [0, 5, 10]) ctx.fillRect(0, y, 16, 1);
          for (const [x, y] of [
            [3, 0],
            [10, 0],
            [6, 5],
            [13, 5],
            [2, 10],
            [9, 10],
          ])
            ctx.fillRect(x, y, 1, 5);
        },
        11,
        1,
      ),
    );
    cobbles.repeat.set(w / 1.6, h / 1.6);
    const cg = keep(new PlaneGeometry(w, h));
    cg.rotateX(-Math.PI / 2);
    const square = new Mesh(cg, keep(flat('#ffffff', { map: cobbles })));
    square.position.y = 0.005;
    stage.add(square);
    // Fallen leaves scattered on the cobbles.
    const rnd = mulberry32(23);
    const leafGeo = keep(new CylinderGeometry(0.16, 0.16, 0.02, 5));
    const leafMats = ['#d9661f', '#e8a531', '#b8401c', '#c98a2a'].map((c) => keep(flat(c)));
    for (let k = 0; k < 70; k++) {
      const l = new Mesh(leafGeo, leafMats[k % leafMats.length]);
      l.position.set((rnd() - 0.5) * (w + 6), 0.02, (rnd() - 0.5) * (h + 4));
      l.scale.set(1, 1, 0.6);
      l.rotation.y = rnd() * 6;
      stage.add(l);
    }

    // A low wattle fence round the square: posts and woven rails.
    const post = keep(flat('#6e4a2a'));
    const wattle = keep(flat('#a37a48'));
    const wattle2 = keep(flat('#8a6238'));
    const fenceSide = (x0: number, z0: number, x1: number, z1: number, high: number) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const ang = Math.atan2(z1 - z0, x1 - x0);
      const steps = Math.round(len / 1.6);
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const p = box(0.18, high + 0.25, 0.18, post);
        p.position.set(x0 + (x1 - x0) * t, 0, z0 + (z1 - z0) * t);
        stage.add(p);
      }
      for (let r = 0; r < 3; r++) {
        const rail = box(len, 0.14, 0.1, r % 2 ? wattle2 : wattle);
        rail.position.set((x0 + x1) / 2, 0.12 + (r * high) / 3, (z0 + z1) / 2);
        rail.rotation.y = -ang;
        stage.add(rail);
      }
    };
    const fx = w / 2 + 0.15;
    const fz = h / 2 + 0.15;
    fenceSide(-fx, -fz, fx, -fz, 1.0);
    fenceSide(-fx, fz, fx, fz, 0.5);
    fenceSide(-fx, -fz, -fx, fz, 0.8);
    fenceSide(fx, -fz, fx, fz, 0.8);

    // The potato field behind the back fence: ridges of dark earth with leafy plants, a few potatoes dug up.
    const soil = keep(flat('#5a3a22'));
    const plant = [keep(flat('#7a8a2c')), keep(flat('#9a8a2a'))];
    const leafy = keep(new IcosahedronGeometry(0.32, 0));
    const spud = keep(new DodecahedronGeometry(0.16, 0));
    const spudMat = keep(flat('#c9914e'));
    for (let row = 0; row < 6; row++) {
      const z = -h / 2 - 2.2 - row * 1.6;
      const ridge = box(w + 14, 0.32, 0.8, soil);
      ridge.position.set(0, 0, z);
      stage.add(ridge);
      for (let x = -w / 2 - 6; x < w / 2 + 6; x += 1.3 + rnd() * 0.5) {
        if (rnd() < 0.12) {
          const s = new Mesh(spud, spudMat);
          s.position.set(x, 0.38, z + 0.25);
          s.scale.set(1.3, 1, 1);
          stage.add(s);
          continue;
        }
        const p = new Mesh(leafy, plant[(row + Math.round(x)) % 2 === 0 ? 0 : 1]);
        p.position.set(x, 0.5, z);
        p.scale.set(1.1, 0.7 + rnd() * 0.3, 1);
        stage.add(p);
      }
    }
    // A scarecrow in the field.
    const sc = this.scarecrow;
    const stick = keep(flat('#7a5530'));
    const pole = box(0.16, 3.2, 0.16, stick);
    const arm = box(2.4, 0.14, 0.14, stick);
    arm.position.y = 2.2;
    const shirt = box(1.0, 1.1, 0.5, keep(flat('#b8402c')));
    shirt.position.y = 1.55;
    const head = new Mesh(keep(new SphereGeometry(0.34, 6, 4)), keep(flat('#e4c98a')));
    head.position.y = 2.75;
    const brim = new Mesh(keep(new CylinderGeometry(0.6, 0.6, 0.06, 8)), keep(flat('#c9a05a')));
    brim.position.y = 3.0;
    const crown = new Mesh(keep(new ConeGeometry(0.34, 0.5, 6)), keep(flat('#c9a05a')));
    crown.position.y = 3.25;
    sc.add(pole, arm, shirt, head, brim, crown);
    sc.position.set(w * 0.3, 0, -h / 2 - 6.5);
    stage.add(sc);

    // A whitewashed cottage with a thatched roof on the left, a barn on the right.
    const cottage = new Group();
    const wall = box(8, 3.4, 5, keep(flat('#f6efe2')));
    const roof = new Mesh(keep(new ConeGeometry(6.2, 3.4, 4)), keep(flat('#c9a05a')));
    roof.rotation.y = Math.PI / 4;
    roof.scale.set(1, 1, 0.62);
    roof.position.y = 3.4 + 1.6;
    const door = box(1.2, 2.1, 0.1, keep(flat('#6b8fc2')));
    door.position.set(-1.5, 0, 2.53);
    const pane = keep(flat('#ffe7a0'));
    const blue = keep(flat('#3568b8'));
    for (const x of [1.0, 2.8]) {
      const win = box(1.0, 1.0, 0.1, pane);
      win.position.set(x, 1.3, 2.53);
      const s1 = box(0.4, 1.1, 0.08, blue);
      s1.position.set(x - 0.72, 1.25, 2.55);
      const s2 = s1.clone();
      s2.position.x = x + 0.72;
      cottage.add(win, s1, s2);
    }
    const band = box(8.05, 0.22, 5.05, keep(flat('#cf3a2c')));
    band.position.y = 2.95;
    cottage.add(wall, band, roof, door);
    cottage.position.set(-w / 2 - 4, 0, -h / 2 - 9);
    cottage.rotation.y = 0.35;
    stage.add(cottage);
    const barn = new Group();
    const bw = box(7, 4.2, 5, keep(flat('#9c3324')));
    const broof = new Mesh(keep(new ConeGeometry(5.6, 2.8, 4)), keep(flat('#4a2e22')));
    broof.rotation.y = Math.PI / 4;
    broof.scale.set(1, 1, 0.7);
    broof.position.y = 4.2 + 1.3;
    const bdoor = box(2.6, 3, 0.1, keep(flat('#f4ecdc')));
    bdoor.position.set(0, 0, 2.53);
    const bx = box(2.4, 0.18, 0.12, keep(flat('#9c3324')));
    bx.position.set(0, 1.4, 2.6);
    bx.rotation.z = 0.85;
    const bx2 = bx.clone();
    bx2.rotation.z = -0.85;
    barn.add(bw, broof, bdoor, bx, bx2);
    barn.position.set(w / 2 + 6, 0, -h / 2 - 10);
    barn.rotation.y = -0.4;
    stage.add(barn);

    // Autumn trees.
    const trunk = keep(flat('#5e3d24'));
    const crowns = ['#e07a22', '#c9471f', '#e8b13a', '#b8601e'].map((c) => keep(flat(c)));
    const crownGeo = keep(new IcosahedronGeometry(1.6, 0));
    const trunkGeo = keep(new CylinderGeometry(0.22, 0.3, 2.4, 6));
    const treeAt: [number, number, number][] = [
      [-w / 2 - 3.5, -h / 2 - 3, 1.1],
      [-w / 2 - 9, -h / 2 - 4, 1.4],
      [w / 2 + 3.5, -h / 2 - 4, 1.2],
      [w / 2 + 3.2, h / 2 - 2, 1.0],
      [-w / 2 - 3.6, h / 2 - 3, 1.05],
      [-2, -h / 2 - 14, 1.6],
      [8, -h / 2 - 15, 1.5],
    ];
    treeAt.forEach(([x, z, s], k) => {
      const t = new Group();
      const tr = new Mesh(trunkGeo, trunk);
      tr.position.y = 1.2;
      const c1 = new Mesh(crownGeo, crowns[k % crowns.length]);
      c1.position.y = 3.2;
      const c2 = new Mesh(crownGeo, crowns[(k + 1) % crowns.length]);
      c2.position.set(0.7, 2.7, 0.4);
      c2.scale.setScalar(0.65);
      t.add(tr, c1, c2, blobShadow(1.6, 0.25));
      t.scale.setScalar(s);
      t.position.set(x, 0, z);
      stage.add(t);
      this.trees.push(t);
    });
    // Pumpkins by the fence.
    const pumpkin = keep(new SphereGeometry(0.42, 8, 5));
    const pumpMat = keep(flat('#e8781e'));
    const stalk = keep(flat('#4f6a24'));
    for (const [x, z, s] of [
      [-w / 2 - 1.2, -h / 2 + 1, 1],
      [-w / 2 - 1.5, -h / 2 + 2.2, 0.75],
      [w / 2 + 1.3, h / 2 - 1.5, 1.1],
      [w / 2 + 1.2, -h / 2 + 1.6, 0.8],
      [-w / 2 - 1.3, h / 2 - 0.8, 0.9],
    ] as const) {
      const p = new Group();
      const b = new Mesh(pumpkin, pumpMat);
      b.scale.set(1.2, 0.85, 1.2);
      b.position.y = 0.36;
      const st = box(0.08, 0.2, 0.08, stalk);
      st.position.y = 0.7;
      p.add(b, st);
      p.scale.setScalar(s);
      p.position.set(x, 0, z);
      stage.add(p);
    }
  }

  private buildObstacle(o: Obstacle, keep: Keep) {
    const stage = this.stage;
    switch (o.kind) {
      case 'fire': {
        const g = new Group();
        const stone = keep(flat('#8f877c'));
        const rock = keep(new DodecahedronGeometry(0.32, 0));
        for (let k = 0; k < 10; k++) {
          const a = (k / 10) * Math.PI * 2;
          const r = new Mesh(rock, stone);
          r.position.set(Math.cos(a) * o.r * 0.85, 0.18, Math.sin(a) * o.r * 0.85);
          r.rotation.set(a, a * 2, 0);
          g.add(r);
        }
        const log = keep(new CylinderGeometry(0.14, 0.16, 1.6, 6));
        const logMat = keep(flat('#5a3a20'));
        for (let k = 0; k < 4; k++) {
          const l = new Mesh(log, logMat);
          l.rotation.set(0.9, (k / 4) * Math.PI * 2, 0);
          l.position.y = 0.45;
          g.add(l);
        }
        const ember = new Mesh(keep(new CylinderGeometry(o.r * 0.6, o.r * 0.6, 0.06, 8)), keep(new MeshBasicMaterial({ color: '#ff7a1a' })));
        ember.position.y = 0.12;
        g.add(ember);
        const fl = [keep(new MeshBasicMaterial({ color: '#ff8a1f' })), keep(new MeshBasicMaterial({ color: '#ffd23f' })), keep(new MeshBasicMaterial({ color: '#ff5a1a' }))];
        const cone = keep(new ConeGeometry(0.42, 1.6, 5));
        [
          [0, 0, 1.0, 0],
          [0.25, 0.15, 0.7, 1],
          [-0.22, -0.1, 0.75, 2],
          [0.05, 0.05, 0.5, 1],
        ].forEach(([x, z, s, m]) => {
          const f = new Mesh(cone, fl[m]);
          f.position.set(x, 0.75 * s + 0.15, z);
          f.scale.setScalar(s);
          g.add(f);
          this.flames.push(f);
        });
        g.position.set(o.x, 0, o.z);
        stage.add(g);
        break;
      }
      case 'bale': {
        const g = new Group();
        const hay = keep(flat('#e3c06a'));
        const strap = keep(flat('#a8813a'));
        const b = box(o.hw * 2, 1.0, o.hd * 2, hay);
        g.add(b);
        const long = o.hw > o.hd;
        for (const s of [-0.5, 0.5]) {
          const st = box(long ? 0.08 : o.hw * 2 + 0.02, 1.02, long ? o.hd * 2 + 0.02 : 0.08, strap);
          if (long) st.position.x = s * o.hw;
          else st.position.z = s * o.hd;
          g.add(st);
        }
        // Loose straw on top.
        const tuft = keep(new ConeGeometry(0.12, 0.3, 4));
        for (let k = 0; k < 4; k++) {
          const t = new Mesh(tuft, hay);
          t.position.set((k / 3 - 0.5) * o.hw * 1.4, 1.1, ((k % 2) - 0.5) * o.hd * 0.8);
          t.rotation.z = (k - 1.5) * 0.4;
          g.add(t);
        }
        g.add(blobShadow(Math.max(o.hw, o.hd) * 1.1, 0.25));
        g.position.set(o.x, 0, o.z);
        stage.add(g);
        break;
      }
      case 'cart': {
        const g = new Group();
        const wood = keep(flat('#9a6a3a'));
        const dark = keep(flat('#5e3d24'));
        const bed = box(o.hw * 2, 0.6, o.hd * 2, wood);
        bed.position.y = 0.55 + 0.3;
        g.add(bed);
        const sideGeo = [o.hw * 2, 0.35, 0.1] as const;
        for (const s of [-1, 1]) {
          const side = box(sideGeo[0], sideGeo[1], sideGeo[2], dark);
          side.position.set(0, 1.15 + 0.17, s * o.hd);
          g.add(side);
        }
        const wheelGeo = keep(new CylinderGeometry(0.6, 0.6, 0.16, 10));
        for (const s of [-1, 1]) {
          const wh = new Mesh(wheelGeo, dark);
          wh.rotation.x = Math.PI / 2;
          wh.position.set(o.hw * 0.25, 0.6, s * (o.hd + 0.1));
          const hub = new Mesh(keep(new CylinderGeometry(0.15, 0.15, 0.22, 6)), wood);
          hub.rotation.x = Math.PI / 2;
          hub.position.copy(wh.position);
          g.add(wh, hub);
        }
        // Shafts, resting on the ground.
        for (const s of [-1, 1]) {
          const shaft = box(2.2, 0.1, 0.1, wood);
          shaft.position.set(o.hw + 1.0, 0.45, s * o.hd * 0.6);
          shaft.rotation.z = 0.28;
          g.add(shaft);
        }
        // A heap of potatoes.
        const spud = keep(new DodecahedronGeometry(0.2, 0));
        const spudMat = keep(flat('#c9914e'));
        const rnd = mulberry32(8);
        for (let k = 0; k < 24; k++) {
          const s = new Mesh(spud, spudMat);
          const x = (rnd() - 0.5) * o.hw * 1.7;
          const z = (rnd() - 0.5) * o.hd * 1.5;
          s.position.set(x, 1.25 + (1 - Math.abs(x) / o.hw) * 0.35 + rnd() * 0.1, z);
          s.scale.set(1.3, 1, 1);
          s.rotation.set(rnd() * 3, rnd() * 3, 0);
          g.add(s);
        }
        g.add(blobShadow(o.hw * 1.2, 0.3));
        g.position.set(o.x, 0, o.z);
        stage.add(g);
        break;
      }
      case 'sacks': {
        const g = new Group();
        const jute = keep(flat('#c8a46e'));
        const tie = keep(flat('#7a5530'));
        const sack = keep(new SphereGeometry(0.45, 7, 5));
        [
          [-0.35, 0, 0, 1],
          [0.38, 0, 0.1, 0.95],
          [0, 0, -0.38, 0.9],
          [0.02, 0.7, -0.05, 0.85],
        ].forEach(([x, y, z, s]) => {
          const sk = new Mesh(sack, jute);
          sk.scale.set(s, s * 1.25, s);
          sk.position.set(x, y + 0.5 * s, z);
          const t = new Mesh(keep(new ConeGeometry(0.15, 0.3, 5)), tie);
          t.position.set(x, y + 1.15 * s, z);
          g.add(sk, t);
        });
        g.add(blobShadow(o.r * 1.2, 0.3));
        g.position.set(o.x, 0, o.z);
        stage.add(g);
        break;
      }
    }
  }

  // ---- events -----------------------------------------------------------------------------------------
  reset(sim: PotatoSim) {
    this.benchCount = 0;
    for (const s of this.splats) this.stage.world.remove(s);
    this.splats = [];
    this.actors.forEach((a, i) => {
      const p = sim.players[i];
      a.fly = -1;
      a.caught = -1;
      a.spin = 0;
      a.mash.visible = false;
      a.model.mats.slice(0, 2).forEach((m, k) => (m as MeshLambertMaterial).color.copy(a.colors[k]));
      a.model.body.rotation.set(0, 0, 0);
      a.model.body.scale.set(1, 1, 1);
      a.model.root.rotation.set(0, 0, 0);
      a.yaw = p ? Math.atan2(p.fx, p.fz) : 0;
      a.pos.set(p?.x ?? 0, 0, p?.z ?? 0);
      a.model.root.position.copy(a.pos);
      a.model.shadow.visible = true;
      a.tag.visible = !p?.gone;
      a.model.root.visible = !p?.gone;
    });
  }

  hide(i: number) {
    const a = this.actors[i];
    if (a) a.model.root.visible = false;
  }

  dashed(i: number) {
    const a = this.actors[i];
    if (!a) return;
    for (let k = 0; k < 6; k++) this.chunks.spawn(a.pos.x + (Math.random() - 0.5) * 0.8, 0.15, a.pos.z + (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 2, 1.2, (Math.random() - 0.5) * 2, 0.26, 0.45, '#cbb78e');
  }

  bumped(j: number) {
    const a = this.actors[j];
    if (!a) return;
    a.caught = 0;
    for (let k = 0; k < 5; k++) this.steam.spawn(a.pos.x, 0.8, a.pos.z, (Math.random() - 0.5) * 3, 1, (Math.random() - 0.5) * 3, 0.2, 0.4, '#fff4dc', 0.5);
  }

  passed(to: number) {
    const a = this.actors[to];
    if (a) a.caught = 0;
  }

  burst(i: number, x: number, z: number) {
    this.shake = 1.7;
    const y = HEAD + 0.2;
    // Mash everywhere: chunks flying out, a puff of steam, a splat on the cobbles.
    for (let k = 0; k < 90; k++) {
      const a = Math.random() * Math.PI * 2;
      const s = 4 + Math.random() * 9;
      const up = Math.random();
      const col = k % 4 === 0 ? '#ffe9a8' : k % 4 === 1 ? '#f3d27a' : k % 4 === 2 ? '#fff6dc' : '#b9773a';
      this.chunks.spawn(x, y, z, Math.cos(a) * s * (1 - up * 0.4), 3 + up * 9, Math.sin(a) * s * 0.8, 0.3 + Math.random() * 0.4, 0.9 + Math.random() * 0.8, col, 0.4);
    }
    for (let k = 0; k < 30; k++) this.steam.spawn(x + (Math.random() - 0.5) * 2, y + Math.random(), z + (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 3, 1 + Math.random() * 2, (Math.random() - 0.5) * 3, 0.8 + Math.random() * 0.6, 1.6 + Math.random(), Math.random() < 0.6 ? '#fff8ea' : '#ffd9a0', 1.4);
    for (let k = 0; k < 4; k++) {
      const s = new Mesh(this.splatGeo, this.splatMat);
      const a = Math.random() * Math.PI * 2;
      const d = k === 0 ? 0 : 1 + Math.random() * 1.8;
      s.position.set(x + Math.cos(a) * d, 0.02 + k * 0.002, z + Math.sin(a) * d * 0.7);
      const r = k === 0 ? 1.5 : 0.4 + Math.random() * 0.5;
      s.scale.set(r, 1, r * (0.7 + Math.random() * 0.4));
      s.rotation.y = Math.random() * 3;
      this.stage.add(s);
      this.splats.push(s);
    }
    const ac = this.actors[i];
    if (!ac) return;
    ac.fly = 0;
    ac.from.copy(ac.pos);
    ac.tag.visible = false;
    this.benchSpot(ac.bench);
  }

  /** The next spot for a mashed pierogi: out in the potato field, left and right in turn. */
  private benchSpot(out: Vector3) {
    const side = this.benchCount % 2 === 0 ? -1 : 1;
    const k = Math.floor(this.benchCount / 2);
    out.set(side * (3 + k * 2.4), 0.3, -this.arena.h / 2 - 2.4 - (k % 2) * 1.6);
    this.benchCount++;
  }

  toStage(x: number, y: number, z: number) {
    return this.stage.toStage(new Vector3(x, y, z));
  }

  /** Where a pierogi’s head is on the 1920×1080 stage. */
  headOnStage(i: number) {
    const a = this.actors[i];
    if (!a) return null;
    return this.stage.toStage(new Vector3(a.pos.x, a.pos.y + 2.6, a.pos.z));
  }

  // ---- drawing ------------------------------------------------------------------------------------------
  render(sim: PotatoSim, dt: number) {
    this.time += dt;
    const pot = sim.potato;
    const heat = sim.heat;

    // Pierogi.
    this.actors.forEach((a, i) => {
      const sp = sim.players[i];
      if (!sp || sp.gone) return;
      const root = a.model.root;
      const body = a.model.body;
      if (a.fly >= 0 || (!sp.alive && sp.outAt !== null)) {
        if (a.fly < 0) {
          // Already mashed when this screen started drawing: straight to the field.
          a.fly = 9;
          this.benchSpot(a.bench);
          a.from.copy(a.bench);
          a.tag.visible = false;
        }
        a.fly += dt;
        // Up over the fence, spinning, and down in the potato field, covered in mash.
        const flight = 1.5;
        const t = Math.min(1, Math.max(0, a.fly - 0.05) / flight);
        a.pos.copy(a.from).lerp(a.bench, smooth(t));
        a.pos.y = Math.sin(t * Math.PI) * 8 + a.from.y * (1 - t) + a.bench.y * t;
        root.position.copy(a.pos);
        a.spin += dt * 13 * (1 - t);
        body.rotation.set(a.spin, 0, a.spin * 0.5);
        root.rotation.y = 0;
        if (t >= 1) {
          // Sitting in the field, dazed.
          body.rotation.set(-0.2, 0, 0.3 + Math.sin(this.time * 2 + i) * 0.05);
          body.scale.set(1.1, 0.82, 1.1);
        }
        const mash = Math.min(1, a.fly * 3);
        a.model.mats.slice(0, 2).forEach((m, k) => (m as MeshLambertMaterial).color.copy(a.colors[k]).lerp(MASH, mash * 0.6));
        a.mash.visible = true;
        a.model.shadow.visible = t >= 1;
        if (t < 1 && Math.random() < 0.7) this.chunks.spawn(a.pos.x, a.pos.y, a.pos.z, 0, 0, 0, 0.22, 0.6, '#f3e3b0', 0.2);
        if (t >= 1 && Math.random() < dt * 1.5) this.steam.spawn(a.pos.x, a.pos.y + 1.1, a.pos.z, 0, 0.6, 0, 0.2, 1.2, '#fff8ea', 1);
        return;
      }
      a.pos.set(sp.x, 0, sp.z);
      const speed = Math.hypot(sp.vx, sp.vz);
      const sf = Math.min(1, speed / 6);
      const holding = pot?.holder === i;
      // Turn towards where we are heading.
      const want = Math.atan2(sp.fx, sp.fz);
      let d = want - a.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      a.yaw += d * Math.min(1, dt * 12);
      root.rotation.y = a.yaw;
      // Waddle, a hop in the step, a stretch while dashing, a jolt on catching the potato.
      let hop = Math.abs(Math.sin(this.time * 14 + i)) * 0.18 * sf;
      let sy = 1 + Math.sin(this.time * 28 + i * 2) * 0.05 * sf;
      let sxz = 1;
      body.rotation.z = Math.sin(this.time * 14 + i) * 0.14 * sf;
      body.rotation.x = sf * 0.15;
      if (sp.dash > 0) {
        sy *= 0.8;
        sxz *= 1.15;
        body.rotation.x = 0.4;
        if (Math.random() < 0.6) this.chunks.spawn(sp.x, 0.12, sp.z, -sp.vx * 0.05, 0.6, -sp.vz * 0.05, 0.22, 0.4, '#cbb78e');
      }
      if (a.caught >= 0) {
        a.caught += dt;
        const t = a.caught / 0.35;
        if (t < 1) {
          hop += Math.sin(t * Math.PI) * 0.5;
          sy *= 1 + Math.sin(t * Math.PI * 2) * 0.15;
        } else a.caught = -1;
      }
      if (holding) {
        // Panic: shaking harder the hotter it gets.
        body.rotation.z += Math.sin(this.time * 50) * 0.05 * (0.3 + heat);
      }
      body.scale.set(sxz, sy, sxz);
      a.pos.y = hop;
      root.position.copy(a.pos);
      a.model.shadow.position.y = (0.03 - hop) / SCALE;
      a.model.shadow.scale.set(1 - hop * 0.4, 0.6, 1 - hop * 0.4);
      a.model.shadow.visible = true;
    });

    // The potato on its holder’s head, hopping across when passed or dropping in from the sky.
    if (pot && this.actors[pot.holder]) {
      const to = this.actors[pot.holder].pos;
      const head = new Vector3(to.x, to.y + HEAD, to.z);
      const pos = head.clone();
      if (pot.from >= 0 && pot.flight < FLIGHT && this.actors[pot.from]) {
        const f = this.actors[pot.from].pos;
        const t = pot.flight / FLIGHT;
        pos.set(f.x, f.y + HEAD, f.z).lerp(head, t);
        pos.y += Math.sin(t * Math.PI) * 1.8;
      } else if (pot.from < 0 && pot.flight < DROP_TIME && sim.phase !== 'idle') {
        const t = pot.flight / DROP_TIME;
        pos.y += (1 - t) * (1 - t) * 12;
      }
      this.potato.visible = true;
      this.potato.position.copy(pos);
      const jig = 0.04 + heat * heat * 0.25;
      this.potato.rotation.set(Math.sin(this.time * 31) * jig, this.time * (1 + heat * 4), Math.sin(this.time * 37) * jig);
      const pulse = 0.5 + 0.5 * Math.sin(this.time * (5 + heat * 22));
      const glow = Math.pow(heat, 1.4);
      this.potatoMat.emissive.setRGB(0.25 + 0.75 * glow, 0.08 + 0.12 * glow * (1 - glow), 0.02).multiplyScalar(0.25 + 0.75 * glow * (0.7 + 0.3 * pulse));
      this.potatoMat.color.set('#c9914e').lerp(new Color('#ff5a2a'), glow * 0.7);
      this.glowMat.opacity = 0.08 + glow * 0.5 * (0.6 + 0.4 * pulse);
      this.glow.scale.set(1.3 * (1 + glow * 0.4), 1 + glow * 0.4, 1 + glow * 0.4);
      // Steam, more and more of it.
      if (Math.random() < dt * (5 + heat * 40)) this.steam.spawn(pos.x + (Math.random() - 0.5) * 0.4, pos.y + 0.3, pos.z + (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.6, 1.2 + heat * 1.5, (Math.random() - 0.5) * 0.6, 0.16 + heat * 0.1, 0.9, Math.random() < heat * 0.5 ? '#ffd0a0' : '#ffffff', 2.2);
      if (heat > 0.6 && Math.random() < dt * heat * 20) this.steam.spawn(pos.x, pos.y + 0.2, pos.z, (Math.random() - 0.5) * 3, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 3, 0.08, 0.4, '#ffb020', 0);
      // The ring on the ground under the holder.
      this.ring.visible = true;
      this.ring.position.set(to.x, 0.04, to.z);
      const rp = 1 + 0.12 * Math.sin(this.time * (6 + heat * 14));
      this.ring.scale.set(rp, 1, rp);
      this.ringMat.opacity = 0.45 + 0.35 * pulse;
    } else {
      this.potato.visible = false;
      this.ring.visible = false;
    }

    // The bonfire flickers and throws sparks; leaves drift down from the trees.
    this.flames.forEach((f, k) => {
      const s = 0.85 + 0.25 * Math.sin(this.time * (9 + k * 3) + k) + 0.1 * Math.sin(this.time * 23 + k * 5);
      f.scale.y = s * (k === 0 ? 1 : 0.7);
      f.rotation.y = this.time * (1 + k * 0.3);
    });
    const fire = this.arena.obstacles.find((o) => o.kind === 'fire');
    if (fire) {
      if (Math.random() < dt * 14) this.steam.spawn(fire.x + (Math.random() - 0.5) * 0.8, 1.2, fire.z + (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 1.2, 1.5 + Math.random() * 2, (Math.random() - 0.5) * 1.2, 0.08, 0.9 + Math.random() * 0.6, Math.random() < 0.5 ? '#ffd23f' : '#ff8a2a', -0.6);
      if (Math.random() < dt * 4) this.steam.spawn(fire.x, 1.8, fire.z, (Math.random() - 0.5) * 0.5, 1, 0, 0.35, 2.2, '#8a7a70', 1.5);
    }
    if (Math.random() < dt * 2.5 && this.trees.length) {
      const t = this.trees[Math.floor(Math.random() * this.trees.length)];
      const col = ['#e07a22', '#c9471f', '#e8b13a'][Math.floor(Math.random() * 3)];
      this.leaves.spawn(t.position.x + (Math.random() - 0.5) * 3, 3.5 * t.scale.y, t.position.z + (Math.random() - 0.5) * 2, 0.6 + Math.random(), -0.3, Math.random() * 0.6, 0.18, 4, col, 0);
    }
    this.scarecrow.rotation.z = Math.sin(this.time * 1.1) * 0.03;
    this.chunks.update(dt);
    this.steam.update(dt);
    this.leaves.update(dt);

    // Camera: the whole square from the front, with a shake when a potato bursts.
    const stage = this.stage;
    stage.lookAt(new Vector3(0, 0, 0.2), this.dist, 0.98);
    if (this.shake > 0.01) {
      stage.camera.position.x += (Math.random() - 0.5) * this.shake * 0.9;
      stage.camera.position.y += (Math.random() - 0.5) * this.shake * 0.9;
      this.shake *= Math.exp(-4.5 * dt);
    }
    stage.render();
  }

  dispose() {
    this.stage.dispose();
  }
}
