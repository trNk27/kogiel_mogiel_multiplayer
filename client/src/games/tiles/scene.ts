/** Kafelki in 3D: an instanced tiled floor, pierogi, paint bombs, a mop, cracks and a pile of particles. */
import {
  BoxGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  NearestFilter,
  Object3D,
  PlaneGeometry,
  RepeatWrapping,
  RingGeometry,
  SRGBColorSpace,
  Vector3,
  type Sprite,
} from 'three';
import { ArenaStage, buildPierogi, flat, nameTag, noise, pixelTexture, type PierogiModel } from '../arena/kit';
import { CRACKED, CRACK_WARN, HOLE, MOP_WARN, SPLAT_FLIGHT, TILE, type TilesEvent, type TilesSim } from './logic';
import { buildRoom } from './room';

export interface Contender {
  name: string;
  color: string;
}

const POP = 0.42;
/** Thickness of a tile; its top is at y = 0. */
const TT = 0.38;
const MAX_PARTICLES = 700;
const MAX_CRACKS = 72;
const MAX_RINGS = 10;

interface Ring {
  mesh: Mesh;
  age: number;
  life: number;
  from: number;
  to: number;
}

interface PlayerView {
  model: PierogiModel;
  tag: Sprite;
  pin: Group;
  stars: Group;
  marker: Group;
  markerMat: MeshBasicMaterial;
  markerRing: Mesh;
  bomb: Mesh;
  /** Smoothed heading. */
  rot: number;
  bob: number;
  /** Vertical offset: negative while falling away, positive when dropping in. */
  yOff: number;
  yVel: number;
  scale: number;
  squash: number;
  spin: number;
  color: Color;
  wasDown: boolean;
}

const ease = (x: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, x)), 3);

export class TilesScene {
  readonly stage: ArenaStage;
  private tiles: InstancedMesh;
  private cracks: InstancedMesh;
  private parts: InstancedMesh;
  private cols: number;
  private rows: number;
  private W: number;
  private H: number;
  private dummy = new Object3D();
  private tmpColor = new Color();
  private players: PlayerView[] = [];
  private colors: Color[];
  // tile render state
  private shown: Int16Array;
  private popT: Float32Array;
  private waiting: Uint8Array;
  private rise: Float32Array;
  private wasAnim: Uint8Array;
  private baseA: Color;
  private baseB: Color;
  // particles
  private pc = 0;
  private ppos = new Float32Array(MAX_PARTICLES * 3);
  private pvel = new Float32Array(MAX_PARTICLES * 3);
  private plife = new Float32Array(MAX_PARTICLES * 2);
  private psize = new Float32Array(MAX_PARTICLES);
  private pgrav = new Float32Array(MAX_PARTICLES);
  private pdepth = new Float32Array(MAX_PARTICLES);
  private rings: Ring[] = [];
  private mopGroup: Group;
  private mopStrip: Mesh;
  private stripTex: CanvasTexture;
  private clock = 0;
  private shake = 0;
  private camBase = new Vector3();
  private camTarget = new Vector3();
  private ripple: { x: number; z: number } | null = null;
  private mopDrip = 0;
  private charScale: number;

  constructor(canvas: HTMLCanvasElement, who: Contender[], cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    this.W = cols * TILE;
    this.charScale = 1.2 * Math.max(1, Math.sqrt(cols / 16));
    this.H = rows * TILE;
    this.stage = new ArenaStage(canvas, { sky: '#d9b98c', fog: [120, 260], fov: 38 });
    const st = this.stage;
    this.colors = who.map((w) => new Color(w.color));
    this.baseA = new Color('#d9dfe3');
    this.baseB = new Color('#c3cbd1');
    // Lights: warm, a touch brighter overhead light for the white tiles.
    st.sun.position.set(-0.35, 1, 0.55);

    st.add(buildRoom(cols, rows, (x) => st.keep(x)));

    // The tiles: one instanced mesh.
    const tileTex = st.keep(
      pixelTexture(
        16,
        (ctx, rnd) => {
          noise(ctx, rnd, 16, [246, 246, 246], 14);
          ctx.fillStyle = 'rgba(255,255,255,.9)';
          ctx.fillRect(0, 0, 16, 1);
          ctx.fillRect(0, 0, 1, 16);
          ctx.fillStyle = 'rgba(90,100,110,.35)';
          ctx.fillRect(0, 15, 16, 1);
          ctx.fillRect(15, 0, 1, 16);
          ctx.fillStyle = 'rgba(255,255,255,.55)';
          ctx.fillRect(3, 3, 2, 1);
          ctx.fillRect(11, 10, 1, 2);
        },
        12,
        1,
      ),
    );
    const n = cols * rows;
    const tg = st.keep(new BoxGeometry(TILE * 0.92, TT, TILE * 0.92));
    const tm = st.keep(new MeshLambertMaterial({ map: tileTex, flatShading: true }));
    this.tiles = new InstancedMesh(tg, tm, n);
    this.tiles.frustumCulled = false;
    st.add(this.tiles);
    this.shown = new Int16Array(n).fill(-2);
    this.popT = new Float32Array(n).fill(POP);
    this.waiting = new Uint8Array(n);
    this.rise = new Float32Array(n).fill(1);
    this.wasAnim = new Uint8Array(n).fill(1);

    // Crack decals.
    const crackTex = st.keep(
      pixelTexture(
        32,
        (ctx) => {
          ctx.clearRect(0, 0, 32, 32);
          ctx.fillStyle = '#2a1812';
          const path = [
            [16, 16], [12, 12], [9, 12], [6, 7], [3, 6],
            [16, 16], [20, 13], [22, 8], [27, 6], [29, 3],
            [16, 16], [19, 20], [24, 21], [26, 26], [29, 28],
            [16, 16], [13, 21], [10, 22], [8, 27], [5, 30],
          ];
          let prev: number[] | null = null;
          for (const p of path) {
            if (prev && !(p[0] === 16 && p[1] === 16)) {
              const steps = Math.max(Math.abs(p[0] - prev[0]), Math.abs(p[1] - prev[1]));
              for (let s = 0; s <= steps; s++) {
                const x = Math.round(prev[0] + ((p[0] - prev[0]) * s) / steps);
                const y = Math.round(prev[1] + ((p[1] - prev[1]) * s) / steps);
                ctx.fillRect(x - 1, y - 1, 3, 3);
              }
            }
            prev = p;
          }
        },
        2,
        1,
      ),
    );
    const cm = st.keep(new MeshBasicMaterial({ map: crackTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    const cg = st.keep(new PlaneGeometry(TILE * 0.96, TILE * 0.96));
    cg.rotateX(-Math.PI / 2);
    this.cracks = new InstancedMesh(cg, cm, MAX_CRACKS);
    this.cracks.frustumCulled = false;
    this.cracks.count = 0;
    st.add(this.cracks);

    // Particles: little chunky boxes.
    const pg = st.keep(new BoxGeometry(1, 1, 1));
    const pm = st.keep(new MeshLambertMaterial({ flatShading: true }));
    this.parts = new InstancedMesh(pg, pm, MAX_PARTICLES);
    this.parts.frustumCulled = false;
    this.parts.count = 0;
    this.parts.instanceColor = null;
    for (let i = 0; i < MAX_PARTICLES; i++) this.parts.setColorAt(i, this.tmpColor.set('#ffffff'));
    st.add(this.parts);

    // Players.
    const ringGeo = st.keep(new RingGeometry(0.98, 1.2, 20));
    ringGeo.rotateX(-Math.PI / 2);
    const bombGeo = st.keep(new IcosahedronGeometry(0.5, 1));
    const markerGeo = st.keep(new PlaneGeometry(TILE * 3 - 0.1, TILE * 3 - 0.1));
    markerGeo.rotateX(-Math.PI / 2);
    const mRingGeo = st.keep(new RingGeometry(0.9, 1.0, 24));
    mRingGeo.rotateX(-Math.PI / 2);
    const pinGeo = st.keep(new CylinderGeometry(0.26, 0.26, 1.5, 8));
    pinGeo.rotateZ(Math.PI / 2);
    const handleGeo = st.keep(new CylinderGeometry(0.13, 0.13, 0.5, 6));
    handleGeo.rotateZ(Math.PI / 2);
    const woodMat = st.keep(flat('#e0a868'));
    const handleMat = st.keep(flat('#a8693a'));
    const starGeo = st.keep(new IcosahedronGeometry(0.17, 0));
    const starMat = st.keep(new MeshBasicMaterial({ color: '#ffd23f' }));
    who.forEach((w, i) => {
      const model = buildPierogi(w.color);
      const tag = nameTag(w.name.slice(0, 10), '#fff4dc', 4.2);
      tag.position.y = 2.3;
      model.root.add(tag);
      const ring = new Mesh(ringGeo, st.keep(new MeshBasicMaterial({ color: '#fff8ea', transparent: true, opacity: 0.85 })));
      ring.position.y = 0.05;
      ring.scale.set(0.8, 1, 0.8);
      model.root.add(ring);
      const pin = new Group();
      pin.add(new Mesh(pinGeo, woodMat));
      for (const x of [-1, 1]) {
        const h = new Mesh(handleGeo, handleMat);
        h.position.x = x * 0.95;
        pin.add(h);
      }
      pin.position.set(0, 0.45, 1.1);
      pin.visible = false;
      model.root.add(pin);
      const stars = new Group();
      for (let k = 0; k < 3; k++) {
        const s = new Mesh(starGeo, starMat);
        s.position.set(Math.cos((k / 3) * Math.PI * 2) * 0.7, 0, Math.sin((k / 3) * Math.PI * 2) * 0.7);
        stars.add(s);
      }
      stars.position.y = 1.55;
      stars.visible = false;
      model.root.add(stars);
      model.root.visible = true;
      st.add(model.root);
      // Bomb marker and bomb.
      const markerMat = st.keep(new MeshBasicMaterial({ color: w.color, transparent: true, opacity: 0.4, depthWrite: false }));
      const marker = new Group();
      marker.add(new Mesh(markerGeo, markerMat));
      const markerRing = new Mesh(mRingGeo, st.keep(new MeshBasicMaterial({ color: '#fff8ea', transparent: true, opacity: 0.9, depthWrite: false })));
      markerRing.scale.setScalar(TILE * 1.5);
      marker.add(markerRing);
      marker.position.y = 0.12;
      marker.visible = false;
      st.add(marker);
      const bomb = new Mesh(bombGeo, st.keep(flat(w.color)));
      bomb.visible = false;
      st.add(bomb);
      this.players.push({
        model,
        tag,
        pin,
        stars,
        marker,
        markerMat,
        markerRing,
        bomb,
        rot: 0,
        bob: i * 1.3,
        yOff: 0,
        yVel: 0,
        scale: 1,
        squash: 0,
        spin: 0,
        color: this.colors[i],
        wasDown: false,
      });
    });

    // Rings (expanding shock waves).
    for (let i = 0; i < MAX_RINGS; i++) {
      const m = new Mesh(ringGeo, st.keep(new MeshBasicMaterial({ color: '#fff8ea', transparent: true, depthWrite: false })));
      m.visible = false;
      st.add(m);
      this.rings.push({ mesh: m, age: 1, life: 1, from: 1, to: 2 });
    }

    // Mop and its warning strip.
    this.stripTex = st.keep(
      new CanvasTexture(
        (() => {
          const c = document.createElement('canvas');
          c.width = c.height = 32;
          const x = c.getContext('2d')!;
          x.fillStyle = '#ff5a4a';
          x.fillRect(0, 0, 32, 32);
          x.fillStyle = '#fff8ea';
          for (let k = -32; k < 64; k += 16) {
            x.beginPath();
            x.moveTo(k, 0);
            x.lineTo(k + 8, 0);
            x.lineTo(k + 8 + 32, 32);
            x.lineTo(k + 32, 32);
            x.fill();
          }
          return c;
        })(),
      ),
    );
    this.stripTex.magFilter = this.stripTex.minFilter = NearestFilter;
    this.stripTex.wrapS = this.stripTex.wrapT = RepeatWrapping;
    this.stripTex.colorSpace = SRGBColorSpace;
    this.stripTex.repeat.set(cols * 1.2, 2.4);
    this.mopStrip = new Mesh(
      st.keep(new PlaneGeometry(this.W, TILE * 2)),
      st.keep(new MeshBasicMaterial({ map: this.stripTex, transparent: true, opacity: 0.4, depthWrite: false, side: DoubleSide })),
    );
    this.mopStrip.rotation.x = -Math.PI / 2;
    this.mopStrip.position.y = 0.14;
    this.mopStrip.visible = false;
    st.add(this.mopStrip);
    this.mopGroup = this.buildMop();
    this.mopGroup.scale.set(1.5, 1.5, 1);
    this.mopGroup.visible = false;
    st.add(this.mopGroup);

    // Camera.
    this.frame();
  }

  private buildMop() {
    const st = this.stage;
    const g = new Group();
    const strandA = st.keep(flat('#f0ecd8'));
    const strandB = st.keep(flat('#cfc9b0'));
    const box = st.keep(new BoxGeometry(1, 1, 1));
    const n = 8;
    for (let k = 0; k < n; k++) {
      const m = new Mesh(box, k % 2 ? strandA : strandB);
      m.scale.set(1.1, 0.8, (TILE * 2) / n + 0.05);
      m.position.set(0, 0.4, -TILE + (TILE * 2 * (k + 0.5)) / n);
      g.add(m);
    }
    const bar = new Mesh(box, st.keep(flat('#3f6bc9')));
    bar.scale.set(0.5, 0.3, TILE * 2 + 0.25);
    bar.position.set(0, 1.0, 0);
    g.add(bar);
    const handle = new Mesh(st.keep(new CylinderGeometry(0.12, 0.12, 6, 6)), st.keep(flat('#a8693a')));
    handle.position.set(0, 3.8, 0);
    handle.rotation.z = 0.5;
    handle.position.x = -1.3;
    g.add(handle);
    return g;
  }

  /** Aim the camera so the whole floor and a bit of kitchen fill the TV. */
  private frame() {
    const dist = Math.max(this.W * 0.9 + 5, this.H * 1.9 + 8);
    const tilt = 0.98;
    this.camTarget.set(0, 0, this.H * 0.02);
    this.stage.lookAt(this.camTarget, dist, tilt);
    this.camBase.copy(this.stage.camera.position);
  }

  // ---- particles ----------------------------------------------------------------

  private spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, color: Color, grav = -24, depth = 0.05) {
    if (this.pc >= MAX_PARTICLES) return;
    const i = this.pc++;
    this.ppos.set([x, y, z], i * 3);
    this.pvel.set([vx, vy, vz], i * 3);
    this.plife[i * 2] = life;
    this.plife[i * 2 + 1] = life;
    this.psize[i] = size;
    this.pgrav[i] = grav;
    this.pdepth[i] = depth;
    this.parts.setColorAt(i, color);
    if (this.parts.instanceColor) this.parts.instanceColor.needsUpdate = true;
  }

  private burst(x: number, z: number, color: Color, n: number, speed: number, up = 7, size = 0.22) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.35 + Math.random() * 0.75);
      this.spawn(x, 0.3, z, Math.cos(a) * s, up * (0.5 + Math.random() * 0.7), Math.sin(a) * s, 0.55 + Math.random() * 0.4, size * (0.7 + Math.random() * 0.7), color);
    }
  }

  private ringFx(x: number, z: number, color: string, from: number, to: number, life = 0.45) {
    const r = this.rings.find((q) => q.age >= q.life) ?? this.rings[0];
    r.age = 0;
    r.life = life;
    r.from = from;
    r.to = to;
    (r.mesh.material as MeshBasicMaterial).color.set(color);
    r.mesh.position.set(x, 0.16, z);
    r.mesh.visible = true;
  }

  private tileColor(i: number, owner: number, out: Color) {
    const checker = ((i % this.cols) + Math.floor(i / this.cols)) & 1;
    if (owner >= 0) out.copy(this.colors[owner] ?? this.baseA).multiplyScalar(checker ? 0.93 : 1);
    else out.copy(checker ? this.baseB : this.baseA);
    return out;
  }

  // ---- events -------------------------------------------------------------------

  /** Feed the sim's events from a step in (for splashes, shakes and pops). */
  events(ev: TilesEvent[], sim: TilesSim) {
    this.ripple = null;
    for (const e of ev) {
      switch (e.t) {
        case 'paint': {
          const c = sim.centre(e.tile);
          let delay = 0;
          if (this.ripple) delay = Math.min(0.5, Math.hypot(c.x - this.ripple.x, c.z - this.ripple.z) * 0.08);
          this.popT[e.tile] = -delay;
          this.waiting[e.tile] = 1;
          const col = this.colors[e.by];
          if (!this.ripple) {
            const nParts = e.prev >= 0 ? 4 : 3;
            for (let k = 0; k < nParts; k++) {
              const a = Math.random() * Math.PI * 2;
              this.spawn(c.x, 0.2, c.z, Math.cos(a) * 2.2, 3 + Math.random() * 3, Math.sin(a) * 2.2, 0.4 + Math.random() * 0.2, 0.2, col);
            }
          }
          break;
        }
        case 'land': {
          this.ripple = { x: e.x, z: e.z };
          const col = this.colors[e.p];
          this.burst(e.x, e.z, col, 30, 7, 9, 0.3);
          this.ringFx(e.x, e.z, '#fff8ea', TILE * 0.8, TILE * 2.6, 0.5);
          this.shake = Math.max(this.shake, 0.45);
          break;
        }
        case 'roll': {
          const p = sim.players[e.p];
          this.burst(p.x, p.z, new Color('#fff4dc'), 8, 3, 2, 0.2);
          break;
        }
        case 'stun': {
          const p = sim.players[e.p];
          this.burst(p.x, p.z, new Color('#ffd23f'), 10, 5, 6, 0.2);
          this.ringFx(p.x, p.z, '#ffd23f', 0.9, 2.2, 0.4);
          this.shake = Math.max(this.shake, e.kind === 'mop' ? 0.15 : 0.35);
          this.players[e.p].squash = 1;
          break;
        }
        case 'crack': {
          const c = sim.centre(e.tile);
          this.burst(c.x, c.z, new Color('#6b5a4a'), 4, 2, 3, 0.14);
          break;
        }
        case 'crumble': {
          const c = sim.centre(e.tile);
          for (let k = 0; k < 14; k++) {
            this.spawn(
              c.x + (Math.random() - 0.5) * TILE,
              0.1,
              c.z + (Math.random() - 0.5) * TILE,
              (Math.random() - 0.5) * 3,
              1 + Math.random() * 3,
              (Math.random() - 0.5) * 3,
              1.1,
              0.3 + Math.random() * 0.3,
              this.tmpColor.set(k % 3 ? '#e5e8ea' : '#8a7868'),
              -26,
              -1.6,
            );
          }
          this.shake = Math.max(this.shake, 0.12);
          break;
        }
        case 'fresh':
          this.rise[e.tile] = 0;
          break;
        case 'fall': {
          this.burst(e.x, e.z, new Color('#3a2a22'), 8, 3, 3, 0.2);
          break;
        }
        case 'respawn': {
          const pv = this.players[e.p];
          pv.yOff = 10;
          pv.yVel = 0;
          pv.scale = 1;
          break;
        }
        case 'wipe': {
          const c = sim.centre(e.tile);
          if (Math.random() < 0.6) this.spawn(c.x, 0.3, c.z, (Math.random() - 0.5) * 2, 4 + Math.random() * 3, (Math.random() - 0.5) * 2, 0.6, 0.2, this.tmpColor.set('#e8f6ff'), -18);
          break;
        }
        case 'mopStart':
          this.shake = Math.max(this.shake, 0.1);
          break;
        default:
          break;
      }
    }
  }

  // ---- per frame -----------------------------------------------------------------

  render(sim: TilesSim, dt: number) {
    this.clock += dt;
    this.updateTiles(sim, dt);
    this.updatePlayers(sim, dt);
    this.updateFx(sim, dt);
    // Camera shake.
    this.shake = Math.max(0, this.shake - dt * 1.6);
    const cam = this.stage.camera;
    const s = this.shake * 0.5;
    cam.position.set(this.camBase.x + (Math.random() - 0.5) * s, this.camBase.y + (Math.random() - 0.5) * s, this.camBase.z + (Math.random() - 0.5) * s);
    cam.lookAt(this.camTarget);
    this.stage.render();
  }

  private updateTiles(sim: TilesSim, dt: number) {
    const n = this.cols * this.rows;
    const d = this.dummy;
    const c = this.tmpColor;
    let matDirty = false;
    let colDirty = false;
    let crackN = 0;
    for (let i = 0; i < n; i++) {
      const kind = sim.kind[i];
      // Pop and rise timers.
      let animating = false;
      if (this.popT[i] < POP) {
        this.popT[i] += dt;
        animating = true;
        if (this.waiting[i] && this.popT[i] >= 0) this.waiting[i] = 0;
      }
      if (this.rise[i] < 1) {
        this.rise[i] = Math.min(1, this.rise[i] + dt / 0.5);
        animating = true;
      }
      // What colour is on show? Delayed pops show the new colour when they start.
      const owner = sim.owner[i];
      let colorChanged = false;
      if (this.shown[i] !== owner && !this.waiting[i]) {
        this.shown[i] = owner;
        colorChanged = true;
      }
      const cracked = kind === CRACKED;
      if (cracked) animating = true;
      const prevAnim = this.wasAnim[i];
      if (!animating && !prevAnim && !colorChanged) continue;
      this.wasAnim[i] = animating ? 1 : 0;

      const cx = i % this.cols;
      const cz = Math.floor(i / this.cols);
      let x = (cx + 0.5) * TILE - this.W / 2;
      let z = (cz + 0.5) * TILE - this.H / 2;
      let y = -TT / 2;
      let sc = 1;
      let tint = 1;
      if (this.popT[i] >= 0 && this.popT[i] < POP) {
        const k = this.popT[i] / POP;
        y += Math.sin(k * Math.PI) * 0.4;
        sc = 1 + Math.sin(k * Math.PI) * 0.05;
      }
      if (this.rise[i] < 1) {
        const k = this.rise[i];
        const e = 1 - Math.pow(1 - k, 3);
        y += -(TT + 0.3) * (1 - e) + Math.sin(k * Math.PI) * 0.35;
      }
      if (kind === HOLE) {
        sc = 0;
      } else if (cracked) {
        const a = 1 - sim.timer[i] / CRACK_WARN;
        x += Math.sin(this.clock * 55 + i * 3) * 0.035 * (0.3 + a);
        z += Math.cos(this.clock * 47 + i) * 0.035 * (0.3 + a);
        y -= 0.05 + a * 0.12;
        if (sim.timer[i] < 0.7) tint = Math.sin(this.clock * 30) > 0 ? 0.65 : 1.12;
        else tint = 0.82;
        if (crackN < MAX_CRACKS) {
          d.position.set(x, y + TT / 2 + 0.01, z);
          d.rotation.set(0, ((i * 7) % 4) * (Math.PI / 2), 0);
          d.scale.setScalar(1);
          d.updateMatrix();
          this.cracks.setMatrixAt(crackN++, d.matrix);
        }
      }
      d.position.set(x, y, z);
      d.rotation.set(0, 0, 0);
      d.scale.set(sc, sc, sc);
      d.updateMatrix();
      this.tiles.setMatrixAt(i, d.matrix);
      matDirty = true;
      if (colorChanged || cracked || prevAnim) {
        this.tileColor(i, this.shown[i], c);
        if (tint !== 1) c.multiplyScalar(tint);
        this.tiles.setColorAt(i, c);
        colDirty = true;
      }
    }
    // Cracks that are no longer cracked disappear because the count only covers this frame's list.
    this.cracks.count = crackN;
    this.cracks.instanceMatrix.needsUpdate = true;
    if (matDirty) this.tiles.instanceMatrix.needsUpdate = true;
    if (colDirty && this.tiles.instanceColor) this.tiles.instanceColor.needsUpdate = true;
  }

  /** Paint every tile once (round start). */
  reset() {
    const n = this.cols * this.rows;
    this.shown.fill(-2);
    this.popT.fill(POP);
    this.waiting.fill(0);
    this.rise.fill(1);
    this.wasAnim.fill(1);
    this.pc = 0;
    for (let i = 0; i < n; i++) this.tiles.setColorAt(i, this.tmpColor.copy(this.baseA));
    for (const pv of this.players) {
      pv.yOff = 0;
      pv.scale = 1;
      pv.wasDown = false;
      pv.marker.visible = false;
      pv.bomb.visible = false;
    }
  }

  private updatePlayers(sim: TilesSim, dt: number) {
    this.players.forEach((pv, i) => {
      const p = sim.players[i];
      const root = pv.model.root;
      if (!p || !p.alive) {
        root.visible = false;
        pv.marker.visible = false;
        pv.bomb.visible = false;
        return;
      }
      const down = p.down > 0;
      // Falling away / dropping in.
      if (down) {
        pv.yOff = Math.max(-3, pv.yOff - dt * 9);
        pv.scale = Math.max(0, 1 + pv.yOff * 0.3);
        pv.wasDown = true;
      } else if (pv.yOff > 0 || pv.yVel !== 0) {
        pv.yVel -= 38 * dt;
        pv.yOff += pv.yVel * dt;
        if (pv.yOff <= 0) {
          pv.yOff = 0;
          pv.yVel = 0;
          pv.squash = 1;
          this.burst(p.x, p.z, new Color('#fff4dc'), 8, 3, 2, 0.18);
          this.ringFx(p.x, p.z, '#fff8ea', 0.8, 2, 0.35);
        }
        pv.scale = 1;
      } else if (pv.wasDown) {
        pv.wasDown = false;
        pv.scale = 1;
      } else {
        pv.scale = 1;
        pv.yOff = 0;
      }
      root.visible = pv.scale > 0.02;
      const moving = !down && p.dash <= 0 && p.stun <= 0 ? p.speed : 0;
      pv.bob += dt * (moving > 0 ? 9 + moving * 5 : 0);
      const hop = moving > 0 ? Math.abs(Math.sin(pv.bob)) * 0.2 * moving : 0;
      pv.squash = Math.max(0, pv.squash - dt * 3.2);
      const sq = Math.sin(pv.squash * Math.PI) * 0.25;
      // Heading.
      const target = Math.atan2(p.fx, p.fz);
      let dRot = target - pv.rot;
      dRot = Math.atan2(Math.sin(dRot), Math.cos(dRot));
      pv.rot += dRot * Math.min(1, dt * 18);
      if (p.stun > 0) pv.spin += dt * 15;
      else pv.spin *= 0.7;
      root.position.set(p.x, pv.yOff + hop + (p.dash > 0 ? 0.1 : 0), p.z);
      root.rotation.y = pv.rot + pv.spin;
      root.scale.setScalar(pv.scale * this.charScale);
      const body = pv.model.body;
      body.scale.set(1 + sq, 1 - sq, 1 + sq);
      body.rotation.x = p.dash > 0 ? 0.35 : moving > 0 ? 0.12 : 0;
      body.rotation.z = p.stun > 0 ? Math.sin(this.clock * 18) * 0.25 : moving > 0 ? Math.sin(pv.bob) * 0.1 : 0;
      pv.model.shadow.scale.set(1 - Math.min(0.5, Math.max(0, pv.yOff) * 0.05), 0.6, 1);
      pv.pin.visible = p.dash > 0;
      if (p.dash > 0) pv.pin.rotation.x += dt * 26;
      pv.stars.visible = p.stun > 0;
      if (p.stun > 0) pv.stars.rotation.y += dt * 8;

      // Bomb in flight.
      const bomb = sim.bombs.find((b) => b.p === i);
      if (bomb) {
        const u = Math.min(1, bomb.t / SPLAT_FLIGHT);
        pv.bomb.visible = true;
        pv.bomb.position.set(bomb.sx + (bomb.tx - bomb.sx) * u, 0.7 + Math.sin(u * Math.PI) * 4.2, bomb.sz + (bomb.tz - bomb.sz) * u);
        pv.bomb.rotation.x += dt * 12;
        pv.bomb.rotation.y += dt * 9;
        const tile = sim.tileAt(bomb.tx, bomb.tz);
        const c = sim.centre(tile);
        pv.marker.visible = true;
        pv.marker.position.set(c.x, 0.14, c.z);
        pv.markerMat.opacity = 0.28 + 0.2 * Math.sin(this.clock * 24);
        pv.markerRing.scale.setScalar(TILE * (1.5 + (1 - u) * 1.2));
      } else {
        pv.bomb.visible = false;
        pv.marker.visible = false;
      }
    });
  }

  private updateFx(sim: TilesSim, dt: number) {
    // Mop.
    const m = sim.mop;
    if (m) {
      const z = (m.row + 1) * TILE - this.H / 2;
      this.mopStrip.visible = true;
      this.mopStrip.position.z = z;
      this.stripTex.offset.x = (this.clock * 1.5 * m.dir) % 1;
      const mat = this.mopStrip.material as MeshBasicMaterial;
      mat.opacity = m.active ? 0.2 : 0.3 + 0.2 * Math.sin(this.clock * 14);
      this.mopGroup.visible = true;
      const wobble = m.active ? 0 : Math.sin(this.clock * 20) * 0.25;
      this.mopGroup.position.set(m.head + (m.active ? 0 : m.dir * -wobble * 0.5), 0, z);
      this.mopGroup.rotation.y = m.dir > 0 ? 0 : Math.PI;
      if (!m.active) {
        const u = 1 - m.warn / MOP_WARN;
        // Creep in from outside while warning.
        this.mopGroup.position.x = m.head + m.dir * u * 2.5;
        this.mopGroup.position.y = 0.1 + Math.abs(Math.sin(this.clock * 8)) * 0.15;
      } else {
        this.mopGroup.position.y = 0.05 + Math.abs(Math.sin(this.clock * 20)) * 0.06;
        this.mopDrip -= dt;
        if (this.mopDrip <= 0 && Math.abs(m.head) < this.W / 2 + 1) {
          this.mopDrip = 0.04;
          this.spawn(m.head - m.dir * 0.8, 0.4, z + (Math.random() - 0.5) * TILE * 2, -m.dir * (1 + Math.random() * 2), 3 + Math.random() * 3, (Math.random() - 0.5) * 3, 0.6, 0.2, this.tmpColor.set('#d7efff'), -16);
        }
      }
    } else {
      this.mopStrip.visible = false;
      this.mopGroup.visible = false;
    }
    // Rings.
    for (const r of this.rings) {
      if (r.age >= r.life) {
        r.mesh.visible = false;
        continue;
      }
      r.age += dt;
      const u = Math.min(1, r.age / r.life);
      r.mesh.scale.setScalar(r.from + (r.to - r.from) * ease(u));
      (r.mesh.material as MeshBasicMaterial).opacity = (1 - u) * 0.9;
    }
    // Particles.
    const d = this.dummy;
    let k = 0;
    while (k < this.pc) {
      const l = (this.plife[k * 2] -= dt);
      const i3 = k * 3;
      this.pvel[i3 + 1] += this.pgrav[k] * dt;
      this.ppos[i3] += this.pvel[i3] * dt;
      this.ppos[i3 + 1] += this.pvel[i3 + 1] * dt;
      this.ppos[i3 + 2] += this.pvel[i3 + 2] * dt;
      const dead = l <= 0 || this.ppos[i3 + 1] < this.pdepth[k];
      if (dead) {
        // swap-remove
        const last = --this.pc;
        if (k !== last) {
          this.ppos.copyWithin(i3, last * 3, last * 3 + 3);
          this.pvel.copyWithin(i3, last * 3, last * 3 + 3);
          this.plife[k * 2] = this.plife[last * 2];
          this.plife[k * 2 + 1] = this.plife[last * 2 + 1];
          this.psize[k] = this.psize[last];
          this.pgrav[k] = this.pgrav[last];
          this.pdepth[k] = this.pdepth[last];
          this.parts.getColorAt(last, this.tmpColor);
          this.parts.setColorAt(k, this.tmpColor);
          if (this.parts.instanceColor) this.parts.instanceColor.needsUpdate = true;
        }
        continue;
      }
      const life = Math.min(1, l / this.plife[k * 2 + 1] + 0.2);
      const s = this.psize[k] * life;
      d.position.set(this.ppos[i3], this.ppos[i3 + 1], this.ppos[i3 + 2]);
      d.rotation.set(l * 6, l * 4, 0);
      d.scale.setScalar(s);
      d.updateMatrix();
      this.parts.setMatrixAt(k, d.matrix);
      k++;
    }
    this.parts.count = this.pc;
    this.parts.instanceMatrix.needsUpdate = true;
  }

  /** Where a world point lands on the stage (for DOM overlays). */
  toStage(x: number, y: number, z: number) {
    return this.stage.toStage(new Vector3(x, y, z));
  }

  dispose() {
    this.stage.dispose();
  }
}
