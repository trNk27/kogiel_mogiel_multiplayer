import { describe, expect, it } from 'vitest';
import data from '../data/dictionary.json';
import { DC_MAX, canonical, fillSentence, howTo, isEcho, stageTitle, usesWord, wordStem } from '../client/src/games/dictionary/logic';
import { mulberry32 } from '../client/src/games/rng';

const D = data as {
  words: { id: string; word: string; pos: 'noun' | 'verb' | 'adjective' }[];
  definitions: Record<string, string[]>;
  synonyms: Record<string, string[]>;
  sentences: Record<string, string[]>;
};

describe('Słownik data', () => {
  it('has plenty of unique made-up words of every kind', () => {
    expect(D.words.length).toBeGreaterThanOrEqual(60);
    expect(new Set(D.words.map((w) => w.id)).size).toBe(D.words.length);
    expect(new Set(D.words.map((w) => w.word.toLowerCase())).size).toBe(D.words.length);
    for (const pos of ['noun', 'verb', 'adjective']) expect(D.words.filter((w) => w.pos === pos).length).toBeGreaterThanOrEqual(15);
  });

  it('Babcia has fallback lines that fit, for every part of speech', () => {
    for (const pos of ['noun', 'verb', 'adjective']) {
      expect(D.definitions[pos].length).toBeGreaterThanOrEqual(8);
      for (const d of D.definitions[pos]) expect(d.length).toBeLessThanOrEqual(DC_MAX[0]);
      for (const s of D.synonyms[pos]) expect(s.length).toBeLessThanOrEqual(DC_MAX[1]);
      for (const s of D.sentences[pos]) {
        expect(s).toContain('{w}');
        // Every fallback sentence passes the "uses the word" check with every word of its kind.
        for (const w of D.words.filter((x) => x.pos === pos)) {
          const filled = fillSentence(s, w.word);
          expect(usesWord(filled, w.word)).toBe(true);
          expect(filled.length).toBeLessThanOrEqual(DC_MAX[2]);
        }
      }
    }
  });
});

describe('Słownik rules', () => {
  it('a sentence has to use the word, in any form', () => {
    expect(usesWord('Wczoraj pierogowałem cały dzień', 'Pierogować')).toBe(true);
    expect(usesWord('I saw three ZIEMNIAKOŁAKI last night', 'Ziemniakołak')).toBe(true);
    expect(usesWord('I love pierogi', 'Pierogować')).toBe(false);
    expect(usesWord('No word here at all', 'Bigosfera')).toBe(false);
    expect(wordStem('Babciasty').length).toBeGreaterThanOrEqual(4);
  });

  it('a synonym can’t be the word itself', () => {
    expect(isEcho('pierogrzmot', 'Pierogrzmot')).toBe(true);
    expect(isEcho('PIEROGRZMOT!', 'Pierogrzmot')).toBe(true);
    expect(isEcho('a big dumpling', 'Pierogrzmot')).toBe(false);
  });

  it('picks the official entry from the winners, or anything if nobody voted', () => {
    expect(canonical([2], 4)).toBe(2);
    const tie = new Set(Array.from({ length: 30 }, (_, k) => canonical([1, 3], 4, mulberry32(k))));
    expect([...tie].sort()).toEqual([1, 3]);
    const any = canonical([], 3, mulberry32(1));
    expect(any).toBeGreaterThanOrEqual(0);
    expect(any).toBeLessThan(3);
    expect(canonical([], 0)).toBe(-1);
  });

  it('titles and how-to', () => {
    expect(stageTitle(0, 'Bigosfera')).toContain('mean');
    expect(stageTitle(1, 'Bigosfera')).toContain('Another word');
    expect(stageTitle(2, 'Bigosfera')).toContain('sentence');
    expect(fillSentence('Never {w} before breakfast.', 'Bigosić')).toBe('Never bigosić before breakfast.');
    expect(howTo(true)).toHaveLength(3);
  });
});
