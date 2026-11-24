import { describe, expect, it } from 'vitest';
import { findReturning, renameIn, renameInLog, type Departed } from '../client/src/host/rejoin';
import { runningTotals } from '../client/src/host/tournament';
import { niceScale } from '../client/src/host/Scoreboard';

const departed: Departed[] = [
  { id: 'phone-a', name: 'Ania', party: 7 },
  { id: 'phone-b', name: 'Bartek', party: 3 },
];

describe('findReturning', () => {
  it('finds a returning player by their phone id, whatever name they type now', () => {
    expect(findReturning(departed, 'phone-a', 'Ania2')?.party).toBe(7);
  });

  it('falls back to the name (any case) for a new phone', () => {
    expect(findReturning(departed, 'phone-new', 'bartek')?.id).toBe('phone-b');
  });

  it('prefers the phone id over a name match', () => {
    expect(findReturning(departed, 'phone-b', 'Ania')?.id).toBe('phone-b');
  });

  it('returns null for someone new', () => {
    expect(findReturning(departed, 'phone-z', 'Zosia')).toBeNull();
  });
});

describe('renaming a returning player', () => {
  it('moves their points to the new id', () => {
    const rec: Record<string, number> = { old: 4, other: 1 };
    renameIn(rec, 'old', 'new');
    expect(rec).toEqual({ new: 4, other: 1 });
  });

  it('leaves a log alone when the id did not change or is not in it', () => {
    const log = [{ gained: { a: 2 } }];
    renameInLog(log, 'a', 'a');
    renameInLog(log, 'x', 'y');
    expect(log).toEqual([{ gained: { a: 2 } }]);
  });

  it('keeps the chart starting at 0 after a rejoin with points restored', () => {
    // Ania earned 3 + 4 party points, left, and joined again from a new phone.
    const history = [{ gained: { 'phone-a': 3, b: 1 } }, { gained: { 'phone-a': 4, b: 2 } }];
    renameInLog(history, 'phone-a', 'phone-new');
    const party = findReturning(departed, 'phone-new', 'Ania')!.party; // 7
    const totals = runningTotals(history, ['phone-new']);
    const base = party - totals[totals.length - 1]['phone-new'];
    expect(base).toBe(0);
  });
});

describe('niceScale', () => {
  it('starts the axis at 0 for normal points', () => {
    expect(niceScale(12)).toMatchObject({ bottom: 0 });
    expect(niceScale(12).top).toBeGreaterThanOrEqual(12);
  });

  it('reaches below 0 when a total is negative, so no line falls off the chart', () => {
    const { bottom, top } = niceScale(10, -7);
    expect(bottom).toBeLessThanOrEqual(-7);
    expect(top).toBeGreaterThanOrEqual(10);
  });

  it('still has a range when everything is 0 or below', () => {
    const { bottom, top } = niceScale(0, -3);
    expect(top).toBeGreaterThan(bottom);
    expect(bottom).toBeLessThanOrEqual(-3);
  });
});
