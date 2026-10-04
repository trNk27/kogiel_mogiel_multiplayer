import { describe, expect, it } from 'vitest';
import { placesFor } from '../client/src/host/standings';

describe('placesFor', () => {
  it('ranks higher scores first and shares places on ties', () => {
    expect(placesFor([10, 30, 20])).toEqual([3, 1, 2]);
    expect(placesFor([5, 5, 1])).toEqual([1, 1, 3]);
  });
});
