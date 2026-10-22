import { describe, expect, it } from 'vitest';
import {
  BELLS,
  BELL_COUNT,
  BellsSim,
  LEAD_MS,
  MAX_LEN,
  RESULT_MS,
  START_LEN,
  growTune,
  howTo,
  lenAt,
  limitMs,
  listenMs,
  litMs,
  makeTune,
  nextNote,
  stepMs,
  type BellsEvent,
} from '../client/src/games/bells/logic';
import { mulberry32 } from '../client/src/games/rng';

/** Run the clock from `from` to `to` in 16 ms steps, collecting events. */
function run(sim: BellsSim, from: number, to: number) {
  const ev: BellsEvent[] = [];
  for (let t = from; t <= to; t += 16) ev.push(...sim.step(t));
  return ev;
}

/** Start a sim at t=0 and play the tune through, so it's waiting for taps. Returns the clock. */
function toRepeat(sim: BellsSim, now = 0) {
  if (sim.phase === 'idle') sim.begin(now);
  const end = now + listenMs(sim.len) + 20;
  run(sim, now, end);
  expect(sim.phase).toBe('repeat');
  return end;
}

/** Player i rings the whole tune right. */
function ringAll(sim: BellsSim, i: number, now: number) {
  for (const b of sim.tune) sim.tap(i, b, sim.key, now);
}

/** End the turn (everyone done, or time out) and wait out the result. Returns the clock. */
function finishTurn(sim: BellsSim, now: number, ev: BellsEvent[] = []) {
  const end = Math.max(now, sim.endsAt) + RESULT_MS + 50;
  ev.push(...run(sim, now, end));
  return end;
}

describe('tunes', () => {
  it('has four bells, biggest and lowest first, all different', () => {
    expect(BELL_COUNT).toBe(4);
    expect(BELLS.map((b) => b.color)).toEqual(['#ff3d6e', '#ffd23f', '#2fd6a8', '#4f9dff']);
    for (let k = 1; k < BELL_COUNT; k++) {
      expect(BELLS[k].freq).toBeGreaterThan(BELLS[k - 1].freq);
      expect(BELLS[k].size).toBeLessThan(BELLS[k - 1].size);
    }
  });
  it('makes tunes of the right length from the four bells, never one bell three times running', () => {
    const rng = mulberry32(5);
    for (let k = 0; k < 200; k++) {
      const t = makeTune(MAX_LEN, rng);
      expect(t).toHaveLength(MAX_LEN);
      t.forEach((b, j) => {
        expect(b).toBeGreaterThanOrEqual(0);
        expect(b).toBeLessThan(BELL_COUNT);
        if (j >= 2) expect(b === t[j - 1] && b === t[j - 2]).toBe(false);
      });
    }
  });
  it('uses every bell', () => {
    const rng = mulberry32(9);
    const seen = new Set<number>();
    for (let k = 0; k < 50; k++) seen.add(nextNote([], rng));
    expect(seen.size).toBe(BELL_COUNT);
  });
  it('grows by one note and keeps the old ones', () => {
    const rng = mulberry32(2);
    const t = makeTune(START_LEN, rng);
    const g = growTune(t, rng);
    expect(g).toHaveLength(START_LEN + 1);
    expect(g.slice(0, START_LEN)).toEqual(t);
  });
  it('starts at 3 notes, plays a little faster each turn and gives more time for longer tunes', () => {
    expect(START_LEN).toBe(3);
    expect(lenAt(1)).toBe(3);
    expect(lenAt(4)).toBe(6);
    expect(lenAt(100)).toBe(MAX_LEN);
    for (let n = START_LEN; n < MAX_LEN; n++) {
      expect(stepMs(n + 1)).toBeLessThanOrEqual(stepMs(n));
      expect(litMs(n)).toBeLessThan(stepMs(n));
    }
    expect(stepMs(START_LEN + 1)).toBeLessThan(stepMs(START_LEN));
    expect(stepMs(MAX_LEN)).toBeGreaterThanOrEqual(300);
    expect(limitMs(5)).toBe(2500 + 800 * 5);
  });
});

describe('a turn', () => {
  it('plays the tune bell by bell, lighting each one, then opens the phones', () => {
    const sim = new BellsSim(2, mulberry32(1));
    const ev = sim.begin(0);
    expect(ev).toEqual([{ t: 'turn', turn: 1, len: 3 }]);
    expect(sim.phase).toBe('listen');
    expect(sim.lit(LEAD_MS - 10)).toBeNull();
    const step = stepMs(3);
    sim.tune.forEach((b, k) => {
      expect(sim.lit(LEAD_MS + k * step + 5)).toBe(b);
      expect(sim.lit(LEAD_MS + k * step + litMs(3) + 5)).toBeNull();
    });
    const all = run(sim, 0, listenMs(3) + 20);
    expect(all.filter((e) => e.t === 'note').map((e) => (e as { bell: number }).bell)).toEqual(sim.tune);
    const rep = all.find((e) => e.t === 'repeat') as { endsAt: number };
    expect(rep).toBeTruthy();
    expect(sim.phase).toBe('repeat');
    expect(sim.lit(listenMs(3) + 30)).toBeNull();
    expect(rep.endsAt - sim.phaseAt).toBe(limitMs(3));
  });

  it('ignores taps while the tune plays', () => {
    const sim = new BellsSim(2, mulberry32(1));
    sim.begin(0);
    expect(sim.tap(0, sim.tune[0], sim.key, LEAD_MS + 10)).toBeNull();
    expect(sim.players[0].pos).toBe(0);
  });

  it('counts the right bells in order, and finishing is a done', () => {
    const sim = new BellsSim(2, mulberry32(3));
    const t = toRepeat(sim);
    const r1 = sim.tap(0, sim.tune[0], sim.key, t + 100);
    expect(r1).toMatchObject({ ok: true, pos: 1, done: false });
    sim.tap(0, sim.tune[1], sim.key, t + 200);
    const r3 = sim.tap(0, sim.tune[2], sim.key, t + 300);
    expect(r3).toMatchObject({ ok: true, pos: 3, done: true });
    expect(sim.players[0]).toMatchObject({ done: true, doneIn: t + 300 - sim.phaseAt, best: 3, alive: true });
  });

  it('puts you out on a wrong bell', () => {
    const sim = new BellsSim(3, mulberry32(3));
    const t = toRepeat(sim);
    sim.tap(1, sim.tune[0], sim.key, t);
    const wrong = (sim.tune[1] + 1) % BELL_COUNT;
    const r = sim.tap(1, wrong, sim.key, t + 50);
    expect(r).toEqual({ i: 1, bell: wrong, ok: false, want: sim.tune[1] });
    expect(sim.players[1]).toMatchObject({ alive: false, outAt: 1, why: 'wrong', pos: 1 });
    // Out is out: more taps change nothing.
    expect(sim.tap(1, sim.tune[1], sim.key, t + 60)).toBeNull();
  });

  it('ignores extra taps after finishing', () => {
    const sim = new BellsSim(2, mulberry32(4));
    const t = toRepeat(sim);
    ringAll(sim, 0, t);
    expect(sim.tap(0, (sim.tune[0] + 1) % BELL_COUNT, sim.key, t + 10)).toBeNull();
    expect(sim.players[0]).toMatchObject({ alive: true, done: true, pos: 3 });
  });

  it('ignores taps with a stale key, and nonsense bells', () => {
    const sim = new BellsSim(2, mulberry32(4), [], 1000);
    const t = toRepeat(sim);
    expect(sim.key).toBe(1002);
    expect(sim.tap(0, sim.tune[0], sim.key - 2, t)).toBeNull();
    expect(sim.tap(0, sim.tune[0], sim.afterKey, t)).toBeNull();
    expect(sim.tap(0, 7, sim.key, t)).toBeNull();
    expect(sim.tap(0, 1.5, sim.key, t)).toBeNull();
    expect(sim.tap(9, 0, sim.key, t)).toBeNull();
    expect(sim.players[0]).toMatchObject({ alive: true, pos: 0 });
  });

  it('gives every turn its own key', () => {
    const sim = new BellsSim(2, mulberry32(4), [], 2000);
    const keys = new Set<number>();
    let t = toRepeat(sim);
    for (let turn = 1; turn <= 4; turn++) {
      keys.add(sim.key);
      keys.add(sim.afterKey);
      ringAll(sim, 0, t);
      ringAll(sim, 1, t);
      t = finishTurn(sim, t);
      t = toRepeat(sim, t);
    }
    expect(keys.size).toBe(8);
  });

  it('ends early once everybody still in has finished', () => {
    const sim = new BellsSim(3, mulberry32(6));
    const t = toRepeat(sim);
    ringAll(sim, 0, t);
    sim.tap(1, (sim.tune[0] + 1) % BELL_COUNT, sim.key, t);
    expect(sim.step(t + 16)).toEqual([]);
    ringAll(sim, 2, t + 20);
    const ev = sim.step(t + 32);
    expect(ev).toEqual([{ t: 'resolve', turn: 1, out: [1], safe: [0, 2] }]);
    expect(sim.phase).toBe('result');
  });

  it('runs out of time: whoever hasn’t finished is out', () => {
    const sim = new BellsSim(3, mulberry32(6));
    const t = toRepeat(sim);
    ringAll(sim, 0, t);
    sim.tap(1, sim.tune[0], sim.key, t);
    const ev = run(sim, t, sim.endsAt - 20);
    expect(ev).toEqual([]);
    const ev2 = run(sim, sim.endsAt - 4, sim.endsAt + 20);
    expect(ev2).toEqual([
      { t: 'out', i: 1, why: 'time' },
      { t: 'out', i: 2, why: 'time' },
      { t: 'resolve', turn: 1, out: [1, 2], safe: [0] },
    ]);
    expect(sim.players[1]).toMatchObject({ alive: false, why: 'time', outAt: 1 });
    // A late tap after the bell is ignored.
    expect(sim.tap(2, sim.tune[0], sim.key, sim.endsAt + 30)).toBeNull();
  });

  it('grows the tune by one note next turn, and survivors start again from the first note', () => {
    const sim = new BellsSim(3, mulberry32(8));
    let t = toRepeat(sim);
    const first = [...sim.tune];
    ringAll(sim, 0, t);
    ringAll(sim, 1, t);
    ringAll(sim, 2, t);
    const ev: BellsEvent[] = [];
    t = finishTurn(sim, t, ev);
    expect(ev).toContainEqual({ t: 'turn', turn: 2, len: 4 });
    expect(sim.tune.slice(0, 3)).toEqual(first);
    expect(sim.len).toBe(4);
    expect(sim.players.every((p) => p.pos === 0 && !p.done && p.alive)).toBe(true);
  });
});

describe('a round', () => {
  it('last one standing wins', () => {
    const sim = new BellsSim(3, mulberry32(11));
    let t = toRepeat(sim);
    // Turn 1: player 2 goes wrong.
    ringAll(sim, 0, t);
    ringAll(sim, 1, t);
    sim.tap(2, (sim.tune[0] + 1) % BELL_COUNT, sim.key, t);
    t = finishTurn(sim, t);
    t = toRepeat(sim, t);
    // Turn 2: player 1 is too slow.
    ringAll(sim, 0, t);
    const ev: BellsEvent[] = [];
    t = finishTurn(sim, t, ev);
    expect(ev.at(-1)).toEqual({ t: 'over' });
    expect(sim.over).toBe(true);
    const r = sim.results();
    expect(r.winners).toEqual([0]);
    // One point per player out before you, +2 for the last one standing.
    expect(r.points).toEqual([4, 1, 0]);
    expect(r.best).toBe(4);
  });

  it('waits for the result before calling the round over', () => {
    const sim = new BellsSim(2, mulberry32(11));
    const t = toRepeat(sim);
    ringAll(sim, 0, t);
    sim.tap(1, (sim.tune[0] + 1) % BELL_COUNT, sim.key, t);
    expect(sim.step(t + 16).map((e) => e.t)).toEqual(['resolve']);
    expect(run(sim, t + 32, t + RESULT_MS - 50)).toEqual([]);
    expect(run(sim, t + RESULT_MS - 30, t + RESULT_MS + 50)).toEqual([{ t: 'over' }]);
    expect(sim.phase).toBe('done');
  });

  it('everybody left going out on the same turn is a tie at that turn', () => {
    const sim = new BellsSim(4, mulberry32(12));
    let t = toRepeat(sim);
    ringAll(sim, 0, t);
    ringAll(sim, 1, t);
    ringAll(sim, 2, t);
    t = finishTurn(sim, t); // player 3 timed out on turn 1
    t = toRepeat(sim, t);
    sim.tap(0, (sim.tune[0] + 1) % BELL_COUNT, sim.key, t);
    sim.tap(1, (sim.tune[0] + 2) % BELL_COUNT, sim.key, t);
    const ev: BellsEvent[] = [];
    finishTurn(sim, t, ev); // player 2 never taps
    expect(ev).toContainEqual({ t: 'resolve', turn: 2, out: [0, 1, 2], safe: [] });
    expect(ev.at(-1)).toEqual({ t: 'over' });
    const r = sim.results();
    expect(r.winners).toEqual([0, 1, 2]);
    expect(r.points).toEqual([3, 3, 3, 0]);
    expect(sim.players.map((p) => p.outAt)).toEqual([2, 2, 2, 1]);
  });

  it('goes on while two or more are standing, and caps the tune at 25 notes (survivors share the win)', () => {
    const sim = new BellsSim(2, mulberry32(13));
    let t = toRepeat(sim);
    const ev: BellsEvent[] = [];
    let turns = 0;
    while (!sim.over && turns < 40) {
      turns++;
      ringAll(sim, 0, t);
      ringAll(sim, 1, t);
      t = finishTurn(sim, t, ev);
      if (!sim.over) t = toRepeat(sim, t);
    }
    expect(sim.over).toBe(true);
    expect(sim.len).toBe(MAX_LEN);
    expect(turns).toBe(MAX_LEN - START_LEN + 1);
    const r = sim.results();
    expect(r.winners).toEqual([0, 1]);
    expect(r.points).toEqual([2, 2]);
    expect(r.best).toBe(MAX_LEN);
  });

  it('solo: plays on until you go out, and scores the longest tune you rang back', () => {
    const sim = new BellsSim(1, mulberry32(14));
    expect(sim.solo).toBe(true);
    let t = toRepeat(sim);
    for (let k = 0; k < 3; k++) {
      ringAll(sim, 0, t);
      t = finishTurn(sim, t);
      expect(sim.over).toBe(false);
      t = toRepeat(sim, t);
    }
    expect(sim.len).toBe(6);
    sim.tap(0, (sim.tune[0] + 1) % BELL_COUNT, sim.key, t);
    const ev: BellsEvent[] = [];
    finishTurn(sim, t, ev);
    expect(ev.at(-1)).toEqual({ t: 'over' });
    const r = sim.results();
    expect(r.points).toEqual([5]);
    expect(r.winners).toEqual([]);
    expect(r.best).toBe(5);
  });

  it('solo: out on the first tune scores nothing', () => {
    const sim = new BellsSim(1, mulberry32(15));
    const t = toRepeat(sim);
    finishTurn(sim, t);
    expect(sim.over).toBe(true);
    expect(sim.results().points).toEqual([0]);
  });

  it('a group of two is not solo, even if one leaves', () => {
    const sim = new BellsSim(2, mulberry32(15));
    expect(sim.solo).toBe(false);
    expect(new BellsSim(3, mulberry32(1), [false, true, true]).solo).toBe(true);
  });
});

describe('removal', () => {
  it('a player who leaves mid-turn doesn’t hold it up', () => {
    const sim = new BellsSim(3, mulberry32(16));
    const t = toRepeat(sim);
    ringAll(sim, 0, t);
    ringAll(sim, 1, t);
    sim.remove(2);
    const ev = sim.step(t + 16);
    expect(ev).toEqual([{ t: 'resolve', turn: 1, out: [], safe: [0, 1] }]);
    expect(sim.tap(2, sim.tune[0], sim.key, t + 20)).toBeNull();
  });

  it('leaving the last rival ends the round with a win for whoever is left', () => {
    const sim = new BellsSim(2, mulberry32(17));
    const t = toRepeat(sim);
    ringAll(sim, 0, t);
    sim.remove(1);
    const ev: BellsEvent[] = [];
    finishTurn(sim, t, ev);
    expect(ev.at(-1)).toEqual({ t: 'over' });
    const r = sim.results();
    expect(r.winners).toEqual([0]);
    expect(r.points).toEqual([2, 0]);
  });

  it('players gone before the round are left out of it', () => {
    const sim = new BellsSim(3, mulberry32(18), [false, true, false]);
    expect(sim.players[1]).toMatchObject({ gone: true, alive: false });
    const t = toRepeat(sim);
    ringAll(sim, 0, t);
    ringAll(sim, 2, t);
    expect(sim.step(t + 16)[0]).toEqual({ t: 'resolve', turn: 1, out: [], safe: [0, 2] });
    expect(sim.results().points[1]).toBe(0);
  });
});

describe('howTo', () => {
  it('is three short lines', () => {
    for (const short of [false, true]) {
      const h = howTo(short);
      expect(h).toHaveLength(3);
      h.forEach((l) => expect(l.length).toBeLessThan(60));
    }
    expect(howTo(true)[2]).toMatch(/One round/);
    expect(howTo(false)[2]).toMatch(/Two rounds/);
  });
});
