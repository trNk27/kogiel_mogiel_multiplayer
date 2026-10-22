/**
 * Dzwonki in 3D: a wooden highlander belfry (Zakopane style: a steep shingled roof, carved beams, a
 * stone footing) on a meadow below the Tatras at dusk. Four bells hang in it, biggest on the left;
 * Babcia scurries from rope to rope underneath as the tune plays. The players stand in a row in front,
 * each with a little brass handbell. Same PS2 look as the other arena games.
 */
import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  HemisphereLight,
  AmbientLight,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  NearestFilter,
  PlaneGeometry,
  Points,
  PointsMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  TorusGeometry,
  Vector2,
  Vector3,
  type Material,
} from 'three';
import { ArenaStage, box, buildPierogi, flat, groundTexture, nameTag, pixelTexture, noise, type PierogiModel } from '../arena/kit';
import { buildBabcia } from '../arena/babcia';
import { Puffs } from '../arena/puffs';
import { mulberry32 } from '../rng';
import { BELLS, type BellsSim } from './logic';

export interface PlayerLook {
  name: string;
  color: string;
}

type Keep = <T extends { dispose(): void }>(x: T) => T;

/** Where the belfry stands (its middle), and the players' row. */
const BELFRY_Z = -4.2;
const ROW_Z = 3.4;
const SPACING = 2.15;
/** The beam the bells hang from. */
const BEAM_Y = 8.1;
/** Bells along the beam, biggest on the left. */
const BELL_X = [-4.3, -1.45, 1.2, 3.55];
const BELL_R = 1.3;

/** A bell's outer profile (radius, height) from the lip up to the crown, for a bell of radius 1. */
const PROFILE: [number, number][] = [
  [1.0, 0],
  [0.97, 0.09],
  [0.84, 0.2],
  [0.7, 0.45],
  [0.61, 0.8],
  [0.58, 1.06],
  [0.5, 1.26],
  [0.3, 1.36],
  [0.02, 1.39],
];
const BELL_H = 1.39;

interface Bell {
  pivot: Group;
  clapper: Group;
  mat: MeshLambertMaterial;
  halo: Sprite;
  rope: Mesh;
  /** Seconds since it was rung (-1: still). */
  t: number;
  /** How hard (1 the tune, 0.35 a player's echo). */
  power: number;
  size: number;
  base: Color;
}

interface Actor {
  model: PierogiModel;
  tag: Sprite;
  hand: Group;
  color: string;
  x: number;
  /** Seconds since the handbell rang / since going out / since finishing (-1: not). */
  ring: number;
  out: number;
  cheer: number;
}

const smooth = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

/** A soft round glow (drawn additively), for the bells' halos. */
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  const t = new CanvasTexture(c);
  t.magFilter = t.minFilter = NearestFilter;
  t.colorSpace = SRGBColorSpace;
  return t;
}

export class BellsScene {
  readonly stage: ArenaStage;
  private bells: Bell[] = [];
  private actors: Actor[] = [];
  private babcia: PierogiModel;
  private babciaX = 0;
  private babciaTo = 0;
  private babciaHop = -1;
  private puffs = new Puffs(220, -1.2, 1.4);
  private lanterns: MeshBasicMaterial[] = [];
  private firs: Group[] = [];
  private time = 0;
  private shake = 0;

  constructor(canvas: HTMLCanvasElement, looks: PlayerLook[]) {
    this.stage = new ArenaStage(canvas, { sky: '#6d5a8e', fog: [45, 140], fov: 38 });
    const stage = this.stage;
    const keep: Keep = (x) => stage.keep(x);
    this.dusk();
    this.buildSky(keep);
    this.buildMeadow(keep);
    this.buildBelfry(keep);
    this.buildBells(keep);

    this.babcia = buildBabcia(keep, '#2f7a4a');
    this.babcia.root.scale.setScalar(1.25);
    this.babcia.root.position.set(0, 0.35, BELFRY_Z + 0.9);
    stage.add(this.babcia.root);

    stage.add(this.puffs.mesh);
    const hbMat = keep(flat('#e7b43c'));
    const handle = keep(flat('#7a4a26'));
    const hbGeo = keep(new LatheGeometry(PROFILE.map(([r, h]) => new Vector2(r * 0.26, h * 0.26)), 8));
    const handleGeo = keep(new CylinderGeometry(0.05, 0.06, 0.4, 5));
    looks.forEach((l) => {
      const model = buildPierogi(l.color);
      model.mats.forEach((m) => keep(m));
      const tag = nameTag(l.name, l.color);
      tag.position.set(0, 1.75, 0);
      tag.scale.set(2.6, 0.65, 1);
      model.root.add(tag);
      // A little brass handbell held out to the side.
      const hand = new Group();
      const cup = new Mesh(hbGeo, hbMat);
      cup.rotation.x = Math.PI;
      cup.position.y = 0.36;
      const h = new Mesh(handleGeo, handle);
      h.position.y = 0.55;
      hand.add(cup, h);
      hand.position.set(0.98, 0.15, 0.2);
      model.body.add(hand);
      model.root.scale.setScalar(0.85);
      stage.add(model.root);
      this.actors.push({ model, tag, hand, color: l.color, x: 0, ring: -1, out: -1, cheer: -1 });
    });
    this.layout(looks.length);
  }

  // ---- light and sky -------------------------------------------------------------------------------
  private dusk() {
    const s = this.stage;
    s.sun.color.set('#ffb07a');
    s.sun.intensity = 1.25;
    s.sun.position.set(-0.9, 0.45, 0.7);
    s.scene.children.forEach((c) => {
      if (c instanceof HemisphereLight) {
        c.color.set('#c8b8ff');
        c.groundColor.set('#3b3326');
        c.intensity = 1.05;
      } else if (c instanceof AmbientLight) c.intensity = 0.3;
    });
  }

  private buildSky(keep: Keep) {
    const stage = this.stage;
    // A gradient dome: glowing apricot at the horizon, deep blueberry overhead.
    const g = keep(new SphereGeometry(190, 16, 10));
    const pos = g.attributes.position as BufferAttribute;
    const cols = new Float32Array(pos.count * 3);
    const lo = new Color('#ff9f6b');
    const mid = new Color('#a26a9e');
    const hi = new Color('#2a2a63');
    const c = new Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 190;
      if (y < 0.08) c.copy(lo);
      else if (y < 0.3) c.copy(lo).lerp(mid, (y - 0.08) / 0.22);
      else c.copy(mid).lerp(hi, Math.min(1, (y - 0.3) / 0.45));
      cols.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new BufferAttribute(cols, 3));
    const dome = new Mesh(g, keep(new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false, depthWrite: false })));
    dome.renderOrder = -10;
    stage.add(dome);
    // First stars.
    const rnd = mulberry32(41);
    const sp: number[] = [];
    for (let k = 0; k < 90; k++) {
      const a = (rnd() - 0.5) * Math.PI * 1.1;
      const e = 0.32 + rnd() * 0.9;
      sp.push(Math.sin(a) * Math.cos(e) * 170, Math.sin(e) * 170, -Math.cos(a) * Math.cos(e) * 170);
    }
    const sg = keep(new BufferGeometry());
    sg.setAttribute('position', new BufferAttribute(new Float32Array(sp), 3));
    stage.add(new Points(sg, keep(new PointsMaterial({ color: '#fff6dc', size: 2.2, sizeAttenuation: false, fog: false }))));
    // The moon, top right.
    const moon = new Mesh(keep(new SphereGeometry(6, 10, 6)), keep(new MeshBasicMaterial({ color: '#fff1c8', fog: false })));
    moon.position.set(70, 78, -150);
    stage.add(moon);
    // The Tatras: big grey-blue peaks with snow on top.
    const rock = keep(flat('#5c5a86', { fog: true }));
    const snow = keep(flat('#e9e4f4'));
    const peak = keep(new ConeGeometry(1, 1, 5));
    for (const [x, z, r, h] of [
      [-78, -120, 34, 40],
      [-40, -132, 30, 52],
      [-6, -128, 26, 38],
      [28, -136, 36, 58],
      [70, -124, 32, 42],
      [105, -130, 28, 34],
      [-110, -118, 30, 30],
    ] as const) {
      const m = new Mesh(peak, rock);
      m.scale.set(r, h, r * 0.7);
      m.position.set(x, h / 2 - 2, z);
      m.rotation.y = x * 0.13;
      const cap = new Mesh(peak, snow);
      cap.scale.set(r * 0.33, h * 0.33, r * 0.33 * 0.7);
      cap.position.set(x, h - 2 - (h * 0.33) / 2 + 0.4, z);
      cap.rotation.y = m.rotation.y;
      stage.add(m, cap);
    }
  }

  private buildMeadow(keep: Keep) {
    const stage = this.stage;
    const grass = keep(groundTexture('grass', 26, 8));
    const g = keep(new PlaneGeometry(220, 160));
    g.rotateX(-Math.PI / 2);
    const ground = new Mesh(g, keep(flat('#b9c7a0', { map: grass })));
    ground.position.set(0, 0, -40);
    stage.add(ground);
    // A trodden patch of earth where the players stand, and a stone path to the belfry.
    const dirt = keep(groundTexture('sand', 7, 4));
    const pg = keep(new PlaneGeometry(22, 4.2));
    pg.rotateX(-Math.PI / 2);
    const patch = new Mesh(pg, keep(flat('#b49a78', { map: dirt })));
    patch.position.set(0, 0.01, ROW_Z);
    stage.add(patch);
    const stone = keep(flat('#a39a90'));
    const slab = keep(new CylinderGeometry(0.5, 0.55, 0.08, 6));
    for (let k = 0; k < 4; k++) {
      const s = new Mesh(slab, stone);
      s.position.set((k % 2 ? 0.35 : -0.3) + 0, 0.04, BELFRY_Z + 2.4 + k * 0.9);
      s.rotation.y = k;
      stage.add(s);
    }

    // Fir trees round the meadow.
    const firMat = [keep(flat('#2e5a3c')), keep(flat('#26503a')), keep(flat('#3a6a44'))];
    const trunk = keep(flat('#5a3a22'));
    const cone = keep(new ConeGeometry(1, 1, 7));
    const tg = keep(new CylinderGeometry(0.18, 0.24, 1, 5));
    const rnd = mulberry32(7);
    const spots: [number, number][] = [];
    for (let k = 0; k < 26; k++) {
      const side = k % 2 ? 1 : -1;
      const x = side * (11 + rnd() * 26);
      const z = -6 - rnd() * 40;
      spots.push([x, z]);
    }
    spots.push([-14, 0.5], [15, -1], [-17, -3], [18.5, 2.5]);
    for (const [x, z] of spots) {
      const tree = new Group();
      const h = 4 + rnd() * 4;
      const t = new Mesh(tg, trunk);
      t.scale.y = h * 0.25;
      t.position.y = h * 0.125;
      tree.add(t);
      const m = firMat[Math.floor(rnd() * firMat.length)];
      for (let tier = 0; tier < 3; tier++) {
        const c = new Mesh(cone, m);
        const w = (1.6 - tier * 0.38) * (h / 6);
        c.scale.set(w, h * 0.38, w);
        c.position.y = h * (0.3 + tier * 0.22);
        tree.add(c);
      }
      tree.position.set(x, 0, z);
      stage.add(tree);
      this.firs.push(tree);
    }

    // A highlander cottage on the right, with lit windows.
    const logs = keep(
      pixelTexture(
        16,
        (ctx, r) => {
          noise(ctx, r, 16, [132, 84, 48], 18);
          ctx.fillStyle = 'rgba(40,20,8,.55)';
          for (let y = 3; y < 16; y += 4) ctx.fillRect(0, y, 16, 1);
        },
        12,
        3,
      ),
    );
    const cottage = new Group();
    const wall = box(7, 3, 5, keep(flat('#ffffff', { map: logs })));
    const base = box(7.3, 0.6, 5.3, keep(flat('#8f8a82')));
    const roofMat = keep(flat('#ffffff', { map: this.shingles(keep, 4) }));
    const roof = new Mesh(keep(new ConeGeometry(5.6, 5, 4)), roofMat);
    roof.rotation.y = Math.PI / 4;
    roof.scale.set(1, 1, 0.8);
    roof.position.y = 3 + 2.4;
    const glow = new MeshBasicMaterial({ color: '#ffcf6a' });
    keep(glow);
    this.lanterns.push(glow);
    for (const x of [-1.8, 1.8]) {
      const w = box(1.1, 1.1, 0.1, glow);
      w.position.set(x, 1.1, 2.52);
      cottage.add(w);
    }
    cottage.add(base, wall, roof);
    cottage.position.set(15, 0, -15);
    cottage.rotation.y = -0.45;
    stage.add(cottage);
  }

  /** Wooden shingles: rows of little dark-edged tiles, staggered. */
  private shingles(keep: Keep, repeat: number) {
    return keep(
      pixelTexture(
        16,
        (ctx, r) => {
          noise(ctx, r, 16, [118, 74, 44], 22);
          ctx.fillStyle = 'rgba(30,14,6,.6)';
          for (let y = 0; y < 16; y += 4) {
            ctx.fillRect(0, y + 3, 16, 1);
            for (let x = (y / 4) % 2 ? 2 : 0; x < 16; x += 4) ctx.fillRect(x, y, 1, 4);
          }
        },
        21,
        repeat,
      ),
    );
  }

  // ---- the belfry ----------------------------------------------------------------------------------
  private buildBelfry(keep: Keep) {
    const stage = this.stage;
    const belfry = new Group();
    const wood = keep(flat('#8a5530'));
    const dark = keep(flat('#5e3519'));
    const light = keep(flat('#c48a52'));
    const W = 6.4;
    const D = 1.9;
    // A stone footing.
    const stone = keep(
      pixelTexture(
        16,
        (ctx, r) => {
          noise(ctx, r, 16, [150, 142, 132], 30);
          ctx.fillStyle = 'rgba(40,30,25,.45)';
          ctx.fillRect(0, 7, 16, 1);
          ctx.fillRect(0, 15, 16, 1);
          ctx.fillRect(5, 0, 1, 7);
          ctx.fillRect(12, 8, 1, 7);
        },
        5,
        4,
      ),
    );
    const footing = box(W * 2 + 1.2, 0.7, D * 2 + 1.2, keep(flat('#ffffff', { map: stone })));
    belfry.add(footing);
    // Four big corner posts and two middle ones at the front and back.
    const postGeo = keep(new CylinderGeometry(0.28, 0.32, 1, 6));
    for (const x of [-W, 0, W])
      for (const z of [-D, D]) {
        if (x === 0 && z < 0) continue;
        const p = new Mesh(postGeo, wood);
        p.scale.y = BEAM_Y + 0.6;
        p.position.set(x, 0.7 + (BEAM_Y + 0.6) / 2, z);
        belfry.add(p);
      }
    // The bell beam, the top plate and the beams round the top.
    const beam = box(W * 2 + 0.6, 0.45, 0.5, dark);
    beam.position.set(0, BEAM_Y + 0.15, 0);
    belfry.add(beam);
    for (const z of [-D, D]) {
      const top = box(W * 2 + 1.4, 0.5, 0.5, wood);
      top.position.set(0, BEAM_Y + 0.6, z);
      const low = box(W * 2 + 0.6, 0.35, 0.4, wood);
      low.position.set(0, 2.1, z);
      belfry.add(top, low);
    }
    for (const x of [-W, W]) {
      const side = box(0.5, 0.5, D * 2 + 1.4, wood);
      side.position.set(x, BEAM_Y + 0.6, 0);
      belfry.add(side);
    }
    // Carved braces: an X across each side and the back, and curved knees under the front beam.
    const brace = keep(new CylinderGeometry(0.11, 0.11, 1, 4));
    const addBar = (a: Vector3, b: Vector3, mat: Material) => {
      const m = new Mesh(brace, mat);
      m.position.copy(a).add(b).multiplyScalar(0.5);
      m.scale.y = a.distanceTo(b);
      m.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), b.clone().sub(a).normalize());
      belfry.add(m);
    };
    for (const x of [-W, W]) {
      addBar(new Vector3(x, 2.2, -D), new Vector3(x, BEAM_Y + 0.4, D), dark);
      addBar(new Vector3(x, 2.2, D), new Vector3(x, BEAM_Y + 0.4, -D), dark);
    }
    for (const [x0, x1] of [
      [-W, 0],
      [0, W],
    ])
      for (const z of [-D]) {
        addBar(new Vector3(x0, 2.2, z), new Vector3(x1, BEAM_Y + 0.4, z), dark);
        addBar(new Vector3(x1, 2.2, z), new Vector3(x0, BEAM_Y + 0.4, z), dark);
      }
    // Arched knees at the front: little blocks along a curve from each post up to the beam.
    const knee = keep(new CylinderGeometry(0.13, 0.13, 0.5, 4));
    for (const [px, dir] of [
      [-W, 1],
      [0, -1],
      [0, 1],
      [W, -1],
    ] as const) {
      for (let k = 0; k < 6; k++) {
        const a = (k / 5) * (Math.PI / 2);
        const m = new Mesh(knee, light);
        m.position.set(px + dir * (1.25 - Math.cos(a) * 1.25), BEAM_Y + 0.35 - Math.sin(Math.PI / 2 - a) * 1.25 + 0.0, D + 0.05);
        m.rotation.z = dir * (Math.PI / 2 - a);
        belfry.add(m);
      }
    }
    // A carved frieze along the front: a row of little light-and-dark teeth (a highlander zigzag).
    const tooth = keep(new ConeGeometry(0.2, 0.42, 3));
    for (let x = -W - 0.4; x <= W + 0.4; x += 0.45) {
      const t = new Mesh(tooth, Math.round(x / 0.45) % 2 ? light : dark);
      t.rotation.z = Math.PI;
      t.position.set(x, BEAM_Y + 0.2, D + 0.28);
      belfry.add(t);
    }
    // A low balustrade at the front, with turned spindles.
    const spindle = keep(new CylinderGeometry(0.07, 0.1, 1.2, 5));
    for (let x = -W + 0.45; x < W - 0.2; x += 0.55) {
      if (Math.abs(x) < 1.3) continue;
      const s = new Mesh(spindle, light);
      s.position.set(x, 0.7 + 0.6, D + 0.05);
      belfry.add(s);
    }
    const rail = box(W * 2 + 0.4, 0.18, 0.28, wood);
    rail.position.set(0, 0.7 + 1.2, D + 0.05);
    belfry.add(rail);

    // The roof: steep and shingled, with a little lantern tier and a spire.
    const roofMat = keep(flat('#ffffff', { map: this.shingles(keep, 6), side: DoubleSide }));
    const roof = new Mesh(keep(new ConeGeometry(1, 1, 4, 1, true)), roofMat);
    roof.rotation.y = Math.PI / 4;
    roof.scale.set((W + 2.2) * Math.SQRT2, 4.6, (D + 2.0) * Math.SQRT2);
    roof.position.y = BEAM_Y + 0.85 + 2.3;
    belfry.add(roof);
    const eave = box(W * 2 + 3.6, 0.22, D * 2 + 3.4, dark);
    eave.position.y = BEAM_Y + 0.75;
    belfry.add(eave);
    const lantern = box(1.6, 1.3, 1.2, wood);
    lantern.position.y = BEAM_Y + 0.85 + 4.0;
    const lroof = new Mesh(keep(new ConeGeometry(1.5, 2.2, 4)), roofMat);
    lroof.rotation.y = Math.PI / 4;
    lroof.position.y = BEAM_Y + 0.85 + 5.7;
    const spire = new Mesh(keep(new ConeGeometry(0.12, 1.4, 4)), keep(flat('#e7b43c')));
    spire.position.y = BEAM_Y + 0.85 + 7.4;
    const ball = new Mesh(keep(new SphereGeometry(0.22, 6, 4)), keep(flat('#e7b43c')));
    ball.position.y = BEAM_Y + 0.85 + 6.75;
    belfry.add(lantern, lroof, spire, ball);

    // Two lanterns hanging from the front beam.
    const glow = keep(new MeshBasicMaterial({ color: '#ffd27a' }));
    this.lanterns.push(glow);
    for (const x of [-W + 0.1, W - 0.1]) {
      const l = new Mesh(keep(new CylinderGeometry(0.22, 0.26, 0.5, 6)), glow);
      l.position.set(x, BEAM_Y - 1.1, D + 0.45);
      const cap = new Mesh(keep(new ConeGeometry(0.32, 0.25, 6)), dark);
      cap.position.set(x, BEAM_Y - 0.75, D + 0.45);
      const cord = box(0.04, 0.6, 0.04, dark);
      cord.position.set(x, BEAM_Y - 0.66, D + 0.45);
      belfry.add(l, cap, cord);
    }

    belfry.position.set(0, 0, BELFRY_Z);
    stage.add(belfry);
  }

  private buildBells(keep: Keep) {
    const stage = this.stage;
    const geo = keep(new LatheGeometry(PROFILE.map(([r, h]) => new Vector2(r, h)), 10));
    const lip = keep(new TorusGeometry(0.97, 0.07, 4, 10));
    const yokeMat = keep(flat('#5e3519'));
    const iron = keep(flat('#3a3330'));
    const ropeMat = keep(flat('#e3d2a4'));
    const ropeGeo = keep(new CylinderGeometry(0.05, 0.05, 1, 4));
    const halo = keep(glowTexture());
    BELLS.forEach((b, k) => {
      const s = b.size * BELL_R;
      const base = new Color(b.color);
      const mat = keep(new MeshLambertMaterial({ color: base.clone().multiplyScalar(0.85), emissive: base.clone(), emissiveIntensity: 0.12, flatShading: true, side: DoubleSide }));
      const pivot = new Group();
      const bell = new Mesh(geo, mat);
      bell.scale.setScalar(s);
      bell.position.y = -BELL_H * s;
      const l = new Mesh(lip, mat);
      l.rotation.x = Math.PI / 2;
      l.scale.setScalar(s);
      l.position.y = -BELL_H * s + 0.05 * s;
      const yoke = box(1.1 * s + 0.4, 0.35, 0.42, yokeMat);
      yoke.position.y = -0.05;
      pivot.add(bell, l, yoke);
      // The clapper hangs from the crown on its own pivot, so it can lag the swing.
      const clapper = new Group();
      const rod = new Mesh(ropeGeo, iron);
      rod.scale.set(0.8, BELL_H * s * 0.9, 0.8);
      rod.position.y = -BELL_H * s * 0.45;
      const ball = new Mesh(keep(new SphereGeometry(0.17 * s + 0.05, 6, 4)), iron);
      ball.position.y = -BELL_H * s * 0.92;
      clapper.add(rod, ball);
      clapper.position.y = -0.2 * s;
      pivot.add(clapper);
      pivot.position.set(BELL_X[k], BEAM_Y - 0.1, BELFRY_Z);
      stage.add(pivot);
      // The rope, from the yoke down to where Babcia can reach.
      const rope = new Mesh(ropeGeo, ropeMat);
      const top = BEAM_Y - 0.3;
      const bottom = 2.2;
      rope.scale.y = top - bottom;
      rope.position.set(BELL_X[k] + 0.55 * s, (top + bottom) / 2, BELFRY_Z + 0.5);
      stage.add(rope);
      const glow = new Sprite(new SpriteMaterial({ map: halo, color: b.color, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, fog: false }));
      keep(glow.material);
      glow.scale.setScalar(s * 4.2);
      glow.position.set(BELL_X[k], BEAM_Y - BELL_H * s * 0.6, BELFRY_Z + 0.4);
      stage.add(glow);
      this.bells.push({ pivot, clapper, mat, halo: glow, rope, t: -1, power: 0, size: s, base });
    });
  }

  // ---- players ---------------------------------------------------------------------------------------
  private layout(n: number) {
    this.actors.forEach((a, i) => {
      a.x = (i - (n - 1) / 2) * SPACING;
      a.model.root.position.set(a.x, 0, ROW_Z);
    });
  }

  reset(sim: BellsSim) {
    this.actors.forEach((a, i) => {
      const p = sim.players[i];
      a.ring = a.out = a.cheer = -1;
      a.model.body.rotation.set(0, 0, 0);
      a.model.body.scale.set(1, 1, 1);
      a.model.body.position.set(0, 0, 0);
      a.hand.position.set(0.98, 0.15, 0.2);
      a.hand.rotation.set(0, 0, 0);
      a.model.root.position.set(a.x, 0, ROW_Z);
      a.model.root.visible = !p?.gone;
      a.tag.visible = !p?.gone;
    });
    this.bells.forEach((b) => (b.t = -1));
  }

  hide(i: number) {
    const a = this.actors[i];
    if (a) a.model.root.visible = false;
  }

  /** A bell of the tune rings: it swings and glows, and Babcia tugs its rope. */
  ring(bell: number) {
    const b = this.bells[bell];
    if (!b) return;
    b.t = 0;
    b.power = 1;
    this.babciaTo = BELL_X[bell] + 0.55 * b.size - 0.7;
    this.babciaHop = 0;
    this.shake = Math.min(0.5, this.shake + 0.12 * b.size);
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      this.puffs.spawn(BELL_X[bell] + Math.cos(a) * b.size, BEAM_Y - BELL_H * b.size, BELFRY_Z + 0.6 + Math.sin(a) * 0.4, Math.cos(a) * 2.5, 1.5 + Math.random(), Math.sin(a) * 1 + 1.2, 0.18, 1.1, k % 3 ? BELLS[bell].color : '#fff4c8', 0.4);
    }
  }

  /** Player `i` rang `bell` on their phone: their handbell jingles (and the big bell answers faintly). */
  handbell(i: number, bell: number) {
    const a = this.actors[i];
    if (!a) return;
    a.ring = 0;
    const b = this.bells[bell];
    if (b && b.t < 0) {
      b.t = 0.4;
      b.power = 0.25;
    }
    const r = a.model.root.position;
    for (let k = 0; k < 4; k++) this.puffs.spawn(r.x + 0.8, 1.0, r.z + 0.3, (Math.random() - 0.3) * 1.5, 1.6 + Math.random(), (Math.random() - 0.5), 0.13, 0.7, BELLS[bell]?.color ?? '#fff', 0.3);
  }

  /** Player `i` went out: the handbell clonks to the ground and they slump. */
  out(i: number) {
    const a = this.actors[i];
    if (!a || a.out >= 0) return;
    a.out = 0;
    a.cheer = -1;
    this.shake = Math.min(0.6, this.shake + 0.2);
    const r = a.model.root.position;
    for (let k = 0; k < 8; k++) {
      const ang = (k / 8) * Math.PI * 2;
      this.puffs.spawn(r.x + 0.9, 0.2, r.z + 0.2, Math.cos(ang) * 1.6, 0.6, Math.sin(ang) * 1.2, 0.26, 0.6, '#8f8270', 1.2);
    }
  }

  /** Player `i` rang the whole tune right. */
  cheer(i: number) {
    const a = this.actors[i];
    if (!a || a.out >= 0) return;
    a.cheer = 0;
    const r = a.model.root.position;
    for (let k = 0; k < 9; k++) {
      const ang = (k / 9) * Math.PI * 2;
      this.puffs.spawn(r.x, 1.4, r.z, Math.cos(ang) * 2.2, 2.5, Math.sin(ang) * 1.2, 0.17, 0.8, k % 2 ? a.color : '#ffe58a', 0.3);
    }
  }

  /** Where to put the progress dots for player `i`, on the 1920×1080 stage. */
  above(i: number) {
    const a = this.actors[i];
    if (!a) return null;
    return this.stage.toStage(new Vector3(a.x, 2.25, ROW_Z));
  }

  // ---- drawing ---------------------------------------------------------------------------------------
  render(sim: BellsSim, dt: number, repeating: boolean) {
    this.time += dt;
    // Bells: a damped swing, the clapper lagging, and a glow that fades.
    this.bells.forEach((b) => {
      if (b.t < 0) {
        b.pivot.rotation.z = Math.sin(this.time * 0.7 + b.size * 5) * 0.012;
        b.clapper.rotation.z = 0;
        b.mat.emissiveIntensity = 0.12;
        b.halo.material.opacity = 0;
        b.rope.position.y = (BEAM_Y - 0.3 + 2.2) / 2;
        return;
      }
      b.t += dt;
      const w = 7.5 / Math.sqrt(b.size);
      const amp = 0.42 * b.power * Math.exp(-b.t * 1.6);
      b.pivot.rotation.z = Math.sin(b.t * w) * amp;
      b.clapper.rotation.z = -Math.sin(b.t * w - 0.6) * amp * 0.8;
      const g = Math.exp(-b.t * 3.2) * b.power;
      b.mat.emissiveIntensity = 0.12 + 1.3 * g;
      b.halo.material.opacity = 0.9 * g;
      b.halo.scale.setScalar(b.size * (3.6 + 1.2 * g));
      b.rope.position.y = (BEAM_Y - 0.3 + 2.2) / 2 - 0.35 * Math.sin(Math.min(1, b.t / 0.3) * Math.PI) * b.power;
      if (b.t > 4) b.t = -1;
    });

    // Babcia scurries to the rope and tugs it; while everyone rings back she conducts, facing them.
    const bab = this.babcia;
    this.babciaX += (this.babciaTo - this.babciaX) * Math.min(1, dt * 14);
    let hop = 0;
    if (this.babciaHop >= 0) {
      this.babciaHop += dt;
      const t = this.babciaHop / 0.28;
      if (t < 1) hop = Math.sin(t * Math.PI) * 0.45;
      else this.babciaHop = -1;
    }
    if (repeating) {
      this.babciaTo = 0;
      bab.body.rotation.z = Math.sin(this.time * 6) * 0.12;
    } else bab.body.rotation.z = (this.babciaTo - this.babciaX) * -0.12;
    bab.root.position.set(this.babciaX, 0.7 + hop, BELFRY_Z + 0.9);
    bab.body.scale.set(1 + hop * 0.15, 1 - hop * 0.2, 1);

    // Pierogi: a gentle sway, a hop when they finish, a slump when they're out.
    this.actors.forEach((a, i) => {
      const sp = sim.players[i];
      if (!sp || sp.gone) return;
      const body = a.model.body;
      if (a.ring >= 0) {
        a.ring += dt;
        a.hand.rotation.z = Math.sin(a.ring * 30) * 0.5 * Math.exp(-a.ring * 6);
        if (a.ring > 1) a.ring = -1;
      } else if (a.out < 0) a.hand.rotation.z = 0;
      if (a.out >= 0) {
        a.out += dt;
        const t = smooth(a.out / 0.5);
        body.rotation.x = 0.55 * t;
        body.rotation.z = 0.15 * t;
        body.scale.set(1 + 0.08 * t, 1 - 0.2 * t, 1);
        body.position.y = 0;
        // The handbell drops and rolls on the ground.
        const f = Math.min(1, a.out / 0.35);
        a.hand.position.set(0.98 + 0.3 * f, 0.15 - 0.6 * f * f, 0.2 + 0.25 * f);
        a.hand.rotation.z = -1.4 * f;
        return;
      }
      let y = 0;
      if (a.cheer >= 0) {
        a.cheer += dt;
        const t = a.cheer / 0.45;
        if (t < 2) y = Math.abs(Math.sin(t * Math.PI)) * 0.5;
        else a.cheer = -1;
      }
      body.position.y = y;
      body.rotation.x = 0;
      body.rotation.z = Math.sin(this.time * 2.2 + i * 1.3) * 0.05;
      body.scale.set(1, 1 + Math.sin(this.time * 4.4 + i) * 0.015, 1);
    });

    this.firs.forEach((f, k) => (f.rotation.z = Math.sin(this.time * 0.9 + k) * 0.012));
    this.lanterns.forEach((m, k) => m.color.setRGB(1, 0.78 + Math.sin(this.time * 7 + k * 2) * 0.04, 0.42));
    this.puffs.update(dt);

    const stage = this.stage;
    stage.lookAt(new Vector3(0, 5.3, -0.6), 25.5, 0.13);
    if (this.shake > 0.01) {
      stage.camera.position.x += (Math.random() - 0.5) * this.shake * 0.3;
      stage.camera.position.y += (Math.random() - 0.5) * this.shake * 0.3;
      this.shake *= Math.exp(-8 * dt);
    }
    stage.render();
  }

  dispose() {
    this.stage.dispose();
  }
}
