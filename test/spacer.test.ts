import { describe, expect, it } from 'vitest';
import {
  ANOMALIES,
  ANOMALY_CHANCE,
  GOAL,
  groupCall,
  nextLevel,
  pickAnomaly,
  rightCall,
  tiersFor,
  walkerFor,
  type AnomalyId,
} from '../client/src/games/spacer/logic';
import { LEG_A, passageLength, poseAt, walkEnd } from '../client/src/games/spacer/flat';

describe('anomalies', () => {
  it('has 41 different ones, easy to sneaky, with creepy ones among them', () => {
    expect(ANOMALIES).toHaveLength(41);
    expect(new Set(ANOMALIES.map((a) => a.id)).size).toBe(41);
    expect(ANOMALIES.filter((a) => a.creepy).length).toBeGreaterThanOrEqual(10);
    for (const t of [1, 2, 3]) expect(ANOMALIES.filter((a) => a.tier === t).length).toBeGreaterThanOrEqual(5);
  });

  it('is mostly about small things: obvious ones are rare early and gone after halfway', () => {
    expect(tiersFor(0)).toEqual([1, 2, 3]);
    expect(tiersFor(GOAL - 1)).toEqual([2, 3]);
    const count = { 1: 0, 2: 0, 3: 0 };
    for (let i = 0; i < 4000; i++) {
      const a = pickAnomaly(0, new Set());
      if (a) count[ANOMALIES.find((x) => x.id === a)!.tier]++;
    }
    expect(count[1]).toBeLessThan(count[2]);
    for (let i = 0; i < 500; i++) {
      const a = pickAnomaly(GOAL - 2, new Set());
      if (a) expect(ANOMALIES.find((x) => x.id === a)!.tier).not.toBe(1);
    }
  });

  it('turns up about half the time, in the right tier, fresh ones first', () => {
    let n = 0;
    for (let i = 0; i < 2000; i++) if (pickAnomaly(0, new Set())) n++;
    expect(n / 2000).toBeGreaterThan(ANOMALY_CHANCE - 0.07);
    expect(n / 2000).toBeLessThan(ANOMALY_CHANCE + 0.07);
    const allButOne = new Set<AnomalyId>(ANOMALIES.filter((x) => x.id !== 'huge').map((x) => x.id));
    expect(pickAnomaly(0, allButOne, GOAL, () => 0)).toBe('huge');
  });
});

describe('the loop', () => {
  it('turning back is right when something was off, carrying on when nothing was', () => {
    expect(rightCall('huge')).toBe('back');
    expect(rightCall(null)).toBe('forward');
  });

  it('goes with the majority, and a tie turns back', () => {
    expect(groupCall(3, 1)).toBe('back');
    expect(groupCall(1, 3)).toBe('forward');
    expect(groupCall(2, 2)).toBe('back');
  });

  it('a right call moves up an exit, a wrong one sends you back to 0', () => {
    expect(nextLevel(3, 'back', 'huge')).toBe(4);
    expect(nextLevel(3, 'forward', null)).toBe(4);
    expect(nextLevel(7, 'forward', 'lampOff')).toBe(0);
    expect(nextLevel(5, 'back', null)).toBe(0);
  });

  it('everyone takes a turn walking', () => {
    expect([0, 1, 2, 3].map((l) => walkerFor(['a', 'b', 'c'], l))).toEqual(['a', 'b', 'c', 'a']);
  });
});

describe('the walk through the L-shaped flat', () => {
  it('goes along the short leg, turns into the long passage, and stops before the far corner', () => {
    const len = passageLength(null);
    const start = poseAt(0, len);
    expect(start.x).toBe(LEG_A);
    expect(start.yaw).toBeCloseTo(Math.PI / 2);
    const mid = poseAt(LEG_A + len / 2, len);
    expect(mid.x).toBe(0);
    expect(mid.z).toBeCloseTo(-len / 2);
    expect(mid.yaw).toBeCloseTo(0);
    const end = poseAt(walkEnd(null), len);
    expect(end.z).toBeLessThan(-len + 2);
    expect(passageLength('longRoom')).toBeGreaterThan(len);
    // Past the end it turns the far corner, to the left.
    expect(poseAt(LEG_A + len + 4, len).yaw).toBeCloseTo(Math.PI / 2);
  });
});
