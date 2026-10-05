import { describe, expect, it } from 'vitest';
import questions from '../data/toty.json';
import { MAX_DOODLE_POINTS, MAX_PHOTO_CHARS } from '../shared/protocol';
import { mulberry32 } from '../client/src/games/rng';
import {
  TY_DOODLE_AFTER,
  TY_QUESTIONS,
  TY_VOTE_POINTS,
  isPhotoData,
  pickPlan,
  sanitizeStrokes,
  scoreVotes,
  strokePath,
  tally,
  tallyPicks,
  type TotyQuestion,
} from '../client/src/games/toty/logic';

const players = ['a', 'b', 'c', 'd'];

describe('tally', () => {
  it('finds the player most people voted for', () => {
    const t = tally({ a: 'b', b: 'c', c: 'b', d: 'b' }, players);
    expect(t.counts).toEqual({ a: 0, b: 3, c: 1, d: 0 });
    expect(t.winners).toEqual(['b']);
  });
  it('keeps every player in a tie', () => {
    expect(tally({ a: 'b', b: 'c', c: 'b', d: 'c' }, players).winners).toEqual(['b', 'c']);
  });
  it('picks nobody when no two votes agree', () => {
    expect(tally({ a: 'b', b: 'c', c: 'd' }, players).winners).toEqual([]);
  });
  it('ignores votes for players who left', () => {
    const t = tally({ a: 'z', b: 'z', c: 'a' }, players);
    expect(t.counts.z).toBeUndefined();
    expect(t.winners).toEqual([]);
  });
});

describe('scoreVotes', () => {
  it('rewards everyone who voted with the room, double on the final question', () => {
    const votes = { a: 'b', b: 'c', c: 'b', d: 'b' };
    const t = tally(votes, players);
    expect(scoreVotes(votes, t)).toEqual({ a: TY_VOTE_POINTS, b: 0, c: TY_VOTE_POINTS, d: TY_VOTE_POINTS });
    expect(scoreVotes(votes, t, true).a).toBe(TY_VOTE_POINTS * 2);
  });
  it('gives nothing without a majority', () => {
    const votes = { a: 'b', b: 'c', c: 'd' };
    expect(Object.values(scoreVotes(votes, tally(votes, players)))).toEqual([0, 0, 0]);
  });
});

describe('tallyPicks', () => {
  it('counts votes per doodle and ignores votes for your own', () => {
    const gallery = ['c', 'a', 'b'];
    expect(tallyPicks({ a: 0, b: 0, c: 0, d: 2, x: 9 }, gallery)).toEqual([2, 0, 1]);
  });
});

describe('sanitizeStrokes', () => {
  it('accepts strokes and dots and clamps coordinates', () => {
    expect(sanitizeStrokes([[0, 1, 10, 20, 30.4, 1200], [2, 0, 5, -3]])).toEqual([
      [0, 1, 10, 20, 30, 1000],
      [2, 0, 5, 0],
    ]);
  });
  it('rejects malformed doodles', () => {
    expect(sanitizeStrokes('nope')).toBeNull();
    expect(sanitizeStrokes([[99, 0, 1, 1]])).toBeNull();
    expect(sanitizeStrokes([[0, 7, 1, 1]])).toBeNull();
    expect(sanitizeStrokes([[0, 0, 1, 1, 2]])).toBeNull();
    expect(sanitizeStrokes([[0, 0, 1, 'x']])).toBeNull();
  });
  it('caps the number of points', () => {
    const big = [0, 0, ...Array.from({ length: (MAX_DOODLE_POINTS + 1) * 2 }, (_, i) => i % 1000)];
    expect(sanitizeStrokes([big])).toBeNull();
  });
  it('builds an SVG path', () => {
    expect(strokePath([0, 0, 1, 2, 3, 4])).toBe('M1 2L3 4');
  });
});

describe('isPhotoData', () => {
  it('accepts small JPEG data URLs only', () => {
    expect(isPhotoData('data:image/jpeg;base64,/9j/4AAQSkZJRg==')).toBe(true);
    expect(isPhotoData('data:text/html;base64,PGgxPg==')).toBe(false);
    expect(isPhotoData('https://example.com/me.jpg')).toBe(false);
    expect(isPhotoData(`data:image/jpeg;base64,${'A'.repeat(MAX_PHOTO_CHARS)}`)).toBe(false);
  });
});

describe('pickPlan', () => {
  it('picks distinct questions and puts drawable ones before the doodle rounds', () => {
    const used = new Set<string>();
    for (let seed = 1; seed < 30; seed++) {
      const plan = pickPlan(questions as TotyQuestion[], used, mulberry32(seed));
      expect(plan).toHaveLength(TY_QUESTIONS);
      expect(new Set(plan.map((q) => q.id)).size).toBe(TY_QUESTIONS);
      for (const i of TY_DOODLE_AFTER) expect(plan[i].draw).toBeTruthy();
    }
  });
});

describe('to ty data', () => {
  it('has unique ids, questions and drawing prompts with the name in them', () => {
    expect(new Set(questions.map((q) => q.id)).size).toBe(questions.length);
    expect(questions.length).toBeGreaterThanOrEqual(50);
    const drawable = questions.filter((q) => 'draw' in q);
    expect(drawable.length).toBeGreaterThanOrEqual(20);
    for (const q of questions) {
      expect(q.question.endsWith('?')).toBe(true);
      expect(q.question.length).toBeLessThanOrEqual(80);
      if ('draw' in q) expect(q.draw).toContain('{name}');
    }
  });
});
