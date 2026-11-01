import { describe, expect, it } from 'vitest';
import data from '../data/survey.json';
import {
  SV_EXACT_POINTS,
  SV_GUESS_POINTS,
  SV_MAX_ROUNDS,
  SV_MAX_ROUNDS_SHORT,
  SV_SIDE_POINTS,
  betLabel,
  betOff,
  betRight,
  guessPoints,
  howTo,
  roundsFor,
  scoreRound,
  surveyors,
} from '../client/src/games/survey/logic';
import { mulberry32 } from '../client/src/games/rng';

describe('Ankieta data', () => {
  const qs = (data as { questions: { id: string; q: string }[] }).questions;
  it('has plenty of unique yes/no questions', () => {
    expect(qs.length).toBeGreaterThanOrEqual(120);
    expect(new Set(qs.map((q) => q.id)).size).toBe(qs.length);
    expect(new Set(qs.map((q) => q.q.toLowerCase())).size).toBe(qs.length);
    for (const q of qs) {
      expect(q.q.endsWith('?')).toBe(true);
      expect(q.q.length).toBeLessThanOrEqual(80);
    }
  });
});

describe('Ankieta rounds', () => {
  it('everyone guesses once, up to a limit', () => {
    expect(roundsFor(3, false)).toBe(3);
    expect(roundsFor(8, false)).toBe(SV_MAX_ROUNDS);
    expect(roundsFor(8, true)).toBe(SV_MAX_ROUNDS_SHORT);
    const ids = ['a', 'b', 'c', 'd'];
    const order = surveyors(ids, 4, mulberry32(3));
    expect([...order].sort()).toEqual(ids);
    expect(surveyors(ids, 6, mulberry32(3)).slice(4)).toEqual(order.slice(0, 2));
  });
});

describe('Ankieta scoring', () => {
  it('a spot-on guess gets full points, then less the further off', () => {
    expect(guessPoints(3, 3, 6)).toBe(SV_GUESS_POINTS);
    expect(guessPoints(2, 3, 6)).toBeLessThan(SV_GUESS_POINTS);
    expect(guessPoints(1, 3, 6)).toBeLessThan(guessPoints(2, 3, 6));
    expect(guessPoints(0, 6, 6)).toBe(0);
    expect(guessPoints(0, 0, 0)).toBe(0);
    // One off counts for less in a bigger room.
    expect(guessPoints(4, 5, 8)).toBeGreaterThan(guessPoints(2, 3, 4));
    for (const n of [3, 4, 5, 6, 7, 8]) for (let g = 0; g <= n; g++) expect(guessPoints(g, 1, n) % 50).toBe(0);
  });

  it('bets: more, exactly, fewer', () => {
    expect(betRight(0, 2, 3)).toBe(true);
    expect(betRight(0, 3, 3)).toBe(false);
    expect(betRight(1, 3, 3)).toBe(true);
    expect(betRight(2, 3, 1)).toBe(true);
    expect(betRight(2, 1, 1)).toBe(false);
    expect(betOff(0, 5)).toEqual([false, false, true]);
    expect(betOff(5, 5)).toEqual([true, false, false]);
    expect(betLabel(0, 3)).toBe('More than 3');
  });

  it('scores the surveyor and the bettors', () => {
    const answers = { a: true, b: false, c: true, d: true };
    const r = scoreRound('a', 2, answers, { b: 0, c: 1, d: 2, a: 1 });
    expect(r.yes).toBe(3);
    expect(r.total).toBe(4);
    expect(r.bets.b).toEqual({ bet: 0, right: true });
    expect(r.bets.c.right).toBe(false);
    expect(r.bets.d.right).toBe(false);
    // The surveyor can't bet on their own guess.
    expect(r.bets.a).toBeUndefined();
    expect(r.points.a).toBe(guessPoints(2, 3, 4));
    expect(r.points.b).toBe(SV_SIDE_POINTS);
    expect(r.points.c).toBe(0);
    const exact = scoreRound('a', 3, answers, { b: 1 });
    expect(exact.points.b).toBe(SV_EXACT_POINTS);
    expect(exact.points.a).toBe(SV_GUESS_POINTS);
  });

  it('the guess is clamped and bad bets are ignored', () => {
    const r = scoreRound('a', 99, { a: true, b: true }, { b: 7 as never });
    expect(r.guess).toBe(2);
    expect(r.bets.b).toBeUndefined();
    expect(scoreRound('a', -3, { a: false }, {}).guess).toBe(0);
  });

  it('nobody answering scores nothing', () => {
    const r = scoreRound('a', 0, {}, { b: 1 });
    expect(r.total).toBe(0);
    expect(r.points.a).toBe(0);
    expect(r.points.b).toBe(0);
  });

  it('has a three-line how-to', () => {
    expect(howTo(false)).toHaveLength(3);
    expect(howTo(true)).toHaveLength(3);
  });
});
