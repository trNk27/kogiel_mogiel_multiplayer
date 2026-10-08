import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../client/src/games/rng';
import {
  CIG_LENGTH,
  HOLD_MAX_MS,
  HOLD_MIN_MS,
  PUFF_MAX,
  Verdict,
  SUSPENSE_MS,
  angleDiff,
  crownHops,
  finaleTimes,
  puffAmount,
  ratePuff,
  refillColor,
  slotCount,
  slotInFront,
  traySpeed,
  yellowness,
} from '../client/src/games/smoke/logic';

describe('Fajki', () => {
  it('rates a pull at the right pace, held, as perfect', () => {
    expect(ratePuff(750, 1, 800)).toEqual({ q: 1, v: Verdict.Perfect });
  });

  it('says too fast, too slow, hold it and too long', () => {
    const fast = ratePuff(200, 1, 800);
    expect(fast.v).toBe(Verdict.Fast);
    expect(fast.q).toBeLessThan(0.5);
    const slow = ratePuff(2500, 1, 800);
    expect(slow.v).toBe(Verdict.Slow);
    expect(slow.q).toBeLessThan(0.5);
    const short = ratePuff(750, 1, HOLD_MIN_MS / 4);
    expect(short.v).toBe(Verdict.Short);
    expect(short.q).toBeLessThan(1);
    expect(ratePuff(750, 1, HOLD_MAX_MS + 1)).toEqual({ q: 0, v: Verdict.Long });
  });

  it('smokes in proportion to the puff, never more than is left', () => {
    expect(puffAmount(1, CIG_LENGTH)).toBe(PUFF_MAX);
    expect(puffAmount(0.5, CIG_LENGTH)).toBe(Math.round(PUFF_MAX / 2));
    expect(puffAmount(1, 10)).toBe(10);
    expect(puffAmount(7, CIG_LENGTH)).toBe(PUFF_MAX);
    expect(puffAmount(-1, CIG_LENGTH)).toBe(0);
    expect(puffAmount(Number.NaN, CIG_LENGTH)).toBe(0);
  });

  it('finds the cigarette in front of a seat', () => {
    expect(angleDiff(0.1, 2 * Math.PI - 0.1)).toBeCloseTo(0.2);
    const n = 12;
    const step = (2 * Math.PI) / n;
    // Slot 3 sits right in front of a seat at 3 steps.
    expect(slotInFront(0, n, 3 * step)).toBe(3);
    // Turn the tray by one step: now slot 2 is there.
    expect(slotInFront(step, n, 3 * step)).toBe(2);
    // Exactly between two slots is nobody's, with a tight tolerance.
    expect(slotInFront(0, n, 3.5 * step, 0.3)).toBe(-1);
  });

  it('has room on the tray for everybody', () => {
    expect(slotCount(1)).toBe(10);
    expect(slotCount(8)).toBe(18);
  });

  it('keeps every colour coming round', () => {
    const rnd = mulberry32(5);
    const colors = ['a', 'b', 'c', 'd'];
    const tray: (string | null)[] = [];
    for (let i = 0; i < 200; i++) tray.push(refillColor(colors, tray.slice(-12), rnd));
    for (const c of colors) expect(tray.filter((x) => x === c).length).toBeGreaterThan(30);
  });

  it('spins faster as the game goes on', () => {
    const rnd = mulberry32(9);
    const early = Array.from({ length: 50 }, () => Math.abs(traySpeed(0, rnd)));
    const late = Array.from({ length: 50 }, () => Math.abs(traySpeed(1, rnd)));
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(avg(late)).toBeGreaterThan(avg(early) * 1.5);
  });

  it('turns the heaviest smoker’s teeth the yellowest', () => {
    const y = yellowness([0, 120, 400]);
    expect(y[0]).toBe(0);
    expect(y[2]).toBe(1);
    expect(y[1]).toBeGreaterThan(0);
    expect(y[1]).toBeLessThan(1);
    // A puff or two doesn't make anyone fully yellow.
    expect(yellowness([20])[0]).toBeLessThan(0.2);
  });

  it('runs the finale in order: landings, flash, suspense, the crown', () => {
    const t = finaleTimes(5);
    expect(t.landed).toBeLessThan(t.flash);
    expect(t.flash).toBeLessThan(t.suspense);
    expect(t.reveal - t.suspense).toBe(SUSPENSE_MS);
    expect(t.end).toBeGreaterThan(t.reveal);
    expect(finaleTimes(8).landed).toBeGreaterThan(finaleTimes(2).landed);
  });

  it('hops the crown about, slowing down, and lands it on the winner', () => {
    for (let seed = 1; seed < 30; seed++) {
      const hops = crownHops(6, 4, SUSPENSE_MS, mulberry32(seed));
      expect(hops.length).toBeGreaterThan(5);
      expect(hops[hops.length - 1].floor).toBe(4);
      for (let k = 1; k < hops.length; k++) {
        expect(hops[k].floor).not.toBe(hops[k - 1].floor);
        expect(hops[k].at).toBeGreaterThan(hops[k - 1].at);
        if (k > 1) expect(hops[k].at - hops[k - 1].at).toBeGreaterThan(hops[k - 1].at - hops[k - 2].at);
      }
      expect(hops[hops.length - 1].at).toBeLessThan(SUSPENSE_MS);
    }
    expect(crownHops(1, 0, SUSPENSE_MS, mulberry32(1)).every((h) => h.floor === 0)).toBe(true);
    const nobody = crownHops(3, null, SUSPENSE_MS, mulberry32(2));
    expect(nobody[nobody.length - 1].floor).toBeLessThan(3);
  });
});
