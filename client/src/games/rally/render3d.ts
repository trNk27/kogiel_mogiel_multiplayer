/**
 * Maluch Rally on the TV: one WebGL canvas, one viewport per player.
 * The PS2 look comes from a low internal resolution scaled up without smoothing,
 * flat-shaded low-poly meshes, tiny nearest-filtered textures, blob shadows and thick fog.
 */
import {
  AmbientLight,
  CapsuleGeometry,
  IcosahedronGeometry,
  OctahedronGeometry,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  NearestFilter,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  RepeatWrapping,
  Scene,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  Vector3,
  WebGLRenderer,
  type Material,
} from 'three';
import { mulberry32 } from '../rng';
import { BRIDGE_WALL, ROAD_HALF, TUNNEL_HEIGHT, TUNNEL_WALL, WALL, inRange, riverCoords, waterLevel, type Track } from './track';
import { ITUNING, driftLevel, type Blast, type Bomb, type Car, type ItemBox, type Pickle, type Slick } from './sim';
import { buildTown, type Obstacle } from './town3d';

/** What the renderer needs from the simulation each frame. */
export interface RaceState {
  cars: Car[];
  boxes: ItemBox[];
  slicks: Slick[];
  pickles: Pickle[];
  bombs: Bomb[];
  blasts: Blast[];
  time: number;
}

/** How far into the tunnel sample i is: 0 outside, 1 a little way in. */
export function tunnelDepth(t: Track, i: number) {
  if (!t.tunnel) return 0;
  const { from, len } = t.tunnel;
  if (!inRange(i, from, len, t.n)) return 0;
  const k = (((i - from) % t.n) + t.n) % t.n;
  return Math.min(1, Math.min(k, len - k) / 8);
}

interface CarFx {
  shield: Mesh;
  flame: Mesh;
  cloud: Group;
  /** Drift sparks from the back wheels. */
  sparks: Mesh[];
}

/** Internal resolution as a fraction of the 1920×1080 stage. */
export const RENDER_SCALE = 0.45;

/** Size of what the scene renders into: slots are in these units, and `scale` maps them to canvas pixels. */
export interface Viewport {
  width: number;
  height: number;
  scale: number;
}
const SKY = new Color('#f2b38a');
const FOG_NEAR = 70;
const FOG_FAR = 380;

export interface Slot {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Split-screen layout in stage pixels (top-left origin), for up to 4 players. Three players leave a slot free for the map. */
export function splitLayout(n: number, W = 1920, H = 1080): { slots: Slot[]; free: Slot | null } {
  const [cols, rows] = n <= 1 ? [1, 1] : n === 2 ? [1, 2] : [2, 2];
  const w = W / cols;
  const h = H / rows;
  const cells: Slot[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push({ x: c * w, y: r * h, w, h });
  return { slots: cells.slice(0, n), free: cells.length > n ? cells[cells.length - 1] : null };
}

function pixelTexture(size: number, paint: (ctx: CanvasRenderingContext2D, rnd: () => number) => void, seed = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  paint(ctx, mulberry32(seed));
  const t = new CanvasTexture(c);
  t.magFilter = NearestFilter;
  t.minFilter = NearestFilter;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.colorSpace = SRGBColorSpace;
  return t;
}

function noise(ctx: CanvasRenderingContext2D, rnd: () => number, size: number, base: [number, number, number], spread: number) {
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const v = (rnd() - 0.5) * spread;
      ctx.fillStyle = `rgb(${base[0] + v},${base[1] + v},${base[2] + v * 0.6})`;
      ctx.fillRect(x, y, 1, 1);
    }
}

function labelTexture(text: string, color: string) {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 32;
  const ctx = c.getContext('2d')!;
  ctx.font = '800 22px "Fraunces Variable", Georgia, serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#2a120a';
  ctx.strokeText(text, 64, 17);
  ctx.fillStyle = color;
  ctx.fillText(text, 64, 17);
  const t = new CanvasTexture(c);
  t.magFilter = t.minFilter = NearestFilter;
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** A Fiat 126p ("Maluch"), about as many polygons as a PS2 would spend on a background car. */
function buildMaluch(color: string): { car: Group; wheels: Mesh[]; mats: Material[] } {
  const car = new Group();
  const paint = new MeshLambertMaterial({ color, flatShading: true });
  const dark = new MeshLambertMaterial({ color: '#1d1a22', flatShading: true });
  const glass = new MeshLambertMaterial({ color: '#2b3d55', flatShading: true });
  const chrome = new MeshLambertMaterial({ color: '#c9ccd3', flatShading: true });
  const lamp = new MeshBasicMaterial({ color: '#fff4c8' });

  const body = new Mesh(new BoxGeometry(1.7, 0.7, 3.2), paint);
  body.position.y = 0.65;
  car.add(body);
  // Sloped nose and tail: squash the top front/back edges.
  const pos = body.geometry.attributes.position as BufferAttribute;
  for (let i = 0; i < pos.count; i++) if (pos.getY(i) > 0) pos.setZ(i, pos.getZ(i) * 0.86);

  const cabinGeo = new BoxGeometry(1.5, 0.62, 1.75);
  const cp = cabinGeo.attributes.position as BufferAttribute;
  for (let i = 0; i < cp.count; i++)
    if (cp.getY(i) > 0) {
      cp.setX(i, cp.getX(i) * 0.86);
      cp.setZ(i, cp.getZ(i) * 0.72 - 0.1);
    }
  const cabin = new Mesh(cabinGeo, glass);
  cabin.position.set(0, 1.3, -0.15);
  car.add(cabin);
  const roof = new Mesh(new BoxGeometry(1.3, 0.1, 1.22), paint);
  roof.position.set(0, 1.64, -0.22);
  car.add(roof);

  for (const z of [1.62, -1.62]) {
    const bumper = new Mesh(new BoxGeometry(1.8, 0.16, 0.14), chrome);
    bumper.position.set(0, 0.42, z);
    car.add(bumper);
  }
  for (const x of [-0.55, 0.55]) {
    const l = new Mesh(new BoxGeometry(0.32, 0.2, 0.06), lamp);
    l.position.set(x, 0.72, 1.61);
    car.add(l);
    const t = new Mesh(new BoxGeometry(0.3, 0.18, 0.06), new MeshBasicMaterial({ color: '#d0213a' }));
    t.position.set(x, 0.72, -1.61);
    car.add(t);
  }
  const wheels: Mesh[] = [];
  const wheelGeo = new CylinderGeometry(0.36, 0.36, 0.3, 7);
  wheelGeo.rotateZ(Math.PI / 2);
  for (const [x, z] of [
    [-0.82, 1.05],
    [0.82, 1.05],
    [-0.82, -1.05],
    [0.82, -1.05],
  ]) {
    const w = new Mesh(wheelGeo, dark);
    w.position.set(x, 0.36, z);
    car.add(w);
    wheels.push(w);
  }
  // Blob shadow.
  const shadow = new Mesh(new CircleGeometry(1.6, 10), new MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.35, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.set(0.75, 1.25, 1);
  shadow.position.y = 0.05;
  car.add(shadow);
  return { car, wheels, mats: [paint, dark, glass, chrome] };
}

export interface CarLook {
  name: string;
  color: string;
}

export class RallyScene {
  readonly renderer: WebGLRenderer;
  private scene = new Scene();
  private world = new Group();
  private cams: PerspectiveCamera[] = [];
  private cars: { root: Group; body: Group; wheels: Mesh[]; tag: Sprite; spin: number; fx: CarFx; mats: Material[]; ghost: boolean }[] = [];
  private view: Viewport;
  private lights: { light: HemisphereLight | AmbientLight | DirectionalLight; base: number }[] = [];
  private dark: number[] = [];
  private bombMeshes: Mesh[] = [];
  private blastMeshes: Mesh[] = [];
  private bombGeo = new IcosahedronGeometry(1.1, 1);
  private bombMat = new MeshLambertMaterial({ color: '#9fcf5a', flatShading: true });
  private blastGeo = new IcosahedronGeometry(1, 1);
  private blastMat = new MeshBasicMaterial({ color: '#ffd23f', transparent: true, opacity: 0.6, depthWrite: false });
  private hayParts = {
    bale: new CylinderGeometry(1.3, 1.3, 2.6, 8),
    mat: new MeshLambertMaterial({ color: '#e9c25a', flatShading: true }),
    band: new CylinderGeometry(1.34, 1.34, 0.25, 8),
    bandMat: new MeshLambertMaterial({ color: '#a5462e', flatShading: true }),
  };
  private water: CanvasTexture | null = null;
  private sparkGeo = new OctahedronGeometry(0.35, 0);
  private sprayParts = {
    puff: new IcosahedronGeometry(1, 0),
    mat: new MeshLambertMaterial({ color: '#c2185b', emissive: '#6d0d2e', transparent: true, opacity: 0.55, depthWrite: false, flatShading: true }),
  };
  private boxMeshes: Mesh[] = [];
  private slickMeshes: Group[] = [];
  private pickleMeshes: Mesh[] = [];
  private boxMat: MeshBasicMaterial;
  private boxGeo = new BoxGeometry(1.6, 1.6, 1.6);
  private slickParts = {
    puddle: new CylinderGeometry(2.3, 2.3, 0.08, 8),
    pat: new BoxGeometry(1, 0.5, 0.7),
    puddleMat: new MeshLambertMaterial({ color: '#ffe27a', flatShading: true }),
    patMat: new MeshLambertMaterial({ color: '#fff1b0', flatShading: true }),
  };
  private pickleGeo = new CapsuleGeometry(0.42, 1.4, 2, 6);
  private pickleMat = new MeshLambertMaterial({ color: '#5f9e2f', flatShading: true });
  private camPos: Vector3[] = [];
  private track: Track | null = null;
  private disposables: { dispose(): void }[] = [];

  constructor(
    canvas: HTMLCanvasElement,
    looks: CarLook[],
    view: Viewport = { width: 1920, height: 1080, scale: RENDER_SCALE },
  ) {
    this.view = view;
    this.renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.setScissorTest(true);
    this.resize(view);
    this.scene.background = SKY;
    this.scene.fog = new Fog(SKY, FOG_NEAR, FOG_FAR);
    const hemi = new HemisphereLight('#ffe9c9', '#4a5a2a', 1.4);
    const ambient = new AmbientLight('#ffffff', 0.35);
    const sun = new DirectionalLight('#fff1d6', 1.6);
    sun.position.set(-0.6, 1, 0.35);
    this.scene.add(hemi, ambient, sun);
    this.lights = [hemi, ambient, sun].map((light) => ({ light, base: light.intensity }));
    this.scene.add(this.world);
    const qTex = pixelTexture(16, (ctx) => {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 16, 16);
      ctx.fillStyle = '#2a120a';
      ctx.fillRect(0, 0, 16, 1);
      ctx.fillRect(0, 15, 16, 1);
      ctx.fillRect(0, 0, 1, 16);
      ctx.fillRect(15, 0, 1, 16);
      ctx.font = 'bold 14px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', 8, 9);
    });
    this.boxMat = new MeshBasicMaterial({ map: qTex, transparent: true, opacity: 0.88 });

    looks.forEach((look, i) => {
      const { car, wheels, mats } = buildMaluch(look.color);
      const root = new Group();
      root.add(car);
      const tag = new Sprite(new SpriteMaterial({ map: labelTexture(look.name, look.color), depthTest: false, fog: false }));
      tag.scale.set(4, 1, 1);
      tag.position.y = 3;
      tag.layers.set(i + 1);
      root.add(tag);
      this.scene.add(root);
      const shield = new Mesh(
        new IcosahedronGeometry(2.7, 1),
        new MeshLambertMaterial({ color: '#9cc8ff', emissive: '#4f9dff', emissiveIntensity: 0.7, transparent: true, opacity: 0.38, depthWrite: false, flatShading: true }),
      );
      shield.position.y = 1;
      shield.scale.set(1, 0.8, 1.35);
      const flameGeo = new ConeGeometry(0.45, 1.8, 5);
      flameGeo.rotateX(-Math.PI / 2);
      const flame = new Mesh(flameGeo, new MeshBasicMaterial({ color: '#ff8a2a' }));
      flame.position.set(0, 0.6, -2.4);
      const cloud = new Group();
      const puff = new IcosahedronGeometry(1.4, 0);
      const grey = new MeshLambertMaterial({ color: '#5d5a6e', flatShading: true });
      for (const [x, y, z, sc] of [
        [0, 0, 0, 1.2],
        [1.4, -0.2, 0.3, 0.9],
        [-1.3, -0.1, -0.2, 0.95],
      ]) {
        const m = new Mesh(puff, grey);
        m.position.set(x, y, z);
        m.scale.set(sc, sc * 0.7, sc);
        cloud.add(m);
      }
      const bolt = new Mesh(new BoxGeometry(0.25, 2.6, 0.25), new MeshBasicMaterial({ color: '#ffd23f' }));
      bolt.position.y = -1.8;
      bolt.rotation.z = 0.35;
      bolt.name = 'bolt';
      cloud.add(bolt);
      cloud.position.y = 5.5;
      const sparks = [-0.9, 0.9].map((x) => {
        const m = new Mesh(this.sparkGeo, new MeshBasicMaterial({ color: '#4f9dff' }));
        m.position.set(x, 0.3, -1.4);
        return m;
      });
      root.add(shield, flame, cloud, ...sparks);
      this.cars.push({ root, body: car, wheels, tag, spin: 0, fx: { shield, flame, cloud, sparks }, mats, ghost: false });
      this.dark.push(0);
      const cam = new PerspectiveCamera(68, 16 / 9, 0.3, 900);
      cam.layers.enableAll();
      cam.layers.disable(i + 1); // don't show your own name tag
      this.cams.push(cam);
      this.camPos.push(new Vector3());
    });
  }

  /** Change the size of the drawing area (a phone turned sideways). */
  resize(view: Viewport) {
    this.view = view;
    this.renderer.setSize(Math.round(view.width * view.scale), Math.round(view.height * view.scale), false);
  }

  dispose() {
    this.clearWorld();
    this.renderer.dispose();
  }

  private clearWorld() {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.world.clear();
  }

  private keep<T extends BufferGeometry | Material | CanvasTexture>(x: T): T {
    this.disposables.push(x);
    return x;
  }

  /** Build the scenery for a new track. */
  setTrack(t: Track) {
    this.clearWorld();
    this.track = t;
    const rnd = mulberry32(t.seed * 7 + 1);
    const n = t.n;

    // Bounds of the track.
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      minX = Math.min(minX, t.xs[i]);
      maxX = Math.max(maxX, t.xs[i]);
      minZ = Math.min(minZ, t.zs[i]);
      maxZ = Math.max(maxZ, t.zs[i]);
    }
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const size = Math.max(maxX - minX, maxZ - minZ) + 520;

    // Nearest centre-line sample, for terrain heights.
    const nearest = (x: number, z: number, ground = false) => {
      let best = 0;
      let bd = Infinity;
      for (let i = 0; i < n; i += 2) {
        if (ground && t.bridge[i]) continue;
        const d = (t.xs[i] - x) ** 2 + (t.zs[i] - z) ** 2;
        if (d < bd) {
          bd = d;
          best = i;
        }
      }
      return { i: best, d: Math.sqrt(bd) };
    };
    const hillPhase = rnd() * 10;
    const river = t.river;
    const terrain = (x: number, z: number) => {
      const { i, d } = nearest(x, z, true);
      const near = t.hs[i] - 0.35;
      const k = Math.min(1, Math.max(0, (d - WALL - 4) / 70));
      const hills = 9 * Math.sin(x * 0.021 + hillPhase) * Math.cos(z * 0.017 - hillPhase) + 5 * Math.sin((x + z) * 0.045);
      const h = near + k * k * (3 - 2 * k) * (hills + 4 - t.hs[i]);
      if (!river) return h;
      // The river carves a channel with sloping banks.
      const rc = riverCoords(river, x, z);
      return Math.min(h, waterLevel(river, rc.s) - 1.6 + Math.max(0, Math.abs(rc.d) - river.half + 1) * 0.5);
    };
    const inTunnelHill = (x: number, z: number, pad = 0) => {
      if (!t.tunnel) return false;
      const { i, d } = nearest(x, z);
      return d < t.tunnel.hill + pad && inRange(i, t.tunnel.from - 2, t.tunnel.len + 4, n);
    };
    const nearRiver = (x: number, z: number, pad = 0) => !!river && Math.abs(riverCoords(river, x, z).d) < river.half + pad;

    // Ground: a faceted grid following the road, with rolling hills further out.
    const seg = 128;
    const groundGeo = this.keep(new PlaneGeometry(size, size, seg, seg));
    groundGeo.rotateX(-Math.PI / 2);
    groundGeo.translate(cx, 0, cz);
    const gp = groundGeo.attributes.position as BufferAttribute;
    const colors = new Float32Array(gp.count * 3);
    const grass = new Color();
    for (let i = 0; i < gp.count; i++) {
      gp.setY(i, terrain(gp.getX(i), gp.getZ(i)));
      grass.setHSL(0.23 + (rnd() - 0.5) * 0.04, 0.45, 0.36 + (rnd() - 0.5) * 0.07);
      colors.set([grass.r, grass.g, grass.b], i * 3);
    }
    groundGeo.setAttribute('color', new BufferAttribute(colors, 3));
    groundGeo.computeVertexNormals();
    const grassTex = this.keep(pixelTexture(32, (ctx, r) => noise(ctx, r, 32, [215, 225, 200], 60), 3));
    grassTex.repeat.set(size / 10, size / 10);
    this.world.add(new Mesh(groundGeo, this.keep(new MeshLambertMaterial({ vertexColors: true, map: grassTex, flatShading: true }))));

    // Road surface.
    const roadTex = this.keep(
      pixelTexture(32, (ctx, r) => {
        noise(ctx, r, 32, [84, 82, 88], 26);
        ctx.fillStyle = '#e9e4d6';
        ctx.fillRect(1, 0, 1, 32);
        ctx.fillRect(30, 0, 1, 32);
        ctx.fillRect(15, 0, 2, 14);
      }, 5),
    );
    const strip = (offA: number, offB: number, lift: number, v: (i: number) => number) => {
      const pos = new Float32Array((n + 1) * 2 * 3);
      const uv = new Float32Array((n + 1) * 2 * 2);
      for (let k = 0; k <= n; k++) {
        const i = k % n;
        const lx = t.tz[i];
        const lz = -t.tx[i];
        const y = t.hs[i] + lift;
        pos.set([t.xs[i] + lx * offA, y, t.zs[i] + lz * offA, t.xs[i] + lx * offB, y, t.zs[i] + lz * offB], k * 6);
        uv.set([0, v(k), 1, v(k)], k * 4);
      }
      const idx: number[] = [];
      for (let k = 0; k < n; k++) {
        const a = k * 2;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
      const g = this.keep(new BufferGeometry());
      g.setAttribute('position', new BufferAttribute(pos, 3));
      g.setAttribute('uv', new BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    };
    const dv = (k: number) => (k === n ? t.length : t.dist[k]) / 9;
    this.world.add(new Mesh(strip(ROAD_HALF, -ROAD_HALF, 0.12, dv), this.keep(new MeshLambertMaterial({ map: roadTex, side: DoubleSide }))));

    // Red and white kerbs.
    const kerbTex = this.keep(
      pixelTexture(4, (ctx) => {
        ctx.fillStyle = '#e8335a';
        ctx.fillRect(0, 0, 4, 2);
        ctx.fillStyle = '#fff4dc';
        ctx.fillRect(0, 2, 4, 2);
      }),
    );
    const kerbMat = this.keep(new MeshLambertMaterial({ map: kerbTex, side: DoubleSide }));
    const kv = (k: number) => (k === n ? t.length : t.dist[k]) / 6;
    this.world.add(new Mesh(strip(ROAD_HALF + 1.3, ROAD_HALF, 0.16, kv), kerbMat));
    this.world.add(new Mesh(strip(-ROAD_HALF, -ROAD_HALF - 1.3, 0.16, kv), kerbMat));

    // Barriers: low striped walls at the edge of the verge.
    const wallTex = this.keep(
      pixelTexture(4, (ctx) => {
        ctx.fillStyle = '#fff4dc';
        ctx.fillRect(0, 0, 4, 4);
        ctx.fillStyle = '#2b5fae';
        ctx.fillRect(0, 0, 2, 4);
      }),
    );
    const wallMat = this.keep(new MeshLambertMaterial({ map: wallTex, side: DoubleSide }));
    for (const side of [1, -1]) {
      const pos = new Float32Array((n + 1) * 2 * 3);
      const uv = new Float32Array((n + 1) * 2 * 2);
      for (let k = 0; k <= n; k++) {
        const i = k % n;
        const off = side * (t.wall[i] + 1.6);
        const x = t.xs[i] + t.tz[i] * off;
        const z = t.zs[i] - t.tx[i] * off;
        const y = t.hs[i] - 0.4;
        pos.set([x, y, z, x, y + 1.5, z], k * 6);
        const v = (k === n ? t.length : t.dist[k]) / 8;
        uv.set([v, 0, v, 1], k * 4);
      }
      const idx: number[] = [];
      for (let k = 0; k < n; k++) idx.push(k * 2, k * 2 + 1, k * 2 + 2, k * 2 + 2, k * 2 + 1, k * 2 + 3);
      const g = this.keep(new BufferGeometry());
      g.setAttribute('position', new BufferAttribute(pos, 3));
      g.setAttribute('uv', new BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      this.world.add(new Mesh(g, wallMat));
    }

    // The road has some thickness, so hills and the bridge never show a paper-thin edge.
    const concrete = this.keep(new MeshLambertMaterial({ color: '#a9a39a', flatShading: true, side: DoubleSide }));
    for (const side of [1, -1]) {
      const off = side * (ROAD_HALF + 1.3);
      const pos = new Float32Array((n + 1) * 2 * 3);
      for (let k = 0; k <= n; k++) {
        const i = k % n;
        const x = t.xs[i] + t.tz[i] * off;
        const z = t.zs[i] - t.tx[i] * off;
        pos.set([x, t.hs[i] + 0.14, z, x, t.hs[i] - 2.5, z], k * 6);
      }
      const idx: number[] = [];
      for (let k = 0; k < n; k++) idx.push(k * 2, k * 2 + 1, k * 2 + 2, k * 2 + 2, k * 2 + 1, k * 2 + 3);
      const g = this.keep(new BufferGeometry());
      g.setAttribute('position', new BufferAttribute(pos, 3));
      g.setIndex(idx);
      g.computeVertexNormals();
      this.world.add(new Mesh(g, concrete));
    }
    // Figure eight: a concrete deck under the raised road, standing on pillars.
    if (t.crossing) {
      const pos: number[] = [];
      const side: number[] = [];
      const deckW = WALL + 1.7;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        if (!t.bridge[i] || !t.bridge[j]) continue;
        const p = (k: number, o: number, dy: number) => [t.xs[k] + t.tz[k] * o, t.hs[k] + dy, t.zs[k] - t.tx[k] * o];
        // Deck top (just under the road) and underside.
        for (const dy of [0.04, -1.4]) pos.push(...p(i, deckW, dy), ...p(j, deckW, dy), ...p(i, -deckW, dy), ...p(i, -deckW, dy), ...p(j, deckW, dy), ...p(j, -deckW, dy));
        // Deck edges.
        for (const o of [deckW, -deckW]) side.push(...p(i, o, 0.04), ...p(i, o, -1.4), ...p(j, o, 0.04), ...p(j, o, 0.04), ...p(i, o, -1.4), ...p(j, o, -1.4));
      }
      const deck = this.keep(new BufferGeometry());
      deck.setAttribute('position', new BufferAttribute(new Float32Array([...pos, ...side]), 3));
      deck.computeVertexNormals();
      this.world.add(new Mesh(deck, concrete));
      const pillarGeo = this.keep(new BoxGeometry(1.8, 1, 1.8));
      pillarGeo.translate(0, 0.5, 0);
      for (let i = 0; i < n; i += 9) {
        if (!t.bridge[i]) continue;
        for (const o of [WALL - 2, -(WALL - 2)]) {
          const x = t.xs[i] + t.tz[i] * o;
          const z = t.zs[i] - t.tx[i] * o;
          const ground = terrain(x, z) - 1;
          const top = t.hs[i] - 1.3;
          if (top - ground < 1.5) continue;
          // Keep pillars off the road underneath.
          const u = t.crossing.under;
          let clear = true;
          for (let k = -40; k <= 40 && clear; k += 2) {
            const q = (u + k + n) % n;
            if (Math.hypot(t.xs[q] - x, t.zs[q] - z) < WALL + 2.5) clear = false;
          }
          if (!clear) continue;
          const pillar = new Mesh(pillarGeo, concrete);
          pillar.position.set(x, ground, z);
          pillar.scale.y = top - ground;
          this.world.add(pillar);
        }
      }
    }

    if (t.tunnel) this.buildTunnel(t, terrain);
    if (river) this.buildRiver(t, terrain);

    // Start / finish: chequered line and a gantry.
    const checker = this.keep(
      pixelTexture(8, (ctx) => {
        for (let y = 0; y < 8; y++)
          for (let x = 0; x < 8; x++) {
            ctx.fillStyle = (x + y) % 2 ? '#111' : '#f4f4f4';
            ctx.fillRect(x, y, 1, 1);
          }
      }),
    );
    checker.repeat.set(4, 0.5);
    const lineGeo = this.keep(new PlaneGeometry(ROAD_HALF * 2, 2));
    const line = new Mesh(lineGeo, this.keep(new MeshBasicMaterial({ map: checker })));
    line.rotation.x = -Math.PI / 2;
    const gantry = new Group();
    gantry.add(line);
    line.position.y = 0.2;
    const postMat = this.keep(new MeshLambertMaterial({ color: '#c9ccd3', flatShading: true }));
    const postGeo = this.keep(new BoxGeometry(0.6, 7, 0.6));
    for (const x of [-ROAD_HALF - 2, ROAD_HALF + 2]) {
      const post = new Mesh(postGeo, postMat);
      post.position.set(x, 3.5, 0);
      gantry.add(post);
    }
    const bannerTex = this.keep(
      (() => {
        const c = document.createElement('canvas');
        c.width = 160;
        c.height = 16;
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = '#e8335a';
        ctx.fillRect(0, 0, 160, 16);
        ctx.fillStyle = '#ffd23f';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('KOGIEL MOGIEL RALLY', 80, 12, 150);
        const tex = new CanvasTexture(c);
        tex.magFilter = tex.minFilter = NearestFilter;
        tex.colorSpace = SRGBColorSpace;
        return tex;
      })(),
    );
    const banner = new Mesh(this.keep(new BoxGeometry(ROAD_HALF * 2 + 4.6, 1.6, 0.4)), this.keep(new MeshLambertMaterial({ map: bannerTex })));
    banner.position.y = 6.6;
    gantry.add(banner);
    gantry.position.set(t.xs[0], t.hs[0], t.zs[0]);
    gantry.rotation.y = Math.PI / 2 - Math.atan2(t.tz[0], t.tx[0]);
    this.world.add(gantry);

    // The town.
    const obstacles: Obstacle[] = buildTown({
      t,
      roadDist: (x, z) => nearest(x, z).d,
      terrain,
      rnd,
      keep: (x) => this.keep(x),
      world: this.world,
      blocked: (x, z, r) => nearRiver(x, z, r + 6) || inTunnelHill(x, z, r + 4),
    });

    // Trees: low-poly pines and birches, instanced.
    const treeCount = 420;
    const crown = this.keep(new ConeGeometry(2.6, 7, 5));
    crown.translate(0, 6, 0);
    const trunk = this.keep(new CylinderGeometry(0.35, 0.45, 3, 5));
    trunk.translate(0, 1.5, 0);
    const crowns = new InstancedMesh(crown, this.keep(new MeshLambertMaterial({ flatShading: true })), treeCount);
    const trunks = new InstancedMesh(trunk, this.keep(new MeshLambertMaterial({ color: '#6b4428', flatShading: true })), treeCount);
    const m = new Matrix4();
    const dummy = new Object3D();
    const leaf = new Color();
    let placed = 0;
    for (let tries = 0; placed < treeCount && tries < treeCount * 8; tries++) {
      const x = cx + (rnd() - 0.5) * (size - 40);
      const z = cz + (rnd() - 0.5) * (size - 40);
      const { d } = nearest(x, z);
      if (d < WALL + 6) continue;
      if (obstacles.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + 3)) continue;
      if (nearRiver(x, z, 5) || inTunnelHill(x, z, 4)) continue;
      // Thicker forest a little away from the road, sparse far out.
      if (d > 120 && rnd() < 0.55) continue;
      dummy.position.set(x, terrain(x, z) - 0.2, z);
      const s = 0.7 + rnd() * 0.8;
      dummy.scale.set(s, s * (0.8 + rnd() * 0.5), s);
      dummy.rotation.y = rnd() * Math.PI;
      dummy.updateMatrix();
      m.copy(dummy.matrix);
      crowns.setMatrixAt(placed, m);
      trunks.setMatrixAt(placed, m);
      leaf.setHSL(0.28 + (rnd() - 0.5) * 0.08, 0.5, 0.22 + rnd() * 0.12);
      crowns.setColorAt(placed, leaf);
      placed++;
    }
    crowns.count = trunks.count = placed;
    crowns.frustumCulled = trunks.frustumCulled = false;
    this.world.add(crowns, trunks);

    // Distant mountains, faded by the fog.
    const mountMat = this.keep(new MeshLambertMaterial({ color: '#8d7fa0', flatShading: true }));
    const r = size * 0.62;
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2 + rnd() * 0.2;
      const h = 70 + rnd() * 90;
      const mtn = new Mesh(this.keep(new ConeGeometry(60 + rnd() * 50, h, 5)), mountMat);
      mtn.position.set(cx + Math.cos(a) * r, h / 2 - 10, cz + Math.sin(a) * r);
      mtn.rotation.y = rnd() * Math.PI;
      this.world.add(mtn);
    }
  }

  /** Build a mesh from flat triangle positions. */
  private tris(pos: number[], mat: Material, colors?: number[]) {
    const g = this.keep(new BufferGeometry());
    g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    if (colors) g.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
    g.computeVertexNormals();
    const m = new Mesh(g, mat);
    this.world.add(m);
    return m;
  }

  /** A tunnel through a grassy hill, with stone portals and lamps along the ceiling. */
  private buildTunnel(t: Track, terrain: (x: number, z: number) => number) {
    const { from, len, hill } = t.tunnel!;
    const n = t.n;
    const W = TUNNEL_WALL + 1.7;
    const H = TUNNEL_HEIGHT;
    const at = (k: number) => (from + k + n) % n;
    const p = (i: number, o: number, dy: number) => [t.xs[i] + t.tz[i] * o, t.hs[i] + dy, t.zs[i] - t.tx[i] * o];
    const quad = (out: number[], a: number[], b: number[], c: number[], d: number[]) => out.push(...a, ...b, ...c, ...c, ...b, ...d);

    // The bore: walls, a chamfered ceiling.
    const profile: [number, number][] = [
      [-W, -0.3],
      [-W, H * 0.72],
      [-W * 0.62, H],
      [W * 0.62, H],
      [W, H * 0.72],
      [W, -0.3],
    ];
    const bore: number[] = [];
    for (let k = 0; k < len; k++) {
      const i = at(k);
      const j = at(k + 1);
      for (let q = 0; q < profile.length - 1; q++) {
        const [o1, y1] = profile[q];
        const [o2, y2] = profile[q + 1];
        quad(bore, p(i, o1, y1), p(j, o1, y1), p(i, o2, y2), p(j, o2, y2));
      }
    }
    const stoneTex = this.keep(
      pixelTexture(16, (ctx, r) => {
        noise(ctx, r, 16, [96, 88, 84], 30);
        ctx.fillStyle = 'rgba(30,24,22,.55)';
        for (let y = 0; y < 16; y += 4) ctx.fillRect(0, y, 16, 1);
        for (let y = 0; y < 16; y += 4) ctx.fillRect(((y / 4) % 2) * 8, y, 1, 4);
      }, 11),
    );
    const boreMesh = this.tris(bore, this.keep(new MeshLambertMaterial({ color: '#8a817a', side: DoubleSide, flatShading: true })));
    // Lamps along the ceiling.
    const lampGeo = this.keep(new BoxGeometry(2.2, 0.25, 0.7));
    const lampMat = this.keep(new MeshBasicMaterial({ color: '#ffe08a' }));
    for (let k = 3; k < len - 2; k += 5) {
      const i = at(k);
      const [x, y, z] = p(i, 0, H - 0.15);
      const lamp = new Mesh(lampGeo, lampMat);
      lamp.position.set(x, y, z);
      lamp.rotation.y = Math.PI / 2 - Math.atan2(t.tz[i], t.tx[i]);
      this.world.add(lamp);
    }
    void boreMesh;

    // The hill over it: a ridge following the tunnel, falling away to the terrain at the sides.
    const top = H + 3;
    const cols = [-hill, -hill * 0.72, -hill * 0.46, -(W + 3), -W, -W * 0.62, 0, W * 0.62, W, W + 3, hill * 0.46, hill * 0.72, hill].filter(
      (o, q, all) => q === 0 || o > all[q - 1] + 0.5,
    );
    const height = (i: number, o: number, k: number) => {
      const a = Math.abs(o);
      const crest = t.hs[i] + top + 2.5 * Math.sin(k * 0.21 + o * 0.15) + 3 * Math.sin((k / len) * Math.PI);
      if (a <= W + 3) return crest;
      const u = Math.min(1, (a - W - 3) / (hill - W - 3));
      const [x, , z] = p(i, o, 0);
      return crest + (terrain(x, z) - 0.6 - crest) * u * u * (3 - 2 * u);
    };
    const hillPos: number[] = [];
    const hillCol: number[] = [];
    const grass = new Color();
    const rnd = mulberry32(t.seed + 99);
    const shade = (y: number, i: number) => {
      const rock = y - t.hs[i] > top + 1 && rnd() < 0.3;
      if (rock) grass.setHSL(0.08, 0.12, 0.42 + rnd() * 0.08);
      else grass.setHSL(0.24 + (rnd() - 0.5) * 0.05, 0.42, 0.33 + rnd() * 0.07);
      return [grass.r, grass.g, grass.b];
    };
    for (let k = 0; k < len; k++) {
      const i = at(k);
      const j = at(k + 1);
      for (let q = 0; q < cols.length - 1; q++) {
        const a = p(i, cols[q], 0);
        const b = p(j, cols[q], 0);
        const c = p(i, cols[q + 1], 0);
        const d = p(j, cols[q + 1], 0);
        a[1] = height(i, cols[q], k);
        b[1] = height(j, cols[q], k + 1);
        c[1] = height(i, cols[q + 1], k);
        d[1] = height(j, cols[q + 1], k + 1);
        quad(hillPos, a, b, c, d);
        const col = shade(Math.max(a[1], d[1]), i);
        for (let v = 0; v < 6; v++) hillCol.push(...col);
      }
    }
    // Hill ends: close the hill around the tunnel mouth.
    for (const [k, face] of [
      [0, 1],
      [len, -1],
    ] as const) {
      const i = at(k);
      for (let q = 0; q < cols.length - 1; q++) {
        const bottom = (o: number) => {
          const a = Math.abs(o);
          return a < W - 0.01 ? (a <= W * 0.62 + 0.01 ? H : H * 0.72) : -0.6;
        };
        const a = p(i, cols[q], bottom(cols[q]));
        const b = p(i, cols[q + 1], bottom(cols[q + 1]));
        const c = p(i, cols[q], 0);
        const d = p(i, cols[q + 1], 0);
        c[1] = height(i, cols[q], k);
        d[1] = height(i, cols[q + 1], k);
        if (face > 0) quad(hillPos, a, c, b, d);
        else quad(hillPos, a, b, c, d);
        const col = shade(c[1], i);
        for (let v = 0; v < 6; v++) hillCol.push(...col);
      }
    }
    this.tris(hillPos, this.keep(new MeshLambertMaterial({ vertexColors: true, flatShading: true, side: DoubleSide })), hillCol);

    // Stone portals around both mouths.
    const portalMat = this.keep(new MeshLambertMaterial({ map: stoneTex, flatShading: true }));
    stoneTex.repeat.set(2, 2);
    const pillarGeo = this.keep(new BoxGeometry(2.2, H + 1.6, 1.6));
    const lintelGeo = this.keep(new BoxGeometry(2 * W + 4.4, 2.2, 1.8));
    const signTex = this.keep(
      (() => {
        const c = document.createElement('canvas');
        c.width = 64;
        c.height = 16;
        const ctx = c.getContext('2d')!;
        ctx.fillStyle = '#ffd23f';
        ctx.fillRect(0, 0, 64, 16);
        ctx.fillStyle = '#2a120a';
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('TUNEL', 32, 12);
        const tex = new CanvasTexture(c);
        tex.magFilter = tex.minFilter = NearestFilter;
        tex.colorSpace = SRGBColorSpace;
        return tex;
      })(),
    );
    const signGeo = this.keep(new BoxGeometry(6, 1.5, 0.3));
    const signMat = this.keep(new MeshLambertMaterial({ map: signTex }));
    for (const [k, out] of [
      [0, -1],
      [len, 1],
    ] as const) {
      const i = at(k);
      const g = new Group();
      for (const o of [-W - 1.1, W + 1.1]) {
        const pillar = new Mesh(pillarGeo, portalMat);
        pillar.position.set(o, (H + 1.6) / 2 - 0.6, 0);
        g.add(pillar);
      }
      const lintel = new Mesh(lintelGeo, portalMat);
      lintel.position.set(0, H + 0.9, 0);
      g.add(lintel);
      const sign = new Mesh(signGeo, signMat);
      sign.position.set(0, H + 0.9, out * 1.0);
      if (out < 0) sign.rotation.y = Math.PI;
      g.add(sign);
      const [x, y, z] = p(i, 0, 0);
      g.position.set(x, y, z);
      // Local +x is the road's left-hand side.
      g.rotation.y = -Math.atan2(-t.tx[i], t.tz[i]);
      this.world.add(g);
    }
  }

  /** The river: water along a straight channel, and a red steel bridge wherever the road crosses. */
  private buildRiver(t: Track, terrain: (x: number, z: number) => number) {
    const r = t.river!;
    const n = t.n;
    // Water: a long strip down the channel, following the water level.
    this.water = this.keep(
      pixelTexture(16, (ctx, rr) => {
        noise(ctx, rr, 16, [70, 140, 190], 26);
        ctx.fillStyle = 'rgba(230,245,255,.55)';
        for (let k = 0; k < 7; k++) ctx.fillRect(Math.floor(rr() * 14), Math.floor(rr() * 16), 3, 1);
      }, 21),
    );
    let minS = Infinity;
    let maxS = -Infinity;
    for (let i = 0; i < n; i += 4) {
      const s = riverCoords(r, t.xs[i], t.zs[i]).s;
      minS = Math.min(minS, s);
      maxS = Math.max(maxS, s);
    }
    minS -= 500;
    maxS += 500;
    const w = r.half + 2.5;
    const steps = Math.ceil((maxS - minS) / 16);
    const pos = new Float32Array((steps + 1) * 2 * 3);
    const uv = new Float32Array((steps + 1) * 2 * 2);
    for (let k = 0; k <= steps; k++) {
      const s = minS + ((maxS - minS) * k) / steps;
      const y = waterLevel(r, s);
      const cx = r.x0 + r.dx * s;
      const cz = r.z0 + r.dz * s;
      pos.set([cx + r.dz * w, y, cz - r.dx * w, cx - r.dz * w, y, cz + r.dx * w], k * 6);
      uv.set([0, s / 12, (2 * w) / 12, s / 12], k * 4);
    }
    const idx: number[] = [];
    for (let k = 0; k < steps; k++) idx.push(k * 2, k * 2 + 2, k * 2 + 1, k * 2 + 1, k * 2 + 2, k * 2 + 3);
    const g = this.keep(new BufferGeometry());
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('uv', new BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    this.world.add(new Mesh(g, this.keep(new MeshLambertMaterial({ map: this.water, side: DoubleSide, emissive: '#16405e', emissiveIntensity: 0.35 }))));

    const concrete = this.keep(new MeshLambertMaterial({ color: '#a9a39a', flatShading: true, side: DoubleSide }));
    const steel = this.keep(new MeshLambertMaterial({ color: '#c0392b', flatShading: true }));
    const p = (i: number, o: number, dy: number) => [t.xs[i] + t.tz[i] * o, t.hs[i] + dy, t.zs[i] - t.tx[i] * o];
    const beam = (a: number[], b: number[], thick: number) => {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
      const m = new Mesh(this.beamGeo(), steel);
      m.scale.set(thick, thick, len);
      m.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
      m.lookAt(b[0], b[1], b[2]);
      this.world.add(m);
    };
    for (const b of r.bridges) {
      const deckW = BRIDGE_WALL + 1.7;
      const deck: number[] = [];
      for (let k = -2; k < b.len + 2; k++) {
        const i = (b.from + k + n) % n;
        const j = (i + 1) % n;
        for (const dy of [0.04, -1.3]) deck.push(...p(i, deckW, dy), ...p(j, deckW, dy), ...p(i, -deckW, dy), ...p(i, -deckW, dy), ...p(j, deckW, dy), ...p(j, -deckW, dy));
        for (const o of [deckW, -deckW]) deck.push(...p(i, o, 0.04), ...p(i, o, -1.3), ...p(j, o, 0.04), ...p(j, o, 0.04), ...p(i, o, -1.3), ...p(j, o, -1.3));
      }
      this.tris(deck, concrete);
      // Bow-string arches on both sides, with hangers down to the deck.
      for (const side of [1, -1]) {
        const o = side * (BRIDGE_WALL + 2.1);
        let prev: number[] | null = null;
        for (let k = 0; k <= b.len; k++) {
          const i = (b.from + k) % n;
          const rise = 1.2 + 5.5 * Math.sin((Math.PI * k) / b.len);
          const q = p(i, o, rise);
          if (prev) beam(prev, q, 0.45);
          if (k > 0 && k < b.len && k % 2 === 0) beam(p(i, o, 1.2), q, 0.18);
          prev = q;
        }
        beam(p(b.from, o, 1.2), p((b.from + b.len) % n, o, 1.2), 0.35);
      }
      // Piers where the banks meet the water.
      const pierGeo = this.keep(new BoxGeometry(2 * deckW, 1, 2.2));
      pierGeo.translate(0, -0.5, 0);
      for (let k = 0; k < b.len; k++) {
        const i = (b.from + k) % n;
        const j = (i + 1) % n;
        const di = Math.abs(riverCoords(r, t.xs[i], t.zs[i]).d) - r.half;
        const dj = Math.abs(riverCoords(r, t.xs[j], t.zs[j]).d) - r.half;
        if (Math.sign(di) === Math.sign(dj)) continue;
        const [x, y, z] = p(i, 0, -1.3);
        const bed = Math.min(terrain(x, z), waterLevel(r, riverCoords(r, x, z).s) - 1.6);
        const pier = new Mesh(pierGeo, concrete);
        pier.position.set(x, y, z);
        pier.scale.y = Math.max(0.5, y - bed);
        pier.rotation.y = Math.PI / 2 - Math.atan2(t.tz[i], t.tx[i]);
        this.world.add(pier);
      }
    }
  }

  private beamBox: BoxGeometry | null = null;
  private beamGeo() {
    if (!this.beamBox) this.beamBox = new BoxGeometry(1, 1, 1);
    return this.beamBox;
  }

  /** Snap the chase cameras behind the cars (at the start of a race). */
  resetCameras(cars: Car[]) {
    cars.forEach((c, i) => this.camPos[i].set(c.x - Math.cos(c.heading) * 8, c.h + 3.4, c.z - Math.sin(c.heading) * 8));
  }

  /** Show item boxes, butter and pickles; pools grow as needed. */
  private updateItems(st: RaceState, now: number) {
    while (this.boxMeshes.length < st.boxes.length) {
      const m = new Mesh(this.boxGeo, this.boxMat);
      this.scene.add(m);
      this.boxMeshes.push(m);
    }
    this.boxMat.color.setHSL((now / 2400) % 1, 0.75, 0.72);
    this.boxMeshes.forEach((m, i) => {
      const b = st.boxes[i];
      m.visible = !!b && b.back <= st.time;
      if (!m.visible) return;
      m.position.set(b.x, b.h + Math.sin(now / 300 + i) * 0.25, b.z);
      m.rotation.set(0.5, now / 700 + i, 0.3);
    });
    while (this.slickMeshes.length < st.slicks.length) {
      const g = new Group();
      const butter = new Group();
      butter.name = 'butter';
      const puddle = new Mesh(this.slickParts.puddle, this.slickParts.puddleMat);
      puddle.scale.set(1, 1, 0.75);
      const pat = new Mesh(this.slickParts.pat, this.slickParts.patMat);
      pat.position.set(0.4, 0.25, 0.2);
      pat.rotation.y = 0.6;
      butter.add(puddle, pat);
      const hay = new Group();
      hay.name = 'hay';
      const bale = new Mesh(this.hayParts.bale, this.hayParts.mat);
      bale.rotation.z = Math.PI / 2;
      bale.position.y = 1.2;
      hay.add(bale);
      for (const x of [-0.7, 0.7]) {
        const band = new Mesh(this.hayParts.band, this.hayParts.bandMat);
        band.rotation.z = Math.PI / 2;
        band.position.set(x, 1.2, 0);
        hay.add(band);
      }
      const spray = new Group();
      spray.name = 'spray';
      for (const [x, y, z, r] of [
        [0, 1.6, 0, 2.6],
        [1.9, 1.1, 0.8, 1.9],
        [-1.8, 1.3, -0.6, 2.1],
        [0.6, 3, -0.9, 1.7],
        [-0.7, 2.6, 1.3, 1.6],
      ]) {
        const puff = new Mesh(this.sprayParts.puff, this.sprayParts.mat);
        puff.position.set(x, y, z);
        puff.scale.setScalar(r);
        spray.add(puff);
      }
      g.add(butter, hay, spray);
      this.scene.add(g);
      this.slickMeshes.push(g);
    }
    this.slickMeshes.forEach((g, i) => {
      const s = st.slicks[i];
      g.visible = !!s;
      if (!s) return;
      g.position.set(s.x, s.h + 0.18, s.z);
      g.rotation.y = Math.PI / 2 - s.heading;
      g.getObjectByName('butter')!.visible = s.kind === 'butter';
      g.getObjectByName('hay')!.visible = s.kind === 'hay';
      const spray = g.getObjectByName('spray')!;
      spray.visible = s.kind === 'spray';
      if (spray.visible) spray.rotation.y = now / 1400 + i;
    });
    while (this.bombMeshes.length < st.bombs.length) {
      const m = new Mesh(this.bombGeo, this.bombMat);
      this.scene.add(m);
      this.bombMeshes.push(m);
    }
    this.bombMeshes.forEach((m, i) => {
      const b = st.bombs[i];
      m.visible = !!b;
      if (!b) return;
      // A lob: up and back down by the time the fuse runs out.
      const arc = Math.sin(Math.PI * Math.min(1, b.age / ITUNING.bombFuse));
      m.position.set(b.x, b.h + 1.1 + arc * 7, b.z);
      m.rotation.set(b.age * 9, b.age * 5, 0);
    });
    while (this.blastMeshes.length < st.blasts.length) {
      const m = new Mesh(this.blastGeo, this.blastMat);
      this.scene.add(m);
      this.blastMeshes.push(m);
    }
    this.blastMeshes.forEach((m, i) => {
      const b = st.blasts[i];
      m.visible = !!b;
      if (!b) return;
      const age = Math.max(0, st.time - b.at);
      const r = 2 + (age / 0.6) * ITUNING.bombRadius;
      m.position.set(b.x, b.h + 1, b.z);
      m.scale.set(r, r * 0.6, r);
    });
    this.blastMat.opacity = 0.65;
    if (this.water) this.water.offset.y = -now / 2600;
    while (this.pickleMeshes.length < st.pickles.length) {
      const m = new Mesh(this.pickleGeo, this.pickleMat);
      this.scene.add(m);
      this.pickleMeshes.push(m);
    }
    this.pickleMeshes.forEach((m, i) => {
      const p = st.pickles[i];
      m.visible = !!p;
      if (!p) return;
      m.position.set(p.x, p.h + 1 + Math.sin(now / 60) * 0.15, p.z);
      // Capsules stand along y: lay it down along the road and give it a wobble.
      m.rotation.set(Math.PI / 2, 0, 0);
      m.rotation.order = 'YXZ';
      m.rotation.y = Math.PI / 2 - p.heading;
      m.rotation.z = now / 90;
    });
  }

  /**
   * Draw one view per slot. Slot k follows car `focus[k]` (default: car k).
   * Slots are in viewport units (the 1920×1080 stage on the TV).
   */
  render(st: RaceState, layout: Slot[], dt: number, focus?: number[]) {
    const t = this.track;
    if (!t) return;
    const cars = st.cars;
    const now = performance.now();
    this.updateItems(st, now);
    const k = this.view.scale;
    const H = Math.round(this.view.height * k);
    const follow = 1 - Math.exp(-dt * 5);
    cars.forEach((c, i) => {
      const car = this.cars[i];
      if (!car) return;
      const yaw = Math.PI / 2 - c.heading;
      // Pitch from the road slope in the direction we're facing; a little bounce on the grass.
      const n = t.n;
      const slope = (t.hs[(c.hint + 1) % n] - t.hs[c.hint]) / 2;
      const along = Math.cos(c.heading - Math.atan2(t.tz[c.hint], t.tx[c.hint]));
      const bump = c.onRoad ? 0 : Math.sin(performance.now() / 45 + i) * 0.06 * Math.min(1, Math.abs(c.speed) / 10);
      car.root.position.set(c.x, c.h + 0.12 + bump, c.z);
      car.root.rotation.set(0, yaw, 0);
      car.body.rotation.set(-Math.atan(slope * along), c.spinAngle, 0);
      car.fx.shield.visible = c.shield > 0 && (c.shield > 2 || Math.floor(now / 120) % 2 === 0);
      // Drift sparks: blue, then orange once a super turbo is ready.
      const level = driftLevel(c);
      for (const [k, sp] of car.fx.sparks.entries()) {
        sp.visible = level > 0 && Math.random() < 0.8;
        if (!sp.visible) continue;
        (sp.material as MeshBasicMaterial).color.set(level === 2 ? (k ? '#ff8a2a' : '#ffd23f') : k ? '#4f9dff' : '#9cc8ff');
        sp.scale.setScalar(0.7 + Math.random() * (level === 2 ? 1.1 : 0.7));
        sp.rotation.set(Math.random() * 3, Math.random() * 3, 0);
      }
      car.fx.flame.visible = c.boost > 0 || c.rocket > 0;
      if (car.fx.flame.visible) {
        const big = c.rocket > 0 ? 2.2 : 1;
        car.fx.flame.scale.set(big, big, big * (0.8 + Math.random() * 0.5));
        (car.fx.flame.material as MeshBasicMaterial).color.set(c.rocket > 0 ? '#ffd23f' : '#ff8a2a');
      }
      car.fx.cloud.visible = c.slow > 0;
      if (c.slow > 0) car.fx.cloud.getObjectByName('bolt')!.visible = Math.floor(now / 90) % 5 === 0;
      car.spin += (c.speed * dt) / 0.36;
      for (const w of car.wheels) w.rotation.x = car.spin;
      // Babcia's ghost: see-through.
      const ghost = c.ghost > 0;
      if (ghost !== car.ghost) {
        car.ghost = ghost;
        for (const m of car.mats) {
          m.transparent = ghost;
          m.opacity = ghost ? 0.35 : 1;
          m.depthWrite = !ghost;
        }
      }
    });

    layout.forEach((slot, s) => {
      const i = focus ? focus[s] : s;
      const c = cars[i];
      const cam = this.cams[i];
      if (!c || !cam) return;
      // Darker inside the tunnel (the lamps stay bright).
      this.dark[i] += (tunnelDepth(t, c.hint) - this.dark[i]) * Math.min(1, dt * 4);
      for (const l of this.lights) l.light.intensity = l.base * (1 - 0.72 * this.dark[i]);
      // Follow where the car is going, not where its nose points (they differ in a drift).
      const fx = Math.cos(c.heading - c.slip * 0.75);
      const fz = Math.sin(c.heading - c.slip * 0.75);
      const back = c.speed < -1 ? -1 : 1;
      const want = new Vector3(c.x - fx * 8 * back, c.h + 3.4, c.z - fz * 8 * back);
      this.camPos[i].lerp(want, follow);
      cam.position.copy(this.camPos[i]);
      cam.lookAt(c.x + fx * 5, c.h + 1.2, c.z + fz * 5);
      cam.aspect = slot.w / slot.h;
      cam.fov = 64 + Math.min(14, Math.abs(c.speed) * 0.3);
      cam.updateProjectionMatrix();
      // Name tags only for cars a little way ahead: up close they'd fill the screen.
      this.cars.forEach((other, j) => (other.tag.visible = j !== i && other.root.position.distanceTo(cam.position) > 14));
      const x = Math.round(slot.x * k);
      const w = Math.round(slot.w * k);
      const h = Math.round(slot.h * k);
      const y = H - Math.round(slot.y * k) - h;
      this.renderer.setViewport(x, y, w, h);
      this.renderer.setScissor(x, y, w, h);
      this.renderer.render(this.scene, cam);
    });
  }
}
