import { describe, expect, it } from 'vitest';
import { isNewer } from '../client/src/host/version';

const mine = { commit: '4de998d', builtAt: '2026-11-25T20:10:00.000Z' };

describe('isNewer', () => {
  it('spots a different commit on the server', () => {
    expect(isNewer({ commit: 'abc1234', builtAt: '2026-11-25T21:00:00.000Z' }, mine)).toBe(true);
  });

  it('ignores a rebuild of the same commit', () => {
    expect(isNewer({ commit: '4de998d', builtAt: '2026-11-25T21:00:00.000Z' }, mine)).toBe(false);
  });

  it('ignores a broken or empty answer', () => {
    expect(isNewer({}, mine)).toBe(false);
    expect(isNewer({ commit: '' }, mine)).toBe(false);
    expect(isNewer({ commit: 42 }, mine)).toBe(false);
  });

  it('compares build times for local builds without git', () => {
    const dev = { commit: 'dev', builtAt: '2026-11-25T20:00:00.000Z' };
    expect(isNewer({ commit: 'dev', builtAt: '2026-11-25T20:05:00.000Z' }, dev)).toBe(true);
    expect(isNewer({ commit: 'dev', builtAt: dev.builtAt }, dev)).toBe(false);
  });
});
