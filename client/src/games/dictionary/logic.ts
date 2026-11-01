/**
 * Słownik ("the dictionary"): our take on Dictionarium. A made-up word goes up (Pierogrzmot, noun).
 * Everyone writes a definition and the room votes for the best; that one becomes official. Then everyone
 * writes a synonym for it, and votes; then everyone uses the word in a sentence, and votes. Every vote
 * is points for its author, and the best of each stage gets a bonus.
 * Pure rules: no DOM, no timers.
 */
import { answerKey } from '../wordkit/logic';

export type Pos = 'noun' | 'verb' | 'adjective';

export interface DcWord {
  id: string;
  word: string;
  pos: Pos;
}

/** The three stages of a word. */
export const STAGES = ['definition', 'synonym', 'sentence'] as const;
export type Stage = 0 | 1 | 2;

/** Longest entry, and writing time, for each stage. */
export const DC_MAX: Record<Stage, number> = { 0: 80, 1: 30, 2: 100 };
export const DC_WRITE_MS: Record<Stage, number> = { 0: 60_000, 1: 40_000, 2: 60_000 };
export const DC_VOTE_MS = 20_000;
export const DC_ROUNDS = 2;
export const DC_ROUNDS_SHORT = 1;
/** Points per vote, and for having the most votes in a stage. */
export const DC_VOTE_POINTS = 100;
export const DC_WIN_BONUS = 200;

export function stageTitle(stage: Stage, word: string): string {
  return stage === 0 ? `What does “${word}” mean?` : stage === 1 ? `Another word for “${word}”` : `Use “${word}” in a sentence`;
}

/** The start of the word, which a sentence has to contain (so "pierogowałem" counts for "pierogować"). */
export function wordStem(word: string): string {
  const k = answerKey(word).replace(/ /g, '');
  return k.slice(0, Math.max(4, k.length - 3));
}

/** Does a sentence use the word (in any form)? */
export function usesWord(sentence: string, word: string): boolean {
  return answerKey(sentence).replace(/ /g, '').includes(wordStem(word));
}

/** A synonym can't just be the word itself. */
export function isEcho(synonym: string, word: string): boolean {
  return answerKey(synonym).replace(/ /g, '') === answerKey(word).replace(/ /g, '');
}

/** Fill `{w}` in a sentence template with the word (in lower case, as it would be mid-sentence). */
export function fillSentence(template: string, word: string): string {
  return template.replace('{w}', word.toLowerCase());
}

/** The canonical pick from a vote: one of the winners, or anything if nobody voted. */
export function canonical(winners: readonly number[], count: number, rng: () => number = Math.random): number {
  if (count <= 0) return -1;
  const from = winners.length ? winners : Array.from({ length: count }, (_, k) => k);
  return from[Math.floor(rng() * from.length)];
}

export function howTo(short: boolean): string[] {
  return [
    'A made-up word: write what it means – best one becomes official',
    'Then a synonym for it, then use it in a sentence',
    short ? 'Votes score for the author · best of each stage +200' : 'Votes score for the author · best of each stage +200 · 2 words',
  ];
}
