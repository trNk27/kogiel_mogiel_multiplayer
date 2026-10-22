/**
 * Krzesła's band: a little polka on a musette accordion (two reeds a hair apart), with an oom-pah
 * bass, played note by note through `sound.note`. Notes are scheduled only a few frames ahead, so
 * when the music stops it stops dead.
 */
import { sound } from '../../lib/sound';

/** -1 holds the note before. Eighth notes, four to a 2/4 bar, 16 bars. */
// prettier-ignore
const MELODY = [
  74, 71, 74, 71,  79, -1, 74, -1,  72, 69, 72, 69,  78, -1, 74, -1,
  74, 71, 74, 71,  79, 78, 76, 74,  72, 76, 74, 72,  71, -1, 67, -1,
  76, -1, 76, 72,  79, -1, 76, -1,  74, -1, 74, 71,  79, -1, 74, -1,
  72, 71, 69, 72,  71, 69, 67, 71,  69, 66, 69, 72,  71, -1, 67, 0,
];
/** Chord per bar. */
const BARS = 'GGDDGGDGCCGGCGDG';
const CHORDS: Record<string, { root: number; alt: number; pah: number[] }> = {
  G: { root: 43, alt: 38, pah: [55, 59, 62] },
  D: { root: 38, alt: 45, pah: [54, 57, 60] },
  C: { root: 48, alt: 43, pah: [55, 60, 64] },
};
const LOOKAHEAD = 0.07;

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

export class Band {
  private playing = false;
  /** Eighth note we're on (into MELODY), and the audio-clock time it is due. */
  private pos = 0;
  private due = 0;
  eighth = 0.15;

  get on() {
    return this.playing;
  }

  /** Strike up from the top of the tune. */
  play(eighth: number) {
    this.eighth = eighth;
    this.pos = 0;
    this.resume();
  }

  /** Carry on where we stopped (after a fake-out). */
  resume() {
    this.playing = true;
    this.due = (sound.context?.currentTime ?? 0) + 0.03;
  }

  /** Stop dead. `scratch`: with a needle-off-the-record slide. */
  stop(scratch = false) {
    if (scratch && this.playing) {
      sound.note(1250, 0.26, { type: 'sawtooth', vol: 0.07, slide: 150 });
      sound.note(620, 0.22, { type: 'square', vol: 0.03, slide: 90, delay: 0.03 });
      sound.hiss(0.2, 0.22);
    }
    this.playing = false;
  }

  /** A fake-out: the bellows sag for a moment. */
  sag() {
    if (this.playing) sound.note(hz(67), 0.45, { type: 'sawtooth', vol: 0.035, slide: hz(60) });
    this.playing = false;
  }

  /** Call every frame. */
  update() {
    if (!this.playing) return;
    const ctx = sound.context;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    // Fell behind (a hidden tab): skip ahead instead of playing a burst.
    if (this.due < now - 0.1) this.due = now + 0.02;
    while (this.due < now + LOOKAHEAD) {
      this.playEighth(this.pos, Math.max(0, this.due - now));
      this.pos = (this.pos + 1) % MELODY.length;
      this.due += this.eighth;
    }
  }

  private playEighth(k: number, delay: number) {
    const e = this.eighth;
    const m = MELODY[k];
    if (m > 0) {
      let len = 1;
      while (MELODY[(k + len) % MELODY.length] === -1) len++;
      const dur = e * len * 0.92;
      const f = hz(m);
      sound.note(f, dur, { type: 'square', vol: 0.032, delay });
      sound.note(f * 1.008, dur, { type: 'sawtooth', vol: 0.022, delay });
      sound.note(f / 2, dur, { type: 'triangle', vol: 0.03, delay });
    }
    const chord = CHORDS[BARS[Math.floor(k / 4) % BARS.length]];
    const beat = k % 4;
    if (beat === 0 || beat === 2) {
      const f = hz(beat === 0 ? chord.root : chord.alt);
      sound.note(f, e * 0.85, { type: 'triangle', vol: 0.16, delay });
      sound.note(f * 2, e * 0.6, { type: 'square', vol: 0.016, delay });
    } else {
      for (const n of chord.pah) sound.note(hz(n), e * 0.45, { type: 'square', vol: 0.012, delay });
    }
  }
}

/** Wah, wah, wah, wahhh. */
export function sadTrombone() {
  [392, 370, 349].forEach((f, i) => sound.note(f, 0.3, { type: 'sawtooth', vol: 0.06, delay: i * 0.36 }));
  // The last one wobbles down.
  for (let k = 0; k < 6; k++) sound.note(330 - k * 6 + (k % 2 ? 6 : 0), 0.16, { type: 'sawtooth', vol: 0.06 * (1 - k / 8), delay: 1.08 + k * 0.13 });
}

/** A happy thump onto a chair. */
export function sitSound() {
  sound.note(190, 0.12, { type: 'triangle', vol: 0.2, slide: 95 });
  sound.note(880, 0.08, { type: 'triangle', vol: 0.08, delay: 0.05 });
  sound.note(1320, 0.12, { type: 'triangle', vol: 0.08, delay: 0.1 });
}
