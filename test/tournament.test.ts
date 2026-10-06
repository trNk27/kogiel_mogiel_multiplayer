import { describe, expect, it } from 'vitest';
import { GAMES, TOURNAMENT_GAMES, gameInfo, tournamentPoints, tournamentPool, tournamentProblem, type GameId } from '../shared/protocol';
import { awardGame, newTournament, nextGame, tournamentPlaces } from '../client/src/host/tournament';
import { mulberry32 } from '../client/src/games/rng';
import { trailsTarget } from '../client/src/games/trails/scoring';
import { TY_SHORT, pickPlan, type TotyQuestion } from '../client/src/games/toty/logic';
import questions from '../data/toty.json';
import { roundsFor } from '../client/src/games/bazgroly/logic';

describe('tournament pool', () => {
  it('never offers co-op games', () => {
    for (let n = 1; n <= 8; n++) expect(tournamentPool(n, n)).not.toContain('kitchen');
  });

  it('only offers games the room can start', () => {
    expect(tournamentPool(2, 2)).not.toContain('toty');
    expect(tournamentPool(3, 3)).toContain('toty');
    expect(tournamentPool(4, 4)).toContain('rally');
    expect(tournamentPool(5, 5)).not.toContain('rally');
  });

  it('has enough games for any room of 2 to 8', () => {
    for (let n = 2; n <= 8; n++) {
      expect(tournamentPool(n, n).length).toBeGreaterThanOrEqual(TOURNAMENT_GAMES);
      expect(tournamentProblem(n, n)).toBeNull();
    }
  });

  it('needs two players and a TV', () => {
    expect(tournamentProblem(1, 1)).toMatch(/at least 2/);
    expect(tournamentProblem(4, 4, true)).toMatch(/TV/);
  });
});

describe('tournament flow', () => {
  const ids = ['a', 'b', 'c', 'd'];

  it('picks five different competitive games', () => {
    for (let seed = 1; seed < 50; seed++) {
      const t = newTournament(tournamentPool(4, 4), ids, mulberry32(seed));
      expect(t.games).toHaveLength(TOURNAMENT_GAMES);
      expect(new Set(t.games).size).toBe(TOURNAMENT_GAMES);
      for (const g of t.games) expect(gameInfo(g).coop).toBeFalsy();
      expect(t.index).toBe(-1);
    }
  });

  it('gives 10 / 7 / 5… tournament points per game, sharing places on ties', () => {
    const t = newTournament(tournamentPool(4, 4), ids, mulberry32(1));
    awardGame(t, { a: 900, b: 1200, c: 900, d: 100 });
    expect(t.gained).toEqual({ b: 10, a: 7, c: 7, d: 3 });
    awardGame(t, { a: 5, b: 1, c: 3, d: 4 });
    expect(t.points).toEqual({ a: 17, b: 13, c: 12, d: 10 });
    expect(tournamentPlaces(t, ids).map((r) => [r.id, r.place])).toEqual([
      ['a', 1],
      ['b', 2],
      ['c', 3],
      ['d', 4],
    ]);
    expect(tournamentPoints(9)).toBe(0);
  });

  it('plays the games in order, then stops', () => {
    const t = newTournament(tournamentPool(4, 4), ids, mulberry32(2));
    const planned = [...t.games];
    const played: GameId[] = [];
    let g: GameId | null;
    while ((g = nextGame(t, () => true, [])) !== null) played.push(g);
    expect(played).toEqual(planned);
  });

  it('swaps in a playable game when the planned one can no longer start', () => {
    const t = newTournament(['quiz', 'rally', 'pedal', 'fork', 'parade'], ids, mulberry32(3));
    t.games = ['rally', 'quiz', 'pedal', 'fork', 'parade'];
    // Somebody joined: five players, so no Maluch Rally.
    const g = nextGame(t, (x) => x !== 'rally', ['ballpark', 'trails', 'quiz'], mulberry32(4));
    expect(g === 'ballpark' || g === 'trails').toBe(true);
    expect(t.games).toHaveLength(5);
    expect(t.games).not.toContain('rally');
  });

  it('drops a game when nothing else can be played', () => {
    const t = newTournament(['quiz'], ids);
    t.games = ['toty', 'quiz'];
    expect(nextGame(t, (x) => x !== 'toty', [])).toBe('quiz');
    expect(t.games).toEqual(['quiz']);
    expect(nextGame(t, () => true, [])).toBeNull();
  });
});

describe('short versions', () => {
  it('halves the Trails target', () => {
    expect(trailsTarget(4)).toBe(30);
    expect(trailsTarget(4, true)).toBe(15);
    expect(trailsTarget(2, true)).toBe(5);
  });

  it('plays one round of Bazgroły', () => {
    expect(roundsFor(3)).toBe(2);
    expect(roundsFor(3, true)).toBe(1);
    expect(roundsFor(6, true)).toBe(1);
  });

  it('plays four To Ty! questions with a doodle after the second', () => {
    const plan = pickPlan(questions as TotyQuestion[], new Set(), mulberry32(5), TY_SHORT);
    expect(plan).toHaveLength(TY_SHORT.questions);
    for (const i of TY_SHORT.doodleAfter) expect(plan[i].draw).toBeTruthy();
  });

  it('every competitive game is in the pool somewhere', () => {
    const all = new Set<GameId>();
    for (let n = 1; n <= 8; n++) for (const g of tournamentPool(n, n)) all.add(g);
    expect([...all].sort()).toEqual(GAMES.filter((g) => !g.coop).map((g) => g.id).sort());
  });
});
