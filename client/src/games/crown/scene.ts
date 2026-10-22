/**
 * Korona in 3D: the arcaded Renaissance courtyard of Wawel castle on a sunny afternoon. Three storeys
 * of cream arcades (round arches below, the famous tall slim columns on top) under deep red-tiled
 * eaves, red-and-white banners with golden crowns, a stone fountain in the middle and four columns
 * round it. One golden crown. Same PS2 look as the other arena games.
 */
import {
  AdditiveBlending,
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
  TorusGeometry,
  Vector3,
  type Material,
  type Sprite,
} from 'three';
import { ArenaStage, blobShadow, box, buildPierogi, flat, groundTexture, nameTag, pixelTexture, type PierogiModel } from '../arena/kit';
import { Puffs } from '../arena/puffs';
import { COLUMNS, COLUMN_R, FOUNTAIN_R, FOUNTAIN_TOP, HALF_D, HALF_W, type CrownEvent, type CrownSim } from './logic';

export interface PlayerLook {
  name: string;
  color: string;
}

type Keep = <T extends { dispose(): void }>(x: T) => T;

const GOLD = '#ffc93c';
/** The pierogi are drawn a little smaller than full size. */
const SCALE = 0.8;
/** Height of the crown's band on a wearer's head. */
const HEAD = 0.62;

interface Actor {
  model: PierogiModel;
  tag: Sprite;
  color: string;
  /** Facing angle (smoothed). */
  yaw: number;
  /** Walk cycle. */
  walk: number;
  stars: Group;
  /** A golden ring on the ground under the wearer. */
  halo: Mesh;
  lastDash: number;
}

export class CrownScene {
  readonly stage: ArenaStage;
  private actors: Actor[] = [];
  private crown: Group;
  private crownMats: MeshLambertMaterial[] = [];
  private crownShadow: Mesh;
  private beam: Mesh;
  private beamMat: MeshBasicMaterial;
  private marker: Mesh;
  private markerMat: MeshBasicMaterial;
  private water: Mesh;
  private banners: Mesh[] = [];
  private puffs = new Puffs(260, 2.5, 1.4);
  private sparks = new Puffs(160, -0.6, 1.2);
  private time = 0;
  private shake = 0;
  private spin = 0;
  private flash = 0;
  private v = new Vector3();

  constructor(canvas: HTMLCanvasElement, looks: PlayerLook[]) {
    this.stage = new ArenaStage(canvas, { sky: '#a9d8f2', fog: [55, 130], fov: 38 });
    const stage = this.stage;
    const keep: Keep = (x) => stage.keep(x);

    this.buildCourtyard(keep);
    this.water = this.buildFountain(keep);
    this.buildColumns(keep);

    // The crown.
    this.crown = this.buildCrown(keep);
    stage.add(this.crown);
    this.crownShadow = blobShadow(0.55, 0.4);
    stage.add(this.crownShadow);
    // A pillar of light over the loose crown, so it can be found from the sofa.
    this.beamMat = keep(new MeshBasicMaterial({ color: '#fff0a8', transparent: true, opacity: 0.28, depthWrite: false, blending: AdditiveBlending, side: DoubleSide }));
    this.beam = new Mesh(keep(new CylinderGeometry(0.55, 0.75, 7, 10, 1, true)), this.beamMat);
    this.beam.position.y = 3.5;
    stage.add(this.beam);
    this.markerMat = keep(new MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.6, depthWrite: false }));
    const mg = keep(new RingGeometry(0.75, 0.95, 20));
    mg.rotateX(-Math.PI / 2);
    this.marker = new Mesh(mg, this.markerMat);
    this.marker.position.y = 0.04;
    stage.add(this.marker);

    stage.add(this.puffs.mesh, this.sparks.mesh);

    const starGeo = keep(new OctahedronGeometry(0.13, 0));
    const starMat = keep(new MeshBasicMaterial({ color: '#fff27a' }));
    const haloGeo = keep(new RingGeometry(0.95, 1.25, 24));
    haloGeo.rotateX(-Math.PI / 2);
    looks.forEach((l) => {
      const model = buildPierogi(l.color);
      model.mats.forEach((m) => keep(m));
      const tag = nameTag(l.name, l.color);
      tag.position.set(0, 2.25, 0);
      tag.scale.set(3, 0.75, 1);
      model.root.scale.setScalar(SCALE);
      model.root.add(tag);
      const stars = new Group();
      for (let k = 0; k < 3; k++) {
        const s = new Mesh(starGeo, starMat);
        const a = (k / 3) * Math.PI * 2;
        s.position.set(Math.cos(a) * 0.55, 0, Math.sin(a) * 0.55);
        stars.add(s);
      }
      stars.position.y = 1.35;
      stars.visible = false;
      model.root.add(stars);
      const halo = new Mesh(haloGeo, keep(new MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.75, depthWrite: false })));
      halo.position.y = 0.05;
      halo.visible = false;
      model.root.add(halo);
      stage.add(model.root);
      this.actors.push({ model, tag, color: l.color, yaw: 0, walk: 0, stars, halo, lastDash: -1 });
    });
  }

  // ---- scenery ----------------------------------------------------------------------------------

  private buildCourtyard(keep: Keep) {
    const stage = this.stage;
    // Big stone paving, with a lighter ring round the fountain and two paths crossing.
    const paving = keep(
      pixelTexture(
        16,
        (ctx, rnd) => {
          for (let y = 0; y < 16; y++)
            for (let x = 0; x < 16; x++) {
              const v = (rnd() - 0.5) * 22;
              ctx.fillStyle = `rgb(${176 + v},${162 + v},${138 + v * 0.7})`;
              ctx.fillRect(x, y, 1, 1);
            }
          ctx.fillStyle = 'rgba(70,55,40,.45)';
          ctx.fillRect(0, 0, 16, 1);
          ctx.fillRect(0, 8, 16, 1);
          ctx.fillRect(0, 0, 1, 8);
          ctx.fillRect(8, 8, 1, 8);
        },
        21,
        1,
      ),
    );
    paving.repeat.set(22, 16);
    const g = keep(new PlaneGeometry(64, 46));
    g.rotateX(-Math.PI / 2);
    const ground = new Mesh(g, keep(flat('#ffffff', { map: paving })));
    ground.position.set(0, 0, -2);
    stage.add(ground);
    const light = keep(flat('#e9dcc0', { map: keep(groundTexture('sand', 5, 4)) }));
    const ringGeo = keep(new RingGeometry(FOUNTAIN_R + 0.2, FOUNTAIN_R + 1.6, 24));
    ringGeo.rotateX(-Math.PI / 2);
    const ring = new Mesh(ringGeo, light);
    ring.position.y = 0.012;
    stage.add(ring);
    for (const [w, d] of [
      [HALF_W * 2, 1.2],
      [1.2, HALF_D * 2],
    ] as const) {
      const pg = keep(new PlaneGeometry(w, d));
      pg.rotateX(-Math.PI / 2);
      const path = new Mesh(pg, light);
      path.position.y = 0.008;
      stage.add(path);
    }

    // The arcades: one wing along the back, one down each side.
    const back = this.buildWing(keep, HALF_W * 2 + 6, 10);
    back.position.set(0, 0, -HALF_D - 0.9);
    const left = this.buildWing(keep, HALF_D * 2 + 3.2, 6);
    left.rotation.y = Math.PI / 2;
    left.position.set(-HALF_W - 1, 0, -1.6);
    const right = this.buildWing(keep, HALF_D * 2 + 3.2, 6);
    right.rotation.y = -Math.PI / 2;
    right.position.set(HALF_W + 1, 0, -1.6);
    stage.add(back, left, right);

    // Along the front, a low stone balustrade with pots of red geraniums.
    const stone = keep(flat('#e6d6b4'));
    const front = new Group();
    const rail = box(HALF_W * 2 + 2, 0.18, 0.4, stone);
    rail.position.y = 0.85;
    const plinth = box(HALF_W * 2 + 2, 0.22, 0.5, stone);
    front.add(rail, plinth);
    const baluster = keep(new CylinderGeometry(0.1, 0.14, 0.65, 6));
    for (let x = -HALF_W - 0.8; x <= HALF_W + 0.8; x += 0.55) {
      const b = new Mesh(baluster, stone);
      b.position.set(x, 0.55, 0);
      front.add(b);
    }
    const pot = keep(new CylinderGeometry(0.35, 0.25, 0.45, 7));
    const potMat = keep(flat('#b45a32'));
    const leaf = keep(new IcosahedronGeometry(0.38, 0));
    const leafMat = keep(flat('#3f7a2c'));
    const bloom = keep(new SphereGeometry(0.11, 4, 3));
    const bloomMat = keep(new MeshBasicMaterial({ color: '#e8334a' }));
    for (let x = -HALF_W; x <= HALF_W + 0.1; x += HALF_W / 2) {
      const p = new Mesh(pot, potMat);
      p.position.set(x, 1.17, 0);
      const l = new Mesh(leaf, leafMat);
      l.position.set(x, 1.55, 0);
      front.add(p, l);
      for (let k = 0; k < 4; k++) {
        const b = new Mesh(bloom, bloomMat);
        const a = k * 1.7 + x;
        b.position.set(x + Math.cos(a) * 0.28, 1.72 + (k % 2) * 0.08, Math.sin(a) * 0.28);
        front.add(b);
      }
    }
    front.position.set(0, 0, HALF_D + 0.75);
    stage.add(front);
  }

  /**
   * One wing of the arcades, `len` metres long, its colonnade along local z = 0 facing +z:
   * round arches on the ground floor and the first floor, tall slim columns on top, deep red eaves.
   */
  private buildWing(keep: Keep, len: number, bays: number) {
    const w = new Group();
    const span = len / bays;
    const stone = keep(flat('#efe3c6'));
    const shade = keep(flat('#cdb88f'));
    const wall = keep(flat('#e2c58e'));
    const dark = keep(flat('#6e4a2e'));
    const roofTex = keep(
      pixelTexture(
        16,
        (ctx, rnd) => {
          for (let y = 0; y < 16; y++)
            for (let x = 0; x < 16; x++) {
              const v = (rnd() - 0.5) * 26 - (y % 4 === 3 ? 34 : 0);
              ctx.fillStyle = `rgb(${186 + v},${70 + v * 0.5},${46 + v * 0.4})`;
              ctx.fillRect(x, y, 1, 1);
            }
          ctx.fillStyle = 'rgba(60,20,10,.35)';
          for (let x = 0; x < 16; x += 4) ctx.fillRect(x, 0, 1, 16);
        },
        31,
        1,
      ),
    );
    roofTex.repeat.set(len / 2, 3);
    const roofMat = keep(flat('#ffffff', { map: roofTex }));
    const DEPTH = 3.2;
    // The back wall, darker in the shade of the loggias, with doors and windows.
    const back = box(len, 15.6, 0.4, wall);
    back.position.z = -DEPTH;
    w.add(back);
    const doorMat = keep(flat('#4a2e1c'));
    const winMat = keep(flat('#3b4f66'));
    for (let k = 0; k < bays; k++) {
      const x = -len / 2 + (k + 0.5) * span;
      const d = box(k % 2 ? 1.0 : 1.3, k % 2 ? 1.4 : 2.4, 0.1, k % 2 ? winMat : doorMat);
      d.position.set(x, k % 2 ? 1.4 : 0, -DEPTH + 0.22);
      const win = box(0.9, 1.4, 0.1, winMat);
      win.position.set(x, 5.4, -DEPTH + 0.22);
      const win2 = box(0.8, 2.0, 0.1, winMat);
      win2.position.set(x, 9.6, -DEPTH + 0.22);
      w.add(d, win, win2);
    }
    // Floors of the loggias.
    for (const y of [4.2, 8.4]) {
      const slab = box(len, 0.45, DEPTH, shade);
      slab.position.set(0, y, -DEPTH / 2);
      w.add(slab);
    }
    const colGeo = (h: number, r: number) => keep(new CylinderGeometry(r * 0.85, r, h, 7));
    const capGeo = keep(new CylinderGeometry(0.36, 0.22, 0.25, 6));
    const baseGeo = keep(new CylinderGeometry(0.3, 0.34, 0.3, 6));
    const archGeo = keep(new TorusGeometry(span / 2 - 0.2, 0.2, 4, 10, Math.PI));
    const storeys = [
      { y0: 0, h: 2.6, arch: true, r: 0.24 },
      { y0: 4.65, h: 1.95, arch: true, r: 0.2 },
      { y0: 8.85, h: 3.8, arch: false, r: 0.16 },
    ];
    for (const s of storeys) {
      const g = colGeo(s.h, s.r);
      for (let k = 0; k <= bays; k++) {
        const x = -len / 2 + k * span;
        const c = new Mesh(g, stone);
        c.position.set(x, s.y0 + s.h / 2, 0);
        const cap = new Mesh(capGeo, stone);
        cap.position.set(x, s.y0 + s.h + 0.1, 0);
        const base = new Mesh(baseGeo, stone);
        base.position.set(x, s.y0 + 0.15, 0);
        w.add(c, cap, base);
        if (s.arch && k < bays) {
          const a = new Mesh(archGeo, stone);
          a.position.set(x + span / 2, s.y0 + s.h + 0.2, 0);
          a.scale.z = 1.2;
          w.add(a);
        }
      }
      if (s.y0 > 0) {
        // A balustrade along the loggia.
        const rail = box(len, 0.16, 0.36, stone);
        rail.position.set(0, s.y0 - 0.2 + 0.95, 0.05);
        const solid = box(len, 0.55, 0.22, shade);
        solid.position.set(0, s.y0 - 0.2, 0.05);
        w.add(rail, solid);
      }
      // The band above each storey (the spandrels over the arches).
      const top = s.y0 + s.h + (s.arch ? span / 2 : 0.25);
      const band = box(len, s.arch ? 0.75 : 0.4, 0.5, stone);
      band.position.set(0, top - 0.05, 0);
      w.add(band);
    }
    // The deep eaves, on carved dark beams.
    const eave = box(len + 0.4, 0.3, DEPTH + 2.2, dark);
    eave.position.set(0, 13.3, -DEPTH / 2 + 1.1);
    w.add(eave);
    const roof = new Mesh(keep(new PlaneGeometry(len + 0.6, 6.4)), roofMat);
    roof.rotation.x = -Math.PI / 2 + 0.5;
    roof.position.set(0, 13.6 + Math.sin(0.5) * 3.2 - 0.2, -DEPTH / 2 + 0.4);
    w.add(roof);
    // Red-and-white banners with a golden crown, hanging over the middle storey.
    const banner = keep(
      pixelTexture(
        16,
        (ctx) => {
          ctx.fillStyle = '#c8202f';
          ctx.fillRect(0, 0, 16, 16);
          ctx.fillStyle = '#f6efe0';
          ctx.fillRect(0, 0, 16, 3);
          ctx.fillStyle = '#ffc93c';
          // A little crown.
          ctx.fillRect(4, 9, 8, 3);
          ctx.fillRect(4, 6, 2, 3);
          ctx.fillRect(7, 5, 2, 4);
          ctx.fillRect(10, 6, 2, 3);
          ctx.fillStyle = '#f6efe0';
          ctx.fillRect(0, 15, 16, 1);
        },
        5,
        1,
      ),
    );
    const bannerMat = keep(new MeshLambertMaterial({ map: banner, side: DoubleSide }));
    const bannerGeo = keep(new PlaneGeometry(1.3, 3.2));
    bannerGeo.translate(0, -1.6, 0);
    for (let k = 1; k < bays; k += 2) {
      const b = new Mesh(bannerGeo, bannerMat);
      b.position.set(-len / 2 + k * span, 8.1, 0.45);
      w.add(b);
      this.banners.push(b);
    }
    return w;
  }

  /** The fountain: an octagonal basin, a column with two bowls, water. Returns the water surface. */
  private buildFountain(keep: Keep) {
    const stage = this.stage;
    const stone = keep(flat('#d9cba9'));
    const darker = keep(flat('#b9a984'));
    const f = new Group();
    const basin = new Mesh(keep(new CylinderGeometry(FOUNTAIN_R, FOUNTAIN_R + 0.1, 0.75, 8)), stone);
    basin.position.y = 0.375;
    const rim = new Mesh(keep(new CylinderGeometry(FOUNTAIN_R + 0.12, FOUNTAIN_R + 0.12, 0.16, 8)), darker);
    rim.position.y = 0.8;
    const water = new Mesh(keep(new CylinderGeometry(FOUNTAIN_R - 0.18, FOUNTAIN_R - 0.18, 0.05, 8)), keep(flat('#ffffff', { map: keep(groundTexture('water', 3, 7)) })));
    water.position.y = 0.72;
    const shaft = new Mesh(keep(new CylinderGeometry(0.28, 0.38, 2.0, 7)), stone);
    shaft.position.y = 1.4;
    const bowl = new Mesh(keep(new CylinderGeometry(1.0, 0.35, 0.35, 8)), darker);
    bowl.position.y = 2.25;
    const bowlWater = new Mesh(keep(new CylinderGeometry(0.85, 0.85, 0.05, 8)), water.material as Material);
    bowlWater.position.y = 2.4;
    const top = new Mesh(keep(new CylinderGeometry(0.16, 0.22, 0.5, 6)), stone);
    top.position.y = 2.65;
    const cup = new Mesh(keep(new CylinderGeometry(0.42, 0.14, 0.2, 7)), darker);
    cup.position.y = FOUNTAIN_TOP - 0.18;
    f.add(basin, rim, water, shaft, bowl, bowlWater, top, cup);
    stage.add(f);
    return water;
  }

  /** Four stone columns round the fountain, each with a gilded ball on top. */
  private buildColumns(keep: Keep) {
    const stone = keep(flat('#e8dcc0'));
    const shadeMat = keep(flat('#c2b08a'));
    const goldMat = keep(flat(GOLD, { emissive: '#5a3c00' }));
    const shaft = keep(new CylinderGeometry(COLUMN_R * 0.72, COLUMN_R * 0.8, 3.2, 8));
    const cap = keep(new CylinderGeometry(COLUMN_R * 1.05, COLUMN_R * 0.72, 0.35, 8));
    const ball = keep(new SphereGeometry(0.3, 7, 5));
    for (const c of COLUMNS) {
      const g = new Group();
      const plinth = box(COLUMN_R * 2, 0.5, COLUMN_R * 2, shadeMat);
      const s = new Mesh(shaft, stone);
      s.position.y = 0.5 + 1.6;
      const cp = new Mesh(cap, stone);
      cp.position.y = 3.85;
      const b = new Mesh(ball, goldMat);
      b.position.y = 4.3;
      g.add(plinth, s, cp, b, blobShadow(COLUMN_R + 0.35, 0.25));
      g.position.set(c.x, 0, c.z);
      this.stage.add(g);
    }
  }

  /** A low-poly golden crown: a band, five points with pearls, gems round the band. */
  private buildCrown(keep: Keep) {
    const g = new Group();
    const gold = keep(new MeshLambertMaterial({ color: GOLD, emissive: '#6a4800', flatShading: true, side: DoubleSide }));
    const gem = keep(new MeshLambertMaterial({ color: '#e8233a', emissive: '#4a0010', flatShading: true }));
    const blue = keep(new MeshLambertMaterial({ color: '#3a6ee8', emissive: '#001a4a', flatShading: true }));
    this.crownMats.push(gold);
    const band = new Mesh(keep(new CylinderGeometry(0.46, 0.4, 0.3, 10, 1, true)), gold);
    band.position.y = 0.15;
    const rim = new Mesh(keep(new TorusGeometry(0.42, 0.05, 4, 12)), gold);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = 0.02;
    g.add(band, rim);
    const point = keep(new ConeGeometry(0.12, 0.36, 4));
    const pearl = keep(new SphereGeometry(0.065, 5, 3));
    const pearlMat = keep(new MeshBasicMaterial({ color: '#fff8e8' }));
    const stone = keep(new OctahedronGeometry(0.07, 0));
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      const p = new Mesh(point, gold);
      p.position.set(Math.cos(a) * 0.44, 0.45, Math.sin(a) * 0.44);
      const pr = new Mesh(pearl, pearlMat);
      pr.position.set(Math.cos(a) * 0.44, 0.66, Math.sin(a) * 0.44);
      const s = new Mesh(stone, k % 2 ? blue : gem);
      const b = a + Math.PI / 5;
      s.position.set(Math.cos(b) * 0.45, 0.15, Math.sin(b) * 0.45);
      g.add(p, pr, s);
    }
    g.scale.setScalar(1.15);
    return g;
  }

  // ---- events -----------------------------------------------------------------------------------

  hide(i: number) {
    const a = this.actors[i];
    if (a) a.model.root.visible = false;
  }

  /** Put everybody back on their spots for a new round. */
  reset(sim: CrownSim) {
    this.actors.forEach((a, i) => {
      const p = sim.players[i];
      a.model.root.visible = !!p && !p.gone;
      a.yaw = p ? Math.atan2(p.fx, p.fz) : 0;
      a.model.body.rotation.set(0, 0, 0);
      a.model.body.position.set(0, 0, 0);
      a.lastDash = -1;
    });
    this.flash = 0;
  }

  events(ev: CrownEvent[], sim: CrownSim) {
    for (const e of ev) {
      switch (e.t) {
        case 'launch':
          this.splash(0, FOUNTAIN_TOP, 0, 14, '#bfe6ff');
          break;
        case 'dash': {
          const a = this.actors[e.p];
          if (a) a.lastDash = this.time;
          const p = sim.players[e.p];
          for (let k = 0; k < 6; k++) this.puffs.spawn(p.x + (Math.random() - 0.5) * 0.6, 0.15, p.z + (Math.random() - 0.5) * 0.6, -p.dx * 2 + (Math.random() - 0.5), 0.8, -p.dz * 2 + (Math.random() - 0.5), 0.3, 0.5, '#e2d3b0');
          break;
        }
        case 'pickup': {
          const p = sim.players[e.p];
          for (let k = 0; k < 16; k++) {
            const a = (k / 16) * Math.PI * 2;
            this.sparks.spawn(p.x, 1.1, p.z, Math.cos(a) * 3, 2 + Math.random() * 2, Math.sin(a) * 3, 0.16, 0.8, k % 3 ? GOLD : '#fff6c0', 0.2);
          }
          this.flash = 1;
          break;
        }
        case 'steal': {
          const p = sim.players[e.from];
          this.shake = Math.min(1, this.shake + 0.55);
          for (let k = 0; k < 18; k++) {
            const a = (k / 18) * Math.PI * 2;
            this.sparks.spawn(p.x, 1.2, p.z, Math.cos(a) * 4, 1 + Math.random() * 3, Math.sin(a) * 4, 0.18, 0.7, k % 2 ? GOLD : '#ffffff', 0.2);
          }
          for (let k = 0; k < 8; k++) this.puffs.spawn(p.x, 0.3, p.z, (Math.random() - 0.5) * 3, 1.2, (Math.random() - 0.5) * 3, 0.35, 0.6, '#e2d3b0');
          break;
        }
        case 'bump':
          this.shake = Math.min(1, this.shake + 0.15);
          break;
        case 'land':
          for (let k = 0; k < 8; k++) {
            const a = (k / 8) * Math.PI * 2;
            this.puffs.spawn(e.x, 0.1, e.z, Math.cos(a) * 1.8, 0.6, Math.sin(a) * 1.8, 0.25, 0.5, '#e8dbbd');
          }
          break;
        case 'drop':
          break;
        default:
          break;
      }
    }
  }

  private splash(x: number, y: number, z: number, n: number, color: string) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      this.puffs.spawn(x, y, z, Math.cos(a) * 2, 2 + Math.random() * 2, Math.sin(a) * 2, 0.2, 0.8, color, 0.5);
    }
  }

  /** Where a world point is on the 1920×1080 stage. */
  toStage(x: number, y: number, z: number) {
    return this.stage.toStage(this.v.set(x, y, z));
  }

  /** Where the label over player i's head goes. */
  headAt(i: number, sim: CrownSim) {
    const p = sim.players[i];
    if (!p) return null;
    return this.toStage(p.x, 3.05, p.z);
  }

  // ---- drawing ----------------------------------------------------------------------------------

  render(sim: CrownSim, dt: number) {
    this.time += dt;
    const t = this.time;
    const c = sim.crown;
    const w = sim.wearer;

    // Pierogi.
    this.actors.forEach((ac, i) => {
      const p = sim.players[i];
      if (!p || p.gone) return;
      const root = ac.model.root;
      const body = ac.model.body;
      root.position.set(p.x, 0, p.z);
      const moving = Math.hypot(p.vx, p.vz);
      const target = moving > 0.3 ? Math.atan2(p.vx, p.vz) : Math.atan2(p.fx, p.fz);
      let d = target - ac.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      ac.yaw += d * Math.min(1, dt * 14);
      root.rotation.y = ac.yaw;
      ac.walk += dt * (6 + moving * 1.6);
      const dashing = p.dash > 0;
      if (p.daze > 0) {
        body.rotation.set(Math.sin(t * 18) * 0.12, 0, Math.sin(t * 9) * 0.25);
        body.position.y = 0;
        ac.stars.visible = true;
        ac.stars.rotation.y = t * 6;
      } else {
        ac.stars.visible = false;
        const hop = moving > 0.5 ? Math.abs(Math.sin(ac.walk)) * 0.14 : 0;
        body.position.y = hop;
        body.rotation.set(dashing ? 0.45 : moving * 0.02, 0, moving > 0.5 ? Math.sin(ac.walk) * 0.08 : Math.sin(t * 2 + i) * 0.03);
      }
      const sq = dashing ? 0.9 : 1;
      body.scale.set(1 / sq, sq, 1 / sq);
      ac.halo.visible = w === i;
      if (w === i) {
        (ac.halo.material as MeshBasicMaterial).opacity = 0.45 + 0.3 * Math.sin(t * 6);
        // Golden sparkles round the wearer.
        if (Math.random() < dt * 14) {
          const a = Math.random() * Math.PI * 2;
          this.sparks.spawn(p.x + Math.cos(a) * 0.7, 0.4 + Math.random() * 0.9, p.z + Math.sin(a) * 0.7, 0, 0.8 + Math.random(), 0, 0.09 + Math.random() * 0.07, 0.7, Math.random() < 0.3 ? '#ffffff' : GOLD, 0.1);
        }
      }
      if (dashing && Math.random() < dt * 30) this.puffs.spawn(p.x, 0.2, p.z, (Math.random() - 0.5) * 0.6, 0.6, (Math.random() - 0.5) * 0.6, 0.22, 0.35, '#e2d3b0');
    });

    // The crown.
    this.spin += dt * (c.state === 'held' ? 0.6 : c.state === 'flying' ? 9 : 2.2);
    const cr = this.crown;
    if (c.state === 'held') {
      const p = sim.players[c.wearer];
      const ac = this.actors[c.wearer];
      const hop = ac ? ac.model.body.position.y * SCALE : 0;
      cr.position.set(p.x, HEAD + hop, p.z);
      cr.rotation.set(ac?.model.body.rotation.x ?? 0, (ac?.yaw ?? 0) + 0.3, Math.sin(t * 3) * 0.06);
      // A fresh wearer's crown flashes while it can't be stolen.
      cr.visible = c.immune <= 0 || Math.floor(t * 12) % 2 === 0;
    } else {
      const bob = c.state === 'loose' ? 0.35 + Math.sin(t * 3) * 0.12 : 0;
      cr.position.set(c.x, c.y + bob, c.z);
      cr.rotation.set(c.state === 'flying' && sim.phase === 'play' ? Math.sin(this.spin) * 0.6 : 0.15, this.spin, 0);
      cr.visible = true;
    }
    this.flash = Math.max(0, this.flash - dt * 2.5);
    this.crownMats[0].emissive.setRGB(0.42 + this.flash * 0.5, 0.28 + this.flash * 0.4, this.flash * 0.3);
    const free = c.state !== 'held';
    this.crownShadow.visible = free;
    this.crownShadow.position.set(c.x, 0.035, c.z);
    const sh = 1 - Math.min(0.6, c.y * 0.12);
    this.crownShadow.scale.set(sh, sh, sh);
    const loose = c.state === 'loose';
    this.beam.visible = loose || (c.state === 'flying' && sim.phase === 'play');
    this.beam.position.set(loose ? c.x : c.tx, 3.5, loose ? c.z : c.tz);
    this.beamMat.opacity = loose ? 0.24 + Math.sin(t * 5) * 0.08 : 0.1;
    this.marker.visible = this.beam.visible;
    this.marker.position.set(this.beam.position.x, 0.04, this.beam.position.z);
    const ms = 1 + 0.15 * Math.sin(t * 6);
    this.marker.scale.set(ms, 1, ms);
    this.markerMat.opacity = loose ? 0.75 : 0.35;
    if (loose && Math.random() < dt * 8) this.sparks.spawn(c.x + (Math.random() - 0.5) * 0.8, 0.3, c.z + (Math.random() - 0.5) * 0.8, 0, 1.2, 0, 0.1, 0.9, GOLD, 0.1);

    // The fountain plays.
    if (Math.random() < dt * 22) {
      const a = Math.random() * Math.PI * 2;
      this.puffs.spawn(Math.cos(a) * 0.35, 2.6, Math.sin(a) * 0.35, Math.cos(a) * 1.3, 1.2 + Math.random() * 0.8, Math.sin(a) * 1.3, 0.11, 0.7, Math.random() < 0.5 ? '#cfeeff' : '#8ccaf0', 0.2);
    }
    this.water.rotation.y = t * 0.15;
    this.banners.forEach((b, k) => (b.rotation.x = Math.sin(t * 1.4 + k * 0.9) * 0.06));
    this.puffs.update(dt);
    this.sparks.update(dt);

    // Camera: the whole courtyard from above the front balustrade.
    const stage = this.stage;
    stage.lookAt(this.v.set(0, 0, 0.6), 31, 0.98);
    if (this.shake > 0.01) {
      stage.camera.position.x += (Math.random() - 0.5) * this.shake * 0.6;
      stage.camera.position.y += (Math.random() - 0.5) * this.shake * 0.6;
      this.shake *= Math.exp(-7 * dt);
    }
    stage.render();
  }

  dispose() {
    this.stage.dispose();
  }
}
