/**
 * Babcia’s Cookbook in 3D: a giant open recipe book on a kitchen table. The right-hand page is the
 * arena; the left-hand page swings over the spine and slams down on it. Same PS2 look as the other
 * arena games (low internal resolution, flat shading, tiny nearest-filtered textures).
 */
import {
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  Path,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector2,
  Vector3,
  type Material,
  type Sprite,
} from 'three';
import { ArenaStage, buildPierogi, flat, nameTag, type PierogiModel } from '../arena/kit';
import { PIEROGI_PATH } from '../../lib/art';
import { mulberry32 } from '../rng';
import {
  PAGE_D,
  PAGE_HALF_D,
  PAGE_W,
  RETURN_TIME,
  holeAt,
  holeContains,
  holePolygon,
  pageAngle,
  unitOutline,
  type CookbookSim,
  type Hole,
  type PageSpec,
} from './logic';

/** Height of the top of the pages above the table-cloth. */
const PAGE_T = 0.15;
const STACK_T = 0.7;
const TABLE_Y = -1.25;
const FOOT_Y = PAGE_T + 0.02;

const smooth = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

// ---- textures ------------------------------------------------------------------------------------
type Paint = (ctx: CanvasRenderingContext2D, w: number, h: number, rnd: () => number) => void;

function paperTexture(paint: Paint, seed: number, back?: Paint) {
  const w = 256;
  const h = 176;
  const c = document.createElement('canvas');
  c.width = back ? w * 2 : w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  [paint, back].forEach((fn, side) => {
    if (!fn) return;
    const rnd = mulberry32(seed + side * 101);
    ctx.save();
    ctx.translate(side * w, 0);
    // Old paper with a little grain.
    for (let y = 0; y < h; y += 2)
      for (let x = 0; x < w; x += 2) {
        const v = (rnd() - 0.5) * 9;
        ctx.fillStyle = `rgb(${244 + v},${230 + v},${196 + v * 0.7})`;
        ctx.fillRect(x, y, 2, 2);
      }
    // Faint ruled recipe lines.
    ctx.fillStyle = 'rgba(120,150,170,.32)';
    for (let y = 26; y < h - 8; y += 10) ctx.fillRect(14, y, w - 28, 1);
    fn(ctx, w, h, rnd);
    ctx.restore();
  });
  const t = new CanvasTexture(c);
  t.magFilter = NearestFilter;
  t.minFilter = NearestFilter;
  t.generateMipmaps = false;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  return t;
}

function plankTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d')!;
  const rnd = mulberry32(5);
  for (let pl = 0; pl < 4; pl++) {
    const base = 150 + Math.floor(rnd() * 40);
    const y0 = pl * 8;
    const seam = Math.floor(rnd() * 32);
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 32; x++) {
        const grain = Math.sin((x + pl * 7) * 0.45 + y * 0.9) * 5 + (rnd() - 0.5) * 12;
        const v = base + grain;
        ctx.fillStyle = `rgb(${v + 20},${v - 28},${v - 78})`;
        ctx.fillRect(x, y0 + y, 1, 1);
      }
    ctx.fillStyle = 'rgba(58,26,10,.7)';
    ctx.fillRect(0, y0, 32, 1);
    ctx.fillRect(seam, y0, 1, 8);
  }
  const t = new CanvasTexture(c);
  t.magFilter = NearestFilter;
  t.minFilter = NearestFilter;
  t.generateMipmaps = false;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(24, 14);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function squiggles(ctx: CanvasRenderingContext2D, rnd: () => number, x0: number, y0: number, lines: number, width: number) {
  ctx.fillStyle = 'rgba(72,44,28,.55)';
  for (let l = 0; l < lines; l++) {
    let x = x0;
    const y = y0 + l * 10;
    while (x < x0 + width - 6) {
      const wd = 4 + Math.floor(rnd() * 14);
      ctx.fillRect(x, y, Math.min(wd, x0 + width - x), 2);
      x += wd + 4;
    }
  }
}

function gutter(ctx: CanvasRenderingContext2D, w: number, h: number, side: 'left' | 'right') {
  const g = ctx.createLinearGradient(side === 'left' ? 0 : w, 0, side === 'left' ? 26 : w - 26, 0);
  g.addColorStop(0, 'rgba(70,40,20,.5)');
  g.addColorStop(1, 'rgba(70,40,20,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function rightPageTexture() {
  return paperTexture((ctx, w, h, rnd) => {
    // A drawn pierogi illustration with a title above it.
    ctx.fillStyle = 'rgba(86,40,22,.85)';
    ctx.font = 'bold italic 17px Georgia, serif';
    ctx.textBaseline = 'top';
    ctx.fillText('Pierogi Ruskie', 20, 7);
    ctx.save();
    ctx.translate(130, 42);
    ctx.scale(0.95, 0.95);
    const p = new Path2D(PIEROGI_PATH);
    ctx.fillStyle = '#f2d89c';
    ctx.strokeStyle = '#6b3a20';
    ctx.lineWidth = 2.5;
    ctx.fill(p);
    ctx.stroke(p);
    ctx.setLineDash([2, 5]);
    ctx.beginPath();
    ctx.arc(60, 64, 42, Math.PI, 0);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#6b3a20';
    ctx.fillRect(40, 50, 6, 8);
    ctx.fillRect(74, 50, 6, 8);
    ctx.restore();
    squiggles(ctx, rnd, 20, 36, 6, 98);
    squiggles(ctx, rnd, 20, 112, 5, 200);
    // A coffee ring.
    ctx.strokeStyle = 'rgba(140,90,40,.35)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(214, 140, 16, 0, Math.PI * 2);
    ctx.stroke();
    gutter(ctx, w, h, 'left');
  }, 11);
}

function leftPageTexture() {
  return paperTexture((ctx, w, h, rnd) => {
    ctx.fillStyle = 'rgba(86,40,22,.85)';
    ctx.font = 'bold italic 17px Georgia, serif';
    ctx.textBaseline = 'top';
    ctx.fillText('Składniki', 22, 7);
    squiggles(ctx, rnd, 22, 36, 4, 120);
    // A carrot.
    ctx.fillStyle = '#e9812a';
    ctx.strokeStyle = '#6b3a20';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(176, 38);
    ctx.lineTo(236, 56);
    ctx.lineTo(182, 78);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#5a9a3a';
    ctx.fillRect(166, 34, 14, 3);
    ctx.fillRect(168, 40, 12, 3);
    squiggles(ctx, rnd, 22, 100, 6, 210);
    gutter(ctx, w, h, 'right');
  }, 23, (ctx, w, h, rnd) => {
    ctx.fillStyle = 'rgba(86,40,22,.85)';
    ctx.font = 'bold italic 17px Georgia, serif';
    ctx.textBaseline = 'top';
    ctx.fillText('Kapusta', 20, 7);
    squiggles(ctx, rnd, 20, 36, 7, 205);
    // A cabbage.
    ctx.fillStyle = '#9ccc6a';
    ctx.strokeStyle = '#4c7a2a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(190, 130, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(190, 130, 11, 0.3, Math.PI * 1.6);
    ctx.stroke();
    gutter(ctx, w, h, 'left');
  });
}

function stackTopTexture() {
  return paperTexture((ctx, w, h, rnd) => {
    ctx.fillStyle = 'rgba(86,40,22,.85)';
    ctx.font = 'bold italic 17px Georgia, serif';
    ctx.textBaseline = 'top';
    ctx.fillText('Barszcz', 22, 7);
    squiggles(ctx, rnd, 22, 36, 9, 200);
    gutter(ctx, w, h, 'right');
  }, 37);
}

// ---- particles -------------------------------------------------------------------------------------
interface Puff {
  active: boolean;
  p: Vector3;
  v: Vector3;
  life: number;
  max: number;
  size: number;
  grow: number;
}

/** A pool of little low-poly puffs (flour, dust, paper bits) drawn as one InstancedMesh. */
class Puffs {
  readonly mesh: InstancedMesh;
  private puffs: Puff[];
  private m = new Matrix4();
  private q = new Quaternion();
  private s = new Vector3();
  private c = new Color();
  private next = 0;

  constructor(count: number) {
    const geo = new IcosahedronGeometry(0.5, 0);
    const mat = new MeshBasicMaterial({ color: '#ffffff' });
    this.mesh = new InstancedMesh(geo, mat, count);
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(35048);
    this.puffs = Array.from({ length: count }, () => ({ active: false, p: new Vector3(), v: new Vector3(), life: 0, max: 1, size: 1, grow: 0 }));
    for (let i = 0; i < count; i++) {
      this.mesh.setColorAt(i, this.c.set('#ffffff'));
      this.m.makeScale(0, 0, 0);
      this.mesh.setMatrixAt(i, this.m);
    }
  }

  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, color: string, grow = 1.5) {
    const p = this.puffs[this.next];
    this.next = (this.next + 1) % this.puffs.length;
    p.active = true;
    p.p.set(x, y, z);
    p.v.set(vx, vy, vz);
    p.life = p.max = life;
    p.size = size;
    p.grow = grow;
    this.mesh.setColorAt(this.puffs.indexOf(p), this.c.set(color));
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt: number) {
    this.puffs.forEach((p, i) => {
      if (!p.active) return;
      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        this.m.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, this.m);
        return;
      }
      p.v.multiplyScalar(Math.exp(-2.2 * dt));
      p.v.y -= 2 * dt;
      p.p.addScaledVector(p.v, dt);
      const k = p.life / p.max;
      const sz = p.size * (1 + (1 - k) * p.grow) * Math.min(1, k * 2.2);
      this.s.set(sz, sz * 0.8, sz);
      this.m.compose(p.p, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ---- the scene ----------------------------------------------------------------------------------------
interface Actor {
  model: PierogiModel;
  tag: Sprite;
  color: string;
  /** Seconds since being squashed, or -1. */
  squashed: number;
  /** Seconds since surviving a landing, or -1. */
  phew: number;
  duck: number;
  lx: number;
  lz: number;
  spin: number;
  stretch: number;
}

interface Footprint {
  group: Group;
  core: Mesh;
  glow: Mesh;
}

export interface PlayerLook {
  name: string;
  color: string;
}

export class CookbookScene {
  readonly stage: ArenaStage;
  private actors: Actor[] = [];
  private pivot = new Group();
  private pageMesh: Mesh;
  private pageMats: Material[];
  private shown: PageSpec | null = null;
  private shownSlide = -1;
  private feet: Footprint[] = [];
  private shadow: Mesh;
  private shadowMat: MeshBasicMaterial;
  private puffs = new Puffs(150);
  private shake = 0;
  private stackMat!: Material & { color: Color };
  private time = 0;
  private steam: Mesh[] = [];

  constructor(canvas: HTMLCanvasElement, looks: PlayerLook[]) {
    this.stage = new ArenaStage(canvas, { sky: '#3d2216', fog: [70, 150], fov: 38 });
    const stage = this.stage;
    this.buildTable();
    this.buildBook();
    this.buildProps();

    // The swinging page: geometry is rebuilt whenever the holes change.
    const paperL = leftPageTexture();
    stage.keep(paperL);
    const paper = flat('#ffffff', { map: paperL });
    const edge = flat('#a88a58');
    this.pageMats = [paper, edge];
    this.pageMesh = new Mesh(new BoxGeometry(1, 1, 1), this.pageMats);
    this.pivot.position.set(0, PAGE_T, 0);
    this.pivot.add(this.pageMesh);
    stage.add(this.pivot);

    // Darkness under the page, and the lit patches where the holes let light through.
    this.shadowMat = new MeshBasicMaterial({ color: '#1a0c05', transparent: true, opacity: 0, depthWrite: false });
    const sg = new PlaneGeometry(PAGE_W, PAGE_D);
    sg.rotateX(-Math.PI / 2);
    this.shadow = new Mesh(sg, this.shadowMat);
    this.shadow.position.set(PAGE_W / 2, PAGE_T + 0.01, 0);
    this.shadow.renderOrder = 1;
    stage.add(this.shadow);
    for (let i = 0; i < 4; i++) {
      const group = new Group();
      const glow = new Mesh(new BufferGeometry(), new MeshBasicMaterial({ color: '#ffae1a', transparent: true, opacity: 0, depthWrite: false, side: DoubleSide }));
      const core = new Mesh(new BufferGeometry(), new MeshBasicMaterial({ color: '#fff4c8', transparent: true, opacity: 0, depthWrite: false, side: DoubleSide }));
      glow.renderOrder = 2;
      core.renderOrder = 3;
      glow.position.y = FOOT_Y;
      core.position.y = FOOT_Y + 0.01;
      group.add(glow, core);
      group.visible = false;
      stage.add(group);
      this.feet.push({ group, core, glow });
    }
    stage.add(this.puffs.mesh);

    looks.forEach((l) => {
      const model = buildPierogi(l.color);
      const tag = nameTag(l.name, l.color);
      tag.position.set(0, 1.95, 0);
      tag.scale.set(3.4, 0.85, 1);
      model.root.scale.setScalar(0.82);
      model.root.add(tag);
      stage.add(model.root);
      this.actors.push({ model, tag, color: l.color, squashed: -1, phew: -1, duck: 0, lx: 0, lz: 0, spin: 0, stretch: 0 });
    });
  }

  // ---- static scenery ------------------------------------------------------------------------------
  private buildTable() {
    const stage = this.stage;
    const tex = plankTexture();
    stage.keep(tex);
    const g = new PlaneGeometry(130, 80);
    g.rotateX(-Math.PI / 2);
    const table = new Mesh(g, flat('#ffffff', { map: tex }));
    table.position.set(0, TABLE_Y, -6);
    stage.add(table);
  }

  private buildBook() {
    const stage = this.stage;
    // Leather cover with a gold edge.
    const cover = new Mesh(new BoxGeometry(35.4, 0.5, 12.9), flat('#8c2b26'));
    cover.position.set(0, TABLE_Y + 0.25 + 0.05, 0);
    stage.add(cover);
    const trim = new Mesh(new BoxGeometry(35.6, 0.12, 13.1), flat('#d9a937'));
    trim.position.set(0, TABLE_Y + 0.06, 0);
    stage.add(trim);
    const spine = new Mesh(new CylinderGeometry(0.55, 0.55, 12.9, 8), flat('#6e1f1b'));
    spine.rotation.x = Math.PI / 2;
    spine.position.set(0, TABLE_Y + 0.55, 0);
    stage.add(spine);

    const stackH = STACK_T + PAGE_T + 0.2;
    const edge = flat('#eadbb4');
    const rightTex = rightPageTexture();
    const leftTex = stackTopTexture();
    stage.keep(rightTex);
    stage.keep(leftTex);
    // Right-hand stack (top face = the page the pierogi stand on).
    const rightTop = flat('#ffffff', { map: rightTex });
    const right = new Mesh(new BoxGeometry(PAGE_W, stackH, PAGE_D), [edge, edge, rightTop, edge, edge, edge]);
    right.position.set(PAGE_W / 2, PAGE_T - stackH / 2, 0);
    stage.add(right);
    // Left-hand stack under the swinging page.
    const leftH = stackH - PAGE_T;
    this.stackMat = flat('#ffffff', { map: leftTex });
    const leftTop = this.stackMat;
    const left = new Mesh(new BoxGeometry(PAGE_W, leftH, PAGE_D), [edge, edge, leftTop, edge, edge, edge]);
    left.position.set(-PAGE_W / 2, -leftH / 2, 0);
    stage.add(left);
  }

  private buildProps() {
    const stage = this.stage;
    const wood = flat('#c98f55');
    const darkWood = flat('#a86f3c');
    // A giant rolling pin behind the book.
    const pin = new Mesh(new CylinderGeometry(1.15, 1.15, 14, 10), wood);
    pin.rotation.z = Math.PI / 2;
    pin.position.set(0, TABLE_Y + 1.15, -10.8);
    stage.add(pin);
    for (const s of [-1, 1]) {
      const handle = new Mesh(new CylinderGeometry(0.5, 0.6, 3.4, 8), darkWood);
      handle.rotation.z = Math.PI / 2;
      handle.position.set(s * 8.4, TABLE_Y + 1.15, -10.8);
      stage.add(handle);
      const knob = new Mesh(new SphereGeometry(0.75, 7, 5), darkWood);
      knob.position.set(s * 10.2, TABLE_Y + 1.15, -10.8);
      stage.add(knob);
    }
    // A teacup on a saucer, with steam.
    const china = flat('#fbf3e2');
    const blue = flat('#3568b8');
    const cx = -20.5;
    const cz = -9.6;
    const saucer = new Mesh(new CylinderGeometry(3.6, 3.0, 0.3, 14), china);
    saucer.position.set(cx, TABLE_Y + 0.15, cz);
    stage.add(saucer);
    const cup = new Mesh(new CylinderGeometry(2.3, 1.6, 2.6, 12, 1, true), china);
    cup.position.set(cx, TABLE_Y + 1.6, cz);
    stage.add(cup);
    const cupBase = new Mesh(new CylinderGeometry(1.6, 1.6, 0.2, 12), china);
    cupBase.position.set(cx, TABLE_Y + 0.35, cz);
    stage.add(cupBase);
    const band = new Mesh(new CylinderGeometry(2.1, 1.86, 0.45, 12, 1, true), blue);
    band.position.set(cx, TABLE_Y + 1.55, cz);
    band.scale.set(1.012, 1, 1.012);
    stage.add(band);
    const tea = new Mesh(new CircleGeometry(2.15, 12), flat('#a65a1c'));
    tea.rotation.x = -Math.PI / 2;
    tea.position.set(cx, TABLE_Y + 2.45, cz);
    stage.add(tea);
    const handle = new Mesh(new TorusGeometry(0.85, 0.24, 5, 9), china);
    handle.position.set(cx + 2.6, TABLE_Y + 1.7, cz);
    stage.add(handle);
    const steamMat = new MeshBasicMaterial({ color: '#fff3e0', transparent: true, opacity: 0.35, depthWrite: false });
    for (let i = 0; i < 4; i++) {
      const s = new Mesh(new IcosahedronGeometry(0.55, 0), steamMat);
      s.position.set(cx, TABLE_Y + 3 + i, cz);
      stage.add(s);
      this.steam.push(s);
    }
    // Flour: a heap on the right, a scatter over the table and a dusting along the page edges.
    const flour = flat('#f8f4ea');
    const heap = new Mesh(new IcosahedronGeometry(3.4, 1), flour);
    heap.scale.set(1.2, 0.55, 1);
    heap.position.set(17.5, TABLE_Y + 0.6, -10.5);
    stage.add(heap);
    const rnd = mulberry32(8);
    const blob = new IcosahedronGeometry(1, 0);
    for (let i = 0; i < 16; i++) {
      const m = new Mesh(blob, flour);
      const side = rnd() < 0.5 ? -1 : 1;
      m.position.set(side * (19.5 + rnd() * 6), TABLE_Y + 0.05, -9 + rnd() * 18);
      const k = 0.25 + rnd() * 0.5;
      m.scale.set(k * 1.5, 0.06, k);
      stage.add(m);
    }
    const dust = new MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.35, depthWrite: false });
    const dustGeo = new CircleGeometry(1, 9);
    dustGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 9; i++) {
      const m = new Mesh(dustGeo, dust);
      const onRight = rnd() < 0.6;
      const edgeZ = rnd() < 0.5 ? -1 : 1;
      m.position.set(onRight ? 12.5 + rnd() * 3.2 : 0.2 + rnd() * 3, PAGE_T + 0.012, edgeZ * (4.6 + rnd() * 0.7));
      const k = 0.35 + rnd() * 0.7;
      m.scale.set(k * 1.6, 1, k);
      stage.add(m);
    }
    // A wooden spoon on the front left.
    const spoonStick = new Mesh(new BoxGeometry(9, 0.45, 0.7), darkWood);
    spoonStick.position.set(-12, TABLE_Y + 0.25, 10.6);
    spoonStick.rotation.y = -0.3;
    stage.add(spoonStick);
    const spoonHead = new Mesh(new SphereGeometry(1.3, 8, 5), darkWood);
    spoonHead.scale.set(1.2, 0.35, 0.9);
    spoonHead.position.set(-7.6, TABLE_Y + 0.35, 9.8);
    stage.add(spoonHead);
  }

  // ---- the page -------------------------------------------------------------------------------------
  /** Rebuild the swinging page with its holes at the given swing progress. */
  private buildPage(spec: PageSpec, p: number) {
    const shape = new Shape();
    // Page-local coordinates: a = -world x, b = -world z (the page lies on the left, spine at 0).
    shape.moveTo(-PAGE_W, -PAGE_HALF_D);
    shape.lineTo(0, -PAGE_HALF_D);
    shape.lineTo(0, PAGE_HALF_D);
    shape.lineTo(-PAGE_W, PAGE_HALF_D);
    shape.closePath();
    for (const h of spec.holes) {
      const at = holeAt(h, p);
      const poly = holePolygon(h, at.x, at.z);
      shape.holes.push(new Path(poly.map((q) => new Vector2(-q.x, -q.z))));
    }
    const geo = new ExtrudeGeometry(shape, { depth: PAGE_T, bevelEnabled: false, curveSegments: 1, steps: 1 });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, -PAGE_T, 0);
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const back = pos.getY(i) < -PAGE_T / 2;
      // The top half of the atlas is the face that is up while the page lies on the left; the other half is
      // its back (mirrored, so it reads the right way round once the page has landed).
      const u = back ? -pos.getX(i) / PAGE_W : (pos.getX(i) + PAGE_W) / PAGE_W;
      uv.setXY(i, (back ? 0.5 : 0) + u * 0.5, (PAGE_HALF_D - pos.getZ(i)) / PAGE_D);
    }
    uv.needsUpdate = true;
    this.pageMesh.geometry.dispose();
    this.pageMesh.geometry = geo;
  }

  private footprintGeometry(h: Hole) {
    const pts = unitOutline(h.kind, h.aspect).map((q) => new Vector2(q.x * h.size, -q.z * h.size));
    const g = new ShapeGeometry(new Shape(pts));
    g.rotateX(-Math.PI / 2);
    return g;
  }

  /** Show a new page: rebuild its geometry and the lit patches for each of its holes. */
  private setPage(spec: PageSpec, p: number) {
    this.shown = spec;
    this.shownSlide = -1;
    this.buildPage(spec, p);
    this.feet.forEach((f, i) => {
      const h = spec.holes[i];
      f.core.geometry.dispose();
      f.glow.geometry.dispose();
      if (!h) {
        f.group.visible = false;
        return;
      }
      f.core.geometry = this.footprintGeometry(h);
      f.glow.geometry = this.footprintGeometry(h);
      f.group.rotation.y = h.rot;
    });
  }

  // ---- players ---------------------------------------------------------------------------------------
  /** A new round: stand everyone up, rebuild the first page. */
  reset(sim: CookbookSim) {
    this.shown = null;
    this.actors.forEach((a, i) => {
      a.squashed = -1;
      a.phew = -1;
      a.duck = 0;
      a.stretch = 0;
      a.model.body.rotation.set(0, 0, 0);
      a.model.body.scale.set(1, 1, 1);
      a.model.body.position.set(0, 0, 0);
      a.model.shadow.visible = true;
      a.tag.visible = !sim.players[i]?.gone;
      a.model.root.visible = !sim.players[i]?.gone;
      const p = sim.players[i];
      if (p) {
        a.lx = p.x;
        a.lz = p.z;
      }
    });
    this.setPage(sim.page, 0);
  }

  /** The page landed: shake, flour, squashed pierogi. */
  landed(squashed: number[], survivors: number[]) {
    this.shake = Math.min(1.4, 0.55 + squashed.length * 0.2);
    const rnd = Math.random;
    for (let k = 0; k < 44; k++) {
      const side = k % 3;
      let x: number;
      let z: number;
      if (side === 0) {
        x = PAGE_W;
        z = (rnd() - 0.5) * PAGE_D;
      } else {
        x = rnd() * PAGE_W;
        z = (side === 1 ? -1 : 1) * PAGE_HALF_D;
      }
      const out = new Vector3(side === 0 ? 1 : 0, 0, side === 0 ? 0 : side === 1 ? -1 : 1);
      this.puffs.spawn(x, PAGE_T + 0.4, z, out.x * (3 + rnd() * 4), 1 + rnd() * 2.5, out.z * (3 + rnd() * 4), 0.3 + rnd() * 0.45, 0.8 + rnd() * 0.5, '#f8f1e2');
    }
    for (const i of squashed) {
      const a = this.actors[i];
      if (!a) continue;
      a.squashed = 0;
      a.model.shadow.visible = false;
      a.tag.visible = false;
      const r = a.model.root.position;
      for (let k = 0; k < 9; k++) {
        const ang = (k / 9) * Math.PI * 2;
        this.puffs.spawn(r.x, PAGE_T + 0.3, r.z, Math.cos(ang) * 5, 1.5, Math.sin(ang) * 5, 0.32, 0.7, a.color);
      }
    }
    for (const i of survivors) {
      const a = this.actors[i];
      if (a) a.phew = 0;
    }
  }

  /** A pierogi left the game. */
  hide(i: number) {
    const a = this.actors[i];
    if (!a) return;
    a.model.root.visible = false;
  }

  dashed(i: number) {
    const a = this.actors[i];
    if (!a) return;
    a.stretch = 0.25;
    const r = a.model.root.position;
    for (let k = 0; k < 6; k++) this.puffs.spawn(r.x + (Math.random() - 0.5) * 0.6, PAGE_T + 0.2, r.z + (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 2, 0.6, (Math.random() - 0.5) * 2, 0.35, 0.45, '#fff6e6');
  }

  /** Where the middle of the book is on the 1920×1080 stage (for overlays). */
  toStage(x: number, y: number, z: number) {
    return this.stage.toStage(new Vector3(x, y, z));
  }

  // ---- drawing ---------------------------------------------------------------------------------------
  render(sim: CookbookSim, dt: number) {
    this.time += dt;
    const stage = this.stage;
    const angle = pageAngle(sim.phase, sim.phaseT, sim.page.swing);
    this.pivot.rotation.z = -angle;

    // Which page do we show? When the page flips back up, swap to the next one half-way (it is edge-on).
    let spec = sim.page;
    if (sim.phase === 'return' && sim.next && sim.phaseT / RETURN_TIME >= 0.5) spec = sim.next;
    const p = sim.phase === 'swing' ? sim.swingProgress : sim.phase === 'hold' || sim.phase === 'return' ? 1 : 0;
    const sliding = spec.holes.some((h) => h.slide) && sim.phase === 'swing';
    const slideStep = sliding ? Math.floor(sim.time * 30) : -1;
    if (spec !== this.shown) this.setPage(spec, spec === sim.page ? p : 0);
    else if (sliding && slideStep !== this.shownSlide) {
      this.shownSlide = slideStep;
      this.buildPage(spec, p);
    }

    // Lit patches and the shadow of the page.
    const lit = sim.phase === 'swing' || sim.phase === 'hold' || (sim.phase === 'return' && spec === sim.page);
    const fadeIn = sim.phase === 'swing' ? Math.min(1, sim.phaseT / 0.3) : 1;
    const fadeOut = sim.phase === 'return' ? 1 - Math.min(1, (sim.phaseT / RETURN_TIME) * 2.4) : 1;
    const sharp = Math.pow(Math.max(0, Math.min(1, angle / Math.PI)), 1.6);
    this.feet.forEach((f, i) => {
      const h = spec.holes[i];
      f.group.visible = !!h && lit && fadeOut > 0.01;
      if (!h || !f.group.visible) return;
      const at = holeAt(h, sim.phase === 'swing' ? sim.swingProgress : 1);
      f.group.position.set(at.x, 0, at.z);
      const pulse = 1 + Math.sin(this.time * 9 + i) * 0.015 * (1 - sharp);
      f.glow.scale.setScalar((1.08 + 0.32 * (1 - sharp)) * pulse);
      (f.glow.material as MeshBasicMaterial).opacity = (sim.phase === 'hold' ? 0.6 : 0.12 + 0.68 * sharp) * fadeIn * fadeOut;
      (f.core.material as MeshBasicMaterial).opacity = (sim.phase === 'hold' ? 0.22 : 0.28 + 0.62 * sharp) * fadeIn * fadeOut;
    });
    this.shadowMat.opacity = 0.55 * smooth((angle - 0.35 * Math.PI) / (0.65 * Math.PI)) ;
    this.shadow.visible = this.shadowMat.opacity > 0.01;

    // Pierogi.
    const near = sim.phase === 'swing' && sim.swingProgress > 0.9;
    this.actors.forEach((a, i) => {
      const sp = sim.players[i];
      if (!sp || sp.gone) return;
      const root = a.model.root;
      const body = a.model.body;
      const x = sp.x;
      const z = sp.z;
      const speed = Math.hypot(sp.vx, sp.vz);
      if (a.squashed >= 0) {
        // Flat sticker: lie down face-up on the page.
        a.squashed += dt;
        const e = smooth(a.squashed / 0.16);
        const pop = 1 + 0.35 * Math.sin(Math.min(1, a.squashed / 0.5) * Math.PI);
        body.rotation.x = -e * (Math.PI / 2);
        body.scale.set(1 + 0.2 * e * pop, 1 + 0.2 * e * pop, 1 - 0.88 * e);
        root.position.set(x, PAGE_T + 0.03 + (1 - e) * 0.2, z + 0.5 * e);
        root.rotation.y = 0;
        return;
      }
      // Walk wobble, dash stretch, duck before a landing, hop afterwards.
      const sf = Math.min(1, speed / 6);
      body.rotation.z = Math.sin(this.time * 15 + i) * 0.13 * sf + Math.max(-0.4, Math.min(0.4, sp.vx * 0.03));
      let sy = 1 + Math.sin(this.time * 30 + i * 2) * 0.04 * sf;
      let sxz = 1;
      a.duck += ((near && sp.alive && holeContainsAny(sim, x, z) ? 1 : 0) - a.duck) * Math.min(1, dt * 18);
      sy *= 1 - 0.45 * a.duck;
      sxz *= 1 + 0.25 * a.duck;
      let hop = 0;
      if (a.phew >= 0) {
        a.phew += dt;
        const t = a.phew / 0.5;
        if (t < 1) {
          hop = Math.sin(t * Math.PI) * 0.7;
          sy *= 1 + Math.sin(t * Math.PI * 2) * 0.12;
        } else a.phew = -1;
      }
      if (a.stretch > 0) {
        a.stretch -= dt;
        sy *= 0.82;
        sxz *= 1.18;
      }
      body.scale.set(sxz, sy, sxz);
      root.position.set(x, PAGE_T + 0.02 + hop, z);
      // Turn a little towards where we are heading, but keep facing the viewer mostly.
      const target = speed > 0.5 ? Math.max(-0.7, Math.min(0.7, Math.atan2(sp.vx, Math.max(0.5, Math.abs(sp.vz) + 1)))) : 0;
      a.spin += (target - a.spin) * Math.min(1, dt * 10);
      root.rotation.y = a.spin;
      a.model.shadow.scale.setScalar(1 - hop * 0.3);
      a.lx = x;
      a.lz = z;
    });

    // Steam drifting up from the tea.
    this.steam.forEach((s, i) => {
      const t = (this.time * 0.35 + i / this.steam.length) % 1;
      s.position.y = TABLE_Y + 3 + t * 5;
      s.position.x = -20.5 + Math.sin(t * 6 + i) * 0.6;
      s.scale.setScalar(0.6 + t * 1.4);
      (s.material as MeshBasicMaterial).opacity = 0.35 * Math.sin(t * Math.PI);
    });

    // The stack under the page is in shadow until the page lifts off it.
    this.stackMat.color.setScalar(0.42 + 0.58 * smooth(angle / (0.35 * Math.PI)));
    this.puffs.update(dt);

    // Camera: the whole book plus the arc of the page, with a shake when a page lands.
    const target = new Vector3(0, 1.2, 0.9);
    stage.lookAt(target, 31, 1.12);
    // A little off to the side, so the swinging page is not exactly edge-on in the middle of its swing.
    stage.camera.position.x += 1.2;
    stage.camera.lookAt(target);
    if (this.shake > 0.01) {
      stage.camera.position.x += (Math.random() - 0.5) * this.shake * 0.9;
      stage.camera.position.y += (Math.random() - 0.5) * this.shake * 0.9;
      this.shake *= Math.exp(-6 * dt);
    }
    stage.render();
  }

  dispose() {
    this.stage.dispose();
  }
}

function holeContainsAny(sim: CookbookSim, x: number, z: number) {
  return sim.page.holes.some((h) => holeContains(h, x, z));
}
