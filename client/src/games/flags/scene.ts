/**
 * Babcia Mówi in 3D: a wooden jetty on a lake at sunset. Each pierogi stands on its own plank holding
 * a white flag (on the left, as the TV sees it) and a red one (on the right); Babcia calls the flags
 * from a crate on the shore. A wrong flag tips the plank, and its pierogi into the water.
 */
import { BoxGeometry, ConeGeometry, CylinderGeometry, Group, Mesh, PlaneGeometry, Vector3, type Sprite, type Texture } from 'three';
import { ArenaStage, box, buildPierogi, flat, groundTexture, nameTag, type PierogiModel } from '../arena/kit';
import { buildBabcia } from '../arena/babcia';
import { Puffs } from '../arena/puffs';
import { mulberry32 } from '../rng';
import { RED, WHITE, type FlagsSim } from './logic';

export interface PlayerLook {
  name: string;
  color: string;
}

const SPACING = 1.9;
const PLANK_Y = 0.75;
const BABCIA_Z = -5.2;
const WHITE_HEX = '#fbf6ec';
const RED_HEX = '#dc143c';

interface Flag {
  pivot: Group;
  cloth: Mesh;
  /** 0 down, 1 up (smoothed). */
  up: number;
}

/** A flag on a pole that swings up and down from a pivot at the hand. `side` -1 is the TV's left. */
function buildFlag(color: string, side: number, keep: <T extends { dispose(): void }>(x: T) => T, size = 1): Flag {
  const pivot = new Group();
  const pole = new Mesh(keep(new CylinderGeometry(0.035 * size, 0.035 * size, 1.5 * size, 5)), keep(flat('#7a4e28')));
  pole.position.y = 0.75 * size;
  const cloth = new Mesh(keep(new BoxGeometry(0.8 * size, 0.55 * size, 0.03)), keep(flat(color)));
  cloth.position.set(side * 0.42 * size, 1.22 * size, 0);
  const knob = new Mesh(keep(new CylinderGeometry(0.06 * size, 0.06 * size, 0.08 * size, 5)), keep(flat('#ffc93c')));
  knob.position.y = 1.52 * size;
  pivot.add(pole, cloth, knob);
  return { pivot, cloth, up: 0 };
}

function flagAngle(side: number, up: number) {
  // Down: pointing down and out at the side. Up: high over the head, leaning out a little.
  const down = -side * Math.PI * 0.72;
  const high = -side * 0.22;
  return down + (high - down) * up;
}

interface Actor {
  model: PierogiModel;
  tag: Sprite;
  flags: [Flag, Flag];
  plank: Group;
  x: number;
  /** Seconds since falling in, or -1. */
  fall: number;
  /** Seconds since getting a call right (for the little hop), or -1. */
  cheer: number;
}

const smooth = (x: number) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};

export class FlagsScene {
  readonly stage: ArenaStage;
  readonly half: number;
  private actors: Actor[] = [];
  private babcia: PierogiModel;
  private babciaFlags: [Flag, Flag];
  private puffs = new Puffs(200, 9, 1.4);
  private water: Texture;
  private bigFlag: Mesh;
  private time = 0;
  private shake = 0;

  constructor(canvas: HTMLCanvasElement, looks: PlayerLook[]) {
    this.stage = new ArenaStage(canvas, { sky: '#f4a46c', fog: [50, 130], fov: 36 });
    const stage = this.stage;
    const keep = <T extends { dispose(): void }>(x: T) => stage.keep(x);
    this.half = (Math.max(1, looks.length) - 1) / 2 * SPACING;

    this.water = keep(groundTexture('water', 26, 2));
    const wg = keep(new PlaneGeometry(160, 110));
    wg.rotateX(-Math.PI / 2);
    const lake = new Mesh(wg, keep(flat('#ffffff', { map: this.water })));
    lake.position.set(0, 0, -10);
    stage.add(lake);
    this.buildShore(keep);
    this.buildJetty(keep, looks.length);

    // Babcia on her crate, with her own pair of flags.
    const crate = box(2.6, 1.2, 2.0, keep(flat('#9a6a3a')));
    crate.position.set(0, 0.35, BABCIA_Z);
    stage.add(crate);
    this.babcia = buildBabcia(keep);
    this.babcia.root.scale.setScalar(1.8);
    this.babcia.root.position.set(0, 1.55, BABCIA_Z);
    this.babciaFlags = [buildFlag(WHITE_HEX, -1, keep, 0.75), buildFlag(RED_HEX, 1, keep, 0.75)];
    this.babciaFlags.forEach((f, k) => {
      f.pivot.position.set((k === 0 ? -1 : 1) * 0.82, 0.25, 0.15);
      this.babcia.body.add(f.pivot);
    });
    stage.add(this.babcia.root);
    // A big Polish flag on a mast behind her.
    const mast = new Mesh(keep(new CylinderGeometry(0.09, 0.12, 6, 6)), keep(flat('#e9e2d4')));
    mast.position.set(5.5, 3, BABCIA_Z - 1.5);
    stage.add(mast);
    const flagGroup = new Group();
    const top = box(2.6, 0.8, 0.04, keep(flat(WHITE_HEX)));
    top.position.y = 0.8;
    const bottom = box(2.6, 0.8, 0.04, keep(flat(RED_HEX)));
    flagGroup.add(top, bottom);
    flagGroup.children.forEach((c) => (c.position.x = 1.3));
    flagGroup.position.set(5.5, 4.6, BABCIA_Z - 1.5);
    this.bigFlag = top;
    stage.add(flagGroup);

    stage.add(this.puffs.mesh);
    looks.forEach((l, i) => {
      const model = buildPierogi(l.color);
      const tag = nameTag(l.name, l.color);
      tag.position.set(0, 1.85, 0);
      tag.scale.set(2.7, 0.68, 1);
      model.root.scale.setScalar(0.8);
      model.root.add(tag);
      const flags: [Flag, Flag] = [buildFlag(WHITE_HEX, -1, keep, 0.85), buildFlag(RED_HEX, 1, keep, 0.85)];
      flags.forEach((f, k) => {
        f.pivot.position.set((k === 0 ? -1 : 1) * 0.82, 0.42, 0.12);
        f.pivot.rotation.z = flagAngle(k === 0 ? -1 : 1, 0);
        model.body.add(f.pivot);
      });
      stage.add(model.root);
      const plank = this.buildPlank(keep, i);
      const x = (i - (looks.length - 1) / 2) * SPACING;
      plank.position.set(x, PLANK_Y, 0.8);
      stage.add(plank);
      this.actors.push({ model, tag, flags, plank, x, fall: -1, cheer: -1 });
    });
  }

  // ---- scenery ----------------------------------------------------------------------------------------
  private buildShore(keep: <T extends { dispose(): void }>(x: T) => T) {
    const stage = this.stage;
    const sand = keep(groundTexture('sand', 10, 4));
    const sg = keep(new PlaneGeometry(70, 14));
    sg.rotateX(-Math.PI / 2);
    const beach = new Mesh(sg, keep(flat('#ffffff', { map: sand })));
    beach.position.set(0, 0.06, -9);
    stage.add(beach);
    const grass = keep(groundTexture('grass', 12, 8));
    const gg = keep(new PlaneGeometry(90, 30));
    gg.rotateX(-Math.PI / 2);
    const meadow = new Mesh(gg, keep(flat('#ffffff', { map: grass })));
    meadow.position.set(0, 0.1, -29);
    stage.add(meadow);
    // A dark pine forest on the far side.
    const pine = keep(new ConeGeometry(1.6, 6, 6));
    const pineMat = keep(flat('#2c5232'));
    const pineMat2 = keep(flat('#38663a'));
    const rnd = mulberry32(12);
    for (let k = 0; k < 34; k++) {
      const m = new Mesh(pine, k % 2 ? pineMat : pineMat2);
      const s = 0.8 + rnd() * 0.8;
      m.scale.set(s, s, s);
      m.position.set(-34 + k * 2.1 + rnd(), 3 * s, -22 - rnd() * 6);
      stage.add(m);
    }
    // Reeds by the water.
    const reed = keep(new CylinderGeometry(0.04, 0.05, 1.6, 4));
    const reedMat = keep(flat('#6f8a3a'));
    const head = keep(new CylinderGeometry(0.09, 0.09, 0.35, 5));
    const headMat = keep(flat('#6b4222'));
    for (let k = 0; k < 40; k++) {
      const side = k % 2 ? -1 : 1;
      const x = side * (8 + rnd() * 9);
      const z = -6 + rnd() * 9;
      const g = new Group();
      const r = new Mesh(reed, reedMat);
      r.position.y = 0.8;
      const h = new Mesh(head, headMat);
      h.position.y = 1.55;
      g.add(r, h);
      g.position.set(x, 0, z);
      g.rotation.z = (rnd() - 0.5) * 0.3;
      stage.add(g);
    }
    // Lily pads.
    const pad = keep(new CylinderGeometry(0.5, 0.5, 0.03, 8));
    const padMat = keep(flat('#4f8a2c'));
    for (let k = 0; k < 14; k++) {
      const m = new Mesh(pad, padMat);
      m.position.set((rnd() - 0.5) * 30, 0.03, 3 + rnd() * 6);
      stage.add(m);
    }
  }

  private buildJetty(keep: <T extends { dispose(): void }>(x: T) => T, count: number) {
    const stage = this.stage;
    const dark = keep(flat('#6b4a2a'));
    const len = Math.max(1, count) * SPACING + 1.6;
    // Two beams under the planks, on posts in the water.
    const beam = box(len, 0.3, 0.3, dark);
    beam.position.set(0, PLANK_Y - 0.31, 0.85);
    const beam2 = beam.clone();
    beam2.position.z = 2.55;
    stage.add(beam, beam2);
    const post = keep(new CylinderGeometry(0.16, 0.18, 2.4, 6));
    for (let x = -len / 2; x <= len / 2 + 0.01; x += SPACING) {
      for (const z of [0.85, 2.55]) {
        const p = new Mesh(post, dark);
        p.position.set(x, PLANK_Y - 1.5, z);
        stage.add(p);
      }
    }
  }

  /** A trapdoor plank, hinged at its back edge (the group's origin); it reaches 1.8 m towards the camera. */
  private buildPlank(keep: <T extends { dispose(): void }>(x: T) => T, i: number) {
    const g = new Group();
    const p = new Mesh(keep(new BoxGeometry(SPACING - 0.12, 0.16, 1.8)), keep(flat(i % 2 ? '#b98448' : '#c49052')));
    p.position.set(0, -0.08, 0.9);
    g.add(p);
    return g;
  }

  // ---- events ----------------------------------------------------------------------------------------
  reset(sim: FlagsSim) {
    this.actors.forEach((a, i) => {
      const p = sim.players[i];
      a.fall = a.cheer = -1;
      a.plank.rotation.x = 0;
      a.model.root.rotation.set(0, 0, 0);
      a.model.body.rotation.set(0, 0, 0);
      a.model.body.scale.set(1, 1, 1);
      a.model.root.position.set(a.x, PLANK_Y, 1.7);
      a.model.shadow.visible = true;
      a.model.root.visible = !p?.gone;
      a.tag.visible = !p?.gone;
      a.flags.forEach((f) => (f.up = 0));
    });
  }

  hide(i: number) {
    const a = this.actors[i];
    if (a) a.model.root.visible = false;
  }

  fell(i: number) {
    const a = this.actors[i];
    if (!a || a.fall >= 0) return;
    a.fall = 0;
    a.tag.visible = false;
    this.shake = Math.min(0.6, this.shake + 0.25);
  }

  cheered(i: number) {
    const a = this.actors[i];
    if (a) a.cheer = 0;
  }

  private splash(x: number, z: number) {
    for (let k = 0; k < 22; k++) {
      const a = (k / 22) * Math.PI * 2;
      const s = 1.5 + Math.random() * 2;
      this.puffs.spawn(x, 0.1, z, Math.cos(a) * s, 3.5 + Math.random() * 3.5, Math.sin(a) * s, 0.2 + Math.random() * 0.15, 0.8, k % 3 ? '#cfe8ff' : '#ffffff', 0.5);
    }
  }

  toStage(x: number, y: number, z: number) {
    return this.stage.toStage(new Vector3(x, y, z));
  }

  /** Where to put a label over player i (wherever they are, on the jetty or in the lake). */
  above(i: number) {
    const a = this.actors[i];
    const r = a?.model.root.position;
    return this.stage.toStage(new Vector3(r?.x ?? 0, Math.max(0, r?.y ?? 0) + 2.2, r?.z ?? 0));
  }

  // ---- drawing ----------------------------------------------------------------------------------------
  render(sim: FlagsSim, dt: number) {
    this.time += dt;
    const calling = sim.phase === 'call' && sim.call;

    // Babcia's own flags: what she shows during a call (which may not be what she says).
    const shown = calling ? sim.call!.shown : 0;
    this.babciaFlags.forEach((f, k) => {
      const want = shown & (k === 0 ? WHITE : RED) ? 1 : 0;
      f.up += (want - f.up) * Math.min(1, dt * 14);
      f.pivot.rotation.z = flagAngle(k === 0 ? -1 : 1, f.up);
      f.cloth.rotation.y = Math.sin(this.time * 7 + k) * 0.2;
    });
    const b = this.babcia.body;
    b.rotation.z = calling ? Math.sin(this.time * 5) * 0.04 : Math.sin(this.time * 1.5) * 0.03;
    b.scale.y = 1 + (calling && sim.phaseT < 0.25 ? Math.sin((sim.phaseT / 0.25) * Math.PI) * 0.08 : 0);
    this.bigFlag.parent!.rotation.y = Math.sin(this.time * 1.2) * 0.12;

    this.actors.forEach((a, i) => {
      const sp = sim.players[i];
      if (!sp || sp.gone) return;
      const root = a.model.root;
      const body = a.model.body;
      // Flags follow what the player raised for this call (down in the gaps).
      const raised = sim.phase === 'call' || (sim.phase === 'gap' && sim.phaseT < 0.6) ? sp.raised : 0;
      a.flags.forEach((f, k) => {
        const want = raised & (k === 0 ? WHITE : RED) ? 1 : 0;
        f.up += (want - f.up) * Math.min(1, dt * 20);
        f.pivot.rotation.z = flagAngle(k === 0 ? -1 : 1, f.up);
        f.cloth.rotation.y = Math.sin(this.time * 8 + i + k) * 0.25 * f.up;
      });
      if (a.fall >= 0) {
        a.fall += dt;
        // The plank tips forward and drops the pierogi into the lake; it bobs there afterwards.
        const t = a.fall;
        a.plank.rotation.x = smooth(t / 0.25) * 1.25;
        const drop = Math.min(1, Math.max(0, (t - 0.1) / 0.5));
        const y = t < 0.6 ? PLANK_Y - (PLANK_Y + 0.9) * drop * drop : -0.45 + Math.sin(this.time * 2.2 + i) * 0.08;
        const z = 1.7 + drop * 1.6;
        if (t >= 0.6 && t - dt < 0.6) this.splash(a.x, z);
        root.position.set(a.x, y, z);
        body.rotation.x = Math.min(1, t * 2) * 0.5;
        body.rotation.z = Math.sin(this.time * 1.7 + i) * 0.15;
        a.model.shadow.visible = false;
        return;
      }
      a.plank.rotation.x *= Math.exp(-8 * dt);
      let hop = 0;
      if (a.cheer >= 0) {
        a.cheer += dt;
        const t = a.cheer / 0.35;
        if (t < 1) hop = Math.sin(t * Math.PI) * 0.35;
        else a.cheer = -1;
      }
      root.position.set(a.x, PLANK_Y + hop, 1.7);
      body.rotation.z = Math.sin(this.time * 2 + i) * 0.04;
      // Nervous jitter while a call is open and you haven't answered.
      if (sim.phase === 'call' && sp.alive && !sp.locked) body.rotation.z += Math.sin(this.time * 30 + i) * 0.02;
    });

    // The lake ripples.
    this.water.offset.x = Math.sin(this.time * 0.2) * 0.05;
    this.water.offset.y = this.time * 0.01;
    this.puffs.update(dt);

    const stage = this.stage;
    const target = new Vector3(0, 1.4, -1.0);
    stage.lookAt(target, 13 + this.half * 1.15, 0.36);
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

