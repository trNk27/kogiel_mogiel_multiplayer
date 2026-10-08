/**
 * Fajki's three.js scene: a smoky karczma (a Polish country inn), seen from above. A round table with a
 * lace doily and a lazy Susan of cigarettes in the players' colours; the pierogi sit around it and reach
 * in with their arms, and the room slowly fills with smoke. At the end they fall into a tower on the
 * table and grin, teeth as yellow as they smoked, and a crown keeps everyone guessing before it drops.
 */
import {
  BoxGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  NearestFilter,
  Object3D,
  PointLight,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
  type Fog,
  type Material,
} from 'three';
import { ArenaStage, blobShadow, box, buildPierogi, flat, groundTexture, nameTag, pixelTexture, type PierogiModel } from '../arena/kit';
import { CIG_LENGTH, DROP_MS, FALL_MS, REACH_MS, RETURN_MS, teethColor, yellowness, type FinaleTimes } from './logic';

const TAU = Math.PI * 2;
const TABLE_R = 4.2;
const TABLE_Y = 0.95;
const TRAY_R = 2.25;
/** The tray's top surface. */
const TRAY_Y = TABLE_Y + 0.2;
const SEAT_R = 5.55;
const PIEROGI_S = 1.45;
/** Hand distances from the centre: resting at the table edge, at the tray, at the mouth. */
const REST_R = 4.45;
const GRAB_R = 2.05;
const MOUTH_R = 4.95;
const HAND_Y = TABLE_Y + 0.4;
const MOUTH_Y = 0.85;
/** Cigarettes on the tray: from the ember end at CIG_IN to the filter end. */
const CIG_IN = 0.55;
const CIG_LEN = 1.45;
const CIG_W = 0.12;
/** The tower: each pierogi this big, standing on the one below. */
const TOWER_S = 1.5;
const TOWER_STEP = 1.1 * TOWER_S * 0.82;
/** How far up each pierogi starts its fall, and the camera's angle on the tower. */
const DROP_HEIGHT = 9;
const TOWER_TILT = 0.12;
/** At the reveal the winner steps this far out of the tower, and grows by this much. */
const WIN_OUT = 0.9;
const WIN_GROW = 0.1;
/** The room: back wall and side walls. */
const WALL_Z = -11;
const WALL_X = 16.5;
const SMOKE = '#e9e5dd';
const COUGH = '#a8b496';
const UP = new Vector3(0, 1, 0);

/** What the scene reads from the game every frame. */
export interface SmokeState {
  phase: 'ready' | 'play' | 'over';
  seats: readonly {
    hand: 'empty' | 'reach' | 'cig' | 'cough';
    reachAt: number;
    holding: string | null;
    left: number;
    coughUntil: number;
    after: 'cig' | 'empty';
    pullAt: number;
    smoked: number;
    butts: number;
  }[];
  angles: readonly number[];
  slots: readonly (string | null)[];
  puffs: readonly { id: number; seat: number; amt: number }[];
  removed: ReadonlySet<number>;
  tower: readonly number[];
  finaleAt: number;
  finale: { times: FinaleTimes; winners: number[]; hops: readonly { at: number; floor: number }[] } | null;
  /** When smoking starts and stops (Date.now() ms): the room gets smokier in between. */
  goAt: number;
  endsAt: number;
  trayAt(t: number): number;
}

export interface SeatInfo {
  name: string;
  color: string;
}

/** A cigarette lying along +x: ember end at 0, filter at `len`. The paper can be shortened from the ember end. */
class CigModel {
  readonly root = new Group();
  readonly body: Mesh;
  readonly ember: Mesh;
  readonly ash: Mesh;
  private readonly paper: number;

  constructor(
    private geos: CigGeos,
    bodyMat: Material,
    filterMat: Material,
    private emberMat: MeshBasicMaterial,
    ashMat: Material,
    len = CIG_LEN,
  ) {
    const filter = len * 0.26;
    this.paper = len - filter;
    this.body = new Mesh(geos.body, bodyMat);
    this.body.scale.set(this.paper, 1, 1);
    this.body.position.x = this.paper;
    const f = new Mesh(geos.filter, filterMat);
    f.scale.set(filter, 1, 1);
    f.position.x = this.paper;
    this.ash = new Mesh(geos.tip, ashMat);
    this.ember = new Mesh(geos.tip, emberMat);
    this.root.add(this.body, f, this.ash, this.ember);
    this.setLeft(1, false);
  }

  /** How much paper is left (0–1) and whether it's lit. */
  setLeft(frac: number, lit: boolean, hot = false) {
    const f = Math.max(0.02, Math.min(1, frac));
    this.body.scale.x = this.paper * f;
    const tip = this.paper * (1 - f);
    this.ash.visible = lit;
    this.ash.position.x = tip - 0.04;
    this.ember.visible = lit;
    this.ember.position.x = tip - 0.09;
    this.ember.scale.setScalar(hot ? 1.5 : 1);
    this.ember.material = hot ? this.geos.hot : this.emberMat;
  }

  setColor(mat: Material) {
    this.body.material = mat;
  }
}

interface CigGeos {
  /** Unit-length cylinders along x, spanning [-1, 0] (paper) and [0, 1] (filter). */
  body: CylinderGeometry;
  filter: CylinderGeometry;
  tip: SphereGeometry;
  /** The ember while someone pulls on it. */
  hot: MeshBasicMaterial;
}

interface SeatView {
  model: PierogiModel;
  tag: ReturnType<typeof nameTag>;
  arm: Mesh;
  hand: Group;
  held: CigModel;
  heldColor: string | null;
  reach: number;
  handY: number;
  butts: Mesh[];
  coughPuff: number;
}

interface Puff {
  mesh: Mesh;
  mat: MeshBasicMaterial;
  t: number;
  life: number;
  v: Vector3;
  grow: number;
  size: number;
}

interface TowerFloor {
  seat: number;
  model: PierogiModel;
  mouth: Mesh;
  teeth: Group;
  teethMat: MeshBasicMaterial;
  teethTo: Color;
  y: number;
}

/** Where the camera looks, and from how far, to show the bottom `m` floors of the tower. */
function towerFraming(m: number) {
  const h = (Math.max(1, m) - 1) * TOWER_STEP + 1.1 * TOWER_S;
  return { y: TABLE_Y + h / 2 + 0.3, dist: Math.max(10, (h + 2.2) / 0.62) };
}

export class SmokeScene {
  readonly stage: ArenaStage;
  private time = 0;
  private table = new Group();
  private tray = new Group();
  private slots: { cig: CigModel; was: string | null; pop: number }[] = [];
  private seats: SeatView[] = [];
  private bodyMats = new Map<string, Material>();
  private geos: CigGeos;
  private filterMat: Material;
  private emberMat: MeshBasicMaterial;
  private ashMat: Material;
  private puffs: Puff[] = [];
  private puffGeo: IcosahedronGeometry;
  private seen = new Set<number>();
  private fog: Fog;
  private readonly sky = new Color('#2a1a1e');
  private readonly hazeColor = new Color('#9b958d');
  private haze = 0;
  private tower: TowerFloor[] | null = null;
  private crown: Group | null = null;
  private extraCrowns: Group[] = [];
  private crownY = 0;
  private sparkled = false;
  private camY = 0;
  private camDist = 0;
  /** Big slow clouds hanging over the table: the room's smoke. */
  private clouds: { mesh: Mesh; mat: MeshBasicMaterial; a: number; r: number; y: number; s: number; sp: number }[] = [];
  private fire!: MeshBasicMaterial;
  private fireLight!: PointLight;

  constructor(
    canvas: HTMLCanvasElement,
    private info: SeatInfo[],
    private game: SmokeState,
  ) {
    // Vaporwave turns every colour pink or cyan, and here your colour is the whole game.
    const stage = (this.stage = new ArenaStage(canvas, { sky: '#2a1a1e', fog: [34, 80], fov: 40 }));
    this.fog = stage.scene.fog as Fog;
    stage.sun.color.set('#ffd9a8');
    stage.sun.intensity = 1.7;
    stage.sun.position.set(-0.45, 1, 0.5);
    this.topView();
    const keep = <T extends { dispose(): void }>(x: T) => stage.keep(x);

    // ---- the room -------------------------------------------------------------------
    const floor = new Mesh(keep(new CircleGeometry(60, 24)), keep(new MeshLambertMaterial({ map: keep(groundTexture('wood', 64)), color: '#b98a62' })));
    floor.rotation.x = -Math.PI / 2;
    const rug = new Mesh(keep(new CircleGeometry(8.4, 32)), keep(new MeshLambertMaterial({ map: keep(rugTexture()) })));
    rug.rotation.x = -Math.PI / 2;
    rug.position.y = 0.02;
    stage.add(floor, rug);
    this.buildKarczma(keep);

    // ---- the table ------------------------------------------------------------------
    const wood = keep(new MeshLambertMaterial({ map: keep(groundTexture('wood', 7, 5)), color: '#dba571', flatShading: true }));
    const dark = keep(flat('#5a3418'));
    const top = new Mesh(keep(new CylinderGeometry(TABLE_R, TABLE_R, 0.22, 28)), wood);
    top.position.y = TABLE_Y - 0.11;
    const rim = new Mesh(keep(new CylinderGeometry(TABLE_R + 0.08, TABLE_R + 0.08, 0.12, 28)), dark);
    rim.position.y = TABLE_Y - 0.2;
    const leg = new Mesh(keep(new CylinderGeometry(0.35, 0.6, TABLE_Y - 0.2, 8)), dark);
    leg.position.y = (TABLE_Y - 0.2) / 2;
    const tableShadow = blobShadow(TABLE_R * 1.05, 0.4);
    tableShadow.renderOrder = 1;
    const doily = new Mesh(keep(new CircleGeometry(2.85, 24)), keep(new MeshLambertMaterial({ map: keep(doilyTexture()), transparent: true, alphaTest: 0.5 })));
    doily.rotation.x = -Math.PI / 2;
    doily.position.y = TABLE_Y + 0.01;
    this.table.add(tableShadow, leg, rim, top, doily);

    // ---- the lazy Susan and its cigarettes ------------------------------------------
    const trayMat = keep(new MeshLambertMaterial({ map: keep(groundTexture('wood', 2, 9)), color: '#a86a3a', flatShading: true }));
    const disc = new Mesh(keep(new CylinderGeometry(TRAY_R, TRAY_R, 0.16, 24)), trayMat);
    disc.position.y = TRAY_Y - 0.08;
    const lip = new Mesh(keep(new RingGeometry(TRAY_R - 0.12, TRAY_R, 24)), dark);
    lip.rotation.x = -Math.PI / 2;
    lip.position.y = TRAY_Y + 0.005;
    const knob = new Mesh(keep(new CylinderGeometry(0.42, 0.5, 0.22, 10)), dark);
    knob.position.y = TRAY_Y + 0.1;
    const cap = new Mesh(keep(new SphereGeometry(0.2, 8, 5)), keep(flat('#c9ccd3')));
    cap.position.y = TRAY_Y + 0.24;
    this.tray.add(disc, lip, knob, cap);

    const body = new CylinderGeometry(CIG_W, CIG_W, 1, 7);
    body.rotateZ(Math.PI / 2);
    body.translate(-0.5, 0, 0);
    const filter = new CylinderGeometry(CIG_W * 1.02, CIG_W * 1.02, 1, 7);
    filter.rotateZ(Math.PI / 2);
    filter.translate(0.5, 0, 0);
    this.geos = { body: keep(body), filter: keep(filter), tip: keep(new SphereGeometry(CIG_W * 0.95, 6, 4)), hot: keep(new MeshBasicMaterial({ color: '#ffe46a' })) };
    this.filterMat = keep(flat('#e0a256'));
    this.emberMat = keep(new MeshBasicMaterial({ color: '#ff6a1a' }));
    this.ashMat = keep(flat('#8f8a84'));
    const n = game.slots.length;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU;
      const cig = this.cig(game.slots[k] ?? '#ffffff');
      cig.root.position.set(Math.cos(a) * CIG_IN, TRAY_Y + CIG_W, Math.sin(a) * CIG_IN);
      cig.root.rotation.y = -a;
      this.tray.add(cig.root);
      this.slots.push({ cig, was: game.slots[k], pop: 0 });
    }
    this.table.add(this.tray);
    stage.add(this.table);

    // ---- seats: grab markers, ashtrays, pierogi, arms -------------------------------
    const glass = keep(flat('#5b636b'));
    const glassIn = keep(flat('#3a4148'));
    const buttMat = keep(flat('#e0a256'));
    const buttGeo = keep(new CylinderGeometry(0.06, 0.06, 0.36, 5));
    const trayGeo = keep(new CylinderGeometry(0.46, 0.38, 0.14, 10));
    const trayInGeo = keep(new CircleGeometry(0.33, 10));
    const markGeo = keep(new CircleGeometry(0.32, 3));
    const armGeo = new CylinderGeometry(0.15, 0.17, 1, 6);
    armGeo.translate(0, 0.5, 0);
    keep(armGeo);
    const handGeo = keep(new IcosahedronGeometry(0.3, 1));
    game.angles.forEach((a, i) => {
      const color = info[i].color;
      const mat = keep(flat(color));
      const dir = new Vector3(Math.cos(a), 0, Math.sin(a));
      // A triangle on the doily pointing at your grab spot.
      const mark = new Group();
      mark.rotation.y = -(a + Math.PI);
      const tri = new Mesh(markGeo, keep(new MeshBasicMaterial({ color })));
      tri.rotation.x = -Math.PI / 2;
      tri.position.set(-2.6, TABLE_Y + 0.02, 0);
      mark.add(tri);
      this.table.add(mark);
      // Ashtray beside you, filling up with butts.
      const ash = new Group();
      const at = a + 0.36;
      ash.position.set(Math.cos(at) * 3.55, TABLE_Y + 0.07, Math.sin(at) * 3.55);
      const dish = new Mesh(trayGeo, glass);
      const inner = new Mesh(trayInGeo, glassIn);
      inner.rotation.x = -Math.PI / 2;
      inner.position.y = 0.075;
      ash.add(dish, inner);
      const butts: Mesh[] = [];
      for (let k = 0; k < 6; k++) {
        const b = new Mesh(buttGeo, buttMat);
        b.rotation.set(Math.PI / 2, 0, (k / 6) * TAU + 0.4);
        b.position.set(Math.cos(k * 1.05) * 0.14, 0.12, Math.sin(k * 1.05) * 0.14);
        b.visible = false;
        ash.add(b);
        butts.push(b);
      }
      this.table.add(ash);
      // The pierogi, facing the table.
      const model = buildPierogi(color);
      model.root.scale.setScalar(PIEROGI_S);
      model.root.position.copy(dir).multiplyScalar(SEAT_R);
      model.root.rotation.y = Math.atan2(-dir.x, -dir.z);
      model.mats.forEach((m) => keep(m));
      const tag = nameTag(info[i].name, color, 3.4);
      tag.position.copy(dir).multiplyScalar(SEAT_R + 0.9);
      tag.position.y = 2.2;
      keep(tag.material);
      keep(tag.material.map!);
      const arm = new Mesh(armGeo, mat);
      const hand = new Group();
      hand.add(new Mesh(handGeo, mat));
      const held = this.cig(color, 1.4);
      held.root.position.set(-0.55, 0.12, 0);
      const holder = new Group();
      // The held cigarette lies across the hand, at a right angle to the arm.
      holder.rotation.y = -(a + Math.PI / 2);
      holder.add(held.root);
      hand.add(holder);
      stage.add(model.root, tag, arm, hand);
      this.seats.push({ model, tag, arm, hand, held, heldColor: null, reach: REST_R, handY: HAND_Y, butts, coughPuff: 0 });
    });

    // ---- smoke ----------------------------------------------------------------------
    this.puffGeo = keep(new IcosahedronGeometry(0.5, 1));
    for (let k = 0; k < 14; k++) {
      const mat = keep(new MeshBasicMaterial({ color: '#d4cec4', transparent: true, opacity: 0, depthWrite: false }));
      const mesh = new Mesh(this.puffGeo, mat);
      mesh.renderOrder = 4;
      mesh.rotation.set(Math.random() * TAU, Math.random() * TAU, 0);
      stage.add(mesh);
      this.clouds.push({ mesh, mat, a: (k / 14) * TAU, r: 1.5 + (k % 4) * 1.7, y: 2.6 + (k % 3) * 0.7, s: 4 + (k % 5) * 0.8, sp: 0.04 + (k % 3) * 0.03 });
    }
  }

  private topView() {
    this.stage.lookAt(new Vector3(0, 0.4, -0.5), 21.5, 1.02);
  }

  private matFor(color: string) {
    let m = this.bodyMats.get(color);
    if (!m) {
      m = this.stage.keep(flat(color));
      this.bodyMats.set(color, m);
    }
    return m;
  }

  private cig(color: string, len = CIG_LEN) {
    return new CigModel(this.geos, this.matFor(color), this.filterMat, this.emberMat, this.ashMat, len);
  }

  /** The karczma around the table: log walls, a tiled stove with a fire, shelves, long tables and benches, barrels. */
  private buildKarczma(keep: <T extends { dispose(): void }>(x: T) => T) {
    const add = (...o: Object3D[]) => this.stage.add(...o);
    const logMat = keep(new MeshLambertMaterial({ map: keep(logTexture()), color: '#c08a58', flatShading: true }));
    const dark = keep(flat('#4a2a14'));
    const plank = keep(new MeshLambertMaterial({ map: keep(groundTexture('wood', 2, 17)), color: '#b5814f', flatShading: true }));
    const plankLong = keep(new MeshLambertMaterial({ map: keep(groundTexture('wood', 4, 19)), color: '#c08a58', flatShading: true }));

    // Log walls behind and to the sides (the front is left open for the camera).
    const backLog = keep(new CylinderGeometry(0.4, 0.4, 34, 8));
    backLog.rotateZ(Math.PI / 2);
    const sideLog = keep(new CylinderGeometry(0.4, 0.4, 26, 8));
    sideLog.rotateX(Math.PI / 2);
    for (let j = 0; j < 15; j++) {
      const y = 0.4 + j * 0.74;
      const b = new Mesh(backLog, logMat);
      b.position.set(0, y, WALL_Z);
      add(b);
      for (const x of [-WALL_X, WALL_X]) {
        const s = new Mesh(sideLog, logMat);
        s.position.set(x, y, WALL_Z + 13);
        add(s);
      }
    }

    // The tiled stove (piec kaflowy) with a fire in it.
    const stove = new Group();
    stove.position.set(-8.2, 0, WALL_Z + 1.5);
    const tiles = keep(new MeshLambertMaterial({ map: keep(tileTexture()), flatShading: true }));
    const plinth = box(4.0, 0.45, 2.3, dark);
    const body = box(3.5, 4.4, 1.9, tiles);
    body.position.y += 0.45;
    const cornice = box(4.0, 0.4, 2.3, keep(flat('#e9dcc0')));
    cornice.position.y += 4.85;
    const hood = box(3.0, 0.9, 1.5, tiles);
    hood.position.y += 5.25;
    this.fire = new MeshBasicMaterial({ color: '#ff8a2a' });
    keep(this.fire);
    const mouth = new Mesh(keep(new BoxGeometry(1.2, 0.85, 0.08)), keep(new MeshBasicMaterial({ color: '#1a0c08' })));
    mouth.position.set(0, 1.15, 0.96);
    const flame = new Mesh(keep(new BoxGeometry(0.95, 0.55, 0.06)), this.fire);
    flame.position.set(0, 1.05, 1.0);
    stove.add(plinth, body, cornice, hood, mouth, flame, blobShadow(2.4, 0.35));
    // Firewood stacked beside it.
    const woodGeo = keep(new CylinderGeometry(0.16, 0.16, 1.4, 6));
    woodGeo.rotateX(Math.PI / 2);
    const woodMat = keep(flat('#8a5a32'));
    for (let k = 0; k < 6; k++) {
      const l = new Mesh(woodGeo, woodMat);
      l.position.set(2.5 + (k % 3) * 0.34 + (k >= 3 ? 0.17 : 0), 0.16 + (k >= 3 ? 0.3 : 0), 0.2);
      stove.add(l);
    }
    add(stove);
    this.fireLight = new PointLight('#ff9a4a', 30, 18, 1.4);
    this.fireLight.position.set(-8.2, 1.6, WALL_Z + 3.6);
    add(this.fireLight);

    // On the back wall: the inn's sign, folk plates, shelves of jugs, garlic and peppers.
    const sign = new Mesh(keep(new BoxGeometry(5.6, 1.3, 0.16)), [plank, plank, plank, plank, keep(new MeshLambertMaterial({ map: keep(signTexture('KARCZMA')) })), plank]);
    sign.position.set(8.2, 5.2, WALL_Z + 0.5);
    add(sign);
    const plateMat = keep(new MeshLambertMaterial({ map: keep(plateTexture()) }));
    const plateGeo = keep(new CircleGeometry(0.5, 14));
    for (const [x, y] of [
      [-4.2, 3.9],
      [-3.0, 4.3],
      [3.0, 4.3],
      [4.2, 3.9],
      [-3.6, 2.8],
      [3.6, 2.8],
    ]) {
      const p = new Mesh(plateGeo, plateMat);
      p.position.set(x, y, WALL_Z + 0.45);
      add(p);
    }
    const shelfX = 8.2;
    for (const y of [2.4, 3.7]) {
      const s = box(5.2, 0.12, 0.6, plank);
      s.position.set(shelfX, y, WALL_Z + 0.65);
      add(s);
    }
    const jugCols = ['#e9dcc0', '#3d6db5', '#8a4a2a', '#e9dcc0', '#a51c3d', '#3d6db5', '#c9ccd3', '#8a4a2a'];
    jugCols.forEach((c, k) => {
      const m = keep(flat(c));
      const g = new Group();
      const tall = k % 3 !== 1;
      const b = new Mesh(keep(new CylinderGeometry(tall ? 0.2 : 0.26, tall ? 0.26 : 0.22, tall ? 0.6 : 0.36, 8)), m);
      b.position.y = tall ? 0.3 : 0.18;
      g.add(b);
      if (tall) {
        const neck = new Mesh(keep(new CylinderGeometry(0.1, 0.16, 0.2, 7)), m);
        neck.position.y = 0.7;
        g.add(neck);
      }
      g.position.set(shelfX - 2.1 + (k % 4) * 1.4, k < 4 ? 2.46 : 3.76, WALL_Z + 0.7);
      add(g);
    });
    const strand = keep(flat('#c9a46a'));
    const garlic = keep(flat('#f4ecd8'));
    const pepper = keep(flat('#c8202a'));
    const bulb = keep(new SphereGeometry(0.17, 6, 4));
    const cone = keep(new ConeGeometry(0.09, 0.42, 5));
    for (const [x, kind] of [
      [11.6, 0],
      [12.4, 1],
      [-4.9, 1],
    ] as const) {
      const rope = new Mesh(keep(new CylinderGeometry(0.03, 0.03, 2.6, 4)), strand);
      rope.position.set(x, 4.2, WALL_Z + 0.55);
      add(rope);
      for (let k = 0; k < 7; k++) {
        const m = kind === 0 ? new Mesh(bulb, garlic) : new Mesh(cone, pepper);
        m.position.set(x + (k % 2 ? 0.14 : -0.14), 3.1 + k * 0.3, WALL_Z + 0.6);
        if (kind === 1) m.rotation.z = Math.PI + (k % 2 ? 0.4 : -0.4);
        add(m);
      }
    }

    // Long tables with benches down both sides, laid with mugs, plates, bread and candles.
    const mugMat = keep(flat('#8a5a32'));
    const mugGeo = keep(new CylinderGeometry(0.17, 0.15, 0.36, 8));
    const handleGeo = keep(new TorusGeometry(0.1, 0.035, 4, 8));
    const dishMat = keep(flat('#f4ecd8'));
    const dishGeo = keep(new CylinderGeometry(0.34, 0.28, 0.06, 12));
    const breadMat = keep(flat('#c58a3e'));
    const breadGeo = keep(new SphereGeometry(0.4, 8, 5));
    const candleMat = keep(flat('#f4ecd8'));
    const candleGeo = keep(new CylinderGeometry(0.08, 0.08, 0.4, 6));
    const flameGeo = keep(new ConeGeometry(0.07, 0.2, 5));
    for (const side of [-1, 1]) {
      const x = side * 11.9;
      const top = box(2.2, 0.16, 9.5, plankLong);
      top.position.set(x, 1.02, -0.6);
      add(top);
      for (const z of [-4.6, 3.4]) {
        const leg = box(1.6, 0.94, 0.22, dark);
        leg.position.set(x, 0.47, z);
        add(leg);
      }
      for (const bx of [x - 1.75, x + 1.75]) {
        const bench = box(0.7, 0.14, 9.2, plank);
        bench.position.set(bx, 0.55, -0.6);
        const l1 = box(0.6, 0.48, 0.16, dark);
        l1.position.set(bx, 0.24, -4.4);
        const l2 = l1.clone();
        l2.position.z = 3.2;
        add(bench, l1, l2);
      }
      const shadow = blobShadow(1.0, 0.3);
      shadow.scale.set(1.6, 5, 1);
      shadow.position.set(x, 0.03, -0.6);
      add(shadow);
      const ty = 1.1;
      for (const [dz, what] of [
        [-4.2, 'mug'],
        [-3.3, 'dish'],
        [-2.2, 'candle'],
        [-1.0, 'bread'],
        [0.3, 'mug'],
        [1.1, 'dish'],
        [2.4, 'mug'],
        [3.3, 'candle'],
      ] as const) {
        const ox = side * ((dz * 7) % 2 > 1 ? 0.35 : -0.35);
        if (what === 'mug') {
          const m = new Mesh(mugGeo, mugMat);
          m.position.set(x + ox, ty + 0.18, dz);
          const h = new Mesh(handleGeo, mugMat);
          h.position.set(x + ox + 0.19, ty + 0.2, dz);
          h.rotation.y = Math.PI / 2;
          add(m, h);
        } else if (what === 'dish') {
          const d = new Mesh(dishGeo, dishMat);
          d.position.set(x + ox, ty + 0.03, dz);
          add(d);
        } else if (what === 'bread') {
          const b = new Mesh(breadGeo, breadMat);
          b.scale.set(1.3, 0.6, 0.8);
          b.position.set(x, ty + 0.2, dz);
          add(b);
        } else {
          const c = new Mesh(candleGeo, candleMat);
          c.position.set(x, ty + 0.2, dz);
          const f = new Mesh(flameGeo, this.fire);
          f.position.set(x, ty + 0.5, dz);
          add(c, f);
        }
      }
    }

    // Barrels in the back corners and a couple at the front.
    const barrelMat = keep(new MeshLambertMaterial({ map: keep(groundTexture('wood', 2, 11)), color: '#9a6236', flatShading: true }));
    const hoop = keep(flat('#3a3330'));
    const barrelGeo = keep(new CylinderGeometry(0.85, 0.85, 1.7, 10));
    const hoopGeo = keep(new CylinderGeometry(0.88, 0.88, 0.1, 10));
    const barrel = (x: number, y: number, z: number) => {
      const g = new Group();
      const b = new Mesh(barrelGeo, barrelMat);
      b.position.y = 0.85;
      g.add(b);
      for (const hy of [0.35, 1.35]) {
        const h = new Mesh(hoopGeo, hoop);
        h.position.y = hy;
        g.add(h);
      }
      if (y === 0) g.add(blobShadow(1.0, 0.35));
      g.position.set(x, y, z);
      add(g);
    };
    barrel(13.6, 0, WALL_Z + 1.6);
    barrel(14.6, 0, WALL_Z + 3.4);
    barrel(14.0, 1.7, WALL_Z + 2.4);
    barrel(-14.4, 0, 7.4);
    barrel(14.4, 0, 7.6);
  }

  // ---- smoke -----------------------------------------------------------------------

  private puff(pos: Vector3, v: Vector3, size: number, life: number, color: string) {
    let p = this.puffs.find((q) => q.t >= q.life);
    if (!p) {
      if (this.puffs.length >= 90) return;
      const mat = new MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false });
      const mesh = new Mesh(this.puffGeo, mat);
      mesh.renderOrder = 3;
      this.stage.keep(mat);
      this.stage.add(mesh);
      p = { mesh, mat, t: 0, life: 1, v: new Vector3(), grow: 1, size: 1 };
      this.puffs.push(p);
    }
    p.t = 0;
    p.life = life;
    p.size = size;
    p.grow = 1.4 + Math.random() * 0.8;
    p.v.copy(v);
    p.mat.color.set(color);
    p.mesh.position.copy(pos);
    p.mesh.rotation.set(Math.random() * TAU, Math.random() * TAU, 0);
  }

  private mouth(i: number) {
    const a = this.game.angles[i];
    return new Vector3(Math.cos(a) * (SEAT_R - 0.75), MOUTH_Y + 0.4, Math.sin(a) * (SEAT_R - 0.75));
  }

  private exhale(i: number, amt: number) {
    const a = this.game.angles[i];
    const inward = new Vector3(-Math.cos(a), 0, -Math.sin(a));
    const n = 3 + Math.round((amt / 25) * 5);
    const from = this.mouth(i);
    for (let k = 0; k < n; k++) {
      const s = 1.2 + (amt / 25) * 2.4;
      const v = inward
        .clone()
        .multiplyScalar(s * (0.6 + Math.random() * 0.6))
        .add(new Vector3((Math.random() - 0.5) * 0.9, 0.5 + Math.random() * 0.8, (Math.random() - 0.5) * 0.9));
      this.puff(from.clone().addScaledVector(v, 0.05 * k), v, 0.28 + (amt / 25) * 0.3, 2.2 + Math.random() * 0.8, SMOKE);
    }
  }

  // ---- per frame -------------------------------------------------------------------

  render(dt: number) {
    this.time += dt;
    const g = this.game;
    if (g.phase === 'over') this.renderTower(dt);
    else this.renderTable(dt);
    this.updatePuffs(dt);
    // The room fills with smoke as the game goes on (faster the more everyone smokes): the fog
    // closes in and goes grey, and clouds hang over the table, until the colours are hard to tell apart.
    const now = Date.now();
    let target = 0;
    if (g.phase === 'play') {
      const progress = Math.max(0, Math.min(1, (now - g.goAt) / Math.max(1, g.endsAt - g.goAt)));
      const total = g.seats.reduce((s, x) => s + x.smoked, 0);
      target = Math.min(1, 0.8 * progress + 0.35 * Math.min(1, total / (g.seats.length * 300 + 200)));
    } else if (g.phase === 'over') target = 0.12;
    this.haze += (target - this.haze) * Math.min(1, dt * (g.phase === 'over' ? 1.5 : 0.6));
    const h = this.haze;
    this.fog.color.copy(this.sky).lerp(this.hazeColor, h);
    this.fog.near = 34 - 28 * h;
    this.fog.far = 80 - 44 * h;
    for (const c of this.clouds) {
      c.a += dt * c.sp;
      c.mesh.position.set(Math.cos(c.a) * c.r, c.y + Math.sin(this.time * 0.4 + c.a * 3) * 0.3, Math.sin(c.a) * c.r);
      c.mesh.scale.setScalar(c.s * (0.7 + 0.3 * h));
      c.mesh.rotation.y += dt * 0.05;
      c.mat.opacity = g.phase === 'over' ? 0 : 0.36 * h * h;
      c.mesh.visible = c.mat.opacity > 0.005;
    }
    // The stove's fire flickers.
    const fl = 0.75 + 0.25 * Math.sin(this.time * 13) * Math.sin(this.time * 7.3 + 1);
    this.fire.color.setRGB(1, 0.45 + 0.35 * fl, 0.12 * fl);
    this.fireLight.intensity = 22 + 14 * fl;
    this.stage.render();
  }

  private renderTable(dt: number) {
    const g = this.game;
    const now = Date.now();
    const t = this.time;
    this.tray.rotation.y = -g.trayAt(now);
    g.slots.forEach((c, k) => {
      const s = this.slots[k];
      if (c !== s.was) {
        if (c) {
          s.cig.setColor(this.matFor(c));
          s.pop = 1;
        }
        s.was = c;
      }
      s.cig.root.visible = c !== null;
      s.pop = Math.max(0, s.pop - dt * 3);
      s.cig.root.scale.setScalar(1 - s.pop * 0.8);
    });

    for (const p of g.puffs) {
      if (this.seen.has(p.id)) continue;
      this.seen.add(p.id);
      this.exhale(p.seat, p.amt);
    }

    g.angles.forEach((a, i) => {
      const v = this.seats[i];
      const s = g.seats[i];
      const gone = g.removed.has(i);
      v.model.root.visible = v.tag.visible = v.arm.visible = v.hand.visible = !gone;
      if (gone) return;
      const dir = new Vector3(Math.cos(a), 0, Math.sin(a));
      // Where the hand is: reaching for the tray, at the mouth while pulling, or resting.
      const since = now - s.reachAt;
      let r = REST_R;
      let y = HAND_Y;
      if (s.reachAt && since < REACH_MS) {
        const f = Math.sin(((since / REACH_MS) * Math.PI) / 2);
        r = REST_R + (GRAB_R - REST_R) * f;
        y = HAND_Y + (TRAY_Y + 0.25 - HAND_Y) * f;
      } else if (s.reachAt && since < REACH_MS + RETURN_MS) {
        const f = (since - REACH_MS) / RETURN_MS;
        r = GRAB_R + (REST_R - GRAB_R) * f;
        y = TRAY_Y + 0.25 + (HAND_Y - TRAY_Y - 0.25) * f;
      } else {
        const toMouth = s.pullAt && s.hand === 'cig';
        const k = Math.min(1, dt * 9);
        r = v.reach + ((toMouth ? MOUTH_R : REST_R) - v.reach) * k;
        y = v.handY + ((toMouth ? MOUTH_Y + 0.35 : HAND_Y) - v.handY) * k;
      }
      v.reach = r;
      v.handY = y;
      v.hand.position.set(dir.x * r, y, dir.z * r);
      // The arm runs from the shoulder to the hand.
      const shoulder = new Vector3(dir.x * (SEAT_R - 0.55), 0.85, dir.z * (SEAT_R - 0.55));
      const span = v.hand.position.clone().sub(shoulder);
      v.arm.position.copy(shoulder);
      v.arm.quaternion.copy(new Quaternion().setFromUnitVectors(UP, span.clone().normalize()));
      v.arm.scale.set(1, span.length(), 1);
      // What's in the hand.
      const coughing = s.hand === 'cough';
      const wrongToss = coughing && s.after === 'empty' && s.coughUntil - now < 2200;
      const held = s.holding && (s.hand === 'cig' || (coughing && !wrongToss));
      v.held.root.visible = !!held;
      if (held) {
        if (v.heldColor !== s.holding) {
          v.held.setColor(this.matFor(s.holding!));
          v.heldColor = s.holding;
        }
        const lit = s.hand === 'cig' || s.after === 'cig';
        v.held.setLeft(s.hand === 'cig' || s.after === 'cig' ? s.left / CIG_LENGTH : 1, lit, !!s.pullAt);
      }
      // The pierogi: a bob, a deep breath while pulling, a shaking cough.
      const body = v.model.body;
      body.position.y = Math.abs(Math.sin(t * 2.2 + i)) * 0.04;
      body.rotation.z = coughing ? Math.sin(t * 38) * 0.12 : 0;
      body.position.x = coughing ? Math.sin(t * 31) * 0.05 : 0;
      const breath = s.pullAt && s.hand === 'cig' ? 1.07 : 1;
      body.scale.x += (breath - body.scale.x) * Math.min(1, dt * 6);
      body.scale.z = body.scale.x;
      if (coughing) {
        v.coughPuff -= dt;
        if (v.coughPuff <= 0) {
          v.coughPuff = 0.32;
          const m = this.mouth(i);
          this.puff(m, new Vector3((Math.random() - 0.5) * 1.2, 1.4 + Math.random(), (Math.random() - 0.5) * 1.2).addScaledVector(dir, -0.8), 0.25, 1.1, COUGH);
        }
      }
      // Butts in the ashtray.
      v.butts.forEach((b, k) => (b.visible = k < s.butts));
    });
  }

  private updatePuffs(dt: number) {
    for (const p of this.puffs) {
      if (p.t >= p.life) {
        p.mesh.visible = false;
        continue;
      }
      p.t += dt;
      const f = Math.min(1, p.t / p.life);
      p.mesh.visible = true;
      p.mesh.position.addScaledVector(p.v, dt);
      p.v.multiplyScalar(1 - Math.min(1, dt * 1.4));
      p.v.y += dt * 0.35;
      p.mesh.scale.setScalar(p.size * (0.4 + f * p.grow));
      p.mat.opacity = 0.55 * (f < 0.1 ? f / 0.1 : 1 - (f - 0.1) / 0.9);
    }
  }

  // ---- the tower -------------------------------------------------------------------

  /** Builds the tower (once). Returns where each floor's name goes on the stage, seen from the final camera. */
  towerLayout(): { x: number; y: number }[] {
    if (!this.tower) this.buildTower();
    const n = this.tower!.length;
    const cam = this.stage.camera.clone();
    const f = towerFraming(n);
    cam.position.set(0, f.y + Math.sin(TOWER_TILT) * f.dist, Math.cos(TOWER_TILT) * f.dist);
    cam.lookAt(0, f.y, 0);
    cam.updateMatrixWorld();
    return this.tower!.map((fl) => {
      const v = new Vector3(-1.45 * TOWER_S, fl.y + 0.5 * TOWER_S, 0).project(cam);
      return { x: ((v.x + 1) / 2) * 1920, y: ((1 - v.y) / 2) * 1080 };
    });
  }

  private makeCrown(keep: <T extends { dispose(): void }>(x: T) => T) {
    const gold = keep(flat('#ffc93c', { emissive: '#6a4a00' }));
    const gem = keep(new MeshBasicMaterial({ color: '#ff3d6e' }));
    const crown = new Group();
    const ring = new Mesh(keep(new CylinderGeometry(0.5, 0.44, 0.32, 8, 1, true)), gold);
    ring.position.y = 0.16;
    crown.add(ring);
    for (let j = 0; j < 5; j++) {
      const a = (j / 5) * TAU;
      const spike = new Mesh(keep(new CylinderGeometry(0, 0.13, 0.38, 4)), gold);
      spike.position.set(Math.cos(a) * 0.44, 0.5, Math.sin(a) * 0.44);
      crown.add(spike);
      const ball = new Mesh(keep(new SphereGeometry(0.06, 5, 3)), gold);
      ball.position.set(Math.cos(a) * 0.44, 0.7, Math.sin(a) * 0.44);
      crown.add(ball);
    }
    const jewel = new Mesh(keep(new SphereGeometry(0.09, 5, 3)), gem);
    jewel.position.set(0, 0.17, 0.49);
    crown.add(jewel);
    crown.visible = false;
    this.stage.add(crown);
    return crown;
  }

  private buildTower() {
    const g = this.game;
    const keep = <T extends { dispose(): void }>(x: T) => this.stage.keep(x);
    // Clear the table: the tray and the seats go, the pierogi climb on top of each other.
    this.tray.visible = false;
    for (const v of this.seats) v.model.root.visible = v.tag.visible = v.arm.visible = v.hand.visible = false;
    const yellow = yellowness(g.seats.map((s) => s.smoked));
    const mouthGeo = keep(new CircleGeometry(0.34, 12, Math.PI, Math.PI));
    const toothGeo = keep(new BoxGeometry(0.078, 0.1, 0.03));
    const mouthMat = keep(new MeshBasicMaterial({ color: '#5a1020' }));
    this.tower = g.tower.map((seat, k) => {
      const model = buildPierogi(this.info[seat].color);
      model.mats.forEach((m) => keep(m));
      model.root.scale.setScalar(TOWER_S);
      model.shadow.visible = k === 0;
      const y = TABLE_Y + k * TOWER_STEP;
      model.root.position.set(0, y, 0);
      model.root.visible = false;
      // A big open grin with a row of separate teeth along the top.
      const mouth = new Mesh(mouthGeo, mouthMat);
      mouth.position.set(0, 0.27, 0.42);
      const teethMat = keep(new MeshBasicMaterial({ color: '#fbf8ee' }));
      const teeth = new Group();
      for (let j = 0; j < 6; j++) {
        const tooth = new Mesh(toothGeo, teethMat);
        tooth.position.set(-0.235 + j * 0.094, 0.215, 0);
        teeth.add(tooth);
      }
      teeth.position.z = 0.435;
      model.body.add(mouth, teeth);
      this.stage.add(model.root);
      return { seat, model, mouth, teeth, teethMat, teethTo: new Color(teethColor(yellow[seat])), y };
    });
    this.crown = this.makeCrown(keep);
    // Tied winners get a crown each; the first one is the crown that hovered.
    this.extraCrowns = (g.finale?.winners ?? []).slice(1).map(() => this.makeCrown(keep));
    const f = towerFraming(1);
    this.camY = f.y;
    this.camDist = f.dist;
  }

  private renderTower(dt: number) {
    this.towerLayout();
    const g = this.game;
    const fin = g.finale;
    if (!fin) return;
    const T = fin.times;
    const el = Date.now() - g.finaleAt;
    const n = this.tower!.length;
    const winners = fin.winners;

    // The camera rises with the tower as the pierogi land.
    const landed = Math.max(1, Math.min(n, (el - FALL_MS) / DROP_MS + 1));
    const want = towerFraming(Math.ceil(landed - 0.05));
    const k = Math.min(1, dt * 3);
    this.camY += (want.y - this.camY) * k;
    this.camDist += (want.dist - this.camDist) * k;
    this.stage.lookAt(new Vector3(0, this.camY, 0), this.camDist, TOWER_TILT);

    // Which floor the crown hovers by during the suspense.
    let hop = -1;
    if (el >= T.suspense && el < T.reveal) {
      const s = el - T.suspense;
      for (const h of fin.hops) if (h.at <= s) hop = h.floor;
    }

    this.tower!.forEach((f, i) => {
      const m = f.model;
      const t = el - i * DROP_MS;
      m.root.visible = t > 0;
      // Falling in from above, then landing with a squash; every landing above jolts the ones below.
      const fall = Math.max(0, Math.min(1, t / FALL_MS));
      // At the reveal the floors above each winner lift, so the crown lands clearly on the winner's head.
      const lift = Math.max(0, Math.min(1, (el - T.reveal) / 350)) * 1.1 * winners.filter((w) => w < i).length;
      m.root.position.y = f.y + (1 - fall * fall) * DROP_HEIGHT + lift;
      let squash = t > FALL_MS ? Math.max(0, 1 - (t - FALL_MS) / 260) : 0;
      for (let j = i + 1; j < n; j++) {
        const tj = el - (j * DROP_MS + FALL_MS);
        if (tj > 0 && tj < 220) squash = Math.max(squash, 0.35 * (1 - tj / 220));
      }
      const pick = hop === i ? 1 : 0;
      m.body.scale.set(1 + 0.18 * squash + 0.06 * pick, 1 - 0.22 * squash + 0.04 * pick, 1 + 0.18 * squash);
      m.body.rotation.z = pick ? Math.sin(this.time * 18) * 0.06 : 0;
      // Closed mouth until the flash, then the grin; teeth go yellow after.
      const open = el >= T.flash;
      f.mouth.scale.y = open ? 1 : 0.12;
      f.teeth.visible = open;
      const yf = Math.max(0, Math.min(1, (el - T.flash - 350) / 1600));
      f.teethMat.color.set('#fbf8ee').lerp(f.teethTo, yf);
      // The winners step out of the tower to be crowned.
      const out = winners.includes(i) ? Math.max(0, Math.min(1, (el - T.reveal) / 350)) : 0;
      m.root.position.z = out * WIN_OUT;
      m.root.scale.setScalar(TOWER_S * (1 + WIN_GROW * out));
      if (out > 0 && el > T.reveal + 900) m.body.rotation.z = Math.sin(this.time * 6) * 0.05;
    });

    const crown = this.crown!;
    const opened = Math.max(0, Math.min(1, (el - T.reveal) / 350)) * 1.1;
    const head = (i: number) => this.tower![i].y + opened * winners.filter((w) => w < i).length + 1.03 * TOWER_S * (1 + WIN_GROW);
    if (el < T.suspense) crown.visible = false;
    else if (el < T.reveal) {
      // Hovering beside the tower, hopping from floor to floor.
      crown.visible = true;
      const ty = this.tower![Math.max(0, hop)].y + 0.75 * TOWER_S;
      const enter = Math.min(1, (el - T.suspense) / 400);
      this.crownY = enter < 1 ? ty + (1 - enter) * 6 : this.crownY + (ty - this.crownY) * Math.min(1, dt * 16);
      crown.position.set(2.3, this.crownY + Math.sin(this.time * 5) * 0.08, 0.6);
      crown.scale.setScalar(1.25);
      crown.rotation.set(0, this.time * 2.5, 0.35);
    } else if (winners.length) {
      // Up over the winner, then down onto their head.
      const w = winners[0];
      const r = el - T.reveal;
      const hx = 0;
      const hz = WIN_OUT + 0.12;
      const hy = head(w);
      if (r < 450) {
        const f = r / 450;
        crown.position.set(2.3 + (hx - 2.3) * f, this.crownY + (hy + 2.6 - this.crownY) * f + Math.sin(f * Math.PI) * 1.2, 0.6 + (hz - 0.6) * f);
      } else {
        const f = Math.min(1, (r - 450) / 320);
        const bounce = f >= 1 ? Math.max(0, Math.sin((r - 770) / 90) * 0.12 * Math.max(0, 1 - (r - 770) / 500)) : 0;
        crown.position.set(hx, hy + 2.6 * (1 - f * f) + bounce, hz);
        if (f >= 1 && !this.sparkled) {
          this.sparkled = true;
          this.sparkle(new Vector3(hx, hy + 0.4, hz));
        }
      }
      crown.rotation.set(0, Math.max(0, 1 - r / 700) * this.time * 2.5, -0.15);
      crown.scale.setScalar(1.25 - 0.25 * Math.min(1, r / 450));
      this.extraCrowns.forEach((c, j) => {
        const wi = winners[j + 1];
        const f = Math.max(0, Math.min(1, (r - 450) / 320));
        c.visible = r > 300;
        c.position.set(0, head(wi) + 4 * (1 - f * f), hz);
        c.rotation.set(0, 0, -0.15);
      });
    } else {
      // Nobody smoked a thing: the crown gives up and floats away.
      crown.position.y += dt * 4;
      crown.rotation.y += dt * 3;
    }
  }

  /** A burst of gold sparks. */
  private sparkle(at: Vector3) {
    for (let k = 0; k < 18; k++) {
      const a = (k / 18) * TAU;
      this.puff(at.clone(), new Vector3(Math.cos(a) * 4, 2 + Math.random() * 3, Math.sin(a) * 2 + 1), 0.2, 0.9, k % 2 ? '#ffd23f' : '#fff4dc');
    }
  }

  dispose() {
    this.stage.dispose();
  }
}

/** A round folk rug: red and cream rings with a dotted border. */
function rugTexture() {
  return pixelTexture(
    64,
    (ctx, rnd) => {
      for (let y = 0; y < 64; y++)
        for (let x = 0; x < 64; x++) {
          const d = Math.hypot(x - 31.5, y - 31.5);
          const band = Math.floor(d / 4);
          const pal = ['#a51c3d', '#c4314f', '#f0d9a4', '#a51c3d', '#2a6b5a', '#a51c3d', '#f0d9a4', '#7a1630'];
          const c = new Color(pal[band % pal.length]);
          const v = 0.92 + rnd() * 0.12;
          ctx.fillStyle = `rgb(${c.r * 255 * v},${c.g * 255 * v},${c.b * 255 * v})`;
          ctx.fillRect(x, y, 1, 1);
        }
      ctx.fillStyle = '#ffd23f';
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * TAU;
        ctx.fillRect(Math.round(31.5 + Math.cos(a) * 18), Math.round(31.5 + Math.sin(a) * 18), 2, 2);
      }
    },
    21,
    1,
  );
}

/** A lace doily: cream with holes in rings and a scalloped edge. */
function doilyTexture() {
  return pixelTexture(
    64,
    (ctx) => {
      for (let y = 0; y < 64; y++)
        for (let x = 0; x < 64; x++) {
          const dx = x - 31.5;
          const dy = y - 31.5;
          const d = Math.hypot(dx, dy);
          const a = Math.atan2(dy, dx);
          const edge = 30 + Math.cos(a * 16) * 1.6;
          let on = d < edge;
          // Rings of little holes.
          for (const [rr, cnt] of [
            [12, 10],
            [20, 16],
            [26, 24],
          ]) {
            const seg = (((a / TAU) * cnt) % 1 + 1) % 1;
            if (Math.abs(d - rr) < 1.3 && Math.abs(seg - 0.5) < 0.22) on = false;
          }
          ctx.fillStyle = on ? (Math.abs(d - 16) < 0.6 || Math.abs(d - 23) < 0.6 ? '#e2d3b4' : '#fbf3e2') : 'rgba(0,0,0,0)';
          ctx.fillRect(x, y, 1, 1);
        }
    },
    1,
    1,
  );
}

/** Logs: brown with grain along their length and darker rings. */
function logTexture() {
  return pixelTexture(
    16,
    (ctx, rnd) => {
      for (let y = 0; y < 16; y++)
        for (let x = 0; x < 16; x++) {
          const v = (rnd() - 0.5) * 24 + (y % 5 === 0 ? -26 : 0);
          ctx.fillStyle = `rgb(${150 + v},${100 + v * 0.8},${60 + v * 0.5})`;
          ctx.fillRect(x, y, 1, 1);
        }
    },
    23,
    3,
  );
}

/** Stove tiles: cream with a blue folk flower, in a grid. */
function tileTexture() {
  return pixelTexture(
    32,
    (ctx, rnd) => {
      for (let y = 0; y < 32; y++)
        for (let x = 0; x < 32; x++) {
          const v = (rnd() - 0.5) * 10;
          ctx.fillStyle = x % 16 === 0 || y % 16 === 0 ? '#b7a98c' : `rgb(${240 + v},${232 + v},${214 + v})`;
          ctx.fillRect(x, y, 1, 1);
        }
      for (const [ox, oy] of [
        [0, 0],
        [16, 0],
        [0, 16],
        [16, 16],
      ]) {
        ctx.fillStyle = '#2f5fa8';
        for (const [dx, dy] of [
          [7, 4],
          [7, 10],
          [4, 7],
          [10, 7],
        ])
          ctx.fillRect(ox + dx, oy + dy, 2, 2);
        ctx.fillStyle = '#c8202a';
        ctx.fillRect(ox + 7, oy + 7, 2, 2);
      }
    },
    29,
    2,
  );
}

/** A painted folk plate: rings and a rosette. */
function plateTexture() {
  return pixelTexture(
    32,
    (ctx) => {
      for (let y = 0; y < 32; y++)
        for (let x = 0; x < 32; x++) {
          const d = Math.hypot(x - 15.5, y - 15.5);
          const a = Math.atan2(y - 15.5, x - 15.5);
          let c = '#f4ecd8';
          if (d > 13.5) c = '#2f5fa8';
          else if (d > 12) c = '#f4ecd8';
          else if (d > 10.8) c = '#c8202a';
          else if (d < 7 && Math.cos(a * 8) > 0.2 - d * 0.05) c = d < 2.5 ? '#ffd23f' : '#c8202a';
          else if (d < 9.5 && d > 8 && Math.cos(a * 12) > 0.5) c = '#3f8a4a';
          ctx.fillStyle = c;
          ctx.fillRect(x, y, 1, 1);
        }
    },
    31,
    1,
  );
}

/** The inn's sign: carved, cream letters on dark wood. */
function signTexture(text: string) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 32;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#5a3418';
  ctx.fillRect(0, 0, 128, 32);
  ctx.fillStyle = '#3a200c';
  ctx.fillRect(0, 0, 128, 2);
  ctx.fillRect(0, 30, 128, 2);
  ctx.font = '900 22px "Fraunces Variable", Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#2a1408';
  ctx.fillText(text, 65, 18);
  ctx.fillStyle = '#f4dca4';
  ctx.fillText(text, 64, 17);
  const t = new CanvasTexture(c);
  t.magFilter = t.minFilter = NearestFilter;
  t.colorSpace = SRGBColorSpace;
  return t;
}
