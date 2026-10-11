import { describe, expect, it } from 'vitest';
import { pickStyle } from '../client/src/games/arena/styles';

describe('pickStyle', () => {
  it('rolls original or Vaporwave, half each', () => {
    expect(pickStyle(() => 0).id).toBe('psx');
    expect(pickStyle(() => 0.49).id).toBe('psx');
    expect(pickStyle(() => 0.5).id).toBe('vaporwave');
    expect(pickStyle(() => 0.99).id).toBe('vaporwave');
    const counts: Record<string, number> = {};
    for (let i = 0; i < 3000; i++) {
      const id = pickStyle(() => i / 3000).id;
      counts[id] = (counts[id] ?? 0) + 1;
    }
    expect(counts).toEqual({ psx: 1500, vaporwave: 1500 });
  });

  it('only rolls the looks a game allows', () => {
    for (let i = 0; i < 100; i++) expect(['psx', 'comic']).toContain(pickStyle(() => i / 100, ['psx', 'comic']).id);
  });
});
