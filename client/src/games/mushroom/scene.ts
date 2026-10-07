/**
 * Grzybki's three.js scene: a forest pond at golden hour, a tree-stump platform ringed by giant
 * mushrooms, Babcia on her boat with the colour sign, and the pierogi.
 */
import {
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
  type Material,
} from 'three';
import { ArenaStage, blobShadow, buildPierogi, flat, groundTexture, nameTag, pixelTexture, type PierogiModel } from '../arena/kit';
import { mulberry32 } from '../rng';
import { DECK_Y, POND_R, SPECIES, capAngle, capPos, type MEvent, type MushroomSim } from './logic';

const TAU = Math.PI * 2;
const dummy = new Object3D();

function put(m: InstancedMesh, i: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0) {
  dummy.position.set(x, y, z);
  dummy.rotation.set(0, ry, 0);
  dummy.scale.set(sx, sy, sz);
  dummy.updateMatrix();
  m.setMatrixAt(i, dummy.matrix);
}

function angleDiff(a: number, b: number) {
  let d = b - a;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
}

/** The unit mushroom cap: flat top, rounded rim, underside. Scaled to size by the mesh. */
function capGeometry() {
  const pts = [
    [0, -0.42],
    [0.72, -0.42],
    [0.93, -0.36],
    [1.0, -0.22],
    [0.97, -0.1],
    [0.86, 0],
    [0, 0],
  ].map(([r, y]) => new Vector2(r, y));
  return new LatheGeometry(pts, 12);
}

/** A cap texture: the colour with chunky dots. */
function capTexture(i: number) {
  const sp = SPECIES[i];
  return pixelTexture(
    32,
    (ctx, rnd) => {
      const base = new Color(sp.hex);
      for (let y = 0; y < 32; y++)
        for (let x = 0; x < 32; x++) {
          const v = 0.93 + rnd() * 0.14;
          ctx.fillStyle = `rgb(${Math.min(255, base.r * 255 * v)},${Math.min(255, base.g * 255 * v)},${Math.min(255, base.b * 255 * v)})`;
          ctx.fillRect(x, y, 1, 1);
        }
      ctx.fillStyle = sp.spot;
      const big = sp.id === 'red' || sp.id === 'pink';
      const count = big ? 9 : 7;
      for (let k = 0; k < count; k++) {
        // Keep dots inside the disc.
        const a = rnd() * TAU;
        const r = Math.sqrt(rnd()) * 11;
        const x = 16 + Math.cos(a) * r;
        const y = 16 + Math.sin(a) * r;
        const s = big ? 2 + Math.floor(rnd() * 3) : 1 + Math.floor(rnd() * 2);
        ctx.fillRect(Math.round(x - s / 2), Math.round(y - s / 2), s, s);
        if (s >= 3) ctx.fillRect(Math.round(x - s / 2) - 1, Math.round(y - s / 2) + 1, s + 2, s - 2);
      }
    },
    10 + i,
    1,
  );
}

function stumpTopTexture() {
  return pixelTexture(
    32,
    (ctx) => {
      for (let y = 0; y < 32; y++)
        for (let x = 0; x < 32; x++) {
          const d = Math.hypot(x - 15.5, y - 15.5);
          const ring = Math.floor(d / 2.2) % 2;
          const v = ring ? 0 : 1;
          const base = v ? [196, 146, 92] : [176, 126, 76];
          const n = ((x * 7 + y * 13) % 5) - 2;
          ctx.fillStyle = `rgb(${base[0] + n * 2},${base[1] + n * 2},${base[2] + n})`;
          ctx.fillRect(x, y, 1, 1);
        }
      ctx.fillStyle = 'rgba(110,64,28,.5)';
      ctx.fillRect(15, 15, 2, 2);
    },
    4,
    1,
  );
}

function barkTexture(white = false) {
  return pixelTexture(
    16,
    (ctx, rnd) => {
      for (let y = 0; y < 16; y++)
        for (let x = 0; x < 16; x++) {
          const v = (rnd() - 0.5) * 22;
          if (white) ctx.fillStyle = `rgb(${236 + v},${232 + v},${222 + v})`;
          else ctx.fillStyle = `rgb(${96 + v + (x % 4 === 0 ? -22 : 0)},${62 + v * 0.7},${38 + v * 0.5})`;
          ctx.fillRect(x, y, 1, 1);
        }
      if (white) {
        ctx.fillStyle = '#2a2220';
        for (let k = 0; k < 5; k++) ctx.fillRect(Math.floor(rnd() * 12), Math.floor(rnd() * 15), 2 + Math.floor(rnd() * 3), 1);
      }
    },
    white ? 8 : 6,
    white ? 1 : 4,
  );
}

interface Ripple {
  mesh: Mesh;
  t: number;
  life: number;
  r0: number;
  r1: number;
  delay: number;
}

interface PlayerView {
  model: PierogiModel;
  tag: ReturnType<typeof nameTag>;
  squash: number;
  stretch: number;
  phase: number;
  spin: number;
  facing: number;
  splashed: boolean;
  lastY: number;
}

interface CapView {
  group: Group;
  cap: Mesh;
  top: Mesh;
  stem: Mesh;
  shadow: Mesh;
  colour: number;
  puff: number;
}

export interface SceneInfo {
  name: string;
  color: string;
}

export class MushroomScene {
  readonly stage: ArenaStage;
  private time = 0;
  private players: PlayerView[] = [];
  private caps: CapView[] = [];
  private sideMats: Material[] = [];
  private topMats: Material[] = [];
  private stump = new Group();
  private stumpShadow: Mesh;
  private water: Mesh;
  private waterTex: ReturnType<typeof groundTexture>;
  private ripples: Ripple[] = [];
  private babcia = new Group();
  private babciaModel: PierogiModel;
  private sign = new Group();
  private signCap!: Mesh;
  private signDots: Mesh[] = [];
  private signDotMat = new MeshBasicMaterial({ color: '#fff' });
  private signUp = 0;
  private signPop = 0;
  private shake = 0;
  private bits: InstancedMesh;
  private bitsLife: { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; max: number; size: number; g: number }[] = [];
  private leaves: InstancedMesh;
  private leafState: { x: number; z: number; y: number; r: number; kind: 'float' | 'fall'; ph: number; sp: number }[] = [];
  private base = new Vector3();

  constructor(
    canvas: HTMLCanvasElement,
    info: SceneInfo[],
    public sim: MushroomSim,
  ) {
    const stage = (this.stage = new ArenaStage(canvas, { sky: '#f4b982', fog: [44, 100], fov: 40 }));
    stage.sun.color.set('#ffc487');
    stage.sun.intensity = 1.9;
    stage.sun.position.set(-0.7, 0.62, 0.4);
    this.base.set(0, 0, -2.4);
    stage.lookAt(this.base, 30, 0.82);

    const keep = <T extends { dispose(): void }>(x: T) => stage.keep(x);

    // ---- materials -----------------------------------------------------------------
    for (let i = 0; i < SPECIES.length; i++) {
      this.sideMats.push(keep(flat(new Color(SPECIES[i].hex).multiplyScalar(0.9).getStyle(), { side: DoubleSide })));
      this.topMats.push(keep(new MeshLambertMaterial({ map: keep(capTexture(i)), flatShading: true })));
    }

    // ---- ground, shore, water --------------------------------------------------------
    const grassTex = keep(groundTexture('grass', 70));
    const grass = new Mesh(keep(new RingGeometry(POND_R + 1.4, 160, 48, 1)), keep(new MeshLambertMaterial({ map: grassTex, color: '#e9d27a' })));
    grass.rotation.x = -Math.PI / 2;
    grass.position.y = 0.06;
    const sandTex = keep(groundTexture('sand', 10));
    const sand = new Mesh(keep(new RingGeometry(POND_R - 0.4, POND_R + 2.0, 48, 1)), keep(new MeshLambertMaterial({ map: sandTex, color: '#f0d9a4' })));
    sand.rotation.x = -Math.PI / 2;
    sand.position.y = 0.1;
    this.waterTex = groundTexture('water', 9);
    keep(this.waterTex);
    this.water = new Mesh(
      keep(new CircleGeometry(POND_R + 0.6, 56)),
      keep(new MeshLambertMaterial({ map: this.waterTex, color: '#b9e6f0', transparent: true, opacity: 0.86 })),
    );
    this.water.rotation.x = -Math.PI / 2;
    stage.add(grass, sand, this.water);

    this.buildForest(keep);
    this.buildMushrooms(keep);
    this.stumpShadow = blobShadow(sim.L.platR * 1.08, 0.3);
    this.stumpShadow.position.set(0, 0.03, 0);
    this.stumpShadow.renderOrder = 1;
    stage.add(this.stumpShadow);

    // ---- Babcia on her boat ----------------------------------------------------------
    this.babciaModel = buildPierogi('#f4d9b5');
    this.buildBabcia(keep);

    // ---- particles -------------------------------------------------------------------
    this.bits = new InstancedMesh(keep(new IcosahedronGeometry(0.5, 0)), keep(new MeshBasicMaterial({ color: '#fff' })), 200);
    this.bits.frustumCulled = false;
    for (let i = 0; i < 200; i++) {
      put(this.bits, i, 0, -50, 0, 0, 0, 0);
      this.bits.setColorAt(i, new Color('#fff'));
      this.bitsLife.push({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, size: 0, g: 0 });
    }
    stage.add(this.bits);

    // ---- leaves on the water and in the air ------------------------------------------
    const rnd = mulberry32(77);
    const leafGeo = keep(new CircleGeometry(0.32, 5));
    this.leaves = new InstancedMesh(leafGeo, keep(new MeshBasicMaterial({ color: '#fff', side: DoubleSide })), 56);
    this.leaves.frustumCulled = false;
    const leafCols = ['#e4572e', '#f2a23a', '#d9a21b', '#b5472a', '#e9c23a'];
    for (let i = 0; i < 56; i++) {
      const kind = i < 26 ? 'float' : 'fall';
      const a = rnd() * TAU;
      const r = kind === 'float' ? 6 + rnd() * (POND_R - 7) : 3 + rnd() * 14;
      this.leafState.push({ x: Math.cos(a) * r, z: Math.sin(a) * r * (kind === 'float' ? 1 : 0.9), y: kind === 'float' ? 0.04 : rnd() * 9, r: rnd() * TAU, kind, ph: rnd() * TAU, sp: 0.35 + rnd() * 0.4 });
      this.leaves.setColorAt(i, new Color(leafCols[i % leafCols.length]));
    }
    stage.add(this.leaves);

    // ---- players ---------------------------------------------------------------------
    info.forEach((pl, i) => {
      const model = buildPierogi(pl.color);
      model.body.rotation.order = 'YXZ';
      const tag = nameTag(pl.name, pl.color, 3.3);
      tag.position.set(0, 2.1, 0);
      model.root.add(tag);
      model.root.position.set(sim.players[i].x, DECK_Y, sim.players[i].z);
      stage.add(model.root);
      this.players.push({ model, tag, squash: 0, stretch: 0, phase: 0, spin: 0, facing: 0, splashed: false, lastY: DECK_Y });
    });
  }

  // ---- building -------------------------------------------------------------------

  private buildForest(keep: <T extends { dispose(): void }>(x: T) => T) {
    const stage = this.stage;
    const rnd = mulberry32(4242);
    // Reed beds along the shore, with gaps where the swimmers get out.
    const reedGeo = keep(new CylinderGeometry(0.025, 0.05, 2, 4));
    reedGeo.translate(0, 1, 0);
    const headGeo = keep(new CylinderGeometry(0.1, 0.1, 0.55, 5));
    headGeo.translate(0, 1.85, 0);
    const reedMat = keep(flat('#a8a14a'));
    const headMat = keep(flat('#6a3b20'));
    const nReed = 150;
    const reeds = new InstancedMesh(reedGeo, reedMat, nReed);
    const heads = new InstancedMesh(headGeo, headMat, nReed);
    let k = 0;
    for (let tries = 0; tries < 800 && k < nReed; tries++) {
      const a = rnd() * TAU;
      const r = POND_R - 0.8 + rnd() * 1.6;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (Math.abs(x) > 11 && Math.abs(z) < 6.2) continue;
      // Clumps.
      if (Math.sin(a * 5.3 + 1) < -0.15) continue;
      const h = 0.7 + rnd() * 0.7;
      put(reeds, k, x, 0, z, 1, h, 1, rnd() * TAU);
      put(heads, k, x, 0, z, 1, h, 1, 0);
      k++;
    }
    reeds.count = heads.count = k;
    reeds.frustumCulled = heads.frustumCulled = false;
    stage.add(reeds, heads);

    // Pines and birches on the far banks.
    const place = (n: number, rMin: number, rMax: number) => {
      const out: { x: number; z: number; s: number }[] = [];
      for (let tries = 0; tries < n * 40 && out.length < n; tries++) {
        const a = rnd() * TAU;
        const r = rMin + rnd() * (rMax - rMin);
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r * 0.9;
        // Keep the front (towards the camera) clear.
        if (z > 9 && Math.abs(x) < 24) continue;
        if (z > 13) continue;
        if (out.some((o) => Math.hypot(o.x - x, o.z - z) < 3.4)) continue;
        out.push({ x, z, s: 0.8 + rnd() * 0.6 });
      }
      return out;
    };
    const pines = place(46, 15.5, 36);
    const coneGeo = keep(new ConeGeometry(1, 1.9, 7));
    const pineMat = keep(flat('#2c6a3d'));
    const trunkGeo = keep(new CylinderGeometry(0.22, 0.32, 1, 6));
    trunkGeo.translate(0, 0.5, 0);
    const trunkMat = keep(new MeshLambertMaterial({ map: keep(barkTexture(false)), flatShading: true }));
    const cones = new InstancedMesh(coneGeo, pineMat, pines.length * 3);
    const trunks = new InstancedMesh(trunkGeo, trunkMat, pines.length);
    pines.forEach((p, i) => {
      const s = p.s * 1.25;
      put(trunks, i, p.x, 0, p.z, s, 2.2 * s, s);
      put(cones, i * 3, p.x, 1.9 * s + 0.4, p.z, 2.1 * s, 1.2 * s, 2.1 * s, i);
      put(cones, i * 3 + 1, p.x, 3.5 * s + 0.4, p.z, 1.65 * s, 1.1 * s, 1.65 * s, i);
      put(cones, i * 3 + 2, p.x, 4.9 * s + 0.4, p.z, 1.2 * s, 1.0 * s, 1.2 * s, i);
      cones.setColorAt(i * 3, new Color().setHSL(0.38, 0.45, 0.2 + (i % 3) * 0.025));
      cones.setColorAt(i * 3 + 1, new Color().setHSL(0.38, 0.45, 0.24 + (i % 3) * 0.025));
      cones.setColorAt(i * 3 + 2, new Color().setHSL(0.38, 0.45, 0.28 + (i % 3) * 0.025));
    });
    cones.frustumCulled = trunks.frustumCulled = false;
    stage.add(cones, trunks);

    const birches = place(22, 14.5, 32).filter((b) => !pines.some((p) => Math.hypot(p.x - b.x, p.z - b.z) < 3));
    const bTrunkGeo = keep(new CylinderGeometry(0.2, 0.28, 1, 6));
    bTrunkGeo.translate(0, 0.5, 0);
    const bTrunkMat = keep(new MeshLambertMaterial({ map: keep(barkTexture(true)), flatShading: true }));
    const crownGeo = keep(new IcosahedronGeometry(1, 0));
    const crownMat = keep(flat('#fff'));
    const bTrunks = new InstancedMesh(bTrunkGeo, bTrunkMat, birches.length);
    const crowns = new InstancedMesh(crownGeo, crownMat, birches.length * 3);
    const gold = ['#e8b02c', '#f0c548', '#d98f26', '#c9a02a'];
    birches.forEach((b, i) => {
      const h = 6.2 * b.s;
      put(bTrunks, i, b.x, 0, b.z, b.s, h, b.s);
      put(crowns, i * 3, b.x, h + 0.2, b.z, 2.1 * b.s, 1.9 * b.s, 2.1 * b.s, i);
      put(crowns, i * 3 + 1, b.x + 1.1 * b.s, h - 0.9 * b.s, b.z + 0.4, 1.5 * b.s, 1.3 * b.s, 1.5 * b.s, i + 1);
      put(crowns, i * 3 + 2, b.x - 0.9 * b.s, h - 0.6 * b.s, b.z - 0.6, 1.6 * b.s, 1.4 * b.s, 1.6 * b.s, i + 2);
      for (let c = 0; c < 3; c++) crowns.setColorAt(i * 3 + c, new Color(gold[(i + c) % gold.length]));
    });
    bTrunks.frustumCulled = crowns.frustumCulled = false;
    stage.add(bTrunks, crowns);

    // Lily pads out on the water, and little bushes on the banks.
    const padGeo = keep(new CircleGeometry(0.55, 7));
    padGeo.rotateX(-Math.PI / 2);
    const pads = new InstancedMesh(padGeo, keep(flat('#4f9a45')), 14);
    for (let i = 0; i < 14; i++) {
      const a = rnd() * TAU;
      const r = 8.4 + rnd() * 2.8;
      put(pads, i, Math.cos(a) * r, 0.05, Math.sin(a) * r, 1 + rnd() * 0.6, 1, 1 + rnd() * 0.6, rnd() * TAU);
    }
    pads.frustumCulled = false;
    stage.add(pads);
    const bushGeo = keep(new IcosahedronGeometry(1, 0));
    const bushes = new InstancedMesh(bushGeo, keep(flat('#7e9a3a')), 16);
    for (let i = 0; i < 16; i++) {
      const a = rnd() * TAU;
      const r = POND_R + 2.4 + rnd() * 5;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (z > 12) {
        put(bushes, i, 0, -40, 0, 0, 0, 0);
        continue;
      }
      const s = 0.7 + rnd() * 0.8;
      put(bushes, i, x, 0.2, z, s * 1.4, s, s * 1.4, rnd() * 3);
      bushes.setColorAt(i, new Color().setHSL(0.2 + rnd() * 0.05, 0.4, 0.3 + rnd() * 0.12));
    }
    bushes.frustumCulled = false;
    stage.add(bushes);
  }

  private buildMushrooms(keep: <T extends { dispose(): void }>(x: T) => T) {
    const { L } = this.sim;
    const rnd = mulberry32(99);
    const capGeo = keep(capGeometry());
    const topGeo = keep(new CircleGeometry(0.86, 12));
    topGeo.rotateX(-Math.PI / 2);
    const stemGeo = keep(new CylinderGeometry(0.32, 0.42, 1, 8));
    stemGeo.translate(0, -0.5, 0);
    const stemMat = keep(flat('#f2e4c6'));
    const shadowGeo = keep(new CircleGeometry(1, 14));
    shadowGeo.rotateX(-Math.PI / 2);
    const shadowMat = keep(new MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.28, depthWrite: false }));
    for (let i = 0; i < L.n; i++) {
      const group = new Group();
      const cap = new Mesh(capGeo, this.sideMats[0]);
      cap.scale.set(L.capR, L.capR, L.capR);
      const top = new Mesh(topGeo, this.topMats[0]);
      top.scale.set(L.capR, 1, L.capR);
      top.position.y = 0.012;
      top.rotation.y = rnd() * TAU;
      const stem = new Mesh(stemGeo, stemMat);
      stem.scale.set(L.capR, 4.2, L.capR);
      stem.position.y = -0.3 * L.capR;
      group.add(cap, top, stem);
      group.position.y = DECK_Y;
      this.stage.add(group);
      // The shadow stays on the water.
      const shadow = new Mesh(shadowGeo, shadowMat);
      shadow.scale.set(L.capR * 1.05, 1, L.capR * 1.05);
      shadow.position.y = 0.03;
      shadow.renderOrder = 1;
      this.stage.add(shadow);
      this.caps.push({ group, cap, top, stem, shadow, colour: -1, puff: 0 });
    }

    // The tree stump.
    const bark = keep(new MeshLambertMaterial({ map: keep(barkTexture(false)), flatShading: true }));
    bark.map!.repeat.set(5, 1);
    const topMat = keep(new MeshLambertMaterial({ map: keep(stumpTopTexture()), flatShading: true }));
    const R = L.platR;
    const side = new Mesh(keep(new CylinderGeometry(R, R * 1.1, 5, 18, 1, true)), bark);
    side.position.y = -2.5 - 0.03;
    const topDisc = new Mesh(keep(new CircleGeometry(R, 18)), topMat);
    topDisc.rotation.x = -Math.PI / 2;
    topDisc.position.y = -0.03;
    // A few knobbly roots at the waterline.
    const rootMat = bark;
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * TAU + 0.3;
      const r = new Mesh(keep(new CylinderGeometry(0.18, 0.5, 2.2, 5)), rootMat);
      r.position.set(Math.cos(a) * R * 1.12, -DECK_Y + 0.1, Math.sin(a) * R * 1.12);
      r.rotation.set(Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9);
      this.stump.add(r);
    }
    this.stump.add(side, topDisc);
    this.stump.position.y = DECK_Y;
    this.stage.add(this.stump);
  }

  private buildBabcia(keep: <T extends { dispose(): void }>(x: T) => T) {
    const stage = this.stage;
    const g = this.babcia;
    // Boat: a wooden hull with a pointed bow and stern.
    const wood = keep(flat('#a8703c'));
    const dark = keep(flat('#6b4222'));
    const hull = new Mesh(keep(new CylinderGeometry(2.6, 1.9, 0.9, 8)), wood);
    hull.scale.set(1.35, 1, 0.82);
    hull.position.y = 0.05;
    const rim = new Mesh(keep(new CylinderGeometry(2.7, 2.6, 0.2, 8, 1, true)), dark);
    rim.scale.set(1.35, 1, 0.82);
    rim.position.y = 0.55;
    const deck = new Mesh(keep(new CircleGeometry(2.45, 8)), keep(flat('#c99557')));
    deck.rotation.x = -Math.PI / 2;
    deck.scale.set(1.35, 0.82, 1);
    deck.position.y = 0.48;
    const bench = new Mesh(keep(new CylinderGeometry(0.3, 0.3, 2.4, 5)), dark);
    bench.rotation.z = Math.PI / 2;
    bench.position.set(0, 0.62, -1.15);
    g.add(hull, rim, deck, bench);
    // The oar.
    const oar = new Mesh(keep(new CylinderGeometry(0.06, 0.06, 3.2, 5)), dark);
    oar.rotation.set(0.2, 0, 1.0);
    oar.position.set(3.0, 0.7, 0.4);
    g.add(oar);
    // Babcia herself: a big pierogi in a headscarf.
    const b = this.babciaModel;
    b.root.scale.setScalar(1.9);
    b.root.position.set(0, 0.45, -0.2);
    const scarfMat = keep(flat('#cf3a2c'));
    // A headscarf: a thick red band round the top of the dumpling, knotted under the chin.
    const scarf = new Mesh(keep(new TorusGeometry(0.8, 0.17, 5, 16, Math.PI * 0.82)), scarfMat);
    scarf.rotation.z = Math.PI / 2 - Math.PI * 0.41;
    scarf.scale.z = 1.5;
    scarf.position.set(0, 0, 0.02);
    const knot = new Mesh(keep(new SphereGeometry(0.2, 6, 4)), scarfMat);
    knot.position.set(0.62, 0.22, 0.12);
    const knot2 = knot.clone();
    knot2.position.set(-0.62, 0.22, 0.12);
    const flap = new Mesh(keep(new SphereGeometry(0.17, 5, 3)), scarfMat);
    flap.position.set(0.7, 0.05, 0.12);
    flap.scale.set(0.8, 1.4, 0.8);
    const flap2 = flap.clone();
    flap2.position.set(-0.7, 0.05, 0.12);
    const dotMat = keep(new MeshBasicMaterial({ color: '#fff0d0' }));
    for (let k = 0; k < 6; k++) {
      const a = Math.PI / 2 - Math.PI * 0.35 + (k / 5) * Math.PI * 0.7;
      const d = new Mesh(keep(new SphereGeometry(0.07, 5, 3)), dotMat);
      d.position.set(Math.cos(a) * 0.82, Math.sin(a) * 0.82, 0.3);
      b.body.add(d);
    }
    // Rosy cheeks and little glasses.
    const cheekMat = keep(new MeshBasicMaterial({ color: '#f09a8a' }));
    for (const x of [-0.42, 0.42]) {
      const c = new Mesh(keep(new SphereGeometry(0.1, 5, 3)), cheekMat);
      c.position.set(x, 0.2, 0.3);
      c.scale.z = 0.4;
      b.body.add(c);
    }
    const glassMat = keep(new MeshBasicMaterial({ color: '#7a5a2a' }));
    for (const x of [-0.24, 0.24]) {
      const r = new Mesh(keep(new RingGeometry(0.15, 0.2, 10)), glassMat);
      r.position.set(x, 0.42, 0.34);
      b.body.add(r);
    }
    b.body.add(flap, flap2);
    b.body.add(scarf, knot, knot2);
    g.add(b.root);
    // The sign: a post with a cream board and a mushroom of the called colour on it.
    const post = new Mesh(keep(new CylinderGeometry(0.08, 0.08, 3.4, 5)), dark);
    post.position.set(0, 2.3, 0.35);
    this.sign.add(post);
    const board = new Mesh(keep(new CylinderGeometry(1.8, 1.8, 0.18, 8)), keep(flat('#f8ecd0')));
    board.rotation.x = Math.PI / 2;
    board.position.set(0, 4.2, 0.35);
    const frame = new Mesh(keep(new CylinderGeometry(2.0, 2.0, 0.14, 8)), dark);
    frame.rotation.x = Math.PI / 2;
    frame.position.set(0, 4.2, 0.28);
    this.sign.add(frame, board);
    const icon = new Group();
    icon.position.set(0, 4.2, 0.55);
    icon.scale.setScalar(0.72);
    const sStem = new Mesh(keep(new CylinderGeometry(0.42, 0.55, 1.3, 8)), keep(flat('#f2e4c6')));
    sStem.position.y = -1.0;
    const sCap = new Mesh(keep(new SphereGeometry(1.75, 12, 7, 0, TAU, 0, Math.PI / 2)), this.sideMats[0]);
    sCap.scale.set(1, 0.85, 0.5);
    sCap.position.y = -0.4;
    this.signCap = sCap;
    const rimDisc = new Mesh(keep(new CylinderGeometry(1.75, 1.75, 0.12, 12)), keep(flat('#f2e4c6')));
    rimDisc.scale.set(1, 1, 0.5);
    rimDisc.rotation.x = 0;
    rimDisc.position.y = -0.42;
    icon.add(sStem, rimDisc, sCap);
    const dotGeo = keep(new SphereGeometry(0.26, 6, 4));
    for (const [x, y, s] of [
      [-0.9, 0.35, 0.9],
      [0.1, 0.9, 1.1],
      [0.95, 0.3, 0.85],
      [-0.2, 0.2, 0.7],
      [0.6, 0.85, 0.6],
    ]) {
      const d = new Mesh(dotGeo, this.signDotMat);
      d.position.set(x, y - 0.4, 0.9 * (1 - Math.min(0.7, Math.abs(x) * 0.3)));
      d.scale.set(s, s, 0.4);
      icon.add(d);
      this.signDots.push(d);
    }
    this.sign.add(icon);
    this.sign.rotation.x = -0.35;
    this.sign.position.set(0, 0, 0.2);
    g.add(this.sign);
    g.position.set(0, 0, -8.7);
    stage.add(g);
    // Ripple under the boat.
    const sh = blobShadow(3.4, 0.25);
    sh.scale.set(1.3, 1, 0.8);
    sh.renderOrder = 1;
    g.add(sh);
  }

  // ---- effects ----------------------------------------------------------------------

  ripple(x: number, z: number, r0: number, r1: number, life = 1.0, delay = 0, color = '#ffffff') {
    let r = this.ripples.find((q) => q.t >= q.life);
    if (!r) {
      if (this.ripples.length >= 40) return;
      const mesh = new Mesh(new RingGeometry(0.88, 1, 24), new MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false }));
      mesh.rotation.x = -Math.PI / 2;
      mesh.renderOrder = 2;
      this.stage.add(mesh);
      this.stage.keep(mesh.geometry);
      this.stage.keep(mesh.material as Material);
      r = { mesh, t: 99, life: 1, r0: 1, r1: 1, delay: 0 };
      this.ripples.push(r);
    }
    r.t = 0;
    r.life = life;
    r.r0 = r0;
    r.r1 = r1;
    r.delay = delay;
    r.mesh.position.set(x, 0.06, z);
    (r.mesh.material as MeshBasicMaterial).color.set(color);
    r.mesh.visible = false;
  }

  private emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, color: string, g = 9) {
    const i = this.bitsLife.findIndex((b) => b.life <= 0);
    if (i < 0) return;
    this.bitsLife[i] = { x, y, z, vx, vy, vz, life, max: life, size, g };
    this.bits.setColorAt(i, new Color(color));
    if (this.bits.instanceColor) this.bits.instanceColor.needsUpdate = true;
  }

  burst(x: number, y: number, z: number, n: number, color: string, speed = 3, size = 0.22, up = 4) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * TAU;
      const s = speed * (0.4 + Math.random() * 0.8);
      this.emit(x, y, z, Math.cos(a) * s, up * (0.5 + Math.random()), Math.sin(a) * s, 0.5 + Math.random() * 0.5, size * (0.6 + Math.random() * 0.8), color);
    }
  }

  bump(amount: number) {
    this.shake = Math.max(this.shake, amount);
  }

  /** React to a sim event with splashes, puffs and squashes. */
  onEvent(e: MEvent) {
    const sim = this.sim;
    switch (e.t) {
      case 'call':
        this.signPop = 1;
        break;
      case 'recolour': {
        const c = this.caps[e.cap];
        const p = capPos(sim.L, sim.ring, e.cap);
        this.burst(p.x, DECK_Y + 0.4, p.z, 14, SPECIES[e.to].hex, 3.2, 0.3, 3.5);
        this.burst(p.x, DECK_Y + 0.4, p.z, 6, '#fff6dd', 2.2, 0.22, 3);
        c.puff = 1;
        break;
      }
      case 'sink': {
        this.bump(0.5);
        for (let i = 0; i < sim.L.n; i++) {
          if (e.safe.includes(i)) continue;
          const p = capPos(sim.L, sim.ring, i);
          this.ripple(p.x, p.z, sim.L.capR * 0.6, sim.L.capR * 1.9, 1.3, 0.05 + i * 0.015);
          this.ripple(p.x, p.z, sim.L.capR * 0.3, sim.L.capR * 1.3, 1.1, 0.3 + i * 0.015);
          this.burst(p.x, 0.3, p.z, 5, '#cfeaf2', 2.5, 0.2, 3);
        }
        this.ripple(0, 0, sim.L.platR * 0.6, sim.L.platR * 2.0, 1.5, 0.05);
        this.ripple(0, 0, sim.L.platR * 0.3, sim.L.platR * 1.5, 1.2, 0.35);
        break;
      }
      case 'rise': {
        for (let i = 0; i < sim.L.n; i++) {
          if (sim.safe.includes(i)) continue;
          const p = capPos(sim.L, sim.ring, i);
          this.ripple(p.x, p.z, sim.L.capR * 1.7, sim.L.capR * 0.8, 1.0, 0, '#e8fbff');
        }
        this.ripple(0, 0, sim.L.platR * 1.9, sim.L.platR * 0.9, 1.1, 0, '#e8fbff');
        break;
      }
      case 'fall': {
        const v = this.players[e.p];
        if (v) {
          v.splashed = false;
          v.spin = (Math.random() < 0.5 ? -1 : 1) * (4 + Math.random() * 3);
        }
        break;
      }
      case 'shove': {
        const p = sim.players[e.p];
        const v = this.players[e.p];
        v.stretch = 1;
        this.burst(p.x, DECK_Y + 0.1, p.z, 4, '#fff1d0', 1.5, 0.2, 1.5);
        break;
      }
      case 'hit': {
        this.burst(e.x, DECK_Y + 0.7, e.z, 9, '#ffe27a', 4, 0.22, 3.5);
        this.burst(e.x, DECK_Y + 0.7, e.z, 4, '#ffffff', 3, 0.18, 3);
        const a = this.players[e.a];
        const b = this.players[e.b];
        if (a) a.squash = 1;
        if (b) b.squash = 1;
        this.bump(0.35);
        break;
      }
      default:
        break;
    }
  }

  // ---- per frame ---------------------------------------------------------------------

  render(dt: number) {
    const sim = this.sim;
    const L = sim.L;
    this.time += dt;
    const t = this.time;

    // Water.
    this.waterTex.offset.x = (t * 0.012) % 1;
    this.waterTex.offset.y = (t * 0.007) % 1;
    this.water.position.y = Math.sin(t * 1.3) * 0.035;

    // Ripples.
    for (const r of this.ripples) {
      if (r.t >= r.life) continue;
      r.t += dt;
      if (r.t < r.delay) {
        r.mesh.visible = false;
        continue;
      }
      const k = Math.min(1, (r.t - r.delay) / Math.max(0.01, r.life - r.delay));
      const s = r.r0 + (r.r1 - r.r0) * (1 - (1 - k) * (1 - k));
      r.mesh.visible = k < 1;
      r.mesh.scale.set(s, s, 1);
      (r.mesh.material as MeshBasicMaterial).opacity = 0.75 * (1 - k);
    }

    // Stump and mushrooms.
    const sink = DECK_Y + 1.7;
    this.stump.position.y = DECK_Y - sim.platDown * sink;
    this.stump.rotation.z = Math.sin(sim.platDown * Math.PI) * 0.03;
    this.stumpShadow.visible = sim.platDown < 0.6;
    for (let i = 0; i < L.n; i++) {
      const c = this.caps[i];
      const p = capPos(L, sim.ring, i);
      const down = sim.capDown[i];
      c.group.position.set(p.x, DECK_Y - down * sink, p.z);
      c.group.rotation.y = -capAngle(L, sim.ring, i);
      c.group.rotation.z = Math.sin(down * Math.PI) * 0.07 * (i % 2 ? 1 : -1);
      if (c.colour !== sim.cur[i]) {
        c.colour = sim.cur[i];
        c.cap.material = this.sideMats[c.colour];
        c.top.material = this.topMats[c.colour];
      }
      c.puff = Math.max(0, c.puff - dt * 3);
      const pop = 1 + Math.sin(c.puff * Math.PI) * 0.12;
      c.cap.scale.set(L.capR * pop, L.capR * (1 + (pop - 1) * 2), L.capR * pop);
      c.shadow.position.set(p.x, 0.03, p.z);
      c.shadow.visible = down < 0.7;
    }

    this.updateBabcia(dt, t);
    this.updatePlayers(dt, t);
    this.updateBits(dt);
    this.updateLeaves(t);

    // Camera shake.
    this.shake = Math.max(0, this.shake - dt * 1.6);
    const cam = this.stage.camera;
    this.stage.lookAt(this.base, 30, 0.82);
    if (this.shake > 0.01) {
      cam.position.x += (Math.random() - 0.5) * this.shake * 0.7;
      cam.position.y += (Math.random() - 0.5) * this.shake * 0.5;
    }
    this.stage.render();
  }

  private updateBabcia(dt: number, t: number) {
    const sim = this.sim;
    this.babcia.position.y = Math.sin(t * 1.4) * 0.07;
    this.babcia.rotation.z = Math.sin(t * 1.1) * 0.025;
    this.babcia.rotation.x = Math.sin(t * 0.9 + 1) * 0.015;
    const want = sim.phase === 'call' || sim.phase === 'sink' ? 1 : 0;
    this.signUp += (want - this.signUp) * Math.min(1, dt * (want ? 9 : 5));
    this.signPop = Math.max(0, this.signPop - dt * 2.4);
    const pop = 1 + Math.sin(this.signPop * Math.PI) * 0.18;
    const call = sim.phase === 'call' ? 1 + Math.sin(t * 9) * 0.015 * (sim.callLeft < 1.2 ? 2 : 1) : 1;
    this.sign.position.y = -4.6 * (1 - this.signUp);
    this.sign.scale.setScalar(Math.max(0.01, pop * call));
    this.sign.visible = this.signUp > 0.02;
    if (sim.targetColour >= 0) {
      this.signCap.material = this.sideMats[sim.targetColour];
      this.signDotMat.color.set(SPECIES[sim.targetColour].spot);
    }
    // Babcia hops when she calls and sways otherwise.
    const b = this.babciaModel;
    const hop = Math.max(0, this.signPop) * 0.5;
    b.body.position.y = Math.abs(Math.sin(this.signPop * Math.PI)) * 0.35 + hop * 0;
    b.body.rotation.z = Math.sin(t * 1.7) * 0.05;
    b.shadow.visible = false;
  }

  private updatePlayers(dt: number, t: number) {
    const sim = this.sim;
    for (let i = 0; i < this.players.length; i++) {
      const p = sim.players[i];
      const v = this.players[i];
      const m = v.model;
      if (!p.present) {
        m.root.visible = false;
        continue;
      }
      m.root.visible = true;
      const speed = Math.hypot(p.vx + p.kx, p.vz + p.kz);
      v.squash = Math.max(0, v.squash - dt * 4);
      v.stretch = Math.max(0, v.stretch - dt * 5);
      let y = DECK_Y + 0.02;
      let sx = 1;
      let sy = 1;
      let sz = 1;
      let tilt = 0;
      let roll = 0;
      let bob = 0;
      m.shadow.visible = true;
      if (p.alive) {
        v.phase += dt * (3 + speed * 1.6);
        if (speed > 0.8) {
          bob = Math.abs(Math.sin(v.phase)) * 0.13 * Math.min(1, speed / 4);
          roll = Math.sin(v.phase) * 0.09;
          tilt = Math.min(1, speed / 5.5) * 0.16;
        } else bob = Math.sin(t * 3 + i) * 0.015;
        const sq = Math.sin(v.squash * Math.PI) * 0.22;
        sy = 1 - sq + v.stretch * 0.1;
        sx = sz = 1 + sq * 0.7;
        sz += v.stretch * 0.3;
        sx -= v.stretch * 0.1;
        v.splashed = false;
        v.lastY = y;
      } else if (p.fellAt !== null) {
        const ft = p.fallT;
        const air = 0.5;
        if (ft < air) {
          // Tumbling down.
          const g = 9.8;
          y = Math.max(-0.35, DECK_Y - 0.5 * g * ft * ft + 1.2 * ft * (ft < 0.15 ? 1 : 0));
          roll = v.spin * ft;
          m.shadow.visible = false;
        } else {
          if (!v.splashed) {
            v.splashed = true;
            this.ripple(p.x, p.z, 0.4, 2.8, 1.1);
            this.ripple(p.x, p.z, 0.2, 1.8, 0.9, 0.12);
            this.burst(p.x, 0.1, p.z, 16, '#d7f3fb', 3.4, 0.25, 6.5);
            this.burst(p.x, 0.1, p.z, 6, '#ffffff', 2.4, 0.2, 5);
            this.bump(0.25);
            v.squash = 0;
          }
          m.shadow.visible = false;
          if (p.onBank) {
            y = 0.2 + Math.sin(t * 2.2 + i * 1.7) * 0.03;
            roll = 0;
            const wet = Math.max(0, 1 - (ft - 0) * 0);
            sy = 0.96 * wet;
          } else {
            // Floating: half under water, bobbing.
            y = -0.38 + Math.sin(t * 4.5 + i * 2) * 0.06;
            roll = Math.sin(t * 3.1 + i) * 0.16 + (p.swimming ? Math.sin(t * 9 + i) * 0.1 : 0);
            tilt = p.swimming ? 0.12 : 0;
            if (p.swimming && Math.sin(t * 5 + i) > 0.95) this.ripple(p.x, p.z, 0.3, 1.2, 0.7, 0);
          }
        }
      }
      m.root.position.set(p.x, y + bob, p.z);
      // Face the way we're going (fallen players on the bank look at the pond).
      let face = p.face;
      if (!p.alive && p.onBank) face = Math.atan2(-p.x, -p.z);
      v.facing += angleDiff(v.facing, face) * Math.min(1, dt * 14);
      m.body.rotation.set(tilt, v.facing, roll);
      m.body.scale.set(sx, sy, sz);
      m.body.position.y = 0;
      v.tag.visible = true;
      v.tag.position.y = (p.alive ? 2.15 : p.onBank ? 2.0 : 1.7) + (p.alive ? (i % 3) * 0.42 : 0);
      (v.tag.material as { opacity: number }).opacity = p.alive || p.onBank ? 1 : 0.9;
    }
  }

  private updateBits(dt: number) {
    for (let i = 0; i < this.bitsLife.length; i++) {
      const b = this.bitsLife[i];
      if (b.life <= 0) continue;
      b.life -= dt;
      if (b.life <= 0) {
        put(this.bits, i, 0, -50, 0, 0, 0, 0);
        continue;
      }
      b.vy -= b.g * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
      if (b.y < 0.05 && b.vy < 0) {
        b.life = Math.min(b.life, 0.08);
        b.vy = 0;
      }
      const k = b.life / b.max;
      const s = b.size * (k < 0.3 ? k / 0.3 : 1);
      put(this.bits, i, b.x, b.y, b.z, s, s, s, b.life * 6);
    }
    this.bits.instanceMatrix.needsUpdate = true;
  }

  private updateLeaves(t: number) {
    const sim = this.sim;
    for (let i = 0; i < this.leafState.length; i++) {
      const l = this.leafState[i];
      dummy.rotation.set(-Math.PI / 2, 0, l.r);
      if (l.kind === 'float') {
        const x = l.x + Math.sin(t * 0.3 + l.ph) * 0.3;
        const z = l.z + Math.cos(t * 0.25 + l.ph) * 0.3;
        // Don't float through the middle where the arena is.
        const hidden = Math.hypot(x, z) < sim.L.ringR + sim.L.capR + 0.5;
        dummy.position.set(x, hidden ? -9 : 0.07 + Math.sin(t * 1.3) * 0.035, z);
        dummy.rotation.z = l.r + t * 0.1;
      } else {
        const y = 10 - ((t * l.sp * 1.1 + l.ph * 2) % 10);
        dummy.position.set(l.x + Math.sin(t * 0.8 + l.ph) * 1.4, y, l.z + Math.cos(t * 0.6 + l.ph) * 1.0);
        dummy.rotation.set(-Math.PI / 2 + Math.sin(t * 2 + l.ph) * 0.8, Math.cos(t * 1.7 + l.ph) * 0.6, l.r + t);
      }
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      this.leaves.setMatrixAt(i, dummy.matrix);
    }
    this.leaves.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.stage.dispose();
  }
}
