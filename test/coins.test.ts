import { describe, expect, it } from 'vitest';
import {
  BUMP_DROP,
  CATCH_H,
  COIN_LIFE,
  COIN_R,
  COIN_VALUE,
  CoinsSim,
  DASH_CD,
  DT,
  FALL_T,
  GOLDEN_RATE,
  GOLDEN_S,
  HAZARD_FROM,
  HAZARD_R,
  HAZARD_T,
  INVULN,
  MAX_SPILL,
  PLAYER_R,
  ROUND_S,
  SPILL_T,
  STUN,
  coinFactor,
  coinKind,
  coinRate,
  fallHeight,
  hazardRate,
  howTo,
  lossFor,
  spillPieces,
  type CoinsEvent,
  type CoinsInput,
} from '../client/src/games/coins/logic';
import { mulberry32 } from '../client/src/games/rng';

/** Run the sim for `seconds`; `input(i, sim)` is player i's pad. */
function run(sim: CoinsSim, seconds: number, input: (i: number, sim: CoinsSim) => CoinsInput | undefined = () => undefined) {
  const all: CoinsEvent[] = [];
  for (let k = 0; k < Math.round(seconds / DT) && !sim.done; k++) all.push(...sim.step(sim.players.map((_, i) => input(i, sim))));
  return all;
}

/** A sim with nothing falling from the sky, for testing one thing at a time. */
function quiet(n: number, seed = 1) {
  const sim = new CoinsSim(n, { rng: mulberry32(seed), length: 1000 });
  // Keep the schedule from ever owing anything.
  const step = sim.step.bind(sim);
  sim.step = (inputs) => {
    sim.coinAcc = -1e9;
    sim.hazardAcc = -1e9;
    return step(inputs);
  };
  return sim;
}

const total = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

describe('the spawn schedule', () => {
  it('ramps up through the round, then jumps for the golden rain', () => {
    const n = 4;
    for (let t = 0; t < ROUND_S - GOLDEN_S - 0.1; t += 0.5) expect(coinRate(t + 0.5, ROUND_S, n)).toBeGreaterThanOrEqual(coinRate(t, ROUND_S, n));
    expect(coinRate(ROUND_S - GOLDEN_S, ROUND_S, n)).toBe(GOLDEN_RATE * coinFactor(n));
    expect(coinRate(ROUND_S - GOLDEN_S, ROUND_S, n)).toBeGreaterThan(coinRate(ROUND_S - GOLDEN_S - 0.01, ROUND_S, n) * 1.5);
  });
  it('rains more coins with more players', () => {
    expect(coinRate(10, ROUND_S, 8)).toBeGreaterThan(coinRate(10, ROUND_S, 4));
    expect(coinRate(10, ROUND_S, 4)).toBeGreaterThan(coinRate(10, ROUND_S, 1));
  });
  it('throws no pots at first, then more and more, and most in the golden rain', () => {
    expect(hazardRate(0, ROUND_S, 4)).toBe(0);
    expect(hazardRate(HAZARD_FROM - 0.01, ROUND_S, 4)).toBe(0);
    expect(hazardRate(HAZARD_FROM, ROUND_S, 4)).toBeGreaterThan(0);
    expect(hazardRate(30, ROUND_S, 4)).toBeGreaterThan(hazardRate(10, ROUND_S, 4));
    expect(hazardRate(ROUND_S - 5, ROUND_S, 4)).toBeGreaterThan(hazardRate(ROUND_S - GOLDEN_S - 0.01, ROUND_S, 4));
  });
  it('makes gold rare, except in the golden rain', () => {
    const count = (golden: boolean) => {
      const rng = mulberry32(7);
      const c = { copper: 0, silver: 0, gold: 0 };
      for (let k = 0; k < 5000; k++) c[coinKind(golden, rng())]++;
      return c;
    };
    const normal = count(false);
    const golden = count(true);
    expect(normal.gold / 5000).toBeLessThan(0.07);
    expect(normal.copper).toBeGreaterThan(normal.silver);
    expect(normal.silver).toBeGreaterThan(normal.gold);
    expect(golden.gold / 5000).toBeGreaterThan(0.12);
    expect(golden.gold).toBeGreaterThan(normal.gold * 3);
  });
  it('drops about as many coins as the rates add up to, and announces the golden rain once', () => {
    const sim = new CoinsSim(4, { rng: mulberry32(3) });
    const ev = run(sim, ROUND_S + 1);
    const spawns = ev.filter((e) => e.t === 'spawn').length;
    let expected = 0;
    for (let t = DT; t <= ROUND_S + 1e-9; t += DT) expected += coinRate(t, ROUND_S, 4) * DT;
    expect(Math.abs(spawns - expected)).toBeLessThanOrEqual(2);
    expect(ev.filter((e) => e.t === 'golden')).toHaveLength(1);
    const goldenAt = ev.findIndex((e) => e.t === 'golden');
    const before = ev.slice(0, goldenAt).filter((e) => e.t === 'spawn').length;
    const after = ev.slice(goldenAt).filter((e) => e.t === 'spawn').length;
    // 10 s of golden rain bring more coins per second than the 35 s before.
    expect(after / GOLDEN_S).toBeGreaterThan((before / (ROUND_S - GOLDEN_S)) * 1.5);
    expect(ev.filter((e) => e.t === 'throw' && ev.indexOf(e) < 0)).toHaveLength(0);
  });
  it('throws the first pot only after HAZARD_FROM, sometimes aimed at a player', () => {
    const sim = new CoinsSim(3, { rng: mulberry32(9) });
    let firstThrow = -1;
    let aimed = 0;
    for (let k = 0; k < Math.round(ROUND_S / DT) && !sim.done; k++) {
      const ev = sim.step([]);
      for (const e of ev)
        if (e.t === 'throw') {
          if (firstThrow < 0) firstThrow = sim.time;
          if (sim.hazards.find((h) => h.id === e.id)!.aim >= 0) aimed++;
        }
    }
    expect(firstThrow).toBeGreaterThanOrEqual(HAZARD_FROM);
    expect(aimed).toBeGreaterThan(0);
  });
  it('keeps every coin and pot inside the square', () => {
    const sim = new CoinsSim(6, { rng: mulberry32(11) });
    for (let k = 0; k < Math.round(ROUND_S / DT) && !sim.done; k++) {
      sim.step([]);
      for (const c of sim.coins) {
        expect(Math.abs(c.x)).toBeLessThanOrEqual(sim.hw);
        expect(Math.abs(c.z)).toBeLessThanOrEqual(sim.hd);
      }
      for (const h of sim.hazards) {
        expect(Math.abs(h.tx)).toBeLessThanOrEqual(sim.hw);
        expect(Math.abs(h.tz)).toBeLessThanOrEqual(sim.hd);
      }
    }
  });
});

describe('coins', () => {
  it('fall faster and faster from the sky, and land after FALL_T', () => {
    expect(fallHeight(0)).toBeGreaterThan(10);
    expect(fallHeight(FALL_T)).toBe(0);
    expect(fallHeight(FALL_T * 0.25) - fallHeight(FALL_T * 0.5)).toBeLessThan(fallHeight(FALL_T * 0.5) - fallHeight(FALL_T * 0.75));
    const sim = quiet(1);
    sim.players[0].x = 8;
    const c = sim.addCoin('copper', -8, 0, 'fall');
    const ev = run(sim, FALL_T + 0.05);
    expect(ev.find((e) => e.t === 'land' && e.id === c.id)).toBeTruthy();
    expect(c.state).toBe('ground');
  });
  it('are worth 1, 2 and 5', () => {
    for (const kind of ['copper', 'silver', 'gold'] as const) {
      const sim = quiet(1);
      sim.players[0].x = sim.players[0].z = 0;
      sim.addCoin(kind, 0.2, 0);
      const ev = run(sim, DT);
      expect(ev.find((e) => e.t === 'pick')).toMatchObject({ p: 0, value: COIN_VALUE[kind] });
      expect(sim.players[0].coins).toBe(COIN_VALUE[kind]);
    }
    expect(COIN_VALUE).toEqual({ copper: 1, silver: 2, gold: 5 });
  });
  it('are picked up within PLAYER_R + the coin’s size, not further', () => {
    for (const kind of ['copper', 'gold'] as const) {
      const reach = PLAYER_R + COIN_R[kind];
      const near = quiet(1);
      near.players[0].x = near.players[0].z = 0;
      near.addCoin(kind, reach - 0.02, 0);
      run(near, DT);
      expect(near.players[0].coins).toBe(COIN_VALUE[kind]);
      const far = quiet(1);
      far.players[0].x = far.players[0].z = 0;
      far.addCoin(kind, reach + 0.02, 0);
      run(far, DT);
      expect(far.players[0].coins).toBe(0);
    }
    // A big gold coin is easier to grab than a grosz.
    expect(COIN_R.gold).toBeGreaterThan(COIN_R.copper);
  });
  it('can be caught just before they land, but not high up', () => {
    const sim = quiet(1);
    sim.players[0].x = sim.players[0].z = 0;
    const c = sim.addCoin('silver', 0, 0, 'fall');
    let pickedAt = -1;
    for (let k = 0; k < Math.round(FALL_T / DT) + 2 && pickedAt < 0; k++) {
      const ev = sim.step([]);
      const pick = ev.find((e) => e.t === 'pick');
      if (pick && pick.t === 'pick') {
        expect(pick.caught).toBe(true);
        pickedAt = c.t;
      }
    }
    expect(pickedAt).toBeGreaterThan(0);
    expect(pickedAt).toBeLessThan(FALL_T);
    expect(fallHeight(pickedAt)).toBeLessThanOrEqual(CATCH_H);
    expect(fallHeight(pickedAt - DT)).toBeGreaterThan(CATCH_H);
  });
  it('go to the nearest player when two can reach', () => {
    const sim = quiet(2);
    sim.players[0].x = -0.5;
    sim.players[1].x = 0.9;
    sim.players[0].z = sim.players[1].z = 0;
    sim.addCoin('gold', -0.1, 0);
    run(sim, DT);
    expect(sim.players[0].coins).toBe(5);
    expect(sim.players[1].coins).toBe(0);
  });
  it('lie for COIN_LIFE seconds, then expire', () => {
    const sim = quiet(1);
    sim.players[0].x = 9;
    const c = sim.addCoin('copper', -9, 0);
    let ev = run(sim, COIN_LIFE - 0.1);
    expect(sim.coins).toContain(c);
    expect(ev.find((e) => e.t === 'expire')).toBeUndefined();
    ev = run(sim, 0.2);
    expect(sim.coins).not.toContain(c);
    expect(ev.find((e) => e.t === 'expire')).toMatchObject({ id: c.id });
  });
  it('can’t be picked up by a stunned player', () => {
    const sim = quiet(1);
    sim.players[0].x = sim.players[0].z = 0;
    sim.bonk(0);
    sim.addCoin('gold', 0, 0);
    run(sim, STUN - 0.1);
    expect(sim.players[0].coins).toBe(0);
    run(sim, 0.2);
    expect(sim.players[0].coins).toBe(5);
  });
});

describe('pots and pans', () => {
  it('knock 30 % of your coins out, rounded up, never more than you have', () => {
    expect(lossFor(0)).toBe(0);
    expect(lossFor(-3)).toBe(0);
    expect(lossFor(1)).toBe(1);
    expect(lossFor(2)).toBe(1);
    expect(lossFor(3)).toBe(1);
    expect(lossFor(4)).toBe(2);
    expect(lossFor(10)).toBe(3);
    expect(lossFor(11)).toBe(4);
    expect(lossFor(20)).toBe(6);
    expect(lossFor(100)).toBe(30);
    for (let c = 0; c < 300; c++) {
      expect(lossFor(c)).toBeLessThanOrEqual(c);
      expect(lossFor(c)).toBeGreaterThanOrEqual(0);
    }
  });
  it('spill coins that add up to what was lost, in at most MAX_SPILL pieces when they can', () => {
    for (let n = 0; n < 120; n++) {
      const p = spillPieces(n);
      expect(total(p)).toBe(n);
      expect(p.length).toBeLessThanOrEqual(Math.max(MAX_SPILL, Math.floor(n / 5) + 2));
      for (const v of p) expect([1, 2, 5]).toContain(v);
    }
    expect(spillPieces(3)).toEqual([1, 1, 1]);
  });
  it('smash after HAZARD_T and stun whoever is under them, spilling their coins round them', () => {
    const sim = quiet(2);
    const a = sim.players[0];
    const b = sim.players[1];
    a.x = 0;
    a.z = 0;
    a.coins = 10;
    b.x = 6;
    b.z = 0;
    b.coins = 10;
    sim.addHazard('pot', 0.3, 0);
    let ev = run(sim, HAZARD_T - 0.05);
    expect(ev.find((e) => e.t === 'smash')).toBeUndefined();
    ev = run(sim, 0.1);
    expect(ev.find((e) => e.t === 'smash')).toMatchObject({ hits: [0] });
    expect(ev.find((e) => e.t === 'hit')).toMatchObject({ p: 0, lost: 3 });
    expect(a.coins).toBe(7);
    expect(a.stun).toBeGreaterThan(STUN - 0.1);
    expect(b.coins).toBe(10);
    // Three grosze in the air, landing round the victim.
    const spilled = sim.coins.filter((c) => c.state === 'pop');
    expect(total(spilled.map((c) => c.value))).toBe(3);
    for (const c of spilled) expect(Math.hypot(c.x - a.x, c.z - a.z)).toBeGreaterThan(1);
    // The stunned victim can't move.
    const x0 = a.x;
    run(sim, 0.5, (i) => (i === 0 ? { x: 1, z: 0 } : undefined));
    expect(Math.abs(a.x - x0)).toBeLessThan(0.3);
  });
  it('miss anyone outside HAZARD_R', () => {
    const sim = quiet(1);
    sim.players[0].x = sim.players[0].z = 0;
    sim.players[0].coins = 5;
    sim.addHazard('pan', HAZARD_R + 0.05, 0);
    const ev = run(sim, HAZARD_T + 0.05);
    expect(ev.find((e) => e.t === 'smash')).toMatchObject({ hits: [] });
    expect(sim.players[0].coins).toBe(5);
  });
  it('stun you even with no coins (and nothing goes negative)', () => {
    const sim = quiet(1);
    sim.players[0].x = sim.players[0].z = 0;
    sim.addHazard('pot', 0, 0);
    const ev = run(sim, HAZARD_T + 0.05);
    expect(ev.find((e) => e.t === 'hit')).toMatchObject({ p: 0, lost: 0 });
    expect(sim.players[0].coins).toBe(0);
    expect(sim.players[0].stun).toBeGreaterThan(0);
    expect(sim.coins).toHaveLength(0);
  });
  it('can’t hit you again while stunned or just after', () => {
    const sim = quiet(1);
    const p = sim.players[0];
    p.x = p.z = 0;
    p.coins = 20;
    sim.bonk(0);
    expect(p.coins).toBe(14);
    // A pot that lands while stunned (or in the second of safety after) does nothing.
    sim.addHazard('pot', 0, 0);
    const ev = run(sim, HAZARD_T + 0.05);
    expect(ev.find((e) => e.t === 'smash')).toMatchObject({ hits: [] });
    expect(p.coins).toBe(14);
    expect(p.bonks).toBe(1);
    // It recovered after STUN, and is safe for INVULN.
    expect(ev.find((e) => e.t === 'recover')).toBeTruthy();
    expect(p.stun).toBe(0);
    expect(p.inv).toBeGreaterThan(0);
    run(sim, INVULN + 0.05);
    expect(p.inv).toBe(0);
  });
});

describe('dash', () => {
  it('bursts forward, then cools down for DASH_CD', () => {
    const sim = quiet(1);
    const p = sim.players[0];
    p.x = -5;
    p.z = 0;
    let ev = run(sim, DT, () => ({ x: 1, z: 0, dash: true }));
    expect(ev.find((e) => e.t === 'dash')).toBeTruthy();
    run(sim, 0.3, () => ({ x: 1, z: 0 }));
    expect(p.x).toBeGreaterThan(-5 + 3.5);
    ev = run(sim, 1, () => ({ x: 0, z: 0, dash: true }));
    expect(ev.find((e) => e.t === 'dash')).toBeUndefined();
    ev = run(sim, DASH_CD, () => ({ x: 0, z: 0, dash: true }));
    expect(ev.find((e) => e.t === 'dash')).toBeTruthy();
  });
  it('bumping someone knocks BUMP_DROP coins out of them', () => {
    const sim = quiet(2);
    const a = sim.players[0];
    const b = sim.players[1];
    a.x = -2;
    a.z = 0;
    b.x = 0.4;
    b.z = 0;
    b.coins = 10;
    const ev = run(sim, 0.4, (i) => (i === 0 ? { x: 1, z: 0, dash: true } : undefined));
    expect(ev.find((e) => e.t === 'bump')).toMatchObject({ by: 0, p: 1, lost: BUMP_DROP });
    expect(b.coins + total(sim.coins.map((c) => c.value)) + a.coins).toBe(10);
    expect(b.coins).toBeLessThanOrEqual(10 - BUMP_DROP + 0);
    expect(ev.filter((e) => e.t === 'bump')).toHaveLength(1);
  });
  it('only takes what you have', () => {
    const sim = quiet(2);
    sim.players[0].x = -2;
    sim.players[1].x = 0.4;
    sim.players[0].z = sim.players[1].z = 0;
    sim.players[1].coins = 1;
    const ev = run(sim, 0.4, (i) => (i === 0 ? { x: 1, z: 0, dash: true } : undefined));
    expect(ev.find((e) => e.t === 'bump')).toMatchObject({ lost: 1 });
    expect(sim.players[1].coins).toBe(0);
  });
  it('does nothing to a stunned player', () => {
    const sim = quiet(2);
    sim.players[0].x = -2;
    sim.players[1].x = 0.4;
    sim.players[0].z = sim.players[1].z = 0;
    sim.players[1].coins = 10;
    sim.bonk(1);
    const left = sim.players[1].coins;
    const ev = run(sim, 0.3, (i) => (i === 0 ? { x: 1, z: 0, dash: true } : undefined));
    expect(ev.find((e) => e.t === 'bump')).toBeUndefined();
    expect(sim.players[1].coins).toBe(left);
  });
  it('lets the dasher scoop up the coins it knocks loose', () => {
    const sim = quiet(2, 5);
    const a = sim.players[0];
    const b = sim.players[1];
    a.x = -2;
    b.x = 0.4;
    a.z = b.z = 0;
    b.coins = 3;
    run(sim, 0.3, (i) => (i === 0 ? { x: 1, z: 0, dash: true } : undefined));
    const spilled = sim.coins.slice();
    expect(spilled).toHaveLength(3);
    run(sim, SPILL_T);
    // Walk to each coin in turn.
    for (const c of spilled) {
      for (let k = 0; k < 400 && sim.coins.includes(c); k++)
        sim.step([{ x: Math.max(-1, Math.min(1, (c.x - a.x) * 3)), z: Math.max(-1, Math.min(1, (c.z - a.z) * 3)) }, undefined]);
    }
    expect(a.coins + b.coins).toBe(3);
    expect(a.coins).toBeGreaterThan(0);
  });
});

describe('the round', () => {
  it('ends after ROUND_S with everyone’s coins as the score', () => {
    const sim = new CoinsSim(3, { rng: mulberry32(21) });
    // Player 0 chases coins; the others stand still.
    const ev = run(sim, ROUND_S + 2, (i, s) => {
      if (i !== 0) return undefined;
      const p = s.players[0];
      const target = s.coins.filter((c) => c.state !== 'pop').sort((x, y) => Math.hypot(x.x - p.x, x.z - p.z) - Math.hypot(y.x - p.x, y.z - p.z))[0];
      if (!target) return undefined;
      const dx = target.x - p.x;
      const dz = target.z - p.z;
      const d = Math.hypot(dx, dz) || 1;
      return { x: dx / d, z: dz / d };
    });
    expect(sim.done).toBe(true);
    expect(sim.time).toBeCloseTo(ROUND_S, 1);
    expect(ev.filter((e) => e.t === 'over')).toHaveLength(1);
    expect(sim.scores()).toEqual(sim.players.map((p) => p.coins));
    expect(sim.players[0].coins).toBeGreaterThan(10);
    expect(sim.ranking()[0]).toBe(0);
    expect(sim.winners()).toEqual([0]);
    // Nothing more happens after the whistle.
    expect(sim.step([])).toEqual([]);
  });
  it('works solo', () => {
    const sim = new CoinsSim(1, { rng: mulberry32(2) });
    run(sim, ROUND_S + 1, () => ({ x: Math.sin(sim.time), z: Math.cos(sim.time * 0.7) }));
    expect(sim.done).toBe(true);
    expect(sim.scores()).toHaveLength(1);
    expect(sim.scores()[0]).toBeGreaterThanOrEqual(0);
  });
  it('shares the win on a tie, and has no winner when nobody has a coin', () => {
    const sim = quiet(3);
    expect(sim.winners()).toEqual([]);
    sim.players[0].coins = 4;
    sim.players[2].coins = 4;
    sim.players[1].coins = 1;
    expect(sim.winners()).toEqual([0, 2]);
    expect(sim.ranking()).toEqual([0, 2, 1]);
  });
  it('drops a removed player: no coins, no score, out of the ranking, ignores input', () => {
    const sim = quiet(3);
    sim.players[1].coins = 9;
    sim.players[0].coins = 2;
    sim.remove(1);
    sim.remove(1);
    expect(sim.scores()).toEqual([2, 0, 0]);
    expect(sim.ranking()).toEqual([0, 2]);
    expect(sim.winners()).toEqual([0]);
    const x = sim.players[1].x;
    run(sim, 0.5, () => ({ x: 1, z: 0, dash: true }));
    expect(sim.players[1].x).toBe(x);
    // Coins next to a removed player stay on the ground.
    sim.addCoin('gold', sim.players[1].x, sim.players[1].z);
    run(sim, DT);
    expect(sim.players[1].coins).toBe(0);
    // Pots aren't aimed at them.
    const real = new CoinsSim(2, { rng: mulberry32(4) });
    real.remove(0);
    for (let k = 0; k < Math.round(ROUND_S / DT) && !real.done; k++) {
      real.step([]);
      for (const h of real.hazards) expect(h.aim).not.toBe(0);
    }
  });
  it('keeps players inside the square', () => {
    const sim = quiet(2);
    run(sim, 5, (i) => (i === 0 ? { x: 1, z: 1, dash: true } : { x: -1, z: -1, dash: true }));
    for (const p of sim.players) {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(sim.hw);
      expect(Math.abs(p.z)).toBeLessThanOrEqual(sim.hd);
    }
  });
  it('has three short how-to lines', () => {
    for (const s of [true, false]) {
      const h = howTo(s);
      expect(h).toHaveLength(3);
      for (const line of h) expect(line.length).toBeLessThan(48);
    }
  });
});
