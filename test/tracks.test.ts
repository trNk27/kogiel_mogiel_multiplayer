import { describe, expect, it } from 'vitest';
import { GAMES } from '../shared/protocol';
import { ACCENT, GHOST, TRACKS, arp, bass, chord, comp, midi, parsePart, trackForGame } from '../client/src/lib/tracks';

describe('soundtrack', () => {
  it('reads note names', () => {
    expect(midi('A4')).toBe(69);
    expect(midi('C4')).toBe(60);
    expect(midi('F#3')).toBe(54);
    expect(midi('Bb2')).toBe(46);
    expect(midi('H2')).toBeNull();
  });

  it('spells chords, basses and arpeggios', () => {
    expect(chord('F#m7')).toEqual({ root: 6, iv: [0, 3, 7, 10] });
    expect(bass(['G'], '1 5 8 .')).toBe('G2 D3 G3 .');
    expect(bass(['Em A7'], '1 . 1 .')).toBe('E2 . A2 .');
    expect(comp(['C'], 'x -')).toBe('C4+E4+G4 -');
    expect(comp(['E'], 'x')).toBe('E3+G#3+B3');
    expect(arp(['Am'], '1 2 3 4', 57)).toBe('A3 C4 E4 A4');
    expect(comp(['C'], 'x! x?')).toBe('C4!+E4!+G4! C4?+E4?+G4?');
    expect(bass(['G'], '1! 5-')).toBe('G2! D2');
  });

  it('parses holds and rests', () => {
    const { events, length } = parsePart('C4 - - . D4+F4 | . -');
    expect(length).toBe(7);
    expect(events).toEqual([
      { step: 0, len: 3, notes: [60], vel: [1] },
      { step: 4, len: 1, notes: [62, 65], vel: [1, 1] },
    ]);
  });

  it('parses accents, ghosts and ornaments', () => {
    const { events } = parsePart('C4! D4+F4? C#5>D5 - E5!~F5 /G5 . A4');
    expect(events).toEqual([
      { step: 0, len: 1, notes: [60], vel: [ACCENT] },
      { step: 1, len: 1, notes: [62, 65], vel: [1, GHOST] },
      { step: 2, len: 2, notes: [74], vel: [1], grace: 73 },
      { step: 4, len: 1, notes: [76], vel: [ACCENT], trill: 77 },
      { step: 5, len: 1, notes: [79], vel: [1], slide: 76 },
      { step: 7, len: 1, notes: [69], vel: [1] },
    ]);
    expect(parsePart('k+h? s!', true).events.map((e) => e.vel)).toEqual([[1, GHOST], [ACCENT]]);
  });

  it('slides from the note before, round the loop', () => {
    expect(parsePart('/C5 . G4').events[0].slide).toBe(67);
    expect(parsePart('/C5 -').events[0].slide).toBe(70);
  });

  it('refuses ornaments it cannot play', () => {
    expect(() => parsePart('/C4+E4')).toThrow();
    expect(() => parsePart('C4~')).toThrow();
    expect(() => parsePart('k!!', true)).toThrow();
    expect(() => parsePart('H4!')).toThrow();
  });

  for (const [id, t] of Object.entries(TRACKS)) {
    it(`${t.name} (${id}): every part fills the whole loop`, () => {
      for (const p of t.parts) expect(parsePart(p.seq, p.inst === 'drums').length).toBe(t.bars * t.beatsPerBar * (p.steps ?? t.steps));
    });
  }

  it('gives every game a track', () => {
    for (const g of GAMES) expect(TRACKS[trackForGame(g.id)]).toBeDefined();
    expect(trackForGame('quiz')).toBe(trackForGame('ballpark'));
  });
});
