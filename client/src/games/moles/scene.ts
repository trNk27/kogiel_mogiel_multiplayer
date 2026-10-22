/**
 * Krety in 3D: Babcia's vegetable garden on a sunny afternoon. A bed of dark tilled soil dotted with
 * molehills, rows of cabbages either side, a scarecrow, a wheelbarrow of carrots, a wooden fence, a garden
 * shed and sunflowers. Moles (black, red-nosed, a little like Krecik) pop out of the hills; the pierogi
 * whack them with big wooden spoons. Same PS2 look as the other arena games.
 */
import {
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  CircleGeometry,
  OctahedronGeometry,
  PlaneGeometry,
  SphereGeometry,
  Vector3,
  type Material,
  type Sprite,
} from 'three';
import { ArenaStage, blobShadow, box, buildPierogi, flat, groundTexture, nameTag, type PierogiModel } from '../arena/kit';
import { buildBabcia } from '../arena/babcia';
import { Puffs } from '../arena/puffs';
import { mulberry32 } from '../rng';
import { DAZE, RISE, SINK, type Kind, type MolesEvent, type MolesSim } from './logic';

export interface PlayerLook {
  name: string;
  color: string;
}

type Keep = <T extends { dispose(): void }>(x: T) => T;

/** How far below the hill a critter hides. */
const DEPTH = 1.05;
/** Top of a molehill. */
const HILL_H = 0.34;
const PIEROGI_SCALE = 0.8;

interface Critter3D {
  root: Group;
  /** Turns to look around. */
  head: Group;
  pupils: Mesh[];
  stars: Group;
}

interface Slot {
  /** Sits on top of the hill; the critters rise inside it. */
  root: Group;
  mole: Critter3D;
  gold: Critter3D;
  hedgehog: Critter3D;
  /** The id of the critter shown, or 0. */
  id: number;
  kind: Kind;
}

interface Actor {
  model: PierogiModel;
  tag: Sprite;
  color: string;
  /** Yaw of the spoon arm, and its pitch. */
  arm: Group;
  spoon: Group;
  stars: Group;
  yaw: number;
  bob: number;
}

const smooth = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};
const easeOut = (x: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, x)), 3);

export class MolesScene {
  readonly stage: ArenaStage;
  private actors: Actor[] = [];
  private slots: Slot[] = [];
  private puffs = new Puffs(260, 7, 2);
  private sunflowers: Group[] = [];
  private scarecrow = new Group();
  private babcia: PierogiModel | null = null;
  private keep: Keep;
  private time = 0;
  private shake = 0;
  private cheer = 0;
  private readonly W: number;
  private readonly H: number;

  constructor(canvas: HTMLCanvasElement, looks: PlayerLook[], sim: MolesSim) {
    this.stage = new ArenaStage(canvas, { sky: '#a6d8ef', fog: [55, 130], fov: 36 });
    const stage = this.stage;
    this.keep = (x) => stage.keep(x);
    this.W = sim.W;
    this.H = sim.H;
    this.buildGarden(sim);
    this.buildHills(sim);
    stage.add(this.puffs.mesh);
    const spoonParts = this.spoonParts();
    looks.forEach((l) => {
      const model = buildPierogi(l.color);
      model.mats.forEach((m) => this.keep(m));
      const tag = nameTag(l.name, l.color);
      tag.position.set(0, 2.15, 0);
      tag.scale.set(3.3, 0.82, 1);
      model.root.scale.setScalar(PIEROGI_SCALE);
      model.root.add(tag);
      // The spoon arm: a yaw pivot at the pierogi's side, a pitch pivot inside it, the spoon pointing up.
      const arm = new Group();
      arm.position.set(-0.78, 0.5, 0.1);
      const spoon = new Group();
      const handle = new Mesh(spoonParts.handle, spoonParts.wood);
      handle.position.y = 0.75;
      const bowl = new Mesh(spoonParts.bowl, spoonParts.wood);
      bowl.position.set(0, 1.62, 0);
      bowl.scale.set(1, 1.35, 0.45);
      const inner = new Mesh(spoonParts.bowl, spoonParts.dark);
      inner.position.set(0, 1.62, 0.05);
      inner.scale.set(0.75, 1.05, 0.25);
      const hand = new Mesh(spoonParts.hand, model.mats[0]);
      hand.position.y = 0.12;
      spoon.add(handle, bowl, inner, hand);
      arm.add(spoon);
      model.body.add(arm);
      const stars = this.starRing(0.95);
      stars.position.y = 1.55;
      stars.visible = false;
      model.body.add(stars);
      stage.add(model.root);
      this.actors.push({ model, tag, color: l.color, arm, spoon, stars, yaw: 0, bob: 0 });
    });
    this.reset(sim);
  }

  // ---- building ---------------------------------------------------------------------------------------

  private spoonParts() {
    const k = this.keep;
    return {
      wood: k(flat('#d7a065')),
      dark: k(flat('#b07a42')),
      handle: k(new CylinderGeometry(0.07, 0.09, 1.4, 6)),
      bowl: k(new SphereGeometry(0.3, 7, 5)),
      hand: k(new SphereGeometry(0.17, 6, 4)),
    };
  }

  /** Three little yellow stars that circle a dizzy head. */
  private starRing(r: number) {
    const g = new Group();
    const geo = this.keep(new OctahedronGeometry(0.16, 0));
    const mat = this.keep(new MeshBasicMaterial({ color: '#ffe14a' }));
    for (let k = 0; k < 3; k++) {
      const s = new Mesh(geo, mat);
      const a = (k / 3) * Math.PI * 2;
      s.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      s.scale.set(1, 1.3, 0.5);
      g.add(s);
    }
    return g;
  }

  private buildGarden(sim: MolesSim) {
    const stage = this.stage;
    const k = this.keep;
    const W = sim.W;
    const H = sim.H;
    const grass = k(groundTexture('grass', 26, 5));
    const g = k(new PlaneGeometry(170, 120));
    g.rotateX(-Math.PI / 2);
    const ground = new Mesh(g, k(flat('#ffffff', { map: grass })));
    ground.position.set(0, 0, -12);
    stage.add(ground);

    // The tilled bed: dark soil with furrows running across.
    const soilTex = k(groundTexture('sand', 7, 11));
    const bedW = W + 1.4;
    const bedH = H + 1.0;
    const bg = k(new PlaneGeometry(bedW, bedH));
    bg.rotateX(-Math.PI / 2);
    const bed = new Mesh(bg, k(flat('#8c6440', { map: soilTex })));
    bed.position.y = 0.012;
    stage.add(bed);
    const furrow = k(flat('#6e4a2c'));
    for (let z = -bedH / 2 + 0.9; z < bedH / 2 - 0.4; z += 1.1) {
      const f = box(bedW - 0.4, 0.05, 0.18, furrow);
      f.position.set(0, 0.0, z);
      stage.add(f);
    }
    // A raised wooden edge round the bed.
    const plank = k(flat('#9a6a3c'));
    for (const s of [-1, 1]) {
      const a = box(bedW + 0.3, 0.28, 0.18, plank);
      a.position.set(0, 0, s * (bedH / 2 + 0.05));
      const b = box(0.18, 0.28, bedH + 0.2, plank);
      b.position.set(s * (bedW / 2 + 0.05), 0, 0);
      stage.add(a, b);
    }

    // Cabbage rows on both sides of the bed.
    const rnd = mulberry32(23);
    const cabbageGeo = k(new IcosahedronGeometry(0.42, 1));
    const leafGeo = k(new SphereGeometry(0.4, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2));
    const cabbage = [k(flat('#9fd062')), k(flat('#86bf4c'))];
    const leaf = k(flat('#5f9a35'));
    const patchMat = k(flat('#7a5636', { map: soilTex }));
    for (const s of [-1, 1]) {
      const x0 = s * (bedW / 2 + 2.3);
      const pg = k(new PlaneGeometry(3.4, bedH + 2));
      pg.rotateX(-Math.PI / 2);
      const patch = new Mesh(pg, patchMat);
      patch.position.set(x0, 0.01, 0);
      stage.add(patch);
      for (const dx of [-0.8, 0.8])
        for (let z = -bedH / 2; z <= bedH / 2 + 0.6; z += 1.45) {
          const c = new Group();
          const head = new Mesh(cabbageGeo, cabbage[Math.floor(rnd() * 2)]);
          head.position.y = 0.36;
          head.scale.set(1, 0.85, 1);
          const outer = new Mesh(leafGeo, leaf);
          outer.scale.set(1.55, 0.7, 1.55);
          outer.position.y = 0.05;
          outer.rotation.y = rnd() * 3;
          c.add(outer, head);
          c.position.set(x0 + dx + (rnd() - 0.5) * 0.25, 0, z + (rnd() - 0.5) * 0.3);
          c.scale.setScalar(0.85 + rnd() * 0.3);
          stage.add(c);
        }
    }

    // A wooden fence round the back and sides (the front is left open for the sofa).
    const fenceMat = k(flat('#a77a4a'));
    const fenceDark = k(flat('#86603a'));
    const fx = bedW / 2 + 4.6;
    const back = -bedH / 2 - 3.2;
    const front = bedH / 2 + 2.2;
    const fenceLine = (x1: number, z1: number, x2: number, z2: number) => {
      const len = Math.hypot(x2 - x1, z2 - z1);
      const ang = Math.atan2(x2 - x1, z2 - z1);
      for (const y of [0.45, 0.95]) {
        const rail = box(0.1, 0.14, len, fenceDark);
        rail.position.set((x1 + x2) / 2, y, (z1 + z2) / 2);
        rail.rotation.y = ang;
        stage.add(rail);
      }
      const n = Math.max(1, Math.round(len / 1.4));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const p = box(0.2, 1.35, 0.2, fenceMat);
        p.position.set(x1 + (x2 - x1) * t, 0, z1 + (z2 - z1) * t);
        p.rotation.y = ang + (rnd() - 0.5) * 0.2;
        p.rotation.z = (rnd() - 0.5) * 0.08;
        stage.add(p);
      }
    };
    fenceLine(-fx, back, fx, back);
    fenceLine(-fx, back, -fx, front);
    fenceLine(fx, back, fx, front);

    // The garden shed, behind the fence on the left.
    const shed = new Group();
    const boards = k(flat('#7b5434'));
    const wall = box(4.2, 2.8, 3.2, boards);
    const roofMat = k(flat('#4f5d6a'));
    const roof = new Mesh(k(new CylinderGeometry(1.0, 1.0, 4.8, 3)), roofMat);
    roof.rotation.z = Math.PI / 2;
    roof.rotation.x = Math.PI;
    roof.scale.set(1, 1, 2.0);
    roof.position.y = 3.25;
    const door = box(1.1, 2.0, 0.08, k(flat('#5a3a22')));
    door.position.set(-0.8, 0, 1.62);
    const win = box(0.9, 0.7, 0.08, k(flat('#fff1c2')));
    win.position.set(1.0, 1.3, 1.62);
    const frame = box(1.05, 0.12, 0.1, boards);
    frame.position.set(1.0, 1.62, 1.63);
    for (let x = -2; x <= 2; x += 0.5) {
      const line = box(0.04, 2.8, 0.04, k(flat('#5e3f24')));
      line.position.set(x, 0, 1.61);
      shed.add(line);
    }
    // A watering can and a rake by the door.
    const can = new Mesh(k(new CylinderGeometry(0.28, 0.3, 0.5, 8)), k(flat('#5b8fb0')));
    can.position.set(-2.0, 0.25, 2.0);
    const spout = new Mesh(k(new CylinderGeometry(0.04, 0.05, 0.6, 5)), k(flat('#5b8fb0')));
    spout.position.set(-1.7, 0.45, 2.0);
    spout.rotation.z = -0.9;
    shed.add(wall, roof, door, win, frame, can, spout);
    shed.position.set(-fx + 2.4, 0, back - 3.2);
    shed.rotation.y = 0.18;
    stage.add(shed);

    // Babcia by the shed, keeping an eye on her cabbages.
    const babcia = buildBabcia(k, '#cf3a2c');
    babcia.root.scale.setScalar(1.25);
    babcia.root.position.set(-fx + 5.6, 0, back - 1.4);
    babcia.root.rotation.y = 0.35;
    stage.add(babcia.root);
    this.babcia = babcia;

    // The scarecrow, at the back right of the garden.
    const sc = this.scarecrow;
    const pole = box(0.16, 2.6, 0.16, k(flat('#8a5a32')));
    const arms = box(2.4, 0.14, 0.14, k(flat('#8a5a32')));
    arms.position.y = 1.85;
    const shirt = box(1.0, 1.0, 0.5, k(flat('#c0392b')));
    shirt.position.y = 1.3;
    const check = k(flat('#2c3e78'));
    for (const x of [-0.25, 0.25]) {
      const st = box(0.12, 1.02, 0.52, check);
      st.position.set(x, 1.29, 0);
      sc.add(st);
    }
    const sleeves = box(1.9, 0.32, 0.34, k(flat('#c0392b')));
    sleeves.position.y = 1.72;
    const headMat = k(flat('#d9b77a'));
    const head = new Mesh(k(new SphereGeometry(0.38, 7, 5)), headMat);
    head.position.y = 2.55;
    const brim = new Mesh(k(new CylinderGeometry(0.7, 0.7, 0.06, 10)), k(flat('#e3c06a')));
    brim.position.y = 2.82;
    const crown = new Mesh(k(new ConeGeometry(0.4, 0.55, 8)), k(flat('#e3c06a')));
    crown.position.y = 3.1;
    const eyeMat = k(new MeshBasicMaterial({ color: '#2a120a' }));
    for (const x of [-0.13, 0.13]) {
      const e = box(0.09, 0.09, 0.05, eyeMat);
      e.position.set(x, 2.55, 0.36);
      sc.add(e);
    }
    const straw = k(flat('#f0d27a'));
    const tuftGeo = k(new ConeGeometry(0.14, 0.35, 4));
    for (const s of [-1, 1]) {
      const t = new Mesh(tuftGeo, straw);
      t.position.set(s * 1.1, 1.72, 0);
      t.rotation.z = s * Math.PI / 2;
      sc.add(t);
    }
    sc.add(pole, arms, sleeves, shirt, head, brim, crown, blobShadow(0.8, 0.25));
    sc.position.set(fx - 2.3, 0, back + 1.6);
    sc.rotation.y = -0.3;
    stage.add(sc);
    // A crow on the scarecrow's arm.
    const crow = new Group();
    const crowMat = k(flat('#262230'));
    const cb = new Mesh(k(new SphereGeometry(0.2, 6, 4)), crowMat);
    cb.scale.set(1, 0.8, 1.4);
    const ch = new Mesh(k(new SphereGeometry(0.13, 5, 3)), crowMat);
    ch.position.set(0, 0.16, 0.2);
    const beak = new Mesh(k(new ConeGeometry(0.05, 0.16, 4)), k(flat('#e8a33a')));
    beak.rotation.x = Math.PI / 2;
    beak.position.set(0, 0.15, 0.36);
    crow.add(cb, ch, beak);
    crow.position.set(-0.85, 2.05, 0);
    sc.add(crow);

    // A wheelbarrow of carrots, front left, outside the cabbages.
    const wb = new Group();
    const tin = k(flat('#3f7a5a'));
    const tray = box(1.5, 0.55, 1.0, tin);
    tray.position.y = 0.55;
    const soil = box(1.36, 0.06, 0.86, k(flat('#5e4028')));
    soil.position.y = 1.07;
    const wheel = new Mesh(k(new CylinderGeometry(0.32, 0.32, 0.16, 10)), k(flat('#2b2b2b')));
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(0, 0.32, 0.9);
    wheel.rotation.y = Math.PI / 2;
    const woodMat = k(flat('#8a5a32'));
    for (const x of [-0.5, 0.5]) {
      const h = box(0.08, 0.08, 1.8, woodMat);
      h.position.set(x, 0.62, -0.5);
      h.rotation.x = -0.12;
      const leg = box(0.08, 0.5, 0.08, woodMat);
      leg.position.set(x, 0, -0.45);
      wb.add(h, leg);
    }
    const carrot = k(flat('#f08a24'));
    const top = k(flat('#5aa83a'));
    const carrotGeo = k(new ConeGeometry(0.09, 0.5, 5));
    const topGeo = k(new ConeGeometry(0.1, 0.25, 4));
    for (let i = 0; i < 6; i++) {
      const c = new Mesh(carrotGeo, carrot);
      const x = -0.5 + (i % 3) * 0.5;
      const z = i < 3 ? -0.2 : 0.2;
      c.position.set(x, 1.15, z);
      c.rotation.set(Math.PI / 2 + 0.3, 0, (rnd() - 0.5) * 1.2);
      const t = new Mesh(topGeo, top);
      t.position.set(x, 1.2, z - 0.28);
      t.rotation.x = -1.2;
      wb.add(c, t);
    }
    wb.add(tray, soil, wheel, blobShadow(1.1, 0.25));
    wb.position.set(-fx + 1.4, 0, front - 0.5);
    wb.rotation.y = 0.7;
    stage.add(wb);

    // Sunflowers along the back fence.
    const stem = k(new CylinderGeometry(0.06, 0.08, 1, 5));
    const stemMat = k(flat('#4f8a2c'));
    const petals = k(new CylinderGeometry(0.62, 0.62, 0.08, 10));
    const petalMat = k(flat('#ffc72c'));
    const middle = k(new CylinderGeometry(0.3, 0.3, 0.12, 8));
    const middleMat = k(flat('#5a3418'));
    for (let x = -fx + 7; x < fx - 4; x += 2.6 + rnd()) {
      const h = 2.3 + rnd() * 1.1;
      const f = new Group();
      const s = new Mesh(stem, stemMat);
      s.scale.y = h;
      s.position.y = h / 2;
      const headG = new Group();
      const p = new Mesh(petals, petalMat);
      p.rotation.x = Math.PI / 2;
      const m = new Mesh(middle, middleMat);
      m.rotation.x = Math.PI / 2;
      m.position.z = 0.05;
      headG.add(p, m);
      headG.position.y = h;
      headG.rotation.x = -0.3;
      f.add(s, headG);
      f.position.set(x, 0, back - 0.7);
      stage.add(f);
      this.sunflowers.push(headG);
    }

    // Apple trees and the village beyond.
    const trunk = k(flat('#6b4a2a'));
    const crownMat = k(flat('#4e8a3a'));
    const apple = k(flat('#d8322a'));
    for (const [x, z, s] of [
      [fx + 4, back - 2, 1.2],
      [fx + 7, back + 5, 1],
      [-fx - 5, back + 4, 1.1],
      [-fx - 3, front - 2, 0.9],
      [fx + 5, front - 3, 0.95],
      [6, back - 9, 1.3],
      [-14, back - 11, 1.2],
    ] as const) {
      const t = new Group();
      const tr = box(0.4, 2, 0.4, trunk);
      const cr = new Mesh(k(new IcosahedronGeometry(1.6, 0)), crownMat);
      cr.position.y = 2.9;
      t.add(tr, cr);
      for (let a = 0; a < 5; a++) {
        const ap = new Mesh(k(new SphereGeometry(0.13, 4, 3)), apple);
        const ang = a * 1.3;
        ap.position.set(Math.cos(ang) * 1.35, 2.5 + (a % 2) * 0.6, Math.sin(ang) * 1.35);
        t.add(ap);
      }
      t.add(blobShadow(1.6, 0.25));
      t.position.set(x, 0, z);
      t.scale.setScalar(s);
      stage.add(t);
    }
  }

  private buildCritter(kind: Kind): Critter3D {
    const k = this.keep;
    const root = new Group();
    const head = new Group();
    root.add(head);
    const white = k(new MeshBasicMaterial({ color: '#fff8ea' }));
    const black = k(new MeshBasicMaterial({ color: '#1d0f0a' }));
    const pupils: Mesh[] = [];
    const eyes = (y: number, z: number, r: number, gap: number) => {
      for (const x of [-gap, gap]) {
        const e = new Mesh(this.geo.eye, white);
        e.position.set(x, y, z);
        e.scale.setScalar(r / 0.1);
        e.scale.z *= 0.6;
        const p = new Mesh(this.geo.pupil, black);
        p.position.set(x, y, z + r * 0.62);
        p.scale.setScalar(r / 0.1);
        head.add(e, p);
        pupils.push(p);
      }
    };
    if (kind === 'hedgehog') {
      const body = new Mesh(this.geo.body, this.mat.hogBody);
      body.scale.set(1.15, 0.95, 1.05);
      body.position.y = 0.28;
      head.add(body);
      for (let i = 0; i < 26; i++) {
        // Spikes over the back and top, not the face.
        const u = (i * 0.618) % 1;
        const v = i / 26;
        const theta = u * Math.PI * 2;
        const phi = 0.25 + v * 1.25;
        const dir = new Vector3(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta));
        if (dir.z > 0.55 && dir.y < 0.75) continue;
        const sp = new Mesh(this.geo.spike, this.mat.spike);
        sp.position.set(dir.x * 0.4, 0.28 + dir.y * 0.38, dir.z * 0.4 - 0.04);
        sp.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), dir);
        head.add(sp);
      }
      const face = new Mesh(this.geo.face, this.mat.hogFace);
      face.position.set(0, 0.32, 0.3);
      face.scale.set(1, 0.85, 1.1);
      const nose = new Mesh(this.geo.nose, black);
      nose.position.set(0, 0.34, 0.55);
      nose.scale.setScalar(0.7);
      head.add(face, nose);
      eyes(0.46, 0.42, 0.06, 0.13);
    } else {
      const fur = kind === 'gold' ? this.mat.gold : this.mat.fur;
      const body = new Mesh(this.geo.body, fur);
      body.scale.set(0.95, 1.25, 0.9);
      body.position.y = 0.35;
      const nose = new Mesh(this.geo.nose, this.mat.nose);
      nose.position.set(0, 0.42, 0.37);
      const tuft = new Mesh(this.geo.tuft, fur);
      tuft.position.set(0, 0.86, 0);
      tuft.rotation.z = 0.3;
      const tuft2 = tuft.clone();
      tuft2.rotation.z = -0.3;
      tuft2.position.x = 0.06;
      head.add(body, nose, tuft, tuft2);
      for (const x of [-0.27, 0.27]) {
        const paw = new Mesh(this.geo.paw, this.mat.paw);
        paw.position.set(x, 0.12, 0.3);
        paw.scale.set(1.2, 0.6, 1);
        head.add(paw);
      }
      eyes(0.6, 0.27, 0.11, 0.13);
    }
    const stars = this.starRing(0.42);
    stars.position.y = 1.05;
    stars.visible = false;
    root.add(stars);
    root.visible = false;
    return { root, head, pupils, stars };
  }

  private geo!: Record<'body' | 'eye' | 'pupil' | 'nose' | 'tuft' | 'paw' | 'spike' | 'face' | 'hill' | 'hole' | 'clod', import('three').BufferGeometry>;
  private mat!: Record<'fur' | 'gold' | 'nose' | 'paw' | 'hogBody' | 'hogFace' | 'spike' | 'hill' | 'hole', Material>;

  private buildHills(sim: MolesSim) {
    const k = this.keep;
    this.geo = {
      body: k(new SphereGeometry(0.4, 8, 6)),
      eye: k(new SphereGeometry(0.1, 6, 4)),
      pupil: k(new SphereGeometry(0.05, 5, 3)),
      nose: k(new SphereGeometry(0.12, 6, 4)),
      tuft: k(new ConeGeometry(0.05, 0.18, 4)),
      paw: k(new SphereGeometry(0.12, 5, 3)),
      spike: k(new ConeGeometry(0.075, 0.36, 4)),
      face: k(new SphereGeometry(0.22, 6, 4)),
      hill: k(new CylinderGeometry(0.62, 1.05, HILL_H, 9)),
      hole: k(new CircleGeometry(0.5, 9)),
      clod: k(new IcosahedronGeometry(0.14, 0)),
    };
    this.mat = {
      fur: k(flat('#2d2630')),
      gold: k(flat('#ffc83a', { emissive: '#7a5200' })),
      nose: k(flat('#e0322a')),
      paw: k(flat('#f2a5a0')),
      hogBody: k(flat('#8a6a4a')),
      hogFace: k(flat('#ecd3a4')),
      spike: k(flat('#4c3422')),
      hill: k(flat('#7a5232')),
      hole: k(new MeshBasicMaterial({ color: '#1e120a' })),
    };
    const rnd = mulberry32(31);
    sim.holes.forEach((h) => {
      const hill = new Mesh(this.geo.hill, this.mat.hill);
      hill.position.set(h.x, HILL_H / 2, h.z);
      hill.rotation.y = rnd() * 3;
      const hole = new Mesh(this.geo.hole, this.mat.hole);
      hole.rotation.x = -Math.PI / 2;
      hole.position.set(h.x, HILL_H + 0.01, h.z);
      this.stage.add(hill, hole);
      for (let c = 0; c < 4; c++) {
        const a = rnd() * Math.PI * 2;
        const clod = new Mesh(this.geo.clod, this.mat.hill);
        clod.position.set(h.x + Math.cos(a) * (1.05 + rnd() * 0.3), 0.06, h.z + Math.sin(a) * (1.05 + rnd() * 0.3));
        clod.rotation.set(rnd() * 3, rnd() * 3, 0);
        this.stage.add(clod);
      }
      const root = new Group();
      root.position.set(h.x, HILL_H - 0.04, h.z);
      root.scale.setScalar(1.2);
      const slot: Slot = { root, mole: this.buildCritter('mole'), gold: this.buildCritter('gold'), hedgehog: this.buildCritter('hedgehog'), id: 0, kind: 'mole' };
      root.add(slot.mole.root, slot.gold.root, slot.hedgehog.root);
      this.stage.add(root);
      this.slots.push(slot);
    });
  }

  // ---- state ------------------------------------------------------------------------------------------

  reset(sim: MolesSim) {
    this.slots.forEach((s) => {
      s.id = 0;
      for (const c of [s.mole, s.gold, s.hedgehog]) c.root.visible = false;
    });
    this.actors.forEach((a, i) => {
      const p = sim.players[i];
      a.model.root.visible = !!p?.alive;
      a.yaw = p ? Math.atan2(p.fx, p.fz) : 0;
      a.model.root.position.set(p?.x ?? 0, 0, p?.z ?? 0);
      a.model.root.rotation.set(0, a.yaw, 0);
      a.model.body.rotation.set(0, 0, 0);
      a.model.body.position.set(0, 0, 0);
      a.stars.visible = false;
    });
  }

  hide(i: number) {
    const a = this.actors[i];
    if (a) a.model.root.visible = false;
  }

  events(ev: MolesEvent[], sim: MolesSim) {
    for (const e of ev) {
      switch (e.t) {
        case 'pop': {
          const h = sim.holes[e.c.hole];
          const dirt = e.c.kind === 'gold' ? ['#ffe680', '#a07448'] : ['#7a5232', '#a07448'];
          for (let k = 0; k < 9; k++) {
            const a = (k / 9) * Math.PI * 2 + Math.random();
            this.puffs.spawn(h.x + Math.cos(a) * 0.3, HILL_H + 0.1, h.z + Math.sin(a) * 0.3, Math.cos(a) * 2.2, 2.5 + Math.random() * 1.5, Math.sin(a) * 2.2, 0.18 + Math.random() * 0.1, 0.55, dirt[k % 2], 0.4);
          }
          break;
        }
        case 'hit': {
          const h = sim.holes[e.c.hole];
          const cols = e.kind === 'hedgehog' ? ['#ff6b6b', '#fff4c8'] : e.kind === 'gold' ? ['#ffe14a', '#fff8d0'] : ['#fff4c8', this.actors[e.p]?.color ?? '#fff'];
          for (let k = 0; k < (e.kind === 'gold' ? 18 : 10); k++) {
            const a = (k / 10) * Math.PI * 2;
            this.puffs.spawn(h.x, HILL_H + 0.7, h.z, Math.cos(a) * 3.2, 1.5 + Math.random() * 2.5, Math.sin(a) * 3.2, 0.16, 0.5, cols[k % 2], 0.6);
          }
          this.shake = Math.min(0.8, this.shake + (e.kind === 'hedgehog' ? 0.45 : e.kind === 'gold' ? 0.35 : 0.16));
          if (e.kind === 'gold') this.cheer = 1.2;
          break;
        }
        case 'swing': {
          const p = sim.players[e.p];
          const x = p.x + p.fx * 1.05;
          const z = p.z + p.fz * 1.05;
          for (let k = 0; k < 4; k++) this.puffs.spawn(x + (Math.random() - 0.5) * 0.5, 0.1, z + (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 1.5, 1 + Math.random(), (Math.random() - 0.5) * 1.5, 0.16, 0.4, '#a07448', 0.8);
          break;
        }
        case 'bonk': {
          const p = sim.players[e.p];
          for (let k = 0; k < 8; k++) {
            const a = (k / 8) * Math.PI * 2;
            this.puffs.spawn(p.x, 1.3, p.z, Math.cos(a) * 2.4, 1.5, Math.sin(a) * 2.4, 0.16, 0.45, k % 2 ? '#fff4c8' : '#ffe14a', 0.5);
          }
          this.shake = Math.min(0.9, this.shake + 0.4);
          break;
        }
        default:
          break;
      }
    }
  }

  toStage(x: number, y: number, z: number) {
    return this.stage.toStage(new Vector3(x, y, z));
  }

  // ---- drawing ----------------------------------------------------------------------------------------

  render(sim: MolesSim, dt: number) {
    this.time += dt;
    const t = this.time;

    // Critters.
    const shown = new Set<number>();
    for (const c of sim.critters) {
      const s = this.slots[c.hole];
      if (!s) continue;
      shown.add(c.hole);
      if (s.id !== c.id) {
        s.id = c.id;
        s.kind = c.kind;
        for (const k of ['mole', 'gold', 'hedgehog'] as const) s[k].root.visible = k === c.kind;
      }
      const cr = s[c.kind];
      let y: number;
      let squash = 1;
      if (c.by >= 0) {
        // Whacked: squashed flat, cross-eyed, seeing stars, then down it goes.
        const sinkT = (c.hitAge - DAZE) / SINK;
        y = sinkT > 0 ? -DEPTH * smooth(sinkT) : 0;
        squash = c.hitAge < 0.08 ? 1 - 4 * c.hitAge : 0.7 + 0.08 * Math.sin(c.hitAge * 20) * Math.max(0, 1 - c.hitAge * 2);
        cr.stars.visible = sinkT < 0.5;
        cr.stars.rotation.y = t * 7;
        cr.head.rotation.y = 0;
        cr.head.rotation.z = Math.sin(c.hitAge * 14) * 0.15;
        // Cross-eyed: the pupils slide in towards the nose.
        cr.pupils.forEach((p, i) => (p.position.x = (i ? 1 : -1) * (c.kind === 'hedgehog' ? 0.09 : 0.075)));
      } else {
        const upEnd = RISE + c.up;
        if (c.age < RISE) y = -DEPTH * (1 - easeOut(c.age / RISE));
        else if (c.age < upEnd) y = Math.sin((c.age - RISE) * 9) * 0.03;
        else y = -DEPTH * smooth((c.age - upEnd) / SINK);
        if (c.age < RISE + 0.1) squash = 1 + 0.18 * Math.sin(Math.min(1, c.age / (RISE + 0.1)) * Math.PI);
        cr.stars.visible = false;
        // Looking around: left, right, then at the nearest pierogi.
        cr.head.rotation.y = Math.sin((c.age - RISE) * 5 + c.id) * 0.6;
        cr.head.rotation.z = 0;
        cr.pupils.forEach((p, i) => (p.position.x = (i ? 1 : -1) * 0.13 + Math.sin(c.age * 5 + c.id) * 0.02));
      }
      cr.root.position.y = y;
      cr.root.scale.set(1 + (1 - squash) * 0.6, squash, 1 + (1 - squash) * 0.6);
      // Gold moles sparkle.
      if (c.kind === 'gold' && c.by < 0 && Math.random() < dt * 10) {
        const h = sim.holes[c.hole];
        this.puffs.spawn(h.x + (Math.random() - 0.5) * 0.8, HILL_H + 0.3 + Math.random() * 0.7, h.z + (Math.random() - 0.5) * 0.5, 0, 0.8, 0, 0.1, 0.5, '#fff3a0', 0.2);
      }
    }
    this.slots.forEach((s, k) => {
      if (!shown.has(k) && s.id) {
        s.id = 0;
        for (const c of [s.mole, s.gold, s.hedgehog]) c.root.visible = false;
      }
    });

    // Pierogi.
    this.actors.forEach((a, i) => {
      const p = sim.players[i];
      if (!p || !p.alive) return;
      const root = a.model.root;
      const body = a.model.body;
      root.position.set(p.x, 0, p.z);
      const want = Math.atan2(p.fx, p.fz);
      let d = want - a.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      a.yaw += d * Math.min(1, dt * 16);
      root.rotation.y = a.yaw;
      const moving = Math.hypot(p.vx, p.vz) > 0.3;
      if (moving) a.bob += dt * 14;
      let hop = moving ? Math.abs(Math.sin(a.bob)) * 0.12 : 0;
      let tilt = 0;
      let roll = moving ? Math.sin(a.bob) * 0.06 : 0;
      // Spoon: up and ready; a swing chops it down in front; pricked, it's dropped.
      const s = p.swing;
      let pitch = 0.25;
      let yaw = 0;
      if (s < 0.4) {
        if (s < 0.08) pitch = 0.25 + (1.9 - 0.25) * easeOut(s / 0.08);
        else if (s < 0.16) pitch = 1.9;
        else pitch = 1.9 - (1.9 - 0.25) * smooth((s - 0.16) / 0.24);
        yaw = 0.45 * Math.sin(Math.min(1, s / 0.16) * Math.PI * 0.5) * (s < 0.16 ? 1 : 1 - smooth((s - 0.16) / 0.24));
        tilt = s < 0.16 ? 0.15 : 0.15 * (1 - smooth((s - 0.16) / 0.24));
      }
      if (p.ouch > 0) {
        // Hopping about, holding the pricked hand up.
        hop = Math.abs(Math.sin(t * 16)) * 0.45;
        roll = Math.sin(t * 16) * 0.18;
        pitch = -0.6 + Math.sin(t * 30) * 0.3;
        yaw = -0.4;
        if (Math.random() < dt * 8) this.puffs.spawn(p.x, 1.4, p.z, (Math.random() - 0.5) * 1.5, 1.6, (Math.random() - 0.5) * 1.5, 0.12, 0.4, '#ff6b6b', 0.3);
      }
      a.stars.visible = p.stun > 0;
      if (p.stun > 0) {
        a.stars.rotation.y = t * 6;
        roll = Math.sin(t * 9) * 0.2;
        tilt = Math.cos(t * 7) * 0.12;
        hop = 0;
        pitch = 0.9;
      }
      body.position.y = hop / PIEROGI_SCALE;
      body.rotation.set(tilt, 0, roll);
      a.arm.rotation.y = yaw;
      a.spoon.rotation.x = pitch;
      a.model.shadow.scale.set(1 - hop * 0.6, 0.6, 1 - hop * 0.6);
      a.model.shadow.position.y = (0.03 - hop) / PIEROGI_SCALE;
    });

    // The garden moves a little.
    this.sunflowers.forEach((h, i) => (h.rotation.z = Math.sin(t * 1.3 + i) * 0.08));
    this.scarecrow.rotation.z = Math.sin(t * 0.9) * 0.025;
    if (this.babcia) {
      this.cheer = Math.max(0, this.cheer - dt);
      this.babcia.body.position.y = this.cheer > 0 ? Math.abs(Math.sin(this.cheer * 12)) * 0.3 : Math.abs(Math.sin(t * 2)) * 0.03;
      this.babcia.body.rotation.z = Math.sin(t * 1.1) * 0.05;
    }
    this.puffs.update(dt);

    // Camera: the whole bed from in front, a little above.
    const stage = this.stage;
    const span = Math.max(this.H * 1.5, this.W * 0.9);
    stage.lookAt(new Vector3(0, 0, 1.6), 7 + span, 0.84);
    if (this.shake > 0.01) {
      stage.camera.position.x += (Math.random() - 0.5) * this.shake * 0.5;
      stage.camera.position.y += (Math.random() - 0.5) * this.shake * 0.5;
      this.shake *= Math.exp(-8 * dt);
    }
    stage.render();
  }

  dispose() {
    this.stage.dispose();
  }
}
