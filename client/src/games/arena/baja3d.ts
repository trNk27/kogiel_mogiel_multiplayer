/**
 * Baja the Pomchi + her two-tone quilted chocolate-brown & warm-tan carrier bag in low-poly 3D.
 * Purely cosmetic reusable mascot following `arena/babcia.ts` and `arena/kit.ts` conventions.
 */
import {
  BoxGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  TorusGeometry,
  type Material,
} from 'three';
import { BajaPatrol } from '../../lib/assets/bajaCameo';
import { blobShadow, flat } from './kit';

export type Keep = <T extends { dispose(): void }>(x: T) => T;

const TAU = Math.PI * 2;

function angleDiff(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= TAU;
  while (d < -Math.PI) d += TAU;
  return d;
}

function trackShadow(shadow: Mesh, keep: Keep) {
  keep(shadow.geometry);
  keep(shadow.material as Material);
  return shadow;
}

export interface BajaModel {
  /** Move and orient this group (`+Z` is forward when `rotation.y = 0`). */
  root: Group;
  /** Animated body group inside `root` (ground at `y = 0`). */
  body: Group;
  head: Group;
  tail: Group;
  legs: Mesh[];
  ears: Group[];
  shadow: Mesh;
}

export interface BajaBagModel {
  root: Group;
  /** Local Y inside the bag where `BajaModel` sits so her chin & white chest peek over the tan rim. */
  seatY: number;
}

/**
 * Low-poly Pomchi matching Baja's coat: foxy ginger body, bright white chest ruff,
 * wide white forehead blaze down into a white muzzle, dark button nose, glossy eyes,
 * big upright peach-lined ears, pale paws, and a curled golden plume tail.
 */
export function buildBaja(keep: Keep, scale = 1): BajaModel {
  const root = new Group();
  const mover = new Group();
  mover.scale.setScalar(scale);
  const body = new Group();

  const ginger = keep(flat('#cf7328'));
  const golden = keep(flat('#ea9a48'));
  const tailCream = keep(flat('#f4c47a'));
  const white = keep(flat('#fff9f0'));
  const pawMat = keep(flat('#f2e2ce'));
  const peach = keep(flat('#e89c80'));
  const eyeMat = keep(new MeshBasicMaterial({ color: '#140a08' }));
  const glintMat = keep(new MeshBasicMaterial({ color: '#ffffff' }));
  const noseMat = keep(new MeshBasicMaterial({ color: '#2e1a16' }));

  // Compact fluffy torso + shoulder ruff
  const torso = new Mesh(keep(new SphereGeometry(0.42, 8, 6)), ginger);
  torso.scale.set(0.84, 0.78, 1.18);
  torso.position.set(0, 0.36, -0.02);

  const ruff = new Mesh(keep(new IcosahedronGeometry(0.28, 0)), white);
  ruff.scale.set(0.96, 1.05, 0.72);
  ruff.position.set(0, 0.36, 0.32);

  const backFluff = new Mesh(keep(new SphereGeometry(0.32, 7, 5)), golden);
  backFluff.scale.set(0.95, 0.65, 1.05);
  backFluff.position.set(0, 0.44, -0.08);
  body.add(torso, ruff, backFluff);

  // Cute round head with signature white forehead blaze & big upright fox-like ears
  const head = new Group();
  head.position.set(0, 0.62, 0.28);

  const cranium = new Mesh(keep(new SphereGeometry(0.31, 8, 6)), ginger);
  cranium.scale.set(1.06, 0.94, 0.96);
  head.add(cranium);

  const cheekGeo = keep(new SphereGeometry(0.14, 6, 4));
  for (const sx of [-1, 1]) {
    const cheek = new Mesh(cheekGeo, golden);
    cheek.scale.set(0.9, 0.82, 0.85);
    cheek.position.set(sx * 0.25, -0.04, 0.03);
    head.add(cheek);
  }

  // Wide bright-white forehead blaze tapering between the eyes
  const blazeTop = new Mesh(keep(new SphereGeometry(0.125, 6, 5)), white);
  blazeTop.scale.set(0.92, 1.55, 0.55);
  blazeTop.position.set(0, 0.12, 0.245);
  head.add(blazeTop);

  // White muzzle & dark button nose
  const muzzle = new Mesh(keep(new SphereGeometry(0.135, 7, 5)), white);
  muzzle.scale.set(1.12, 0.82, 0.92);
  muzzle.position.set(0, -0.085, 0.275);
  const nose = new Mesh(keep(new SphereGeometry(0.052, 6, 4)), noseMat);
  nose.scale.set(1.15, 0.85, 0.9);
  nose.position.set(0, -0.045, 0.395);
  head.add(muzzle, nose);

  // Glossy dark Chihuahua eyes with crisp white catchlights
  const eyeGeo = keep(new SphereGeometry(0.076, 7, 5));
  const glintGeo = keep(new SphereGeometry(0.024, 5, 4));
  for (const sx of [-1, 1]) {
    const eye = new Mesh(eyeGeo, eyeMat);
    eye.position.set(sx * 0.145, 0.035, 0.265);
    const glint = new Mesh(glintGeo, glintMat);
    glint.position.set(sx * 0.132, 0.062, 0.332);
    head.add(eye, glint);
  }

  // Big upright triangular Pomchi ears with peach lining & golden fluff
  const earOuterGeo = keep(new ConeGeometry(0.155, 0.34, 4));
  const earInnerGeo = keep(new ConeGeometry(0.095, 0.23, 3));
  const earTuftGeo = keep(new IcosahedronGeometry(0.08, 0));
  const ears: Group[] = [];
  for (const sx of [-1, 1]) {
    const ear = new Group();
    ear.position.set(sx * 0.2, 0.24, -0.01);
    ear.rotation.z = -sx * 0.22;
    const outer = new Mesh(earOuterGeo, ginger);
    outer.position.y = 0.15;
    outer.rotation.y = Math.PI * 0.25;
    const inner = new Mesh(earInnerGeo, peach);
    inner.position.set(0, 0.13, 0.045);
    inner.rotation.y = Math.PI;
    const tuft = new Mesh(earTuftGeo, golden);
    tuft.position.set(0, 0.04, 0.04);
    ear.add(outer, inner, tuft);
    head.add(ear);
    ears.push(ear);
  }
  body.add(head);

  // Four tiny legs with pale cream paws pivoted at the top so they swing naturally
  const legGeo = keep(new CylinderGeometry(0.062, 0.048, 0.24, 5));
  legGeo.translate(0, -0.12, 0);
  const legSpots: [number, number][] = [
    [-0.14, 0.2],
    [0.14, 0.2],
    [-0.15, -0.22],
    [0.15, -0.22],
  ];
  const legs = legSpots.map(([lx, lz]) => {
    const leg = new Mesh(legGeo, pawMat);
    leg.position.set(lx, 0.24, lz);
    body.add(leg);
    return leg;
  });

  // Fluffy golden-orange curled plume tail arching over the rump
  const tail = new Group();
  tail.position.set(0, 0.42, -0.36);
  const tailBase = new Mesh(keep(new IcosahedronGeometry(0.14, 0)), ginger);
  tailBase.position.set(0, 0.12, -0.05);
  const tailMid = new Mesh(keep(new IcosahedronGeometry(0.18, 0)), golden);
  tailMid.position.set(0, 0.29, 0.02);
  const tailTip = new Mesh(keep(new IcosahedronGeometry(0.15, 0)), tailCream);
  tailTip.position.set(0, 0.4, 0.14);
  tail.add(tailBase, tailMid, tailTip);
  body.add(tail);

  const shadow = trackShadow(blobShadow(0.56, 0.3), keep);
  mover.add(body, shadow);
  root.add(mover);
  return { root, body, head, tail, legs, ears, shadow };
}

/**
 * Quilted chocolate-brown & warm-tan padded dog carrier bag with scooped front chin-rest cutout,
 * brown shoulder strap, and dark side clip (matching Photo 1).
 */
export function buildBajaBag(keep: Keep, scale = 1): BajaBagModel {
  const root = new Group();
  const bag = new Group();
  bag.scale.setScalar(scale);

  const brown = keep(flat('#4b3126'));
  const deepBrown = keep(flat('#321f18'));
  const quilt = keep(flat('#654436'));
  const tan = keep(flat('#d6b58b'));
  const tanHi = keep(flat('#e8cca6'));
  const darkInside = keep(new MeshBasicMaterial({ color: '#1c110d' }));
  const clipMat = keep(flat('#211918'));

  // Tote base & chocolate quilted lower body
  const base = new Mesh(keep(new BoxGeometry(1.16, 0.16, 0.84)), deepBrown);
  base.position.set(0, 0.08, 0);
  const tote = new Mesh(keep(new BoxGeometry(1.12, 0.44, 0.8)), brown);
  tote.position.set(0, 0.36, 0);

  // Subtle quilted cushion accents on front & sides
  const quiltGeo = keep(new BoxGeometry(0.88, 0.24, 0.84));
  const quiltPatch = new Mesh(quiltGeo, quilt);
  quiltPatch.position.set(0, 0.34, 0);

  // Dark interior cavity
  const cavity = new Mesh(keep(new BoxGeometry(0.84, 0.34, 0.56)), darkInside);
  cavity.position.set(0, 0.56, 0);

  // Warm sand/tan padded upper collar (tall back & sides + scooped low front chin-rest rim)
  const backCollar = new Mesh(keep(new BoxGeometry(1.18, 0.34, 0.16)), tan);
  backCollar.position.set(0, 0.67, -0.35);
  const sideCollarGeo = keep(new BoxGeometry(0.18, 0.3, 0.84));
  const leftCollar = new Mesh(sideCollarGeo, tan);
  leftCollar.position.set(-0.52, 0.65, 0);
  const rightCollar = new Mesh(sideCollarGeo, tan);
  rightCollar.position.set(0.52, 0.65, 0);

  // Scooped front cutout rim where Baja rests her white chest & chin
  const frontRim = new Mesh(keep(new BoxGeometry(0.76, 0.12, 0.16)), tanHi);
  frontRim.position.set(0, 0.56, 0.35);
  const cornerBolsterGeo = keep(new BoxGeometry(0.22, 0.2, 0.17));
  for (const sx of [-1, 1]) {
    const corner = new Mesh(cornerBolsterGeo, tanHi);
    corner.position.set(sx * 0.44, 0.61, 0.35);
    bag.add(corner);
  }

  // Chocolate-brown webbing shoulder strap & dark clip on right corner
  const strap = new Mesh(keep(new TorusGeometry(0.55, 0.055, 5, 12, Math.PI)), brown);
  strap.rotation.y = Math.PI * 0.5;
  strap.position.set(0.58, 0.58, -0.02);

  const clip = new Mesh(keep(new BoxGeometry(0.1, 0.14, 0.12)), clipMat);
  clip.position.set(0.61, 0.52, 0.16);

  const shadow = trackShadow(blobShadow(0.78, 0.28), keep);
  bag.add(base, tote, quiltPatch, cavity, backCollar, leftCollar, rightCollar, frontRim, strap, clip, shadow);
  root.add(bag);

  return { root, seatY: 0.28 * scale };
}

function buildHeartMesh(keep: Keep, scale = 1): Group {
  const heart = new Group();
  const mat = keep(new MeshBasicMaterial({ color: '#ff4f7a' }));
  const lobeGeo = keep(new SphereGeometry(0.11 * scale, 6, 5));
  const tipGeo = keep(new ConeGeometry(0.165 * scale, 0.24 * scale, 4));
  const left = new Mesh(lobeGeo, mat);
  left.position.set(-0.08 * scale, 0.08 * scale, 0);
  const right = new Mesh(lobeGeo, mat);
  right.position.set(0.08 * scale, 0.08 * scale, 0);
  const tip = new Mesh(tipGeo, mat);
  tip.rotation.z = Math.PI;
  tip.rotation.y = Math.PI * 0.25;
  tip.position.set(0, -0.06 * scale, 0);
  heart.add(left, right, tip);
  return heart;
}

export interface BajaCameo3DOptions {
  /** World `[x, z]` where Baja's carrier bag rests. */
  bagPos: readonly [number, number];
  /** Ground `[x, z]` patrol spots Baja visits when she hops out for zoomies. */
  waypoints: readonly (readonly [number, number])[];
  /** Scale multiplier suited to the scene's camera distance (default `1`). */
  scale?: number;
  /** Bag Y rotation in radians (`0` faces `+Z` toward the viewer). */
  bagYaw?: number;
  /** Ground Y elevation (default `0`). */
  y?: number;
  /** Seconds peeking in the bag before her first outing (default `3.2`). */
  initialRest?: number;
  /** Deterministic patrol RNG seed. */
  seed?: number;
}

/**
 * Drop-in 3D cosmetic Baja cameo: places Baja's quilted brown & tan bag at `bagPos` and lets her
 * periodically hop out, trot between waypoints wagging her plume tail, and hop back in.
 */
export class BajaCameo3D {
  readonly root = new Group();
  readonly dog: BajaModel;
  readonly bag: BajaBagModel;
  private readonly heart: Group;
  private readonly patrol: BajaPatrol;
  private readonly bagYaw: number;
  private readonly scale: number;
  private currentYaw: number;

  constructor(keep: Keep, opts: BajaCameo3DOptions) {
    this.scale = opts.scale ?? 1;
    this.bagYaw = opts.bagYaw ?? 0.35;
    this.currentYaw = this.bagYaw;
    this.root.position.set(0, opts.y ?? 0, 0);

    this.bag = buildBajaBag(keep, this.scale);
    this.bag.root.position.set(opts.bagPos[0], 0, opts.bagPos[1]);
    this.bag.root.rotation.y = this.bagYaw;

    this.dog = buildBaja(keep, this.scale);
    this.dog.root.position.set(opts.bagPos[0], this.bag.seatY, opts.bagPos[1]);
    this.dog.root.rotation.y = this.bagYaw;

    this.heart = buildHeartMesh(keep, this.scale);
    this.heart.visible = false;

    this.root.add(this.bag.root, this.dog.root, this.heart);

    this.patrol = new BajaPatrol({
      bagX: opts.bagPos[0],
      bagZ: opts.bagPos[1],
      waypoints: opts.waypoints,
      speed: 2.3 * Math.max(0.75, Math.min(1.5, this.scale)),
      hopHeight: 0.65 * this.scale,
      hopSpan: 0.9 * this.scale,
      hideBetweenVisits: false,
      initialInBag: opts.initialRest ?? 3.2,
      inBagRange: [4.5, 9],
      stopsRange: [2, 3],
      seed: opts.seed ?? 71,
    });
  }

  /** Kick off an excited outing right away (e.g. round win / celebration). */
  celebrate() {
    this.patrol.celebrate();
  }

  update(rawDt: number) {
    const dt = Math.min(0.08, Math.max(0, rawDt));
    this.patrol.update(dt);
    const t = this.patrol.time;
    const inBag = this.patrol.phase === 'inBag';

    if (inBag) {
      this.dog.root.position.set(this.patrol.x, this.bag.seatY, this.patrol.z);
      this.currentYaw += angleDiff(this.currentYaw, this.bagYaw) * Math.min(1, dt * 8);
      this.dog.root.rotation.y = this.currentYaw;
      this.dog.shadow.visible = false;
      this.dog.body.position.y = Math.sin(t * 3.2) * 0.025;
      this.dog.body.rotation.set(0, 0, 0);
      this.dog.head.rotation.set(Math.sin(t * 1.9) * 0.06, Math.sin(t * 1.3) * 0.24, Math.sin(t * 2.1) * 0.05);
      this.dog.tail.rotation.set(0, 0, Math.sin(t * 6) * 0.18);
      for (const leg of this.dog.legs) leg.rotation.x = 0;
      for (let i = 0; i < this.dog.ears.length; i++) {
        this.dog.ears[i].rotation.x = Math.sin(t * 4.5 + i) * 0.06;
      }
    } else {
      const targetYaw = this.patrol.phase === 'sniff' ? this.bagYaw * 0.5 : this.patrol.yaw;
      this.currentYaw += angleDiff(this.currentYaw, targetYaw) * Math.min(1, dt * 12);
      this.dog.root.rotation.y = this.currentYaw;
      this.dog.root.position.set(this.patrol.x, 0, this.patrol.z);
      this.dog.shadow.visible = true;

      if (this.patrol.running) {
        const stride = t * 18;
        const bounce = this.patrol.hopY + Math.abs(Math.sin(stride)) * 0.1 * this.scale;
        this.dog.body.position.y = bounce;
        this.dog.body.rotation.set(0.08, 0, Math.sin(stride) * 0.08);
        this.dog.head.rotation.set(-0.08, Math.sin(stride * 0.5) * 0.06, 0);
        this.dog.tail.rotation.set(0.15, 0, Math.sin(t * 15) * 0.45);
        this.dog.legs[0].rotation.x = Math.sin(stride) * 0.75;
        this.dog.legs[3].rotation.x = Math.sin(stride) * 0.75;
        this.dog.legs[1].rotation.x = -Math.sin(stride) * 0.75;
        this.dog.legs[2].rotation.x = -Math.sin(stride) * 0.75;
        this.dog.shadow.scale.setScalar(Math.max(0.45, 1 - this.patrol.hopY * 0.35));
      } else {
        // Sniffing / happy pause
        this.dog.body.position.y = Math.sin(t * 4) * 0.02 * this.scale;
        this.dog.body.rotation.set(0, 0, 0);
        this.dog.head.rotation.set(0.1 + Math.sin(t * 5) * 0.08, Math.sin(t * 2.2) * 0.26, Math.sin(t * 3.1) * 0.1);
        this.dog.tail.rotation.set(0, 0, Math.sin(t * 11) * 0.38);
        for (const leg of this.dog.legs) leg.rotation.x = 0;
        this.dog.shadow.scale.setScalar(1);
      }
      for (let i = 0; i < this.dog.ears.length; i++) {
        this.dog.ears[i].rotation.x = Math.sin(t * 7 + i * 1.4) * 0.07;
      }
    }

    this.heart.visible = this.patrol.showHeart;
    if (this.patrol.showHeart) {
      const floatY = (inBag ? this.bag.seatY : this.patrol.hopY) + (1.3 + Math.sin(t * 6) * 0.1) * this.scale;
      this.heart.position.set(this.patrol.x, floatY, this.patrol.z);
      this.heart.rotation.y = t * 2.4;
    }
  }
}
