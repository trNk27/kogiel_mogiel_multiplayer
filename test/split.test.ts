import { describe, expect, it } from 'vitest';
import data from '../data/split.json';
import { PN_SPLIT_POINTS, filled, howTo, multiplier, scoreSplit, splitAround, splitPoints } from '../client/src/games/split/logic';

describe('Pół na Pół data', () => {
  const d = data as { scenarios: { id: string; text: string; ask: string }[]; fills: string[] };
  it('every dilemma has exactly one blank and a question', () => {
    expect(d.scenarios.length).toBeGreaterThanOrEqual(100);
    expect(new Set(d.scenarios.map((s) => s.id)).size).toBe(d.scenarios.length);
    expect(new Set(d.scenarios.map((s) => s.text)).size).toBe(d.scenarios.length);
    for (const s of d.scenarios) {
      expect(s.text.split('___')).toHaveLength(2);
      expect(s.ask.endsWith('?')).toBe(true);
    }
  });
  it('Babcia has plenty of fills, each short enough to send', () => {
    expect(d.fills.length).toBeGreaterThanOrEqual(40);
    expect(new Set(d.fills).size).toBe(d.fills.length);
    for (const f of d.fills) expect(f.length).toBeLessThanOrEqual(60);
  });
});

describe('Pół na Pół text', () => {
  it('fills the blank', () => {
    expect(splitAround('You can fly, but ___.')).toEqual(['You can fly, but ', '.']);
    expect(filled('You can fly, but ___.', 'you sneeze')).toBe('You can fly, but you sneeze.');
    // No double full stop.
    expect(filled('You can fly, but ___.', 'you sneeze!')).toBe('You can fly, but you sneeze.');
    expect(splitAround('no blank')).toEqual(['no blank', '']);
  });
});

describe('Pół na Pół scoring', () => {
  it('a perfect split scores the most, a landslide nothing', () => {
    expect(splitPoints(2, 4)).toBe(PN_SPLIT_POINTS);
    expect(splitPoints(1, 4)).toBe(PN_SPLIT_POINTS / 2);
    expect(splitPoints(0, 4)).toBe(0);
    expect(splitPoints(4, 4)).toBe(0);
    // With an odd number of voters, 3–2 is as even as it gets.
    expect(splitPoints(3, 5)).toBe(PN_SPLIT_POINTS);
    expect(splitPoints(2, 5)).toBe(PN_SPLIT_POINTS);
    expect(splitPoints(1, 2, 2)).toBe(PN_SPLIT_POINTS * 2);
    expect(splitPoints(1, 1)).toBe(0);
    for (let v = 2; v <= 7; v++) for (let y = 0; y <= v; y++) expect(splitPoints(y, v) % 50).toBe(0);
  });

  it('counts votes, ignoring the author', () => {
    const r = scoreSplit('a', { a: true, b: true, c: false, d: true, e: false });
    expect(r.yes).toEqual(['b', 'd']);
    expect(r.no).toEqual(['c', 'e']);
    expect(r.perfect).toBe(true);
    expect(r.points).toBe(PN_SPLIT_POINTS);
    const lop = scoreSplit('a', { b: true, c: true, d: true }, 2);
    expect(lop.perfect).toBe(false);
    expect(lop.points).toBe(0);
    expect(scoreSplit('a', {}).points).toBe(0);
  });

  it('round two pays double', () => {
    expect([1, 2, 3].map(multiplier)).toEqual([1, 2, 2]);
    expect(howTo(false)).toHaveLength(3);
  });
});
