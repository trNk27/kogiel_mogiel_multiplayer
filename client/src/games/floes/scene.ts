/**
 * Kra in 3D: a frozen river at dusk. Three layers of hexagonal ice floes hang over the dark water
 * between two snowy banks with birches and spruces; a wooden footbridge crosses the river behind
 * them and a little village with lit windows sits beyond it. Same PS2 look as the other arena games.
 */
import {
  AmbientLight,
  BackSide,
  BufferAttribute,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  PlaneGeometry,
  RingGeometry,
  SphereGeometry,
  Vector3,
  type CanvasTexture,
  type Material,
  type Sprite,
} from 'three';
import { ArenaStage, box, buildPierogi, flat, groundTexture, nameTag, noise, pixelTexture, type PierogiModel } from '../arena/kit';
import { Puffs } from '../arena/puffs';
import { mulberry32 } from '../rng';
import { CRACK_S, HEX, LAYERS, LAYER_Y, WATER_Y, type FloesSim } from './logic';

export interface PlayerLook {
  name: string;
  color: string;
}

/** Floe thickness; the top face is at the layer's height. */
const THICK = 0.7;
/** Each layer's ice: white, pale blue, deeper blue. */
const LAYER_COLORS = ['#f6fbff', '#b9def5', '#79b2e0'];
const CRACK_COLOR = new Color('#6f8fa8');
const PIEROGI_SCALE = 0.85;
const DROP_G = 20;
/** A dropped floe tumbles away for this long, then it is gone. */
const DROP_S = 1.1;

interface Actor {
  model: PierogiModel;
  tag: Sprite;
  color: string;
  walk: number;
  /** Seconds since landing (squash) / jumping (stretch) / splashing, or -1. */
  land: number;
  jump: number;
  splash: number;
  hard: boolean;
}

interface TileLayer {
  mesh: InstancedMesh;
  mats: MeshLambertMaterial[];
  base: Color;
  /** Scene time each floe dropped (-1: hasn't), and its crack decal (-1: none). */
  dropT: number[];
  decal: number[];
  spin: number[];
  phase: number[];
  opacity: number;
}

interface Decal {
  mesh: Mesh;
  mat: MeshBasicMaterial;
  layer: number;
  floe: number;
  offset: Matrix4;
}

const smooth = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

export class FloesScene {
  readonly stage: ArenaStage;
  private keep: <T extends { dispose(): void }>(x: T) => T;
  private actors: Actor[] = [];
  private layers: TileLayer[] = [];
  private decals: Decal[] = [];
  private ripples: { mesh: Mesh; mat: MeshBasicMaterial; t: number }[] = [];
  private tileGroup = new Group();
  private rings = -1;
  private puffs = new Puffs(280, 9, 1.2);
  private snow = new Puffs(320, 0.7, 1.4);
  private smoke = new Puffs(90, -0.5, 0.7);
  private chimneys: Vector3[] = [];
  private bits: { m: Mesh; x: number; z: number; s: number }[] = [];
  private lanterns: Mesh[] = [];
  private waterMap: CanvasTexture;
  private bankHalf = 19;
  private time = 0;
  private shake = 0;
  private focusY = LAYER_Y[0];
  private dummy = new Object3D();
  private m4 = new Matrix4();
  private c = new Color();

  constructor(canvas: HTMLCanvasElement, looks: PlayerLook[]) {
    this.stage = new ArenaStage(canvas, { sky: '#c98c8f', fog: [70, 175], fov: 38 });
    const stage = this.stage;
    this.keep = <T extends { dispose(): void }>(x: T) => stage.keep(x);
    this.waterMap = this.keep(groundTexture('water', 30, 8));
    this.light();
    this.buildSky();
    this.buildRiver();
    this.buildBanks();
    this.buildBridge();
    this.buildVillage();
    stage.add(this.tileGroup);
    this.buildDecals();
    stage.add(this.puffs.mesh, this.snow.mesh, this.smoke.mesh);
    for (let k = 0; k < 140; k++) this.flake(Math.random() * 14);
    looks.forEach((l) => {
      const model = buildPierogi(l.color);
      const tag = nameTag(l.name, l.color);
      tag.position.set(0, 2.0, 0);
      tag.scale.set(2.8, 0.7, 1);
      model.root.scale.setScalar(PIEROGI_SCALE);
      model.root.add(tag);
      stage.add(model.root);
      this.actors.push({ model, tag, color: l.color, walk: 0, land: -1, jump: -1, splash: -1, hard: false });
    });
  }

  // ---- scenery ----------------------------------------------------------------------------------------
  private light() {
    const stage = this.stage;
    stage.sun.color.set('#ffc193');
    stage.sun.intensity = 1.45;
    stage.sun.position.set(-0.7, 0.8, 0.5);
    for (const o of stage.scene.children) {
      if (o instanceof HemisphereLight) {
        o.color.set('#e2dcff');
        o.groundColor.set('#5b4a70');
        o.intensity = 1.25;
      }
      if (o instanceof AmbientLight) o.intensity = 0.3;
    }
  }

  private buildSky() {
    const geo = this.keep(new SphereGeometry(300, 18, 12));
    const pos = geo.attributes.position as BufferAttribute;
    const cols = new Float32Array(pos.count * 3);
    const top = new Color('#2b2a5e');
    const mid = new Color('#9c6c9c');
    const low = new Color('#f2a27a');
    for (let i = 0; i < pos.count; i++) {
      const h = pos.getY(i) / 300;
      if (h < 0.08) this.c.copy(low);
      else if (h < 0.3) this.c.copy(low).lerp(mid, (h - 0.08) / 0.22);
      else this.c.copy(mid).lerp(top, Math.min(1, (h - 0.3) / 0.5));
      cols.set([this.c.r, this.c.g, this.c.b], i * 3);
    }
    geo.setAttribute('color', new BufferAttribute(cols, 3));
    const sky = new Mesh(geo, this.keep(new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false, depthWrite: false })));
    sky.renderOrder = -10;
    this.stage.add(sky);
    // A low winter sun behind the village, and the first stars.
    const sun = new Mesh(this.keep(new SphereGeometry(9, 12, 8)), this.keep(new MeshBasicMaterial({ color: '#ffd9a0', fog: false })));
    sun.position.set(-60, 14, -260);
    const star = this.keep(new MeshBasicMaterial({ color: '#fff6e0', fog: false }));
    const sg = this.keep(new IcosahedronGeometry(0.9, 0));
    const rnd = mulberry32(41);
    for (let k = 0; k < 40; k++) {
      const a = rnd() * Math.PI * 2;
      const e = 0.35 + rnd() * 0.9;
      const s = new Mesh(sg, star);
      s.position.set(Math.cos(a) * Math.cos(e) * 280, Math.sin(e) * 280, Math.sin(a) * Math.cos(e) * 280);
      s.scale.setScalar(0.6 + rnd() * 0.8);
      this.stage.add(s);
    }
    this.stage.add(sun);
  }

  private snowTexture(repeat: number, seed: number) {
    return this.keep(
      pixelTexture(
        16,
        (ctx, rnd) => {
          noise(ctx, rnd, 16, [232, 238, 250], 16);
          ctx.fillStyle = 'rgba(160,180,220,.45)';
          for (let k = 0; k < 6; k++) ctx.fillRect(Math.floor(rnd() * 16), Math.floor(rnd() * 16), 2, 1);
        },
        seed,
        repeat,
      ),
    );
  }

  private buildRiver() {
    const g = this.keep(new PlaneGeometry(120, 340));
    g.rotateX(-Math.PI / 2);
    const water = new Mesh(g, this.keep(new MeshLambertMaterial({ map: this.waterMap, color: '#4a6a96', emissive: '#0c1630' })));
    water.position.set(0, WATER_Y, -80);
    this.stage.add(water);
    // Little floes drifting downstream.
    const rnd = mulberry32(7);
    const mat = this.keep(flat('#dcecf8'));
    for (let k = 0; k < 18; k++) {
      const s = 0.5 + rnd() * 1.1;
      const m = new Mesh(this.keep(new CylinderGeometry(s, s * 0.9, 0.25, 5 + Math.floor(rnd() * 3))), mat);
      const b = { m, x: (rnd() * 2 - 1) * (this.bankHalf - 2), z: -90 + rnd() * 130, s: 0.5 + rnd() * 0.6 };
      m.position.set(b.x, WATER_Y + 0.05, b.z);
      m.rotation.y = rnd() * 6;
      this.bits.push(b);
      this.stage.add(m);
    }
  }

  private buildBanks() {
    const stage = this.stage;
    const snow = this.snowTexture(40, 5);
    const snowMat = this.keep(flat('#ffffff', { map: snow }));
    const B = this.bankHalf;
    for (const s of [-1, 1]) {
      const bank = box(80, 4, 340, snowMat);
      bank.position.set(s * (B + 40), WATER_Y - 2.4, -80);
      const slope = box(6, 1, 340, snowMat);
      slope.position.set(s * (B + 0.6), WATER_Y + 0.2, -80);
      slope.rotation.z = -s * 0.42;
      stage.add(bank, slope);
    }
    const ground = WATER_Y + 1.6;
    // Birches and snowy spruces along both banks.
    const rnd = mulberry32(23);
    const bark = this.keep(
      pixelTexture(
        16,
        (ctx, r) => {
          noise(ctx, r, 16, [236, 232, 222], 14);
          ctx.fillStyle = '#2a2420';
          for (let k = 0; k < 7; k++) ctx.fillRect(Math.floor(r() * 12), Math.floor(r() * 16), 2 + Math.floor(r() * 3), 1);
        },
        3,
        1,
      ),
    );
    bark.repeat.set(1, 3);
    const birchMat = this.keep(flat('#ffffff', { map: bark }));
    const twigMat = this.keep(flat('#7a5f52'));
    const leafMat = this.keep(flat('#d8a447'));
    const trunkGeo = this.keep(new CylinderGeometry(0.16, 0.24, 1, 6));
    const twigGeo = this.keep(new CylinderGeometry(0.04, 0.07, 1, 4));
    const tuftGeo = this.keep(new IcosahedronGeometry(0.6, 0));
    const spruce = this.keep(flat('#2c5848'));
    const cap = this.keep(flat('#eef4fb'));
    const coneGeo = this.keep(new ConeGeometry(1, 1, 7));
    const add = (x: number, z: number) => {
      if (rnd() < 0.55) {
        const h = 5 + rnd() * 3;
        const t = new Group();
        const trunk = new Mesh(trunkGeo, birchMat);
        trunk.scale.y = h;
        trunk.position.y = h / 2;
        t.add(trunk);
        for (let k = 0; k < 4; k++) {
          const tw = new Mesh(twigGeo, twigMat);
          const len = 1.2 + rnd() * 1.4;
          tw.scale.y = len;
          const a = rnd() * Math.PI * 2;
          tw.position.set(Math.cos(a) * 0.5, h * (0.55 + k * 0.1), Math.sin(a) * 0.5);
          tw.rotation.set(Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9);
          t.add(tw);
          if (rnd() < 0.5) {
            const tuft = new Mesh(tuftGeo, leafMat);
            tuft.position.set(Math.cos(a) * 1.1, h * (0.62 + k * 0.1), Math.sin(a) * 1.1);
            tuft.scale.setScalar(0.5 + rnd() * 0.5);
            t.add(tuft);
          }
        }
        t.position.set(x, ground, z);
        t.rotation.z = (rnd() - 0.5) * 0.12;
        stage.add(t);
      } else {
        const h = 4.5 + rnd() * 4;
        const t = new Group();
        for (let k = 0; k < 3; k++) {
          const w = (1.9 - k * 0.5) * (h / 6);
          const c = new Mesh(coneGeo, spruce);
          c.scale.set(w, h * 0.42, w);
          c.position.y = h * (0.3 + k * 0.22);
          const sc = new Mesh(coneGeo, cap);
          sc.scale.set(w * 0.75, h * 0.16, w * 0.75);
          sc.position.y = c.position.y + h * 0.15;
          t.add(c, sc);
        }
        t.position.set(x, ground, z);
        stage.add(t);
      }
    };
    for (const s of [-1, 1])
      for (let k = 0; k < 26; k++) {
        const z = 24 - k * 2.6 + rnd() * 1.5;
        if (z > -30 && z < -25) continue;
        add(s * (B + 2.5 + rnd() * 6 + (k % 3) * 3), z);
      }
    // Snowdrifts.
    const drift = this.keep(new SphereGeometry(1, 7, 4));
    for (let k = 0; k < 16; k++) {
      const s = k % 2 ? 1 : -1;
      const d = new Mesh(drift, snowMat);
      d.scale.set(1.5 + rnd() * 2, 0.5 + rnd() * 0.4, 1.2 + rnd());
      d.position.set(s * (B + 3 + rnd() * 10), ground, 20 - rnd() * 60);
      stage.add(d);
    }
  }

  private buildBridge() {
    const stage = this.stage;
    const B = this.bankHalf;
    const wood = this.keep(flat('#9a6a40'));
    const dark = this.keep(flat('#6a4426'));
    const snow = this.keep(flat('#f2f6fc'));
    const z = -30;
    const span = B * 2 + 8;
    const segs = 14;
    const deckY = (x: number) => WATER_Y + 2.6 + 2.6 * (1 - (x / (span / 2)) ** 2);
    for (let k = 0; k < segs; k++) {
      const x0 = -span / 2 + (k * span) / segs;
      const x1 = x0 + span / segs;
      const y0 = deckY(x0);
      const y1 = deckY(x1);
      const len = Math.hypot(x1 - x0, y1 - y0);
      const plank = box(len + 0.05, 0.3, 3, wood);
      plank.position.set((x0 + x1) / 2, (y0 + y1) / 2 - 0.15, z);
      plank.rotation.z = Math.atan2(y1 - y0, x1 - x0);
      const sn = box(len, 0.12, 2.4, snow);
      sn.position.set((x0 + x1) / 2, (y0 + y1) / 2 + 0.05, z);
      sn.rotation.z = plank.rotation.z;
      stage.add(plank, sn);
      for (const side of [-1.4, 1.4]) {
        const rail = box(len + 0.05, 0.16, 0.16, dark);
        rail.position.set((x0 + x1) / 2, (y0 + y1) / 2 + 1.0, z + side);
        rail.rotation.z = plank.rotation.z;
        const post = box(0.2, 1.1, 0.2, dark);
        post.position.set(x0, y0, z + side);
        stage.add(rail, post);
      }
    }
    // Piles into the river.
    const pile = this.keep(new CylinderGeometry(0.28, 0.32, 1, 6));
    for (const x of [-B * 0.55, 0, B * 0.55])
      for (const side of [-1.2, 1.2]) {
        const p = new Mesh(pile, dark);
        const top = deckY(x);
        p.scale.y = top - WATER_Y + 1;
        p.position.set(x, (top + WATER_Y - 1) / 2, z + side);
        stage.add(p);
      }
    // Lanterns at both ends.
    const glow = this.keep(new MeshBasicMaterial({ color: '#ffd27a' }));
    const lg = this.keep(new SphereGeometry(0.3, 6, 4));
    for (const x of [-span / 2 + 0.6, span / 2 - 0.6]) {
      const post = box(0.16, 2.2, 0.16, dark);
      post.position.set(x, deckY(x), z + 1.4);
      const l = new Mesh(lg, glow);
      l.position.set(x, deckY(x) + 2.4, z + 1.4);
      stage.add(post, l);
      this.lanterns.push(l);
    }
  }

  private buildVillage() {
    const stage = this.stage;
    const B = this.bankHalf;
    const ground = WATER_Y + 1.6;
    const rnd = mulberry32(61);
    const walls = ['#c79a6c', '#e9dcc6', '#b6824f', '#d9c3a0'].map((c) => this.keep(flat(c)));
    const roof = this.keep(flat('#f3f7fc'));
    const roofEdge = this.keep(flat('#6c3a2e'));
    const win = this.keep(new MeshBasicMaterial({ color: '#ffcf6a' }));
    const chimneyMat = this.keep(flat('#7c6e66'));
    const roofGeo = this.keep(new ConeGeometry(1, 1, 4));
    const house = (x: number, z: number, w: number, d: number, ry: number) => {
      const g = new Group();
      const h = 2.6 + rnd() * 0.8;
      g.add(box(w, h, d, walls[Math.floor(rnd() * walls.length)]));
      const r = new Mesh(roofGeo, roofEdge);
      r.rotation.y = Math.PI / 4;
      r.scale.set(w * 0.78, 2.4, d * 0.78);
      r.position.y = h + 1.2;
      const rs = new Mesh(roofGeo, roof);
      rs.rotation.y = Math.PI / 4;
      rs.scale.set(w * 0.74, 2.3, d * 0.74);
      rs.position.y = h + 1.25;
      g.add(r, rs);
      for (const wx of [-w * 0.25, w * 0.25]) {
        const pane = box(0.7, 0.8, 0.08, win);
        pane.position.set(wx, h * 0.38, d / 2 + 0.02);
        g.add(pane);
      }
      const ch = box(0.5, 1.6, 0.5, chimneyMat);
      ch.position.set(w * 0.25, h + 0.6, 0);
      g.add(ch);
      g.position.set(x, ground, z);
      g.rotation.y = ry;
      stage.add(g);
      g.updateMatrixWorld(true);
      this.chimneys.push(new Vector3(w * 0.25, h + 2.3, 0).applyMatrix4(g.matrixWorld));
    };
    for (const s of [-1, 1])
      for (let k = 0; k < 5; k++) {
        const z = -40 - k * 9 - rnd() * 3;
        house(s * (B + 6 + rnd() * 8), z, 4 + rnd() * 1.5, 3.5 + rnd(), s * 0.3 + (rnd() - 0.5) * 0.4);
      }
    // A wooden church with a tall tower on the right bank.
    const church = new Group();
    const timber = this.keep(flat('#8a5634'));
    church.add(box(5, 4.5, 8, timber));
    const nave = new Mesh(roofGeo, roof);
    nave.rotation.y = Math.PI / 4;
    nave.scale.set(4.2, 3.2, 6.4);
    nave.position.y = 6.1;
    const tower = box(2.6, 9, 2.6, timber);
    tower.position.z = 4.8;
    const spire = new Mesh(roofGeo, this.keep(flat('#4b3a52')));
    spire.rotation.y = Math.PI / 4;
    spire.scale.set(2.2, 4.5, 2.2);
    spire.position.set(0, 11.2, 4.8);
    const cross = box(0.15, 1.2, 0.15, this.keep(flat('#e7c36a')));
    cross.position.set(0, 13.4, 4.8);
    const bell = box(1.2, 1.2, 0.1, win);
    bell.position.set(0, 7, 6.12);
    church.add(nave, tower, spire, cross, bell);
    church.position.set(B + 11, ground, -66);
    church.rotation.y = -0.5;
    stage.add(church);
  }

  private buildDecals() {
    const tex = this.keep(
      pixelTexture(
        32,
        (ctx, rnd) => {
          ctx.clearRect(0, 0, 32, 32);
          ctx.fillStyle = '#26384a';
          for (let arm = 0; arm < 6; arm++) {
            let x = 16;
            let y = 16;
            const a = (arm / 6) * Math.PI * 2 + rnd() * 0.6;
            for (let s = 0; s < 14; s++) {
              const j = a + (rnd() - 0.5) * 1.1;
              x += Math.cos(j);
              y += Math.sin(j);
              ctx.fillRect(Math.round(x), Math.round(y), 1, 1);
              if (rnd() < 0.12) ctx.fillRect(Math.round(x + Math.sin(j) * 2), Math.round(y - Math.cos(j) * 2), 1, 1);
            }
          }
        },
        9,
        1,
      ),
    );
    const geo = this.keep(new PlaneGeometry(HEX * 1.7, HEX * 1.7));
    for (let k = 0; k < 56; k++) {
      const mat = new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0 });
      const mesh = new Mesh(geo, mat);
      mesh.matrixAutoUpdate = false;
      mesh.visible = false;
      mesh.renderOrder = 2;
      const offset = new Matrix4().makeTranslation(0, THICK / 2 + 0.02, 0);
      offset.multiply(new Matrix4().makeRotationX(-Math.PI / 2)).multiply(new Matrix4().makeRotationZ(Math.random() * 6));
      this.decals.push({ mesh, mat, layer: -1, floe: -1, offset });
      this.stage.add(mesh);
    }
  }

  /** (Re)build the floes for a field of `rings` rings. */
  private buildTiles(sim: FloesSim) {
    for (const l of this.layers) {
      l.mesh.geometry.dispose();
      l.mats.forEach((m) => m.dispose());
      l.mesh.dispose();
    }
    this.tileGroup.clear();
    this.layers = [];
    this.rings = sim.rings;
    const n = sim.layers[0].floes.length;
    const top = this.keep(groundTexture('ice', 1, 11));
    for (let l = 0; l < LAYERS; l++) {
      const geo = new CylinderGeometry(HEX * 0.95, HEX * 0.86, THICK, 6, 1);
      const side = new MeshLambertMaterial({ color: '#9fb9d0', flatShading: true, transparent: true });
      const face = new MeshLambertMaterial({ color: '#ffffff', map: top, flatShading: true, transparent: true });
      const under = new MeshLambertMaterial({ color: '#5f7d9a', flatShading: true, transparent: true });
      const mesh = new InstancedMesh(geo, [side, face, under], n);
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(35048);
      const base = new Color(LAYER_COLORS[l]);
      for (let k = 0; k < n; k++) mesh.setColorAt(k, base);
      this.tileGroup.add(mesh);
      const rnd = mulberry32(100 + l);
      this.layers.push({
        mesh,
        mats: [side, face, under],
        base,
        dropT: Array(n).fill(-1),
        decal: Array(n).fill(-1),
        spin: Array.from({ length: n }, () => rnd() * 2 - 1),
        phase: Array.from({ length: n }, () => rnd() * Math.PI * 2),
        opacity: 1,
      });
    }
  }

  // ---- events -----------------------------------------------------------------------------------------
  reset(sim: FloesSim) {
    if (sim.rings !== this.rings) this.buildTiles(sim);
    for (const L of this.layers) {
      L.dropT.fill(-1);
      L.decal.fill(-1);
      L.opacity = 1;
    }
    for (const d of this.decals) {
      d.layer = d.floe = -1;
      d.mesh.visible = false;
    }
    // Floes that are already gone (attaching mid-round) are simply not drawn.
    sim.layers.forEach((layer, l) => layer.floes.forEach((f, k) => f.state === 2 && (this.layers[l].dropT[k] = -1e9)));
    this.focusY = LAYER_Y[0];
    this.actors.forEach((a, i) => {
      const p = sim.players[i];
      a.land = a.jump = a.splash = -1;
      a.model.body.rotation.set(0, 0, 0);
      a.model.body.scale.set(1, 1, 1);
      a.model.body.position.set(0, 0, 0);
      a.model.root.visible = !!p && !p.gone;
      a.tag.visible = true;
      if (p && !p.alive && !p.gone) a.splash = 99;
    });
  }

  hide(i: number) {
    const a = this.actors[i];
    if (a) a.model.root.visible = false;
  }

  cracked(l: number, f: number) {
    const L = this.layers[l];
    if (!L || L.decal[f] >= 0) return;
    const k = this.decals.findIndex((d) => d.layer < 0);
    if (k < 0) return;
    const d = this.decals[k];
    d.layer = l;
    d.floe = f;
    d.mesh.visible = true;
    L.decal[f] = k;
  }

  dropped(sim: FloesSim, l: number, f: number) {
    const L = this.layers[l];
    if (!L) return;
    L.dropT[f] = this.time;
    const k = L.decal[f];
    if (k >= 0) {
      this.decals[k].layer = this.decals[k].floe = -1;
      this.decals[k].mesh.visible = false;
      L.decal[f] = -1;
    }
    const fl = sim.layers[l].floes[f];
    const y = LAYER_Y[l];
    for (let n = 0; n < 6; n++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * HEX * 0.8;
      this.puffs.spawn(fl.x + Math.cos(a) * r, y, fl.z + Math.sin(a) * r, Math.cos(a) * 2, 1 + Math.random() * 2, Math.sin(a) * 2, 0.2 + Math.random() * 0.15, 0.6, n % 2 ? '#ffffff' : LAYER_COLORS[l], 0);
    }
  }

  jumped(i: number) {
    const a = this.actors[i];
    if (!a) return;
    a.jump = 0;
    a.land = -1;
    const r = a.model.root.position;
    for (let k = 0; k < 4; k++) this.puffs.spawn(r.x + (Math.random() - 0.5) * 0.8, r.y + 0.1, r.z + (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 1.5, 0.8, (Math.random() - 0.5) * 1, 0.22, 0.4, '#eef6ff');
  }

  landed(i: number, hard: boolean) {
    const a = this.actors[i];
    if (!a) return;
    a.land = 0;
    a.jump = -1;
    a.hard = hard;
    const r = a.model.root.position;
    const n = hard ? 9 : 4;
    for (let k = 0; k < n; k++) {
      const ang = (k / n) * Math.PI * 2;
      this.puffs.spawn(r.x, r.y + 0.1, r.z, Math.cos(ang) * 2.4, 0.6, Math.sin(ang) * 2.4, 0.25, 0.45, '#f4faff');
    }
    if (hard) this.shake = Math.min(0.6, this.shake + 0.15);
  }

  splashed(i: number, x: number, z: number) {
    const a = this.actors[i];
    if (a) {
      a.splash = 0;
      a.land = a.jump = -1;
    }
    this.shake = Math.min(0.9, this.shake + 0.4);
    for (let k = 0; k < 18; k++) {
      const ang = (k / 18) * Math.PI * 2;
      const sp = 2 + Math.random() * 2;
      this.puffs.spawn(x, WATER_Y + 0.2, z, Math.cos(ang) * sp, 4 + Math.random() * 4, Math.sin(ang) * sp, 0.25 + Math.random() * 0.2, 0.9, k % 3 ? '#e8f4ff' : '#8fc0e8', 0.4);
    }
    let r = this.ripples.find((q) => q.t < 0);
    if (!r) {
      const mat = new MeshBasicMaterial({ color: '#e8f4ff', transparent: true, depthWrite: false });
      const mesh = new Mesh(this.keep(new RingGeometry(0.8, 1.1, 16)), mat);
      mesh.rotation.x = -Math.PI / 2;
      this.stage.add(mesh);
      r = { mesh, mat, t: -1 };
      this.ripples.push(r);
    }
    r.t = 0;
    r.mesh.position.set(x, WATER_Y + 0.04, z);
    r.mesh.visible = true;
  }

  /** Where a world point is on the 1920×1080 stage. */
  toStage(x: number, y: number, z: number) {
    return this.stage.toStage(new Vector3(x, y, z));
  }

  private flake(age = 0) {
    const x = (Math.random() * 2 - 1) * 40;
    const z = -40 + Math.random() * 70;
    const y = 30 - age * 1.9;
    this.snow.spawn(x, y, z, (Math.random() - 0.5) * 0.4, -0.3, 0, 0.13 + Math.random() * 0.07, 16 - age, '#ffffff', 0);
  }

  // ---- drawing ----------------------------------------------------------------------------------------
  render(sim: FloesSim, dt: number) {
    this.time += dt;
    if (sim.rings !== this.rings) this.reset(sim);
    this.renderTiles(sim);
    this.renderActors(sim, dt);

    // Weather and life.
    if (Math.random() < dt * 22) this.flake();
    if (Math.random() < dt * 6) {
      const c = this.chimneys[Math.floor(Math.random() * this.chimneys.length)];
      if (c) this.smoke.spawn(c.x, c.y, c.z, 0.3, 0.4, 0, 0.5, 4, '#b9b0bd', 2);
    }
    this.lanterns.forEach((l, k) => l.scale.setScalar(1 + Math.sin(this.time * 7 + k * 2) * 0.08));
    this.waterMap.offset.y = this.time * 0.02;
    for (const b of this.bits) {
      b.z -= b.s * dt;
      if (b.z < -110) b.z = 40;
      b.m.position.set(b.x, WATER_Y + 0.05 + Math.sin(this.time * 1.5 + b.x) * 0.04, b.z);
    }
    for (const r of this.ripples) {
      if (r.t < 0) continue;
      r.t += dt;
      const k = r.t / 1.4;
      if (k >= 1) {
        r.t = -1;
        r.mesh.visible = false;
        continue;
      }
      r.mesh.scale.setScalar(0.8 + k * 3.5);
      r.mat.opacity = 0.8 * (1 - k);
    }
    this.puffs.update(dt);
    this.snow.update(dt);
    this.smoke.update(dt);

    // Camera: follow the layer the pierogi are on.
    const alive = sim.players.filter((p) => p.alive && !p.gone);
    if (alive.length) {
      const top = Math.max(...alive.map((p) => p.y));
      const mean = alive.reduce((s, p) => s + p.y, 0) / alive.length;
      const want = Math.max(LAYER_Y[LAYERS - 1], Math.min(LAYER_Y[0], (top + mean) / 2));
      this.focusY += (want - this.focusY) * Math.min(1, dt * 1.6);
    }
    const stage = this.stage;
    const dist = 30 + sim.rings * 3.2;
    stage.lookAt(new Vector3(0, this.focusY - 2.5, -1.5), dist, 0.86);
    if (this.shake > 0.01) {
      stage.camera.position.x += (Math.random() - 0.5) * this.shake * 0.5;
      stage.camera.position.y += (Math.random() - 0.5) * this.shake * 0.5;
      this.shake *= Math.exp(-7 * dt);
    }
    stage.render();
  }

  private renderTiles(sim: FloesSim) {
    const d = this.dummy;
    const alive = sim.players.filter((p) => p.alive && !p.gone);
    sim.layers.forEach((layer, l) => {
      const L = this.layers[l];
      if (!L) return;
      // A layer everybody has fallen through fades, so you can see the one they are on.
      const below = alive.length > 0 && alive.every((p) => p.y < LAYER_Y[l] - 0.6);
      const want = below ? 0.3 : 1;
      L.opacity += (want - L.opacity) * 0.08;
      L.mats.forEach((m) => {
        m.opacity = L.opacity;
        m.depthWrite = L.opacity > 0.95;
      });
      layer.floes.forEach((f, k) => {
        let y = LAYER_Y[l] - THICK / 2 + Math.sin(this.time * 1.3 + L.phase[k]) * 0.03;
        let rx = 0;
        let rz = 0;
        let ry = 0;
        let s = 1;
        this.c.copy(L.base);
        if (f.state === 1) {
          const t = Math.min(1, (sim.time - f.crackAt) / CRACK_S);
          const w = 0.03 + 0.09 * t;
          rx = Math.sin(this.time * 38 + L.phase[k]) * w;
          rz = Math.cos(this.time * 33 + L.phase[k]) * w;
          y -= 0.12 * t;
          this.c.lerp(CRACK_COLOR, 0.25 + 0.55 * t);
          if (Math.sin(this.time * 30) > 0.6) this.c.offsetHSL(0, 0, 0.06);
        } else if (f.state === 2) {
          const t0 = L.dropT[k];
          const t = t0 < 0 ? DROP_S : this.time - t0;
          if (t >= DROP_S) {
            s = 0;
          } else {
            y -= 0.5 * DROP_G * t * t;
            rx = L.spin[k] * t * 2.5;
            rz = L.spin[(k + 7) % L.spin.length] * t * 2;
            ry = L.spin[k] * t;
            s = 1 - smooth((t - 0.45) / (DROP_S - 0.45));
            this.c.lerp(CRACK_COLOR, 0.8);
          }
        }
        d.position.set(f.x, y, f.z);
        d.rotation.set(rx, ry, rz);
        d.scale.setScalar(Math.max(0.0001, s));
        d.updateMatrix();
        L.mesh.setMatrixAt(k, d.matrix);
        L.mesh.setColorAt(k, this.c);
        const dk = L.decal[k];
        if (dk >= 0) {
          const dec = this.decals[dk];
          dec.mesh.matrix.multiplyMatrices(d.matrix, dec.offset);
          const t = f.state === 1 ? Math.min(1, (sim.time - f.crackAt) / CRACK_S) : 1;
          dec.mat.opacity = (0.35 + 0.65 * t) * L.opacity;
          // Cracks spread: grow the decal with the crack.
          this.m4.makeScale(0.55 + 0.45 * t, 0.55 + 0.45 * t, 1);
          dec.mesh.matrix.multiply(this.m4);
          dec.mesh.matrixWorldNeedsUpdate = true;
        }
      });
      L.mesh.instanceMatrix.needsUpdate = true;
      if (L.mesh.instanceColor) L.mesh.instanceColor.needsUpdate = true;
    });
  }

  /** The surface a player in the air would land on (for their shadow). */
  private below(sim: FloesSim, x: number, y: number, z: number) {
    for (let l = 0; l < LAYERS; l++) if (y >= LAYER_Y[l] - 0.01 && sim.solid(l, x, z)) return LAYER_Y[l];
    return WATER_Y;
  }

  private renderActors(sim: FloesSim, dt: number) {
    this.actors.forEach((ac, i) => {
      const p = sim.players[i];
      if (!p || p.gone) return;
      const root = ac.model.root;
      const body = ac.model.body;
      root.rotation.y = p.face;
      if (!p.alive) {
        // In the river: bobbing on its back, carried away downstream.
        if (ac.splash < 0) ac.splash = 99;
        ac.splash += dt;
        const t = ac.splash;
        const sink = Math.min(1, t / 0.4);
        root.position.set(p.x, WATER_Y - 0.45 * sink + Math.sin(t * 2.6) * 0.09, p.z);
        body.rotation.set(-0.9 * smooth(t / 0.8) + Math.sin(t * 1.9) * 0.1, 0, Math.sin(t * 1.4) * 0.25);
        body.scale.set(1, 1, 1);
        body.position.y = 0;
        ac.model.shadow.visible = false;
        ac.tag.visible = t < 2.5;
        if (Math.random() < dt * 1.5) this.puffs.spawn(p.x + (Math.random() - 0.5), WATER_Y + 0.1, p.z, 0, 0.6, 0, 0.12, 0.5, '#e8f4ff', 2);
        return;
      }
      ac.tag.visible = true;
      root.position.set(p.x, p.y, p.z);
      const speed = Math.hypot(p.vx, p.vz);
      let sy = 1;
      let sxz = 1;
      if (p.ground >= 0) {
        ac.walk += speed * dt * 2.4;
        const k = Math.min(1, speed / 5);
        body.rotation.z = Math.sin(ac.walk) * 0.16 * k;
        body.rotation.x = 0.12 * k;
        body.position.y = Math.abs(Math.sin(ac.walk)) * 0.18 * k;
        if (ac.land >= 0) {
          ac.land += dt;
          const t = ac.land / (ac.hard ? 0.3 : 0.2);
          if (t < 1) {
            const q = Math.sin(t * Math.PI) * (ac.hard ? 1.4 : 1);
            sy = 1 - 0.28 * q;
            sxz = 1 + 0.2 * q;
          } else ac.land = -1;
        }
        // Wobbly knees on a cracking floe.
        const f = sim.floeAt(p.ground, p.x, p.z);
        const fl = f >= 0 ? sim.layers[p.ground].floes[f] : null;
        if (fl && fl.state === 1 && speed < 1) body.rotation.z += Math.sin(this.time * 40) * 0.06;
      } else if (p.vy > -4) {
        // Jumping: stretch, lean into it.
        sy = 1.12;
        sxz = 0.9;
        body.rotation.x = -p.vy * 0.025;
        body.rotation.z = 0;
        body.position.y = 0;
      } else {
        // Falling: flail.
        body.rotation.x = Math.sin(this.time * 18 + i) * 0.25;
        body.rotation.z = Math.cos(this.time * 15 + i) * 0.3;
        body.position.y = 0;
        sy = 1.08;
        sxz = 0.94;
      }
      body.scale.set(sxz, sy, sxz);
      // Shadow on whatever is underneath.
      const sh = ac.model.shadow;
      const under = this.below(sim, p.x, p.y, p.z);
      const h = p.y - under;
      sh.visible = h < 8;
      sh.position.y = (under + 0.04 - p.y) / PIEROGI_SCALE;
      const k = 1 - Math.min(0.6, h * 0.08);
      sh.scale.set(k, 0.6 * k, k);
    });
  }

  dispose() {
    for (const l of this.layers) l.mats.forEach((m: Material) => m.dispose());
    this.stage.dispose();
  }
}
