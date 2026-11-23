import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAX_PLAYERS,
  GAMES,
  MAX_PLAYERS,
  PLAYER_COLORS,
  TOURNAMENT_CANDIDATES,
  TOURNAMENT_GAMES,
  gameInfo,
  gameMaxPlayers,
  playerCountProblem,
  tournamentLength,
  tournamentPoints,
  tournamentPool,
  tournamentProblem,
  type GameId,
} from '../shared/protocol';
import { awardGame, cleanTourOff, newTournament, nextGame, runningTotals, tournamentPlaces } from '../client/src/host/tournament';
import { spread } from '../client/src/host/Scoreboard';
import { mulberry32 } from '../client/src/games/rng';
import { trailsTarget } from '../client/src/games/trails/scoring';
import { TY_SHORT, pickPlan, type TotyQuestion } from '../client/src/games/toty/logic';
import questions from '../data/toty.json';
import { roundsFor } from '../client/src/games/bazgroly/logic';

describe('tournament pool', () => {
  it('never offers co-op games', () => {
    for (let n = 1; n <= 12; n++) expect(tournamentPool(n, n)).not.toContain('kitchen');
  });

  it('only offers games the room can start', () => {
    expect(tournamentPool(2, 2)).not.toContain('toty');
    expect(tournamentPool(3, 3)).toContain('toty');
    expect(tournamentPool(4, 4)).toContain('rally');
    expect(tournamentPool(5, 5)).not.toContain('rally');
    expect(tournamentPool(8, 8)).toContain('trails');
    expect(tournamentPool(9, 9)).not.toContain('trails');
  });

  it('has enough games for any room of 2 to 12', () => {
    for (let n = 2; n <= MAX_PLAYERS; n++) {
      expect(tournamentPool(n, n).length).toBeGreaterThanOrEqual(TOURNAMENT_GAMES);
      expect(tournamentProblem(n, n)).toBeNull();
    }
  });

  it('supports exactly the 16 non-action games up to 12 players and keeps noTv at 8', () => {
    const upgraded = ['quiz', 'ballpark', 'toty', 'bazgroly', 'fork', 'parade', 'swap', 'quip', 'spy', 'herd', 'wave', 'telephone', 'survey', 'split', 'dictionary', 'gossip'].sort();
    expect(tournamentPool(12, 12).sort()).toEqual(upgraded);
    expect(gameMaxPlayers(gameInfo('quiz'))).toBe(12);
    expect(gameMaxPlayers(gameInfo('rally'))).toBe(4);
    expect(gameMaxPlayers(gameInfo('rally'), true)).toBe(DEFAULT_MAX_PLAYERS);
    expect(gameMaxPlayers(gameInfo('mushroom'), true)).toBe(DEFAULT_MAX_PLAYERS);
    expect(playerCountProblem(gameInfo('quiz'), 12, 12)).toBeNull();
    expect(playerCountProblem(gameInfo('tanks'), 9, 9)).toMatch(/up to 8/);
    expect(playerCountProblem(gameInfo('rally'), 9, 9, true)).toMatch(/up to 8/);
  });

  it('needs two players and a TV', () => {
    expect(tournamentProblem(1, 1)).toMatch(/at least 2/);
    expect(tournamentProblem(4, 4, true)).toMatch(/TV/);
  });
});

describe('player colours and chef sprites', () => {
  it('provides 15 distinct colours, each with front/back/side WebP chef sprites', () => {
    expect(PLAYER_COLORS).toHaveLength(15);
    expect(new Set(PLAYER_COLORS.map((c) => c.id)).size).toBe(15);
    expect(new Set(PLAYER_COLORS.map((c) => c.hex.toLowerCase())).size).toBe(15);
    const files = new Set(Object.keys(import.meta.glob('../client/public/sprites/kitchen/chef-*.webp')));
    for (const c of PLAYER_COLORS) {
      for (const pose of ['front', 'back', 'side']) {
        expect(files.has(`../client/public/sprites/kitchen/chef-${c.id}-${pose}.webp`)).toBe(true);
      }
    }
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
    for (let n = 1; n <= MAX_PLAYERS; n++) for (const g of tournamentPool(n, n)) all.add(g);
    expect([...all].sort()).toEqual(GAMES.filter((g) => !g.coop && !g.standalone).map((g) => g.id).sort());
  });
});

describe('tournament settings', () => {
  const ids = ['a', 'b', 'c'];

  it('plays as many games as the VIP asks for, short or full', () => {
    const t = newTournament(tournamentPool(4, 4), ids, mulberry32(7), { games: 8, short: false });
    expect(t.games).toHaveLength(8);
    expect(new Set(t.games).size).toBe(8);
    expect(t.short).toBe(false);
    expect(newTournament(tournamentPool(4, 4), ids, mulberry32(7)).short).toBe(true);
  });

  it('only draws games that are switched on', () => {
    const off: GameId[] = ['quiz', 'trails', 'rally'];
    const pool = tournamentPool(4, 4, off);
    for (const g of off) expect(pool).not.toContain(g);
    const t = newTournament(pool, ids, mulberry32(8), { games: 10 });
    for (const g of off) expect(t.games).not.toContain(g);
  });

  it('plays fewer games when fewer are switched on', () => {
    const off = TOURNAMENT_CANDIDATES.filter((g) => g !== 'quiz' && g !== 'fork' && g !== 'pedal');
    const pool = tournamentPool(4, 4, off);
    expect(pool.sort()).toEqual(['fork', 'pedal', 'quiz']);
    expect(tournamentLength(5, pool.length)).toBe(3);
    expect(newTournament(pool, ids, mulberry32(9), { games: 5 }).games).toHaveLength(3);
    expect(tournamentProblem(4, 4, false, off)).toBeNull();
  });

  it('needs at least two games switched on', () => {
    const off = TOURNAMENT_CANDIDATES.filter((g) => g !== 'quiz');
    expect(tournamentProblem(4, 4, false, off)).toMatch(/Switch on/);
    // Switched on, but no good for two players.
    const offToo = TOURNAMENT_CANDIDATES.filter((g) => g !== 'toty' && g !== 'bazgroly');
    expect(tournamentProblem(2, 2, false, offToo)).toMatch(/Switch on/);
  });

  it('keeps only real tournament games in the off list', () => {
    expect(cleanTourOff(['quiz', 'kitchen', 'nope', 'quiz'], TOURNAMENT_CANDIDATES)).toEqual(['quiz']);
    expect(cleanTourOff('quiz', TOURNAMENT_CANDIDATES)).toBeNull();
  });

  it('logs every game for the chart', () => {
    const t = newTournament(['quiz', 'fork'], ids, mulberry32(10), { games: 2 });
    nextGame(t, () => true, []);
    awardGame(t, { a: 3, b: 2, c: 1 });
    nextGame(t, () => true, []);
    awardGame(t, { a: 0, b: 2, c: 5 });
    expect(t.log.map((e) => e.game)).toEqual(t.games);
    expect(runningTotals(t.log, ids)).toEqual([
      { a: 0, b: 0, c: 0 },
      { a: 10, b: 7, c: 5 },
      { a: 15, b: 14, c: 15 },
    ]);
  });
});

describe('chart labels', () => {
  it('spreads close labels apart and keeps them in the plot', () => {
    const ys = spread([100, 102, 300, 101], 30, 0, 320);
    const sorted = [...ys].sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(30);
    expect(ys[2]).toBe(300);
    expect(spread([310, 315, 320], 30, 0, 320)).toEqual([260, 290, 320]);
  });
});
