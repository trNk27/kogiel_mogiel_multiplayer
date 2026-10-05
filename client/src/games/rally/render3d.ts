/**
 * Maluch Rally on the TV: one WebGL canvas, one viewport per player.
 * The PS2 look comes from a low internal resolution scaled up without smoothing,
 * flat-shaded low-poly meshes, tiny nearest-filtered textures, blob shadows and thick fog.
 */
import {
  AmbientLight,
  CapsuleGeometry,
  IcosahedronGeometry,
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
import { ROAD_HALF, WALL, type Track } from './track';
import type { Car, ItemBox, Pickle, Slick } from './sim';
import { buildTown, type Obstacle } from './town3d';

/** What the renderer needs from the simulation each frame. */
export interface RaceState {
  cars: Car[];
  boxes: ItemBox[];
  slicks: Slick[];
  pickles: Pickle[];
  time: number;
}

interface CarFx {
  shield: Mesh;
  flame: Mesh;
  cloud: Group;
}

/** Internal resolution as a fraction of the 1920×1080 stage. */
export const RENDER_SCALE = 0.45;
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
  ctx.font = 'bold 22px Fredoka Variable, sans-serif';
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
function buildMaluch(color: string): { car: Group; wheels: Mesh[] } {
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
  return { car, wheels };
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
  private cars: { root: Group; body: Group; wheels: Mesh[]; tag: Sprite; spin: number; fx: CarFx }[] = [];
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
  ) {
    this.renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(Math.round(1920 * RENDER_SCALE), Math.round(1080 * RENDER_SCALE), false);
    this.renderer.setScissorTest(true);
    this.scene.background = SKY;
    this.scene.fog = new Fog(SKY, FOG_NEAR, FOG_FAR);
    this.scene.add(new HemisphereLight('#ffe9c9', '#4a5a2a', 1.4));
    this.scene.add(new AmbientLight('#ffffff', 0.35));
    const sun = new DirectionalLight('#fff1d6', 1.6);
    sun.position.set(-0.6, 1, 0.35);
    this.scene.add(sun);
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
      const { car, wheels } = buildMaluch(look.color);
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
      root.add(shield, flame, cloud);
      this.cars.push({ root, body: car, wheels, tag, spin: 0, fx: { shield, flame, cloud } });
      const cam = new PerspectiveCamera(68, 16 / 9, 0.3, 900);
      cam.layers.enableAll();
      cam.layers.disable(i + 1); // don't show your own name tag
      this.cams.push(cam);
      this.camPos.push(new Vector3());
    });
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
    const terrain = (x: number, z: number) => {
      const { i, d } = nearest(x, z, true);
      const near = t.hs[i] - 0.35;
      const k = Math.min(1, Math.max(0, (d - WALL - 4) / 70));
      const hills = 9 * Math.sin(x * 0.021 + hillPhase) * Math.cos(z * 0.017 - hillPhase) + 5 * Math.sin((x + z) * 0.045);
      return near + k * k * (3 - 2 * k) * (hills + 4 - t.hs[i]);
    };

    // Ground: a faceted grid following the road, with rolling hills further out.
    const seg = 96;
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
      const off = side * (WALL + 1.6);
      const pos = new Float32Array((n + 1) * 2 * 3);
      const uv = new Float32Array((n + 1) * 2 * 2);
      for (let k = 0; k <= n; k++) {
        const i = k % n;
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
      const puddle = new Mesh(this.slickParts.puddle, this.slickParts.puddleMat);
      puddle.scale.set(1, 1, 0.75);
      const pat = new Mesh(this.slickParts.pat, this.slickParts.patMat);
      pat.position.set(0.4, 0.25, 0.2);
      pat.rotation.y = 0.6;
      g.add(puddle, pat);
      this.scene.add(g);
      this.slickMeshes.push(g);
    }
    this.slickMeshes.forEach((g, i) => {
      const s = st.slicks[i];
      g.visible = !!s;
      if (s) g.position.set(s.x, s.h + 0.18, s.z);
    });
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

  render(st: RaceState, layout: Slot[], dt: number) {
    const t = this.track;
    if (!t) return;
    const cars = st.cars;
    const now = performance.now();
    this.updateItems(st, now);
    const k = RENDER_SCALE;
    const H = Math.round(1080 * k);
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
    });

    layout.forEach((slot, i) => {
      const c = cars[i];
      const cam = this.cams[i];
      if (!c || !cam) return;
      const fx = Math.cos(c.heading);
      const fz = Math.sin(c.heading);
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
