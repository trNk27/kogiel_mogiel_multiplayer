/**
 * The soundtrack, written out note by note. Each part is a string of steps:
 *   `D5` a note · `D4+F#4+A4` several at once · `-` hold the last one a step longer · `.` rest · `|` ignored.
 * Drum parts use k kick, s snare, h hat, o open hat, r rim, b brush, c clap, x shaker.
 * The helpers below spell out the oom-pahs, walking basses and arpeggios from a chord per bar.
 */

export type Inst = 'bass' | 'accordion' | 'pluck' | 'ep' | 'pad' | 'lead' | 'sax' | 'bell' | 'drums';

export interface PartDef {
  inst: Inst;
  vol: number;
  seq: string;
}

export interface TrackDef {
  name: string;
  bpm: number;
  /** Steps per beat (2 = eighth notes). */
  steps: number;
  beatsPerBar: number;
  bars: number;
  /** Delay of every other step, as a fraction of a step (0.33 is a jazzy swing). */
  swing?: number;
  parts: PartDef[];
}

export type TrackId = 'lobby' | 'quiz' | 'polka' | 'arena' | 'race' | 'lounge';

// ---------------------------------------------------------------------------
// Notes and chords
// ---------------------------------------------------------------------------

const PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** MIDI number of a note name like `F#4` or `Bb3`, or null. */
export function midi(name: string): number | null {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
  if (!m) return null;
  return 12 * (Number(m[3]) + 1) + PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}

function noteName(n: number): string {
  return `${NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;
}

const QUALITIES: Record<string, number[]> = {
  '': [0, 4, 7],
  m: [0, 3, 7],
  '7': [0, 4, 7, 10],
  m7: [0, 3, 7, 10],
  maj7: [0, 4, 7, 11],
  dim: [0, 3, 6],
  m7b5: [0, 3, 6, 10],
  '6': [0, 4, 7, 9],
  sus4: [0, 5, 7],
};

/** Root pitch class and intervals of a chord symbol like `F#m7`. */
export function chord(sym: string): { root: number; iv: number[] } {
  const m = /^([A-G])(#|b)?(.*)$/.exec(sym);
  if (!m || !(m[3] in QUALITIES)) throw new Error(`Unknown chord ${sym}`);
  return { root: (PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + 12) % 12, iv: QUALITIES[m[3]] };
}

/**
 * Turns a chord per bar into a part. A bar may hold two chords ("Em A7"), each taking its share of the bar.
 * `pattern` is one bar of tokens; `voice(chord, token)` says what a token plays (a note string, '.' or '-').
 */
function perBar(chords: string[], pattern: string, voice: (c: { root: number; iv: number[] }, tok: string) => string): string {
  const toks = pattern.trim().split(/\s+/);
  return chords
    .map((bar) => {
      const cs = bar.trim().split(/\s+/).map(chord);
      return toks.map((tok, j) => (tok === '.' || tok === '-' ? tok : voice(cs[Math.floor((j * cs.length) / toks.length)], tok))).join(' ');
    })
    .join(' | ');
}

/** Bass notes from a pattern of 1 (root), 3, 5, 7, 8 (octave), 5- (fifth below). Roots sit in C2–B2. */
export function bass(chords: string[], pattern: string): string {
  return perBar(chords, pattern, (c, tok) => {
    const r = 36 + c.root;
    const third = c.iv[1];
    const off: Record<string, number> = { '1': 0, '3': third, '5': 7, '7': c.iv[3] ?? 10, '8': 12, '5-': -5 };
    return noteName(r + (off[tok] ?? 0));
  });
}

/** Block chords on every `x`, root position with the root between E3 and D#4. */
export function comp(chords: string[], pattern: string): string {
  return perBar(chords, pattern, (c) => {
    const r = 52 + ((c.root - 4 + 12) % 12);
    return c.iv.map((i) => noteName(r + i)).join('+');
  });
}

/** Arpeggios from the first chord root at or above `base`: tokens are chord-tone indexes (1 = root, 2 = third, 3 = fifth, 4 = root an octave up…). */
export function arp(chords: string[], pattern: string, base = 64): string {
  return perBar(chords, pattern, (c, tok) => {
    const r = base + ((c.root - (base % 12) + 12) % 12);
    const k = Number(tok) - 1;
    const tones = c.iv.slice(0, 3);
    return noteName(r + tones[k % 3] + 12 * Math.floor(k / 3));
  });
}

const rep = (s: string, n: number) => Array.from({ length: n }, () => s).join(' | ');

// ---------------------------------------------------------------------------
// Waiting room: "Kogiel Mogiel" – a lazy kitchen mazurka in D, on accordion.
// ---------------------------------------------------------------------------

const LOBBY_A = ['D', 'A7', 'D', 'G', 'D', 'Bm', 'E7', 'A7', 'G', 'D', 'A7', 'D', 'G', 'D', 'Em A7', 'D'];
const LOBBY_B = ['Bm', 'F#7', 'Bm', 'Bm', 'G', 'D', 'E7', 'A7', 'G', 'D', 'A7', 'D', 'G', 'D', 'Em A7', 'D'];
const LOBBY_CHORDS = [...LOBBY_A, ...LOBBY_B];
const LOBBY_TUNE_END = `
  B4 - D5 - G5 - | F#5 - E5 D5 A4 - | C#5 - E5 - G5 - | F#5 - - - D5 - |
  B4 - D5 - B4 G4 | A4 - F#4 - D4 - | E4 G4 B4 - C#5 - | D5 - - - . . |`;
const LOBBY_TUNE = `
  F#4 - A4 - D5 - | C#5 - B4 A4 G4 - | F#4 G4 A4 - F#4 D4 | G4 - - - B4 - |
  A4 - F#4 - A4 - | D5 - C#5 B4 F#4 - | G#4 - B4 - E5 D5 | C#5 - - - A4 - |
  ${LOBBY_TUNE_END}
  B4 - D5 - F#5 - | E5 - C#5 - A#4 - | B4 C#5 D5 - B4 F#4 | F#4 - - - . . |
  G4 - B4 - D5 - | F#5 - E5 - D5 - | E5 - D5 B4 G#4 - | A4 - - - G4 - |
  ${LOBBY_TUNE_END}`;

const lobby: TrackDef = {
  name: 'Kogiel Mogiel',
  bpm: 112,
  steps: 2,
  beatsPerBar: 3,
  bars: 32,
  parts: [
    { inst: 'bass', vol: 0.32, seq: bass(LOBBY_CHORDS, '1 - . . 5 .') },
    { inst: 'accordion', vol: 0.07, seq: comp(LOBBY_CHORDS, '. . x . x .') },
    { inst: 'accordion', vol: 0.16, seq: LOBBY_TUNE },
    { inst: 'bell', vol: 0.05, seq: rep('. . . . . .', 7) + ' | . . . . A5 . | ' + rep('. . . . . .', 15) + ' | . . . . F#5 . | ' + rep('. . . . . .', 7) + ' | . . . . D6 .' },
    { inst: 'drums', vol: 0.5, seq: rep('k . x . x .', 32) },
  ],
};

// ---------------------------------------------------------------------------
// Quiz, Ballpark, Podmianka, To Ty!, Bazgroły: "Thinking Cap" – a ticking jazz waltz of the brain, in A minor.
// ---------------------------------------------------------------------------

const QUIZ_CHORDS = ['Am7', 'Dm7', 'G7', 'Cmaj7', 'Fmaj7', 'Dm7', 'E7', 'Am7'];
const quiz: TrackDef = {
  name: 'Thinking Cap',
  bpm: 104,
  steps: 2,
  beatsPerBar: 4,
  bars: 16,
  swing: 0.2,
  parts: [
    { inst: 'bass', vol: 0.3, seq: bass([...QUIZ_CHORDS, ...QUIZ_CHORDS], '1 . 5 . 8 . 5 .') },
    { inst: 'ep', vol: 0.08, seq: comp([...QUIZ_CHORDS, ...QUIZ_CHORDS], '. x . . . x . .') },
    {
      inst: 'pluck',
      vol: 0.17,
      seq: `
        A4 . C5 . E5 . D5 . | C5 . A4 . F4 - - . | G4 . B4 . D5 . F5 . | E5 - - . . . . . |
        F4 . A4 . C5 . E5 . | D5 . C5 . A4 - . . | G#4 . B4 . D5 . E5 . | C5 - B4 - A4 - . . |
        E5 . . E5 D5 . C5 . | D5 . . D5 C5 . A4 . | B4 . . B4 A4 . G4 . | G4 - - - E4 - - . |
        A4 . C5 . F5 . E5 . | D5 . F5 . A5 - . . | G#5 . E5 . B4 . D5 . | C5 - - - A4 - . . |`,
    },
    { inst: 'drums', vol: 0.4, seq: rep('k+h . r+h . h . r+h .', 15) + ' | k+h . r+h . r r r r' },
  ],
};

// ---------------------------------------------------------------------------
// Tour de Pierogi, Fork Fight, Pierogi Parade, Pierogi Panic: "Polka Pierogi" – a fast wedding polka in G.
// ---------------------------------------------------------------------------

const POLKA_CHORDS = ['G', 'D7', 'D7', 'G', 'G', 'D7', 'D7', 'G', 'C', 'G', 'D7', 'G', 'C', 'G', 'D7', 'G'];
const polka: TrackDef = {
  name: 'Polka Pierogi',
  bpm: 150,
  steps: 2,
  beatsPerBar: 2,
  bars: 16,
  parts: [
    { inst: 'bass', vol: 0.34, seq: bass(POLKA_CHORDS, '1 . 5- .') },
    { inst: 'accordion', vol: 0.07, seq: comp(POLKA_CHORDS, '. x . x') },
    {
      inst: 'accordion',
      vol: 0.15,
      seq: `
        D5 B4 G4 B4 | A4 F#4 D4 F#4 | A4 B4 C5 A4 | B4 - G4 . |
        D5 B4 G4 B4 | C5 A4 F#4 A4 | C5 B4 A4 F#4 | G4 - - . |
        E5 - G5 E5 | D5 - B4 G4 | A4 B4 C5 D5 | B4 - G4 . |
        E5 G5 E5 C5 | D5 B4 G4 D5 | C5 A4 F#4 A4 | G4 - G5 . |`,
    },
    { inst: 'lead', vol: 0.05, seq: rep('. . . .', 8) + ' | ' + 'C5 - - - | B4 - - - | F#4 - A4 - | G4 - - - | C5 - E5 - | B4 - D5 - | A4 - C5 - | B4 - - -' },
    { inst: 'drums', vol: 0.45, seq: rep('k s k s', 15) + ' | k s s s' },
  ],
};

// ---------------------------------------------------------------------------
// The arena games: "Barnyard Brawl" – driving chiptune rock in E minor.
// ---------------------------------------------------------------------------

const ARENA_CHORDS = ['Em', 'C', 'D', 'Em', 'Em', 'C', 'D', 'B7', 'Em', 'C', 'D', 'B7', 'Em', 'C', 'D', 'B7'];
const arena: TrackDef = {
  name: 'Barnyard Brawl',
  bpm: 132,
  steps: 2,
  beatsPerBar: 4,
  bars: 16,
  parts: [
    { inst: 'bass', vol: 0.3, seq: bass(ARENA_CHORDS, '1 8 1 8 1 8 1 8') },
    { inst: 'pad', vol: 0.05, seq: comp(ARENA_CHORDS, 'x - - - - - - -') },
    {
      inst: 'lead',
      vol: 0.1,
      seq: `
        E5 . B4 . E5 . G5 F#5 | E5 . C5 . G4 . C5 . | D5 . A4 . D5 . F#5 E5 | B4 - - . . . . . |
        E5 . B4 . E5 . G5 A5 | G5 . E5 . C5 . E5 . | F#5 . D5 . A4 . D5 . | D#5 - F#5 - B5 - - . |
        G5 - - - - - - - | E5 - - - - - - - | F#5 - - - A5 - - - | B5 - - - - - - . |
        E5 - - - G5 - - - | C6 - - - B5 - - - | A5 - - - F#5 - - - | D#5 - - - F#5 - B5 - |`,
    },
    { inst: 'pluck', vol: 0.08, seq: rep('. . . . . . . .', 8) + ' | ' + arp(ARENA_CHORDS.slice(8), '1 2 3 4 3 2 1 2', 64) },
    { inst: 'drums', vol: 0.5, seq: rep('k h s h k k s h', 7) + ' | k h s h s s c c | ' + rep('k h s h k k s h', 7) + ' | k h s s s s c c' },
  ],
};

// ---------------------------------------------------------------------------
// Maluch Rally and Trails: "Maluch Turbo" – a four-on-the-floor chase in A minor.
// ---------------------------------------------------------------------------

const RACE_CHORDS = ['Am', 'G', 'F', 'G', 'Am', 'G', 'F', 'E7', 'F', 'G', 'Am', 'Am', 'F', 'G', 'E7', 'E7'];
const race: TrackDef = {
  name: 'Maluch Turbo',
  bpm: 152,
  steps: 2,
  beatsPerBar: 4,
  bars: 16,
  parts: [
    { inst: 'bass', vol: 0.3, seq: bass(RACE_CHORDS, '1 1 8 1 1 1 8 1') },
    { inst: 'pluck', vol: 0.06, seq: arp(RACE_CHORDS, '1 3 5 3 2 3 5 3', 57) },
    {
      inst: 'lead',
      vol: 0.1,
      seq: `
        A5 - G5 - E5 - D5 E5 | D5 - B4 - G4 - B4 D5 | C5 - A4 - F4 - A4 C5 | B4 - D5 - G5 - - - |
        A5 - G5 - E5 - D5 E5 | B5 - A5 - G5 - D5 - | C6 - A5 - F5 - C5 - | B5 - G#5 - E5 - - - |
        A5 - - - C6 - A5 - | B5 - - - D6 - B5 - | C6 - B5 - A5 - E5 - | A5 - - - - - . . |
        F5 - A5 - C6 - A5 - | G5 - B5 - D6 - B5 - | G#5 - B5 - E6 - D6 - | B5 - G#5 - E5 - D5 - |`,
    },
    { inst: 'drums', vol: 0.5, seq: rep('k+h h k+s h k+h h k+s o', 15) + ' | k+s s k+s s s s c c' },
  ],
};

// ---------------------------------------------------------------------------
// Fajki: "Smoke Rings" – a slow, swinging cellar-bar ballad in D minor.
// ---------------------------------------------------------------------------

const LOUNGE_CHORDS = ['Dm7', 'G7', 'Cmaj7', 'A7', 'Dm7', 'G7', 'Em7 A7', 'Dm7 A7'];
const LOUNGE_BASS = `
  D3 . F3 . A3 . C4 . | G2 . B2 . D3 . F3 . | C3 . E3 . G3 . E3 . | A2 . C#3 . E3 . G3 . |
  D3 . A2 . D3 . F3 . | G2 . B2 . D3 . F3 . | E3 . G3 . A2 . C#3 . | D3 . . . A2 . . . |`;
const lounge: TrackDef = {
  name: 'Smoke Rings',
  bpm: 88,
  steps: 2,
  beatsPerBar: 4,
  bars: 16,
  swing: 0.33,
  parts: [
    { inst: 'bass', vol: 0.34, seq: `${LOUNGE_BASS} | ${LOUNGE_BASS}` },
    { inst: 'ep', vol: 0.08, seq: comp([...LOUNGE_CHORDS, ...LOUNGE_CHORDS], '. . x - . . x -') },
    {
      inst: 'sax',
      vol: 0.13,
      seq: `
        A4 - - - F4 - E4 - | D4 - - - . . F4 G4 | E4 - - - G4 - B4 - | C#5 - - - A4 - - . |
        D5 - C5 - A4 - F4 - | G4 - F4 - D4 - B3 - | E4 - G4 - A4 - C#5 - | D5 - - - - - . . |
        . . F5 - E5 - D5 - | B4 - - - G4 - - . | C5 - B4 - G4 - E4 - | G4 - - - E4 - C#4 - |
        F4 - A4 - C5 - E5 - | F5 - - - D5 - B4 - | G4 - B4 - C#5 - E5 - | D5 - - - - - - . |`,
    },
    { inst: 'drums', vol: 0.35, seq: rep('k+h . h+b h h . h+b h', 16) },
  ],
};

export const TRACKS: Record<TrackId, TrackDef> = { lobby, quiz, polka, arena, race, lounge };

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

export interface NoteEvent {
  step: number;
  /** In steps. */
  len: number;
  /** MIDI notes, or drum letters for drum parts. */
  notes: (number | string)[];
}

/** Splits a part into notes with their start step and length. */
export function parsePart(seq: string, drums = false): { events: NoteEvent[]; length: number } {
  const toks = seq.split(/\s+/).filter((t) => t && t !== '|');
  const events: NoteEvent[] = [];
  let last: NoteEvent | null = null;
  toks.forEach((tok, step) => {
    if (tok === '.') last = null;
    else if (tok === '-') {
      if (last) last.len++;
    } else {
      const notes = tok.split('+').map((n) => {
        if (drums) {
          if (!/^[kshorbcx]$/.test(n)) throw new Error(`Bad drum ${n}`);
          return n;
        }
        const m = midi(n);
        if (m === null) throw new Error(`Bad note ${n}`);
        return m;
      });
      last = { step, len: 1, notes };
      events.push(last);
    }
  });
  return { events, length: toks.length };
}

/** Which track plays for a game. Games that feel alike share one. */
export function trackForGame(game: string): TrackId {
  switch (game) {
    case 'quiz':
    case 'ballpark':
    case 'swap':
    case 'toty':
    case 'bazgroly':
      return 'quiz';
    case 'pedal':
    case 'fork':
    case 'parade':
    case 'kitchen':
      return 'polka';
    case 'rally':
    case 'trails':
      return 'race';
    case 'smoke':
      return 'lounge';
    default:
      return 'arena';
  }
}
