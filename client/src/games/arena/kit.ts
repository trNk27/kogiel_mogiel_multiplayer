/**
 * Shared low-poly 3D kit for the arena games (Czołgi, Grzybki, Pushy Pierogi, Strzelnica,
 * Babcia’s Cookbook, Kafelki). Same PS2 look as Maluch Rally: a low internal resolution scaled
 * up without smoothing, flat-shaded meshes, tiny nearest-filtered textures, blob shadows and fog.
 *
 * World units are metres, y is up. A whole arena is seen by one camera (no split screen).
 */
import {
  AmbientLight,
  BoxGeometry,
  BufferAttribute,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  NearestFilter,
  PerspectiveCamera,
  RepeatWrapping,
  Scene,
  SphereGeometry,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  Vector3,
  WebGLRenderer,
  type Material,
  type Object3D,
} from 'three';
import { mulberry32 } from '../rng';
import { StylePass, pickStyle } from './styles';

/** Internal resolution as a fraction of the 1920×1080 stage (same as Maluch Rally). */
export const ARENA_SCALE = 0.45;
export const STAGE_W = 1920;
export const STAGE_H = 1080;

/** A tiny nearest-filtered texture painted on a canvas. */
export function pixelTexture(size: number, paint: (ctx: CanvasRenderingContext2D, rnd: () => number) => void, seed = 1, repeat = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  paint(ctx, mulberry32(seed));
  const t = new CanvasTexture(c);
  t.magFilter = NearestFilter;
  t.minFilter = NearestFilter;
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Fill a canvas with per-pixel noise around a base colour. */
export function noise(ctx: CanvasRenderingContext2D, rnd: () => number, size: number, base: [number, number, number], spread: number) {
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const v = (rnd() - 0.5) * spread;
      ctx.fillStyle = `rgb(${base[0] + v},${base[1] + v},${base[2] + v * 0.6})`;
      ctx.fillRect(x, y, 1, 1);
    }
}

/** Ready-made ground textures. `repeat` tiles it that many times across a mesh. */
export function groundTexture(kind: 'grass' | 'ice' | 'wood' | 'stone' | 'sand' | 'water' | 'paper', repeat = 8, seed = 3) {
  return pixelTexture(
    16,
    (ctx, rnd) => {
      switch (kind) {
        case 'grass':
          noise(ctx, rnd, 16, [86, 140, 58], 34);
          break;
        case 'ice':
          noise(ctx, rnd, 16, [196, 228, 246], 20);
          ctx.fillStyle = 'rgba(255,255,255,.7)';
          ctx.fillRect(2, 3, 5, 1);
          ctx.fillRect(9, 11, 4, 1);
          break;
        case 'wood':
          noise(ctx, rnd, 16, [176, 118, 70], 22);
          ctx.fillStyle = 'rgba(70,35,15,.45)';
          for (const y of [0, 8]) ctx.fillRect(0, y, 16, 1);
          ctx.fillRect(6, 0, 1, 8);
          ctx.fillRect(12, 8, 1, 8);
          break;
        case 'stone':
          noise(ctx, rnd, 16, [150, 140, 128], 30);
          ctx.fillStyle = 'rgba(40,30,25,.35)';
          ctx.fillRect(0, 7, 16, 1);
          ctx.fillRect(7, 0, 1, 7);
          ctx.fillRect(3, 8, 1, 8);
          break;
        case 'sand':
          noise(ctx, rnd, 16, [222, 190, 130], 26);
          break;
        case 'water':
          noise(ctx, rnd, 16, [52, 120, 170], 22);
          ctx.fillStyle = 'rgba(255,255,255,.35)';
          ctx.fillRect(1, 4, 4, 1);
          ctx.fillRect(9, 12, 5, 1);
          break;
        case 'paper':
          noise(ctx, rnd, 16, [244, 232, 205], 10);
          break;
      }
    },
    seed,
    repeat,
  );
}

/** A name label that floats over a character (drawn on top of everything, not fogged). */
export function nameTag(text: string, color: string, scale = 3.2) {
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
  const s = new Sprite(new SpriteMaterial({ map: t, depthTest: false, fog: false }));
  s.scale.set(scale, scale / 4, 1);
  s.renderOrder = 10;
  return s;
}

/** A soft dark disc on the ground. */
export function blobShadow(radius: number, opacity = 0.35) {
  const m = new Mesh(new CircleGeometry(radius, 10), new MeshBasicMaterial({ color: '#000', transparent: true, opacity, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.03;
  return m;
}

export const flat = (color: string, extra: Partial<ConstructorParameters<typeof MeshLambertMaterial>[0]> = {}) =>
  new MeshLambertMaterial({ color, flatShading: true, ...extra });

export interface PierogiModel {
  /** Move and turn this (it faces +z when rotation.y = 0). */
  root: Group;
  /** The body, for squash, hop and wobble (origin at its feet). */
  body: Group;
  shadow: Mesh;
  mats: Material[];
}

/**
 * A low-poly pierogi character in a player's colour: a standing half-moon with a crimped edge and
 * two eyes on the front. About 1.1 m tall and 1.6 m wide; it faces +z.
 */
export function buildPierogi(color: string): PierogiModel {
  const root = new Group();
  const body = new Group();
  const dough = flat(color);
  const crimp = flat(new Color(color).multiplyScalar(0.82).getStyle());
  const white = new MeshBasicMaterial({ color: '#fff8ea' });
  const black = new MeshBasicMaterial({ color: '#1d0f0a' });

  // Half a fat disc, flat side down: a cylinder cut in half, lying on its side.
  const R = 0.85;
  const geo = new CylinderGeometry(R, R, 0.62, 12, 1, false, -Math.PI / 2, Math.PI);
  geo.rotateX(-Math.PI / 2);
  // Puff the middle out so it reads as a dumpling, not a coin.
  const pos = geo.attributes.position as BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const k = 1 - Math.min(1, Math.hypot(x, y) / R);
    pos.setZ(i, pos.getZ(i) * (0.55 + 0.9 * k));
  }
  geo.computeVertexNormals();
  const dumpling = new Mesh(geo, dough);
  body.add(dumpling);
  // Crimped edge: little bumps along the arc.
  const bump = new IcosahedronGeometry(0.13, 0);
  for (let k = 0; k <= 8; k++) {
    const a = (k / 8) * Math.PI;
    const m = new Mesh(bump, crimp);
    m.position.set(Math.cos(a) * R, Math.sin(a) * R, 0);
    body.add(m);
  }
  // Eyes on the front.
  const eyeGeo = new SphereGeometry(0.14, 6, 4);
  const pupilGeo = new SphereGeometry(0.075, 5, 3);
  for (const x of [-0.24, 0.24]) {
    const e = new Mesh(eyeGeo, white);
    e.position.set(x, 0.42, 0.24);
    e.scale.z = 0.5;
    const p = new Mesh(pupilGeo, black);
    p.position.set(x, 0.42, 0.31);
    body.add(e, p);
  }
  root.add(body);
  const shadow = blobShadow(0.95);
  shadow.scale.set(1, 0.6, 1);
  root.add(shadow);
  return { root, body, shadow, mats: [dough, crimp, white, black] };
}

/** One camera looking down at an arena centred on the origin, with Maluch Rally's lighting. */
export class ArenaStage {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  /** Everything a game adds goes here, so `clear()` can remove it. */
  readonly world = new Group();
  readonly sun: DirectionalLight;
  /** The look: original, Vaporwave or Papercraft at random, or forced with `?style=`. */
  readonly style: StylePass;
  private disposables: { dispose(): void }[] = [];

  constructor(
    canvas: HTMLCanvasElement,
    /** `styles`: the looks this game may roll (default: all of RANDOM_STYLES). */
    opts: { sky?: string; fog?: [number, number]; fov?: number; styles?: readonly string[] } = {},
  ) {
    this.style = new StylePass(pickStyle(Math.random, opts.styles));
    this.renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(Math.round(STAGE_W * ARENA_SCALE), Math.round(STAGE_H * ARENA_SCALE), false);
    const sky = new Color(opts.sky ?? '#f2b38a');
    this.scene.background = sky;
    const [near, far] = opts.fog ?? [60, 160];
    this.scene.fog = new Fog(sky, near, far);
    const hemi = new HemisphereLight('#ffe9c9', '#4a5a2a', 1.4);
    const ambient = new AmbientLight('#ffffff', 0.35);
    this.sun = new DirectionalLight('#fff1d6', 1.6);
    this.sun.position.set(-0.6, 1, 0.35);
    this.scene.add(hemi, ambient, this.sun, this.world);
    this.camera = new PerspectiveCamera(opts.fov ?? 40, STAGE_W / STAGE_H, 0.5, 400);
    this.lookAt(new Vector3(0, 0, 0), 34, 0.95);
  }

  /** Point the camera at `target` from `dist` metres away, `tilt` radians down from the horizon (π/2 = straight down). */
  lookAt(target: Vector3, dist: number, tilt: number) {
    this.camera.position.set(target.x, target.y + Math.sin(tilt) * dist, target.z + Math.cos(tilt) * dist);
    this.camera.lookAt(target);
  }

  /** Where a world point lands on the 1920×1080 stage (for DOM labels over the 3D view). */
  toStage(p: Vector3): { x: number; y: number; visible: boolean } {
    const v = p.clone().project(this.camera);
    return { x: ((v.x + 1) / 2) * STAGE_W, y: ((1 - v.y) / 2) * STAGE_H, visible: v.z < 1 };
  }

  /** Remember something to dispose with the stage. */
  keep<T extends { dispose(): void }>(x: T): T {
    this.disposables.push(x);
    return x;
  }

  add(...o: Object3D[]) {
    this.world.add(...o);
  }

  render() {
    this.style.render(this.renderer, this.scene, this.camera);
  }

  /** Remove everything the game added (between rounds, say). */
  clear() {
    this.world.clear();
  }

  dispose() {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
    this.world.traverse((o) => {
      const m = o as Mesh;
      m.geometry?.dispose?.();
      const mat = m.material as Material | Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose?.();
    });
    this.world.clear();
    this.style.dispose();
    this.renderer.dispose();
  }
}

/** A plain box, handy for crates, walls and stalls. */
export function box(w: number, h: number, d: number, mat: Material) {
  const m = new Mesh(new BoxGeometry(w, h, d), mat);
  m.position.y = h / 2;
  return m;
}
