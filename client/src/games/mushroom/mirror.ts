/** Grzybki without a TV: the arena on a phone, played back from the host's snapshots. */
import { colorHex, type ArenaNet } from '../../../../shared/protocol';
import { SnapBuffer } from '../arena/net';
import type { ArenaMirror, Cue } from '../arena/mirror';
import { MushroomSim, type MEvent } from './logic';
import { apply } from './net';
import { MushroomScene } from './scene';

export class MushroomMirror implements ArenaMirror {
  private sim: MushroomSim;
  private scene: MushroomScene;
  private buf = new SnapBuffer();
  private names: { name: string; color: string }[];

  constructor(
    canvas: HTMLCanvasElement,
    private net: ArenaNet,
    private round: number,
    private cue: (c: Cue) => void,
  ) {
    this.names = net.players.map((p) => ({ name: p.name, color: colorHex(p.color) }));
    this.sim = this.makeSim(net.seed);
    this.scene = new MushroomScene(canvas, this.names, this.sim);
  }

  /** `seed` is the number of mushrooms; everything else comes in the snapshots. */
  private makeSim(caps: number) {
    const n = this.net.players.length;
    return new MushroomSim(n, Math.random, Array.from({ length: n }, () => true), undefined, caps);
  }

  reset(round: number, seed: number) {
    if (round === this.round) return;
    this.round = round;
    this.sim = this.makeSim(seed);
    this.scene.sim = this.sim;
    this.buf = new SnapBuffer();
  }

  onSnapshot(r: number, at: number, s: number[], e: unknown[]) {
    if (r === this.round) this.buf.push(at, s, e);
  }

  render(dt: number) {
    const f = this.buf.frame();
    if (f) {
      for (const e of f.events as MEvent[]) {
        this.scene.onEvent(e);
        this.react(e);
      }
      apply(this.sim, f.a.s, f.b.s, f.k);
    }
    this.scene.render(dt);
  }

  private splash(who: number[]) {
    if (who.length === 0) return;
    const one = who.length === 1 ? this.names[who[0]] : null;
    this.cue({ say: { text: `Splash! ${who.map((i) => this.names[i]?.name ?? '?').join(', ')}`, color: one?.color } });
  }

  private react(e: MEvent) {
    switch (e.t) {
      case 'call':
        this.cue({ sfx: 'bell' });
        if (e.swap) this.cue({ sfx: 'reveal', say: { text: 'The mushrooms swapped colours!' } });
        else if (e.twin !== null) this.cue({ say: { text: 'Two mushrooms are the same colour – either one is safe' } });
        break;
      case 'sink':
        this.cue({ sfx: e.fell.length > 0 ? 'plop' : 'whoosh' });
        this.splash(e.fell);
        break;
      case 'fall':
        if (e.why === 'edge') {
          this.cue({ sfx: 'plop' });
          this.splash([e.p]);
        }
        break;
      case 'shove':
        this.cue({ sfx: 'whoosh' });
        break;
      case 'hit':
        this.cue({ sfx: 'crash' });
        break;
      case 'rise':
        this.cue({ sfx: 'lockIn' });
        break;
      case 'over':
        this.cue({ sfx: 'fanfare' });
        break;
      case 'recolour':
        break;
    }
  }

  clock() {
    return null;
  }

  dispose() {
    this.scene.dispose();
  }
}
