/**
 * Skakanka in 3D: a village yard on a summer afternoon. Two babcias turn a long string of kiełbasa
 * links over a row of pierogi; a fence, a cottage, a well and sunflowers stand round the yard.
 * Same PS2 look as the other arena games.
 */
import { CapsuleGeometry, ConeGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial, PlaneGeometry, Quaternion, SphereGeometry, Vector3, type Sprite } from 'three';
import { ArenaStage, blobShadow, box, buildPierogi, flat, groundTexture, nameTag, type PierogiModel } from '../arena/kit';
import { buildBabcia } from '../arena/babcia';
import { Puffs } from '../arena/puffs';
import { mulberry32 } from '../rng';
import { ROPE_H, ROPE_R, SPACING, type RopeSim } from './logic';

export interface PlayerLook {
  name: string;
  color: string;
}

/** Sausage links in the rope. */
const LINKS = 26;
const LINK_R = 0.11;
const UP = new Vector3(0, 1, 0);

interface Actor {
  model: PierogiModel;
  tag: Sprite;
  color: string;
  /** Seconds since tripping, or -1. */
  trip: number;
  /** Seconds since landing (for the squash), or -1. */
  land: number;
  /** Seconds since a jump started, or -1. */
  jump: number;
  x: number;
}

const smooth = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

export class RopeScene {
  readonly stage: ArenaStage;
  /** Half the distance between the babcias’ hands. */
  readonly half: number;
  private actors: Actor[] = [];
  private links: Mesh[] = [];
  private knots: Mesh[] = [];
  private babcias: PierogiModel[] = [];
  private ropeShadow: Mesh;
  private ropeShadowMat: MeshBasicMaterial;
  private puffs = new Puffs(160, 9, 1.6);
  private sunflowers: Group[] = [];
  private time = 0;
  private shake = 0;
  private q = new Quaternion();
  private a = new Vector3();
  private b = new Vector3();

  constructor(canvas: HTMLCanvasElement, looks: PlayerLook[]) {
    this.stage = new ArenaStage(canvas, { sky: '#9fd3ef', fog: [45, 110], fov: 36 });
    const stage = this.stage;
    const keep = <T extends { dispose(): void }>(x: T) => stage.keep(x);
    const rowHalf = ((Math.max(1, looks.length) - 1) / 2) * SPACING;
    this.half = Math.max(4.6, rowHalf + 2.9);

    this.buildYard(keep);

    // The rope: sausage links with twine knots between them.
    const linkGeo = keep(new CapsuleGeometry(LINK_R, 1, 3, 6));
    const sausage = [keep(flat('#a8432c')), keep(flat('#93361f'))];
    const twine = keep(flat('#e9d7a8'));
    const knotGeo = keep(new SphereGeometry(LINK_R * 0.9, 5, 3));
    for (let k = 0; k < LINKS; k++) {
      const m = new Mesh(linkGeo, sausage[k % 2]);
      this.links.push(m);
      stage.add(m);
      const kn = new Mesh(knotGeo, twine);
      this.knots.push(kn);
      stage.add(kn);
    }
    // The rope's shadow, which darkens as it nears the ground: the cue to jump.
    this.ropeShadowMat = new MeshBasicMaterial({ color: '#1f2a10', transparent: true, opacity: 0, depthWrite: false });
    const sg = keep(new PlaneGeometry(1, 0.32));
    sg.rotateX(-Math.PI / 2);
    this.ropeShadow = new Mesh(sg, this.ropeShadowMat);
    this.ropeShadow.position.y = 0.02;
    this.ropeShadow.renderOrder = 1;
    stage.add(this.ropeShadow);

    // The babcias, one at each end, facing each other.
    for (const s of [-1, 1]) {
      const b = buildBabcia(keep, s < 0 ? '#cf3a2c' : '#3568b8');
      b.root.scale.setScalar(1.55);
      b.root.position.set(s * (this.half + 0.75), 0, 0);
      b.root.rotation.y = -s * (Math.PI / 2) * 0.82;
      stage.add(b.root);
      this.babcias.push(b);
    }

    stage.add(this.puffs.mesh);
    looks.forEach((l) => {
      const model = buildPierogi(l.color);
      const tag = nameTag(l.name, l.color);
      tag.position.set(0, 1.9, 0);
      tag.scale.set(2.6, 0.65, 1);
      model.root.scale.setScalar(0.8);
      model.root.add(tag);
      stage.add(model.root);
      this.actors.push({ model, tag, color: l.color, trip: -1, land: -1, jump: -1, x: 0 });
    });
  }

  // ---- scenery ----------------------------------------------------------------------------------------
  private buildYard(keep: <T extends { dispose(): void }>(x: T) => T) {
    const stage = this.stage;
    const grass = keep(groundTexture('grass', 22, 5));
    const g = keep(new PlaneGeometry(140, 90));
    g.rotateX(-Math.PI / 2);
    const ground = new Mesh(g, keep(flat('#ffffff', { map: grass })));
    ground.position.set(0, 0, -10);
    stage.add(ground);
    // A worn patch of earth where the rope sweeps.
    const dirt = keep(groundTexture('sand', 6, 9));
    const pg = keep(new PlaneGeometry(this.half * 2 + 3, 5.5));
    pg.rotateX(-Math.PI / 2);
    const patch = new Mesh(pg, keep(flat('#d9b98a', { map: dirt })));
    patch.position.set(0, 0.01, -0.3);
    stage.add(patch);

    // A picket fence along the back, with a gate.
    const white = keep(flat('#f4ecdc'));
    const fenceZ = -7.5;
    const span = 34;
    const rail = box(span, 0.16, 0.12, white);
    rail.position.set(0, 0.55, fenceZ);
    const rail2 = rail.clone();
    rail2.position.y = 1.15;
    stage.add(rail, rail2);
    const picketGeo = keep(new ConeGeometry(0.16, 0.3, 4));
    for (let x = -span / 2; x <= span / 2; x += 0.75) {
      const p = box(0.24, 1.5, 0.08, white);
      p.position.set(x, 0.75, fenceZ + 0.08);
      const tip = new Mesh(picketGeo, white);
      tip.position.set(x, 1.65, fenceZ + 0.08);
      tip.rotation.y = Math.PI / 4;
      stage.add(p, tip);
    }

    // A whitewashed cottage with a thatched roof and blue shutters.
    const cottage = new Group();
    const wall = box(9, 3.6, 5.5, keep(flat('#f6efe2')));
    const base = box(9.2, 0.5, 5.7, keep(flat('#8a6f5a')));
    const roof = new Mesh(keep(new ConeGeometry(6.8, 3.6, 4)), keep(flat('#c9a05a')));
    roof.rotation.y = Math.PI / 4;
    roof.scale.set(1.0, 1, 0.62);
    roof.position.y = 3.6 + 1.7;
    const door = box(1.3, 2.2, 0.1, keep(flat('#6b8fc2')));
    door.position.set(-1.6, 0, 2.78);
    const blue = keep(flat('#3568b8'));
    const pane = keep(flat('#fff4c8'));
    for (const x of [1.0, 3.0]) {
      const w = box(1.1, 1.1, 0.1, pane);
      w.position.set(x, 1.4, 2.78);
      const s1 = box(0.45, 1.2, 0.08, blue);
      s1.position.set(x - 0.8, 1.35, 2.8);
      const s2 = s1.clone();
      s2.position.x = x + 0.8;
      cottage.add(w, s1, s2);
    }
    // A wycinanki-red band under the eaves.
    const band = box(9.05, 0.25, 5.55, keep(flat('#cf3a2c')));
    band.position.y = 3.1;
    cottage.add(base, wall, band, roof, door);
    cottage.position.set(-11, 0, -14);
    cottage.rotation.y = 0.25;
    stage.add(cottage);

    // A well on the right.
    const stone = keep(flat('#a49a8c'));
    const wood = keep(flat('#8a5a32'));
    const well = new Group();
    const ring = new Mesh(keep(new CylinderGeometry(1.3, 1.4, 1.1, 10)), stone);
    ring.position.y = 0.55;
    const water = new Mesh(keep(new CylinderGeometry(1.05, 1.05, 0.05, 10)), keep(flat('#2e5f86')));
    water.position.y = 1.0;
    const posts = [-1.1, 1.1].map((x) => {
      const p = box(0.2, 2.6, 0.2, wood);
      p.position.set(x, 0, 0);
      return p;
    });
    const wroof = new Mesh(keep(new ConeGeometry(1.9, 1.1, 4)), keep(flat('#b0473a')));
    wroof.rotation.y = Math.PI / 4;
    wroof.scale.z = 0.6;
    wroof.position.y = 3.0;
    const bucket = new Mesh(keep(new CylinderGeometry(0.28, 0.22, 0.4, 7)), wood);
    bucket.position.set(0, 1.9, 0);
    well.add(ring, water, ...posts, wroof, bucket);
    well.position.set(13.5, 0, -10.5);
    stage.add(well);

    // Sunflowers along the fence, and a few hay bales.
    const rnd = mulberry32(17);
    const stem = keep(new CylinderGeometry(0.06, 0.08, 1, 5));
    const stemMat = keep(flat('#4f8a2c'));
    const petals = keep(new CylinderGeometry(0.62, 0.62, 0.08, 10));
    const petalMat = keep(flat('#ffc72c'));
    const middle = keep(new CylinderGeometry(0.3, 0.3, 0.12, 8));
    const middleMat = keep(flat('#5a3418'));
    for (let k = 0; k < 9; k++) {
      const x = -15 + k * 3.6 + rnd() * 1.2;
      if (Math.abs(x - 3) < 1.8) continue;
      const h = 2.2 + rnd() * 1.1;
      const f = new Group();
      const s = new Mesh(stem, stemMat);
      s.scale.y = h;
      s.position.y = h / 2;
      const head = new Group();
      const p = new Mesh(petals, petalMat);
      p.rotation.x = Math.PI / 2;
      const m = new Mesh(middle, middleMat);
      m.rotation.x = Math.PI / 2;
      m.position.z = 0.05;
      head.add(p, m);
      head.position.y = h;
      head.rotation.x = -0.25;
      f.add(s, head);
      f.position.set(x, 0, fenceZ + 0.9);
      stage.add(f);
      this.sunflowers.push(head);
    }
    const hay = keep(flat('#e3c06a'));
    for (const [x, z, r] of [
      [10.5, -5.4, 0.2],
      [12.3, -5.0, -0.3],
      [11.3, -5.3, 0.1],
    ] as const) {
      const bale = box(1.6, 1.0, 1.0, hay);
      bale.position.set(x, z === -5.3 ? 1.0 : 0, z);
      bale.rotation.y = r;
      stage.add(bale);
    }
    // Two hens pecking by the cottage.
    const henMat = keep(flat('#f8f1e2'));
    const comb = keep(flat('#d8322a'));
    for (const [x, z] of [
      [-6.5, -5.2],
      [-8.2, -4.4],
    ] as const) {
      const hen = new Group();
      const body = new Mesh(keep(new SphereGeometry(0.42, 6, 4)), henMat);
      body.scale.set(1.2, 0.9, 0.9);
      body.position.y = 0.45;
      const head = new Mesh(keep(new SphereGeometry(0.22, 5, 3)), henMat);
      head.position.set(0.45, 0.82, 0);
      const c = new Mesh(keep(new SphereGeometry(0.09, 4, 2)), comb);
      c.position.set(0.48, 1.03, 0);
      hen.add(body, head, c, blobShadow(0.5, 0.25));
      hen.position.set(x, 0, z);
      hen.rotation.y = x < -7 ? 0.8 : 2.4;
      stage.add(hen);
    }
  }

  // ---- players ----------------------------------------------------------------------------------------
  reset(sim: RopeSim) {
    this.actors.forEach((a, i) => {
      const p = sim.players[i];
      a.trip = a.land = a.jump = -1;
      a.x = p?.x ?? 0;
      a.model.body.rotation.set(0, 0, 0);
      a.model.body.scale.set(1, 1, 1);
      a.model.body.position.set(0, 0, 0);
      a.model.root.rotation.set(0, 0, 0);
      a.model.root.position.set(a.x, 0, 0);
      a.model.shadow.visible = true;
      a.tag.visible = !p?.gone;
      a.model.root.visible = !p?.gone;
    });
  }

  hide(i: number) {
    const a = this.actors[i];
    if (a) a.model.root.visible = false;
  }

  jumped(i: number) {
    const a = this.actors[i];
    if (!a) return;
    a.jump = 0;
    a.land = -1;
    const r = a.model.root.position;
    for (let k = 0; k < 4; k++) this.puffs.spawn(r.x + (Math.random() - 0.5) * 0.8, 0.1, r.z + (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 1.5, 0.8, (Math.random() - 0.5) * 1, 0.28, 0.45, '#e6cf9f');
  }

  landed(i: number) {
    const a = this.actors[i];
    if (!a || a.trip >= 0) return;
    a.land = 0;
    a.jump = -1;
  }

  tripped(i: number) {
    const a = this.actors[i];
    if (!a) return;
    a.trip = 0;
    a.tag.visible = false;
    this.shake = Math.min(0.9, this.shake + 0.35);
    const r = a.model.root.position;
    for (let k = 0; k < 10; k++) {
      const ang = (k / 10) * Math.PI * 2;
      this.puffs.spawn(r.x, 0.3, r.z, Math.cos(ang) * 3, 2 + Math.random() * 2, Math.sin(ang) * 2 - 1.5, 0.3, 0.7, k % 2 ? a.color : '#e6cf9f');
    }
  }

  /** Where a world point is on the 1920×1080 stage. */
  toStage(x: number, y: number, z: number) {
    return this.stage.toStage(new Vector3(x, y, z));
  }

  /** A point on the rope: `s` 0..1 from the left hand to the right one. */
  private ropePoint(s: number, phase: number, out: Vector3) {
    const a = phase * Math.PI * 2;
    // Flat in the middle, pinched at the hands: the long middle sweeps the ground evenly.
    const w = 1 - Math.pow(Math.abs(2 * s - 1), 4);
    const hand = 0.2 * (1 - w);
    out.set(-this.half + 2 * this.half * s, ROPE_H + (ROPE_R * w + hand) * Math.cos(a), (ROPE_R * w + hand) * Math.sin(a));
    return out;
  }

  // ---- drawing ----------------------------------------------------------------------------------------
  render(sim: RopeSim, dt: number) {
    this.time += dt;
    const phase = sim.rope;

    // The rope.
    for (let k = 0; k < LINKS; k++) {
      this.ropePoint(k / LINKS, phase, this.a);
      this.ropePoint((k + 1) / LINKS, phase, this.b);
      const m = this.links[k];
      m.position.copy(this.a).add(this.b).multiplyScalar(0.5);
      const len = this.a.distanceTo(this.b);
      this.b.sub(this.a).normalize();
      this.q.setFromUnitVectors(UP, this.b);
      m.quaternion.copy(this.q);
      m.scale.set(1, Math.max(0.1, len - LINK_R * 0.6), 1);
      this.ropePoint(k / LINKS, phase, this.knots[k].position);
    }
    const mid = this.ropePoint(0.5, phase, this.a);
    const low = 1 - Math.min(1, (mid.y - 0.05) / (ROPE_R * 1.6));
    this.ropeShadowMat.opacity = 0.5 * low * low;
    this.ropeShadow.position.z = mid.z;
    this.ropeShadow.scale.x = this.half * 1.75;
    // Dust kicked up as the rope skims the ground.
    if (sim.phase === 'turn' && mid.y < 0.25 && Math.random() < 0.7) {
      const x = (Math.random() - 0.5) * this.half * 1.6;
      this.puffs.spawn(x, 0.1, mid.z, (Math.random() - 0.5) * 0.6, 0.6 + Math.random(), -1.2, 0.22 + Math.random() * 0.2, 0.5, '#dcc597');
    }

    // The babcias turn the rope with their whole bodies.
    const a = phase * Math.PI * 2;
    this.babcias.forEach((b, k) => {
      const s = k === 0 ? -1 : 1;
      b.body.rotation.z = Math.cos(a) * 0.08 * s;
      b.body.rotation.x = Math.sin(a) * 0.06;
      b.body.position.y = Math.abs(Math.sin(a)) * 0.05;
    });

    // Pierogi.
    this.actors.forEach((ac, i) => {
      const sp = sim.players[i];
      if (!sp || sp.gone) return;
      const root = ac.model.root;
      const body = ac.model.body;
      if (ac.trip >= 0) {
        // Knocked over backwards by the rope, then lying on their back behind the line.
        ac.trip += dt;
        const t = Math.min(1, ac.trip / 0.55);
        const z = -2.6 * smooth(t);
        const hop = Math.sin(t * Math.PI) * 0.9;
        root.position.set(sp.x, hop, z);
        body.rotation.x = -smooth(t) * (Math.PI / 2) * 0.95;
        body.rotation.z = Math.sin(ac.trip * 7) * 0.12 * (1 - t);
        body.scale.set(1, 1, 1);
        ac.model.shadow.visible = t < 0.95;
        // Little birds circling a dizzy head.
        if (ac.trip > 0.6 && Math.random() < dt * 4) this.puffs.spawn(sp.x + (Math.random() - 0.5) * 0.6, 0.6, z + 0.2, 0, 1.4, 0, 0.18, 0.6, '#fff4c8');
        return;
      }
      let sy = 1;
      let sxz = 1;
      if (ac.land >= 0) {
        ac.land += dt;
        const t = ac.land / 0.22;
        if (t < 1) {
          const k = Math.sin(t * Math.PI);
          sy = 1 - 0.28 * k;
          sxz = 1 + 0.2 * k;
        } else ac.land = -1;
      }
      if (sp.y > 0) {
        // Tuck in mid-air.
        sy *= 1.12;
        sxz *= 0.9;
      } else if (sim.phase === 'turn' || sim.phase === 'wait') {
        // A little bounce on the spot to the rope's beat.
        const beat = Math.abs(Math.sin(a));
        sy *= 1 - 0.04 * beat;
      }
      body.scale.set(sxz, sy, sxz);
      body.rotation.x = sp.y > 0 ? -sp.vy * 0.02 : 0;
      body.rotation.z = Math.sin(this.time * 3 + i) * 0.04;
      root.position.set(sp.x, sp.y, 0);
      ac.model.shadow.position.y = (0.03 - sp.y) / root.scale.y;
      ac.model.shadow.scale.set(1 - Math.min(0.5, sp.y * 0.6), 0.6, 1 - Math.min(0.5, sp.y * 0.6));
    });

    // Sunflowers nod in the breeze.
    this.sunflowers.forEach((h, i) => (h.rotation.z = Math.sin(this.time * 1.3 + i) * 0.08));
    this.puffs.update(dt);

    // Camera: the whole rope, from a little above the yard.
    const stage = this.stage;
    const target = new Vector3(0, 1.1, -0.4);
    stage.lookAt(target, 2 + this.half * 1.85, 0.27);
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
