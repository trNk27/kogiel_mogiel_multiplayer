/**
 * Dzwonki's own sounds (there's no music in this game: the bells are the music). A bell is a sine
 * fundamental with a hum an octave below and a few inharmonic partials that die away faster, so it
 * sounds struck rather than played.
 */
import { sound } from '../../lib/sound';
import { BELLS } from './logic';

/** A belfry bell of the tune. `vol` 0–1. */
export function ringBell(bell: number, vol = 1, delay = 0) {
  const b = BELLS[bell];
  if (!b) return;
  const f = b.freq;
  const d = 1.3 + b.size * 1.3;
  sound.note(f, d, { type: 'sine', vol: 0.17 * vol, delay });
  sound.note(f * 0.5, d * 1.15, { type: 'sine', vol: 0.07 * vol, delay });
  sound.note(f * 1.19, d * 0.5, { type: 'sine', vol: 0.03 * vol, delay });
  sound.note(f * 2.0, d * 0.6, { type: 'sine', vol: 0.06 * vol, delay });
  sound.note(f * 2.76, d * 0.4, { type: 'sine', vol: 0.045 * vol, delay });
  sound.note(f * 4.07, d * 0.22, { type: 'sine', vol: 0.025 * vol, delay });
  // The strike of the clapper.
  sound.note(f * 5.4, 0.09, { type: 'triangle', vol: 0.03 * vol, delay });
}

/** A player's little handbell: an octave up, quiet and short. */
export function ringHandbell(bell: number, delay = 0) {
  const b = BELLS[bell];
  if (!b) return;
  const f = b.freq * 2;
  sound.note(f, 0.75, { type: 'sine', vol: 0.05, delay });
  sound.note(f * 2.76, 0.3, { type: 'sine', vol: 0.016, delay });
  sound.note(f * 5.1, 0.07, { type: 'triangle', vol: 0.014, delay });
}

/** A handbell dropped on the ground. */
export function clonk() {
  sound.note(150, 0.22, { type: 'square', vol: 0.05, slide: 95 });
  sound.note(97, 0.35, { type: 'triangle', vol: 0.11, slide: 68 });
  sound.hiss(0.1, 0.16);
}

/** Someone rang the whole tune right: three little handbells going up. */
export function chime() {
  [1046.5, 1318.5, 1568].forEach((f, i) => {
    sound.note(f, 0.5, { type: 'sine', vol: 0.04, delay: i * 0.07 });
    sound.note(f * 2.76, 0.18, { type: 'sine', vol: 0.01, delay: i * 0.07 });
  });
}

/** The countdown: the little bell, then the big one for “go”. */
export function countBell(last: boolean) {
  if (last) ringBell(0, 0.8);
  else ringHandbell(3);
}
