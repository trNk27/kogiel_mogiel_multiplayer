import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../client/src/games/rng';
import { INTERP_MS, SnapBuffer, slim } from '../client/src/games/arena/net';
import { DT as MDT, MushroomSim, type MEvent } from '../client/src/games/mushroom/logic';
import * as mnet from '../client/src/games/mushroom/net';
import { DT as PDT, PushySim, type PushyEvent } from '../client/src/games/pushy/logic';
import * as pnet from '../client/src/games/pushy/net';
import { gameInfo, playerCountProblem } from '../shared/protocol';

describe('snapshot playback', () => {
  it('plays snapshots back INTERP_MS behind, interpolating between them', () => {
    let now = 10_000;
    const buf = new SnapBuffer(() => now);
    // Host clock is 5 s behind this phone; every snapshot takes 40 ms to arrive.
    for (let k = 0; k < 5; k++) {
      now = 10_000 + k * 66;
      buf.push(5_000 + k * 66 - 40, [k], [`e${k}`]);
    }
    const f = buf.frame()!;
    // Playback is at host time (now - offset - INTERP_MS).
    const t = 5_000 + 4 * 66 - 40 - INTERP_MS;
    expect(f.a.at).toBeLessThanOrEqual(t);
    expect(f.b.at).toBeGreaterThan(t);
    expect(f.a.s[0] + f.k).toBeCloseTo((t - (5_000 - 40)) / 66, 5);
    // Events of every snapshot playback has reached, once.
    expect(f.events).toEqual(['e0', 'e1', 'e2']);
    expect(buf.frame()!.events).toEqual([]);
    // Past the newest snapshot: hold on it.
    now += 1000;
    const g = buf.frame()!;
    expect(g.a).toBe(g.b);
    expect(g.a.s).toEqual([4]);
    expect(g.events).toEqual(['e3', 'e4']);
  });

  it('rounds the numbers in events', () => {
    expect(slim({ t: 'hit', a: 1, b: 2, x: 1.23456, z: -0.98765 })).toEqual({ t: 'hit', a: 1, b: 2, x: 1.23, z: -0.99 });
  });
});

describe('Grzybki without a TV', () => {
  it('rebuilds the arena on a phone from snapshots', () => {
    const host = new MushroomSim(4, mulberry32(3));
    const ev: MEvent[] = [];
    for (let k = 0; k < 60 * 9; k++) {
      host.players.forEach((_, i) => host.setInput(i, Math.cos(k / 40 + i), Math.sin(k / 40 + i)));
      ev.push(...host.step());
    }
    expect(ev.some((e) => e.t === 'call')).toBe(true);
    const s = mnet.encode(host);
    expect(JSON.stringify(s).length).toBeLessThan(600);
    const phone = new MushroomSim(4, mulberry32(99), [true, true, true, true], undefined, host.L.n);
    mnet.apply(phone, s, s, 0);
    expect(phone.phase).toBe(host.phase);
    expect(phone.ring).toBeCloseTo(host.ring, 2);
    expect(phone.cur).toEqual(host.cur);
    expect(phone.safe).toEqual(host.safe);
    expect(phone.targetColour).toBe(host.targetColour);
    phone.players.forEach((p, i) => {
      const h = host.players[i];
      expect(p.x).toBeCloseTo(h.x, 1);
      expect(p.z).toBeCloseTo(h.z, 1);
      expect(p.alive).toBe(h.alive);
      expect(p.fellAt !== null).toBe(h.fellAt !== null);
    });
  });

  it('interpolates positions between snapshots', () => {
    const host = new MushroomSim(2, mulberry32(5));
    const a = mnet.encode(host);
    for (let k = 0; k < 20; k++) {
      host.setInput(0, 1, 0);
      host.step();
    }
    const b = mnet.encode(host);
    const phone = new MushroomSim(2, mulberry32(1), [true, true], undefined, host.L.n);
    mnet.apply(phone, a, b, 0.5);
    const x0 = a[8 + 2 * host.L.n];
    expect(phone.players[0].x).toBeCloseTo((x0 + host.players[0].x) / 2, 1);
    expect(MDT).toBeGreaterThan(0);
  });

  it('is offered without a TV, for up to 8', () => {
    expect(playerCountProblem(gameInfo('mushroom'), 8, 8, true)).toBeNull();
    expect(playerCountProblem(gameInfo('mushroom'), 1, 1, true)).toMatch(/at least 2/);
  });
});

describe('Pushy Pierogi without a TV', () => {
  it('builds the same floe from the seed, and cracks it on the same schedule', () => {
    const host = new PushySim(3, mulberry32(1234));
    const phone = new PushySim(3, mulberry32(1234));
    expect(phone.chunks.map((c) => [c.a0, c.crackAt])).toEqual(host.chunks.map((c) => [c.a0, c.crackAt]));
    host.start();
    const hostEv: PushyEvent[] = [];
    for (let k = 0; k < 60 * 25; k++) {
      host.players.forEach((_, i) => host.setStick(i, Math.cos(k / 50 + i * 2), Math.sin(k / 50 + i * 2)));
      hostEv.push(...host.step());
    }
    const s = pnet.encode(host);
    const phoneEv = pnet.apply(phone, s, s, 0);
    const cracked = (evs: PushyEvent[], k: 'crack' | 'break') => evs.filter((e) => e.k === k).map((e) => (e as { c: number }).c).sort();
    expect(cracked(phoneEv, 'break')).toEqual(cracked(hostEv, 'break'));
    expect(phone.chunks.map((c) => c.state)).toEqual(host.chunks.map((c) => c.state));
    expect(pnet.apply(phone, s, s, 0)).toEqual([]);
    phone.players.forEach((p, i) => {
      const h = host.players[i];
      expect(p.x).toBeCloseTo(h.x, 1);
      expect(p.alive).toBe(h.alive);
      expect(phone.isBraced(i)).toBe(host.isBraced(i));
    });
    // Stones on the ice come across; finished ones are dropped.
    const live = host.stones.filter((x) => !x.done);
    expect(phone.stones.filter((x) => !x.done).map((x) => x.id)).toEqual(live.map((x) => x.id));
    expect(pnet.forwardEvent({ k: 'crack', c: 3 })).toBe(false);
    expect(pnet.forwardEvent({ k: 'shove', i: 0 })).toBe(true);
    expect(PDT).toBeGreaterThan(0);
  });

  it('shows bracing and dashing on the phone', () => {
    const host = new PushySim(2, mulberry32(8));
    host.start();
    host.step();
    host.brace(0);
    host.shove(1);
    const s = pnet.encode(host);
    const phone = new PushySim(2, mulberry32(8));
    pnet.apply(phone, s, s, 0);
    expect(phone.isBraced(0)).toBe(true);
    expect(phone.isDashing(1)).toBe(true);
    expect(phone.isBraced(1)).toBe(false);
  });
});
