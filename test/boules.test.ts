import { describe, expect, it } from 'vitest';
import {
  AUTO_POWER,
  BALL_FRICTION,
  BALL_R,
  BALLS_EACH,
  BALLS_SOLO,
  DT,
  JACK_MAX,
  JACK_MIN,
  JACK_R,
  JACK_SIDE,
  MAX_AIM,
  METER_PERIOD,
  OFFLINE_WAIT,
  PAUSE_TIME,
  PITCH_L,
  RELEASE_Z,
  TURN_TIME,
  BoulesSim,
  aimAt,
  aimStep,
  gapCm,
  howTo,
  landingPoint,
  makeBody,
  meterPower,
  physicsStep,
  powerFor,
  rollDistance,
  scoreEnd,
  throwDistance,
  throwOrder,
  type BoulesEvent,
  type BoulesInput,
} from '../client/src/games/boules/logic';
import { mulberry32 } from '../client/src/games/rng';

const idle = (live = true): BoulesInput => ({ x: 0, held: false, presses: 0, live });

/** Run the sim; `input(i, sim)` gives player i's pad this step. */
function run(sim: BoulesSim, seconds: number, input: (i: number, sim: BoulesSim) => BoulesInput = () => idle()) {
  const all: BoulesEvent[] = [];
  for (let k = 0; k < Math.round(seconds / DT); k++) all.push(...sim.step(Array.from({ length: sim.players }, (_, i) => input(i, sim))));
  return all;
}

/** Simulate bodies until they all stop. */
function settle(bodies: ReturnType<typeof makeBody>[], seconds = 20) {
  const ev: BoulesEvent[] = [];
  for (let k = 0; k < Math.round(seconds / DT) * 3; k++) physicsStep(bodies, DT / 3, ev);
  return ev;
}

/** Run until the current throw has come to rest. */
function untilSettled(sim: BoulesSim) {
  const ev: BoulesEvent[] = [];
  for (let k = 0; k < 60 * 30 && sim.phase === 'flight'; k++) ev.push(...sim.step(Array.from({ length: sim.players }, () => idle())));
  return ev;
}

describe('physics', () => {
  it('friction stops a rolling ball where the formula says', () => {
    const b = makeBody(0, 0, 0, 0);
    b.vz = -4;
    settle([b]);
    expect(b.vx).toBe(0);
    expect(b.vz).toBe(0);
    expect(-b.z).toBeCloseTo(rollDistance(4, BALL_FRICTION), 1);
  });
  it('a head-on hit passes the speed on and roughly conserves momentum', () => {
    const a = makeBody(0, 0, 0, 0);
    const b = makeBody(1, 0, 0, -1);
    a.vz = -3;
    // No friction, so only the collision changes the momentum.
    a.fr = b.fr = 0;
    const before = a.vz * a.m + b.vz * b.m;
    const ev: BoulesEvent[] = [];
    // Step until just after the collision.
    for (let k = 0; k < 600 && !ev.some((e) => e.t === 'hit'); k++) physicsStep([a, b], DT / 3, ev);
    const after = a.vz * a.m + b.vz * b.m;
    expect(Math.abs(after - before)).toBeLessThan(0.1);
    expect(b.vz).toBeLessThan(a.vz);
    expect(b.vz).toBeLessThan(-2);
    expect(ev.some((e) => e.t === 'hit' && !e.jack)).toBe(true);
  });
  it('a ball can knock the jack away', () => {
    const jack = makeBody(-1, 0, 0, -5);
    const ball = makeBody(0, 0, 0.05, -2);
    ball.vz = -4;
    const ev = settle([jack, ball]);
    expect(ev.some((e) => e.t === 'hit' && e.jack)).toBe(true);
    expect(jack.z).toBeLessThan(-5.3);
    expect(jack.alive).toBe(true);
  });
  it('bounces off the side boards and stays on the pitch', () => {
    const b = makeBody(0, 0, 0, -3);
    b.vx = 5;
    b.vz = -0.5;
    const ev = settle([b]);
    expect(ev.some((e) => e.t === 'board')).toBe(true);
    expect(b.alive).toBe(true);
    expect(b.x).toBeLessThan(2.2);
  });
  it('a ball that reaches the far board is dead, the jack bounces back', () => {
    const b = makeBody(0, 0, 0, -12);
    b.vz = -8;
    const jack = makeBody(-1, 0, 1, -13);
    jack.vz = -8;
    const ev = settle([jack, b]);
    expect(b.alive).toBe(false);
    expect(b.out).toBe('dead');
    expect(ev.some((e) => e.t === 'dead' && e.b === 1)).toBe(true);
    expect(jack.alive).toBe(true);
    expect(jack.z).toBeGreaterThan(-PITCH_L);
  });
  it('balls in the air fly over others and land', () => {
    const a = makeBody(0, 0, 0, 0);
    a.air = 0.5;
    a.y = 1;
    a.vz = -4;
    a.rollV = 0;
    const b = makeBody(1, 0, 0, -1);
    const ev = settle([a, b], 2);
    expect(ev.filter((e) => e.t === 'land')).toHaveLength(1);
    expect(a.z).toBeCloseTo(-2, 1);
    expect(b.z).toBe(-1);
  });
});

describe('aiming and power', () => {
  it('the meter goes up and back down', () => {
    expect(meterPower(0)).toBe(0);
    expect(meterPower(METER_PERIOD / 2)).toBeCloseTo(1);
    expect(meterPower(METER_PERIOD / 4)).toBeCloseTo(0.5);
    expect(meterPower(METER_PERIOD)).toBeCloseTo(0);
  });
  it('power maps to distance and back', () => {
    expect(throwDistance(0)).toBeLessThan(3);
    expect(throwDistance(1)).toBeGreaterThan(PITCH_L);
    for (const d of [4, 8, 12]) expect(throwDistance(powerFor(d))).toBeCloseTo(d);
    expect(landingPoint(0, 0.5).z).toBeLessThan(RELEASE_Z);
  });
  it('the stick swings the aim, within limits', () => {
    expect(aimStep(0, 1, 1)).toBeGreaterThan(0);
    expect(aimStep(0, -1, 1)).toBeLessThan(0);
    expect(aimStep(0, 1, 100)).toBe(MAX_AIM);
    expect(aimStep(0, -1, 100)).toBe(-MAX_AIM);
    expect(aimAt(0, -8)).toBeCloseTo(0);
    expect(aimAt(1, -8)).toBeGreaterThan(0);
  });
  it('a clean throw stops about where its power says', () => {
    const sim = new BoulesSim(1, 0, mulberry32(1));
    sim.begin();
    sim.jack.z = -14.5; // out of the way
    sim.jack.x = 2;
    sim.aim = 0;
    sim.throwBall(0, powerFor(8), false);
    untilSettled(sim);
    expect(-sim.balls[0].z).toBeCloseTo(8 - RELEASE_Z, 1);
    expect(Math.abs(sim.balls[0].x)).toBeLessThan(0.01);
  });
  it('holding and letting go throws with the meter power', () => {
    const sim = new BoulesSim(1, 0, mulberry32(2));
    sim.begin();
    let k = 0;
    const holdFor = Math.round((METER_PERIOD / 4) / DT);
    const ev = run(sim, 2, () => {
      k++;
      return { x: 0, held: k <= holdFor + 1, presses: k === 1 ? 1 : 0, live: true };
    });
    const t = ev.find((e) => e.t === 'throw');
    expect(t).toBeDefined();
    if (t?.t === 'throw') {
      expect(t.auto).toBe(false);
      expect(t.power).toBeGreaterThan(0.4);
      expect(t.power).toBeLessThan(0.6);
    }
  });
  it('a button held from before the turn does not charge', () => {
    const sim = new BoulesSim(1, 0, mulberry32(2));
    sim.begin();
    run(sim, 1, () => ({ x: 0, held: true, presses: 0, live: true }));
    expect(sim.charging).toBe(false);
    expect(sim.phase).toBe('aim');
  });
});

describe('an end', () => {
  it('puts the jack down the pitch with a little side offset', () => {
    for (let s = 1; s < 40; s++) {
      const sim = new BoulesSim(2, 0, mulberry32(s));
      expect(-sim.jack.z).toBeGreaterThanOrEqual(JACK_MIN);
      expect(-sim.jack.z).toBeLessThanOrEqual(JACK_MAX);
      expect(Math.abs(sim.jack.x)).toBeLessThanOrEqual(JACK_SIDE);
    }
  });
  it('everybody throws their first ball, then their second; the order rotates every end', () => {
    expect(throwOrder([0, 1, 2], 0, 2).map((t) => t.i)).toEqual([0, 1, 2, 0, 1, 2]);
    expect(throwOrder([0, 1, 2], 1, 2).map((t) => t.i)).toEqual([1, 2, 0, 1, 2, 0]);
    expect(throwOrder([0, 1, 2], 2, 2).map((t) => t.i)).toEqual([2, 0, 1, 2, 0, 1]);
    expect(throwOrder([0, 2], 1, 2).map((t) => t.i)).toEqual([2, 0, 2, 0]);
    expect(throwOrder([0, 1], 0, 2).map((t) => t.k)).toEqual([0, 0, 1, 1]);
    expect(new BoulesSim(3, 0).ballsEach).toBe(BALLS_EACH);
    expect(new BoulesSim(1, 0).ballsEach).toBe(BALLS_SOLO);
  });
  it('a turn that runs out throws a weak ball by itself, and the end plays to the last ball', () => {
    const sim = new BoulesSim(2, 0, mulberry32(4));
    const ev = [...sim.begin(), ...run(sim, 4 * (TURN_TIME + 8))];
    const throws = ev.filter((e) => e.t === 'throw');
    expect(throws).toHaveLength(4);
    throws.forEach((t) => t.t === 'throw' && expect(t).toMatchObject({ auto: true, power: AUTO_POWER }));
    expect(throws.map((t) => (t.t === 'throw' ? t.i : -1))).toEqual([0, 1, 0, 1]);
    expect(ev.filter((e) => e.t === 'over')).toHaveLength(1);
    expect(sim.phase).toBe('done');
    expect(sim.balls).toHaveLength(4);
  });
  it('waits for a full turn before the auto throw', () => {
    const sim = new BoulesSim(2, 0, mulberry32(4));
    sim.begin();
    run(sim, TURN_TIME - 0.2);
    expect(sim.phase).toBe('aim');
    run(sim, 0.4);
    expect(sim.phase).toBe('flight');
  });
  it('an offline thrower throws by themselves sooner', () => {
    const sim = new BoulesSim(2, 0, mulberry32(4));
    sim.begin();
    const ev = run(sim, OFFLINE_WAIT + 0.1, (i) => idle(i !== 0));
    expect(ev.find((e) => e.t === 'throw')).toMatchObject({ i: 0, auto: true });
  });
  it('pauses after the balls settle, then the next player is up', () => {
    const sim = new BoulesSim(2, 0, mulberry32(4));
    sim.begin();
    sim.throwBall(0, 0.3, false);
    const ev = untilSettled(sim);
    expect(ev.some((e) => e.t === 'settled')).toBe(true);
    expect(sim.phase).toBe('pause');
    const ev2 = run(sim, PAUSE_TIME + 0.05);
    expect(ev2).toContainEqual({ t: 'turn', i: 1, k: 0 });
    expect(sim.ballsLeft(0)).toBe(1);
    expect(sim.ballsLeft(1)).toBe(2);
    expect(sim.turnsUntil(0)).toBe(1);
  });
  it('skips to the next player when the thrower leaves mid-turn, and takes their balls off', () => {
    const sim = new BoulesSim(3, 0, mulberry32(4));
    sim.begin();
    sim.throwBall(0, 0.3, false);
    untilSettled(sim);
    run(sim, PAUSE_TIME + 0.05);
    expect(sim.thrower).toBe(1);
    const ev = sim.remove(1);
    expect(ev).toContainEqual({ t: 'turn', i: 2, k: 0 });
    expect(sim.thrower).toBe(2);
    expect(sim.order.filter((t) => t.i === 1).length).toBe(2);
    sim.remove(0);
    expect(sim.balls[0].alive).toBe(false);
    expect(sim.balls[0].out).toBe('gone');
    expect(sim.thrower).toBe(2);
    // Player 2 throws both balls; nobody else is left.
    const left = run(sim, 2 * (TURN_TIME + 10));
    expect(left.filter((e) => e.t === 'throw').every((e) => e.t === 'throw' && e.i === 2)).toBe(true);
    expect(sim.phase).toBe('done');
    expect(sim.results().points).toEqual([0, 0, sim.results().points[2]]);
  });
  it('ends at once when the last thrower leaves', () => {
    const sim = new BoulesSim(1, 0, mulberry32(4));
    sim.begin();
    expect(sim.remove(0)).toContainEqual({ t: 'over' });
    expect(sim.phase).toBe('done');
  });
});

describe('scoring', () => {
  it('measures edge to edge in centimetres', () => {
    const jack = makeBody(-1, 0, 0, -8);
    const ball = makeBody(0, 0, 0, -8 + BALL_R + JACK_R + 0.25);
    expect(gapCm(ball, jack)).toBe(25);
    expect(gapCm(makeBody(0, 0, 0, -8 + 0.1), jack)).toBe(0);
  });
  it('the three closest balls score 3, 2 and 1 – one player can score more than once', () => {
    const r = scoreEnd(
      [
        { b: 0, owner: 0, cm: 40 },
        { b: 1, owner: 1, cm: 12 },
        { b: 2, owner: 0, cm: 20 },
        { b: 3, owner: 1, cm: 90 },
      ],
      2,
      false,
    );
    expect(r.ranked.map((x) => x.b)).toEqual([1, 2, 0, 3]);
    expect(r.ranked.map((x) => x.pts)).toEqual([3, 2, 1, 0]);
    expect(r.points).toEqual([3, 3]);
  });
  it('balls at the same distance share the better place', () => {
    const r = scoreEnd(
      [
        { b: 0, owner: 0, cm: 15 },
        { b: 1, owner: 1, cm: 15 },
        { b: 2, owner: 2, cm: 30 },
        { b: 3, owner: 2, cm: 31 },
      ],
      3,
      false,
    );
    expect(r.ranked.map((x) => x.place)).toEqual([1, 1, 3, 4]);
    expect(r.points).toEqual([3, 3, 1]);
  });
  it('solo balls score by distance bands', () => {
    const r = scoreEnd(
      [
        { b: 0, owner: 0, cm: 10 },
        { b: 1, owner: 0, cm: 79 },
        { b: 2, owner: 0, cm: 400 },
      ],
      1,
      true,
    );
    expect(r.ranked.map((x) => x.pts)).toEqual([3, 2, 0]);
    expect(r.points).toEqual([5]);
  });
  it('dead balls and balls of players who left do not count', () => {
    const sim = new BoulesSim(2, 0, mulberry32(9));
    sim.begin();
    // Out of the way of a ball thrown past the far board.
    sim.jack.x = 2;
    sim.aim = 0;
    sim.throwBall(0, 1, false);
    untilSettled(sim);
    expect(sim.balls[0].alive).toBe(false);
    sim.jack.x = sim.jackStart.x;
    run(sim, PAUSE_TIME + 0.05);
    sim.aim = aimAt(sim.jack.x, sim.jack.z);
    sim.throwBall(1, powerFor(-sim.jack.z + RELEASE_Z), false);
    untilSettled(sim);
    const r = sim.results();
    expect(r.ranked.map((x) => x.owner)).toEqual([1]);
    expect(r.points).toEqual([0, 3]);
  });
});

it('has a three-line how-to', () => {
  expect(howTo(false)).toHaveLength(3);
  expect(howTo(true)).toHaveLength(3);
  expect(howTo(true)[2]).toMatch(/One end/);
});
