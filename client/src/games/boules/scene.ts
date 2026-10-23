/**
 * Bule in 3D: a village green on a summer afternoon. A long gravel pitch between wooden boards, a
 * red throwing circle at the near end, old men in flat caps on benches along the side, a big lime tree,
 * a beer garden under a striped umbrella and a wooden church far behind. The jack is a little golden
 * pierożek. Same PS2 look as the other arena games.
 */
import {
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  type MeshLambertMaterial,
  type Sprite,
  BufferGeometry,
  Float32BufferAttribute,
} from 'three';
import { ArenaStage, blobShadow, box, buildPierogi, flat, groundTexture, nameTag, type PierogiModel } from '../arena/kit';
import { Puffs } from '../arena/puffs';
import { mulberry32 } from '../rng';
import { BACK_Z, BALL_R, HALF_W, JACK_R, LOB, PITCH_L, RELEASE_Z, aimDir, landingPoint, throwDistance, type BoulesSim } from './logic';

export interface PlayerLook {
  name: string;
  color: string;
}

/** What the camera is doing. */
export type CamMode = 'intro' | 'aim' | 'flight' | 'judge' | 'measure';

type Keep = <T extends { dispose(): void }>(x: T) => T;

const BOARD_H = 0.26;
const BOARD_T = 0.16;
const DOTS = 26;
/** Where the thrower stands (behind the release point), and where the others wait. */
const THROW_SPOT = new Vector3(0, 0, 0.55);
const waitSpot = (k: number) => new Vector3(-3.5 - (k % 2) * 1.2, 0, 1.6 - Math.floor(k / 2) * 1.4 - (k % 2) * 0.7);

const smooth = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

interface Actor {
  model: PierogiModel;
  tag: Sprite;
  color: string;
  pos: Vector3;
  /** Seconds since throwing, or -1. */
  swing: number;
  /** Seconds since a cheer started, or -1. */
  cheer: number;
}

interface BallModel {
  root: Group;
  spin: Group;
  shadow: Mesh;
  q: Quaternion;
  rolled: number;
  /** Seconds since it died (sinks into the ditch), or -1. */
  dead: number;
}

interface OldMan {
  model: PierogiModel;
  /** Seconds since jumping up to cheer, or -1. */
  cheer: number;
  phase: number;
  seat: Vector3;
}

/** An old man: a pierogi with a flat cap and a moustache. */
function buildOldMan(keep: Keep, dough: string, cap: string): PierogiModel {
  const m = buildPierogi(dough);
  m.mats.forEach((x) => keep(x));
  const capMat = keep(flat(cap));
  const crown = new Mesh(keep(new CylinderGeometry(0.62, 0.7, 0.2, 9)), capMat);
  crown.position.set(0, 0.86, 0.02);
  crown.rotation.x = 0.18;
  crown.scale.z = 0.75;
  const peak = new Mesh(keep(new CylinderGeometry(0.42, 0.42, 0.06, 8, 1, false, 0, Math.PI)), capMat);
  peak.position.set(0, 0.8, 0.28);
  peak.rotation.y = -Math.PI / 2;
  peak.rotation.x = 0.25;
  const tache = new Mesh(keep(new SphereGeometry(0.12, 5, 3)), keep(flat('#e8e2d6')));
  tache.scale.set(2.3, 0.6, 0.8);
  tache.position.set(0, 0.26, 0.33);
  m.body.add(crown, peak, tache);
  return m;
}

export class BoulesScene {
  readonly stage: ArenaStage;
  private actors: Actor[] = [];
  private balls: BallModel[] = [];
  private ballGroup = new Group();
  private jack: PierogiModel;
  private jackMarker: Mesh;
  private dots: Mesh[] = [];
  private dotMat = new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false });
  private landRing: Mesh;
  private landMat = new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, side: DoubleSide, depthWrite: false });
  private tapes: Mesh[] = [];
  private tapeMat = new MeshBasicMaterial({ color: '#ffd23f', depthWrite: false });
  private ref: PierogiModel;
  private refPos = new Vector3(-3.1, 0, -6);
  private oldMen: OldMan[] = [];
  private leaves: Group[] = [];
  private flags: Mesh[] = [];
  private puffs = new Puffs(240, 7, 1.8);
  private looks: PlayerLook[];
  private time = 0;
  private shake = 0;
  private camPos = new Vector3(6, 8, 7);
  private camLook = new Vector3(0, 0, -7);
  /** Seconds since the jack was tossed out at the start of the end (-1: done). */
  private toss = -1;
  private tmpQ = new Quaternion();
  private tmpV = new Vector3();
  private keep: Keep;
  private ballGeo?: IcosahedronGeometry;
  private bandGeo?: TorusGeometry;
  private bandMat?: MeshLambertMaterial;
  private ballMats = new Map<string, MeshLambertMaterial>();
  private shadowGeo?: CircleGeometry;
  private shadowMat = new MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.4, depthWrite: false });

  constructor(canvas: HTMLCanvasElement, looks: PlayerLook[]) {
    this.looks = looks;
    this.stage = new ArenaStage(canvas, { sky: '#a6d8f0', fog: [45, 120], fov: 40 });
    const stage = this.stage;
    const keep: Keep = (x) => stage.keep(x);
    this.keep = keep;
    stage.keep(this.dotMat);
    stage.keep(this.landMat);
    stage.keep(this.tapeMat);
    stage.keep(this.shadowMat);
    this.buildGreen(keep);

    // The jack: a little golden pierożek with a bobbing marker over it.
    this.jack = buildPierogi('#ffc93c');
    this.jack.mats.forEach((m) => keep(m));
    this.jack.root.scale.setScalar(0.15);
    stage.add(this.jack.root);
    this.jackMarker = new Mesh(keep(new ConeGeometry(0.16, 0.34, 4)), keep(new MeshBasicMaterial({ color: '#ffd23f' })));
    this.jackMarker.rotation.x = Math.PI;
    stage.add(this.jackMarker);

    // The aim line and where the ball will land.
    const dotGeo = keep(new CircleGeometry(0.06, 6));
    dotGeo.rotateX(-Math.PI / 2);
    for (let k = 0; k < DOTS; k++) {
      const d = new Mesh(dotGeo, this.dotMat);
      d.renderOrder = 2;
      d.visible = false;
      this.dots.push(d);
      stage.add(d);
    }
    const rg = keep(new RingGeometry(0.22, 0.32, 14));
    rg.rotateX(-Math.PI / 2);
    this.landRing = new Mesh(rg, this.landMat);
    this.landRing.renderOrder = 2;
    this.landRing.visible = false;
    stage.add(this.landRing);

    // The measuring tapes.
    const tg = keep(new PlaneGeometry(1, 0.05));
    tg.rotateX(-Math.PI / 2);
    for (let k = 0; k < 3; k++) {
      const t = new Mesh(tg, this.tapeMat);
      t.renderOrder = 3;
      t.visible = false;
      this.tapes.push(t);
      stage.add(t);
    }

    // The ref, with a tape measure on his belt.
    this.ref = buildOldMan(keep, '#f0cfa6', '#2a2a30');
    const tapeBox = box(0.36, 0.3, 0.2, keep(flat('#ffd23f')));
    tapeBox.position.set(0.66, 0.08, 0.2);
    const whistle = new Mesh(keep(new SphereGeometry(0.08, 5, 3)), keep(flat('#d0d6dc')));
    whistle.position.set(-0.2, 0.12, 0.34);
    this.ref.body.add(tapeBox, whistle);
    this.ref.root.scale.setScalar(0.85);
    this.ref.root.position.copy(this.refPos);
    stage.add(this.ref.root);

    stage.add(this.ballGroup, this.puffs.mesh);
    looks.forEach((l, i) => {
      const model = buildPierogi(l.color);
      model.mats.forEach((m) => keep(m));
      const tag = nameTag(l.name, l.color);
      tag.position.set(0, 1.9, 0);
      tag.scale.set(2.6, 0.65, 1);
      model.root.scale.setScalar(0.72);
      model.root.add(tag);
      const pos = waitSpot(i);
      model.root.position.copy(pos);
      stage.add(model.root);
      this.actors.push({ model, tag, color: l.color, pos, swing: -1, cheer: -1 });
    });
  }

  // ---- scenery ----------------------------------------------------------------------------------------
  private buildGreen(keep: Keep) {
    const stage = this.stage;
    const grass = keep(groundTexture('grass', 26, 5));
    const g = keep(new PlaneGeometry(160, 140));
    g.rotateX(-Math.PI / 2);
    const ground = new Mesh(g, keep(flat('#ffffff', { map: grass })));
    ground.position.set(0, 0, -20);
    stage.add(ground);

    // The pitch: gravel between wooden boards.
    const len = PITCH_L + BACK_Z;
    const gravel = keep(groundTexture('sand', 1, 11));
    gravel.repeat.set(5, 18);
    const pg = keep(new PlaneGeometry(HALF_W * 2, len));
    pg.rotateX(-Math.PI / 2);
    const pitch = new Mesh(pg, keep(flat('#e4cfa0', { map: gravel })));
    pitch.position.set(0, 0.02, BACK_Z - len / 2);
    stage.add(pitch);
    const wood = keep(flat('#9a6436'));
    const woodDark = keep(flat('#7a4a26'));
    for (const s of [-1, 1]) {
      const b = box(BOARD_T, BOARD_H, len + BOARD_T * 2, wood);
      b.position.set(s * (HALF_W + BOARD_T / 2), 0, BACK_Z - len / 2);
      stage.add(b);
      // Stakes holding the boards.
      for (let z = BACK_Z - 0.5; z > -PITCH_L; z -= 3) {
        const st = box(0.12, BOARD_H + 0.08, 0.12, woodDark);
        st.position.set(s * (HALF_W + BOARD_T + 0.06), 0, z);
        stage.add(st);
      }
    }
    for (const z of [BACK_Z + BOARD_T / 2, -PITCH_L - BOARD_T / 2]) {
      const b = box(HALF_W * 2 + BOARD_T * 2, BOARD_H, BOARD_T, wood);
      b.position.set(0, 0, z);
      stage.add(b);
    }
    // A strip of darker "ditch" earth beyond the far board, where dead balls end up.
    const dg = keep(new PlaneGeometry(HALF_W * 2 + 1, 1.2));
    dg.rotateX(-Math.PI / 2);
    const ditch = new Mesh(dg, keep(flat('#6b5236')));
    ditch.position.set(0, 0.015, -PITCH_L - 0.8);
    stage.add(ditch);
    // The red throwing circle.
    const cg = keep(new RingGeometry(0.42, 0.52, 18));
    cg.rotateX(-Math.PI / 2);
    const circle = new Mesh(cg, keep(flat('#d8322a')));
    circle.position.set(0, 0.035, 0.1);
    stage.add(circle);

    // Benches with old men in flat caps along the right of the pitch.
    const benchWood = keep(flat('#b07a46'));
    const caps = ['#5a5148', '#3d4a5c', '#6b4a2e', '#4a5a3a', '#59403a', '#3c3c44'];
    const doughs = ['#efc9a0', '#e8bf94', '#f3d4ae'];
    let n = 0;
    for (const bz of [-3.2, -7.2, -11.2]) {
      const bench = new Group();
      const seat = box(0.55, 0.08, 2.6, benchWood);
      seat.position.y = 0.45;
      const back = box(0.08, 0.5, 2.6, benchWood);
      back.position.set(0.3, 0.55, 0);
      bench.add(seat, back);
      for (const lz of [-1.1, 1.1]) {
        const leg = box(0.5, 0.45, 0.08, benchWood);
        leg.position.z = lz;
        bench.add(leg);
      }
      bench.position.set(HALF_W + 1.5, 0, bz);
      stage.add(bench);
      for (const oz of [-0.62, 0.62]) {
        if (bz === -11.2 && oz > 0) continue;
        const man = buildOldMan(keep, doughs[n % doughs.length], caps[n % caps.length]);
        man.root.scale.setScalar(0.62);
        const seatPos = new Vector3(HALF_W + 1.45, 0.49, bz + oz);
        man.root.position.copy(seatPos);
        man.root.rotation.y = -Math.PI / 2;
        man.shadow.visible = false;
        stage.add(man.root);
        this.oldMen.push({ model: man, cheer: -1, phase: n * 1.7, seat: seatPos });
        n++;
      }
    }

    // A big lime tree (lipa) on the left.
    const bark = keep(flat('#6a4a30'));
    const leafMats = [keep(flat('#5c9a3a')), keep(flat('#4f8a30')), keep(flat('#6aa844'))];
    const leafGeo = keep(new IcosahedronGeometry(1, 0));
    const tree = (x: number, z: number, s: number, seed: number) => {
      const rnd = mulberry32(seed);
      const t = new Group();
      const trunk = new Mesh(keep(new CylinderGeometry(0.28, 0.42, 3.2, 7)), bark);
      trunk.position.y = 1.6;
      t.add(trunk);
      const crown = new Group();
      for (let k = 0; k < 7; k++) {
        const l = new Mesh(leafGeo, leafMats[k % 3]);
        const a = (k / 7) * Math.PI * 2;
        const r = k === 0 ? 0 : 1.3 + rnd() * 0.5;
        l.position.set(Math.cos(a) * r, 4 + rnd() * 1.4 + (k === 0 ? 1.2 : 0), Math.sin(a) * r);
        l.scale.setScalar(1.5 + rnd() * 0.7);
        l.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
        crown.add(l);
      }
      t.add(crown, blobShadow(3.2, 0.25));
      t.position.set(x, 0, z);
      t.scale.setScalar(s);
      stage.add(t);
      this.leaves.push(crown);
    };
    tree(-7.2, -9.5, 1.15, 3);
    tree(9.5, -21, 1, 8);
    tree(-12, -24, 0.9, 12);

    // A beer garden: a striped umbrella over a table with mugs, on the right near the circle.
    const garden = new Group();
    const pole = new Mesh(keep(new CylinderGeometry(0.06, 0.06, 2.6, 5)), keep(flat('#e9e2d2')));
    pole.position.y = 1.3;
    const stripes = [keep(flat('#d8322a')), keep(flat('#f6efe2'))];
    for (let k = 0; k < 8; k++) {
      const seg = new Mesh(keep(new ConeGeometry(2, 0.7, 2, 1, true, (k / 8) * Math.PI * 2, Math.PI / 4)), stripes[k % 2]);
      seg.position.y = 2.75;
      (seg.material as MeshLambertMaterial).side = DoubleSide;
      garden.add(seg);
    }
    const table = box(1.6, 0.08, 0.9, benchWood);
    table.position.y = 0.75;
    const tleg = box(0.1, 0.75, 0.1, benchWood);
    garden.add(pole, table, tleg);
    for (const sz of [-0.85, 0.85]) {
      const b = box(1.6, 0.06, 0.32, benchWood);
      b.position.set(0, 0.44, sz);
      garden.add(b);
    }
    const beer = keep(flat('#f2b632'));
    const foam = keep(flat('#fffaf0'));
    for (const [x, z] of [
      [-0.5, 0.15],
      [0.1, -0.2],
      [0.55, 0.2],
    ] as const) {
      const mug = new Mesh(keep(new CylinderGeometry(0.09, 0.09, 0.22, 7)), beer);
      mug.position.set(x, 0.9, z);
      const f = new Mesh(keep(new CylinderGeometry(0.1, 0.1, 0.05, 7)), foam);
      f.position.set(x, 1.02, z);
      garden.add(mug, f);
    }
    garden.add(blobShadow(1.9, 0.22));
    garden.position.set(HALF_W + 3.8, 0, 0.2);
    stage.add(garden);

    // A string of bunting over the far end.
    const flagCols = ['#ff3d6e', '#ffd23f', '#4f9dff', '#a3e048', '#fff4dc', '#ff8a2a'];
    const flagGeo = keep(new BufferGeometry());
    flagGeo.setAttribute('position', new Float32BufferAttribute([-0.18, 0, 0, 0.18, 0, 0, 0, -0.42, 0], 3));
    flagGeo.computeVertexNormals();
    const flagMats = flagCols.map((c) => keep(new MeshBasicMaterial({ color: c, side: DoubleSide })));
    const fz = -PITCH_L - 1.6;
    for (const x of [-HALF_W - 1.2, HALF_W + 1.2]) {
      const p = new Mesh(keep(new CylinderGeometry(0.07, 0.07, 3.8, 5)), woodDark);
      p.position.set(x, 1.9, fz);
      stage.add(p);
    }
    const span = (HALF_W + 1.2) * 2;
    for (let k = 0; k <= 14; k++) {
      const s = k / 14;
      const x = -span / 2 + s * span;
      const f = new Mesh(flagGeo, flagMats[k % flagMats.length]);
      f.position.set(x, 3.7 - Math.sin(s * Math.PI) * 0.7, fz);
      stage.add(f);
      this.flags.push(f);
    }

    // The village behind: a wooden church with a tower, a few cottages, a hedge.
    const timber = keep(flat('#8a5a3a'));
    const roofMat = keep(flat('#4a3a32'));
    const church = new Group();
    const nave = box(7, 4.5, 4.5, timber);
    const nroof = new Mesh(keep(new ConeGeometry(5.2, 3, 4)), roofMat);
    nroof.rotation.y = Math.PI / 4;
    nroof.scale.set(1, 1, 0.65);
    nroof.position.y = 6;
    const tower = box(2.6, 8, 2.6, timber);
    tower.position.x = -4.6;
    const spire = new Mesh(keep(new ConeGeometry(2.1, 4.5, 4)), roofMat);
    spire.rotation.y = Math.PI / 4;
    spire.position.set(-4.6, 10.2, 0);
    const cross = box(0.12, 1, 0.12, keep(flat('#e8c24a')));
    cross.position.set(-4.6, 12.4, 0);
    church.add(nave, nroof, tower, spire, cross);
    church.position.set(-3, 0, -44);
    stage.add(church);
    const white = keep(flat('#f6efe2'));
    const thatch = keep(flat('#c9a05a'));
    for (const [x, z, r] of [
      [12, -36, -0.3],
      [20, -30, -0.6],
      [-16, -36, 0.4],
    ] as const) {
      const c = new Group();
      const w = box(6, 3, 4.5, white);
      const rf = new Mesh(keep(new ConeGeometry(4.6, 2.8, 4)), thatch);
      rf.rotation.y = Math.PI / 4;
      rf.scale.set(1, 1, 0.7);
      rf.position.y = 4.3;
      const band = box(6.05, 0.22, 4.55, keep(flat('#3568b8')));
      band.position.y = 2.6;
      c.add(w, band, rf);
      c.position.set(x, 0, z);
      c.rotation.y = r;
      stage.add(c);
    }
    const hedge = keep(flat('#3f7a2c'));
    for (let x = -30; x <= 30; x += 2.4) {
      const h = new Mesh(leafGeo, hedge);
      h.position.set(x, 0.6, -28 + Math.sin(x) * 0.6);
      h.scale.set(1.5, 1, 1.1);
      stage.add(h);
    }
  }

  // ---- end set-up -------------------------------------------------------------------------------------
  /** A new end: no balls, and the jack is tossed out to its spot. */
  reset(sim: BoulesSim, gone: readonly number[]) {
    this.ballGroup.clear();
    this.balls = [];
    this.toss = 0;
    this.tapes.forEach((t) => (t.visible = false));
    this.refPos.set(-HALF_W - 1, 0, sim.jack.z + 1.5);
    this.actors.forEach((a, i) => {
      a.model.root.visible = !gone.includes(i);
      a.swing = a.cheer = -1;
    });
  }

  hide(i: number) {
    const a = this.actors[i];
    if (a) a.model.root.visible = false;
  }

  private ballModel(owner: number): BallModel {
    const color = this.looks[owner]?.color ?? '#cccccc';
    const root = new Group();
    const spin = new Group();
    const keep = this.keep;
    this.ballGeo ??= keep(new IcosahedronGeometry(BALL_R, 1));
    this.bandGeo ??= keep(new TorusGeometry(BALL_R * 0.98, 0.022, 4, 12));
    this.bandMat ??= keep(flat('#2a120a'));
    let mat = this.ballMats.get(color);
    if (!mat) {
      mat = keep(flat(color));
      this.ballMats.set(color, mat);
    }
    const body = new Mesh(this.ballGeo, mat);
    const band = new Mesh(this.bandGeo, this.bandMat);
    const band2 = band.clone();
    band2.rotation.y = Math.PI / 2;
    spin.add(body, band, band2);
    this.shadowGeo ??= keep(new CircleGeometry(BALL_R * 1.1, 8));
    const shadow = new Mesh(this.shadowGeo, this.shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    root.add(spin);
    this.ballGroup.add(root, shadow);
    return { root, spin, shadow, q: new Quaternion(), rolled: 0, dead: -1 };
  }

  // ---- events -----------------------------------------------------------------------------------------
  thrown(i: number) {
    const a = this.actors[i];
    if (a) a.swing = 0;
  }

  landed(x: number, z: number) {
    for (let k = 0; k < 8; k++) {
      const ang = (k / 8) * Math.PI * 2;
      this.puffs.spawn(x, 0.08, z, Math.cos(ang) * 1.2, 0.7 + Math.random() * 0.6, Math.sin(ang) * 1.2, 0.16 + Math.random() * 0.1, 0.55, '#e4cfa0');
    }
    this.shake = Math.min(0.5, this.shake + 0.12);
  }

  hit(x: number, z: number, strength: number, jack: boolean) {
    const n = Math.min(14, 3 + Math.round(strength * 3));
    for (let k = 0; k < n; k++) {
      const ang = Math.random() * Math.PI * 2;
      this.puffs.spawn(x, 0.2, z, Math.cos(ang) * 2, 1 + Math.random() * 2, Math.sin(ang) * 2, 0.08, 0.35, jack ? '#ffd23f' : '#fff4c8', 0.4);
    }
    if (strength > 0.8) {
      this.shake = Math.min(0.8, this.shake + strength * 0.12);
      this.oldMen.forEach((m) => Math.random() < 0.7 && (m.cheer = Math.random() * -0.3));
    }
  }

  died(x: number, z: number) {
    for (let k = 0; k < 10; k++) this.puffs.spawn(x + (Math.random() - 0.5) * 0.6, 0.15, z, (Math.random() - 0.5) * 1.5, 1 + Math.random() * 1.5, -0.6, 0.22, 0.7, '#8a6a46');
  }

  /** Everybody on the benches is impressed. */
  cheer(i?: number) {
    this.oldMen.forEach((m) => (m.cheer = Math.random() * -0.4));
    if (i !== undefined && this.actors[i]) this.actors[i].cheer = 0;
  }

  // ---- labels -----------------------------------------------------------------------------------------
  toStage(x: number, y: number, z: number) {
    return this.stage.toStage(new Vector3(x, y, z));
  }

  // ---- drawing ----------------------------------------------------------------------------------------
  render(sim: BoulesSim, mode: CamMode, dt: number, opts: { thrower: number; gone: readonly number[]; measured: number[] }) {
    this.time += dt;
    const t = this.time;
    const jack = sim.jack;

    // The jack (tossed out at the start of the end).
    let jx = jack.x;
    let jz = jack.z;
    let jy = 0;
    if (this.toss >= 0) {
      this.toss += dt;
      const k = smooth(this.toss / 1.4);
      jx = jack.x * k;
      jz = RELEASE_Z + (jack.z - RELEASE_Z) * k;
      jy = Math.sin(Math.min(1, this.toss / 1.4) * Math.PI) * 2.2;
      if (this.toss >= 1.4) {
        this.toss = -1;
        this.landed(jack.x, jack.z);
      }
    }
    this.jack.root.position.set(jx, jy, jz);
    this.jack.root.rotation.y = Math.PI + jack.rolled * 4;
    this.jackMarker.position.set(jx, 0.85 + Math.sin(t * 3) * 0.12 + jy, jz);
    this.jackMarker.rotation.y = t * 2;
    this.jackMarker.visible = mode !== 'measure';

    // Balls.
    sim.balls.forEach((b, idx) => {
      let m = this.balls[idx];
      if (!m) {
        m = this.ballModel(b.owner);
        this.balls[idx] = m;
      }
      if (b.out === 'gone') {
        m.root.visible = m.shadow.visible = false;
        return;
      }
      if (!b.alive) {
        if (m.dead < 0) m.dead = 0;
        m.dead += dt;
        // Drops into the ditch beyond the far board.
        const k = Math.min(1, m.dead / 0.5);
        m.root.position.set(b.x, BALL_R - k * 0.12, -PITCH_L - 0.25 - k * 0.5);
        m.shadow.visible = false;
        return;
      }
      const dRoll = b.rolled - m.rolled;
      m.rolled = b.rolled;
      const sp = Math.hypot(b.vx, b.vz);
      if (dRoll > 0 && sp > 0) {
        // Roll about the axis across the direction of travel (up × direction).
        this.tmpQ.setFromAxisAngle(this.tmpV.set(b.vz / sp, 0, -b.vx / sp), dRoll / BALL_R);
        m.q.premultiply(this.tmpQ);
        m.spin.quaternion.copy(m.q);
      } else if (b.air > 0) {
        m.spin.rotation.x -= dt * 6;
      }
      m.root.position.set(b.x, b.y, b.z);
      m.shadow.visible = true;
      m.shadow.position.set(b.x, 0.035, b.z);
      const h = Math.max(0, b.y - BALL_R);
      m.shadow.scale.setScalar(1 + h * 0.6);
    });

    // The aim line, while someone is aiming.
    const aiming = sim.phase === 'aim' && opts.thrower >= 0;
    const col = this.looks[opts.thrower]?.color ?? '#ffffff';
    if (aiming) {
      this.dotMat.color.set(col);
      this.landMat.color.set(col);
      const dir = aimDir(sim.aim);
      const len = sim.charging ? LOB * throwDistance(sim.power) : 5;
      for (let k = 0; k < DOTS; k++) {
        const s = (k + ((t * 1.5) % 1)) / DOTS;
        const d = this.dots[k];
        d.visible = s * len > 0.3;
        d.position.set(dir.x * s * len, 0.05, RELEASE_Z + dir.z * s * len);
        d.scale.setScalar(sim.charging ? 1 : 0.8);
      }
      this.landRing.visible = sim.charging;
      if (sim.charging) {
        const lp = landingPoint(sim.aim, sim.power);
        this.landRing.position.set(lp.x, 0.05, lp.z);
        this.landRing.scale.setScalar(1 + Math.sin(t * 10) * 0.08);
      }
    } else {
      this.dots.forEach((d) => (d.visible = false));
      this.landRing.visible = false;
    }

    // The measuring tapes, from the jack to the closest balls.
    this.tapes.forEach((tp, k) => {
      const bi = opts.measured[k];
      const b = bi !== undefined ? sim.balls[bi] : undefined;
      if (mode !== 'measure' || !b || !b.alive) {
        tp.visible = false;
        return;
      }
      const dx = b.x - jack.x;
      const dz = b.z - jack.z;
      const d = Math.hypot(dx, dz);
      tp.visible = true;
      tp.position.set((b.x + jack.x) / 2, 0.06 + k * 0.004, (b.z + jack.z) / 2);
      tp.scale.set(Math.max(0.01, d - JACK_R * 0.5), 1, 1);
      tp.rotation.y = -Math.atan2(dz, dx);
    });

    // The ref walks to the jack to measure, then back to the side.
    const refTarget = mode === 'measure' ? this.tmpV.set(jack.x - 0.9, 0, jack.z + 0.5) : new Vector3(-HALF_W - 1, 0, jack.z + 1.5);
    const before = this.ref.root.position.clone();
    this.refPos.lerp(refTarget, 1 - Math.exp(-2.2 * dt));
    this.ref.root.position.copy(this.refPos);
    const walked = before.distanceTo(this.refPos);
    this.ref.body.position.y = walked > 0.002 ? Math.abs(Math.sin(t * 12)) * 0.12 : 0;
    this.ref.root.rotation.y = mode === 'measure' ? Math.PI * 0.75 : Math.PI / 2;
    this.ref.body.rotation.x = mode === 'measure' && walked < 0.01 ? 0.45 : 0;

    // Players: the thrower at the circle, the rest waiting by the side.
    let w = 0;
    this.actors.forEach((a, i) => {
      if (opts.gone.includes(i)) {
        a.model.root.visible = false;
        return;
      }
      const isThrower = i === opts.thrower;
      const spot = isThrower ? THROW_SPOT : waitSpot(w++);
      const before = a.pos.clone();
      a.pos.lerp(spot, 1 - Math.exp(-4 * dt));
      const walking = before.distanceTo(a.pos) > 0.004;
      const root = a.model.root;
      const body = a.model.body;
      root.position.copy(a.pos);
      root.rotation.y = isThrower ? Math.PI + (sim.phase === 'aim' ? -sim.aim : 0) : walking ? Math.atan2(spot.x - a.pos.x, spot.z - a.pos.z) : Math.PI / 2 + 0.4;
      let rx = 0;
      let hop = walking ? Math.abs(Math.sin(t * 11 + i)) * 0.15 : 0;
      if (isThrower && sim.charging) rx = 0.15 + Math.sin(t * 8) * 0.03;
      if (a.swing >= 0) {
        a.swing += dt;
        const k = a.swing / 0.6;
        rx = k < 1 ? 0.5 * Math.sin(k * Math.PI) : 0;
        if (k >= 1) a.swing = -1;
      }
      if (a.cheer >= 0) {
        a.cheer += dt;
        hop = Math.abs(Math.sin(a.cheer * 9)) * 0.45;
        if (a.cheer > 1.4) a.cheer = -1;
      }
      body.rotation.x = rx;
      body.position.y = hop;
      body.rotation.z = Math.sin(t * 2.4 + i) * 0.03;
    });

    // Old men nod along, and jump up when something good happens.
    this.oldMen.forEach((m) => {
      const r = m.model.root;
      if (m.cheer > -1 && m.cheer !== -1) {
        m.cheer += dt;
        if (m.cheer >= 0) {
          r.position.y = m.seat.y + Math.abs(Math.sin(m.cheer * 8)) * 0.35;
          m.model.body.rotation.z = Math.sin(m.cheer * 14) * 0.15;
          if (m.cheer > 1.2) {
            m.cheer = -1;
            r.position.y = m.seat.y;
            m.model.body.rotation.z = 0;
          }
        }
      } else {
        m.model.body.rotation.x = Math.sin(t * 1.1 + m.phase) * 0.05;
        // Watch the ball.
        const look = sim.current >= 0 ? sim.balls[sim.current] : jack;
        const dz = (look?.z ?? jack.z) - m.seat.z;
        r.rotation.y = -Math.PI / 2 - Math.max(-0.7, Math.min(0.7, -dz * 0.12));
      }
    });

    this.leaves.forEach((l, k) => (l.rotation.z = Math.sin(t * 0.9 + k) * 0.02));
    this.flags.forEach((f, k) => (f.rotation.y = Math.sin(t * 3 + k) * 0.4));
    this.puffs.update(dt);

    // Camera.
    const pos = this.tmpV;
    const look = new Vector3();
    switch (mode) {
      case 'intro':
        pos.set(6.5, 7.5, 5);
        look.set(0, 0, -7.5);
        break;
      case 'aim': {
        const dir = aimDir(sim.aim);
        pos.set(dir.x * -1.5, 2.9, 3.9);
        look.set(jack.x * 0.5 + dir.x * 4, 0, -7);
        break;
      }
      case 'flight': {
        const b = sim.current >= 0 ? sim.balls[sim.current] : undefined;
        const bz = b && b.alive ? b.z : jack.z;
        const bx = b && b.alive ? b.x : jack.x;
        pos.set(bx * 0.6, 2.6, Math.min(3.9, bz + 4.6));
        look.set(bx * 0.8, 0, bz - 2.2);
        break;
      }
      case 'judge':
        pos.set(jack.x * 0.8, 6.4, jack.z + 4.4);
        look.set(jack.x, 0, jack.z - 0.4);
        break;
      case 'measure':
        pos.set(jack.x * 0.8 + 0.4, 4.4, jack.z + 2.8);
        look.set(jack.x, 0, jack.z - 0.15);
        break;
    }
    const k = 1 - Math.exp(-(mode === 'flight' ? 3.2 : 2.2) * dt);
    this.camPos.lerp(pos, k);
    this.camLook.lerp(look, k);
    const cam = this.stage.camera;
    cam.position.copy(this.camPos);
    if (this.shake > 0.01) {
      cam.position.x += (Math.random() - 0.5) * this.shake * 0.25;
      cam.position.y += (Math.random() - 0.5) * this.shake * 0.25;
      this.shake *= Math.exp(-7 * dt);
    }
    cam.lookAt(this.camLook);
    this.stage.render();
  }

  dispose() {
    this.stage.dispose();
  }
}
