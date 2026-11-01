import { describe, expect, it } from 'vitest';
import data from '../data/gossip.json';
import { GS_ANSWER_MAX, GS_TWIST_MAX, assign, howTo, multiplier } from '../client/src/games/gossip/logic';
import { mulberry32 } from '../client/src/games/rng';

const D = data as {
  questions: { id: string; q: string }[];
  contexts: { id: string; label: string; ask: string; placeholder: string; fallback: string[] }[];
  answers: string[];
};

describe('Plotki data', () => {
  it('has plenty of unique, harmless questions', () => {
    expect(D.questions.length).toBeGreaterThanOrEqual(60);
    expect(new Set(D.questions.map((q) => q.id)).size).toBe(D.questions.length);
    expect(new Set(D.questions.map((q) => q.q)).size).toBe(D.questions.length);
    for (const q of D.questions) expect(q.q.length).toBeLessThanOrEqual(80);
  });

  it('every setting has an instruction and fallbacks that fit', () => {
    // Enough settings for everyone to get a different one with 8 players.
    expect(D.contexts.length).toBeGreaterThanOrEqual(8);
    expect(new Set(D.contexts.map((c) => c.id)).size).toBe(D.contexts.length);
    for (const c of D.contexts) {
      expect(c.label && c.ask && c.placeholder).toBeTruthy();
      expect(c.fallback.length).toBeGreaterThanOrEqual(3);
      for (const f of c.fallback) expect(f.length).toBeLessThanOrEqual(GS_TWIST_MAX);
    }
    for (const a of D.answers) expect(a.length).toBeLessThanOrEqual(GS_ANSWER_MAX);
  });
});

describe('Plotki rules', () => {
  it('everyone twists someone else’s answer, in a different setting', () => {
    for (let n = 3; n <= 8; n++)
      for (let s = 0; s < 8; s++) {
        const a = assign(n, D.contexts.length, mulberry32(s));
        expect(a).toHaveLength(n);
        a.forEach((x, k) => expect(x.from).not.toBe(k));
        expect(new Set(a.map((x) => x.from)).size).toBe(n);
        expect(new Set(a.map((x) => x.context)).size).toBe(n);
      }
    // More players than settings: settings repeat, but everything stays in range.
    for (const x of assign(5, 2, mulberry32(1))) expect(x.context).toBeLessThan(2);
  });

  it('round two pays double', () => {
    expect([1, 2].map(multiplier)).toEqual([1, 2]);
    expect(howTo(false)).toHaveLength(3);
  });
});
