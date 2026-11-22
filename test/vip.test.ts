import { describe, expect, it } from 'vitest';
import { currentVip } from '../client/src/host/vip';

const anna = { id: 'a', name: 'Anna', joinedAt: 1 };
const bart = { id: 'b', name: 'Bart', joinedAt: 2 };
const mani = { id: 'm', name: 'MANI', joinedAt: 3 };

describe('who is VIP', () => {
  it('is the first to join', () => {
    expect(currentVip([bart, anna], null)).toBe('a');
    expect(currentVip([], null)).toBe(null);
  });

  it('is Mani in the first round, whenever they joined', () => {
    expect(currentVip([anna, bart, mani], null)).toBe('m');
    expect(currentVip([anna, { ...mani, name: ' mani ' }], null)).toBe('m');
  });

  it('passes on as usual once the first game is over', () => {
    expect(currentVip([anna, bart, mani], 'b')).toBe('b');
    // The chosen VIP left: back to the first to join, not Mani.
    expect(currentVip([anna, mani], 'b')).toBe('a');
  });
});
