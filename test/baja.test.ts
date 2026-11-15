import { describe, expect, it } from 'vitest';
import {
  BAJA_ROUNDS,
  BAJA_ROUNDS_SHORT,
  BAJA_TRIES,
  Craving,
  ROWS,
  TRY_POINTS,
  changeMind,
  hits,
  howTo,
  makeCraving,
  makeHint,
  mulberry32,
  pointsForTry,
  reactionFor,
  rowsFor,
  validPlate,
} from '../client/src/games/baja/logic';

describe('rows', () => {
  it('have unique option ids and an emoji each', () => {
    for (const r of ROWS) {
      expect(new Set(r.options.map((o) => o.id)).size).toBe(r.options.length);
      for (const o of r.options) expect(o.emoji.length).toBeGreaterThan(0);
    }
  });
  it('the last craving is extra picky', () => {
    expect(rowsFor(1, BAJA_ROUNDS)).toBe(3);
    expect(rowsFor(BAJA_ROUNDS, BAJA_ROUNDS)).toBe(4);
    expect(rowsFor(BAJA_ROUNDS_SHORT, BAJA_ROUNDS_SHORT)).toBe(4);
  });
});

describe('cravings and hints', () => {
  it('cravings are in range', () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 300; i++) {
      const c = makeCraving(i % 2 ? 3 : 4, rng);
      expect(validPlate(c, c.length)).toBe(true);
    }
  });
  it('the hint is never what she wants', () => {
    const rng = mulberry32(3);
    for (let i = 0; i < 500; i++) {
      const c = makeCraving(4, rng);
      const h = makeHint(c, rng);
      expect(h.row).toBeGreaterThanOrEqual(0);
      expect(h.row).toBeLessThan(c.length);
      expect(h.opt).not.toBe(c[h.row]);
      expect(h.opt).toBeLessThan(ROWS[h.row].options.length);
    }
  });
  it('changing her mind changes exactly one row to something else', () => {
    const rng = mulberry32(11);
    for (let i = 0; i < 500; i++) {
      const c = makeCraving(3, rng);
      const m = changeMind(c, rng);
      const diff = c.filter((v, k) => v !== m.craving[k]);
      expect(diff).toHaveLength(1);
      expect(m.craving[m.row]).not.toBe(c[m.row]);
      expect(validPlate(m.craving, 3)).toBe(true);
    }
  });
});

describe('tasting', () => {
  it('counts the rows she likes', () => {
    expect(hits([0, 1, 2], [0, 1, 2])).toBe(3);
    expect(hits([0, 0, 0], [0, 1, 2])).toBe(1);
    expect(hits([5, 0, 0], [0, 1, 2])).toBe(0);
  });
  it('reacts by how close the plate was', () => {
    expect(reactionFor(0, 3)).toBe('snub');
    expect(reactionFor(1, 3)).toBe('lick');
    expect(reactionFor(2, 3)).toBe('spit');
    expect(reactionFor(3, 3)).toBe('eat');
    expect(reactionFor(3, 4)).toBe('spit');
    expect(reactionFor(4, 4)).toBe('eat');
  });
  it('rejects bad plates', () => {
    expect(validPlate([0, 0, 0], 3)).toBe(true);
    expect(validPlate([0, 0], 3)).toBe(false);
    expect(validPlate([6, 0, 0], 3)).toBe(false);
    expect(validPlate([0, 3, 0], 3)).toBe(false);
    expect(validPlate([0.5, 0, 0], 3)).toBe(false);
    expect(validPlate('nope', 3)).toBe(false);
  });
  it('earlier is worth more', () => {
    expect(pointsForTry(1)).toBe(1000);
    for (let t = 2; t <= BAJA_TRIES; t++) expect(pointsForTry(t)).toBeLessThan(pointsForTry(t - 1));
    expect(TRY_POINTS).toHaveLength(BAJA_TRIES);
  });
});

describe('a craving', () => {
  it('scores whoever feeds her right, by try', () => {
    const c = new Craving(['a', 'b', 'c'], [1, 2, 0]);
    expect(c.submit('a', [1, 2, 0])).toBe(true);
    expect(c.submit('a', [1, 2, 0])).toBe(false); // once per try
    expect(c.submit('b', [1, 0, 0])).toBe(true);
    expect(c.allIn(() => true)).toBe(false);
    expect(c.allIn((id) => id !== 'c')).toBe(true);
    const t = c.taste();
    expect(t.map((x) => [x.id, x.hits, x.pts])).toEqual([
      ['a', 3, 1000],
      ['b', 2, 0],
    ]);
    // c missed the try; it still counts as used.
    expect(c.history.get('c')).toEqual([{ plate: null, hits: 0 }]);
    c.nextTry();
    expect(c.active('a')).toBe(false);
    expect(c.submit('a', [1, 2, 0])).toBe(false);
    expect(c.submit('b', [1, 2, 0])).toBe(true);
    const t2 = c.taste();
    expect(t2[0]).toMatchObject({ id: 'b', fed: true, pts: 800 });
    expect(c.fedOn.get('b')).toBe(2);
  });
  it('ends when everyone has fed her or the tries run out', () => {
    const c = new Craving(['a'], [0, 0, 0]);
    for (let k = 0; k < BAJA_TRIES; k++) {
      expect(c.over).toBe(false);
      c.submit('a', [1, 1, 1]);
      c.taste();
      c.nextTry();
    }
    expect(c.over).toBe(true);
    const d = new Craving(['a'], [0, 0, 0]);
    d.submit('a', [0, 0, 0]);
    d.taste();
    d.nextTry();
    expect(d.over).toBe(true);
  });
  it('copes with a player leaving mid-try', () => {
    const c = new Craving(['a', 'b'], [0, 0, 0]);
    c.submit('a', [1, 1, 1]);
    c.remove('a');
    expect(c.allIn(() => true)).toBe(false);
    c.submit('b', [0, 0, 1]);
    expect(c.allIn(() => true)).toBe(true);
    expect(c.taste().map((x) => x.id)).toEqual(['b']);
    c.remove('b');
    expect(c.over).toBe(true);
  });
  it('new mind, new answer', () => {
    const c = new Craving(['a'], [0, 0, 0]);
    c.setCraving([0, 1, 0], 1);
    c.submit('a', [0, 1, 0]);
    expect(c.taste()[0].fed).toBe(true);
    expect(c.changed).toEqual([1]);
  });
});

describe('howTo', () => {
  it('has three short lines', () => {
    expect(howTo(false)).toHaveLength(3);
    expect(howTo(true)[2]).toContain('2 cravings');
  });
});
