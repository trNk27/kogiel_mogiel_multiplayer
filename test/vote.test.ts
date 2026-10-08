import { describe, expect, it } from 'vitest';
import { tournamentPool } from '../shared/protocol';
import { awardGame, drawVote, hasNext, newTournament, nextGame, nextVote, partyChoices, setVoted } from '../client/src/host/tournament';
import { mulberry32 } from '../client/src/games/rng';
import { CHOSEN_S, DT, SETTLED_S, SPIN_S, VOTE_S, VoteSim, matAt, matPos, spinPath } from '../client/src/host/vote/logic';

const ids = ['a', 'b', 'c', 'd'];

describe('party-mode tournament', () => {
  it('picks no games up front, but knows how many it plays', () => {
    const t = newTournament(tournamentPool(4, 4), ids, mulberry32(1), { games: 4, party: true });
    expect(t.party).toBe(true);
    expect(t.games).toEqual([]);
    expect(t.total).toBe(4);
  });

  it('never plays more games than the pool has', () => {
    const t = newTournament(['quiz', 'fork'], ids, mulberry32(1), { games: 5, party: true });
    expect(t.total).toBe(2);
  });

  it('offers three different games, unplayed ones first', () => {
    const pool = tournamentPool(4, 4);
    const t = newTournament(pool, ids, mulberry32(2), { games: 10, party: true });
    for (let k = 0; k < 10; k++) {
      const choices = nextVote(t, pool, mulberry32(k + 10))!;
      expect(choices).toHaveLength(3);
      expect(new Set(choices).size).toBe(3);
      for (const g of choices) expect(t.games).not.toContain(g);
      setVoted(t, choices[1]);
      awardGame(t, { a: 3, b: 2, c: 1, d: 0 });
    }
    expect(t.games).toHaveLength(10);
    expect(new Set(t.games).size).toBe(10);
    expect(t.log).toHaveLength(10);
    expect(t.points.a).toBe(100);
    expect(hasNext(t)).toBe(false);
    expect(nextVote(t, pool)).toBeNull();
  });

  it('fills up the choice with played games when the pool runs low', () => {
    const t = newTournament(['quiz', 'fork', 'pedal', 'parade'], ids, mulberry32(3), { games: 4, party: true });
    t.games = ['quiz', 'fork', 'pedal'];
    t.index = 2;
    const c = partyChoices(t, ['quiz', 'fork', 'pedal', 'parade'], mulberry32(4));
    expect(c[0]).toBe('parade');
    expect(c).toHaveLength(3);
  });

  it('ends when no game can be played any more', () => {
    const t = newTournament(['quiz', 'fork'], ids, mulberry32(3), { games: 2, party: true });
    expect(nextVote(t, [])).toBeNull();
  });

  it('leaves the classic tournament as it was', () => {
    const t = newTournament(tournamentPool(4, 4), ids, mulberry32(5), { games: 3 });
    expect(t.party).toBe(false);
    expect(t.total).toBe(3);
    expect(nextGame(t, () => true, [])).toBe(t.games[0]);
  });
});

describe('the draw', () => {
  it('gives every vote a ticket', () => {
    const d = drawVote([2, 0, null, 2], 3, () => 0.99);
    expect(d.tickets).toEqual([0, 2, 2]);
    expect(d.tickets[d.win]).toBe(2);
    expect(drawVote([2, 0, null, 2], 3, () => 0).tickets[0]).toBe(0);
  });

  it('gives every game one ticket when nobody voted', () => {
    const d = drawVote([null, null], 3, () => 0.5);
    expect(d.tickets).toEqual([0, 1, 2]);
    expect(d.win).toBe(1);
  });

  it('picks games in proportion to their votes', () => {
    const rng = mulberry32(9);
    const wins = [0, 0, 0];
    for (let k = 0; k < 6000; k++) {
      const d = drawVote([0, 0, 0, 1, null], 3, rng);
      wins[d.tickets[d.win]]++;
    }
    expect(wins[2]).toBe(0);
    expect(wins[0] / 6000).toBeGreaterThan(0.7);
    expect(wins[0] / 6000).toBeLessThan(0.8);
  });

  it('lights the tickets in turn and stops on the winner', () => {
    for (const [n, w] of [
      [1, 0],
      [3, 2],
      [7, 4],
    ]) {
      const p = spinPath(n, w);
      expect(p.idx[p.idx.length - 1]).toBe(w);
      for (let k = 1; k < p.at.length; k++) {
        expect(p.at[k]).toBeGreaterThan(p.at[k - 1]);
        // It slows down.
        if (k > 1) expect(p.at[k] - p.at[k - 1]).toBeGreaterThanOrEqual(p.at[k - 1] - p.at[k - 2] - 1e-9);
      }
      expect(p.at[p.at.length - 1]).toBeLessThan(SPIN_S);
    }
  });
});

describe('the vote room', () => {
  const run = (sim: VoteSim, s: number) => {
    let ev: string | null = null;
    for (let k = 0; k < Math.round(s / DT); k++) ev = sim.step() ?? ev;
    return ev;
  };

  it('counts a vote for whoever stands on a mat', () => {
    const m = matPos(0, 3);
    expect(matAt(m.x, m.z, 3)).toBe(0);
    expect(matAt(m.x, m.z + 4, 3)).toBeNull();
    const sim = new VoteSim(2, 3, mulberry32(1));
    sim.players[0].x = m.x;
    sim.players[0].z = m.z;
    run(sim, DT);
    expect(sim.votes()).toEqual([0, null]);
    expect(sim.counts()).toEqual([1, 0, 0]);
  });

  it('walks players around with the stick', () => {
    const sim = new VoteSim(1, 3, mulberry32(1));
    const z0 = sim.players[0].z;
    sim.setInput(0, 0, -1);
    run(sim, 1);
    expect(sim.players[0].z).toBeLessThan(z0 - 3);
    expect(sim.players[0].on).toBe(1);
  });

  it('closes after the time is up, draws, then shows the winner', () => {
    const sim = new VoteSim(3, 3, mulberry32(2));
    expect(run(sim, VOTE_S - 0.5)).toBeNull();
    expect(sim.phase).toBe('vote');
    run(sim, 0.6);
    expect(sim.phase).toBe('spin');
    // Nobody voted: one ticket per game.
    expect(sim.tickets).toEqual([0, 1, 2]);
    run(sim, SPIN_S);
    expect(sim.phase).toBe('chosen');
    expect(sim.lit()).toBe(sim.win);
    expect(run(sim, CHOSEN_S + 0.1)).toBe('done');
    expect(sim.winner()).not.toBeNull();
  });

  it('cuts the vote short once everybody stands on a mat', () => {
    const sim = new VoteSim(2, 3, mulberry32(3));
    for (const [i, c] of [
      [0, 2],
      [1, 2],
    ]) {
      const m = matPos(c, 3);
      sim.players[i].x = m.x + (i ? 0.6 : -0.6);
      sim.players[i].z = m.z;
    }
    run(sim, SETTLED_S + 0.1);
    expect(sim.phase).toBe('spin');
    expect(sim.tickets).toEqual([2, 2]);
    expect(sim.owners).toEqual([0, 1]);
    expect(sim.winner()).toBe(2);
  });

  it('forgets the vote of a player who left', () => {
    const sim = new VoteSim(2, 3, mulberry32(3));
    const m = matPos(1, 3);
    sim.players[1].x = m.x;
    sim.players[1].z = m.z;
    run(sim, DT);
    sim.remove(1);
    expect(sim.votes()).toEqual([null, null]);
  });
});
