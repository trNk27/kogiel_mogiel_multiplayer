import { describe, expect, it } from 'vitest';
import { GAMES } from '../shared/protocol';
import { RINGS, Z_TITLE, orbitLayout, planetAt, ringRy, zFor } from '../client/src/host/orbits';

describe('landing page orbits', () => {
  it('puts every game on a ring, more on the bigger rings', () => {
    for (const n of [1, 5, 23, GAMES.length, 60]) expect(orbitLayout(n)).toHaveLength(n);
    const sizes = RINGS.map((_, r) => orbitLayout(GAMES.length).filter((p) => p.ring === r).length);
    for (let r = 1; r < sizes.length; r++) expect(sizes[r]).toBeGreaterThanOrEqual(sizes[r - 1]);
  });

  it('spreads a ring evenly', () => {
    const ring = orbitLayout(GAMES.length).filter((p) => p.ring === 0);
    const step = (Math.PI * 2) / ring.length;
    ring.forEach((p, k) => k && expect(p.phase - ring[k - 1].phase).toBeCloseTo(step));
  });

  it('keeps planets on their ellipse, turning both ways at different speeds', () => {
    for (const p of orbitLayout(GAMES.length)) {
      const r = RINGS[p.ring];
      for (const t of [0, 3.3, 47]) {
        const { x, y } = planetAt(p, t);
        expect((x / r.rx) ** 2 + (y / ringRy(r)) ** 2).toBeCloseTo(1);
      }
    }
    expect(new Set(RINGS.map((r) => Math.abs(r.speed))).size).toBe(RINGS.length);
    RINGS.forEach((r, i) => i && expect(Math.sign(r.speed)).not.toBe(Math.sign(RINGS[i - 1].speed)));
  });

  it('draws the near side bigger and brighter than the far side', () => {
    const p = { ring: 3, phase: 0 };
    const front = planetAt(p, Math.PI / 2 / RINGS[3].speed);
    const back = planetAt(p, -Math.PI / 2 / RINGS[3].speed);
    expect(front.depth).toBeCloseTo(1);
    expect(front.scale).toBeGreaterThan(back.scale);
    expect(front.opacity).toBeGreaterThan(back.opacity);
  });

  it('stacks planets on different rings by height alone, so they swap only when level', () => {
    const planets = orbitLayout(GAMES.length);
    for (let t = 0; t < 120; t += 0.25) {
      const poses = planets.map((p) => planetAt(p, t));
      for (const a of poses)
        for (const b of poses) {
          // The same height means the same size and the same depth, whatever the ring.
          if (Math.abs(a.y - b.y) < 1e-9) expect(a.scale).toBeCloseTo(b.scale);
          // Lower on the screen is always in front, and only a real tie ties.
          if (a.y > b.y + 0.1) expect(zFor(a.y)).toBeGreaterThan(zFor(b.y));
        }
    }
    expect(zFor(-1)).toBeLessThan(Z_TITLE);
    expect(zFor(1)).toBeGreaterThan(Z_TITLE);
  });

  it('stays on the 1920×1080 stage', () => {
    const outer = RINGS[RINGS.length - 1];
    const half = (96 * planetAt({ ring: RINGS.length - 1, phase: Math.PI / 2 }, 0).scale) / 2;
    expect(outer.rx + half).toBeLessThanOrEqual(960);
    expect(ringRy(outer) + half).toBeLessThanOrEqual(540);
  });
});
