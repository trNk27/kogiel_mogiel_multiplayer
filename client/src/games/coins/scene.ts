/**
 * Grosze in 3D: a cobbled old-town market square at golden hour. Tall painted tenements (kamienice)
 * with balconies and window boxes stand along the back and the left, a brick town-hall tower with a
 * clock and a green spire in the corner, market stalls on the right, lanterns at the corners. Coins
 * rain down with growing shadows; babcias lean out of the windows and lob flower pots and pans.
 * Same PS2 look as the other arena games.
 */
import {
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  RingGeometry,
  SphereGeometry,
  Vector3,
  type BufferGeometry,
  type Material,
  type Sprite,
} from 'three';
import { ArenaStage, blobShadow, box, buildPierogi, flat, groundTexture, nameTag, pixelTexture, type PierogiModel } from '../arena/kit';
import { buildBabcia } from '../arena/babcia';
import { Puffs } from '../arena/puffs';
import { mulberry32 } from '../rng';
import { COIN_LIFE, COIN_R, FADE_T, HAZARD_R, HAZARD_T, WINDOWS, type Coin, type CoinKind, type CoinsEvent, type CoinsSim, type Hazard } from './logic';

export interface PlayerLook {
  name: string;
  color: string;
}

type Keep = <T extends { dispose(): void }>(x: T) => T;

const TAU = Math.PI * 2;
const COIN_COLORS: Record<CoinKind, string> = { copper: '#d97a3f', silver: '#e4e9ee', gold: '#ffcc2e' };
const COIN_RIM: Record<CoinKind, string> = { copper: '#a4512a', silver: '#aab4bf', gold: '#d99a0a' };
const SKY = new Color('#f2a879');
const GOLD_SKY = new Color('#ffd36a');
/** When the babcia lets go of the pot (seconds after the throw starts). */
const RELEASE = 0.3;

const smooth = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

function angleDiff(a: number, b: number) {
  let d = b - a;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
}

/** Striped awning canvas. */
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

interface Actor {
  model: PierogiModel;
  tag: Sprite;
  color: string;
  stars: Group;
  facing: number;
  phase: number;
  /** Seconds since the last bonk / bump / dash, or -1. */
  bonk: number;
  bump: number;
  dash: number;
  /** Seconds since the last pickup (a little hop). */
  pick: number;
}

interface CoinView {
  root: Group;
  coin: Group;
  shadow: Mesh;
  shadowMat: MeshBasicMaterial;
  kind: CoinKind;
  land: number;
  seen: boolean;
}

interface HazardView {
  obj: Group;
  marker: Group;
  disc: MeshBasicMaterial;
  ring: MeshBasicMaterial;
  kind: 'pot' | 'pan';
  seen: boolean;
}

interface Window {
  /** The window's middle, its outward normal, and the babcia who lives there. */
  at: Vector3;
  normal: Vector3;
  babcia: PierogiModel;
  /** 0 = inside, 1 = leaning right out. */
  out: number;
  /** Seconds left of the current throw. */
  busy: number;
}

export class CoinsScene {
  readonly stage: ArenaStage;
  private actors: Actor[] = [];
  private coinViews = new Map<number, CoinView>();
  private coinPool: Record<CoinKind, CoinView[]> = { copper: [], silver: [], gold: [] };
  private hazViews = new Map<number, HazardView>();
  private hazPool: Record<'pot' | 'pan', HazardView[]> = { pot: [], pan: [] };
  private windows: Window[] = [];
  private lanterns: MeshBasicMaterial[] = [];
  private pigeons: Group[] = [];
  private clockHand!: Group;
  private puffs = new Puffs(260, 9, 1.8);
  private sparkle = new Puffs(160, 3, 0.4);
  private coinGeo: Record<CoinKind, BufferGeometry>;
  private faceGeo: Record<CoinKind, BufferGeometry>;
  private coinMat: Record<CoinKind, Material>;
  private faceMat: Record<CoinKind, Material>;
  private keepFn: Keep;
  private shadowGeo: BufferGeometry | null = null;
  private time = 0;
  private shake = 0;
  private gold = 0;
  private readonly hw: number;
  private readonly hd: number;
  private tmp = new Vector3();

  constructor(canvas: HTMLCanvasElement, looks: PlayerLook[], sim: CoinsSim) {
    this.hw = sim.hw;
    this.hd = sim.hd;
    const stage = (this.stage = new ArenaStage(canvas, { sky: SKY.getStyle(), fog: [55, 140], fov: 40 }));
    stage.sun.color.set('#ffc890');
    stage.sun.intensity = 1.75;
    stage.sun.position.set(-0.7, 0.75, 0.5);
    const keep: Keep = (x) => stage.keep(x);
    this.keepFn = keep;

    this.buildGround(keep);
    this.buildTenements(keep);
    this.buildTownHall(keep);
    this.buildStalls(keep);
    this.buildDecor(keep);

    // Coins: a disc with a raised middle, standing on edge and spinning.
    const mk = (k: CoinKind) => {
      const r = COIN_R[k] * (k === 'gold' ? 1.05 : 1.25);
      const g = keep(new CylinderGeometry(r, r, 0.1, 12));
      g.rotateX(Math.PI / 2);
      const f = keep(new CylinderGeometry(r * 0.66, r * 0.66, 0.14, 10));
      f.rotateX(Math.PI / 2);
      return [g, f] as const;
    };
    const kinds: CoinKind[] = ['copper', 'silver', 'gold'];
    this.coinGeo = Object.fromEntries(kinds.map((k) => [k, mk(k)[0]])) as unknown as Record<CoinKind, BufferGeometry>;
    this.faceGeo = Object.fromEntries(kinds.map((k) => [k, mk(k)[1]])) as unknown as Record<CoinKind, BufferGeometry>;
    this.coinMat = Object.fromEntries(
      kinds.map((k) => [k, keep(new MeshLambertMaterial({ color: COIN_COLORS[k], emissive: new Color(COIN_COLORS[k]).multiplyScalar(0.35), flatShading: true }))]),
    ) as unknown as Record<CoinKind, Material>;
    this.faceMat = Object.fromEntries(
      kinds.map((k) => [k, keep(new MeshLambertMaterial({ color: COIN_RIM[k], emissive: new Color(COIN_RIM[k]).multiplyScalar(0.25), flatShading: true }))]),
    ) as unknown as Record<CoinKind, Material>;

    stage.add(this.puffs.mesh, this.sparkle.mesh);

    const starGeo = keep(new OctahedronGeometry(0.16, 0));
    const starMat = keep(new MeshBasicMaterial({ color: '#ffe066' }));
    looks.forEach((l, i) => {
      const model = buildPierogi(l.color);
      model.mats.forEach((m) => keep(m));
      const tag = nameTag(l.name, l.color, 3);
      tag.position.set(0, 2.15 + (i % 2) * 0.35, 0);
      model.root.add(tag);
      model.root.scale.setScalar(0.8);
      const stars = new Group();
      for (let k = 0; k < 3; k++) {
        const s = new Mesh(starGeo, starMat);
        s.scale.set(1, 1, 0.5);
        stars.add(s);
      }
      stars.position.y = 1.35;
      stars.visible = false;
      model.root.add(stars);
      stage.add(model.root);
      this.actors.push({ model, tag, color: l.color, stars, facing: 0, phase: Math.random() * 5, bonk: -1, bump: -1, dash: -1, pick: -1 });
    });
    this.reset(sim);
  }

  // ---- scenery -------------------------------------------------------------------------------------

  private buildGround(keep: Keep) {
    const stage = this.stage;
    const { hw, hd } = this;
    const outer = new Mesh(keep(new PlaneGeometry(160, 130)), keep(new MeshLambertMaterial({ map: keep(groundTexture('stone', 56, 4)), color: '#c9ad8f' })));
    outer.rotation.x = -Math.PI / 2;
    outer.position.z = -10;
    // The playing area: lighter, finer cobbles inside a granite kerb.
    const inner = new Mesh(keep(new PlaneGeometry(hw * 2 + 0.6, hd * 2 + 0.6)), keep(new MeshLambertMaterial({ map: keep(groundTexture('stone', 16, 11)), color: '#f3dcbd' })));
    inner.rotation.x = -Math.PI / 2;
    inner.position.y = 0.015;
    const kerb = keep(flat('#8f857a'));
    const kw = hw * 2 + 1.4;
    const kd = hd * 2 + 1.4;
    const k1 = box(kw, 0.14, 0.4, kerb);
    k1.position.set(0, 0.07, -hd - 0.5);
    const k2 = k1.clone();
    k2.position.z = hd + 0.5;
    const k3 = box(0.4, 0.14, kd, kerb);
    k3.position.set(-hw - 0.5, 0.07, 0);
    const k4 = k3.clone();
    k4.position.x = hw + 0.5;
    // A compass rose of darker setts in the middle.
    const rose = new Mesh(keep(new RingGeometry(1.6, 2.0, 16)), keep(new MeshLambertMaterial({ color: '#b39776', side: DoubleSide })));
    rose.rotation.x = -Math.PI / 2;
    rose.position.y = 0.025;
    const star = new Mesh(keep(new CylinderGeometry(1.5, 1.5, 0.02, 4)), keep(flat('#c4a985')));
    star.position.y = 0.02;
    star.rotation.y = Math.PI / 4;
    stage.add(outer, inner, k1, k2, k3, k4, rose, star);
  }

  /** One tenement, front face at local z = 0, facing +z. Returns the local spots of its babcia windows. */
  private tenement(keep: Keep, w: number, h: number, color: string, rnd: () => number, babciaCols: number[]): { group: Group; babcia: Vector3[] } {
    const group = new Group();
    const depth = 6;
    const wall = box(w, h, depth, keep(flat(color)));
    wall.position.z = -depth / 2;
    group.add(wall);
    // A cornice under the roof, and a plinth.
    const trim = keep(flat(new Color(color).lerp(new Color('#fff4dc'), 0.55).getStyle()));
    const cornice = box(w + 0.3, 0.35, 0.4, trim);
    cornice.position.set(0, h - 0.35, 0.05);
    const band = box(w + 0.1, 0.18, 0.2, trim);
    band.position.set(0, 3.1, 0.02);
    const plinth = box(w + 0.05, 0.6, 0.18, keep(flat('#8a7a68')));
    group.add(cornice, band, plinth);

    // The top: a stepped gable or a red-tiled pitched roof with a little attic window.
    if (rnd() < 0.5) {
      const steps = 3;
      for (let s = 0; s < steps; s++) {
        const sw = w * (0.78 - s * 0.22);
        const b = box(sw, 0.95, 0.5, keep(flat(color)));
        b.position.set(0, h + s * 0.95, -0.25);
        group.add(b);
        const cap = box(sw + 0.16, 0.14, 0.62, trim);
        cap.position.set(0, h + (s + 1) * 0.95 - 0.07, -0.25);
        group.add(cap);
      }
      const ball = new Mesh(keep(new SphereGeometry(0.18, 6, 4)), keep(flat('#e8b84a')));
      ball.position.set(0, h + steps * 0.95 + 0.25, -0.25);
      group.add(ball);
    } else {
      const roofGeo = keep(new CylinderGeometry(depth * 0.42, depth * 0.42, w + 0.2, 3, 1));
      const roof = new Mesh(roofGeo, keep(flat(rnd() < 0.5 ? '#a8432c' : '#7a4a3a')));
      roof.rotation.z = Math.PI / 2;
      roof.rotation.x = Math.PI / 2;
      roof.scale.set(1, 1, 0.72);
      roof.position.set(0, h + 0.55, -depth / 2);
      group.add(roof);
      const dormer = box(1.1, 1.0, 0.8, keep(flat(color)));
      dormer.position.set(0, h + 0.2, -0.9);
      const dpane = box(0.6, 0.6, 0.1, keep(new MeshBasicMaterial({ color: '#ffd98a' })));
      dpane.position.set(0, h + 0.35, -0.46);
      group.add(dormer, dpane);
    }

    // Ground floor: a shop door and a shop window with an awning.
    const doorX = (rnd() - 0.5) * w * 0.4;
    const door = box(1.1, 2.2, 0.12, keep(flat('#5a3420')));
    door.position.set(doorX, 0.3, 0.05);
    const shop = box(1.5, 1.4, 0.1, keep(new MeshBasicMaterial({ color: '#ffcf7a' })));
    const shopX = doorX > 0 ? doorX - 1.7 : doorX + 1.7;
    shop.position.set(shopX, 0.95, 0.05);
    group.add(door, shop);

    // Upper floors: windows with frames; window boxes on the first floor, a balcony on the second.
    const frame = keep(flat('#f6ecd8'));
    const lit = keep(new MeshBasicMaterial({ color: '#ffd98a' }));
    const glass = keep(flat('#3d4c66'));
    const boxMat = keep(flat('#7a4a2a'));
    const flowerMats = ['#e8335a', '#ff7ad1', '#ffc93c', '#ffffff'].map((c) => keep(flat(c)));
    const leaf = keep(flat('#4f8a2c'));
    const flowerGeo = keep(new IcosahedronGeometry(0.11, 0));
    const cols = [-w * 0.25, w * 0.25];
    const floors = [4.4, 7.0, 9.6].filter((y) => y < h - 1.2);
    const babcia: Vector3[] = [];
    const balconyFloor = rnd() < 0.6 ? 1 : -1;
    floors.forEach((y, f) => {
      cols.forEach((x, c) => {
        const open = f === 0 && babciaCols.includes(c);
        const fr = box(1.15, 1.55, 0.12, frame);
        fr.position.set(x, y - 0.78, 0.03);
        const pane = box(0.9, 1.3, 0.1, open ? keep(flat('#26140e')) : rnd() < 0.45 ? lit : glass);
        pane.position.set(x, y - 0.65, 0.08);
        group.add(fr, pane);
        if (open) {
          // Open shutters.
          const sh = keep(flat('#3f7a5a'));
          for (const s of [-1, 1]) {
            const shutter = box(0.5, 1.3, 0.06, sh);
            shutter.position.set(x + s * 0.78, y - 0.65, 0.3);
            shutter.rotation.y = s * 0.9;
            group.add(shutter);
          }
          babcia.push(new Vector3(x, y, 0));
        }
        if (f === 0) {
          const wb = box(1.15, 0.3, 0.38, boxMat);
          wb.position.set(x, y - 0.95, 0.22);
          group.add(wb);
          for (let k = 0; k < 4; k++) {
            const fl = new Mesh(flowerGeo, k % 2 ? leaf : flowerMats[Math.floor(rnd() * flowerMats.length)]);
            fl.position.set(x - 0.42 + k * 0.28, y - 0.55, 0.24);
            group.add(fl);
          }
        }
      });
      if (f === balconyFloor) {
        const slab = box(w * 0.5, 0.14, 0.9, trim);
        slab.position.set(0, y - 0.95, 0.45);
        group.add(slab);
        const rail = keep(flat('#2a2422'));
        const top = box(w * 0.5, 0.06, 0.06, rail);
        top.position.set(0, y - 0.2, 0.88);
        group.add(top);
        for (let k = 0; k <= 8; k++) {
          const bar = box(0.05, 0.7, 0.05, rail);
          bar.position.set(-w * 0.25 + (k / 8) * w * 0.5, y - 0.9, 0.88);
          group.add(bar);
        }
      }
    });
    return { group, babcia };
  }

  private buildTenements(keep: Keep) {
    const { hw, hd } = this;
    const rnd = mulberry32(42);
    const colors = ['#e9b24f', '#d8694c', '#7fb5a5', '#ead39f', '#c98aa2', '#8fb0d8', '#e88f5a', '#b5c97a'];
    const babciaSpots: { at: Vector3; normal: Vector3 }[] = [];
    // Back row along x, facing the square (+z).
    const backZ = -hd - 3.2;
    const x0 = -hw - 7;
    const x1 = hw + 2.5;
    const count = 7;
    const w = (x1 - x0) / count;
    for (let k = 0; k < count; k++) {
      const h = 10.6 + rnd() * 2.2 + (k % 2) * 0.8;
      const cols = k >= 1 && k <= 5 ? [k % 2] : [];
      const { group, babcia } = this.tenement(keep, w - 0.05, h, colors[k % colors.length], rnd, cols);
      group.position.set(x0 + (k + 0.5) * w, 0, backZ);
      this.stage.add(group);
      group.updateMatrixWorld(true);
      for (const b of babcia) babciaSpots.push({ at: group.localToWorld(b.clone()), normal: new Vector3(0, 0, 1) });
    }
    // Left row along z, facing the square (+x).
    const leftX = -hw - 3.2;
    const z0 = backZ;
    const z1 = hd + 8;
    const lc = 4;
    const lw = (z1 - z0) / lc;
    for (let k = 0; k < lc; k++) {
      const h = 9.8 + rnd() * 2.4;
      const cols = k <= 2 ? [k === 1 ? 0 : 1] : [];
      const { group, babcia } = this.tenement(keep, lw - 0.05, h, colors[(k + 3) % colors.length], rnd, cols);
      group.position.set(leftX, 0, z0 + (k + 0.5) * lw);
      group.rotation.y = Math.PI / 2;
      this.stage.add(group);
      group.updateMatrixWorld(true);
      for (const b of babcia) babciaSpots.push({ at: group.localToWorld(b.clone()), normal: new Vector3(1, 0, 0) });
    }
    // Eight babcias, one per window. Scarves in folk colours.
    const scarves = ['#cf3a2c', '#3568b8', '#2f8a4a', '#8a3aa8', '#d88a1a', '#cf3a6c', '#2a6a8a', '#a8432c'];
    for (let k = 0; k < WINDOWS; k++) {
      const s = babciaSpots[k % babciaSpots.length];
      const b = buildBabcia(keep, scarves[k % scarves.length]);
      b.root.scale.setScalar(0.62);
      b.root.rotation.y = Math.atan2(s.normal.x, s.normal.z);
      b.shadow.visible = false;
      this.stage.add(b.root);
      this.windows.push({ at: s.at, normal: s.normal, babcia: b, out: 0, busy: 0 });
    }
  }

  private buildTownHall(keep: Keep) {
    const { hw, hd } = this;
    const g = new Group();
    const brick = keep(flat('#a8452f'));
    const stone = keep(flat('#d9c7a4'));
    const hall = box(7, 7.5, 7, stone);
    const hallRoof = new Mesh(keep(new ConeGeometry(5.6, 3, 4)), keep(flat('#7a4a3a')));
    hallRoof.rotation.y = Math.PI / 4;
    hallRoof.position.y = 9;
    const tower = box(3.4, 21, 3.4, brick);
    tower.position.set(-1.4, 0, 1.0);
    const trim = box(3.8, 0.5, 3.8, stone);
    trim.position.set(-1.4, 20.8, 1.0);
    const lantern = box(2.4, 2.2, 2.4, keep(flat('#4f8f7a')));
    lantern.position.set(-1.4, 21.3, 1.0);
    const spire = new Mesh(keep(new ConeGeometry(2.1, 6.5, 4)), keep(flat('#4f8f7a')));
    spire.rotation.y = Math.PI / 4;
    spire.position.set(-1.4, 26.7, 1.0);
    const ball = new Mesh(keep(new SphereGeometry(0.4, 6, 4)), keep(new MeshBasicMaterial({ color: '#ffd23f' })));
    ball.position.set(-1.4, 30.1, 1.0);
    // The clock, facing the square.
    const face = new Mesh(keep(new CylinderGeometry(1.25, 1.25, 0.15, 16)), keep(new MeshBasicMaterial({ color: '#fff4dc' })));
    face.rotation.x = Math.PI / 2;
    face.position.set(-1.4, 16.5, 2.75);
    const rim = new Mesh(keep(new RingGeometry(1.2, 1.42, 16)), keep(new MeshBasicMaterial({ color: '#ffc93c', side: DoubleSide })));
    rim.position.set(-1.4, 16.5, 2.84);
    const handMat = keep(new MeshBasicMaterial({ color: '#241015' }));
    this.clockHand = new Group();
    const hand = box(0.12, 1.0, 0.05, handMat);
    this.clockHand.add(hand);
    const hour = box(0.16, 0.65, 0.05, handMat);
    hour.rotation.z = -2.1;
    hour.position.set(0, 0, 0.01);
    const clock = new Group();
    clock.position.set(-1.4, 16.5, 2.88);
    clock.add(this.clockHand, hour);
    // Arched windows down the tower.
    const dark = keep(flat('#3a1e1e'));
    for (const y of [6, 10, 13]) {
      const wnd = box(0.8, 1.6, 0.1, dark);
      wnd.position.set(-1.4, y, 2.72);
      g.add(wnd);
    }
    const arch = keep(flat('#b89a74'));
    for (const x of [-2.4, 0, 2.4]) {
      const a = box(1.6, 2.6, 0.2, arch);
      a.position.set(x + 0.6, 0, 3.55);
      g.add(a);
    }
    g.add(hall, hallRoof, tower, trim, lantern, spire, ball, face, rim, clock);
    g.position.set(hw + 6.5, 0, -hd - 6.5);
    this.stage.add(g);
  }

  private buildStalls(keep: Keep) {
    const { hw, hd } = this;
    const wood = keep(flat('#8a5a34'));
    const counterMat = keep(flat('#c08a56'));
    const postGeo = keep(new CylinderGeometry(0.12, 0.14, 3.2, 6));
    const stalls: [number, string][] = [
      [-hd + 0.4, '#e8335a'],
      [0.6, '#3d7eff'],
      [hd + 0.8, '#4caf50'],
    ];
    const goods = [
      ['#e8335a', '#a3e048', '#ffc93c'],
      ['#f4d9b5', '#e9c17a', '#c98a4a'],
      ['#4f8a2c', '#d97a3f', '#fff4dc'],
    ];
    stalls.forEach(([z, hex], i) => {
      const g = new Group();
      for (const [x, zz] of [
        [-2, -0.9],
        [2, -0.9],
        [-2, 0.9],
        [2, 0.9],
      ]) {
        const p = new Mesh(postGeo, wood);
        p.position.set(x, 1.6, zz);
        g.add(p);
      }
      const counter = box(4.2, 1.0, 1.0, counterMat);
      counter.position.set(0, 0, 0.7);
      const front = box(4.22, 0.28, 1.02, keep(flat(new Color(hex).multiplyScalar(0.8).getStyle())));
      front.position.set(0, 0.8, 0.7);
      const awnMat = keep(new MeshLambertMaterial({ map: keep(stripeTexture(hex, 20 + i)), flatShading: true, side: DoubleSide }));
      const awning = new Mesh(keep(new PlaneGeometry(4.8, 2.5)), awnMat);
      awning.position.set(0, 3.3, 0.25);
      awning.rotation.x = -Math.PI / 2 + 0.38;
      const scallop = keep(new ConeGeometry(0.3, 0.45, 4));
      for (let k = 0; k < 8; k++) {
        const s = new Mesh(scallop, awnMat);
        s.position.set(-2.1 + k * 0.6, 2.75, 1.4);
        s.rotation.x = Math.PI;
        g.add(s);
      }
      const geo = keep(new SphereGeometry(0.22, 6, 4));
      goods[i].forEach((c, k) => {
        const m = keep(flat(c));
        for (let j = 0; j < 3; j++) {
          const b = new Mesh(geo, m);
          b.position.set(-1.5 + k * 1.2 + j * 0.32, 1.2, 0.55 + (j % 2) * 0.2);
          g.add(b);
        }
      });
      g.add(counter, front, awning);
      g.position.set(hw + 3.6, 0, z);
      g.rotation.y = -Math.PI / 2;
      this.stage.add(g);
    });
  }

  private buildDecor(keep: Keep) {
    const { hw, hd } = this;
    // Lanterns on poles at the corners of the square.
    const poleGeo = keep(new CylinderGeometry(0.1, 0.14, 4.4, 6));
    const poleMat = keep(flat('#2a2422'));
    const lampGeo = keep(new IcosahedronGeometry(0.36, 0));
    const capGeo = keep(new ConeGeometry(0.42, 0.4, 4));
    for (const [x, z] of [
      [-hw - 1.3, hd + 1.3],
      [hw + 1.3, hd + 1.3],
      [-hw - 1.3, -hd - 1.3],
      [hw + 1.3, -hd - 1.3],
    ]) {
      const p = new Mesh(poleGeo, poleMat);
      p.position.set(x, 2.2, z);
      const mat = keep(new MeshBasicMaterial({ color: '#ffd77a' }));
      this.lanterns.push(mat);
      const lamp = new Mesh(lampGeo, mat);
      lamp.position.set(x, 4.6, z);
      const cap = new Mesh(capGeo, poleMat);
      cap.position.set(x, 5.05, z);
      cap.rotation.y = Math.PI / 4;
      const sh = blobShadow(0.5, 0.25);
      sh.position.set(x, 0.03, z);
      this.stage.add(p, lamp, cap, sh);
    }
    // Pigeons pecking along the front kerb.
    const grey = keep(flat('#8a8f9c'));
    const neck = keep(flat('#5f8a7a'));
    const rnd = mulberry32(5);
    for (let k = 0; k < 6; k++) {
      const g = new Group();
      const body = new Mesh(keep(new SphereGeometry(0.22, 6, 4)), grey);
      body.scale.set(1.3, 0.85, 0.9);
      body.position.y = 0.22;
      const head = new Mesh(keep(new SphereGeometry(0.12, 5, 3)), neck);
      head.position.set(0.24, 0.42, 0);
      head.name = 'head';
      g.add(body, head);
      g.position.set(-hw + 2 + rnd() * (hw * 2 - 4), 0.14, hd + 1.3 + rnd() * 1.2);
      g.rotation.y = rnd() * TAU;
      this.stage.add(g);
      this.pigeons.push(g);
    }
    // Barrels and crates by the stalls.
    const barrel = keep(new CylinderGeometry(0.45, 0.4, 1, 8));
    const barrelMat = keep(flat('#7a4a2a'));
    for (const [x, z] of [
      [hw + 1.7, -hd - 1.8],
      [hw + 2.4, hd + 3.2],
      [-hw - 2.0, hd + 2.6],
    ]) {
      const b = new Mesh(barrel, barrelMat);
      b.position.set(x, 0.5, z);
      this.stage.add(b);
    }
  }

  // ---- pools ---------------------------------------------------------------------------------------

  private makeCoin(kind: CoinKind): CoinView {
    const root = new Group();
    const coin = new Group();
    coin.add(new Mesh(this.coinGeo[kind], this.coinMat[kind]), new Mesh(this.faceGeo[kind], this.faceMat[kind]));
    root.add(coin);
    const shadowMat = this.keepFn(new MeshBasicMaterial({ color: kind === 'gold' ? '#3a2400' : '#000', transparent: true, opacity: 0.3, depthWrite: false }));
    this.shadowGeo ??= this.keepFn(new RingGeometry(0, 1, 12));
    const shadow = new Mesh(this.shadowGeo, shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    this.stage.add(root, shadow);
    return { root, coin, shadow, shadowMat, kind, land: -1, seen: false };
  }

  private makeHazard(kind: 'pot' | 'pan'): HazardView {
    const keep = this.keepFn;
    const obj = new Group();
    if (kind === 'pot') {
      const pot = new Mesh(keep(new CylinderGeometry(0.36, 0.26, 0.5, 8)), keep(flat('#c8643a')));
      const rim = new Mesh(keep(new CylinderGeometry(0.4, 0.4, 0.1, 8)), keep(flat('#a84f2a')));
      rim.position.y = 0.25;
      const soil = new Mesh(keep(new CylinderGeometry(0.33, 0.33, 0.06, 8)), keep(flat('#4a2e1a')));
      soil.position.y = 0.27;
      const plant = new Mesh(keep(new IcosahedronGeometry(0.3, 0)), keep(flat('#4f8a2c')));
      plant.position.y = 0.52;
      const fl = new Mesh(keep(new IcosahedronGeometry(0.13, 0)), keep(flat('#e8335a')));
      fl.position.set(0.12, 0.78, 0.05);
      const fl2 = fl.clone();
      fl2.position.set(-0.16, 0.7, -0.08);
      obj.add(pot, rim, soil, plant, fl, fl2);
    } else {
      const iron = keep(flat('#2e2b2b'));
      const pan = new Mesh(keep(new CylinderGeometry(0.48, 0.4, 0.14, 10)), iron);
      const inside = new Mesh(keep(new CylinderGeometry(0.4, 0.4, 0.02, 10)), keep(flat('#4a4646')));
      inside.position.y = 0.07;
      const handle = box(0.12, 0.08, 0.7, keep(flat('#3a3434')));
      handle.position.set(0, -0.02, 0.75);
      obj.add(pan, inside, handle);
    }
    const marker = new Group();
    const disc = keep(new MeshBasicMaterial({ color: '#e8335a', transparent: true, opacity: 0.3, depthWrite: false }));
    const ring = keep(new MeshBasicMaterial({ color: '#ff4a4a', transparent: true, opacity: 0.9, depthWrite: false, side: DoubleSide }));
    const d = new Mesh(keep(new RingGeometry(0, HAZARD_R, 20)), disc);
    const r = new Mesh(keep(new RingGeometry(HAZARD_R - 0.14, HAZARD_R, 20)), ring);
    // A cross in the middle.
    const cross = keep(new PlaneGeometry(0.9, 0.16));
    const c1 = new Mesh(cross, ring);
    c1.rotation.z = Math.PI / 4;
    const c2 = new Mesh(cross, ring);
    c2.rotation.z = -Math.PI / 4;
    marker.add(d, r, c1, c2);
    marker.rotation.x = -Math.PI / 2;
    marker.renderOrder = 2;
    this.stage.add(obj, marker);
    return { obj, marker, disc, ring, kind, seen: false };
  }

  private coinView(c: Coin) {
    let v = this.coinViews.get(c.id);
    if (!v) {
      v = this.coinPool[c.kind].pop() ?? this.makeCoin(c.kind);
      v.root.visible = v.shadow.visible = true;
      v.land = -1;
      this.coinViews.set(c.id, v);
    }
    return v;
  }

  private hazView(h: Hazard) {
    let v = this.hazViews.get(h.id);
    if (!v) {
      v = this.hazPool[h.kind].pop() ?? this.makeHazard(h.kind);
      v.obj.visible = v.marker.visible = true;
      this.hazViews.set(h.id, v);
    }
    return v;
  }

  // ---- players -------------------------------------------------------------------------------------

  reset(sim: CoinsSim) {
    for (const [id, v] of this.coinViews) {
      v.root.visible = v.shadow.visible = false;
      this.coinPool[v.kind].push(v);
      this.coinViews.delete(id);
    }
    for (const [id, v] of this.hazViews) {
      v.obj.visible = v.marker.visible = false;
      this.hazPool[v.kind].push(v);
      this.hazViews.delete(id);
    }
    this.windows.forEach((w) => {
      w.out = 0;
      w.busy = 0;
    });
    this.gold = 0;
    this.actors.forEach((a, i) => {
      const p = sim.players[i];
      a.bonk = a.bump = a.dash = a.pick = -1;
      a.facing = 0;
      a.model.root.visible = !!p && !p.gone;
      a.model.root.position.set(p?.x ?? 0, 0, p?.z ?? 0);
      a.model.body.rotation.set(0, 0, 0);
      a.model.body.scale.set(1, 1, 1);
      a.stars.visible = false;
    });
  }

  hide(i: number) {
    const a = this.actors[i];
    if (a) a.model.root.visible = false;
  }

  /** React to what the sim just did: bursts, shakes and babcias. */
  events(ev: CoinsEvent[], sim: CoinsSim) {
    for (const e of ev) {
      switch (e.t) {
        case 'pick': {
          const col = COIN_COLORS[e.kind];
          const y = e.caught ? 0.9 : 0.4;
          for (let k = 0; k < (e.kind === 'gold' ? 14 : 6); k++) {
            const a = (k / 6) * TAU;
            this.puffs.spawn(e.x, y, e.z, Math.cos(a) * 2.2, 2.5 + Math.random() * 2, Math.sin(a) * 2.2, e.kind === 'gold' ? 0.2 : 0.13, 0.45, k % 3 ? col : '#fff8d0', 0.4);
          }
          const a = this.actors[e.p];
          if (a) a.pick = 0;
          break;
        }
        case 'land':
          {
            const v = this.coinViews.get(e.id);
            if (v) v.land = 0;
            for (let k = 0; k < 3; k++) this.puffs.spawn(e.x, 0.1, e.z, (Math.random() - 0.5) * 1.6, 0.8, (Math.random() - 0.5) * 1.6, 0.14, 0.35, '#e6d2b0');
          }
          break;
        case 'throw': {
          const w = this.windows[e.win];
          if (w) w.busy = HAZARD_T;
          break;
        }
        case 'smash': {
          const shards = e.kind === 'pot' ? ['#c8643a', '#a84f2a', '#4a2e1a', '#4f8a2c', '#e8335a'] : ['#2e2b2b', '#5a5555', '#ffd77a'];
          for (let k = 0; k < 18; k++) {
            const a = Math.random() * TAU;
            const sp = 2 + Math.random() * 4;
            this.puffs.spawn(e.x, 0.3, e.z, Math.cos(a) * sp, 3 + Math.random() * 4, Math.sin(a) * sp, 0.16 + Math.random() * 0.12, 0.7, shards[k % shards.length], 0.2);
          }
          for (let k = 0; k < 6; k++) this.puffs.spawn(e.x, 0.2, e.z, (Math.random() - 0.5) * 3, 0.5, (Math.random() - 0.5) * 3, 0.5, 0.8, '#e6d2b0', 2);
          this.shake = Math.min(1, this.shake + (e.hits.length ? 0.6 : 0.22));
          break;
        }
        case 'hit': {
          const a = this.actors[e.p];
          if (a) a.bonk = 0;
          break;
        }
        case 'bump': {
          const a = this.actors[e.p];
          if (a) a.bump = 0;
          const p = sim.players[e.p];
          for (let k = 0; k < 8; k++) this.puffs.spawn(p.x, 0.6, p.z, (Math.random() - 0.5) * 4, 2 + Math.random() * 2, (Math.random() - 0.5) * 4, 0.18, 0.4, '#fff4dc', 0.6);
          this.shake = Math.min(1, this.shake + 0.2);
          break;
        }
        case 'dash': {
          const a = this.actors[e.p];
          if (a) a.dash = 0;
          break;
        }
        case 'spill': {
          const p = sim.players[e.p];
          for (let k = 0; k < 12; k++) {
            const a = (k / 12) * TAU;
            this.puffs.spawn(p.x, 0.7, p.z, Math.cos(a) * 4, 3, Math.sin(a) * 4, 0.16, 0.5, k % 2 ? '#ffcc2e' : '#fff8d0', 0.3);
          }
          break;
        }
        case 'golden':
          this.shake = Math.min(1, this.shake + 0.3);
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

  // ---- drawing -------------------------------------------------------------------------------------

  render(sim: CoinsSim, dt: number, playing: boolean) {
    this.time += dt;
    const t = this.time;

    // Golden rain: the sky turns to gold and sparkles drift down.
    const goldTarget = sim.golden && !sim.done ? 1 : 0;
    this.gold += (goldTarget - this.gold) * Math.min(1, dt * 2);
    const sky = this.stage.scene.background as Color;
    sky.copy(SKY).lerp(GOLD_SKY, this.gold);
    this.stage.scene.fog?.color.copy(sky);
    this.stage.sun.intensity = 1.75 + this.gold * 0.5;
    if (this.gold > 0.3 && Math.random() < dt * 40 * this.gold) {
      this.sparkle.spawn((Math.random() - 0.5) * this.hw * 2.4, 9 + Math.random() * 4, (Math.random() - 0.5) * this.hd * 2.4, 0, -2, 0, 0.08 + Math.random() * 0.08, 2.4, Math.random() < 0.5 ? '#ffe680' : '#fff8d0', 0.2);
    }

    this.renderCoins(sim, dt, t);
    this.renderHazards(sim, dt, t);
    this.renderPlayers(sim, dt, t, playing);

    // Babcias lean out to throw, then duck back in.
    this.windows.forEach((w, k) => {
      w.busy = Math.max(0, w.busy - dt);
      const want = w.busy > HAZARD_T - RELEASE - 0.5 ? 1 : 0;
      w.out += (want - w.out) * Math.min(1, dt * (want ? 14 : 5));
      const b = w.babcia;
      b.root.visible = w.out > 0.02;
      const o = smooth(w.out);
      this.tmp.copy(w.normal).multiplyScalar(-0.9 + o * 1.25);
      b.root.position.set(w.at.x + this.tmp.x, w.at.y - 1.25 + this.tmp.y, w.at.z + this.tmp.z);
      b.body.rotation.x = o * 0.45;
      b.body.rotation.z = w.busy > 0 ? Math.sin(t * 9 + k) * 0.08 : 0;
    });

    this.lanterns.forEach((m, k) => m.color.set('#ffd77a').multiplyScalar(0.85 + Math.sin(t * 2.3 + k * 1.9) * 0.12));
    this.clockHand.rotation.z = -t * 0.2;
    this.pigeons.forEach((p, k) => {
      const head = p.getObjectByName('head');
      if (head) head.position.y = 0.42 - Math.max(0, Math.sin(t * 3 + k * 1.7)) * 0.18;
    });

    this.puffs.update(dt);
    this.sparkle.update(dt);

    const stage = this.stage;
    const target = new Vector3(0, 0, -0.6);
    stage.lookAt(target, 9 + this.hw * 2.15, 0.9);
    if (this.shake > 0.01) {
      stage.camera.position.x += (Math.random() - 0.5) * this.shake * 0.6;
      stage.camera.position.y += (Math.random() - 0.5) * this.shake * 0.6;
      this.shake *= Math.exp(-7 * dt);
    }
    stage.render();
  }

  private renderCoins(sim: CoinsSim, dt: number, t: number) {
    for (const v of this.coinViews.values()) v.seen = false;
    for (const c of sim.coins) {
      const v = this.coinView(c);
      v.seen = true;
      const big = c.golden ? 1.25 : 1;
      let x = c.x;
      let z = c.z;
      let y = sim.coinY(c);
      if (c.state === 'pop') {
        const u = Math.min(1, c.t / 0.5);
        x = c.sx + (c.x - c.sx) * u;
        z = c.sz + (c.z - c.sz) * u;
      }
      let hover = 0.45 + Math.sin(t * 3 + c.id) * 0.06;
      if (c.state === 'ground' && v.land >= 0) {
        v.land += dt;
        const k = Math.max(0, 1 - v.land / 0.45);
        hover = 0.45 + Math.abs(Math.sin(v.land * 14)) * 0.5 * k;
        if (k === 0) v.land = -1;
      }
      if (c.state !== 'fall') y = Math.max(y, 0) + (c.state === 'ground' ? hover : 0.3);
      v.root.position.set(x, y + (c.state === 'fall' ? 0.45 : 0), z);
      v.root.scale.setScalar(big);
      v.coin.rotation.y = t * (c.state === 'fall' ? 7 : 3) + c.id;
      // Blink before vanishing.
      const fading = c.state === 'ground' && c.t > COIN_LIFE - FADE_T;
      v.root.visible = !fading || Math.floor(t * 12) % 2 === 0;
      // The shadow grows as it falls.
      const r = COIN_R[c.kind] * big;
      let sr = r * 1.1;
      let op = 0.32;
      if (c.state === 'fall') {
        const u = Math.min(1, c.t / 1.3);
        sr = r * (0.4 + 1.1 * u);
        op = 0.12 + 0.35 * u;
      }
      v.shadow.position.set(c.state === 'fall' ? c.x : x, 0.04, c.state === 'fall' ? c.z : z);
      v.shadow.scale.setScalar(sr);
      v.shadowMat.opacity = op;
      v.shadow.visible = v.root.visible;
      if (c.kind === 'gold' && c.state === 'ground' && Math.random() < dt * 6) this.puffs.spawn(x + (Math.random() - 0.5) * 0.8, y + 0.3, z, 0, 1.2, 0, 0.08, 0.5, '#fff8d0', 0);
    }
    for (const [id, v] of this.coinViews) {
      if (v.seen) continue;
      v.root.visible = v.shadow.visible = false;
      this.coinPool[v.kind].push(v);
      this.coinViews.delete(id);
    }
  }

  private renderHazards(sim: CoinsSim, _dt: number, t: number) {
    for (const v of this.hazViews.values()) v.seen = false;
    for (const h of sim.hazards) {
      const v = this.hazView(h);
      v.seen = true;
      const w = this.windows[h.win];
      const start = w ? this.tmp.copy(w.at).addScaledVector(w.normal, 0.9) : this.tmp.set(0, 10, -10);
      start.y -= 0.5;
      if (h.t < RELEASE) {
        v.obj.position.copy(start);
        v.obj.rotation.set(0, 0, 0);
      } else {
        const u = Math.min(1, (h.t - RELEASE) / (HAZARD_T - RELEASE));
        const apex = 2.5;
        v.obj.position.set(start.x + (h.tx - start.x) * u, start.y + (0.3 - start.y) * u + apex * 4 * u * (1 - u), start.z + (h.tz - start.z) * u);
        v.obj.rotation.set(u * 9 + h.id, u * 4, u * 6);
      }
      // The marker: grows and pulses faster as the smash nears.
      const u = h.t / HAZARD_T;
      v.marker.position.set(h.tx, 0.05, h.tz);
      v.marker.scale.setScalar(0.45 + 0.55 * smooth(u * 1.4));
      v.marker.rotation.z = t * 1.5;
      v.disc.opacity = 0.18 + 0.22 * u + Math.sin(t * (8 + u * 16)) * 0.08;
      v.ring.opacity = 0.6 + 0.4 * Math.abs(Math.sin(t * (5 + u * 12)));
    }
    for (const [id, v] of this.hazViews) {
      if (v.seen) continue;
      v.obj.visible = v.marker.visible = false;
      this.hazPool[v.kind].push(v);
      this.hazViews.delete(id);
    }
  }

  private renderPlayers(sim: CoinsSim, dt: number, t: number, playing: boolean) {
    this.actors.forEach((ac, i) => {
      const p = sim.players[i];
      if (!p || p.gone) {
        ac.model.root.visible = false;
        return;
      }
      const root = ac.model.root;
      const body = ac.model.body;
      const speed = Math.hypot(p.vx, p.vz);
      const face = speed > 0.4 ? Math.atan2(p.vx, p.vz) : Math.atan2(p.fx, p.fz);
      ac.facing += angleDiff(ac.facing, playing || speed > 0.4 ? face : 0) * Math.min(1, dt * 14);
      root.rotation.y = ac.facing;
      ac.phase += dt * (3 + speed * 1.8);
      let bob = Math.sin(t * 3 + i) * 0.015;
      let roll = 0;
      let tilt = 0;
      let sy = 1;
      let sxz = 1;
      if (speed > 0.8 && p.dash <= 0) {
        bob = Math.abs(Math.sin(ac.phase)) * 0.14 * Math.min(1, speed / 4);
        roll = Math.sin(ac.phase) * 0.1;
        tilt = Math.min(1, speed / 7) * 0.18;
      }
      if (ac.dash >= 0) {
        ac.dash += dt;
        if (ac.dash > 0.35) ac.dash = -1;
      }
      if (p.dash > 0) {
        tilt = 0.45;
        sy = 0.86;
        sxz = 1.1;
        if (Math.random() < 0.7) this.puffs.spawn(p.x - p.dx * 0.6, 0.2, p.z - p.dz * 0.6, -p.dx, 0.5, -p.dz, 0.24, 0.35, '#efe2c8', 1.2);
      }
      if (ac.pick >= 0) {
        ac.pick += dt;
        const k = ac.pick / 0.25;
        if (k < 1) bob += Math.sin(k * Math.PI) * 0.18;
        else ac.pick = -1;
      }
      // Bonked: squashed flat, then wobbling with stars round the head.
      if (p.stun > 0) {
        ac.bonk = ac.bonk < 0 ? 0 : ac.bonk + dt;
        const k = Math.min(1, ac.bonk / 0.12);
        const back = Math.max(0, 1 - (ac.bonk - 0.2) / 0.3);
        sy = 1 - 0.45 * k * back - 0.08;
        sxz = 1 + 0.3 * k * back;
        roll = Math.sin(t * 7) * 0.14;
        tilt = 0;
        bob = 0;
      } else ac.bonk = -1;
      ac.stars.visible = p.stun > 0;
      if (p.stun > 0) {
        ac.stars.children.forEach((s, k) => {
          const a = t * 6 + (k / 3) * TAU;
          s.position.set(Math.cos(a) * 0.7, Math.sin(t * 9 + k) * 0.08, Math.sin(a) * 0.7);
          s.rotation.y = t * 8;
        });
      }
      if (p.stagger > 0) {
        tilt = -0.35;
        roll = Math.sin(t * 20) * 0.1;
      }
      // Safe after a bonk: blink.
      root.visible = !(p.inv > 0 && p.stun <= 0 && p.stagger <= 0) || Math.floor(t * 14) % 2 === 0;
      body.scale.set(sxz, sy, sxz);
      body.rotation.set(tilt, 0, roll);
      root.position.set(p.x, bob, p.z);
      ac.model.shadow.scale.set(1 - bob * 0.4, 0.6, 1);
    });
  }

  dispose() {
    this.stage.dispose();
  }
}
