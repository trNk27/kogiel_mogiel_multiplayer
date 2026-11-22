/**
 * Wesele in 3D: a village wedding hall at night, in the arena games' PS2 look. An LED dance floor that
 * flashes to the beat under a mirror ball and sweeping coloured beams, a disco polo band on the stage
 * (a keyboard player in shades and a singer in a white suit, between two thumping speakers), the head
 * table with the pierogi bride and groom, Wujek Zbyszek by the bar, and two round guest tables.
 *
 * The guests are pierogi in the players' colours. They walk out to the dance floor for the dances,
 * knock back shots (and get rosier, wobblier and finally tie the tie round their heads), cheer when they
 * win, bang the table for Gorzko, follow Wujek in a conga line, and slide under the table when it's all
 * too much. Everything is read from the game each frame, so second screens draw the same.
 */
import {
  AdditiveBlending,
  CanvasTexture,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  PlaneGeometry,
  PointLight,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
} from 'three';
import { ArenaStage, box, buildPierogi, flat, groundTexture, nameTag, pixelTexture, type PierogiModel } from '../arena/kit';
import { Puffs } from '../arena/puffs';
import { MOVE_SHOW_MS, TRAIN_BEATS } from './logic';
import type { Outcome, WeseleGame } from './WeseleGame';

export interface PlayerLook {
  name: string;
  color: string;
}

type Keep = <T extends { dispose(): void }>(x: T) => T;

const SCALE = 0.72;
const SEAT_Y = 0.42;
/** The disco polo band's tempo, for everything that bobs to the beat. */
const BPM = 126;
const NEON = ['#ff3dbb', '#36e6ff', '#ffe23d', '#9b5cff', '#3dff8a', '#ff7a2a'];
const FOLK = ['#d8322a', '#ffc72c', '#2f9e4f', '#3568b8', '#ff7ad1', '#ff8a2a'];

/** Guest tables: centre, and the seats round the back of each (angle, radians from +x; −π/2 is straight behind). */
const TABLES = [
  { x: -9.6, z: 0.6 },
  { x: 9.6, z: 0.6 },
];
/** Seats on the dance-floor side of each table (angles for the left table; the right one is mirrored). */
const SEAT_ANGLES = [-1.05, -0.35, 0.35, 1.05];
const SEAT_R = 2.1;
/** The dance floor's middle. */
const FLOOR = { x: 0, z: -2.4 };
const BAR = { x: 10.2, z: -7.2 };

const smooth = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};
const lerpAngle = (a: number, b: number, k: number) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
};
const faceTo = (x: number, z: number, tx: number, tz: number) => Math.atan2(tx - x, tz - z);

interface Actor {
  model: PierogiModel;
  tag: Sprite;
  color: string;
  pos: Vector3;
  face: number;
  walk: number;
  /** The shot glass in the hand, and what's in it. */
  glass: Group;
  liquid: Mesh;
  cheeks: Mesh;
  cheekMat: MeshBasicMaterial;
  tie: Group;
  bottle: Group;
  zzz: Sprite;
  /** The reaction playing now, and for how long it's been playing (s). */
  anim: Outcome | null;
  animT: number;
  spin: number;
  lastLive: number;
  liveT: number;
  gone: boolean;
}

interface Spot {
  x: number;
  z: number;
  face: number;
  /** Sitting on a chair at a table. */
  seated?: boolean;
  /** Lying under the table. */
  lying?: boolean;
}

export class WeseleScene {
  readonly stage: ArenaStage;
  private actors: Actor[] = [];
  private keep: Keep;
  private puffs = new Puffs(260, 6, 1.8);
  private confetti = new Puffs(300, 1.2, 1.1);
  private tiles: { m: Mesh; mat: MeshBasicMaterial; x: number; z: number }[] = [];
  private ball!: Group;
  private beams: { g: Group; mat: MeshBasicMaterial; spot: Mesh; phase: number }[] = [];
  private lights: PointLight[] = [];
  private speakers: Group[] = [];
  private band: PierogiModel[] = [];
  private notes: { s: Sprite; t: number; x: number }[] = [];
  private wujek!: PierogiModel;
  private wujekGlass!: Group;
  private wujekPos = new Vector3(BAR.x, 0, BAR.z);
  private wujekFace = 0;
  private bride!: PierogiModel;
  private groom!: PierogiModel;
  private heart!: Sprite;
  private flames: Mesh[] = [];
  private time = 0;
  private seenKey = '';

  constructor(canvas: HTMLCanvasElement, looks: PlayerLook[]) {
    this.stage = new ArenaStage(canvas, { sky: '#160c1c', fog: [34, 70], fov: 38 });
    const stage = this.stage;
    this.keep = (x) => stage.keep(x);
    // A dimmer, warmer room than the outdoor arenas: the disco lights do the rest.
    stage.sun.intensity = 1.05;
    stage.sun.color.set('#ffd9b0');
    stage.scene.children.forEach((c) => {
      const l = c as unknown as { isHemisphereLight?: boolean; isAmbientLight?: boolean; intensity: number };
      if (l.isHemisphereLight) l.intensity = 1.0;
      if (l.isAmbientLight) l.intensity = 0.25;
    });

    this.buildHall();
    this.buildDanceFloor();
    this.buildDisco();
    this.buildStage();
    this.buildHeadTable();
    this.buildBar();
    for (const t of TABLES) this.buildGuestTable(t.x, t.z);
    stage.add(this.puffs.mesh, this.confetti.mesh);

    looks.forEach((l, i) => this.actors.push(this.buildGuest(l, i)));
  }

  // ---- building the hall -----------------------------------------------------------------------------

  private buildHall() {
    const { stage, keep } = this;
    const boards = keep(groundTexture('wood', 22, 7));
    const fg = keep(new PlaneGeometry(64, 44));
    fg.rotateX(-Math.PI / 2);
    const floor = new Mesh(fg, keep(flat('#c9a27c', { map: boards })));
    floor.position.set(0, 0, 4);
    stage.add(floor);

    const wallZ = -11;
    const wall = box(48, 9, 0.4, keep(flat('#5a2f4a')));
    wall.position.z = wallZ;
    const wains = box(48, 1.6, 0.5, keep(flat('#3a1d2c')));
    wains.position.z = wallZ + 0.05;
    stage.add(wall, wains);
    for (const s of [-1, 1]) {
      const side = box(0.4, 9, 34, keep(flat('#4e2840')));
      side.position.set(s * 16.5, 0, 4);
      stage.add(side);
    }
    // Night-time windows, with a moon in one.
    const frame = keep(flat('#2a1420'));
    const night = keep(new MeshBasicMaterial({ color: '#1d2a5a' }));
    const star = keep(new MeshBasicMaterial({ color: '#fff4c8' }));
    for (const x of [-13.4, -10.2, 10.2, 13.4]) {
      const f = box(2.4, 3.6, 0.2, frame);
      f.position.set(x, 2.6, wallZ + 0.25);
      const g = box(2.0, 3.2, 0.2, night);
      g.position.set(x, 2.8, wallZ + 0.32);
      stage.add(f, g);
      for (let k = 0; k < 4; k++) {
        const s = new Mesh(keep(new PlaneGeometry(0.08, 0.08)), star);
        s.position.set(x - 0.7 + ((k * 37) % 14) / 10, 3.4 + ((k * 23) % 20) / 10, wallZ + 0.45);
        stage.add(s);
      }
    }
    const moon = new Mesh(keep(new CircleGeometry(0.35, 12)), keep(new MeshBasicMaterial({ color: '#fff2b8' })));
    moon.position.set(13.7, 5.0, wallZ + 0.45);
    stage.add(moon);

    // A big banner over the stage: "Młodej Parze Sto Lat!" (a long life to the young couple).
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 64;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff4dc';
    ctx.fillRect(0, 0, 512, 64);
    ctx.fillStyle = '#d8322a';
    for (let k = 0; k < 512; k += 16) ctx.fillRect(k, 0, 8, 5), ctx.fillRect(k + 8, 59, 8, 5);
    ctx.font = '900 36px "Fraunces Variable", Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#b5263c';
    ctx.fillText('❤ Młodej Parze Sto Lat! ❤', 256, 34);
    const tex = keep(new CanvasTexture(c));
    tex.colorSpace = SRGBColorSpace;
    tex.magFilter = tex.minFilter = NearestFilter;
    const banner = new Mesh(keep(new PlaneGeometry(12, 1.5)), keep(new MeshBasicMaterial({ map: tex, fog: false })));
    banner.position.set(0, 6.9, wallZ + 0.3);
    stage.add(banner);

    // Paper garlands across the ceiling, in folk colours.
    const tri = keep(new ConeGeometry(0.22, 0.46, 3));
    tri.rotateX(Math.PI);
    const mats = FOLK.map((col) => keep(flat(col)));
    const garland = (ax: number, az: number, bx: number, bz: number, y: number, sag: number) => {
      const n = Math.round(Math.hypot(bx - ax, bz - az) / 0.6);
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        const m = new Mesh(tri, mats[k % mats.length]);
        m.position.set(ax + (bx - ax) * t, y - Math.sin(t * Math.PI) * sag, az + (bz - az) * t);
        stage.add(m);
      }
    };
    garland(-16, -10.5, 16, -10.5, 8.2, 0.9);
    garland(-16, -10, -16, 8, 8.2, 1.2);
    garland(16, -10, 16, 8, 8.2, 1.2);
  }

  /** The LED dance floor: a grid of tiles that light up to the beat. */
  private buildDanceFloor() {
    const { stage, keep } = this;
    const S = 1.25;
    const geo = keep(new PlaneGeometry(S * 0.94, S * 0.94));
    geo.rotateX(-Math.PI / 2);
    const nx = 10;
    const nz = 7;
    const rim = box(nx * S + 0.4, 0.06, nz * S + 0.4, keep(flat('#1a0f16')));
    rim.position.set(FLOOR.x, 0, FLOOR.z);
    stage.add(rim);
    for (let ix = 0; ix < nx; ix++)
      for (let iz = 0; iz < nz; iz++) {
        const mat = keep(new MeshBasicMaterial({ color: '#221022' }));
        const m = new Mesh(geo, mat);
        const x = FLOOR.x + (ix - (nx - 1) / 2) * S;
        const z = FLOOR.z + (iz - (nz - 1) / 2) * S;
        m.position.set(x, 0.07, z);
        stage.add(m);
        this.tiles.push({ m, mat, x: ix - (nx - 1) / 2, z: iz - (nz - 1) / 2 });
      }
  }

  /** The mirror ball, its coloured beams and the spots they throw on the floor. */
  private buildDisco() {
    const { stage, keep } = this;
    const ballTex = keep(
      pixelTexture(16, (ctx, rnd) => {
        for (let y = 0; y < 16; y += 2)
          for (let x = 0; x < 16; x += 2) {
            const v = 150 + Math.floor(rnd() * 105);
            ctx.fillStyle = `rgb(${v},${v},${v + 10})`;
            ctx.fillRect(x, y, 2, 2);
          }
      }, 5, 3),
    );
    this.ball = new Group();
    const ball = new Mesh(keep(new IcosahedronGeometry(0.75, 1)), keep(new MeshBasicMaterial({ map: ballTex })));
    const string = box(0.04, 3, 0.04, keep(flat('#888')));
    string.position.y = 0.6;
    this.ball.add(ball, string);
    this.ball.position.set(FLOOR.x, 7.2, FLOOR.z);
    stage.add(this.ball);

    const coneGeo = keep(new ConeGeometry(1.5, 7.6, 14, 1, true));
    coneGeo.translate(0, -3.8, 0);
    const spotGeo = keep(new CircleGeometry(1.5, 16));
    spotGeo.rotateX(-Math.PI / 2);
    NEON.slice(0, 5).forEach((col, k) => {
      const mat = keep(new MeshBasicMaterial({ color: col, transparent: true, opacity: 0.13, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, fog: false }));
      const g = new Group();
      g.add(new Mesh(coneGeo, mat));
      g.position.copy(this.ball.position);
      const spotMat = keep(new MeshBasicMaterial({ color: col, transparent: true, opacity: 0.32, blending: AdditiveBlending, depthWrite: false }));
      const spot = new Mesh(spotGeo, spotMat);
      spot.position.y = 0.09;
      stage.add(g, spot);
      this.beams.push({ g, mat, spot, phase: (k / 5) * Math.PI * 2 });
    });
    // A few coloured lights that roam over the floor and tint the guests.
    for (const col of ['#ff3dbb', '#36e6ff', '#ffe23d']) {
      const l = new PointLight(col, 26, 16, 1.4);
      l.position.set(0, 4, FLOOR.z);
      stage.scene.add(l);
      this.lights.push(l);
    }
  }

  /** The stage at the back: the band between two speakers, and a neon heart. */
  private buildStage() {
    const { stage, keep } = this;
    const deck = box(11, 0.8, 3.8, keep(flat('#2a1622')));
    deck.position.set(0, 0, -8.9);
    const edge = box(11.1, 0.12, 0.2, keep(new MeshBasicMaterial({ color: '#ff3dbb' })));
    edge.position.set(0, 0.7, -7);
    stage.add(deck, edge);
    // Neon heart on the wall behind the band.
    const hc = document.createElement('canvas');
    hc.width = hc.height = 64;
    const hx = hc.getContext('2d')!;
    hx.strokeStyle = '#ff5ccf';
    hx.lineWidth = 6;
    hx.shadowColor = '#ff5ccf';
    hx.shadowBlur = 8;
    hx.beginPath();
    hx.moveTo(32, 54);
    hx.bezierCurveTo(4, 34, 6, 10, 22, 12);
    hx.bezierCurveTo(28, 13, 31, 18, 32, 22);
    hx.bezierCurveTo(33, 18, 36, 13, 42, 12);
    hx.bezierCurveTo(58, 10, 60, 34, 32, 54);
    hx.stroke();
    const ht = keep(new CanvasTexture(hc));
    ht.colorSpace = SRGBColorSpace;
    const heart = new Mesh(keep(new PlaneGeometry(3, 3)), keep(new MeshBasicMaterial({ map: ht, transparent: true, fog: false })));
    heart.position.set(0, 4.3, -10.7);
    stage.add(heart);

    // Speakers.
    const black = keep(flat('#18121a'));
    const cone = keep(flat('#4a4250'));
    const coneGeo = keep(new CylinderGeometry(0.42, 0.42, 0.08, 12));
    coneGeo.rotateX(Math.PI / 2);
    const smallGeo = keep(new CylinderGeometry(0.22, 0.22, 0.08, 10));
    smallGeo.rotateX(Math.PI / 2);
    for (const s of [-1, 1]) {
      const g = new Group();
      const cab = box(1.3, 2.6, 1, black);
      const woof = new Group();
      const w = new Mesh(coneGeo, cone);
      w.position.set(0, 0.85, 0.52);
      const tw = new Mesh(smallGeo, cone);
      tw.position.set(0, 1.9, 0.52);
      woof.add(w);
      g.add(cab, woof, tw);
      g.position.set(s * 4.7, 0.8, -8.7);
      stage.add(g);
      this.speakers.push(woof);
    }

    // The keyboard player, in shades.
    {
      const m = buildPierogi('#f4d9b5');
      m.mats.forEach((x) => keep(x));
      this.shades(m);
      const hair = new Mesh(keep(new SphereGeometry(0.5, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2)), keep(flat('#3a2014')));
      hair.scale.set(1.2, 0.5, 0.7);
      hair.position.set(0, 0.72, 0);
      m.body.add(hair);
      m.root.scale.setScalar(1.05);
      m.root.position.set(-2.3, 0.8, -9.2);
      m.root.rotation.y = 0.35;
      const kb = new Group();
      const body = box(2.0, 0.18, 0.7, keep(flat('#1d1a22')));
      const keys = box(1.8, 0.06, 0.3, keep(flat('#fff8ef')));
      keys.position.set(0, 0.16, 0.12);
      const leg = box(0.08, 0.9, 0.08, keep(flat('#555')));
      leg.position.y = -0.9;
      kb.add(body, keys, leg);
      kb.position.set(-2.1, 1.7, -8.2);
      kb.rotation.y = 0.35;
      stage.add(m.root, kb);
      this.band.push(m);
    }
    // The singer, in a white suit with a gold chain, at the mic.
    {
      const m = buildPierogi('#f8f4ee');
      m.mats.forEach((x) => keep(x));
      this.shades(m);
      const chain = new Mesh(keep(new TorusGeometry(0.32, 0.04, 4, 12)), keep(flat('#ffd23f')));
      chain.position.set(0, 0.12, 0.33);
      chain.rotation.x = 0.4;
      const quiff = new Mesh(keep(new SphereGeometry(0.4, 7, 4)), keep(flat('#1d1410')));
      quiff.scale.set(1.3, 0.55, 0.8);
      quiff.position.set(0.1, 0.84, 0.05);
      m.body.add(chain, quiff);
      m.root.scale.setScalar(1.1);
      m.root.position.set(1.2, 0.8, -8.4);
      const mic = new Group();
      const pole = box(0.05, 1.4, 0.05, keep(flat('#555')));
      const head = new Mesh(keep(new SphereGeometry(0.1, 6, 4)), keep(flat('#222')));
      head.position.y = 1.45;
      mic.add(pole, head);
      mic.position.set(1.2, 0.8, -7.6);
      stage.add(m.root, mic);
      this.band.push(m);
    }

    // Musical notes floating up from the band.
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const ctx = c.getContext('2d')!;
    ctx.font = '900 28px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#2a120a';
    ctx.strokeText('♪', 16, 17);
    ctx.fillStyle = '#ffe23d';
    ctx.fillText('♪', 16, 17);
    const t = keep(new CanvasTexture(c));
    t.magFilter = t.minFilter = NearestFilter;
    t.colorSpace = SRGBColorSpace;
    for (let k = 0; k < 8; k++) {
      const s = new Sprite(keep(new SpriteMaterial({ map: t, transparent: true })));
      s.scale.set(0.7, 0.7, 1);
      s.visible = false;
      stage.add(s);
      this.notes.push({ s, t: -1, x: 0 });
    }
  }

  private shades(m: PierogiModel) {
    const mat = this.keep(new MeshBasicMaterial({ color: '#0d0a10' }));
    for (const x of [-0.24, 0.24]) {
      const lens = box(0.3, 0.16, 0.06, mat);
      lens.position.set(x, 0.34, 0.33);
      m.body.add(lens);
    }
    const bridge = box(0.2, 0.04, 0.04, mat);
    bridge.position.set(0, 0.44, 0.34);
    m.body.add(bridge);
  }

  /** The head table, back left: the bride (veil, flower crown) and the groom (bow tie), and the cake. */
  private buildHeadTable() {
    const { stage, keep } = this;
    const x0 = -9.3;
    const z0 = -7.3;
    const cloth = box(6, 0.85, 1.4, keep(flat('#fbf6ea')));
    cloth.position.set(x0, 0, z0);
    const lace = box(6.04, 0.14, 1.44, keep(flat('#ff8fb1')));
    lace.position.set(x0, 0.6, z0);
    stage.add(cloth, lace);
    for (let k = 0; k < 6; k++) {
      const f = new Mesh(keep(new SphereGeometry(0.16, 5, 3)), keep(flat(k % 2 ? '#ff8fb1' : '#fff4dc')));
      f.position.set(x0 - 2.6 + k * 1.04, 0.62, z0 + 0.72);
      stage.add(f);
    }
    // The cake.
    const icing = keep(flat('#fff8ef'));
    const pink = keep(flat('#ff9fc8'));
    const cake = new Group();
    [0.5, 0.36, 0.22].forEach((r, k) => {
      const tier = new Mesh(keep(new CylinderGeometry(r, r, 0.3, 12)), icing);
      tier.position.y = 0.15 + k * 0.3;
      const trim = new Mesh(keep(new TorusGeometry(r, 0.04, 4, 14)), pink);
      trim.rotation.x = Math.PI / 2;
      trim.position.y = 0.3 + k * 0.3;
      cake.add(tier, trim);
    });
    cake.position.set(x0 + 2.2, 0.86, z0);
    stage.add(cake);

    this.bride = buildPierogi('#fff4e6');
    this.bride.mats.forEach((m) => keep(m));
    const veil = new Mesh(keep(new SphereGeometry(0.95, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2)), keep(flat('#ffffff', { transparent: true, opacity: 0.6, side: DoubleSide })));
    veil.scale.set(1.05, 1.15, 0.55);
    veil.position.set(0, 0.15, -0.12);
    this.bride.body.add(veil);
    for (let k = 0; k < 5; k++) {
      const fl = new Mesh(keep(new SphereGeometry(0.1, 5, 3)), keep(flat(FOLK[k])));
      const a = Math.PI * (0.25 + k * 0.125);
      fl.position.set(Math.cos(a) * 0.8, Math.sin(a) * 0.8 + 0.05, 0.2);
      this.bride.body.add(fl);
    }
    const bouquet = new Mesh(keep(new SphereGeometry(0.2, 6, 4)), keep(flat('#ff5c8a')));
    bouquet.position.set(0.55, 0.15, 0.42);
    this.bride.body.add(bouquet);
    this.bride.root.scale.setScalar(SCALE * 1.15);
    this.bride.root.position.set(x0 - 0.7, SEAT_Y, z0 - 0.95);

    this.groom = buildPierogi('#f3cf6b');
    this.groom.mats.forEach((m) => keep(m));
    const bowMat = keep(flat('#18121a'));
    for (const s of [-1, 1]) {
      const wing = new Mesh(keep(new ConeGeometry(0.12, 0.26, 4)), bowMat);
      wing.rotation.z = (s * Math.PI) / 2;
      wing.position.set(s * 0.13, 0.08, 0.36);
      this.groom.body.add(wing);
    }
    this.groom.root.scale.setScalar(SCALE * 1.15);
    this.groom.root.position.set(x0 + 0.7, SEAT_Y, z0 - 0.95);
    stage.add(this.bride.root, this.groom.root);

    const hc = document.createElement('canvas');
    hc.width = hc.height = 32;
    const hx = hc.getContext('2d')!;
    hx.font = '26px serif';
    hx.textAlign = 'center';
    hx.textBaseline = 'middle';
    hx.fillText('❤️', 16, 17);
    const ht = keep(new CanvasTexture(hc));
    ht.colorSpace = SRGBColorSpace;
    this.heart = new Sprite(keep(new SpriteMaterial({ map: ht, transparent: true })));
    this.heart.scale.set(1.1, 1.1, 1);
    this.heart.position.set(x0, 2.4, z0 - 0.9);
    this.heart.visible = false;
    stage.add(this.heart);
  }

  /** The bar, back right, where Wujek Zbyszek holds court. */
  private buildBar() {
    const { stage, keep } = this;
    const counter = box(4.2, 1.1, 1.2, keep(flat('#6a3a22')));
    counter.position.set(BAR.x, 0, BAR.z - 1.3);
    const top = box(4.4, 0.12, 1.4, keep(flat('#a8703c')));
    top.position.set(BAR.x, 1.1, BAR.z - 1.3);
    stage.add(counter, top);
    const bottleGeo = keep(new CylinderGeometry(0.11, 0.13, 0.62, 6));
    const neckGeo = keep(new CylinderGeometry(0.05, 0.06, 0.2, 5));
    const glassMat = keep(flat('#dff3ff', { transparent: true, opacity: 0.75 }));
    const label = keep(flat('#d8322a'));
    for (let k = 0; k < 7; k++) {
      const b = new Mesh(bottleGeo, k % 3 === 2 ? keep(flat('#3d7a3a')) : glassMat);
      b.position.set(BAR.x - 1.6 + k * 0.52, 1.47, BAR.z - 1.4);
      const n = new Mesh(neckGeo, label);
      n.position.set(b.position.x, 1.88, b.position.z);
      stage.add(b, n);
    }

    // Wujek Zbyszek: bald and red-faced, a big moustache, his tie round his forehead and a shot in hand.
    const w = buildPierogi('#f2a98a');
    w.mats.forEach((m) => keep(m));
    const tache = new Mesh(keep(new SphereGeometry(0.2, 7, 3)), keep(flat('#5a3a24')));
    tache.scale.set(1.9, 0.45, 0.55);
    tache.position.set(0, 0.2, 0.34);
    w.body.add(tache, this.tieBand('#c8243c'));
    const cheekMat = keep(new MeshBasicMaterial({ color: '#e8553f' }));
    for (const x of [-0.45, 0.45]) {
      const ch = new Mesh(keep(new SphereGeometry(0.12, 5, 3)), cheekMat);
      ch.position.set(x, 0.2, 0.3);
      ch.scale.z = 0.4;
      w.body.add(ch);
    }
    this.wujekGlass = this.shotGlass('#e8f6ff').g;
    this.wujekGlass.position.set(0.7, 0.55, 0.4);
    w.body.add(this.wujekGlass);
    w.root.scale.setScalar(SCALE * 1.3);
    stage.add(w.root);
    this.wujek = w;
  }

  /** A round guest table with a white cloth, plates, a bottle of vodka and a candle, and four chairs. */
  private buildGuestTable(x: number, z: number) {
    const { stage, keep } = this;
    const side = x < 0 ? 1 : -1;
    const cloth = new Mesh(keep(new CylinderGeometry(1.25, 1.38, 0.68, 16)), keep(flat('#fbf6ea')));
    cloth.position.set(x, 0.34, z);
    const lace = new Mesh(keep(new CylinderGeometry(1.4, 1.4, 0.08, 16)), keep(flat('#e7c35a')));
    lace.position.set(x, 0.42, z);
    const top = new Mesh(keep(new CylinderGeometry(1.3, 1.3, 0.05, 16)), keep(flat('#fffaf2')));
    top.position.set(x, 0.7, z);
    stage.add(cloth, lace, top);
    const plateGeo = keep(new CylinderGeometry(0.24, 0.2, 0.04, 10));
    const plateMat = keep(flat('#ffffff'));
    const stoolGeo = keep(new CylinderGeometry(0.32, 0.28, 0.4, 8));
    const stoolMat = keep(flat('#b8783e'));
    for (const a of SEAT_ANGLES) {
      const ang = side > 0 ? a : Math.PI - a;
      const p = new Mesh(plateGeo, plateMat);
      p.position.set(x + Math.cos(ang) * 0.9, 0.74, z + Math.sin(ang) * 0.9);
      const st = new Mesh(stoolGeo, stoolMat);
      st.position.set(x + Math.cos(ang) * SEAT_R, 0.2, z + Math.sin(ang) * SEAT_R);
      stage.add(p, st);
    }
    const bottle = new Mesh(keep(new CylinderGeometry(0.11, 0.13, 0.6, 6)), keep(flat('#dff3ff', { transparent: true, opacity: 0.8 })));
    bottle.position.set(x - side * 0.3, 1.02, z - 0.3);
    const cap = new Mesh(keep(new CylinderGeometry(0.06, 0.06, 0.16, 5)), keep(flat('#d8322a')));
    cap.position.set(x - side * 0.3, 1.39, z - 0.3);
    const candle = new Mesh(keep(new CylinderGeometry(0.06, 0.06, 0.36, 5)), keep(flat('#fff4dc')));
    candle.position.set(x - side * 0.4, 0.9, z + 0.35);
    const flame = new Mesh(keep(new SphereGeometry(0.07, 4, 3)), keep(new MeshBasicMaterial({ color: '#ffcf4a' })));
    flame.position.set(x - side * 0.4, 1.15, z + 0.35);
    flame.scale.y = 1.6;
    this.flames.push(flame);
    const bowl = new Mesh(keep(new SphereGeometry(0.34, 8, 4, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2)), keep(flat('#3568b8')));
    bowl.position.set(x, 0.96, z);
    stage.add(bottle, cap, candle, flame, bowl);
    const dumplings = keep(flat('#f3cf6b'));
    for (let k = 0; k < 4; k++) {
      const d = new Mesh(keep(new SphereGeometry(0.1, 5, 3)), dumplings);
      d.scale.set(1.4, 0.6, 1);
      d.position.set(x - 0.11 + (k % 2) * 0.22, 1.0, z - 0.09 + Math.floor(k / 2) * 0.18);
      stage.add(d);
    }
  }

  /** A tie knotted round the forehead, the classic end-of-the-night look. */
  private tieBand(color: string): Group {
    const { keep } = this;
    const g = new Group();
    const mat = keep(flat(color));
    const band = new Mesh(keep(new TorusGeometry(0.66, 0.07, 4, 16, Math.PI * 0.9)), mat);
    band.rotation.z = Math.PI * 0.05;
    band.scale.z = 1.6;
    band.position.set(0, 0.06, 0);
    const end = box(0.14, 0.42, 0.04, mat);
    end.position.set(0.62, 0.32, 0.12);
    end.rotation.z = -0.6;
    const end2 = end.clone();
    end2.position.set(0.7, 0.28, 0.08);
    end2.rotation.z = -1.1;
    const stripe = box(0.5, 0.05, 0.05, keep(flat('#ffd23f')));
    stripe.position.set(0, 0.76, 0.3);
    g.add(band, end, end2, stripe);
    return g;
  }

  private shotGlass(liquidColor: string): { g: Group; liquid: Mesh } {
    const { keep } = this;
    const g = new Group();
    const glass = new Mesh(keep(new CylinderGeometry(0.15, 0.11, 0.34, 8, 1, true)), keep(flat('#e8f6ff', { transparent: true, opacity: 0.55, side: DoubleSide })));
    const bottom = new Mesh(keep(new CylinderGeometry(0.11, 0.11, 0.05, 8)), keep(flat('#e8f6ff', { transparent: true, opacity: 0.8 })));
    bottom.position.y = -0.15;
    const liquid = new Mesh(keep(new CylinderGeometry(0.13, 0.11, 0.24, 8)), keep(new MeshBasicMaterial({ color: liquidColor, transparent: true, opacity: 0.85 })));
    liquid.position.y = -0.04;
    g.add(glass, bottom, liquid);
    return { g, liquid };
  }

  private buildGuest(l: PlayerLook, i: number): Actor {
    const { stage, keep } = this;
    const model = buildPierogi(l.color);
    model.mats.forEach((m) => keep(m));
    model.root.scale.setScalar(SCALE);
    const tag = nameTag(l.name, l.color);
    tag.position.set(0, 1.7 / SCALE, 0);
    tag.scale.set(2.0 / SCALE, 0.5 / SCALE, 1);
    model.root.add(tag);
    const { g: glass, liquid } = this.shotGlass('#f4fbff');
    glass.visible = false;
    model.body.add(glass);
    const cheekMat = keep(new MeshBasicMaterial({ color: '#ff4a5a', transparent: true, opacity: 0 }));
    const cheeks = new Mesh(keep(new SphereGeometry(0.11, 5, 3)), cheekMat);
    cheeks.position.set(-0.43, 0.2, 0.3);
    cheeks.scale.z = 0.4;
    const cheek2 = cheeks.clone();
    cheek2.position.x = 0.43;
    cheeks.add(cheek2);
    cheek2.position.set(0.86, 0, 0);
    model.body.add(cheeks);
    const tie = this.tieBand(i % 2 ? '#3568b8' : '#c8243c');
    tie.visible = false;
    model.body.add(tie);
    // A bottle that appears over the glass while pouring.
    const bottle = new Group();
    const bb = new Mesh(keep(new CylinderGeometry(0.16, 0.18, 0.8, 6)), keep(flat('#dff3ff', { transparent: true, opacity: 0.85 })));
    const lab = new Mesh(keep(new CylinderGeometry(0.185, 0.185, 0.26, 6)), keep(flat('#d8322a')));
    lab.position.y = -0.05;
    const neck = new Mesh(keep(new CylinderGeometry(0.06, 0.08, 0.3, 5)), keep(flat('#dff3ff')));
    neck.position.y = 0.52;
    bottle.add(bb, lab, neck);
    bottle.visible = false;
    model.root.add(bottle);
    // Zzz over a sleeping head.
    const zc = document.createElement('canvas');
    zc.width = 64;
    zc.height = 32;
    const zx = zc.getContext('2d')!;
    zx.font = '900 26px Georgia, serif';
    zx.fillStyle = '#cfe9ff';
    zx.strokeStyle = '#1d0f0a';
    zx.lineWidth = 4;
    zx.strokeText('Zzz', 6, 24);
    zx.fillText('Zzz', 6, 24);
    const zt = keep(new CanvasTexture(zc));
    zt.colorSpace = SRGBColorSpace;
    const zzz = new Sprite(keep(new SpriteMaterial({ map: zt, transparent: true, depthTest: false })));
    zzz.scale.set(1.4, 0.7, 1);
    zzz.visible = false;
    stage.add(zzz);
    stage.add(model.root);
    const s = this.seat(i);
    model.root.position.set(s.x, SEAT_Y, s.z);
    return {
      model,
      tag,
      color: l.color,
      pos: new Vector3(s.x, 0, s.z),
      face: s.face,
      walk: 0,
      glass,
      liquid,
      cheeks,
      cheekMat,
      tie,
      bottle,
      zzz,
      anim: null,
      animT: 0,
      spin: 0,
      lastLive: 0,
      liveT: 9,
      gone: false,
    };
  }

  // ---- where everyone goes -----------------------------------------------------------------------------

  /** Guest `i`'s seat: alternating between the two tables. */
  private seat(i: number): Spot {
    const t = TABLES[i % 2];
    const a0 = SEAT_ANGLES[Math.floor(i / 2) % SEAT_ANGLES.length];
    const a = t.x < 0 ? a0 : Math.PI - a0;
    const x = t.x + Math.cos(a) * SEAT_R;
    const z = t.z + Math.sin(a) * SEAT_R;
    return { x, z, face: faceTo(x, z, FLOOR.x, z + 6), seated: true };
  }

  private spotFor(game: WeseleGame, i: number): Spot {
    const g = game.guests[i];
    const seat = this.seat(i);
    const ch = game.ch;
    const onFloor = (game.phase === 'play' && game.inTask[i]) || (game.phase === 'result' && game.outcome[i] !== null);
    const a = this.actors[i];
    // Passed out (after the drinking's done): under their table.
    if (g.out && !(a.anim && a.animT < 1.7)) {
      const t = TABLES[i % 2];
      const k = Math.floor(i / 2) % 4;
      return { x: t.x - Math.sign(t.x) * (0.3 + k * 0.75), z: t.z + 2.5, face: 0, lying: true };
    }
    if (onFloor && ch) {
      const dancers = game.ids.map((_, j) => j).filter((j) => game.inTask[j] || (game.phase === 'result' && game.outcome[j] !== null));
      const k = dancers.indexOf(i);
      const n = dancers.length;
      if (ch === 'twirl') {
        const ang = -Math.PI / 2 + ((k + 0.5) / n) * Math.PI * 2;
        const x = FLOOR.x + Math.cos(ang) * 3.6;
        const z = FLOOR.z + 0.6 + Math.sin(ang) * 2.4;
        return { x, z, face: faceTo(x, z, FLOOR.x, FLOOR.z) };
      }
      if (ch === 'pair') {
        const pairs = game.pairs;
        const pk = pairs.findIndex((p) => p.a === i || p.b === i);
        const np = pairs.length;
        const gap = Math.min(4, 12 / Math.max(1, np));
        const cx = FLOOR.x + (pk - (np - 1) / 2) * gap;
        const left = pairs[pk]?.a === i;
        const x = cx + (left ? -0.65 : 0.65);
        return { x, z: FLOOR.z + 1.4, face: left ? Math.PI / 2 : -Math.PI / 2 };
      }
      if (ch === 'kaczuchy') {
        const x = FLOOR.x + (k - (n - 1) / 2) * Math.min(2.3, 11.5 / Math.max(1, n));
        return { x, z: FLOOR.z + 2.2, face: 0 };
      }
      if (ch === 'train') {
        const u = this.trainU(game) - (k + 1) * 0.55;
        return { ...this.trainAt(u), face: this.trainFace(u) };
      }
    }
    return seat;
  }

  /** Where the conga line's head is along its loop (radians), as a function of time. */
  private trainU(game: WeseleGame) {
    const t = (Date.now() - game.phaseAt) / 1000;
    return t * 0.55;
  }

  private trainAt(u: number) {
    return { x: FLOOR.x + Math.sin(u) * 4.6, z: FLOOR.z + 0.4 + Math.cos(u) * 2.7 };
  }

  private trainFace(u: number) {
    return Math.atan2(Math.cos(u) * 4.6, -Math.sin(u) * 2.7);
  }

  // ---- API --------------------------------------------------------------------------------------------

  hide(i: number) {
    const a = this.actors[i];
    if (!a) return;
    a.gone = true;
    a.model.root.visible = false;
    a.zzz.visible = false;
  }

  /** Where guest `i`'s head is on the 1920×1080 stage (for the labels over it). */
  headAt(i: number): { x: number; y: number; visible: boolean } {
    const a = this.actors[i];
    if (!a || a.gone) return { x: 0, y: 0, visible: false };
    const p = a.model.root.position;
    return this.stage.toStage(new Vector3(p.x, p.y + 2.2, p.z));
  }

  toStage(x: number, y: number, z: number) {
    return this.stage.toStage(new Vector3(x, y, z));
  }

  // ---- drawing ------------------------------------------------------------------------------------------

  render(game: WeseleGame, dt: number) {
    this.time += dt;
    const time = this.time;
    const beat = (time * BPM) / 60;
    const pulse = Math.pow(1 - (beat % 1), 3);
    const now = Date.now();

    // A new verdict: everyone reacts (drinks, cheers, sulks).
    const key = `${game.key}-${game.phase}`;
    if (key !== this.seenKey) {
      this.seenKey = key;
      const reacting = game.phase === 'result' || game.phase === 'toastShow';
      this.actors.forEach((a, i) => {
        const o = reacting ? game.outcome[i] : null;
        a.anim = o;
        a.animT = 0;
        if (o === 'win') this.burst(a, 18);
      });
    }

    this.animateRoom(game, time, beat, pulse, dt);
    this.animateWujek(game, time, beat, dt, now);

    this.actors.forEach((a, i) => {
      const g = game.guests[i];
      if (!g || a.gone || g.gone) {
        a.model.root.visible = false;
        a.zzz.visible = false;
        return;
      }
      a.model.root.visible = true;
      this.animateGuest(game, a, i, dt, time, beat, now);
    });

    this.puffs.update(dt);
    this.confetti.update(dt);

    // The camera drifts a little to the music, and leans in for the dance-floor challenges.
    const floorCh = game.phase === 'play' && (game.ch === 'twirl' || game.ch === 'pair' || game.ch === 'kaczuchy' || game.ch === 'train');
    const dist = floorCh ? 21 : 23.5;
    const target = new Vector3(Math.sin(time * 0.13) * 0.8, 0.6, -1.6);
    this.camDist += (dist - this.camDist) * (1 - Math.exp(-1.5 * dt));
    this.stage.lookAt(target, this.camDist, 0.6 + Math.sin(time * 0.09) * 0.02);
    this.stage.render();
  }

  private camDist = 23.5;

  private burst(a: Actor, n: number) {
    const p = a.model.root.position;
    for (let k = 0; k < n; k++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = 1.5 + Math.random() * 2.5;
      this.confetti.spawn(p.x, p.y + 1.2, p.z, Math.cos(ang) * sp, 3 + Math.random() * 3, Math.sin(ang) * sp, 0.1, 1.6, k % 3 ? a.color : NEON[k % NEON.length], 0);
    }
  }

  private animateRoom(game: WeseleGame, time: number, beat: number, pulse: number, dt: number) {
    // LED floor patterns change every 8 beats.
    const pattern = Math.floor(beat / 8) % 4;
    const b = Math.floor(beat);
    for (const t of this.tiles) {
      let on = 0;
      let hue = 0;
      if (pattern === 0) {
        on = (t.x + t.z + b) % 2 === 0 ? 1 : 0.15;
        hue = (b * 0.13 + 0.8) % 1;
      } else if (pattern === 1) {
        const d = Math.hypot(t.x, t.z * 1.2);
        on = Math.max(0.12, 1 - Math.abs(d - ((beat * 1.6) % 7)) * 0.7);
        hue = (d * 0.08 + time * 0.1) % 1;
      } else if (pattern === 2) {
        on = Math.abs(t.x * 2 - ((b % 10) - 4.5) * 2) < 1.5 ? 1 : 0.15;
        hue = (0.55 + t.z * 0.04) % 1;
      } else {
        const r = Math.sin(t.x * 12.9898 + t.z * 78.233 + b * 3.1) * 43758.5;
        on = r - Math.floor(r) > 0.6 ? 1 : 0.15;
        hue = (r - Math.floor(r)) % 1;
      }
      const light = 0.12 + on * (0.38 + 0.15 * pulse);
      t.mat.color.setHSL(hue, 0.85, light * (on > 0.5 ? 1 : 0.7));
    }
    // Mirror ball and beams.
    this.ball.rotation.y += dt * 0.8;
    this.beams.forEach((bm, k) => {
      const a = time * 0.5 + bm.phase;
      const tilt = 0.45 + Math.sin(time * 0.7 + k) * 0.2;
      bm.g.rotation.set(Math.cos(a) * tilt, 0, Math.sin(a) * tilt);
      // Where the beam hits the floor.
      const h = this.ball.position.y;
      const dir = new Vector3(0, -1, 0).applyEuler(bm.g.rotation);
      const s = h / Math.max(0.2, -dir.y);
      bm.spot.position.set(this.ball.position.x + dir.x * s, 0.09, this.ball.position.z + dir.z * s);
      bm.mat.opacity = 0.09 + 0.06 * pulse;
    });
    this.lights.forEach((l, k) => {
      const a = time * (0.4 + k * 0.13) + (k * Math.PI * 2) / 3;
      l.position.set(Math.sin(a) * 9, 3.5, FLOOR.z + 2 + Math.cos(a * 1.3) * 5);
      l.intensity = 18 + 14 * pulse;
    });
    // Speakers thump, the band bobs, notes float up.
    this.speakers.forEach((s) => s.scale.setScalar(1 + 0.12 * pulse));
    this.band.forEach((m, k) => {
      m.body.position.y = pulse * 0.1;
      m.body.rotation.z = Math.sin(beat * Math.PI * 0.5 + k) * 0.1;
      m.root.rotation.y = (k === 0 ? 0.35 : 0) + Math.sin(beat * Math.PI * 0.25 + k) * 0.15;
    });
    this.notes.forEach((n, k) => {
      if (n.t < 0) {
        if (Math.random() < dt * 1.6) {
          n.t = 0;
          n.x = (k % 2 ? 1.2 : -2.3) + (Math.random() - 0.5) * 0.8;
        }
        n.s.visible = false;
        return;
      }
      n.t += dt;
      const life = n.t / 2;
      if (life >= 1) {
        n.t = -1;
        n.s.visible = false;
        return;
      }
      n.s.visible = true;
      n.s.position.set(n.x + Math.sin(n.t * 4 + k) * 0.3, 2.8 + n.t * 1.6, -8.2);
      (n.s.material as SpriteMaterial).opacity = 1 - life;
    });
    this.flames.forEach((f, k) => f.scale.set(1 + Math.sin(time * 13 + k) * 0.15, 1.6 + Math.sin(time * 9 + k * 2) * 0.3, 1));

    // The couple sway; for Gorzko they kiss.
    const kiss = (game.phase === 'play' && game.ch === 'gorzko' && Date.now() >= game.goAt) || (game.phase === 'result' && game.ch === 'gorzko');
    [this.bride, this.groom].forEach((m, k) => {
      const s = k ? -1 : 1;
      const lean = kiss ? 0.35 + Math.sin(time * 4) * 0.05 : 0;
      m.body.rotation.z = -s * lean + Math.sin(beat * Math.PI * 0.5 + k) * 0.05;
      m.root.rotation.y = kiss ? s * 0.5 : 0;
      m.body.position.y = pulse * 0.05;
    });
    this.heart.visible = kiss;
    if (kiss) {
      this.heart.position.y = 2.4 + Math.sin(time * 5) * 0.1;
      this.heart.scale.setScalar(1 + pulse * 0.25);
    }
  }

  private animateWujek(game: WeseleGame, time: number, beat: number, dt: number, now: number) {
    const w = this.wujek;
    const ph = game.phase;
    const ch = game.ch;
    const live = ph === 'play' || ph === 'result';
    let tx = BAR.x;
    let tz = BAR.z;
    let face = faceTo(BAR.x, BAR.z, 0, 4);
    let mode: 'bar' | 'twirl' | 'demo' | 'train' | 'pair' = 'bar';
    if (live && ch === 'twirl') {
      tx = FLOOR.x;
      tz = FLOOR.z + 0.6;
      mode = 'twirl';
    } else if (live && ch === 'kaczuchy') {
      tx = FLOOR.x;
      tz = FLOOR.z - 2.4;
      face = 0;
      mode = 'demo';
    } else if (ph === 'play' && ch === 'train') {
      const u = this.trainU(game);
      ({ x: tx, z: tz } = this.trainAt(u));
      face = this.trainFace(u);
      mode = 'train';
    } else if (live && ch === 'pair') {
      const p = game.pairs.find((q) => q.b === null);
      if (p) {
        const a = this.actors[p.a];
        tx = a.pos.x + 1.3;
        tz = a.pos.z;
        face = -Math.PI / 2;
        mode = 'pair';
      }
    }
    const d = Math.hypot(tx - this.wujekPos.x, tz - this.wujekPos.z);
    const step = Math.min(d, dt * (mode === 'train' ? 12 : 5.5));
    if (d > 0.01) {
      this.wujekPos.x += ((tx - this.wujekPos.x) / d) * step;
      this.wujekPos.z += ((tz - this.wujekPos.z) / d) * step;
    }
    const walking = d > 0.15;
    w.root.position.set(this.wujekPos.x, 0, this.wujekPos.z);
    const body = w.body;
    body.rotation.set(0, 0, 0);
    body.position.set(0, 0, 0);
    body.scale.set(1, 1, 1);
    this.wujekGlass.visible = mode === 'bar' || mode === 'pair';
    if (walking) {
      this.wujekFace = lerpAngle(this.wujekFace, Math.atan2(tx - this.wujekPos.x, tz - this.wujekPos.z), 1 - Math.exp(-10 * dt));
      body.position.y = Math.abs(Math.sin(time * 10)) * 0.15;
      body.rotation.z = Math.sin(time * 10) * 0.12;
    } else if (mode === 'twirl' && ph === 'play' && now >= game.goAt) {
      this.wujekFace += dt * 9;
      body.position.y = Math.abs(Math.sin(beat * Math.PI)) * 0.2;
    } else if (mode === 'demo') {
      this.wujekFace = lerpAngle(this.wujekFace, face, 1 - Math.exp(-8 * dt));
      // Show the duck-dance moves one by one.
      const k = Math.floor((now - game.goAt) / MOVE_SHOW_MS);
      const m = ph === 'play' && now >= game.goAt && now < game.inputAt ? game.moves[k] : -1;
      const t = ((now - game.goAt) % MOVE_SHOW_MS) / 1000;
      this.doMove(body, m, t * 8);
      if (m < 0) body.position.y = Math.abs(Math.sin(beat * Math.PI)) * 0.1;
    } else {
      this.wujekFace = lerpAngle(this.wujekFace, face, 1 - Math.exp(-6 * dt));
      body.position.y = Math.abs(Math.sin(beat * Math.PI)) * (mode === 'train' ? 0.25 : 0.08);
      body.rotation.z = Math.sin(time * 1.3) * 0.1;
      // Every few seconds he knocks one back.
      const cycle = (time % 6) / 6;
      if (mode === 'bar' && cycle > 0.85) {
        const t = (cycle - 0.85) / 0.15;
        this.wujekGlass.position.set(0.7 - 0.5 * Math.sin(t * Math.PI), 0.55 + 0.3 * Math.sin(t * Math.PI), 0.4);
        this.wujekGlass.rotation.z = Math.sin(t * Math.PI) * 2;
        body.rotation.x = -Math.sin(t * Math.PI) * 0.3;
      } else {
        this.wujekGlass.position.set(0.7, 0.55 + 0.1 * Math.abs(Math.sin(beat * Math.PI)), 0.4);
        this.wujekGlass.rotation.z = 0;
      }
    }
    w.root.rotation.y = this.wujekFace;
  }

  /** A duck-dance move on a pierogi body: beak, wings, wiggle, clap. `t` runs 0… while it plays. */
  private doMove(body: Group, move: number, t: number) {
    const s = Math.sin(t * Math.PI);
    switch (move) {
      case 0: // Beak: snap forward.
        body.rotation.x = Math.abs(s) * 0.4;
        body.scale.set(1, 1 - Math.abs(s) * 0.1, 1 + Math.abs(s) * 0.15);
        break;
      case 1: // Wings: flap side to side.
        body.rotation.z = s * 0.35;
        body.scale.set(1 + Math.abs(s) * 0.2, 1, 1);
        break;
      case 2: // Wiggle: squat and shake.
        body.rotation.y = s * 0.6;
        body.position.y = -0.05;
        body.scale.set(1.1, 0.88, 1.1);
        break;
      case 3: // Clap: hop and squash.
        body.position.y = Math.abs(s) * 0.4;
        body.scale.set(1 + (1 - Math.abs(s)) * 0.15, 1 - (1 - Math.abs(s)) * 0.12, 1);
        break;
    }
  }

  private animateGuest(game: WeseleGame, a: Actor, i: number, dt: number, time: number, beat: number, now: number) {
    const g = game.guests[i];
    const root = a.model.root;
    const body = a.model.body;
    const spot = this.spotFor(game, i);
    const drunk = g.drunk;

    // Walk to the spot (a bit faster when far, to keep up with the conga line).
    const dx = spot.x - a.pos.x;
    const dz = spot.z - a.pos.z;
    const d = Math.hypot(dx, dz);
    const speed = game.ch === 'train' && game.phase === 'play' ? 9 : 5;
    const step = Math.min(d, dt * speed * (d > 3 ? 1.6 : 1));
    if (d > 0.001) {
      a.pos.x += (dx / d) * step;
      a.pos.z += (dz / d) * step;
    }
    const walking = d > 0.2;
    // Sitting: on the chair height once there.
    const y = spot.seated && !walking ? SEAT_Y : 0;
    root.position.set(a.pos.x, root.position.y + (y - root.position.y) * (1 - Math.exp(-10 * dt)), a.pos.z);

    body.rotation.set(0, 0, 0);
    body.position.set(0, 0, 0);
    body.scale.set(1, 1, 1);
    a.glass.visible = false;
    a.bottle.visible = false;
    a.zzz.visible = false;
    a.tag.material.opacity = 1;
    a.model.shadow.visible = !spot.seated;

    // Drunk looks: rosy cheeks, the tie round the head from 4.
    a.cheekMat.opacity = Math.min(0.85, drunk * 0.2);
    a.tie.visible = drunk >= 4 && !g.out;

    // Live progress: a burst of motion whenever it goes up.
    const live = game.phase === 'play' && game.inTask[i] ? game.live[i] : 0;
    if (live !== a.lastLive) {
      if (live > a.lastLive) a.liveT = 0;
      a.lastLive = live;
    }
    a.liveT += dt;

    if (spot.lying) {
      // Under the table, out cold.
      a.face = lerpAngle(a.face, 0, 1 - Math.exp(-5 * dt));
      root.rotation.y = a.face;
      body.rotation.z = Math.PI / 2 - 0.15;
      body.position.y = 0.55;
      body.scale.set(1, 1 + Math.sin(time * 2 + i) * 0.03, 1);
      a.tag.material.opacity = 0.5;
      a.zzz.visible = true;
      a.zzz.position.set(a.pos.x + 0.6, 1.5 + Math.sin(time * 2 + i) * 0.15, a.pos.z);
      return;
    }

    // Facing.
    let face = walking ? Math.atan2(dx, dz) : spot.face;
    const ph = game.phase;
    const ch = game.ch;
    const going = ph === 'play' && game.inTask[i] && now >= game.goAt;
    if (!walking && ph === 'play' && ch === 'twirl' && going) {
      a.spin += dt * (3 + Math.min(10, live * 0.9) + (a.liveT < 0.4 ? 8 : 0));
      face = spot.face + a.spin;
      a.face = face;
    } else {
      a.spin = 0;
      a.face = lerpAngle(a.face, face, 1 - Math.exp(-10 * dt));
    }
    root.rotation.y = a.face;

    // Wobble: the drunker, the wider.
    const sway = Math.sin(time * (1.4 + drunk * 0.15) + i * 1.7) * 0.035 * drunk;
    body.rotation.z = sway;
    if (drunk >= 5 && (time + i) % 3.1 < 0.15) body.position.y = 0.2; // hic!

    if (walking) {
      a.walk += dt * 11;
      body.position.y = Math.abs(Math.sin(a.walk)) * 0.18;
      body.rotation.z = sway + Math.sin(a.walk) * 0.12;
      return;
    }

    // Reactions to a verdict.
    if (a.anim) {
      a.animT += dt;
      const t = a.animT;
      if (a.anim === 'drink' || a.anim === 'out' || a.anim === 'toast' || a.anim === 'kompot') {
        this.drinkAnim(a, t, a.anim === 'kompot');
        if (a.anim === 'out' && t > 1.4) {
          const f = smooth((t - 1.4) / 0.5);
          body.rotation.z = f * (Math.PI / 2 - 0.15);
        }
        if (a.anim === 'drink' && t > 1.5 && t < 1.7 && Math.random() < 0.3)
          this.puffs.spawn(root.position.x, root.position.y + 1.1, root.position.z, (Math.random() - 0.5), 1.4, 0.3, 0.12, 0.6, '#ffffff');
        return;
      }
      if (a.anim === 'win') {
        body.position.y = Math.abs(Math.sin(t * 7)) * 0.7 * (t < 2.5 ? 1 : 0.3);
        body.scale.set(1 + Math.abs(Math.sin(t * 7)) * 0.08, 1 - Math.abs(Math.sin(t * 7)) * 0.06 + 0.04, 1);
        if (Math.random() < dt * 6) this.burst(a, 2);
        return;
      }
      // Safe: a happy little bob to the beat.
      body.position.y = Math.abs(Math.sin(beat * Math.PI)) * 0.15;
      return;
    }

    // Playing.
    if (ph === 'play' && game.inTask[i] && ch) {
      switch (ch) {
        case 'twirl':
          body.position.y = going ? Math.abs(Math.sin(beat * Math.PI)) * 0.25 : 0;
          body.rotation.z = sway + (going ? 0.15 : 0);
          return;
        case 'gorzko': {
          // Bang the table (bounce faster the faster they tap).
          const hit = a.liveT < 0.12;
          body.position.y = going ? (hit ? 0.22 : Math.abs(Math.sin(time * 14)) * 0.06) : 0;
          body.rotation.x = going ? 0.2 : 0;
          if (hit && Math.random() < 0.3) this.puffs.spawn(root.position.x + 0.3, 0.95, root.position.z + 0.6, 0, 1.2, 0.3, 0.08, 0.3, '#fff4dc');
          return;
        }
        case 'pour': {
          const pouring = a.liveT < 0.35 && !game.answered[i];
          a.glass.visible = true;
          a.glass.position.set(0, 0.25, 0.85);
          a.glass.rotation.set(0, 0, 0);
          a.liquid.scale.y = Math.max(0.02, Math.min(1.2, game.live[i]));
          a.liquid.position.y = -0.16 + 0.12 * a.liquid.scale.y;
          a.bottle.visible = pouring;
          a.bottle.position.set(0.35, 1.55, 1.0);
          a.bottle.rotation.set(0, 0, 1.9 + Math.sin(time * 9) * 0.05 * drunk);
          body.rotation.x = 0.15;
          return;
        }
        case 'kaczuchy': {
          // Repeating the moves: each new move makes them do one.
          if (a.liveT < 0.5) this.doMove(body, (a.lastLive + i) % 4, a.liveT * 4);
          else body.position.y = Math.abs(Math.sin(beat * Math.PI)) * 0.06;
          return;
        }
        case 'train': {
          // Hop on every beat of the train.
          const k = (now - game.goAt) / game.beat;
          const ph2 = k - Math.floor(k);
          body.position.y = k > -2 && k < TRAIN_BEATS ? Math.pow(1 - ph2, 3) * 0.35 : Math.abs(Math.sin(time * 8)) * 0.1;
          body.rotation.z = sway + Math.sin(time * 4 + i) * 0.1;
          return;
        }
        case 'pair': {
          const held = !game.answered[i];
          body.scale.set(1, held ? 0.94 : 1, 1);
          body.rotation.x = held ? 0.1 : -0.1;
          return;
        }
      }
    }

    // Idle: at the table, bopping to the music; the drunk ones a bit off the beat.
    body.position.y = Math.abs(Math.sin((beat + drunk * 0.13) * Math.PI)) * 0.06;
  }

  /** Raise the glass, knock it back, put it down. `kompot`: a red glass, sipped. */
  private drinkAnim(a: Actor, t: number, kompot: boolean) {
    const body = a.model.body;
    a.glass.visible = t < 1.8;
    (a.liquid.material as MeshBasicMaterial).color.set(kompot ? '#c8243c' : '#f4fbff');
    const up = smooth(t / 0.35);
    const back = smooth((t - 0.35) / 0.3) * (1 - smooth((t - 1.1) / 0.35));
    a.glass.position.set(0.7 - 0.55 * up, 0.35 + 0.45 * up, 0.5 + 0.15 * up);
    a.glass.rotation.set(0, 0, back * (kompot ? 1.2 : 2.3));
    a.liquid.scale.y = Math.max(0.02, 1 - smooth((t - 0.45) / 0.5));
    a.liquid.position.y = -0.16 + 0.12 * a.liquid.scale.y;
    body.rotation.x = -back * (kompot ? 0.15 : 0.4);
    if (!kompot && t > 1.1 && t < 1.6) {
      // A shudder as it goes down.
      body.scale.set(1 + Math.sin(t * 60) * 0.04, 1 - Math.sin(t * 60) * 0.03, 1);
    }
  }

  dispose() {
    for (const l of this.lights) this.stage.scene.remove(l);
    this.stage.dispose();
  }
}

