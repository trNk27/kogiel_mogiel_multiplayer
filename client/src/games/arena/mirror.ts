/**
 * The phone's side of a no-TV arena game: builds the game's 3D scene on the phone's canvas and
 * plays back the host's snapshots in it. Loaded on demand (it brings three.js with it).
 */
import type { ArenaNet, ArenaNetGame } from '../../../../shared/protocol';
import { MushroomMirror } from '../mushroom/mirror';
import { PushyMirror } from '../pushy/mirror';

/** Something to show or play on the phone when an event comes round in the playback. */
export interface Cue {
  /** A line over the arena ("Splash! Kasia"), in a colour. */
  say?: { text: string; color?: string };
  sfx?: 'bell' | 'whoosh' | 'plop' | 'crash' | 'tick' | 'lockIn' | 'reveal' | 'fanfare';
}

export interface ArenaMirror {
  /** A new round: rebuild the arena from its seed. Snapshots from other rounds are ignored. */
  reset(round: number, seed: number): void;
  onSnapshot(r: number, at: number, s: number[], e: unknown[]): void;
  /** Play back to now and draw. */
  render(dt: number): void;
  /** A clock for the corner of the arena (Pushy Pierogi), or null. */
  clock(): { text: string; low: boolean } | null;
  dispose(): void;
}

export function createMirror(game: ArenaNetGame, canvas: HTMLCanvasElement, net: ArenaNet, round: number, cue: (c: Cue) => void): ArenaMirror {
  return game === 'mushroom' ? new MushroomMirror(canvas, net, round, cue) : new PushyMirror(canvas, net, round, cue);
}
