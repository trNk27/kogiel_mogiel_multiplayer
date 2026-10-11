/**
 * Maluch Rallye Premium's car select on the TV: the four cars on turntables under the lights,
 * in the PS2 look of the races. A turntable glows and spins faster once somebody picks its car.
 */
import {
  AmbientLight,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  NearestFilter,
  PerspectiveCamera,
  PlaneGeometry,
  RepeatWrapping,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
  type Material,
} from 'three';
import { KARTS } from '../../../../shared/protocol';
import { buildKart } from '../rally/karts3d';

/** Internal resolution as a fraction of the stage: chunky pixels. */
export const SHOWROOM_SCALE = 0.45;
const SPACING = 8.4;

export class Showroom {
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(34, 16 / 9, 0.5, 300);
  private tables: { root: Group; car: Group; rim: Mesh; spin: number; wheels: Mesh[] }[] = [];
  private stuff: { dispose(): void }[] = [];

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(canvas.width, canvas.height, false);
    this.camera.aspect = canvas.width / canvas.height;
    const bg = new Color('#1d0d15');
    this.scene.background = bg;
    this.scene.fog = new Fog(bg, 30, 90);
    this.scene.add(new HemisphereLight('#ffe9c9', '#3a1e2b', 1.2), new AmbientLight('#ffffff', 0.35));
    const key = new DirectionalLight('#fff1d6', 1.8);
    key.position.set(-0.5, 1, 0.8);
    this.scene.add(key);

    // A chequered garage floor.
    const c = document.createElement('canvas');
    c.width = c.height = 8;
    const ctx = c.getContext('2d')!;
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++) {
        ctx.fillStyle = (x + y) % 2 ? '#2a1520' : '#3a1e2b';
        ctx.fillRect(x, y, 1, 1);
      }
    const tex = this.keep(new CanvasTexture(c));
    tex.magFilter = tex.minFilter = NearestFilter;
    tex.wrapS = tex.wrapT = RepeatWrapping;
    tex.repeat.set(12, 6);
    tex.colorSpace = SRGBColorSpace;
    const floor = new Mesh(this.keep(new PlaneGeometry(160, 80)), this.keep(new MeshLambertMaterial({ map: tex })));
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);

    const deck = this.keep(new CylinderGeometry(3.3, 3.5, 0.4, 18));
    const rimGeo = this.keep(new CylinderGeometry(3.55, 3.55, 0.14, 18));
    const deckMat = this.keep(new MeshLambertMaterial({ color: '#2a2630', flatShading: true }));
    KARTS.forEach((k, i) => {
      const root = new Group();
      root.position.x = (i - (KARTS.length - 1) / 2) * SPACING;
      const table = new Mesh(deck, deckMat);
      table.position.y = 0.2;
      const rim = new Mesh(rimGeo, new MeshBasicMaterial({ color: '#5a3546' }));
      rim.position.y = 0.36;
      const { car, wheels, mats } = buildKart(k.id, k.paint);
      mats.forEach((m) => this.keep(m as Material));
      car.position.y = 0.42;
      car.scale.setScalar(1.25);
      root.add(table, rim, car);
      this.scene.add(root);
      this.tables.push({ root, car, rim, spin: i * 0.8, wheels });
    });
    this.camera.position.set(0, 7.5, 27);
    this.camera.lookAt(0, 1.4, 0);
  }

  private keep<T extends { dispose(): void }>(x: T): T {
    this.stuff.push(x);
    return x;
  }

  /** `picked[k]`: how many players have picked car k. `ready`: all of them are ready to go. */
  render(dt: number, picked: number[], ready: boolean) {
    const t = performance.now() / 1000;
    this.tables.forEach((tb, i) => {
      const on = picked[i] > 0;
      tb.spin += dt * (on ? (ready ? 2.4 : 1.2) : 0.35);
      tb.car.rotation.y = tb.spin;
      tb.car.position.y = 0.42 + (on ? Math.abs(Math.sin(t * 6 + i)) * 0.08 : 0);
      (tb.rim.material as MeshBasicMaterial).color.set(on ? KARTS[i].paint : '#5a3546');
      for (const w of tb.wheels) w.rotation.x = on && ready ? t * 12 : 0;
    });
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    for (const s of this.stuff) s.dispose();
    for (const tb of this.tables) (tb.rim.material as Material).dispose();
    this.renderer.dispose();
  }
}
