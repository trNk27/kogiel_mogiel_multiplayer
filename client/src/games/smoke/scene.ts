/**
 * Fajki's three.js scene: a smoky back room, seen from above. A round table with a lace doily and a
 * lazy Susan of cigarettes in the players' colours; the pierogi sit around it and reach in with
 * their arms. At the end they stack into a tower on the table and grin, teeth as yellow as they smoked.
 */
import {
  CircleGeometry,
  Color,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  Vector3,
  type Fog,
  type Material,
} from 'three';
import { ArenaStage, blobShadow, box, buildPierogi, flat, groundTexture, nameTag, pixelTexture, type PierogiModel } from '../arena/kit';
import { mulberry32 } from '../rng';
import { CIG_LENGTH, CROWN_AFTER_MS, DROP_MS, REACH_MS, RETURN_MS, teethColor, yellowness } from './logic';

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
  readonly flashAfter: number;
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
  teeth: Mesh;
  teethMat: MeshBasicMaterial;
  teethTo: Color;
  y: number;
  crown: Group | null;
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
  private towerTop = 0;

  constructor(
    canvas: HTMLCanvasElement,
    private info: SeatInfo[],
    private game: SmokeState,
  ) {
    // Vaporwave turns every colour pink or cyan, and here your colour is the whole game.
    const stage = (this.stage = new ArenaStage(canvas, { sky: '#2a1a1e', fog: [34, 80], fov: 40, styles: ['psx', 'paper'] }));
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
    this.buildProps(keep);

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
  }

  private topView() {
    this.stage.lookAt(new Vector3(0, 0.4, 0.6), 21.5, 1.13);
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

  private buildProps(keep: <T extends { dispose(): void }>(x: T) => T) {
    const rnd = mulberry32(31);
    const barrelMat = keep(new MeshLambertMaterial({ map: keep(groundTexture('wood', 2, 11)), color: '#9a6236', flatShading: true }));
    const hoop = keep(flat('#3a3330'));
    const bottle = keep(new MeshLambertMaterial({ color: '#3d7a4a', flatShading: true, transparent: true, opacity: 0.85 }));
    const clear = keep(new MeshLambertMaterial({ color: '#d9eef2', flatShading: true, transparent: true, opacity: 0.7 }));
    const crate = keep(new MeshLambertMaterial({ map: keep(groundTexture('wood', 1, 13)), color: '#b07a48', flatShading: true }));
    const barrel = (x: number, z: number) => {
      const g = new Group();
      const b = new Mesh(keep(new CylinderGeometry(0.85, 0.85, 1.7, 10)), barrelMat);
      b.position.y = 0.85;
      g.add(b);
      for (const y of [0.35, 1.35]) {
        const h = new Mesh(keep(new CylinderGeometry(0.88, 0.88, 0.1, 10)), hoop);
        h.position.y = y;
        g.add(h);
      }
      g.add(blobShadow(1.0, 0.35));
      g.position.set(x, 0, z);
      this.stage.add(g);
    };
    const bottleAt = (x: number, z: number, mat: Material) => {
      const g = new Group();
      const b = new Mesh(keep(new CylinderGeometry(0.2, 0.2, 0.7, 7)), mat);
      b.position.y = 0.35;
      const neck = new Mesh(keep(new CylinderGeometry(0.07, 0.1, 0.35, 6)), mat);
      neck.position.y = 0.85;
      g.add(b, neck, blobShadow(0.26, 0.3));
      g.position.set(x, 0, z);
      this.stage.add(g);
    };
    barrel(-11.5, -3.5);
    barrel(-12.6, -1.4);
    barrel(11.8, -4.2);
    const c1 = box(1.8, 1.1, 1.4, crate);
    c1.position.set(12.4, 0.55, 2.2);
    c1.rotation.y = 0.3;
    const c2 = box(1.3, 0.9, 1.1, crate);
    c2.position.set(12.1, 1.55, 2.1);
    c2.rotation.y = -0.2;
    const c3 = box(1.6, 1.0, 1.3, crate);
    c3.position.set(-12.2, 0.5, 3.4);
    c3.rotation.y = -0.4;
    this.stage.add(c1, c2, c3);
    for (let k = 0; k < 9; k++) {
      const side = k % 2 ? 1 : -1;
      bottleAt(side * (9.6 + rnd() * 3), -6 + rnd() * 12, rnd() < 0.5 ? bottle : clear);
    }
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
    if (g.phase === 'over') this.renderTower();
    else this.renderTable(dt);
    this.updatePuffs(dt);
    // The room fills with smoke as everyone smokes: the fog closes in and goes grey.
    const total = g.seats.reduce((s, x) => s + x.smoked, 0);
    const target = Math.min(0.75, total / (g.seats.length * 450 + 300));
    this.haze += (target - this.haze) * Math.min(1, dt * 0.8);
    this.fog.color.copy(this.sky).lerp(this.hazeColor, this.haze * 0.9);
    this.fog.near = 34 - 24 * this.haze;
    this.fog.far = 80 - 30 * this.haze;
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

  /** Builds the tower and points the camera at it (idempotent). Returns where each floor's labels go on the stage. */
  towerLayout(): { y: number; left: { x: number; y: number }; right: { x: number; y: number } }[] {
    if (!this.tower) this.buildTower();
    return this.tower!.map((f) => {
      const mid = f.y + 0.55 * TOWER_S;
      const l = this.stage.toStage(new Vector3(-1.45 * TOWER_S, mid, 0));
      const r = this.stage.toStage(new Vector3(1.45 * TOWER_S, mid, 0));
      return { y: f.y, left: l, right: r };
    });
  }

  private buildTower() {
    const g = this.game;
    const keep = <T extends { dispose(): void }>(x: T) => this.stage.keep(x);
    // Clear the table: the tray and the seats go, the pierogi climb on top of each other.
    this.tray.visible = false;
    for (const v of this.seats) v.model.root.visible = v.tag.visible = v.arm.visible = v.hand.visible = false;
    const yellow = yellowness(g.seats.map((s) => s.smoked));
    const top = Math.max(...g.tower.map((i) => g.seats[i].smoked));
    const mouthGeo = keep(new CircleGeometry(0.34, 12, Math.PI, Math.PI));
    const teethGeo = keep(new CylinderGeometry(0.03, 0.03, 0.56, 4));
    const mouthMat = keep(new MeshBasicMaterial({ color: '#5a1020' }));
    const gold = keep(flat('#ffc93c', { emissive: '#6a4a00' }));
    const gem = keep(new MeshBasicMaterial({ color: '#ff3d6e' }));
    this.tower = g.tower.map((seat, k) => {
      const model = buildPierogi(this.info[seat].color);
      model.mats.forEach((m) => keep(m));
      model.root.scale.setScalar(TOWER_S);
      model.shadow.visible = k === 0;
      const y = TABLE_Y + k * TOWER_STEP;
      model.root.position.set(0, y, 0);
      // A big open grin, teeth along the top.
      const mouth = new Mesh(mouthGeo, mouthMat);
      mouth.position.set(0, 0.27, 0.42);
      const teethMat = keep(new MeshBasicMaterial({ color: '#fbf8ee' }));
      const teeth = new Mesh(teethGeo, teethMat);
      teeth.rotation.z = Math.PI / 2;
      teeth.scale.set(2.6, 1, 1);
      teeth.position.set(0, 0.235, 0.435);
      model.body.add(mouth, teeth);
      let crown: Group | null = null;
      if (g.seats[seat].smoked === top && top > 0) {
        crown = new Group();
        const ring = new Mesh(keep(new CylinderGeometry(0.34, 0.3, 0.22, 8, 1, true)), gold);
        ring.position.y = 0.11;
        crown.add(ring);
        for (let j = 0; j < 5; j++) {
          const a = (j / 5) * TAU;
          const spike = new Mesh(keep(new CylinderGeometry(0, 0.09, 0.26, 4)), gold);
          spike.position.set(Math.cos(a) * 0.3, 0.33, Math.sin(a) * 0.3);
          crown.add(spike);
        }
        const jewel = new Mesh(keep(new SphereGeometry(0.06, 5, 3)), gem);
        jewel.position.set(0, 0.12, 0.33);
        crown.add(jewel);
        crown.position.set(0.15, 0.95, 0.1);
        crown.rotation.z = -0.25;
        crown.visible = false;
        model.body.add(crown);
      }
      this.stage.add(model.root);
      return { seat, model, mouth, teeth, teethMat, teethTo: new Color(teethColor(yellow[seat])), y, crown };
    });
    this.towerTop = TABLE_Y + (g.tower.length - 1) * TOWER_STEP + 1.1 * TOWER_S;
    const h = this.towerTop - TABLE_Y;
    const mid = TABLE_Y + h / 2;
    this.stage.lookAt(new Vector3(0, mid, 0), Math.max(9, (h + 1.6) / 0.62), 0.12);
    // Labels are placed from the camera before it first renders from here.
    this.stage.camera.updateMatrixWorld();
  }

  private renderTower() {
    this.towerLayout();
    const g = this.game;
    const el = Date.now() - g.finaleAt;
    const flash = g.flashAfter;
    this.tower!.forEach((f, k) => {
      const t = el - k * DROP_MS;
      const m = f.model;
      m.root.visible = t > 0;
      // Fall in from above with a little squash on landing.
      const fall = Math.max(0, 1 - t / 420);
      m.root.position.y = f.y + fall * fall * 14;
      const land = t > 420 ? Math.max(0, 1 - (t - 420) / 260) : 0;
      m.body.scale.set(1 + 0.18 * land, 1 - 0.22 * land, 1 + 0.18 * land);
      // Closed mouth until the flash, then the grin; teeth go yellow after.
      const open = el >= flash;
      f.mouth.scale.y = open ? 1 : 0.12;
      f.teeth.visible = open;
      const yf = Math.max(0, Math.min(1, (el - flash - 350) / 1600));
      f.teethMat.color.set('#fbf8ee').lerp(f.teethTo, yf);
      if (f.crown) {
        const c = el - flash - CROWN_AFTER_MS;
        f.crown.visible = c > 0;
        f.crown.scale.setScalar(c > 0 ? Math.min(1.15, (c / 250) * 1.15) - Math.max(0, Math.min(0.15, (c - 250) / 600)) : 0);
        m.body.rotation.z = c > 0 ? Math.sin(this.time * 6) * 0.05 : 0;
        // The winner steps out of the tower, so the crown isn't hidden under the next one up.
        const out = Math.max(0, Math.min(1, (el - flash - CROWN_AFTER_MS + 300) / 300));
        m.root.position.z = out * 1.1;
        m.root.scale.setScalar(TOWER_S * (1 + 0.12 * out));
      }
    });
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
