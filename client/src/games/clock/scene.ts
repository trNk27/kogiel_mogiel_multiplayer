/**
 * Minutnik in 3D: Babcia's kitchen. A big wooden table in front of a tiled wall, a stove with a
 * steaming pot on the left, a window with lace curtains on the right. On the table stands a giant
 * tomato kitchen timer with a big dial, Babcia beside it with her tea towel, and in front a row of
 * pierogi, each with a little service bell. Same PS2 look as the other arena games.
 *
 * The table top is y = 0; the camera looks from +z.
 */
import {
  BufferAttribute,
  CanvasTexture,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  LinearFilter,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  RingGeometry,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
  type Sprite,
} from 'three';
import { ArenaStage, box, buildPierogi, flat, groundTexture, nameTag, pixelTexture, type PierogiModel } from '../arena/kit';
import { buildBabcia } from '../arena/babcia';
import { Puffs } from '../arena/puffs';

export interface PlayerLook {
  name: string;
  color: string;
}

/** Spacing of the pierogi along the front of the table. */
export const SPACING = 1.9;
const ROW_Z = 2.3;
const BELL_Z = 3.35;
/** The tomato: centre and radius. */
const TOM = new Vector3(0, 2.3, -1.6);
const TOM_R = 2.4;
const TOM_SQUASH = 0.92;
/** The towel wraps a sphere a little bigger than the tomato (so it clears the dial's rim). */
const WRAP_R = TOM_R * 1.08;
const TOWEL = 11;
const TOWEL_SEG = 22;
/** Seconds round the dial. */
export const DIAL_SECONDS = 30;
const BABCIA_AT = new Vector3(5.4, 0, -2.6);

interface Actor {
  model: PierogiModel;
  tag: Sprite;
  color: string;
  x: number;
  /** Seconds since the last bell tap, or -1. */
  tap: number;
  /** Has pressed this round (sits back, relaxed). */
  done: boolean;
  bell: Group;
  button: Mesh;
  dome: MeshLambertMaterial;
  crown: Group;
  /** Seconds since the crown started dropping, or -1. */
  crownT: number;
}

const smooth = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

export class ClockScene {
  readonly stage: ArenaStage;
  private actors: Actor[] = [];
  private puffs = new Puffs(220, -0.4, 1.2);
  private sparks = new Puffs(160, 7, 1.4);
  private tomato = new Group();
  private dialCanvas: HTMLCanvasElement;
  private dialTex: CanvasTexture;
  private dialKey = '';
  private towel: Mesh;
  private towelGeo: PlaneGeometry;
  private towelBase: Float32Array;
  /** 'off': folded away; 'drop' / 'lift': moving, `towelK` 0..1; 'on': draped. */
  private towelMode: 'off' | 'drop' | 'on' | 'lift' = 'off';
  private towelK = 0;
  private babcia: PierogiModel;
  private throwT = -1;
  private pot: Group;
  private curtains: Mesh[] = [];
  private time = 0;
  private shake = 0;
  private bump = 0;
  private halfW: number;

  constructor(canvas: HTMLCanvasElement, looks: PlayerLook[]) {
    this.stage = new ArenaStage(canvas, { sky: '#e9cfa0', fog: [70, 150], fov: 36 });
    const stage = this.stage;
    const keep = <T extends { dispose(): void }>(x: T) => stage.keep(x);
    this.halfW = Math.max(8.5, ((Math.max(1, looks.length) - 1) / 2) * SPACING + 4.5);

    this.pot = this.buildKitchen(keep);

    // ---- the tomato timer ----
    const red = keep(flat('#d8322a'));
    const body = new Mesh(keep(new SphereGeometry(TOM_R, 16, 11)), red);
    const leaf = keep(flat('#3f8a2a'));
    const stalk = new Mesh(keep(new CylinderGeometry(0.14, 0.2, 0.7, 6)), leaf);
    stalk.position.y = TOM_R + 0.2;
    this.tomato.add(body, stalk);
    for (let k = 0; k < 6; k++) {
      const l = new Mesh(keep(new ConeGeometry(0.32, 1.5, 4)), leaf);
      const a = (k / 6) * Math.PI * 2;
      l.position.set(Math.cos(a) * 0.65, TOM_R - 0.08, Math.sin(a) * 0.65);
      l.rotation.set(Math.sin(a) * 1.35, 0, -Math.cos(a) * 1.35);
      l.scale.set(1, 1, 0.35);
      this.tomato.add(l);
    }
    // A highlight, so it reads as shiny.
    const shine = new Mesh(keep(new SphereGeometry(0.45, 6, 4)), keep(new MeshBasicMaterial({ color: '#ff8a70' })));
    shine.position.set(-1.25, 1.35, 1.35);
    shine.scale.set(1, 0.6, 0.3);
    this.tomato.add(shine);
    // The dial: a cap of the sphere, so it sits flush, with the face painted on a canvas.
    this.dialCanvas = document.createElement('canvas');
    this.dialCanvas.width = this.dialCanvas.height = 256;
    this.dialTex = keep(new CanvasTexture(this.dialCanvas));
    this.dialTex.colorSpace = SRGBColorSpace;
    this.dialTex.magFilter = LinearFilter;
    this.dialTex.minFilter = LinearFilter;
    const DIAL_R = 1.62;
    const capGeo = keep(new RingGeometry(0.001, DIAL_R, 40, 8));
    const cp = capGeo.attributes.position as BufferAttribute;
    for (let i = 0; i < cp.count; i++) {
      const x = cp.getX(i);
      const y = cp.getY(i);
      cp.setZ(i, Math.sqrt(Math.max(0, (TOM_R * 1.012) ** 2 - x * x - y * y)));
    }
    capGeo.computeVertexNormals();
    const cap = new Mesh(capGeo, keep(new MeshBasicMaterial({ map: this.dialTex })));
    const rim = new Mesh(keep(new TorusGeometry(DIAL_R, 0.09, 5, 32)), keep(flat('#f1e4c4')));
    rim.position.z = Math.sqrt(TOM_R ** 2 - DIAL_R ** 2);
    this.tomato.add(cap, rim);
    this.tomato.position.copy(TOM);
    this.tomato.scale.y = TOM_SQUASH;
    this.tomato.rotation.x = -0.12;
    const tShadow = new Mesh(keep(new SphereGeometry(1, 10, 4)), keep(new MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.25, depthWrite: false })));
    tShadow.scale.set(TOM_R * 1.05, 0.01, TOM_R * 0.9);
    tShadow.position.set(TOM.x, 0.03, TOM.z);
    stage.add(this.tomato, tShadow);
    this.drawDial(0, '0', null);

    // ---- Babcia and her tea towel ----
    this.babcia = buildBabcia(keep);
    this.babcia.root.scale.setScalar(1.6);
    this.babcia.root.position.copy(BABCIA_AT);
    this.babcia.root.rotation.y = -0.45;
    stage.add(this.babcia.root);

    const check = keep(
      pixelTexture(
        16,
        (ctx) => {
          ctx.fillStyle = '#fbf6ea';
          ctx.fillRect(0, 0, 16, 16);
          ctx.fillStyle = 'rgba(206,40,48,.55)';
          ctx.fillRect(0, 0, 16, 4);
          ctx.fillRect(0, 0, 4, 16);
          ctx.fillStyle = '#c8232c';
          ctx.fillRect(0, 0, 4, 4);
          ctx.fillStyle = 'rgba(206,40,48,.25)';
          ctx.fillRect(8, 0, 2, 16);
          ctx.fillRect(0, 8, 16, 2);
        },
        5,
        5,
      ),
    );
    this.towelGeo = keep(new PlaneGeometry(TOWEL, TOWEL, TOWEL_SEG, TOWEL_SEG));
    this.towelGeo.rotateX(-Math.PI / 2);
    this.towelBase = Float32Array.from(this.towelGeo.attributes.position.array as ArrayLike<number>);
    this.towel = new Mesh(this.towelGeo, keep(new MeshLambertMaterial({ map: check, side: DoubleSide, flatShading: true })));
    this.towel.frustumCulled = false;
    this.towel.visible = false;
    stage.add(this.towel);

    stage.add(this.puffs.mesh, this.sparks.mesh);

    // ---- players, bells, crowns ----
    const gold = keep(flat('#e8b53a'));
    const wood = keep(flat('#5a3418'));
    const steel = keep(flat('#cfd3d6'));
    const baseGeo = keep(new CylinderGeometry(0.36, 0.42, 0.14, 10));
    const domeGeo = keep(new SphereGeometry(0.32, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2));
    const btnGeo = keep(new CylinderGeometry(0.06, 0.06, 0.16, 6));
    const crownGeo = keep(new CylinderGeometry(0.42, 0.38, 0.28, 8, 1, true));
    const spikeGeo = keep(new ConeGeometry(0.1, 0.3, 4));
    const gemGeo = keep(new SphereGeometry(0.07, 4, 2));
    const gem = keep(new MeshBasicMaterial({ color: '#e8335a' }));
    looks.forEach((l, i) => {
      const x = (i - (looks.length - 1) / 2) * SPACING;
      const model = buildPierogi(l.color);
      model.mats.forEach((m) => keep(m));
      const tag = nameTag(l.name, l.color);
      tag.position.set(0, 1.85, 0);
      tag.scale.set(2.6, 0.65, 1);
      model.root.add(tag);
      model.root.position.set(x, 0, ROW_Z);
      stage.add(model.root);

      const bell = new Group();
      const base = new Mesh(baseGeo, wood);
      base.position.y = 0.07;
      const domeMat = keep(new MeshLambertMaterial({ color: '#e8b53a', flatShading: true, emissive: '#000000' }));
      const dome = new Mesh(domeGeo, domeMat);
      dome.position.y = 0.14;
      const button = new Mesh(btnGeo, steel);
      button.position.y = 0.5;
      bell.add(base, dome, button);
      bell.position.set(x, 0, BELL_Z);
      stage.add(bell);

      const crown = new Group();
      const band = new Mesh(crownGeo, gold);
      crown.add(band);
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        const s = new Mesh(spikeGeo, gold);
        s.position.set(Math.cos(a) * 0.4, 0.28, Math.sin(a) * 0.4);
        const g = new Mesh(gemGeo, gem);
        g.position.set(Math.cos(a) * 0.42, 0.02, Math.sin(a) * 0.42);
        crown.add(s, g);
      }
      crown.visible = false;
      stage.add(crown);
      this.actors.push({ model, tag, color: l.color, x, tap: -1, done: false, bell, button, dome: domeMat, crown, crownT: -1 });
    });
  }

  // ---- the kitchen ----------------------------------------------------------------------------------
  private buildKitchen(keep: <T extends { dispose(): void }>(x: T) => T): Group {
    const stage = this.stage;
    const W = this.halfW;
    const FLOOR = -4;
    // The table: a thick top on four legs, with a lace runner down the middle.
    const woodTex = keep(groundTexture('wood', 6, 11));
    const top = box(W * 2, 0.5, 9.5, keep(flat('#ffffff', { map: woodTex })));
    top.position.set(0, -0.5, 0.2);
    stage.add(top);
    const legMat = keep(flat('#7a4a26'));
    for (const sx of [-1, 1])
      for (const z of [-3.6, 4.0]) {
        const leg = box(0.6, 3.5, 0.6, legMat);
        leg.position.set(sx * (W - 0.8), FLOOR, z);
        stage.add(leg);
      }
    const runner = new Mesh(keep(new PlaneGeometry(W * 1.6, 2.2)), keep(flat('#f4ead2')));
    runner.rotation.x = -Math.PI / 2;
    runner.position.set(0, 0.01, -1.4);
    stage.add(runner);

    // Floor: red and cream linoleum checks.
    const lino = keep(
      pixelTexture(
        8,
        (ctx) => {
          for (let y = 0; y < 8; y++)
            for (let x = 0; x < 8; x++) {
              ctx.fillStyle = (x >> 2) ^ (y >> 2) ? '#b8443a' : '#efe0c0';
              ctx.fillRect(x, y, 1, 1);
            }
        },
        2,
        12,
      ),
    );
    const fg = keep(new PlaneGeometry(90, 50));
    fg.rotateX(-Math.PI / 2);
    const floor = new Mesh(fg, keep(flat('#ffffff', { map: lino })));
    floor.position.set(0, FLOOR, 0);
    stage.add(floor);

    // The wall: blue-and-white tiles up to the shelf line, warm plaster above.
    const WALL_Z = -8.5;
    const tiles = keep(
      pixelTexture(
        16,
        (ctx, rnd) => {
          ctx.fillStyle = '#c9c2b2';
          ctx.fillRect(0, 0, 16, 16);
          for (const [ox, oy] of [
            [0, 0],
            [8, 0],
            [0, 8],
            [8, 8],
          ]) {
            const v = 238 + (rnd() - 0.5) * 14;
            ctx.fillStyle = `rgb(${v},${v + 2},${v + 6})`;
            ctx.fillRect(ox, oy, 7, 7);
            ctx.fillStyle = '#4f78b8';
            ctx.fillRect(ox + 3, oy + 1, 1, 5);
            ctx.fillRect(ox + 1, oy + 3, 5, 1);
          }
        },
        7,
        1,
      ),
    );
    tiles.repeat.set(26, 4);
    const tileWall = new Mesh(keep(new PlaneGeometry(70, 9)), keep(flat('#ffffff', { map: tiles })));
    tileWall.position.set(0, FLOOR + 4.5, WALL_Z);
    const plaster = new Mesh(keep(new PlaneGeometry(70, 20)), keep(flat('#f0d9a8')));
    plaster.position.set(0, FLOOR + 9 + 10, WALL_Z - 0.01);
    const trim = box(70, 0.3, 0.3, keep(flat('#b0473a')));
    trim.position.set(0, FLOOR + 9 - 0.15, WALL_Z + 0.1);
    stage.add(tileWall, plaster, trim);

    // A shelf with jars of pickles and a row of plates.
    const shelf = box(7, 0.25, 1, keep(flat('#8a5a32')));
    shelf.position.set(-8.5, 7.2, WALL_Z + 0.5);
    stage.add(shelf);
    const jarMat = keep(flat('#9cc47a', { transparent: true, opacity: 0.85 }));
    const lidMat = keep(flat('#d8322a'));
    [-10.6, -9.4, -8.2].forEach((x, k) => {
      const h = 1.1 + (k % 2) * 0.3;
      const jar = new Mesh(keep(new CylinderGeometry(0.42, 0.42, h, 8)), jarMat);
      jar.position.set(x, 7.33 + h / 2, WALL_Z + 0.5);
      const lid = new Mesh(keep(new CylinderGeometry(0.45, 0.45, 0.14, 8)), lidMat);
      lid.position.set(x, 7.33 + h + 0.07, WALL_Z + 0.5);
      stage.add(jar, lid);
    });
    const plateMat = keep(flat('#f7f2e6'));
    const plateRim = keep(flat('#4f78b8'));
    [-6.9, -5.8].forEach((x) => {
      const p = new Mesh(keep(new CylinderGeometry(0.55, 0.55, 0.08, 12)), plateMat);
      p.rotation.x = Math.PI / 2 - 0.2;
      p.position.set(x, 7.95, WALL_Z + 0.35);
      const r = new Mesh(keep(new TorusGeometry(0.5, 0.05, 4, 12)), plateRim);
      r.rotation.copy(p.rotation);
      r.rotation.x -= Math.PI / 2;
      r.position.copy(p.position);
      r.position.z += 0.02;
      stage.add(p, r);
    });

    // The stove, back left, with a steaming pot.
    const stoveX = -W - 2.6;
    const stove = new Group();
    const sBody = box(4.4, 4.9, 3.6, keep(flat('#f2efe8')));
    const oven = box(3.2, 1.9, 0.1, keep(flat('#2a2a2e')));
    oven.position.set(0, 1.0, 1.82);
    const handle = box(2.6, 0.12, 0.2, keep(flat('#b9bec4')));
    handle.position.set(0, 3.1, 1.86);
    const knobMat = keep(flat('#1d1d20'));
    for (let k = 0; k < 4; k++) {
      const kn = new Mesh(keep(new CylinderGeometry(0.16, 0.16, 0.15, 6)), knobMat);
      kn.rotation.x = Math.PI / 2;
      kn.position.set(-1.35 + k * 0.9, 4.3, 1.85);
      stove.add(kn);
    }
    const plateTop = box(4.5, 0.12, 3.7, keep(flat('#3a3a40')));
    plateTop.position.y = 4.9;
    stove.add(sBody, oven, handle, plateTop);
    stove.position.set(stoveX, FLOOR, -5.4);
    stage.add(stove);
    const pot = new Group();
    const potBody = new Mesh(keep(new CylinderGeometry(1.15, 1.0, 1.4, 10)), keep(flat('#3d6fb0')));
    potBody.position.y = 0.7;
    const potLid = new Mesh(keep(new CylinderGeometry(1.2, 1.2, 0.12, 10)), keep(flat('#c9ced3')));
    potLid.position.y = 1.46;
    const lidKnob = new Mesh(keep(new SphereGeometry(0.16, 5, 3)), knobMat);
    lidKnob.position.y = 1.6;
    pot.add(potBody, potLid, lidKnob);
    pot.position.set(stoveX + 0.5, FLOOR + 5.02, -5.4);
    stage.add(pot);

    // The window, back right, with lace curtains and a geranium on the sill.
    const winX = W * 0.62 + 2;
    const winY = 4.2;
    const frameMat = keep(flat('#f7f2e6'));
    const sky = new Mesh(keep(new PlaneGeometry(5, 4)), keep(new MeshBasicMaterial({ color: '#a9d8f2' })));
    sky.position.set(winX, winY, WALL_Z + 0.02);
    const hill = new Mesh(keep(new SphereGeometry(3, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2)), keep(new MeshBasicMaterial({ color: '#7dbb55' })));
    hill.scale.set(1.1, 0.35, 0.05);
    hill.position.set(winX + 0.8, winY - 2, WALL_Z + 0.04);
    stage.add(sky, hill);
    for (const [w, h, x, y] of [
      [5.5, 0.3, 0, 2.1],
      [5.5, 0.3, 0, -2.1],
      [0.3, 4.4, -2.6, 0],
      [0.3, 4.4, 2.6, 0],
      [0.16, 4, 0, 0],
      [5, 0.16, 0, 0.3],
    ] as const) {
      const b = box(w, h, 0.25, frameMat);
      b.position.set(winX + x, winY + y - h / 2, WALL_Z + 0.12);
      stage.add(b);
    }
    const sill = box(6.2, 0.25, 1.1, frameMat);
    sill.position.set(winX, winY - 2.35, WALL_Z + 0.5);
    stage.add(sill);
    const flowerPot = new Mesh(keep(new CylinderGeometry(0.45, 0.32, 0.7, 8)), keep(flat('#c0643a')));
    flowerPot.position.set(winX - 1.3, winY - 1.75, WALL_Z + 0.5);
    const leafMat = keep(flat('#4f8a2c'));
    const bloom = keep(flat('#e8335a'));
    stage.add(flowerPot);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      const b = new Mesh(keep(new SphereGeometry(0.22, 5, 3)), k % 2 ? bloom : leafMat);
      b.position.set(winX - 1.3 + Math.cos(a) * 0.35, winY - 1.2 + (k % 2) * 0.25, WALL_Z + 0.5 + Math.sin(a) * 0.2);
      stage.add(b);
    }
    const lace = keep(
      pixelTexture(
        16,
        (ctx) => {
          ctx.clearRect(0, 0, 16, 16);
          ctx.fillStyle = '#fffaf0';
          ctx.fillRect(0, 0, 16, 16);
          ctx.clearRect(2, 2, 4, 4);
          ctx.clearRect(10, 10, 4, 4);
          ctx.clearRect(10, 2, 3, 3);
          ctx.clearRect(3, 11, 3, 3);
          ctx.clearRect(7, 7, 2, 2);
        },
        4,
        1,
      ),
    );
    lace.repeat.set(3, 5);
    const laceMat = keep(new MeshLambertMaterial({ map: lace, transparent: true, alphaTest: 0.4, side: DoubleSide }));
    for (const s of [-1, 1]) {
      const c = new Mesh(keep(new PlaneGeometry(1.9, 4.6, 1, 1)), laceMat);
      c.position.set(winX + s * 2.0, winY - 0.1, WALL_Z + 0.4);
      this.curtains.push(c);
      stage.add(c);
    }
    // A valance across the top.
    const val = new Mesh(keep(new PlaneGeometry(6.2, 0.8)), laceMat);
    val.position.set(winX, winY + 2.0, WALL_Z + 0.42);
    stage.add(val);

    // On the table: a basket of eggs and a jug of kompot, for company.
    const basket = new Mesh(keep(new CylinderGeometry(0.9, 0.7, 0.7, 8, 1, true)), keep(flat('#b9874a', { side: DoubleSide })));
    basket.position.set(-W + 2.2, 0.35, -2.8);
    stage.add(basket);
    const eggMat = keep(flat('#f6ead2'));
    for (let k = 0; k < 4; k++) {
      const e = new Mesh(keep(new SphereGeometry(0.28, 6, 4)), eggMat);
      e.scale.y = 1.25;
      e.position.set(-W + 2.0 + (k % 2) * 0.45, 0.75 + (k >> 1) * 0.12, -2.9 + (k >> 1) * 0.35);
      stage.add(e);
    }
    const jug = new Mesh(keep(new CylinderGeometry(0.5, 0.65, 1.5, 8)), keep(flat('#f1e4c4')));
    jug.position.set(-W + 3.6, 0.75, -1.2);
    const kompot = new Mesh(keep(new CylinderGeometry(0.42, 0.42, 0.06, 8)), keep(flat('#a8324a')));
    kompot.position.set(-W + 3.6, 1.5, -1.2);
    stage.add(jug, kompot);
    return pot;
  }

  // ---- the dial ------------------------------------------------------------------------------------
  /** Point the needle at `t` seconds, with `label` in the window and a marker at `target` (if any). */
  setDial(t: number, label: string, target: number | null) {
    const key = `${Math.round(t * 20)}|${label}|${target}`;
    if (key === this.dialKey) return;
    this.dialKey = key;
    this.drawDial(t, label, target);
  }

  private drawDial(t: number, label: string, target: number | null) {
    const c = this.dialCanvas.getContext('2d')!;
    const S = 256;
    const cx = S / 2;
    const ang = (s: number) => -Math.PI / 2 + (s / DIAL_SECONDS) * Math.PI * 2;
    c.fillStyle = '#d8322a';
    c.fillRect(0, 0, S, S);
    c.fillStyle = '#fbf3dc';
    c.beginPath();
    c.arc(cx, cx, 126, 0, Math.PI * 2);
    c.fill();
    // Target wedge.
    if (target !== null) {
      c.fillStyle = 'rgba(255,201,60,.9)';
      c.beginPath();
      c.moveTo(cx, cx);
      c.arc(cx, cx, 124, ang(target - 0.35), ang(target + 0.35));
      c.closePath();
      c.fill();
    }
    c.strokeStyle = '#2a120a';
    c.lineCap = 'round';
    for (let s = 0; s < DIAL_SECONDS; s++) {
      const a = ang(s);
      const big = s % 5 === 0;
      c.lineWidth = big ? 6 : 3;
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * (big ? 96 : 106), cx + Math.sin(a) * (big ? 96 : 106));
      c.lineTo(cx + Math.cos(a) * 120, cx + Math.sin(a) * 120);
      c.stroke();
    }
    c.fillStyle = '#2a120a';
    c.font = '700 26px "Fraunces Variable", Georgia, serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (let s = 0; s < DIAL_SECONDS; s += 5) {
      const a = ang(s);
      c.fillText(String(s), cx + Math.cos(a) * 76, cx + Math.sin(a) * 76);
    }
    // The readout window.
    c.fillStyle = '#2a120a';
    c.beginPath();
    c.roundRect(cx - 52, cx + 22, 104, 50, 12);
    c.fill();
    c.fillStyle = '#ffc93c';
    c.font = '800 42px "Fraunces Variable", Georgia, serif';
    c.fillText(label, cx, cx + 49);
    // The needle.
    const a = ang(t);
    c.strokeStyle = '#b01e2a';
    c.lineWidth = 8;
    c.beginPath();
    c.moveTo(cx - Math.cos(a) * 16, cx - Math.sin(a) * 16);
    c.lineTo(cx + Math.cos(a) * 112, cx + Math.sin(a) * 112);
    c.stroke();
    c.fillStyle = '#2a120a';
    c.beginPath();
    c.arc(cx, cx, 12, 0, Math.PI * 2);
    c.fill();
    this.dialTex.needsUpdate = true;
  }

  // ---- events --------------------------------------------------------------------------------------
  /** Start of a round: towel folded away, crowns off, everybody upright. */
  resetRound() {
    this.towelMode = 'off';
    this.towel.visible = false;
    this.actors.forEach((a) => {
      a.tap = -1;
      a.done = false;
      a.crownT = -1;
      a.crown.visible = false;
    });
  }

  /** A tick of the timer: the tomato gives a little shudder. */
  tick() {
    this.bump = 1;
  }

  dropTowel() {
    this.towelMode = 'drop';
    this.towelK = 0;
    this.throwT = 0;
    this.towel.visible = true;
  }

  liftTowel() {
    if (this.towelMode === 'off') return;
    this.towelMode = 'lift';
    this.towelK = 0;
    this.throwT = 0;
  }

  /** Player i taps their bell. `first`: their real press (they sit back afterwards). */
  ding(i: number, first = true) {
    const a = this.actors[i];
    if (!a || !a.model.root.visible) return;
    a.tap = 0;
    if (first) a.done = true;
    const p = a.bell.position;
    for (let k = 0; k < 8; k++) {
      const ang = (k / 8) * Math.PI * 2;
      this.sparks.spawn(p.x, 0.8, p.z, Math.cos(ang) * 2.2, 2.5 + Math.random(), Math.sin(ang) * 1.2, 0.14, 0.5, k % 2 ? '#ffe08a' : a.color, 0.4);
    }
  }

  crown(i: number) {
    const a = this.actors[i];
    if (!a || !a.model.root.visible) return;
    a.crownT = 0;
    a.crown.visible = true;
    this.shake = Math.min(0.6, this.shake + 0.25);
    const r = a.model.root.position;
    for (let k = 0; k < 18; k++) {
      const ang = (k / 18) * Math.PI * 2;
      this.sparks.spawn(r.x, 1.6, r.z, Math.cos(ang) * 3, 4 + Math.random() * 2, Math.sin(ang) * 1.5, 0.16, 1.0, ['#ffc93c', '#e8335a', '#2fd6a8', '#fbf0d9'][k % 4], 0.3);
    }
  }

  hide(i: number) {
    const a = this.actors[i];
    if (!a) return;
    a.model.root.visible = false;
    a.bell.visible = false;
    a.crown.visible = false;
  }

  toStage(x: number, y: number, z: number) {
    return this.stage.toStage(new Vector3(x, y, z));
  }

  /** Where player i's name tag is (for DOM pops over the 3D view). */
  tagAt(i: number) {
    const a = this.actors[i];
    return a ? this.toStage(a.x, 2.4, ROW_Z) : null;
  }

  // ---- the towel -----------------------------------------------------------------------------------
  /** Lay the towel: `flatY`/`cx`/`cz` for the flat sheet, `b` 0..1 how far it has wrapped the tomato. */
  private poseTowel(flatY: number, cx: number, cz: number, b: number, spin: number) {
    const pos = this.towelGeo.attributes.position as BufferAttribute;
    const base = this.towelBase;
    const TH = 1.95;
    const cs = Math.cos(spin);
    const sn = Math.sin(spin);
    for (let i = 0; i < pos.count; i++) {
      const u = base[i * 3];
      const v = base[i * 3 + 2];
      // Flat: a sheet in the air (a little wavy as it flies).
      const fx = cx + u * cs - v * sn;
      const fz = cz + u * sn + v * cs;
      const fy = flatY + Math.sin(u * 0.8 + this.time * 6) * 0.25 * (1 - b) + Math.cos(v * 0.7 + this.time * 5) * 0.2 * (1 - b);
      if (b <= 0) {
        pos.setXYZ(i, fx, fy, fz);
        continue;
      }
      // Draped over the tomato.
      const r = Math.hypot(u, v) || 1e-4;
      const dx = u / r;
      const dz = v / r;
      const th = r / WRAP_R;
      const fold = Math.sin(Math.atan2(v, u) * 9) * 0.14 * smooth((th - 1.0) / 0.8);
      let px: number;
      let py: number;
      let pz: number;
      if (th <= TH) {
        const s = Math.sin(th) * WRAP_R + fold;
        px = TOM.x + dx * s;
        pz = TOM.z + dz * s;
        py = TOM.y + Math.cos(th) * WRAP_R;
      } else {
        const s = Math.sin(TH) * WRAP_R + fold;
        const extra = (th - TH) * WRAP_R;
        px = TOM.x + dx * (s + extra * 0.22);
        pz = TOM.z + dz * (s + extra * 0.22);
        py = TOM.y + Math.cos(TH) * WRAP_R - extra * 0.97;
      }
      if (py < 0.04) {
        const over = 0.04 - py;
        py = 0.04;
        px += dx * over;
        pz += dz * over;
      }
      pos.setXYZ(i, fx + (px - fx) * b, fy + (py - fy) * b, fz + (pz - fz) * b);
    }
    pos.needsUpdate = true;
    this.towelGeo.computeVertexNormals();
  }

  private updateTowel(dt: number) {
    if (this.towelMode === 'off') return;
    const topY = TOM.y + WRAP_R + 0.1;
    if (this.towelMode === 'drop') {
      this.towelK = Math.min(1, this.towelK + dt / 0.7);
      const k = this.towelK;
      const e = k * k;
      const flatY = topY + 7 * (1 - e);
      this.poseTowel(flatY, BABCIA_AT.x * (1 - smooth(k * 1.6)), BABCIA_AT.z * (1 - smooth(k * 1.6)) + TOM.z * smooth(k * 1.6), smooth((k - 0.4) / 0.6), (1 - k) * 0.8);
      if (k >= 1) {
        this.towelMode = 'on';
        this.shake = Math.min(0.5, this.shake + 0.2);
        for (let n = 0; n < 14; n++) {
          const a = (n / 14) * Math.PI * 2;
          this.puffs.spawn(TOM.x + Math.cos(a) * 3.2, 0.2, TOM.z + Math.sin(a) * 3.2, Math.cos(a) * 1.5, 0.5, Math.sin(a) * 1.5, 0.35, 0.8, '#f3e6c8');
        }
      }
    } else if (this.towelMode === 'on') {
      // Settle with a slow breath, so it reads as cloth.
      this.poseTowel(topY, TOM.x, TOM.z, 1, 0);
    } else {
      this.towelK = Math.min(1, this.towelK + dt / 0.9);
      const k = this.towelK;
      this.poseTowel(topY + 9 * k * k, TOM.x + 7 * k * k, TOM.z - 2 * k, 1 - smooth(k / 0.45), -k * 0.9);
      if (k >= 1) {
        this.towelMode = 'off';
        this.towel.visible = false;
      }
    }
  }

  // ---- drawing -------------------------------------------------------------------------------------
  render(dt: number) {
    this.time += dt;
    this.updateTowel(dt);

    // The tomato shudders on every tick.
    if (this.bump > 0.01) {
      const k = this.bump;
      this.tomato.scale.set(1 + 0.03 * k, TOM_SQUASH * (1 - 0.03 * k), 1 + 0.03 * k);
      this.tomato.rotation.z = Math.sin(this.time * 60) * 0.015 * k;
      this.bump *= Math.exp(-12 * dt);
    } else {
      this.tomato.scale.set(1, TOM_SQUASH, 1);
      this.tomato.rotation.z = 0;
    }

    // Babcia sways, and swings her arm (well, herself) when she throws the towel.
    const bb = this.babcia.body;
    if (this.throwT >= 0) {
      this.throwT += dt;
      const t = this.throwT / 0.6;
      bb.rotation.z = Math.sin(Math.min(1, t) * Math.PI) * 0.35;
      bb.position.y = Math.sin(Math.min(1, t) * Math.PI) * 0.3;
      if (t >= 1) this.throwT = -1;
    } else {
      bb.rotation.z = Math.sin(this.time * 1.4) * 0.05;
      bb.position.y = 0;
    }

    // Steam from the pot; the curtains move in a draught.
    if (Math.random() < dt * 9) {
      const p = this.pot.position;
      this.puffs.spawn(p.x + (Math.random() - 0.5) * 1.2, p.y + 1.7, p.z + (Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.3, 1.0 + Math.random() * 0.6, 0.1, 0.35 + Math.random() * 0.25, 2.4, '#f8f4ec', 2.2);
    }
    this.curtains.forEach((c, k) => (c.rotation.y = Math.sin(this.time * 0.9 + k * 2) * 0.08));

    // Pierogi.
    this.actors.forEach((a, i) => {
      if (!a.model.root.visible) return;
      const body = a.model.body;
      let lean = a.done ? -0.08 : 0;
      let press = 0;
      if (a.tap >= 0) {
        a.tap += dt;
        const t = a.tap / 0.38;
        if (t < 1) {
          const k = Math.sin(t * Math.PI);
          lean = 0.75 * k;
          press = k;
        } else a.tap = -1;
      }
      body.rotation.x = lean;
      body.rotation.z = Math.sin(this.time * 2.2 + i * 1.7) * (a.done ? 0.02 : 0.05);
      body.position.y = a.done ? 0 : Math.abs(Math.sin(this.time * 2.2 + i * 1.7)) * 0.06;
      body.scale.set(1, 1 - press * 0.08, 1);
      a.button.position.y = 0.5 - press * 0.1;
      a.dome.emissive.setRGB(press * 0.6, press * 0.45, press * 0.1);
      // The crown drops onto their head and bounces.
      if (a.crownT >= 0) {
        a.crownT += dt;
        const t = Math.min(1, a.crownT / 0.6);
        const fall = 5 * (1 - t * t);
        const bounce = t >= 1 ? Math.abs(Math.sin((a.crownT - 0.6) * 9)) * 0.25 * Math.exp(-(a.crownT - 0.6) * 4) : 0;
        a.crown.position.set(a.x, 1.25 + fall + bounce, ROW_Z);
        a.crown.rotation.y = a.crownT * 1.5;
        a.crown.rotation.z = 0.12;
      }
    });
    this.puffs.update(dt);
    this.sparks.update(dt);

    // Camera: the whole table, a little from above.
    const stage = this.stage;
    stage.lookAt(new Vector3(0, 1.7, 0.4), 8 + this.halfW * 1.55, 0.3);
    if (this.shake > 0.01) {
      stage.camera.position.x += (Math.random() - 0.5) * this.shake * 0.5;
      stage.camera.position.y += (Math.random() - 0.5) * this.shake * 0.5;
      this.shake *= Math.exp(-7 * dt);
    }
    stage.render();
  }

  dispose() {
    this.stage.dispose();
  }
}
