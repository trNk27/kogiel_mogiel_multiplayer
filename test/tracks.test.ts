import { describe, expect, it } from 'vitest';
import { GAMES } from '../shared/protocol';
import { TRACKS, arp, bass, chord, comp, midi, parsePart, trackForGame } from '../client/src/lib/tracks';

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
  });

  it('parses holds and rests', () => {
    const { events, length } = parsePart('C4 - - . D4+F4 | . -');
    expect(length).toBe(7);
    expect(events).toEqual([
      { step: 0, len: 3, notes: [60] },
      { step: 4, len: 1, notes: [62, 65] },
    ]);
  });

  for (const [id, t] of Object.entries(TRACKS)) {
    it(`${t.name} (${id}): every part fills the whole loop`, () => {
      const steps = t.bars * t.beatsPerBar * t.steps;
      for (const p of t.parts) expect(parsePart(p.seq, p.inst === 'drums').length).toBe(steps);
    });
  }

  it('gives every game a track', () => {
    for (const g of GAMES) expect(TRACKS[trackForGame(g.id)]).toBeDefined();
    expect(trackForGame('quiz')).toBe(trackForGame('ballpark'));
  });
});
