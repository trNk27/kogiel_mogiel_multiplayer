import { describe, expect, it } from 'vitest';
import categories from '../data/spy.json';
import { mulberry32 } from '../client/src/games/rng';
import {
  CATCH_POINTS,
  MAX_CLUE,
  SKIPPED,
  SPY_ESCAPE_POINTS,
  SPY_STEAL_POINTS,
  SpyRound,
  VOTE_BONUS,
  WORDS_PER_CATEGORY,
  checkClue,
  howTo,
  isCaught,
  lapsFor,
  pickCategory,
  pickSpy,
  roundsFor,
  scoreRound,
  tallyVotes,
  turnOrder,
  wordKey,
  type SpyCategory,
} from '../client/src/games/spy/logic';

const POOL = categories as SpyCategory[];
const CAT: SpyCategory = {
  name: 'Test',
  icon: '🧪',
  words: ['Apple pie', 'Pierogi', 'Kraków', 'Ice-cream', 'Sto lat', 'Cat', 'Dog', 'Cow', 'Hen', 'Pig', 'Fox', 'Owl', 'Elk', 'Bee', 'Ant', 'Eel'].map((w) => ({ w })),
};
const ids = ['a', 'b', 'c', 'd'];

describe('spy data', () => {
  it('has about 30 categories of exactly 16 distinct words', () => {
    expect(POOL.length).toBeGreaterThanOrEqual(30);
    expect(new Set(POOL.map((c) => c.name)).size).toBe(POOL.length);
    for (const c of POOL) {
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.icon.length).toBeGreaterThan(0);
      expect(c.words).toHaveLength(WORDS_PER_CATEGORY);
      expect(new Set(c.words.map((w) => wordKey(w.w))).size).toBe(WORDS_PER_CATEGORY);
      for (const w of c.words) {
        expect(w.w).toBe(w.w.trim());
        expect(w.w.length).toBeGreaterThan(0);
        expect(w.w.length).toBeLessThanOrEqual(24);
        if (w.e !== undefined) expect(w.e).toMatch(/^\p{Extended_Pictographic}/u);
      }
    }
  });
  it('picks every category once before repeating', () => {
    const used = new Set<string>();
    const rng = mulberry32(5);
    const seen = new Set<string>();
    for (let i = 0; i < POOL.length; i++) seen.add(pickCategory(POOL, used, rng).name);
    expect(seen.size).toBe(POOL.length);
    pickCategory(POOL, used, rng);
    expect(used.size).toBe(1);
  });
});

describe('rounds and laps', () => {
  it('plays a round per player, 3 to 6, and 3 in a tournament', () => {
    expect([3, 4, 5, 6, 7, 8].map((n) => roundsFor(n))).toEqual([3, 4, 5, 6, 6, 6]);
    expect(roundsFor(2)).toBe(3);
    expect([3, 5, 8].map((n) => roundsFor(n, true))).toEqual([3, 3, 3]);
  });
  it('goes round twice with 3–4 players, once with more', () => {
    expect([3, 4, 5, 8].map(lapsFor)).toEqual([2, 2, 1, 1]);
  });
  it('has three short how-to lines', () => {
    expect(howTo(false)).toHaveLength(3);
    expect(howTo(true)).toHaveLength(3);
  });
});

describe('pickSpy', () => {
  it('never picks last round’s spy when somebody else can be it', () => {
    for (let seed = 1; seed < 200; seed++) {
      const rng = mulberry32(seed);
      const history: string[] = [];
      for (let r = 0; r < 12; r++) {
        const s = pickSpy(ids, history, rng);
        expect(ids).toContain(s);
        if (history.length) expect(s).not.toBe(history[history.length - 1]);
        history.push(s);
      }
    }
  });
  it('rotates: everyone is the spy once before anybody is twice', () => {
    for (let seed = 1; seed < 50; seed++) {
      const rng = mulberry32(seed);
      const history: string[] = [];
      for (let r = 0; r < ids.length; r++) history.push(pickSpy(ids, history, rng));
      expect(new Set(history).size).toBe(ids.length);
    }
  });
  it('ignores players who left, and copes with a single player', () => {
    expect(pickSpy(['a', 'b'], ['x', 'a'])).toBe('b');
    expect(pickSpy(['a'], ['a'])).toBe('a');
  });
});

describe('checkClue', () => {
  it('takes one word up to the limit', () => {
    expect(checkClue('  crispy ', 'Pierogi', false)).toEqual({ ok: true, clue: 'crispy' });
    expect(checkClue('golden-brown', 'Pierogi', false).ok).toBe(true);
    expect(checkClue('x'.repeat(MAX_CLUE), 'Pierogi', false).ok).toBe(true);
    expect(checkClue('Żółć', 'Pierogi', false).ok).toBe(true);
  });
  it('turns down spaces, empty, too long and non-words', () => {
    expect(checkClue('two words', 'Pierogi', false)).toEqual({ ok: false, error: 'One word only – no spaces!' });
    expect(checkClue('tab\tbed', 'Pierogi', false).ok).toBe(false);
    expect(checkClue('   ', 'Pierogi', false).ok).toBe(false);
    expect(checkClue(42, 'Pierogi', false).ok).toBe(false);
    expect(checkClue('x'.repeat(MAX_CLUE + 1), 'Pierogi', false).ok).toBe(false);
    expect(checkClue('!!!', 'Pierogi', false).ok).toBe(false);
    expect(checkClue('<b>', 'Pierogi', false)).toEqual({ ok: true, clue: 'b' });
  });
  it('stops players saying the word, but never tells the spy', () => {
    expect(checkClue('PIEROGI!', 'Pierogi', false).ok).toBe(false);
    expect(checkClue('krakow', 'Kraków', false).ok).toBe(false);
    expect(checkClue('apple', 'Apple pie', false).ok).toBe(false);
    expect(checkClue('icecream', 'Ice-cream', false).ok).toBe(false);
    expect(checkClue('pie', 'Apple pie', false).ok).toBe(true);
    expect(checkClue('sto', 'Sto lat', false).ok).toBe(true);
    expect(checkClue('pierogi', 'Pierogi', true)).toEqual({ ok: true, clue: 'pierogi' });
  });
});

describe('turn order and laps', () => {
  it('goes round the seats from the start, lap after lap', () => {
    expect(turnOrder(ids, 2, 2)).toEqual(['c', 'd', 'a', 'b', 'c', 'd', 'a', 'b']);
    expect(turnOrder(['a', 'b', 'c', 'd', 'e'], 4, 1)).toEqual(['e', 'a', 'b', 'c', 'd']);
  });
  it('takes clues in turn, rejects the wrong player and counts laps', () => {
    const r = new SpyRound(['a', 'b', 'c'], 'b', CAT, 1, 1);
    expect(r.laps).toBe(2);
    expect(r.current).toBe('b');
    expect(r.giveClue('a', 'hello').ok).toBe(false);
    expect(r.giveClue('b', 'tasty').ok).toBe(true);
    expect(r.giveClue('c', 'two words').ok).toBe(false);
    expect(r.current).toBe('c');
    r.skip();
    expect(r.clues[1]).toEqual({ id: 'c', text: SKIPPED, lap: 0, skipped: true });
    expect(r.giveClue('a', 'boiled').ok).toBe(true);
    expect(r.lap).toBe(1);
    for (const id of ['b', 'c', 'a']) expect(r.giveClue(id, 'more').ok).toBe(true);
    expect(r.cluesDone).toBe(true);
    expect(r.current).toBeUndefined();
    expect(r.cluesBy('a').map((c) => c.lap)).toEqual([0, 1]);
    expect(r.giveClue('b', 'late').ok).toBe(false);
  });
  it('one lap with five players', () => {
    const r = new SpyRound(['a', 'b', 'c', 'd', 'e'], 'a', CAT, 0, 0);
    for (let i = 0; i < 5; i++) r.skip();
    expect(r.cluesDone).toBe(true);
    expect(r.clues).toHaveLength(5);
  });
});

describe('votes', () => {
  it('counts votes and finds the top', () => {
    const t = tallyVotes({ a: 'b', c: 'b', d: 'a', b: 'a' }, ids);
    expect(t.counts).toEqual({ a: 2, b: 2, c: 0, d: 0 });
    expect(t.top).toEqual(['a', 'b']);
    expect(isCaught(t, 'b')).toBe(false);
  });
  it('catches the spy only with strictly the most votes', () => {
    expect(isCaught(tallyVotes({ a: 'b', c: 'b', d: 'a' }, ids), 'b')).toBe(true);
    expect(isCaught(tallyVotes({ a: 'b', c: 'd' }, ids), 'b')).toBe(false);
    expect(isCaught(tallyVotes({}, ids), 'b')).toBe(false);
    expect(tallyVotes({}, ids).top).toEqual([]);
  });
  it('ignores self votes and votes by or for strangers', () => {
    const t = tallyVotes({ a: 'a', x: 'b', c: 'x', d: 'c' }, ids);
    expect(t.counts).toEqual({ a: 0, b: 0, c: 1, d: 0 });
  });
  it('lets each player vote once for somebody else', () => {
    const r = new SpyRound(ids, 'a', CAT, 0);
    expect(r.candidates('b')).toEqual(['a', 'c', 'd']);
    expect(r.vote('b', 'b')).toBe(false);
    expect(r.vote('b', 'x')).toBe(false);
    expect(r.vote('b', 'a')).toBe(true);
    expect(r.vote('b', 'c')).toBe(false);
    r.lock();
    expect(r.vote('c', 'a')).toBe(false);
    expect(r.tally?.counts.a).toBe(1);
    expect(r.caught).toBe(true);
  });
});

describe('the spy’s last guess and scoring', () => {
  const caughtRound = () => {
    const r = new SpyRound(ids, 'a', CAT, 5);
    r.vote('b', 'a');
    r.vote('c', 'a');
    r.vote('d', 'b');
    r.vote('a', 'd');
    r.lock();
    return r;
  };
  it('a spy who escapes gets 300', () => {
    const r = new SpyRound(ids, 'a', CAT, 5);
    r.vote('b', 'a');
    r.vote('c', 'd');
    r.lock();
    expect(r.caught).toBe(false);
    expect(r.guessWord(5)).toBe(false);
    expect(r.outcome()).toBe('escaped');
    expect(r.settle()).toEqual({ a: SPY_ESCAPE_POINTS, b: 0, c: 0, d: 0 });
  });
  it('a caught spy who guesses the word steals 200', () => {
    const r = caughtRound();
    expect(r.guessWord(99)).toBe(false);
    expect(r.guessWord(5)).toBe(true);
    expect(r.guessWord(4)).toBe(false);
    expect(r.outcome()).toBe('stole');
    expect(r.settle()).toEqual({ a: SPY_STEAL_POINTS, b: 0, c: 0, d: 0 });
  });
  it('a caught spy who guesses wrong pays everyone 100, and 100 more to those who voted right', () => {
    const r = caughtRound();
    r.guessWord(4);
    expect(r.outcome()).toBe('caught');
    expect(r.settle()).toEqual({ a: 0, b: CATCH_POINTS + VOTE_BONUS, c: CATCH_POINTS + VOTE_BONUS, d: CATCH_POINTS });
  });
  it('no guess in time counts as wrong', () => {
    const r = caughtRound();
    expect(r.outcome()).toBe('caught');
  });
  it('a void round scores nothing', () => {
    expect(scoreRound('void', ids, 'a', new Map([['b', 'a']]))).toEqual({ a: 0, b: 0, c: 0, d: 0 });
  });
});

describe('players leaving', () => {
  it('skips the turns of a player who left, including the current one', () => {
    const r = new SpyRound(ids, 'a', CAT, 0, 0);
    expect(r.current).toBe('a');
    expect(r.remove('c')).toBe('other');
    r.giveClue('a', 'one');
    expect(r.current).toBe('b');
    expect(r.remove('b')).toBe('current');
    expect(r.current).toBe('d');
    r.skip();
    expect(r.current).toBe('a');
    r.skip();
    expect(r.current).toBe('d');
    r.skip();
    expect(r.cluesDone).toBe(true);
    expect(r.remove('b')).toBe('none');
  });
  it('drops their vote and the votes for them before the vote ends', () => {
    const r = new SpyRound(ids, 'a', CAT, 0);
    r.vote('b', 'c');
    r.vote('c', 'a');
    r.vote('d', 'c');
    r.remove('c');
    expect([...r.votes]).toEqual([]);
    expect(r.candidates('b')).toEqual(['a', 'd']);
    expect(r.vote('b', 'a')).toBe(true);
    expect(r.vote('c', 'a')).toBe(false);
  });
  it('keeps the tally once the vote is over, and scores only who is left', () => {
    const r = new SpyRound(ids, 'a', CAT, 0);
    r.vote('b', 'a');
    r.vote('c', 'a');
    r.lock();
    r.remove('c');
    expect(r.caught).toBe(true);
    expect(r.settle()).toEqual({ a: 0, b: CATCH_POINTS + VOTE_BONUS, d: CATCH_POINTS });
  });
  it('a spy who leaves voids the round – unless it was already scored', () => {
    const r = new SpyRound(ids, 'b', CAT, 0);
    r.vote('a', 'b');
    expect(r.remove('b')).toBe('spy');
    expect(r.void).toBe(true);
    expect(r.outcome()).toBe('void');
    expect(r.giveClue('a', 'x').ok).toBe(false);
    expect(r.vote('c', 'a')).toBe(false);
    expect(r.settle()).toEqual({ a: 0, c: 0, d: 0 });

    const s = new SpyRound(ids, 'b', CAT, 0);
    s.lock();
    s.settle();
    s.remove('b');
    expect(s.void).toBe(false);
    expect(s.outcome()).toBe('escaped');
  });
});
