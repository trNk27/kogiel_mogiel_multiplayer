import { describe, expect, it } from 'vitest';
import questions from '../data/ballpark.json';
import {
  BP_BET_STAKE,
  BP_BULLSEYE_BONUS,
  BP_GUESS_POINTS,
  buildSlots,
  formatNumber,
  scoreBallpark,
  winningSlot,
  type Guess,
} from '../client/src/games/ballpark/logic';

const g = (id: string, value: number): Guess => ({ id, name: id.toUpperCase(), value });

describe('buildSlots', () => {
  it('sorts guesses, merges duplicates and adds a "smaller than all" slot first', () => {
    const slots = buildSlots([g('a', 300), g('b', 100), g('c', 200), g('d', 100)]);
    expect(slots.map((s) => s.value)).toEqual([null, 100, 200, 300]);
    expect(slots[1].guessers).toEqual(['B', 'D']);
  });
  it('pays more towards the edges', () => {
    const five = buildSlots([1, 2, 3, 4, 5].map((v) => g(`p${v}`, v)));
    expect(five.map((s) => s.payout)).toEqual([5, 4, 3, 2, 3, 4]);
    const four = buildSlots([1, 2, 3, 4].map((v) => g(`p${v}`, v)));
    expect(four.map((s) => s.payout)).toEqual([4, 3, 2, 2, 3]);
    const one = buildSlots([g('a', 9)]);
    expect(one.map((s) => s.payout)).toEqual([3, 2]);
  });
  it('caps payouts', () => {
    const eight = buildSlots([1, 2, 3, 4, 5, 6, 7, 8].map((v) => g(`p${v}`, v)));
    expect(Math.max(...eight.slice(1).map((s) => s.payout))).toBe(5);
    expect(eight[0].payout).toBe(6);
  });
});

describe('winningSlot', () => {
  const slots = buildSlots([g('a', 100), g('b', 200), g('c', 300)]);
  it('picks the closest guess without going over', () => {
    expect(winningSlot(slots, 250)).toBe(2);
    expect(winningSlot(slots, 1000)).toBe(3);
  });
  it('counts an exact hit as not going over', () => {
    expect(winningSlot(slots, 200)).toBe(2);
  });
  it('falls back to the "smaller" slot when everyone went over', () => {
    expect(winningSlot(slots, 50)).toBe(0);
  });
});

describe('scoreBallpark', () => {
  const guesses = [g('a', 100), g('b', 200), g('c', 300)];
  const slots = buildSlots(guesses); // [<100 ×4, 100 ×3, 200 ×2, 300 ×3]
  it('rewards the winning guess and correct bets', () => {
    const res = scoreBallpark(['a', 'b', 'c'], guesses, { a: 2, b: 1, c: 2 }, slots, 250);
    expect(res.b).toMatchObject({ guessWon: true, betWon: false, points: BP_GUESS_POINTS });
    expect(res.a).toMatchObject({ guessWon: false, betWon: true, points: BP_BET_STAKE * 2 });
    expect(res.c.points).toBe(BP_BET_STAKE * 2);
  });
  it('gives a bullseye bonus for an exact answer', () => {
    const res = scoreBallpark(['a', 'b', 'c'], guesses, { b: 2 }, slots, 200);
    expect(res.b.points).toBe(BP_GUESS_POINTS + BP_BULLSEYE_BONUS + BP_BET_STAKE * 2);
  });
  it('pays the edge slot when all guesses are too high, and nobody wins by guessing', () => {
    const res = scoreBallpark(['a', 'b', 'c'], guesses, { a: 0 }, slots, 10);
    expect(res.a).toMatchObject({ guessWon: false, betWon: true, points: BP_BET_STAKE * slots[0].payout });
    expect(res.b.points).toBe(0);
  });
  it('shares the win between identical guesses', () => {
    const same = [g('a', 5), g('b', 5)];
    const s = buildSlots(same);
    const res = scoreBallpark(['a', 'b'], same, {}, s, 7);
    expect(res.a.points).toBe(BP_GUESS_POINTS);
    expect(res.b.points).toBe(BP_GUESS_POINTS);
  });
  it('gives nothing to players who neither guessed nor bet', () => {
    const res = scoreBallpark(['a', 'z'], [g('a', 1)], {}, buildSlots([g('a', 1)]), 2);
    expect(res.z.points).toBe(0);
  });
});

describe('ballpark data', () => {
  it('has 40 questions with numeric answers and unique ids', () => {
    expect(questions).toHaveLength(40);
    expect(new Set(questions.map((q) => q.id)).size).toBe(40);
    for (const q of questions) {
      expect(typeof q.answer).toBe('number');
      expect(Number.isFinite(q.answer)).toBe(true);
      expect(q.answer).toBeGreaterThan(0);
    }
  });
});

describe('formatNumber', () => {
  it('formats years without separators and other numbers with them', () => {
    expect(formatNumber(1889, 'year')).toBe('1889');
    expect(formatNumber(384400, 'km')).toBe('384,400');
    expect(formatNumber(7.32, 'm')).toBe('7.32');
  });
});
