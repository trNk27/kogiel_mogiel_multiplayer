/**
 * Strzelnica's 3D booth: a night-time fairground shooting gallery seen straight on. Static dressing is merged
 * into a handful of meshes; targets are pooled low-poly cut-outs; confetti is one instanced mesh.
 */
import {
  AdditiveBlending,
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  InstancedMesh,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  NearestFilter,
  Object3D,
  PlaneGeometry,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  SRGBColorSpace,
  Path,
  Vector2,
  Vector3,
  type Material,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ArenaStage, flat, groundTexture, pixelTexture } from '../arena/kit';
import { mulberry32 } from '../rng';
import { COTTAGE_Z, LANES, OPENINGS, SPOTS, WINDOW_Z, type Kind, type Rect, type Target } from './logic';

/** Half heights the models were modelled at; targets are scaled from these to their logical size. */
const MODEL_HH: Record<Kind, number> = { ghost: 0.78, bat: 0.4, gold: 0.78, babcia: 0.98 };
const RAIL_DROP = 0.78 + 0.6;

/** Merge every mesh under `src` that shares a material into one mesh per material. */
function mergeStatic(src: Object3D): Group {
  src.updateMatrixWorld(true);
  const byMat = new Map<Material, BufferGeometry[]>();
  src.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    let g = m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    if (g.index) g = g.toNonIndexed();
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    g.clearGroups();
    const mat = m.material as Material;
    byMat.set(mat, [...(byMat.get(mat) ?? []), g]);
    m.geometry.dispose();
  });
  const out = new Group();
  for (const [mat, geos] of byMat) {
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (merged) out.add(new Mesh(merged, mat));
  }
  return out;
}

const basic = (color: string, extra: ConstructorParameters<typeof MeshBasicMaterial>[0] = {}) => new MeshBasicMaterial({ color, ...extra });

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** The painted village backdrop (400×220 px for a 40×22 m board centred on y = 5.2). */
function backdropTexture() {
  const W = 400;
  const H = 220;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const rnd = mulberry32(77);
  const X = (x: number) => (x + 20) * 10;
  const Y = (y: number) => (16.2 - y) * 10;
  const sky = ctx.createLinearGradient(0, 0, 0, Y(0));
  sky.addColorStop(0, '#0b0e2c');
  sky.addColorStop(0.55, '#262a64');
  sky.addColorStop(1, '#6b4a7c');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fff6d8';
  for (let i = 0; i < 90; i++) ctx.fillRect(Math.floor(rnd() * W), Math.floor(rnd() * Y(5)), 1, 1);
  ctx.fillStyle = 'rgba(255,255,255,.55)';
  for (let i = 0; i < 40; i++) ctx.fillRect(Math.floor(rnd() * W), Math.floor(rnd() * Y(5)), 2, 1);
  // Moon, with a halo and a few craters.
  const mx = X(6.8);
  const my = Y(8.1);
  ctx.fillStyle = 'rgba(255,240,180,.12)';
  ctx.beginPath();
  ctx.arc(mx, my, 26, 0, 7);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,240,180,.2)';
  ctx.beginPath();
  ctx.arc(mx, my, 19, 0, 7);
  ctx.fill();
  ctx.fillStyle = '#fbefb8';
  ctx.beginPath();
  ctx.arc(mx, my, 14, 0, 7);
  ctx.fill();
  ctx.fillStyle = '#e8d690';
  for (const [dx, dy, r] of [[-4, -3, 3], [4, 2, 4], [-2, 6, 2]]) {
    ctx.beginPath();
    ctx.arc(mx + dx, my + dy, r, 0, 7);
    ctx.fill();
  }
  // Far hills.
  ctx.fillStyle = '#2a2250';
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let x = 0; x <= W; x += 4) ctx.lineTo(x, Y(1.9) - Math.sin(x * 0.03) * 9 - Math.sin(x * 0.011 + 1) * 12);
  ctx.lineTo(W, H);
  ctx.fill();
  // Village on the hill.
  const house = (x: number, w: number, h: number, wall: string, roof: string, lit: boolean[]) => {
    const gx = X(x);
    const gy = Y(0.9);
    ctx.fillStyle = wall;
    ctx.fillRect(gx - (w * 10) / 2, gy - h * 10, w * 10, h * 10);
    ctx.fillStyle = roof;
    ctx.beginPath();
    ctx.moveTo(gx - (w * 10) / 2 - 3, gy - h * 10);
    ctx.lineTo(gx, gy - h * 10 - w * 6);
    ctx.lineTo(gx + (w * 10) / 2 + 3, gy - h * 10);
    ctx.fill();
    lit.forEach((on, k) => {
      ctx.fillStyle = on ? '#ffc864' : '#1a1638';
      ctx.fillRect(gx - (w * 10) / 2 + 4 + k * 9, gy - h * 10 + 5, 5, 6);
    });
  };
  house(-17.5, 3, 3, '#2d2a5c', '#4c2f58', [true, false]);
  house(-14.5, 3.4, 3.8, '#34305f', '#5a3358', [true, true, false]);
  house(-11.6, 2.6, 2.6, '#2b2858', '#43304f', [false, true]);
  house(11.5, 3, 3.2, '#2f2b5e', '#512f54', [true, true]);
  house(14.8, 3.6, 4.2, '#363262', '#5e3a5c', [true, false, true]);
  house(18, 2.8, 2.8, '#2c2959', '#45304f', [false, true]);
  // The church.
  const cx = X(-8.2);
  const cy = Y(0.9);
  ctx.fillStyle = '#3a3668';
  ctx.fillRect(cx - 18, cy - 38, 36, 38);
  ctx.fillRect(cx - 7, cy - 78, 14, 44);
  ctx.fillStyle = '#5e3a60';
  ctx.beginPath();
  ctx.moveTo(cx - 10, cy - 78);
  ctx.lineTo(cx, cy - 106);
  ctx.lineTo(cx + 10, cy - 78);
  ctx.fill();
  ctx.fillStyle = '#e8d690';
  ctx.fillRect(cx - 1, cy - 118, 2, 14);
  ctx.fillRect(cx - 5, cy - 114, 10, 2);
  ctx.fillStyle = '#ffc864';
  ctx.fillRect(cx - 3, cy - 68, 6, 9);
  ctx.fillRect(cx - 13, cy - 26, 5, 10);
  ctx.fillRect(cx + 8, cy - 26, 5, 10);
  ctx.fillStyle = '#1a1638';
  ctx.fillRect(cx - 3, cy - 14, 6, 14);
  // Dead trees.
  ctx.strokeStyle = '#1b1740';
  ctx.lineWidth = 2;
  for (const tx of [-5, -1.5, 3.6, 9.2, -19]) {
    const x = X(tx);
    const y = Y(0.9);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y - 28);
    ctx.moveTo(x, y - 14);
    ctx.lineTo(x - 9, y - 26);
    ctx.moveTo(x, y - 20);
    ctx.lineTo(x + 8, y - 32);
    ctx.stroke();
  }
  // Ground.
  ctx.fillStyle = '#1c1b3d';
  ctx.fillRect(0, Y(0.9), W, H);
  const t = new CanvasTexture(c);
  t.magFilter = t.minFilter = NearestFilter;
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** A painted babcia cut-out: headscarf, apron and a wagging finger. 64×104 px. */
function babciaTexture(outline: boolean) {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 104;
  const ctx = c.getContext('2d')!;
  const px = (col: string, x: number, y: number, w: number, h: number) => {
    ctx.fillStyle = col;
    ctx.fillRect(x, y, w, h);
  };
  const disc = (col: string, x: number, y: number, r: number) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 7);
    ctx.fill();
  };
  // Dress and apron.
  ctx.fillStyle = '#4f6aa8';
  ctx.beginPath();
  ctx.moveTo(22, 50);
  ctx.lineTo(42, 50);
  ctx.lineTo(60, 102);
  ctx.lineTo(4, 102);
  ctx.fill();
  ctx.fillStyle = '#fff2d6';
  ctx.beginPath();
  ctx.moveTo(25, 58);
  ctx.lineTo(39, 58);
  ctx.lineTo(50, 102);
  ctx.lineTo(14, 102);
  ctx.fill();
  px('#e8335a', 29, 76, 3, 3);
  px('#f2b705', 35, 84, 3, 3);
  px('#e8335a', 24, 90, 3, 3);
  px('#f2b705', 31, 94, 3, 3);
  px('#e8335a', 40, 95, 3, 3);
  px('#dcd0b0', 25, 56, 14, 3);
  // Arms: one on the hip, one up with a wagging finger.
  px('#4f6aa8', 12, 54, 10, 22);
  px('#f1c49a', 12, 74, 9, 6);
  px('#4f6aa8', 42, 52, 10, 14);
  px('#f1c49a', 46, 34, 7, 20);
  px('#f1c49a', 47, 24, 4, 12);
  // Head, headscarf and face.
  disc('#c8283c', 32, 33, 20);
  disc('#f1c49a', 32, 38, 14);
  ctx.fillStyle = '#c8283c';
  ctx.beginPath();
  ctx.arc(32, 31, 15, Math.PI, 0);
  ctx.fill();
  px('#c8283c', 17, 31, 30, 3);
  ctx.fillStyle = '#fff4dc';
  for (const [x, y] of [[20, 24], [27, 18], [35, 17], [43, 24], [24, 31], [40, 31], [32, 24]]) ctx.fillRect(x, y, 3, 3);
  // The knot under the chin.
  ctx.fillStyle = '#a81e30';
  ctx.beginPath();
  ctx.moveTo(32, 52);
  ctx.lineTo(22, 58);
  ctx.lineTo(24, 48);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(32, 52);
  ctx.lineTo(42, 58);
  ctx.lineTo(40, 48);
  ctx.fill();
  // Glasses, cross eyebrows, grumpy mouth, rosy cheeks.
  disc('#2a120a', 25, 38, 5.5);
  disc('#2a120a', 39, 38, 5.5);
  disc('#e8f2ff', 25, 38, 4);
  disc('#e8f2ff', 39, 38, 4);
  px('#2a120a', 30, 37, 4, 2);
  px('#2a120a', 25, 38, 2, 2);
  px('#2a120a', 39, 38, 2, 2);
  px('#2a120a', 21, 31, 8, 2);
  px('#2a120a', 35, 31, 8, 2);
  px('#2a120a', 28, 47, 8, 2);
  px('#2a120a', 27, 48, 2, 2);
  px('#2a120a', 35, 48, 2, 2);
  px('#e88a8a', 20, 43, 4, 3);
  px('#e88a8a', 40, 43, 4, 3);
  if (outline) {
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = '#9a7040';
    ctx.fillRect(0, 0, 64, 104);
  }
  const t = new CanvasTexture(c);
  t.magFilter = t.minFilter = NearestFilter;
  t.colorSpace = SRGBColorSpace;
  return t;
}

type Mats = ReturnType<typeof makeMats>;
function makeMats() {
  const sheet = flat('#ffffff', { emissive: new Color('#7f89c4') });
  const gold = flat('#ffd54a', { emissive: new Color('#b8860b') });
  const bat = flat('#56307a', { emissive: new Color('#2b1a46') });
  const wing = flat('#7a4aa8', { emissive: new Color('#35205a'), side: DoubleSide });
  const black = basic('#1d0f0a');
  const pink = basic('#ff9fb0');
  const red = basic('#ff3b3b');
  const stick = flat('#e0b97c', { emissive: new Color('#3a2a14') });
  const babcia = new MeshLambertMaterial({ map: babciaTexture(false), alphaTest: 0.5, side: DoubleSide, emissive: new Color('#8a86a0') });
  babcia.emissiveMap = babcia.map;
  const babciaEdge = basic('#9a7040', { side: DoubleSide, alphaTest: 0.5, map: babciaTexture(true) });
  return { sheet, gold, bat, wing, black, pink, red, stick, babcia, babciaEdge };
}

interface Model {
  root: Group;
  holder: Group;
  stick: Mesh;
  kind: Kind;
  wings: Group[];
  arms: Mesh[];
  used: boolean;
  /** For the glitter trail. */
  lastGlitter: number;
}

let ghostGeo: BufferGeometry | null = null;
function ghostGeometry() {
  if (ghostGeo) return ghostGeo;
  const pts = [
    [0, -0.7],
    [0.5, -0.78],
    [0.66, -0.72],
    [0.66, -0.35],
    [0.6, 0],
    [0.5, 0.38],
    [0.45, 0.55],
    [0.37, 0.7],
    [0.2, 0.8],
    [0, 0.84],
  ].map(([r, y]) => new Vector2(r, y));
  const g = new LatheGeometry(pts, 9);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < -0.6) pos.setY(i, y + Math.sin(Math.atan2(pos.getZ(i), pos.getX(i)) * 4.5) * 0.11 * (Math.hypot(pos.getX(i), pos.getZ(i)) > 0.3 ? 1 : 0));
  }
  g.computeVertexNormals();
  ghostGeo = g;
  return g;
}

function buildModel(kind: Kind, mats: Mats, shared: { eye: BufferGeometry; arm: BufferGeometry; plane: BufferGeometry; wingR: BufferGeometry; ear: BufferGeometry; body: BufferGeometry; head: BufferGeometry; stick: BufferGeometry }): Model {
  const root = new Group();
  const holder = new Group();
  root.add(holder);
  const stick = new Mesh(shared.stick, mats.stick);
  holder.add(stick);
  const wings: Group[] = [];
  const arms: Mesh[] = [];
  if (kind === 'ghost' || kind === 'gold') {
    const body = new Mesh(ghostGeometry(), kind === 'gold' ? mats.gold : mats.sheet);
    holder.add(body);
    for (const x of [-0.18, 0.18]) {
      const e = new Mesh(shared.eye, mats.black);
      e.position.set(x, 0.3, 0.47);
      e.scale.set(0.075, 0.11, 0.05);
      holder.add(e);
      const cheek = new Mesh(shared.eye, mats.pink);
      cheek.position.set(x * 1.9, 0.12, 0.46);
      cheek.scale.set(0.07, 0.04, 0.03);
      holder.add(cheek);
      const arm = new Mesh(shared.arm, kind === 'gold' ? mats.gold : mats.sheet);
      arm.position.set(x * 3.6, 0.0, 0.1);
      arm.rotation.z = x > 0 ? -0.9 : 0.9;
      arm.scale.set(1, 1, 0.8);
      holder.add(arm);
      arms.push(arm);
    }
    const mouth = new Mesh(shared.eye, mats.black);
    mouth.position.set(0, 0.06, 0.55);
    mouth.scale.set(0.09, 0.12, 0.05);
    holder.add(mouth);
  } else if (kind === 'bat') {
    const body = new Mesh(shared.body, mats.bat);
    body.scale.set(1, 1.25, 0.8);
    holder.add(body);
    const head = new Mesh(shared.head, mats.bat);
    head.position.set(0, 0.3, 0.02);
    holder.add(head);
    for (const x of [-1, 1]) {
      const ear = new Mesh(shared.ear, mats.bat);
      ear.position.set(x * 0.1, 0.47, 0);
      ear.rotation.z = -x * 0.25;
      holder.add(ear);
      const eye = new Mesh(shared.eye, mats.red);
      eye.position.set(x * 0.06, 0.32, 0.12);
      eye.scale.set(0.04, 0.04, 0.03);
      holder.add(eye);
      const pivot = new Group();
      pivot.position.set(x * 0.12, 0.05, -0.02);
      const w = new Mesh(shared.wingR, mats.wing);
      w.scale.x = x;
      pivot.add(w);
      holder.add(pivot);
      wings.push(pivot);
    }
  } else {
    const edge = new Mesh(shared.plane, mats.babciaEdge);
    edge.scale.set(1.13, 1.08, 1);
    edge.position.z = -0.04;
    const face = new Mesh(shared.plane, mats.babcia);
    holder.add(edge, face);
  }
  root.visible = false;
  return { root, holder, stick, kind, wings, arms, used: false, lastGlitter: 0 };
}

interface Particles {
  mesh: InstancedMesh;
  n: number;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  vx: Float32Array;
  vy: Float32Array;
  vz: Float32Array;
  rot: Float32Array;
  spin: Float32Array;
  life: Float32Array;
  max: Float32Array;
  next: number;
}

export class GalleryScene {
  readonly stage: ArenaStage;
  private mats = makeMats();
  private pool: Record<Kind, Model[]> = { ghost: [], bat: [], gold: [], babcia: [] };
  private shared;
  private bulbs: InstancedMesh;
  private glows: InstancedMesh;
  private bulbCount = 0;
  private bulbBase: Color[] = [];
  private waves: Group[] = [];
  private openings: { leaves: Group[]; glow: MeshBasicMaterial; amt: number; open: number }[] = [];
  private fx: Particles;
  private tmp = new Object3D();
  private col = new Color();
  private time = 0;
  private proj = new Vector3();

  constructor(canvas: HTMLCanvasElement) {
    this.stage = new ArenaStage(canvas, { sky: '#0e1230', fog: [60, 120], fov: 38 });
    const st = this.stage;
    st.scene.traverse((o) => {
      if (o instanceof HemisphereLight) {
        o.color.set('#a9a8ff');
        o.groundColor.set('#4a2a3c');
        o.intensity = 1.35;
      } else if (o instanceof AmbientLight) {
        o.color.set('#8d86c8');
        o.intensity = 0.55;
      } else if (o instanceof DirectionalLight) {
        o.color.set('#ffe6bc');
        o.intensity = 1.25;
        o.position.set(0.15, 0.55, 1);
      }
    });
    st.lookAt(new Vector3(0, 3.25, 0), 16.4, 0.1);
    st.camera.updateMatrixWorld(true);
    this.shared = {
      eye: new SphereGeometry(1, 6, 4),
      arm: new SphereGeometry(0.2, 6, 4),
      plane: new PlaneGeometry(1.2, 1.96),
      wingR: this.wingGeometry(),
      ear: new ConeGeometry(0.07, 0.2, 4),
      body: new IcosahedronGeometry(0.22, 0),
      head: new IcosahedronGeometry(0.15, 0),
      stick: new BoxGeometry(0.1, 1, 0.06),
    };
    this.buildBackdrop();
    this.buildVillage();
    this.buildFloor();
    this.buildRows();
    this.buildCottage();
    this.buildRails();
    this.buildAwning();
    this.buildCounter();
    const lights = this.buildBulbs();
    this.bulbs = lights.bulbs;
    this.glows = lights.glows;
    this.fx = this.buildConfetti();
  }

  // ---- building the booth -------------------------------------------------------------

  private wingGeometry() {
    const s = new Shape();
    s.moveTo(0, 0.12);
    s.lineTo(0.25, 0.3);
    s.lineTo(0.62, 0.34);
    s.lineTo(0.78, 0.12);
    s.lineTo(0.62, 0.1);
    s.lineTo(0.52, -0.08);
    s.lineTo(0.4, 0.06);
    s.lineTo(0.28, -0.12);
    s.lineTo(0.14, 0.0);
    s.lineTo(0, -0.12);
    return new ShapeGeometry(s);
  }

  private buildBackdrop() {
    const m = new Mesh(new PlaneGeometry(40, 22), new MeshBasicMaterial({ map: backdropTexture(), fog: false }));
    m.position.set(0, 5.2, -10.5);
    this.stage.add(m);
    this.stage.keep(m.material as Material);
  }

  /** Cardboard houses and a church between the painted backdrop and the cottage. */
  private buildVillage() {
    const g = new Group();
    const wall = [flat('#3a3568'), flat('#43386e'), flat('#33305e')];
    const roof = [flat('#6a3a62'), flat('#5a3458')];
    const lit = basic('#ffc864');
    const dark = basic('#17132f');
    const house = (x: number, z: number, w: number, h: number, k: number) => {
      const b = new Mesh(new BoxGeometry(w, h, 0.4), wall[k % 3]);
      b.position.set(x, h / 2, z);
      const rs = new Shape();
      rs.moveTo(-w / 2 - 0.25, 0);
      rs.lineTo(0, w * 0.5);
      rs.lineTo(w / 2 + 0.25, 0);
      const r = new Mesh(new ExtrudeGeometry(rs, { depth: 0.55, bevelEnabled: false }), roof[k % 2]);
      r.position.set(x, h, z - 0.27);
      g.add(b, r);
      for (let i = 0; i < Math.max(1, Math.floor(w / 1.1)); i++) {
        const wx = x - (Math.floor(w / 1.1) - 1) * 0.55 + i * 1.1;
        const win = new Mesh(new PlaneGeometry(0.42, 0.55), (i + k) % 3 === 2 ? dark : lit);
        win.position.set(wx, h * 0.55, z + 0.21);
        g.add(win);
      }
    };
    house(-11.5, -7.5, 2.6, 2.6, 0);
    house(-14.2, -8, 2.4, 3.3, 1);
    house(10.8, -7.5, 2.8, 2.8, 2);
    house(13.5, -8, 2.6, 3.6, 0);
    house(8.0, -8.3, 2.2, 2.2, 1);
    // The church.
    const cz = -8.5;
    const nave = new Mesh(new BoxGeometry(3.4, 3.2, 1.2), wall[1]);
    nave.position.set(-7.2, 1.6, cz);
    const tower = new Mesh(new BoxGeometry(1.5, 5.6, 1.2), wall[0]);
    tower.position.set(-8.4, 2.8, cz + 0.1);
    const spire = new Mesh(new ConeGeometry(1.15, 2.2, 4), roof[0]);
    spire.rotation.y = Math.PI / 4;
    spire.position.set(-8.4, 6.7, cz + 0.1);
    const crossV = new Mesh(new BoxGeometry(0.1, 0.9, 0.1), basic('#e8d690'));
    crossV.position.set(-8.4, 8.2, cz + 0.1);
    const crossH = new Mesh(new BoxGeometry(0.5, 0.1, 0.1), basic('#e8d690'));
    crossH.position.set(-8.4, 8.3, cz + 0.1);
    const bell = new Mesh(new PlaneGeometry(0.5, 0.8), lit);
    bell.position.set(-8.4, 4.9, cz + 0.72);
    const rose = new Mesh(new CircleGeometry(0.4, 8), basic('#ff9a4a'));
    rose.position.set(-8.4, 3.0, cz + 0.72);
    const rs = new Shape();
    rs.moveTo(-1.9, 0);
    rs.lineTo(0, 1.3);
    rs.lineTo(1.9, 0);
    const nroof = new Mesh(new ExtrudeGeometry(rs, { depth: 1.4, bevelEnabled: false }), roof[1]);
    nroof.position.set(-6.9, 3.2, cz - 0.7);
    g.add(nave, tower, spire, crossV, crossH, bell, rose, nroof);
    for (const x of [-6.3, -7.3]) {
      const w = new Mesh(new PlaneGeometry(0.45, 1.1), lit);
      w.position.set(x, 1.6, cz + 0.61);
      g.add(w);
    }
    this.stage.add(mergeStatic(g));
  }

  private buildFloor() {
    const tex = groundTexture('grass', 10, 5);
    const floor = new Mesh(new PlaneGeometry(40, 16), new MeshLambertMaterial({ map: tex, color: '#3d4a64' }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, -3.5);
    this.stage.add(floor);
  }

  /** Hedges, gravestones and waves: the cut-outs the pop-ups hide behind, plus a wavy front row. */
  private buildRows() {
    const g = new Group();
    const hedge = flat('#2f6b3a');
    const hedge2 = flat('#44924a');
    const berry = basic('#ff4d6d');
    const stone = flat('#9a9bb4', { emissive: new Color('#2a2a3c') });
    const stoneDark = flat('#5a5b78');
    const moss = flat('#4c8a4e');
    const teal = flat('#2a86a6', { emissive: new Color('#0a2030') });
    const teal2 = flat('#58b8cc', { emissive: new Color('#0a2030') });
    const foam = basic('#e8f8ff');
    const wood = flat('#8a5a34');
    SPOTS.forEach((s, i) => {
      const z = s.z;
      const kind = i % 3 === 0 ? 'hedge' : i % 3 === 1 ? 'grave' : 'wave';
      const back = new Mesh(new BoxGeometry(2.7, s.top - 0.3, 0.2), wood);
      back.position.set(s.x, (s.top - 0.3) / 2, z - 0.16);
      g.add(back);
      if (kind === 'hedge') {
        const b = new Mesh(new BoxGeometry(2.7, s.top - 0.35, 0.34), hedge);
        b.position.set(s.x, (s.top - 0.35) / 2, z);
        g.add(b);
        for (let k = 0; k < 5; k++) {
          const bump = new Mesh(new IcosahedronGeometry(0.58, 0), k % 2 ? hedge2 : hedge);
          bump.position.set(s.x - 1.1 + k * 0.55, s.top - 0.45 + (k % 2) * 0.12, z + 0.02);
          bump.scale.z = 0.6;
          g.add(bump);
        }
        for (const [bx, by] of [[-0.8, 0.5], [0.1, 0.8], [0.9, 0.4]]) {
          const b2 = new Mesh(new IcosahedronGeometry(0.1, 0), berry);
          b2.position.set(s.x + bx, by, z + 0.25);
          g.add(b2);
        }
      } else if (kind === 'grave') {
        const slab = new Mesh(new BoxGeometry(1.9, s.top - 0.9, 0.34), stone);
        slab.position.set(s.x, (s.top - 0.9) / 2, z);
        const arch = new Mesh(new CylinderGeometry(0.95, 0.95, 0.34, 10), stone);
        arch.rotation.x = Math.PI / 2;
        arch.position.set(s.x, s.top - 0.95, z);
        const cv = new Mesh(new BoxGeometry(0.14, 0.7, 0.06), stoneDark);
        cv.position.set(s.x, s.top - 1.0, z + 0.19);
        const ch = new Mesh(new BoxGeometry(0.46, 0.14, 0.06), stoneDark);
        ch.position.set(s.x, s.top - 0.85, z + 0.19);
        const mo = new Mesh(new IcosahedronGeometry(0.3, 0), moss);
        mo.position.set(s.x - 0.7, 0.35, z + 0.15);
        mo.scale.set(1.2, 0.6, 0.6);
        // Flanking little stones so the whole 2.7 m piece is covered.
        for (const sx of [-1.15, 1.15]) {
          const side = new Mesh(new BoxGeometry(0.6, s.top - 0.6, 0.3), hedge);
          side.position.set(s.x + sx, (s.top - 0.6) / 2, z - 0.02);
          g.add(side);
        }
        g.add(slab, arch, cv, ch, mo);
      } else {
        for (let k = 0; k < 5; k++) {
          const w = new Mesh(new CylinderGeometry(0.6, 0.6, 0.32, 8), k % 2 ? teal : teal2);
          w.rotation.x = Math.PI / 2;
          w.position.set(s.x - 1.1 + k * 0.55, s.top - 0.65 + (k % 2) * 0.16, z + (k % 2) * 0.03);
          g.add(w);
          const f = new Mesh(new IcosahedronGeometry(0.11, 0), foam);
          f.position.set(s.x - 1.1 + k * 0.55, s.top - 0.1 + (k % 2) * 0.16, z + 0.2);
          g.add(f);
        }
        const body = new Mesh(new BoxGeometry(2.7, s.top - 0.8, 0.3), teal);
        body.position.set(s.x, (s.top - 0.8) / 2, z);
        g.add(body);
      }
    });
    this.stage.add(mergeStatic(g));

    // Front waves, bobbing in two rows (the rail of the nearest lane runs behind them).
    for (const [row, z, col, col2, y0] of [
      [0, 2.0, teal, teal2, 0.05],
      [1, 2.3, teal2, teal, -0.1],
    ] as const) {
      const wg = new Group();
      for (let k = -9; k <= 9; k++) {
        const w = new Mesh(new CylinderGeometry(0.8, 0.8, 0.3, 8), (k + row) % 2 ? col : col2);
        w.rotation.x = Math.PI / 2;
        w.position.set(k * 1.05 + row * 0.5, 0.15, z);
        wg.add(w);
        if ((k + row) % 3 === 0) {
          const f = new Mesh(new IcosahedronGeometry(0.12, 0), foam);
          f.position.set(k * 1.05 + row * 0.5, 0.95, z + 0.2);
          wg.add(f);
        }
      }
      const m = mergeStatic(wg);
      m.position.y = y0;
      this.waves.push(m);
      this.stage.add(m);
    }
  }

  private buildCottage() {
    const g = new Group();
    const plaster = new MeshLambertMaterial({
      map: pixelTexture(
        16,
        (ctx, rnd) => {
          for (let y = 0; y < 16; y++)
            for (let x = 0; x < 16; x++) {
              const v = (rnd() - 0.5) * 18;
              ctx.fillStyle = `rgb(${132 + v},${116 + v},${150 + v})`;
              ctx.fillRect(x, y, 1, 1);
            }
          ctx.fillStyle = 'rgba(40,24,48,.35)';
          for (const y of [0, 5, 10]) ctx.fillRect(0, y, 16, 1);
          ctx.fillStyle = 'rgba(40,24,48,.25)';
          ctx.fillRect(4, 1, 1, 4);
          ctx.fillRect(11, 6, 1, 4);
          ctx.fillRect(7, 11, 1, 5);
        },
        9,
        1,
      ),
      flatShading: true,
      emissive: new Color('#2a2038'),
    });
    plaster.map!.repeat.set(0.45, 0.45);
    const timber = flat('#3a2416');
    const roofMat = flat('#7a2c3c', { emissive: new Color('#2a0a14') });
    const roofDark = flat('#5a1e30');
    // The front: a house-shaped board with a hole for every opening.
    const shape = new Shape();
    const hw = 3.45;
    shape.moveTo(-hw, 0);
    shape.lineTo(hw, 0);
    shape.lineTo(hw, 4.9);
    shape.lineTo(0, 7.1);
    shape.lineTo(-hw, 4.9);
    shape.lineTo(-hw, 0);
    for (const o of OPENINGS) {
      const hole = new Path();
      const x0 = o.x - o.w / 2;
      const x1 = o.x + o.w / 2;
      const y0 = o.kind === 'door' ? 0.8 : o.y - o.h / 2;
      const y1 = o.y + o.h / 2;
      hole.moveTo(x0, y0);
      hole.lineTo(x0, y1);
      hole.lineTo(x1, y1);
      hole.lineTo(x1, y0);
      hole.lineTo(x0, y0);
      shape.holes.push(hole);
    }
    const front = new Mesh(new ExtrudeGeometry(shape, { depth: 0.4, bevelEnabled: false }), plaster);
    front.position.z = COTTAGE_Z - 0.4;
    g.add(front);
    // Frames and sills.
    for (const o of OPENINGS) {
      const y0 = o.kind === 'door' ? 0.8 : o.y - o.h / 2;
      const hgt = o.y + o.h / 2 - y0;
      const cy = y0 + hgt / 2;
      const t = 0.12;
      const z = COTTAGE_Z + 0.04;
      for (const sx of [-1, 1]) {
        const side = new Mesh(new BoxGeometry(t, hgt + t * 2, 0.1), timber);
        side.position.set(o.x + sx * (o.w / 2 + t / 2), cy, z);
        g.add(side);
      }
      const top = new Mesh(new BoxGeometry(o.w + t * 4, t, 0.1), timber);
      top.position.set(o.x, y0 + hgt + t / 2, z);
      g.add(top);
      if (o.kind !== 'door') {
        const sill = new Mesh(new BoxGeometry(o.w + t * 4, t * 1.3, 0.28), timber);
        sill.position.set(o.x, y0 - t * 0.6, z + 0.08);
        g.add(sill);
      }
    }
    // Roof slabs.
    const slopeLen = Math.hypot(hw, 2.2) + 0.5;
    const ang = Math.atan2(2.2, hw);
    for (const s of [-1, 1]) {
      const slab = new Mesh(new BoxGeometry(slopeLen, 0.22, 2.4), roofMat);
      slab.position.set(s * (hw / 2 + 0.05), 4.9 + 1.1 + 0.2, COTTAGE_Z - 0.9);
      slab.rotation.z = -s * ang;
      g.add(slab);
      const edge = new Mesh(new BoxGeometry(slopeLen + 0.1, 0.16, 0.12), roofDark);
      edge.position.set(s * (hw / 2 + 0.05), 4.9 + 1.1 + 0.15, COTTAGE_Z + 0.36);
      edge.rotation.z = -s * ang;
      g.add(edge);
    }
    const chimney = new Mesh(new BoxGeometry(0.8, 1.6, 0.8), flat('#6a4a50'));
    chimney.position.set(2.0, 6.7, COTTAGE_Z - 1.0);
    g.add(chimney);
    // Back of the cottage: a dark wall so nothing shows through.
    const inside = new Mesh(new BoxGeometry(7.2, 5.2, 0.1), flat('#1a1226'));
    inside.position.set(0, 2.6, WINDOW_Z - 0.4);
    g.add(inside);
    const sidew = new Mesh(new BoxGeometry(0.3, 5, 1.2), plaster);
    sidew.position.set(hw - 0.15, 2.5, COTTAGE_Z - 0.9);
    const sidew2 = sidew.clone();
    sidew2.position.x = -hw + 0.15;
    g.add(sidew, sidew2);
    this.stage.add(mergeStatic(g));

    // Interiors that glow when somebody is home, and shutters / the door that swing open.
    const wood = flat('#4a7a60');
    const wood2 = flat('#2f523e');
    for (const o of OPENINGS) {
      const y0 = o.kind === 'door' ? 0.8 : o.y - o.h / 2;
      const hgt = o.y + o.h / 2 - y0;
      const glow = new MeshBasicMaterial({ color: '#3a2438' });
      const back = new Mesh(new PlaneGeometry(o.w + 0.2, hgt + 0.2), glow);
      back.position.set(o.x, y0 + hgt / 2, WINDOW_Z - 0.3);
      this.stage.add(back);
      const leaves: Group[] = [];
      const z = COTTAGE_Z + 0.12;
      const mk = (w: number, side: number) => {
        const pivot = new Group();
        pivot.position.set(o.x + side * (o.w / 2 + 0.06), y0 + hgt / 2, z);
        const lg = new Group();
        const board = new Mesh(new BoxGeometry(w, hgt, 0.08), wood);
        board.position.x = (-side * w) / 2;
        lg.add(board);
        for (let k = 0; k < 3; k++) {
          const slat = new Mesh(new BoxGeometry(w * 0.82, 0.07, 0.04), wood2);
          slat.position.set((-side * w) / 2, hgt * (0.3 - k * 0.3), 0.06);
          lg.add(slat);
        }
        const m = mergeStatic(lg);
        pivot.add(m);
        this.stage.add(pivot);
        leaves.push(pivot);
        return pivot;
      };
      if (o.kind === 'door') mk(o.w + 0.12, -1);
      else {
        mk(o.w / 2 + 0.08, -1);
        mk(o.w / 2 + 0.08, 1);
      }
      this.openings.push({ leaves, glow, amt: 0, open: 0 });
    }
  }

  private buildRails() {
    const g = new Group();
    const rail = flat('#2e2836', { emissive: new Color('#15101c') });
    const brass = flat('#c89a3c', { emissive: new Color('#3a2808') });
    for (const lane of LANES) {
      const y = lane.y - RAIL_DROP;
      const r = new Mesh(new BoxGeometry(26, 0.14, 0.24), rail);
      r.position.set(0, y, lane.z);
      g.add(r);
      for (let x = -12; x <= 12; x += 3) {
        const post = new Mesh(new BoxGeometry(0.16, 0.55, 0.16), brass);
        post.position.set(x, y - 0.3, lane.z);
        g.add(post);
      }
    }
    this.stage.add(mergeStatic(g));
  }

  private buildAwning() {
    const g = new Group();
    const red = new MeshLambertMaterial({ color: '#d4263e', emissive: new Color('#5a0c18'), side: DoubleSide, flatShading: true });
    const cream = new MeshLambertMaterial({ color: '#f6e7c4', emissive: new Color('#5a4e38'), side: DoubleSide, flatShading: true });
    const back = new Vector3(0, 9.6, -1.6);
    const front = new Vector3(0, 7.7, 4.1);
    const len = back.distanceTo(front);
    const tilt = Math.atan2(back.y - front.y, front.z - back.z);
    const n = 30;
    const w = 24 / n;
    for (let i = 0; i < n; i++) {
      const x = -12 + w * (i + 0.5);
      const mat = i % 2 ? cream : red;
      const p = new Mesh(new PlaneGeometry(w, len), mat);
      p.rotation.x = -Math.PI / 2 + tilt;
      p.position.set(x, (back.y + front.y) / 2, (back.z + front.z) / 2);
      g.add(p);
      // Scalloped valance.
      const sc = new Mesh(new CircleGeometry(w / 2, 8, Math.PI, Math.PI), mat);
      sc.position.set(x, front.y - 0.14, front.z + 0.02);
      g.add(sc);
      const strip = new Mesh(new PlaneGeometry(w, 0.28), mat);
      strip.position.set(x, front.y + 0.0, front.z + 0.02);
      g.add(strip);
    }
    // A wooden beam along the front edge under the valance.
    const beam = new Mesh(new BoxGeometry(24, 0.16, 0.2), flat('#6b4326'));
    beam.position.set(0, front.y + 0.1, front.z - 0.05);
    g.add(beam);
    this.stage.add(mergeStatic(g));
  }

  private buildCounter() {
    const g = new Group();
    const wood = new MeshLambertMaterial({ map: groundTexture('wood', 1, 8), color: '#c89a72', flatShading: true });
    wood.map!.repeat.set(5, 0.7);
    const woodDark = flat('#6b4326');
    const red = flat('#c8283c', { emissive: new Color('#3a0a14') });
    const cream = flat('#f6e7c4', { emissive: new Color('#4a4030') });
    const top = new Mesh(new BoxGeometry(24, 0.2, 1.7), wood);
    top.position.set(0, 0.42, 3.55);
    g.add(top);
    const front = new Mesh(new BoxGeometry(24, 2.5, 0.2), woodDark);
    front.position.set(0, -0.95, 4.55);
    g.add(front);
    // Painted bunting stripes along the counter's edge.
    for (let i = -12; i < 12; i++) {
      const s = new Mesh(new BoxGeometry(1, 0.34, 0.06), i % 2 ? red : cream);
      s.position.set(i + 0.5, 0.2, 4.7);
      g.add(s);
    }
    const lip = new Mesh(new BoxGeometry(24, 0.1, 0.1), cream);
    lip.position.set(0, 0.55, 4.6);
    g.add(lip);
    // Curtains framing the booth.
    const velvet = [flat('#9a1d34', { emissive: new Color('#2a0610') }), flat('#7c1428', { emissive: new Color('#2a0610') })];
    for (const s of [-1, 1]) {
      for (let k = 0; k < 6; k++) {
        const c = new Mesh(new BoxGeometry(0.33, 8, 0.28), velvet[k % 2]);
        c.position.set(s * (8.6 + k * 0.33), 4.0, 2.6 + (k % 2) * 0.1);
        g.add(c);
      }
    }
    this.stage.add(mergeStatic(g));
  }

  private buildBulbs() {
    const pts: Vector3[] = [];
    for (let i = 0; i <= 24; i++) pts.push(new Vector3(-12 + i, 7.2 - Math.sin((i / 24) * Math.PI) * 0.0, 4.2));
    // A second, shorter string a bit higher on the cottage's eaves.
    this.bulbCount = pts.length;
    const bulbs = new InstancedMesh(new SphereGeometry(0.13, 6, 4), basic('#ffffff'), pts.length);
    const glows = new InstancedMesh(new PlaneGeometry(0.95, 0.95), basic('#ffffff', { map: glowTexture(), transparent: true, blending: AdditiveBlending, depthWrite: false, fog: false }), pts.length);
    const palette = ['#ffe27a', '#ff7a9a', '#fff4dc', '#7ad4ff', '#ffb347'];
    pts.forEach((p, i) => {
      this.tmp.position.copy(p);
      this.tmp.rotation.set(0, 0, 0);
      this.tmp.scale.setScalar(1);
      this.tmp.updateMatrix();
      bulbs.setMatrixAt(i, this.tmp.matrix);
      this.tmp.position.z += 0.1;
      this.tmp.updateMatrix();
      glows.setMatrixAt(i, this.tmp.matrix);
      this.bulbBase.push(new Color(palette[i % palette.length]));
      bulbs.setColorAt(i, this.bulbBase[i]);
      glows.setColorAt(i, this.bulbBase[i]);
    });
    glows.renderOrder = 5;
    this.stage.add(bulbs, glows);
    return { bulbs, glows };
  }

  private buildConfetti(): Particles {
    const n = 800;
    const mesh = new InstancedMesh(new PlaneGeometry(0.17, 0.11), basic('#ffffff', { side: DoubleSide }), n);
    mesh.frustumCulled = false;
    mesh.renderOrder = 6;
    for (let i = 0; i < n; i++) {
      this.tmp.scale.setScalar(0);
      this.tmp.updateMatrix();
      mesh.setMatrixAt(i, this.tmp.matrix);
      mesh.setColorAt(i, this.col.set('#ffffff'));
    }
    this.stage.add(mesh);
    const f = () => new Float32Array(n);
    return { mesh, n, x: f(), y: f(), z: f(), vx: f(), vy: f(), vz: f(), rot: f(), spin: f(), life: f(), max: f(), next: 0 };
  }

  // ---- animation ------------------------------------------------------------------------

  /** A burst of confetti (in a player's colour, with a few white and gold pieces). */
  burst(x: number, y: number, z: number, color: string, n = 28, power = 1) {
    const p = this.fx;
    const base = new Color(color);
    for (let k = 0; k < n; k++) {
      const i = p.next++ % p.n;
      const a = Math.random() * Math.PI * 2;
      const sp = (1.5 + Math.random() * 3.5) * power;
      p.x[i] = x + (Math.random() - 0.5) * 0.4;
      p.y[i] = y + (Math.random() - 0.5) * 0.5;
      p.z[i] = z + 0.3;
      p.vx[i] = Math.cos(a) * sp;
      p.vy[i] = Math.sin(a) * sp * 0.8 + 2.2 * power;
      p.vz[i] = (Math.random() - 0.2) * 2;
      p.rot[i] = Math.random() * 6;
      p.spin[i] = (Math.random() - 0.5) * 18;
      p.life[i] = p.max[i] = 0.9 + Math.random() * 0.7;
      const r = Math.random();
      this.col.copy(r < 0.62 ? base : r < 0.82 ? this.col.set('#fff6e0') : this.col.set('#ffd23f'));
      if (r < 0.62) this.col.copy(base).offsetHSL(0, 0, (Math.random() - 0.5) * 0.2);
      p.mesh.setColorAt(i, this.col);
    }
    if (p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true;
  }

  private takeModel(kind: Kind): Model {
    const list = this.pool[kind];
    let m = list.find((x) => !x.used);
    if (!m) {
      m = buildModel(kind, this.mats, this.shared);
      list.push(m);
      this.stage.add(m.root);
    }
    m.used = true;
    return m;
  }

  /** Where a world rectangle on depth `z` lands on the 1920×1080 stage. */
  project(z: number, b: Rect): Rect {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [x, y] of [
      [b.x0, b.y0],
      [b.x1, b.y0],
      [b.x0, b.y1],
      [b.x1, b.y1],
    ]) {
      const p = this.stage.toStage(this.proj.set(x, y, z));
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y);
      y1 = Math.max(y1, p.y);
    }
    return { x0, y0, x1, y1 };
  }

  /** Stage position of a world point. */
  point(x: number, y: number, z: number) {
    return this.stage.toStage(this.proj.set(x, y, z));
  }

  private placeModels(targets: readonly Target[], dt: number) {
    const t = this.time;
    const seen = new Set<Model>();
    for (const tg of targets) {
      const key = tg as Target & { _m?: Model };
      let m = key._m;
      if (!m) {
        m = this.takeModel(tg.kind);
        key._m = m;
        m.lastGlitter = 0;
      }
      seen.add(m);
      const sc = tg.hh / MODEL_HH[tg.kind];
      m.root.visible = true;
      m.root.position.set(tg.x, tg.y - tg.hh, tg.z);
      m.root.rotation.set(0, 0, 0);
      m.root.scale.setScalar(1);
      m.holder.position.y = tg.hh;
      m.holder.scale.setScalar(sc);
      const sway = Math.sin(t * 2.3 + tg.ev.phase);
      let stickLen = 0;
      if (tg.mode === 'glide') {
        stickLen = Math.max(0.2, tg.y - tg.hh - (LANES[tg.ev.slot].y - RAIL_DROP));
        m.root.rotation.z = sway * 0.07;
        m.root.rotation.y = tg.ev.dir * 0.28 * Math.sin(t * 1.1 + tg.ev.phase);
      } else if (tg.mode === 'popup') {
        stickLen = 2.2;
        m.root.rotation.z = sway * 0.05;
      } else if (tg.mode === 'window') {
        stickLen = 1.4;
        m.root.rotation.z = sway * 0.04;
      } else {
        m.root.rotation.z = tg.kind === 'gold' ? sway * 0.12 : Math.sin(t * 4.4 + tg.ev.phase) * 0.18 * tg.ev.dir;
      }
      m.stick.visible = stickLen > 0 && tg.kind !== 'bat' && tg.kind !== 'gold';
      if (m.stick.visible) {
        m.stick.scale.y = stickLen / sc;
        m.stick.position.y = -MODEL_HH[tg.kind] - stickLen / sc / 2 + 0.05;
      }
      for (const [i, w] of m.wings.entries()) w.rotation.z = (i ? 1 : -1) * (0.35 + Math.sin(t * 17 + tg.ev.phase) * 0.7);
      for (const [i, a] of m.arms.entries()) a.rotation.z = (i ? -1 : 1) * (0.9 + Math.sin(t * 4 + i * 2 + tg.ev.phase) * 0.35);
      if (tg.kind === 'gold') {
        m.holder.scale.multiplyScalar(1 + Math.sin(t * 9) * 0.04);
        m.lastGlitter -= dt;
        if (m.lastGlitter <= 0 && tg.state === 'alive') {
          m.lastGlitter = 0.05;
          this.glitter(tg.x, tg.y, tg.z);
        }
      }
      if (tg.state === 'hit') {
        const a = tg.hitAge;
        if (tg.kind === 'babcia') {
          const k = Math.min(1, a / 0.3);
          m.root.rotation.x = -(Math.PI / 2) * (k * k * (3 - 2 * k)) * 1.02;
          m.stick.visible = false;
        } else if (tg.kind === 'bat') {
          m.root.position.y -= 7 * a * a;
          m.root.rotation.z += a * 11;
          m.root.scale.setScalar(Math.max(0, 1 - a * 1.3));
        } else {
          const k = Math.min(1, a / 0.16);
          m.holder.scale.multiplyScalar(k < 0.4 ? 1 + k * 0.7 : Math.max(0, 1.28 - (k - 0.4) * 2.1));
          if (k >= 1) m.root.visible = false;
        }
      }
    }
    // Release models of targets that are gone.
    for (const list of Object.values(this.pool))
      for (const m of list)
        if (m.used && !seen.has(m)) {
          m.used = false;
          m.root.visible = false;
        }
  }

  private glitter(x: number, y: number, z: number) {
    const p = this.fx;
    for (let k = 0; k < 2; k++) {
      const i = p.next++ % p.n;
      p.x[i] = x + (Math.random() - 0.5) * 0.9;
      p.y[i] = y + (Math.random() - 0.5) * 1.2;
      p.z[i] = z + 0.3;
      p.vx[i] = (Math.random() - 0.5) * 0.8;
      p.vy[i] = Math.random() * 0.6;
      p.vz[i] = 0;
      p.rot[i] = Math.random() * 6;
      p.spin[i] = (Math.random() - 0.5) * 10;
      p.life[i] = p.max[i] = 0.5 + Math.random() * 0.3;
      p.mesh.setColorAt(i, this.col.set(Math.random() < 0.5 ? '#ffe27a' : '#fff6e0'));
    }
    if (p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true;
  }

  private updateFx(dt: number) {
    const p = this.fx;
    for (let i = 0; i < p.n; i++) {
      if (p.life[i] <= 0) continue;
      p.life[i] -= dt;
      if (p.life[i] <= 0) {
        this.tmp.scale.setScalar(0);
        this.tmp.updateMatrix();
        p.mesh.setMatrixAt(i, this.tmp.matrix);
        continue;
      }
      p.vy[i] -= 7.5 * dt;
      p.vx[i] *= 1 - 1.3 * dt;
      p.vy[i] *= 1 - 0.8 * dt;
      p.x[i] += p.vx[i] * dt;
      p.y[i] += p.vy[i] * dt;
      p.z[i] += p.vz[i] * dt;
      p.rot[i] += p.spin[i] * dt;
      this.tmp.position.set(p.x[i], p.y[i], p.z[i]);
      this.tmp.rotation.set(p.rot[i], 0, p.rot[i] * 0.7);
      this.tmp.scale.setScalar(Math.min(1, (p.life[i] / p.max[i]) * 2.2));
      this.tmp.updateMatrix();
      p.mesh.setMatrixAt(i, this.tmp.matrix);
    }
    p.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Advance the animation: targets, confetti, twinkling bulbs, bobbing waves and opening shutters. */
  update(dt: number, targets: readonly Target[]) {
    this.time += dt;
    const t = this.time;
    this.placeModels(targets, dt);
    this.updateFx(dt);
    // Bulbs twinkle in a chase pattern.
    for (let i = 0; i < this.bulbCount; i++) {
      const k = 0.55 + 0.45 * Math.sin(t * 3.2 + i * 1.3) * Math.sin(t * 1.1 + i * 0.4);
      this.col.copy(this.bulbBase[i]).multiplyScalar(0.45 + 0.75 * k);
      this.bulbs.setColorAt(i, this.col);
      this.col.copy(this.bulbBase[i]).multiplyScalar(0.12 + 0.55 * k);
      this.glows.setColorAt(i, this.col);
    }
    if (this.bulbs.instanceColor) this.bulbs.instanceColor.needsUpdate = true;
    if (this.glows.instanceColor) this.glows.instanceColor.needsUpdate = true;
    this.waves[0].position.y = 0.05 + Math.sin(t * 1.4) * 0.07;
    this.waves[1].position.y = -0.1 + Math.sin(t * 1.4 + 2) * 0.07;
    this.waves[0].position.x = Math.sin(t * 0.7) * 0.12;
    this.waves[1].position.x = -Math.sin(t * 0.7) * 0.12;
    // Shutters follow whoever is peeking out.
    const want = OPENINGS.map(() => 0);
    for (const tg of targets) if (tg.mode === 'window' && tg.state === 'alive') want[tg.ev.slot] = Math.max(want[tg.ev.slot], tg.open);
    for (const [i, o] of this.openings.entries()) {
      const k = 1 - Math.exp(-dt * 12);
      o.open += (Math.min(1, want[i] * 1.6) - o.open) * k;
      const door = OPENINGS[i].kind === 'door';
      const swing = (door ? 2.3 : 2.85) * o.open;
      o.leaves.forEach((l, j) => (l.rotation.y = door ? -swing : j === 0 ? -swing : swing));
      this.col.set('#3a2438').lerp(this.col2.set(i % 2 ? '#d98a3c' : '#e0a24a'), Math.min(1, o.open * 1.1));
      o.glow.color.copy(this.col);
    }
  }
  private col2 = new Color();

  render() {
    this.stage.render();
  }

  get drawCalls() {
    return this.stage.renderer.info.render.calls;
  }

  dispose() {
    this.stage.world.traverse((o) => {
      const mat = (o as Mesh).material as (Material & { map?: { dispose(): void } | null }) | undefined;
      mat?.map?.dispose?.();
    });
    const gl = this.stage.renderer;
    this.stage.dispose();
    gl.forceContextLoss();
    for (const m of Object.values(this.mats)) (m as Material).dispose?.();
    for (const g of Object.values(this.shared)) g.dispose();
    ghostGeo?.dispose();
    ghostGeo = null;
  }
}

