import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_OPTIONS,
  KARTS,
  PREMIUM_CUPS,
  PREMIUM_TRACKS,
  TOURNAMENT_CANDIDATES,
  gameInfo,
  kartInfo,
  playerCountProblem,
  tournamentPool,
  type PhoneMsg,
  type PhoneView,
} from '../shared/protocol';
import { ALL_SHAPES, generateTrack, validTrack, type Shape } from '../client/src/games/rally/track';
import { DT, LAPS, RallySim, kartSpec } from '../client/src/games/rally/sim';
import type { GameHost } from '../client/src/games/types';
import type { Player } from '../client/src/host/controller';

describe('Maluch Rallye Premium data', () => {
  it('has four cars with 13 stat points each, every stat 1–5', () => {
    expect(KARTS.map((k) => k.id)).toEqual(['maluch', 'syrenka', 'polonez', 'tarpan']);
    for (const k of KARTS) {
      const s = Object.values(k.stats);
      expect(s.reduce((a, b) => a + b, 0)).toBe(13);
      for (const v of s) expect(v >= 1 && v <= 5).toBe(true);
    }
    expect(kartInfo('nope').id).toBe('maluch');
  });

  it('puts every track in exactly one Grand Prix of three', () => {
    const ids = PREMIUM_TRACKS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    const inCups = PREMIUM_CUPS.flatMap((c) => c.tracks);
    for (const c of PREMIUM_CUPS) expect(c.tracks).toHaveLength(3);
    expect([...inCups].sort()).toEqual([...ids].sort());
  });

  it('builds every named track as the shape it says, the same way every time', () => {
    for (const t of PREMIUM_TRACKS) {
      expect(ALL_SHAPES).toContain(t.shape);
      const a = generateTrack(t.seed, t.shape as Shape);
      expect(a.shape).toBe(t.shape);
      expect(validTrack(a.xs, a.zs, !!a.crossing, a.hard)).toBe(true);
      expect(generateTrack(t.seed, t.shape as Shape).xs[17]).toBe(a.xs[17]);
    }
  });

  it('is a game of its own: never in a tournament, up to 4 players with a TV, none without', () => {
    const info = gameInfo('premium');
    expect(TOURNAMENT_CANDIDATES).not.toContain('premium');
    expect(tournamentPool(4, 4)).not.toContain('premium');
    expect(playerCountProblem(info, 1, 1)).toBeNull();
    expect(playerCountProblem(info, 4, 5)).toMatch(/up to 4/);
    expect(playerCountProblem(info, 2, 2, true)).toMatch(/needs a TV/);
  });
});

describe('car stats', () => {
  const spec = (id: string) => kartSpec(kartInfo(id).stats);

  it('turns the stats into driving numbers', () => {
    expect(spec('polonez').maxSpeed).toBeGreaterThan(spec('maluch').maxSpeed);
    expect(spec('maluch').maxSpeed).toBeGreaterThan(spec('syrenka').maxSpeed);
    expect(spec('syrenka').accel).toBeGreaterThan(spec('polonez').accel);
    expect(spec('syrenka').steer).toBeGreaterThan(spec('tarpan').steer);
    expect(spec('tarpan').grassSpeed).toBeGreaterThan(spec('syrenka').grassSpeed);
    expect(spec('tarpan').weight).toBeGreaterThan(spec('syrenka').weight);
  });

  it('makes the Syrenka quick off the line and the Polonez faster flat out', () => {
    const track = generateTrack(2207, 'speedway');
    const sim = new RallySim(track, 2, LAPS, false, Math.random, { specs: [spec('syrenka'), spec('polonez')] });
    const [syrenka, polonez] = sim.cars;
    const drive = (s: number) => {
      for (let k = 0; k < s / DT; k++) {
        for (const c of sim.cars) c.input = sim.autopilot(c, 99);
        sim.step();
      }
    };
    drive(1.2);
    expect(syrenka.speed).toBeGreaterThan(polonez.speed);
    drive(12);
    expect(polonez.speed).toBeGreaterThan(syrenka.speed);
  });
});

describe('PremiumGame', () => {
  const ids = ['a', 'b'];
  let views: Record<string, PhoneView>;
  let finished: Record<string, number> | null;
  let host: GameHost;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('location', { search: '' });
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const players = new Map<string, Player>(
      ids.map((id, i) => [id, { id, name: id.toUpperCase(), color: i ? 'dill' : 'beet', connected: true, joinedAt: i, disconnectedAt: null, party: 0 } as Player]),
    );
    views = {};
    finished = null;
    host = {
      player: (id) => players.get(id),
      refresh: () => {},
      buzz: () => {},
      message: () => {},
      changed: () => {},
      finish: (s) => (finished = s),
      options: DEFAULT_OPTIONS,
      short: false,
      noTv: false,
      vipId: () => 'a',
    };
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function make() {
    const { PremiumGame } = await import('../client/src/games/premium/PremiumGame');
    const g = new PremiumGame(host, ids);
    g.start();
    const send = (id: string, m: PhoneMsg) => {
      g.onMessage(id, m);
      for (const x of ids) views[x] = g.viewFor(x);
    };
    for (const x of ids) views[x] = g.viewFor(x);
    return { g, send };
  }

  it('lets only the VIP drive the menus, then everybody picks a car and the Grand Prix starts', async () => {
    const { g, send } = await make();
    expect(views.a).toMatchObject({ v: 'premium', phase: 'title', vip: true });
    expect(views.b).toMatchObject({ v: 'premium', phase: 'title', vip: false, vipName: 'A' });
    send('b', { t: 'prem', a: 'mode', i: 0 });
    expect(g.phase).toBe('title');
    send('a', { t: 'prem', a: 'mode', i: 0 });
    expect(g.phase).toBe('cups');
    send('a', { t: 'prem', a: 'hover', i: 2 });
    send('a', { t: 'prem', a: 'hover', i: 99 });
    expect(views.a).toMatchObject({ phase: 'cups', cursor: 2 });
    send('a', { t: 'prem', a: 'go' });
    expect(views.b).toMatchObject({ phase: 'karts', event: 'Barszcz Cup', kart: 'maluch', ready: false, total: 2 });

    send('a', { t: 'prem', a: 'kart', i: 2 });
    send('b', { t: 'prem', a: 'kart', i: 3 });
    send('a', { t: 'prem', a: 'ready', on: true });
    // Ready players can't change car until they un-ready.
    send('a', { t: 'prem', a: 'kart', i: 0 });
    expect(views.a).toMatchObject({ kart: 'polonez', ready: true, readyCount: 1 });
    send('b', { t: 'prem', a: 'ready', on: true });
    expect(g.race).toBeNull();
    vi.advanceTimersByTime(2000);
    expect(g.race).not.toBeNull();
    expect(g.race!.id).toBe('premium');
    expect(views.a.v).toBe('premium');
    expect(g.viewFor('a')).toMatchObject({ v: 'rally', race: 1, races: 3 });
    const race = g.race as unknown as { sim: RallySim; track: { name: string } };
    expect(race.track.name).toBe('Kraków Old Town');
    expect(race.sim.cars[0].spec).toEqual(kartSpec(kartInfo('polonez').stats));
    expect(race.sim.cars[1].spec).toEqual(kartSpec(kartInfo('tarpan').stats));
    g.dispose();
    expect(finished).toBeNull();
  });

  it('races a single track, and the VIP can go back or start without waiting', async () => {
    const { g, send } = await make();
    send('a', { t: 'prem', a: 'mode', i: 1 });
    send('a', { t: 'prem', a: 'hover', i: 9 });
    send('a', { t: 'prem', a: 'go' });
    expect(views.a).toMatchObject({ phase: 'karts', event: 'Tatra Pass' });
    send('a', { t: 'prem', a: 'back' });
    expect(views.a).toMatchObject({ phase: 'tracks', cursor: 9 });
    send('a', { t: 'prem', a: 'go' });
    send('a', { t: 'prem', a: 'ready', on: true });
    // b dawdles: the VIP starts anyway.
    send('b', { t: 'prem', a: 'go' });
    expect(g.race).toBeNull();
    send('a', { t: 'prem', a: 'go' });
    expect(g.viewFor('b')).toMatchObject({ v: 'rally', races: 1 });
    g.dispose();
  });

  it('ends if everyone leaves before the race', async () => {
    const { g } = await make();
    g.onRemoved('a');
    expect(finished).toBeNull();
    g.onRemoved('b');
    expect(finished).toEqual({});
    g.dispose();
  });
});
