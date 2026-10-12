import { describe, expect, it } from 'vitest';
import {
  BOTH,
  BOTH_FROM,
  DT,
  FlagsSim,
  GAP_TIME,
  MAX_CALLS,
  MIN_LIMIT,
  NOT_FROM,
  RED,
  WAIT_TIME,
  WHITE,
  callWords,
  howTo,
  makeCall,
  timeLimit,
  wanted,
  type CallKind,
  type FlagsEvent,
} from '../client/src/games/flags/logic';
import { mulberry32 } from '../client/src/games/rng';

type Answer = (i: number, sim: FlagsSim) => [number, number];

const none: Answer = () => [0, 0];

/** Answers the call right, `after` seconds into it. */
const right =
  (after = 0.3): Answer =>
  (_i, sim) => {
    if (sim.phase !== 'call' || !sim.call || Math.abs(sim.phaseT - after) > DT / 2) return [0, 0];
    const w = wanted(sim.call.kind);
    return [w & WHITE ? 1 : 0, w & RED ? 1 : 0];
  };

/** Raises whatever Babcia shows, which is wrong on a trick. */
const copycat: Answer = (_i, sim) => {
  if (sim.phase !== 'call' || !sim.call || Math.abs(sim.phaseT - 0.3) > DT / 2) return [0, 0];
  return [sim.call.shown & WHITE ? 1 : 0, sim.call.shown & RED ? 1 : 0];
};

function run(sim: FlagsSim, seconds: number, answer: Answer | Answer[] = none) {
  const all: FlagsEvent[] = [];
  for (let k = 0; k < Math.round(seconds / DT); k++) all.push(...sim.step(sim.players.map((_, i) => (Array.isArray(answer) ? answer[i] : answer)(i, sim))));
  return all;
}

function toCall(sim: FlagsSim) {
  sim.begin();
  run(sim, WAIT_TIME + DT);
  expect(sim.phase).toBe('call');
}

describe('calls', () => {
  it('ask for the right flags', () => {
    expect(wanted('white')).toBe(WHITE);
    expect(wanted('red')).toBe(RED);
    expect(wanted('notRed')).toBe(WHITE);
    expect(wanted('notWhite')).toBe(RED);
    expect(wanted('both')).toBe(BOTH);
    for (const k of ['white', 'red', 'notWhite', 'notRed', 'both'] as CallKind[]) {
      expect(callWords(k).en.length).toBeGreaterThan(3);
      expect(callWords(k).pl.length).toBeGreaterThan(3);
    }
  });
  it('start plain, then bring in DON’T and BOTH', () => {
    const rng = mulberry32(4);
    const seen = new Map<number, Set<CallKind>>();
    for (let k = 0; k < 3000; k++) {
      const n = 1 + (k % 20);
      const c = makeCall(n, rng);
      if (!seen.has(n)) seen.set(n, new Set());
      seen.get(n)!.add(c.kind);
    }
    for (let n = 1; n < NOT_FROM; n++) expect([...seen.get(n)!].sort()).toEqual(['red', 'white']);
    for (let n = NOT_FROM; n < BOTH_FROM; n++) expect(seen.get(n)!.has('both')).toBe(false);
    expect(seen.get(BOTH_FROM)!.has('both')).toBe(true);
    expect(seen.get(NOT_FROM)!.has('notRed')).toBe(true);
  });
  it('get quicker, down to a floor', () => {
    for (let n = 1; n < 50; n++) expect(timeLimit(n + 1, 'red')).toBeLessThanOrEqual(timeLimit(n, 'red'));
    expect(timeLimit(50, 'red')).toBe(MIN_LIMIT);
    expect(timeLimit(50, 'both')).toBeGreaterThan(MIN_LIMIT);
  });
  it('sometimes show the wrong flag – but only later, and never on the first calls', () => {
    const rng = mulberry32(7);
    let tricks = 0;
    for (let k = 0; k < 2000; k++) {
      const n = 1 + (k % 30);
      const c = makeCall(n, rng);
      if (c.shown !== wanted(c.kind)) {
        tricks++;
        expect(n).toBeGreaterThanOrEqual(NOT_FROM);
      }
    }
    expect(tricks).toBeGreaterThan(100);
  });
  it('never repeat the same call three times running', () => {
    const rng = mulberry32(2);
    const hist: CallKind[] = [];
    for (let n = 1; n < 400; n++) {
      hist.push(makeCall(1 + (n % 30), rng, hist).kind);
      if (hist.length >= 3) expect(new Set(hist.slice(-3)).size).toBeGreaterThan(1);
    }
  });
});

describe('a round', () => {
  it('keeps the players who raise the right flag', () => {
    const sim = new FlagsSim(2, mulberry32(1));
    toCall(sim);
    const ev = run(sim, 1, right());
    expect(ev.filter((e) => e.t === 'lock')).toHaveLength(2);
    expect(ev.find((e) => e.t === 'resolve')).toMatchObject({ n: 1, out: [], safe: [0, 1] });
    expect(sim.phase).toBe('gap');
    expect(sim.players.every((p) => p.alive && p.right === 1)).toBe(true);
  });
  it('drops the wrong flag and the too-slow into the lake', () => {
    const sim = new FlagsSim(3, mulberry32(1));
    toCall(sim);
    const wrong: Answer = (_i, s) => {
      if (Math.abs(s.phaseT - 0.2) > DT / 2 || !s.call) return [0, 0];
      return wanted(s.call.kind) === WHITE ? [0, 1] : [1, 0];
    };
    const ev = run(sim, 3, [right(), wrong, none]);
    expect(ev).toContainEqual({ t: 'out', i: 1, wrong: true });
    expect(ev).toContainEqual({ t: 'out', i: 2, wrong: false });
    expect(sim.players[0].alive).toBe(true);
    expect(sim.players[1].outAt).toBe(1);
    expect(sim.over).toBe(true);
    expect(sim.results().winners).toEqual([0]);
  });
  it('needs both flags for BOTH', () => {
    const sim = new FlagsSim(2, mulberry32(1));
    toCall(sim);
    sim.call = { n: 1, kind: 'both', shown: BOTH, limit: 2 };
    const one: Answer = (_i, s) => (Math.abs(s.phaseT - 0.2) < DT / 2 ? [1, 0] : [0, 0]);
    const two: Answer = (_i, s) => (Math.abs(s.phaseT - 0.2) < DT / 2 ? [1, 0] : Math.abs(s.phaseT - 0.4) < DT / 2 ? [0, 1] : [0, 0]);
    run(sim, 2.2, [one, two]);
    expect(sim.players[0].alive).toBe(false);
    expect(sim.players[1].alive).toBe(true);
  });
  it('moves on as soon as everybody has answered', () => {
    const sim = new FlagsSim(2, mulberry32(1));
    toCall(sim);
    run(sim, 0.35, right(0.1));
    expect(sim.phase).toBe('gap');
  });
  it('ignores presses between calls', () => {
    const sim = new FlagsSim(2, mulberry32(1));
    sim.begin();
    run(sim, WAIT_TIME * 0.5, () => [1, 1]);
    run(sim, WAIT_TIME * 0.5 + 0.05);
    expect(sim.players.every((p) => p.alive && p.raised === 0)).toBe(true);
  });
  it('a perfect player lasts until Babcia runs out of calls; a copycat falls for the tricks', () => {
    const sim = new FlagsSim(1, mulberry32(3));
    sim.begin();
    const ev = run(sim, 200, right());
    expect(sim.calls).toBe(MAX_CALLS);
    expect(sim.players[0].alive).toBe(true);
    expect(ev.filter((e) => e.t === 'over')).toHaveLength(1);
    expect(sim.results().points).toEqual([MAX_CALLS]);

    const cat = new FlagsSim(1, mulberry32(3));
    cat.begin();
    run(cat, 200, copycat);
    expect(cat.players[0].alive).toBe(false);
    expect(cat.players[0].outAt).toBeGreaterThanOrEqual(NOT_FROM);
    expect(cat.results().points[0]).toBe(cat.players[0].outAt! - 1);
  });
  it('ties those who fall in on the same call', () => {
    const sim = new FlagsSim(3, mulberry32(5));
    toCall(sim);
    run(sim, GAP_TIME + 8, [none, (i, s) => (s.calls === 1 ? right()(i, s) : [0, 0]), (i, s) => (s.calls === 1 ? right()(i, s) : [0, 0])]);
    expect(sim.over).toBe(true);
    const r = sim.results();
    expect(r.winners).toEqual([1, 2]);
    expect(r.points).toEqual([0, 3, 3]);
  });
});

it('has a three-line how-to', () => {
  expect(howTo(false)).toHaveLength(3);
  expect(howTo(true)[2]).toMatch(/One round/);
});
