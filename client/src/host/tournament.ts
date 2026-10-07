import { TOURNAMENT_GAMES, tournamentPoints, type GameId } from '../../../shared/protocol';
import type { Rng } from '../games/rng';
import { shuffle } from '../games/quiz/logic';
import { placesFor } from './standings';

/** A run of short games with its own points table. */
export interface Tournament {
  games: GameId[];
  /** The game being played (or just played); -1 before the first one. */
  index: number;
  /** Play the short versions of the games. */
  short: boolean;
  /** Tournament points so far, by player id. */
  points: Record<string, number>;
  /** Tournament points from the last game, by player id. */
  gained: Record<string, number>;
  /** Every finished game with the tournament points it handed out, in order. */
  log: { game: GameId; gained: Record<string, number> }[];
}

export interface TournamentSettings {
  /** How many games to play (fewer if the pool is smaller). */
  games?: number;
  short?: boolean;
}

/** Pick the games: `settings.games` different ones from `pool`, in random order. */
export function newTournament(pool: readonly GameId[], ids: readonly string[], rng: Rng = Math.random, settings: TournamentSettings = {}): Tournament {
  const points: Record<string, number> = {};
  for (const id of ids) points[id] = 0;
  const count = settings.games ?? TOURNAMENT_GAMES;
  return { games: shuffle(pool, rng).slice(0, count), index: -1, short: settings.short ?? true, points, gained: {}, log: [] };
}

/** Hand out tournament points for a finished game (scores by player id; higher is better). */
export function awardGame(t: Tournament, scores: Record<string, number>) {
  const ids = Object.keys(scores);
  const places = placesFor(ids.map((id) => scores[id]));
  t.gained = {};
  ids.forEach((id, i) => {
    const pts = tournamentPoints(places[i]);
    t.gained[id] = pts;
    t.points[id] = (t.points[id] ?? 0) + pts;
  });
  const game = t.games[Math.max(0, t.index)];
  if (game) t.log.push({ game, gained: { ...t.gained } });
}

/**
 * Before each game: if the planned game can't be played with the players there are now,
 * swap in an unplayed one that can, or drop it. Returns the game to play, or null when done.
 */
export function nextGame(t: Tournament, playable: (g: GameId) => boolean, spares: readonly GameId[], rng: Rng = Math.random): GameId | null {
  t.index++;
  while (t.index < t.games.length && !playable(t.games[t.index])) {
    const unused = spares.filter((g) => !t.games.includes(g) && playable(g));
    if (unused.length) t.games[t.index] = unused[Math.floor(rng() * unused.length)];
    else t.games.splice(t.index, 1);
  }
  return t.games[t.index] ?? null;
}

/** Final standings: everybody ranked by tournament points (ties share a place). */
export function tournamentPlaces(t: Tournament, ids: readonly string[]): { id: string; points: number; place: number }[] {
  const rows = ids.map((id) => ({ id, points: t.points[id] ?? 0, place: 0 }));
  const places = placesFor(rows.map((r) => r.points));
  rows.forEach((r, i) => (r.place = places[i]));
  return rows.sort((a, b) => a.place - b.place);
}

/** Running totals after each game of a log, starting from 0: totals[k][id] = points after k games. */
export function runningTotals(log: readonly { gained: Record<string, number> }[], ids: readonly string[]): Record<string, number>[] {
  const totals: Record<string, number>[] = [Object.fromEntries(ids.map((id) => [id, 0]))];
  for (const entry of log) {
    const prev = totals[totals.length - 1];
    totals.push(Object.fromEntries(ids.map((id) => [id, prev[id] + (entry.gained[id] ?? 0)])));
  }
  return totals;
}

/** Sanitise the VIP's list of switched-off tournament games. */
export function cleanTourOff(value: unknown, candidates: readonly GameId[]): GameId[] | null {
  if (!Array.isArray(value)) return null;
  return candidates.filter((g) => value.includes(g));
}
