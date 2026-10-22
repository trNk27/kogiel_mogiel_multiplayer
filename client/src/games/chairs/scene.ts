/**
 * Krzesła in 3D: a village wedding hall (wesele). Wooden floor, paper garlands and wycinanki rosettes
 * on the walls, long tables with a wedding cake and a round korowaj loaf, and a little folk band on a
 * stage at the back – an accordion player and a fiddler, who freeze when the music stops. A ring of
 * wooden chairs with white bows stands on a folk rug in the middle. Same PS2 look as the other arena games.
 */
import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  PlaneGeometry,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
  type Material,
} from 'three';
import { ArenaStage, blobShadow, box, buildPierogi, flat, groundTexture, nameTag, pixelTexture, type PierogiModel } from '../arena/kit';
import { dressBabcia } from '../arena/babcia';
import { Puffs } from '../arena/puffs';
import { mulberry32 } from '../rng';
import { keepRadius, yawFor, type ChairsSim } from './logic';

export interface PlayerLook {
  name: string;
  color: string;
}

type Keep = <T extends { dispose(): void }>(x: T) => T;

const PIEROGI_SCALE = 0.6;
const SEAT_Y = 0.5;
const FOLK = ['#d8322a', '#ffc72c', '#2f9e4f', '#3568b8', '#ff7ad1', '#ff8a2a'];

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

interface Actor {
  model: PierogiModel;
  tag: Sprite;
  color: string;
  walk: number;
  face: number;
  /** Seconds since tripping (-1: not). */
  trip: number;
  /** Seconds since sitting down (-1: not seated). */
  sit: number;
  /** Seconds since going out (-1: still in), where from and where to. */
  out: number;
  from: Vector3;
  spot: Vector3;
  /** Seconds since climbing onto the throne (-1: not). */
  win: number;
}

interface ChairMesh {
  g: Group;
  /** Seconds since being taken away (-1: still in the ring). */
  gone: number;
  /** Seconds since it appeared. */
  age: number;
}

interface Musician {
  model: PierogiModel;
  /** Moving parts: the accordion's bellows and right-hand box, or the fiddle bow. */
  part: Group;
  part2?: Group;
}

export class ChairsScene {
  readonly stage: ArenaStage;
  private actors: Actor[] = [];
  private chairs = new Map<number, ChairMesh>();
  private chairParts!: { geo: { seat: BufferGeometry; leg: BufferGeometry; post: BufferGeometry; rail: BufferGeometry; bow: BufferGeometry; knot: BufferGeometry }; wood: Material; dark: Material; ribbon: Material };
  private throne: Group;
  private rug: Mesh;
  private band: Musician[] = [];
  private notes: { s: Sprite; t: number; x: number }[] = [];
  private puffs = new Puffs(200, 8, 1.8);
  private confetti = new Puffs(260, 1.1, 1.2);
  private lamps: Mesh[] = [];
  private beat = 0;
  private time = 0;
  private shake = 0;
  private outCount = 0;

  constructor(canvas: HTMLCanvasElement, looks: PlayerLook[]) {
    this.stage = new ArenaStage(canvas, { sky: '#3a2216', fog: [38, 80], fov: 38 });
    const stage = this.stage;
    const keep: Keep = (x) => stage.keep(x);

    this.buildHall(keep);
    this.rug = this.buildRug(keep);
    this.buildChairParts(keep);
    this.throne = this.buildThrone(keep);
    this.throne.visible = false;
    stage.add(this.throne);
    this.buildBand(keep);
    stage.add(this.puffs.mesh, this.confetti.mesh);

    looks.forEach((l) => {
      const model = buildPierogi(l.color);
      model.mats.forEach((m) => keep(m));
      const tag = nameTag(l.name, l.color);
      tag.position.set(0, 1.75 / PIEROGI_SCALE, 0);
      tag.scale.set(2.6 / PIEROGI_SCALE, 0.65 / PIEROGI_SCALE, 1);
      model.root.scale.setScalar(PIEROGI_SCALE);
      model.root.add(tag);
      stage.add(model.root);
      this.actors.push({ model, tag, color: l.color, walk: 0, face: 0, trip: -1, sit: -1, out: -1, from: new Vector3(), spot: new Vector3(), win: -1 });
    });
  }

  // ---- the hall -------------------------------------------------------------------------------------
  private buildHall(keep: Keep) {
    const stage = this.stage;
    // Floorboards.
    const boards = keep(groundTexture('wood', 18, 4));
    const fg = keep(new PlaneGeometry(60, 40));
    fg.rotateX(-Math.PI / 2);
    const floor = new Mesh(fg, keep(flat('#ffffff', { map: boards })));
    floor.position.set(0, 0, 2);
    stage.add(floor);

    // The back wall: whitewash over a wooden wainscot, with tall windows.
    const wallZ = -10;
    const wall = box(44, 8, 0.4, keep(flat('#f1e3c6')));
    wall.position.z = wallZ;
    const wains = box(44, 1.4, 0.5, keep(flat('#8a5a32')));
    wains.position.z = wallZ + 0.05;
    stage.add(wall, wains);
    for (const s of [-1, 1]) {
      const side = box(0.4, 8, 30, keep(flat('#e9d8b8')));
      side.position.set(s * 15, 0, 4);
      const sw = box(0.5, 1.4, 30, keep(flat('#8a5a32')));
      sw.position.set(s * 14.95, 0, 4);
      stage.add(side, sw);
    }
    const frame = keep(flat('#3568b8'));
    const glow = keep(new MeshBasicMaterial({ color: '#ffe2a0' }));
    for (const x of [-12, -8.5, 8.5, 12]) {
      const f = box(2.2, 3.4, 0.2, frame);
      f.position.set(x, 2.2, wallZ + 0.25);
      const g = box(1.8, 3.0, 0.2, glow);
      g.position.set(x, 2.4, wallZ + 0.32);
      const bar = box(0.12, 3.0, 0.1, frame);
      bar.position.set(x, 2.4, wallZ + 0.44);
      const bar2 = box(1.8, 0.12, 0.1, frame);
      bar2.position.set(x, 3.8, wallZ + 0.44);
      stage.add(f, g, bar, bar2);
    }

    // Wycinanki rosettes on the wall.
    const rosette = (r: number, cols: string[]) => {
      const g = new Group();
      cols.forEach((c, k) => {
        const rr = r * (1 - k / cols.length);
        const m = new Mesh(keep(new CircleGeometry(rr, k % 2 ? 12 : 8)), keep(flat(c)));
        m.position.z = k * 0.02;
        m.rotation.z = k * 0.2;
        g.add(m);
      });
      return g;
    };
    for (const [x, y, r, c] of [
      [-5, 5.6, 0.9, ['#2f9e4f', '#d8322a', '#ffc72c', '#3568b8', '#fff4dc']],
      [5, 5.6, 0.9, ['#d8322a', '#2f9e4f', '#ffc72c', '#ff7ad1', '#fff4dc']],
      [0, 6.6, 0.75, ['#3568b8', '#ffc72c', '#d8322a', '#fff4dc']],
      [-10.3, 5.8, 0.6, ['#ff8a2a', '#2f9e4f', '#fff4dc']],
      [10.3, 5.8, 0.6, ['#ff8a2a', '#3568b8', '#fff4dc']],
    ] as const) {
      const ro = rosette(r, [...c]);
      ro.position.set(x, y, wallZ + 0.22);
      stage.add(ro);
    }

    // Paper garlands: strings of little flags, sagging between nails.
    const tri = keep(new BufferGeometry());
    tri.setAttribute('position', new Float32BufferAttribute([-0.18, 0, 0, 0.18, 0, 0, 0, -0.38, 0], 3));
    tri.computeVertexNormals();
    const flagMats = FOLK.map((c) => keep(flat(c, { side: 2 })));
    const string = keep(flat('#5a3418'));
    const garland = (a: Vector3, b: Vector3, sag: number, seed: number) => {
      const steps = Math.round(a.distanceTo(b) / 0.45);
      const rnd = mulberry32(seed);
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        const p = a.clone().lerp(b, t);
        p.y -= Math.sin(t * Math.PI) * sag;
        const f = new Mesh(tri, flagMats[Math.floor(rnd() * flagMats.length)]);
        f.position.copy(p);
        f.rotation.y = Math.atan2(b.x - a.x, b.z - a.z) - Math.PI / 2;
        stage.add(f);
        if (k < steps) {
          const q = a.clone().lerp(b, (k + 0.5) / steps);
          q.y -= Math.sin(((k + 0.5) / steps) * Math.PI) * sag;
          const s = box(0.03, 0.03, 0.47, string);
          s.position.copy(q);
          s.position.y -= 0.015;
          s.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
          stage.add(s);
        }
      }
    };
    garland(new Vector3(-14.5, 7, wallZ + 0.4), new Vector3(-1, 7, wallZ + 0.4), 1.1, 3);
    garland(new Vector3(1, 7, wallZ + 0.4), new Vector3(14.5, 7, wallZ + 0.4), 1.1, 4);
    garland(new Vector3(-14.5, 6.6, -9), new Vector3(-14.5, 6.6, 6), 1.3, 5);
    garland(new Vector3(14.5, 6.6, -9), new Vector3(14.5, 6.6, 6), 1.3, 6);
    garland(new Vector3(-14.5, 6.8, -8.5), new Vector3(14.5, 6.8, -8.5), 2.2, 7);

    // The stage at the back, for the band.
    const stageBox = box(9, 0.7, 3.4, keep(flat('#7a4a26')));
    stageBox.position.set(0, 0, -8);
    const edge = box(9.1, 0.18, 0.2, keep(flat('#d8322a')));
    edge.position.set(0, 0.6, -6.3);
    stage.add(stageBox, edge);
    // A woven runner along the stage front.
    for (let k = 0; k < 9; k++) {
      const d = box(0.5, 0.25, 0.05, flagMats[k % flagMats.length]);
      d.position.set(-4 + k, 0.2, -6.28);
      stage.add(d);
    }

    // Long tables down both sides, under white cloths.
    const cloth = keep(flat('#fbf6ea'));
    const lace = keep(flat('#d8322a'));
    const plate = keep(new CylinderGeometry(0.28, 0.24, 0.05, 10));
    const plateMat = keep(flat('#ffffff'));
    const bottle = keep(new CylinderGeometry(0.1, 0.12, 0.6, 6));
    const bottleMat = keep(flat('#3d7a3a'));
    const candle = keep(new CylinderGeometry(0.06, 0.06, 0.4, 5));
    const candleMat = keep(flat('#fff4dc'));
    const flameGeo = keep(new SphereGeometry(0.07, 4, 3));
    const flameMat = keep(new MeshBasicMaterial({ color: '#ffcf4a' }));
    for (const s of [-1, 1]) {
      const t = box(2.2, 0.85, 12, cloth);
      t.position.set(s * 11, 0, -1);
      const band = box(2.24, 0.12, 12.04, lace);
      band.position.set(s * 11, 0.62, -1);
      stage.add(t, band);
      for (let k = 0; k < 6; k++) {
        const z = -6 + k * 2;
        for (const dx of [-0.55, 0.55]) {
          const p = new Mesh(plate, plateMat);
          p.position.set(s * 11 + dx, 0.88, z);
          stage.add(p);
        }
        if (k % 2 === 0) {
          const b = new Mesh(bottle, bottleMat);
          b.position.set(s * 11, 1.15, z + 1);
          stage.add(b);
        } else {
          const c = new Mesh(candle, candleMat);
          c.position.set(s * 11, 1.05, z + 1);
          const fl = new Mesh(flameGeo, flameMat);
          fl.position.set(s * 11, 1.32, z + 1);
          fl.scale.y = 1.6;
          this.lamps.push(fl);
          stage.add(c, fl);
        }
      }
      // Benches.
      const bench = box(0.6, 0.45, 11, keep(flat('#8a5a32')));
      bench.position.set(s * 9.4, 0, -1);
      stage.add(bench);
    }
    // The wedding cake on the right table: three tiers with pink icing and a little couple on top.
    const cake = new Group();
    const icing = keep(flat('#fff8ef'));
    const pink = keep(flat('#ff9fc8'));
    [0.75, 0.55, 0.35].forEach((r, k) => {
      const tier = new Mesh(keep(new CylinderGeometry(r, r, 0.42, 12)), icing);
      tier.position.y = 0.21 + k * 0.42;
      const trim = new Mesh(keep(new TorusGeometry(r, 0.05, 4, 14)), pink);
      trim.rotation.x = Math.PI / 2;
      trim.position.y = 0.42 + k * 0.42;
      cake.add(tier, trim);
    });
    const topper = new Mesh(keep(new SphereGeometry(0.14, 6, 4)), keep(flat('#ffd23f')));
    topper.position.set(-0.09, 1.38, 0);
    const topper2 = new Mesh(keep(new SphereGeometry(0.14, 6, 4)), keep(flat('#3568b8')));
    topper2.position.set(0.09, 1.38, 0);
    cake.add(topper, topper2);
    cake.position.set(11, 0.86, -3.2);
    stage.add(cake);
    // The korowaj (wedding loaf) on the left table.
    const crust = keep(flat('#c88a3c'));
    const loaf = new Mesh(keep(new SphereGeometry(0.7, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2)), crust);
    loaf.scale.y = 0.6;
    loaf.position.set(-11, 0.86, -3.2);
    const braid = new Mesh(keep(new TorusGeometry(0.62, 0.1, 4, 14)), keep(flat('#a8702c')));
    braid.rotation.x = Math.PI / 2;
    braid.position.set(-11, 0.95, -3.2);
    stage.add(loaf, braid);
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      const b = new Mesh(keep(new SphereGeometry(0.1, 5, 3)), keep(flat(FOLK[k])));
      b.position.set(-11 + Math.cos(a) * 0.35, 1.25, -3.2 + Math.sin(a) * 0.35);
      stage.add(b);
    }
  }

  /** A round folk rug where the chairs stand: the "inside the ring" you must keep out of. */
  private buildRug(keep: Keep) {
    const tex = keep(
      pixelTexture(64, (ctx) => {
        const c = 32;
        const ring = (r: number, col: string) => {
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.arc(c, c, r, 0, Math.PI * 2);
          ctx.fill();
        };
        ring(32, '#8e1f22');
        ring(29, '#c8352e');
        ring(26, '#2a120a');
        ring(25, '#e8b03a');
        ring(21, '#c8352e');
        for (let k = 0; k < 16; k++) {
          const a = (k / 16) * Math.PI * 2;
          ctx.fillStyle = k % 2 ? '#2f9e4f' : '#fff4dc';
          ctx.fillRect(Math.round(c + Math.cos(a) * 27.5) - 1, Math.round(c + Math.sin(a) * 27.5) - 1, 2, 2);
        }
        ring(14, '#e8b03a');
        ring(11, '#2f9e4f');
        ring(6, '#fff4dc');
      }, 2),
    );
    tex.repeat.set(1, 1);
    const g = keep(new CircleGeometry(1, 28));
    g.rotateX(-Math.PI / 2);
    const rug = new Mesh(g, keep(flat('#ffffff', { map: tex, transparent: true })));
    rug.position.y = 0.015;
    this.stage.add(rug);
    return rug;
  }

  private buildChairParts(keep: Keep) {
    const seat = keep(new BoxGeometry(0.6, 0.09, 0.56));
    seat.translate(0, -0.045, 0);
    this.chairParts = {
      geo: {
        seat,
        leg: keep(new CylinderGeometry(0.035, 0.03, 0.46, 5)),
        post: keep(new CylinderGeometry(0.035, 0.035, 0.6, 5)),
        rail: keep(new BoxGeometry(0.62, 0.14, 0.06)),
        bow: keep(new SphereGeometry(0.1, 5, 3)),
        knot: keep(new SphereGeometry(0.06, 4, 3)),
      },
      wood: keep(flat('#b8783e')),
      dark: keep(flat('#8a5228')),
      ribbon: keep(flat('#fff8ef')),
    };
  }

  /** A wooden chair facing +z: seat, four legs, a back with two rails and a white bow. */
  private buildChair(): Group {
    const { geo, wood, dark, ribbon } = this.chairParts;
    const g = new Group();
    const seat = new Mesh(geo.seat, wood);
    seat.position.y = SEAT_Y;
    g.add(seat);
    for (const [x, z] of [
      [-0.25, -0.22],
      [0.25, -0.22],
      [-0.25, 0.22],
      [0.25, 0.22],
    ]) {
      const l = new Mesh(geo.leg, dark);
      l.position.set(x, 0.23, z);
      g.add(l);
    }
    for (const x of [-0.27, 0.27]) {
      const p = new Mesh(geo.post, dark);
      p.position.set(x, SEAT_Y + 0.3, -0.25);
      g.add(p);
    }
    for (const y of [0.78, 1.02]) {
      const r = new Mesh(geo.rail, wood);
      r.position.set(0, SEAT_Y + y - 0.5 - 0.07, -0.25);
      g.add(r);
    }
    for (const x of [-0.1, 0.1]) {
      const b = new Mesh(geo.bow, ribbon);
      b.position.set(x, SEAT_Y + 0.52, -0.21);
      b.scale.set(1.2, 0.7, 0.5);
      g.add(b);
    }
    const k = new Mesh(geo.knot, ribbon);
    k.position.set(0, SEAT_Y + 0.52, -0.19);
    g.add(k);
    const sh = blobShadow(0.42, 0.25);
    g.add(sh);
    return g;
  }

  /** The winner's throne: a big gilded chair with a red cushion and a crown on its back. */
  private buildThrone(keep: Keep): Group {
    const g = new Group();
    const gold = keep(flat('#e8b830'));
    const red = keep(flat('#c8202e'));
    const seat = box(1.3, 0.7, 1.2, gold);
    const cushion = box(1.1, 0.16, 1.0, red);
    cushion.position.y = 0.72;
    const back = box(1.3, 1.9, 0.22, gold);
    back.position.set(0, 0.7, -0.5);
    const backRed = box(0.9, 1.4, 0.05, red);
    backRed.position.set(0, 0.95, -0.37);
    g.add(seat, cushion, back, backRed);
    for (const s of [-1, 1]) {
      const arm = box(0.2, 0.4, 1.1, gold);
      arm.position.set(s * 0.65, 0.7, 0.05);
      g.add(arm);
    }
    const spike = keep(new ConeGeometry(0.16, 0.45, 4));
    for (const x of [-0.5, 0, 0.5]) {
      const c = new Mesh(spike, gold);
      c.position.set(x, 2.8 + (x === 0 ? 0.12 : 0), -0.5);
      g.add(c);
      const gem = new Mesh(keep(new SphereGeometry(0.08, 5, 3)), x === 0 ? red : keep(flat('#3568b8')));
      gem.position.set(x, 2.45, -0.38);
      g.add(gem);
    }
    g.add(blobShadow(1.0, 0.35));
    return g;
  }

  /** The band: an accordion player in a black felt hat and a fiddler in a red cap. */
  private buildBand(keep: Keep) {
    const stage = this.stage;
    const y0 = 0.7;
    // Accordion player.
    {
      const m = buildPierogi('#f4d9b5');
      m.mats.forEach((x) => keep(x));
      const hatMat = keep(flat('#1d1410'));
      const brim = new Mesh(keep(new CylinderGeometry(0.75, 0.75, 0.06, 12)), hatMat);
      brim.position.set(0, 0.86, 0);
      const crown = new Mesh(keep(new CylinderGeometry(0.42, 0.46, 0.34, 10)), hatMat);
      crown.position.set(0, 1.05, 0);
      const band = new Mesh(keep(new CylinderGeometry(0.47, 0.47, 0.08, 10)), keep(flat('#d8322a')));
      band.position.set(0, 0.93, 0);
      const flower = new Mesh(keep(new SphereGeometry(0.09, 5, 3)), keep(flat('#ffc72c')));
      flower.position.set(0.42, 0.98, 0.15);
      // A moustache.
      const tache = new Mesh(keep(new SphereGeometry(0.16, 6, 3)), keep(flat('#3a2014')));
      tache.scale.set(1.6, 0.4, 0.5);
      tache.position.set(0, 0.24, 0.32);
      m.body.add(brim, crown, band, flower, tache);
      // The accordion: two red boxes with the bellows between, held in front.
      const acc = new Group();
      const redBox = keep(flat('#b8202a'));
      const keys = keep(flat('#fff8ef'));
      const left = box(0.22, 0.62, 0.42, redBox);
      left.position.set(-0.42, -0.31, 0);
      const right = new Group();
      const rb = box(0.22, 0.62, 0.42, redBox);
      rb.position.y = -0.31;
      const kb = box(0.05, 0.5, 0.3, keys);
      kb.position.set(0.12, -0.25, 0);
      right.add(rb, kb);
      right.position.x = 0.42;
      const bellows = new Group();
      for (let k = 0; k < 7; k++) {
        const pleat = box(0.09, 0.56, 0.4, k % 2 ? keep(flat('#1d1410')) : keep(flat('#f4ecdc')));
        pleat.position.set(-0.27 + k * 0.09, -0.28, 0);
        bellows.add(pleat);
      }
      acc.add(left, right, bellows);
      acc.position.set(0, 0.62, 0.42);
      m.body.add(acc);
      m.root.scale.setScalar(1.25);
      m.root.position.set(-1.7, y0, -7.9);
      m.root.rotation.y = 0.25;
      stage.add(m.root);
      this.band.push({ model: m, part: bellows, part2: right });
    }
    // Fiddler.
    {
      const m = buildPierogi('#f4d9b5');
      m.mats.forEach((x) => keep(x));
      dressBabcia(m, keep, '#2f9e4f');
      const wood = keep(flat('#8a3e1a'));
      const fiddle = new Group();
      const bodyF = box(0.32, 0.12, 0.5, wood);
      bodyF.position.y = -0.06;
      const neck = box(0.07, 0.06, 0.45, keep(flat('#2a120a')));
      neck.position.set(0, 0, 0.45);
      fiddle.add(bodyF, neck);
      fiddle.position.set(0.55, 0.55, 0.3);
      fiddle.rotation.set(0.3, -0.6, 0.5);
      const bow = new Group();
      const stick = box(0.03, 0.03, 1.1, keep(flat('#e9d7a8')));
      stick.position.y = -0.015;
      bow.add(stick);
      bow.position.set(0.35, 0.65, 0.55);
      bow.rotation.set(0, 0.9, 0.2);
      m.body.add(fiddle, bow);
      m.root.scale.setScalar(1.2);
      m.root.position.set(1.7, y0, -7.9);
      m.root.rotation.y = -0.25;
      stage.add(m.root);
      this.band.push({ model: m, part: bow });
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
    ctx.fillStyle = '#ffd23f';
    ctx.fillText('♪', 16, 17);
    const t = keep(new CanvasTexture(c));
    t.magFilter = t.minFilter = NearestFilter;
    t.colorSpace = SRGBColorSpace;
    const mat = keep(new SpriteMaterial({ map: t, transparent: true }));
    for (let k = 0; k < 7; k++) {
      const s = new Sprite(mat.clone());
      keep(s.material);
      s.scale.set(0.7, 0.7, 1);
      s.visible = false;
      stage.add(s);
      this.notes.push({ s, t: -1, x: 0 });
    }
  }

  // ---- round flow ---------------------------------------------------------------------------------
  reset(sim: ChairsSim) {
    for (const c of this.chairs.values()) this.stage.world.remove(c.g);
    this.chairs.clear();
    this.throne.visible = false;
    this.outCount = 0;
    this.actors.forEach((a, i) => {
      const p = sim.players[i];
      a.trip = a.sit = a.out = a.win = -1;
      a.face = p?.face ?? 0;
      a.model.body.rotation.set(0, 0, 0);
      a.model.body.scale.set(1, 1, 1);
      a.model.body.position.set(0, 0, 0);
      a.model.root.visible = !p?.gone;
      a.model.shadow.visible = true;
      a.tag.visible = true;
      a.tag.material.opacity = 1;
    });
    this.syncChairs(sim, 0, true);
  }

  hide(i: number) {
    const a = this.actors[i];
    if (a) a.model.root.visible = false;
  }

  tripped(i: number) {
    const a = this.actors[i];
    if (!a) return;
    a.trip = 0;
    const r = a.model.root.position;
    for (let k = 0; k < 7; k++) this.puffs.spawn(r.x, 0.2, r.z, (Math.random() - 0.5) * 2.5, 1 + Math.random() * 1.5, (Math.random() - 0.5) * 2.5, 0.22, 0.5, '#e6cf9f');
  }

  sat(i: number) {
    const a = this.actors[i];
    if (!a) return;
    a.sit = 0;
    a.trip = -1;
    const r = a.model.root.position;
    for (let k = 0; k < 8; k++) {
      const ang = (k / 8) * Math.PI * 2;
      this.puffs.spawn(r.x, 0.5, r.z, Math.cos(ang) * 2, 1.5, Math.sin(ang) * 2, 0.16, 0.5, k % 2 ? a.color : '#fff4dc');
    }
  }

  /** The ones left standing tumble off to the side of the stage, to watch. */
  wentOut(idx: number[]) {
    for (const i of idx) {
      const a = this.actors[i];
      if (!a) continue;
      a.out = 0;
      a.trip = -1;
      a.from.copy(a.model.root.position);
      const k = this.outCount++;
      const side = k % 2 ? 1 : -1;
      a.spot.set(side * (5.6 + Math.floor(k / 2) * 1.15), 0, -5.7);
      this.shake = Math.min(0.8, this.shake + 0.3);
      for (let j = 0; j < 10; j++) this.puffs.spawn(a.from.x, 0.3, a.from.z, (Math.random() - 0.5) * 4, 2 + Math.random() * 2, (Math.random() - 0.5) * 4, 0.26, 0.7, j % 2 ? a.color : '#e6cf9f');
    }
  }

  /** The music stopped for real. */
  stopped() {
    this.shake = Math.min(0.8, this.shake + 0.45);
  }

  /** Round over: the winner climbs onto the throne. */
  crown(winners: number[]) {
    this.throne.visible = true;
    this.throne.position.set(0, -2, 0);
    for (const c of this.chairs.values()) if (c.gone < 0) c.gone = 0;
    winners.slice(0, 1).forEach((i) => {
      const a = this.actors[i];
      if (!a) return;
      a.win = 0;
      a.sit = -1;
      a.trip = -1;
      a.from.copy(a.model.root.position);
    });
  }

  toStage(x: number, y: number, z: number) {
    return this.stage.toStage(new Vector3(x, y, z));
  }

  // ---- drawing --------------------------------------------------------------------------------------
  private syncChairs(sim: ChairsSim, dt: number, snap = false) {
    const ids = new Set(sim.chairs.map((c) => c.id));
    for (const c of sim.chairs) {
      let m = this.chairs.get(c.id);
      if (!m) {
        m = { g: this.buildChair(), gone: -1, age: snap ? 9 : 0 };
        m.g.position.set(c.x, 0, c.z);
        m.g.rotation.y = yawFor(c.a);
        this.chairs.set(c.id, m);
        this.stage.add(m.g);
      }
      m.age += dt;
      const k = snap ? 1 : 1 - Math.exp(-6 * dt);
      m.g.position.x += (c.x - m.g.position.x) * k;
      m.g.position.z += (c.z - m.g.position.z) * k;
      m.g.rotation.y = lerpAngle(m.g.rotation.y, yawFor(c.a), k);
      const pop = Math.min(1, m.age / 0.3);
      if (m.gone < 0) m.g.scale.setScalar(0.4 + 0.6 * pop);
    }
    for (const [id, m] of this.chairs) {
      if (!ids.has(id) && m.gone < 0) {
        m.gone = 0;
        const p = m.g.position;
        for (let k = 0; k < 10; k++) this.puffs.spawn(p.x, 0.5, p.z, (Math.random() - 0.5) * 3, 1 + Math.random() * 2, (Math.random() - 0.5) * 3, 0.3, 0.6, '#f4ecdc');
      }
      if (m.gone >= 0) {
        // Whisked up and away.
        m.gone += dt;
        m.g.position.y = m.gone * m.gone * 9;
        m.g.rotation.z = m.gone * 6;
        m.g.scale.setScalar(Math.max(0.01, 1 - m.gone * 1.4));
        if (m.gone > 0.75) {
          this.stage.world.remove(m.g);
          this.chairs.delete(id);
        }
      }
    }
  }

  render(sim: ChairsSim, dt: number, _winners: number[], eighth: number) {
    this.time += dt;
    const playing = sim.musicOn;
    if (playing) this.beat += dt / (eighth * 2);
    const beat = this.beat;
    const pulse = Math.abs(Math.sin(beat * Math.PI));

    if (sim.phase !== 'done') this.syncChairs(sim, dt);
    else this.syncChairs({ chairs: [] } as unknown as ChairsSim, dt);

    // The rug grows and shrinks with the ring.
    const rugR = keepRadius(sim.chairs.length) - 0.15;
    const rs = this.rug.scale.x + (rugR - this.rug.scale.x) * (1 - Math.exp(-4 * dt));
    this.rug.scale.set(rs, 1, rs);

    // The band: swaying and squeezing while they play, frozen mid-note when they stop.
    this.band.forEach((b, k) => {
      const body = b.model.body;
      body.position.y = pulse * 0.08;
      body.rotation.z = Math.sin(beat * Math.PI * 0.5 + k) * 0.08;
      body.rotation.x = -pulse * 0.04;
      if (k === 0) {
        const s = 1 + 0.35 * Math.sin(beat * Math.PI * 0.5);
        b.part.scale.x = s;
        if (b.part2) b.part2.position.x = 0.42 * s;
      } else {
        b.part.position.x = 0.35 + Math.sin(beat * Math.PI) * 0.28;
        b.part.position.z = 0.55 - Math.sin(beat * Math.PI) * 0.18;
      }
    });
    // Notes float up while they play.
    this.notes.forEach((n, k) => {
      if (n.t < 0) {
        if (playing && Math.random() < dt * 1.4) {
          n.t = 0;
          n.x = (k % 2 ? 1.7 : -1.7) + (Math.random() - 0.5) * 0.8;
        }
        n.s.visible = false;
        return;
      }
      n.t += dt;
      const life = n.t / 1.8;
      if (life >= 1) {
        n.t = -1;
        n.s.visible = false;
        return;
      }
      n.s.visible = true;
      n.s.position.set(n.x + Math.sin(n.t * 4 + k) * 0.25, 2.6 + n.t * 1.6, -7.6);
      (n.s.material as SpriteMaterial).opacity = playing ? 1 - life : Math.max(0, 1 - life * 3);
    });
    this.lamps.forEach((l, k) => (l.scale.set(1 + Math.sin(this.time * 13 + k) * 0.15, 1.6 + Math.sin(this.time * 9 + k * 2) * 0.3, 1)));

    // The throne rises from the floor.
    if (this.throne.visible) {
      const y = this.throne.position.y;
      this.throne.position.y = y + (0 - y) * (1 - Math.exp(-5 * dt));
      if (Math.random() < dt * 40) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * 2.5;
        this.confetti.spawn(Math.cos(a) * r, 5 + Math.random(), Math.sin(a) * r, (Math.random() - 0.5) * 1.5, 0, (Math.random() - 0.5) * 1.5, 0.12, 3.5, FOLK[Math.floor(Math.random() * FOLK.length)], 0);
      }
    }

    // Pierogi.
    this.actors.forEach((ac, i) => {
      const sp = sim.players[i];
      if (!sp || sp.gone) return;
      const root = ac.model.root;
      const body = ac.model.body;
      if (ac.win >= 0) {
        ac.win += dt;
        const t = smooth(ac.win / 0.9);
        const tx = this.throne.position;
        root.position.set(ac.from.x + (tx.x - ac.from.x) * t, Math.sin(t * Math.PI) * 1.5 + t * (0.86 + tx.y), ac.from.z + (tx.z - ac.from.z) * t);
        ac.face = lerpAngle(ac.face, 0, 1 - Math.exp(-6 * dt));
        root.rotation.y = ac.face;
        const cheer = Math.abs(Math.sin(this.time * 6));
        body.scale.set(1 + cheer * 0.06, 1 - cheer * 0.06 + 0.05, 1);
        body.rotation.set(0, 0, Math.sin(this.time * 3) * 0.08);
        root.scale.setScalar(PIEROGI_SCALE * (1 + 0.25 * t));
        ac.model.shadow.visible = false;
        return;
      }
      root.scale.setScalar(PIEROGI_SCALE);
      if (ac.out >= 0) {
        // Tumble off in a big arc, spinning, to the side of the stage – then watch, glumly.
        ac.out += dt;
        const t = smooth(ac.out / 1.1);
        root.position.set(ac.from.x + (ac.spot.x - ac.from.x) * t, Math.sin(t * Math.PI) * 2.6, ac.from.z + (ac.spot.z - ac.from.z) * t);
        if (ac.out < 1.1) {
          body.rotation.x = t * Math.PI * 4;
          ac.model.shadow.visible = false;
        } else {
          body.rotation.x = 0.25;
          ac.model.shadow.visible = true;
        }
        ac.face = lerpAngle(ac.face, 0, 1 - Math.exp(-5 * dt));
        root.rotation.y = ac.face;
        body.scale.set(1.05, 0.9, 1);
        body.rotation.z = Math.sin(this.time * 1.5 + i) * 0.05;
        ac.tag.material.opacity = 0.55;
        return;
      }
      if (sp.seat >= 0) {
        // On the chair, facing out.
        if (ac.sit < 0) ac.sit = 0.3;
        ac.sit += dt;
        root.position.set(sp.x, SEAT_Y, sp.z);
        ac.face = lerpAngle(ac.face, sp.face, 1 - Math.exp(-14 * dt));
        root.rotation.y = ac.face;
        const t = ac.sit / 0.25;
        const sq = t < 1 ? Math.sin(t * Math.PI) : 0;
        body.scale.set(1 + 0.25 * sq, 1 - 0.3 * sq, 1 + 0.25 * sq);
        body.rotation.set(0, 0, Math.sin(this.time * 2 + i) * 0.04);
        ac.model.shadow.visible = false;
        return;
      }
      ac.sit = -1;
      ac.model.shadow.visible = true;
      const speed = Math.hypot(sp.vx, sp.vz) + (playing ? 1.2 : 0);
      if (sp.stun > 0) {
        // Flat on their face, with a dizzy wobble.
        if (ac.trip < 0) ac.trip = 0;
        ac.trip += dt;
        const t = smooth(ac.trip / 0.25);
        body.rotation.x = t * 1.35;
        body.rotation.z = Math.sin(ac.trip * 9) * 0.1;
        body.position.y = 0;
        body.scale.set(1, 1, 1);
        if (Math.random() < dt * 6) this.puffs.spawn(sp.x + (Math.random() - 0.5) * 0.5, 0.7, sp.z, 0, 0.8, 0, 0.12, 0.5, '#fff4c8');
      } else {
        ac.trip = -1;
        ac.walk += dt * (2 + speed * 2.4);
        const w = Math.min(1, speed / 3);
        body.rotation.x = 0;
        body.rotation.z = Math.sin(ac.walk) * 0.13 * w;
        body.position.y = Math.abs(Math.sin(ac.walk)) * 0.12 * w + (playing ? pulse * 0.05 : 0);
        body.scale.set(1, 1, 1);
      }
      ac.face = lerpAngle(ac.face, sp.face, 1 - Math.exp(-10 * dt));
      root.rotation.y = ac.face;
      root.position.set(sp.x, 0, sp.z);
      ac.tag.material.opacity = 1;
    });

    this.puffs.update(dt);
    this.confetti.update(dt);

    const stage = this.stage;
    stage.lookAt(new Vector3(0, 0.4, -1.3), 21.5, 0.82);
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
