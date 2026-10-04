export interface TriviaQuestion {
  id: string;
  category: string;
  difficulty: 'easy' | 'medium' | 'hard';
  question: string;
  options: string[];
  answerIndex: number;
}

export const QUIZ_TIME_MS = 20_000;
export const QUIZ_MAX_POINTS = 1000;
export const QUIZ_MIN_POINTS = 500;
export const QUIZ_ROUND_LENGTH = 10;

/** Points for an answer given `elapsedMs` after the question opened. Wrong/no answer: 0. */
export function quizPoints(correct: boolean, elapsedMs: number, limitMs = QUIZ_TIME_MS): number {
  if (!correct) return 0;
  const t = Math.min(1, Math.max(0, elapsedMs / limitMs));
  return Math.round(QUIZ_MAX_POINTS - (QUIZ_MAX_POINTS - QUIZ_MIN_POINTS) * t);
}

import type { Rng } from '../rng';

export function shuffle<T>(items: readonly T[], rng: Rng = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Pick `n` questions that are not in `used`. If the pool runs dry the used set is reset
 * (only after every question has been seen once). Mutates `used`.
 */
export function pickQuestions<T extends { id: string }>(pool: readonly T[], used: Set<string>, n: number, rng: Rng = Math.random): T[] {
  let fresh = pool.filter((q) => !used.has(q.id));
  if (fresh.length < n) {
    used.clear();
    fresh = [...pool];
  }
  const picked = shuffle(fresh, rng).slice(0, n);
  for (const q of picked) used.add(q.id);
  return picked;
}

/** Shuffle a question's options, returning the new order and the new answer index. */
export function shuffleOptions(q: TriviaQuestion, rng: Rng = Math.random): { options: string[]; answerIndex: number } {
  const order = shuffle([0, 1, 2, 3], rng);
  return { options: order.map((i) => q.options[i]), answerIndex: order.indexOf(q.answerIndex) };
}
