/** Pushy Pierogi without a TV: the frozen pond on a phone, played back from the host's snapshots. */
import { colorHex, type ArenaNet } from '../../../../shared/protocol';
import { SnapBuffer } from '../arena/net';
import type { ArenaMirror, Cue } from '../arena/mirror';
import { mulberry32 } from '../rng';
import { BIG_BUMP, PushySim, type PushyEvent } from './logic';
import { apply } from './net';
import { PushyScene } from './scene';

export class PushyMirror implements ArenaMirror {
  private sim: PushySim;
  private scene: PushyScene;
  private buf = new SnapBuffer();
  private names: { name: string; color: string }[];
  /** Players the scene has seen fall in this round. */
  private fallen: boolean[] = [];
  private lastBump = 0;
  private lastCrackSay = -1e9;

  constructor(
    canvas: HTMLCanvasElement,
    private net: ArenaNet,
    private round: number,
    private cue: (c: Cue) => void,
  ) {
    this.names = net.players.map((p) => ({ name: p.name, color: colorHex(p.color) }));
    this.sim = this.makeSim(net.seed);
    this.scene = new PushyScene(canvas, this.names);
    this.scene.setup(this.sim);
  }

  /** The same floe as the host's: the sim is built from the round's seed. */
  private makeSim(seed: number) {
    this.fallen = this.net.players.map(() => false);
    return new PushySim(this.net.players.length, mulberry32(seed));
  }

  reset(round: number, seed: number) {
    if (round === this.round) return;
    this.round = round;
    this.sim = this.makeSim(seed);
    this.scene.setup(this.sim);
    this.buf = new SnapBuffer();
  }

  onSnapshot(r: number, at: number, s: number[], e: unknown[]) {
    if (r === this.round) this.buf.push(at, s, e);
  }

  render(dt: number) {
    const f = this.buf.frame();
    if (f) {
      const evs = f.events as PushyEvent[];
      for (const e of evs) if (e.k === 'fall') this.fallen[e.i] = true;
      const more = apply(this.sim, f.a.s, f.b.s, f.k);
      // Somebody already in the water when we joined (or whose fall we missed).
      this.sim.players.forEach((p, i) => {
        if (!p.alive && !p.removed && p.fellTick !== null && !this.fallen[i]) {
          this.fallen[i] = true;
          more.push({ k: 'fall', i, x: p.x, z: p.z, cause: 'edge' });
        }
      });
      const all = [...evs, ...more];
      if (all.length) {
        this.scene.handle(all, this.sim);
        all.forEach((e) => this.react(e));
      }
    }
    this.scene.render(this.sim, dt);
  }

  private react(e: PushyEvent) {
    const now = performance.now();
    switch (e.k) {
      case 'bump':
        if ((e.power >= BIG_BUMP || e.dash) && now - this.lastBump > 90) {
          this.lastBump = now;
          this.cue({ sfx: e.power > 7 || e.dash ? 'crash' : 'plop' });
        }
        break;
      case 'stoneHit':
        this.cue({ sfx: 'crash' });
        break;
      case 'shove':
        this.cue({ sfx: 'whoosh' });
        break;
      case 'brace':
        this.cue({ sfx: 'lockIn' });
        break;
      case 'crack':
        this.cue({ sfx: 'tick' });
        if (now - this.lastCrackSay > 6000) {
          this.lastCrackSay = now;
          this.cue({ say: { text: 'The ice is cracking!' } });
        }
        break;
      case 'break':
        this.cue({ sfx: 'plop' });
        break;
      case 'splash': {
        const p = this.names[e.i];
        this.cue({ sfx: 'plop', say: { text: `Splash! ${p?.name ?? ''}`, color: p?.color } });
        break;
      }
      case 'warn':
        this.cue({ sfx: 'bell', say: { text: 'Curling stone incoming!' } });
        break;
      case 'launch':
        this.cue({ sfx: 'whoosh' });
        break;
      case 'end':
        this.cue({ sfx: 'fanfare' });
        break;
      case 'fall':
        break;
    }
  }

  clock() {
    const left = Math.ceil(this.sim.timeLeft());
    return { text: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`, low: this.sim.live && left <= 10 };
  }

  dispose() {
    this.scene.dispose();
  }
}
