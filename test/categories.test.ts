import { describe, expect, it } from 'vitest';
import { CATEGORIES, categoryOf, shelves } from '../shared/categories';
import { GAMES, gamesFor } from '../shared/protocol';

describe('game categories', () => {
  it('puts every game on a shelf (none left in "New")', () => {
    const loose = GAMES.filter((g) => categoryOf(g.id) === 'new').map((g) => g.id);
    expect(loose).toEqual([]);
  });

  it('shows every game exactly once', () => {
    const shown = shelves(GAMES).flatMap((s) => s.games.map((g) => g.id));
    expect(shown.sort()).toEqual(GAMES.map((g) => g.id).sort());
  });

  it('keeps shelves short enough to scan', () => {
    for (const s of shelves(GAMES)) expect(s.games.length, s.cat.title).toBeLessThanOrEqual(14);
  });

  it('only shows categories that have games (e.g. without a TV)', () => {
    const noTv = shelves(gamesFor(true));
    expect(noTv.every((s) => s.games.length > 0)).toBe(true);
    expect(noTv.flatMap((s) => s.games).length).toBe(gamesFor(true).length);
  });

  it('has a title, emoji and line for every category', () => {
    for (const c of CATEGORIES) {
      expect(c.title.length).toBeGreaterThan(2);
      expect(c.emoji.length).toBeGreaterThan(0);
      expect(c.blurb.length).toBeGreaterThan(10);
    }
  });
});
