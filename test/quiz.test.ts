import { describe, expect, it } from 'vitest';
import trivia from '../data/trivia.json';
import { QUIZ_TIME_MS, pickQuestions, quizPoints, shuffleOptions, type TriviaQuestion } from '../client/src/games/quiz/logic';
import { mulberry32 } from '../client/src/games/rng';

describe('quizPoints', () => {
  it('gives 1000 for an instant correct answer', () => {
    expect(quizPoints(true, 0)).toBe(1000);
  });
  it('scales down to 500 at the end of the timer', () => {
    expect(quizPoints(true, QUIZ_TIME_MS)).toBe(500);
    expect(quizPoints(true, QUIZ_TIME_MS / 2)).toBe(750);
    expect(quizPoints(true, QUIZ_TIME_MS / 4)).toBe(875);
  });
  it('clamps out-of-range times', () => {
    expect(quizPoints(true, -50)).toBe(1000);
    expect(quizPoints(true, QUIZ_TIME_MS * 3)).toBe(500);
  });
  it('gives nothing for wrong answers', () => {
    expect(quizPoints(false, 0)).toBe(0);
    expect(quizPoints(false, 1000)).toBe(0);
  });
});

describe('pickQuestions', () => {
  const pool = (trivia as TriviaQuestion[]).slice();
  it('never repeats a question until the pool is exhausted', () => {
    const used = new Set<string>();
    const rng = mulberry32(7);
    const seen = new Set<string>();
    for (let round = 0; round < 20; round++) {
      for (const q of pickQuestions(pool, used, 10, rng)) {
        expect(seen.has(q.id)).toBe(false);
        seen.add(q.id);
      }
    }
    expect(seen.size).toBe(200);
    // Pool is now exhausted: the next round starts over.
    expect(pickQuestions(pool, used, 10, rng)).toHaveLength(10);
  });
});

describe('shuffleOptions', () => {
  it('keeps the correct answer attached to its text', () => {
    const rng = mulberry32(3);
    for (const q of trivia as TriviaQuestion[]) {
      const s = shuffleOptions(q, rng);
      expect(s.options[s.answerIndex]).toBe(q.options[q.answerIndex]);
      expect([...s.options].sort()).toEqual([...q.options].sort());
    }
  });
});

describe('trivia data', () => {
  const qs = trivia as TriviaQuestion[];
  it('has 200 well-formed questions with unique ids', () => {
    expect(qs).toHaveLength(200);
    expect(new Set(qs.map((q) => q.id)).size).toBe(200);
    for (const q of qs) {
      expect(q.options).toHaveLength(4);
      expect(new Set(q.options).size).toBe(4);
      expect(q.answerIndex).toBeGreaterThanOrEqual(0);
      expect(q.answerIndex).toBeLessThan(4);
      expect(['easy', 'medium', 'hard']).toContain(q.difficulty);
    }
  });
  it('covers all seven categories and is mostly medium', () => {
    const cats = new Set(qs.map((q) => q.category));
    expect(cats).toEqual(new Set(['General Knowledge', 'Science', 'Geography', 'History', 'Film & Music', 'Sport', 'Food']));
    expect(qs.filter((q) => q.difficulty === 'medium').length).toBeGreaterThan(100);
  });
});
