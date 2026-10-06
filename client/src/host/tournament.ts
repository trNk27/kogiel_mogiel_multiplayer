import { TOURNAMENT_GAMES, tournamentPoints, type GameId } from '../../../shared/protocol';
import type { Rng } from '../games/rng';
import { shuffle } from '../games/quiz/logic';
import { placesFor } from './standings';

/** A run of short games with its own points table. */
export interface Tournament {
  games: GameId[];
  /** The game being played (or just played); -1 before the first one. */
  index: number;
  /** Tournament points so far, by player id. */
  points: Record<string, number>;
  /** Tournament points from the last game, by player id. */
  gained: Record<string, number>;
}

/** Pick the games: TOURNAMENT_GAMES different ones from `pool`, in random order. */
export function newTournament(pool: readonly GameId[], ids: readonly string[], rng: Rng = Math.random): Tournament {
  const points: Record<string, number> = {};
  for (const id of ids) points[id] = 0;
  return { games: shuffle(pool, rng).slice(0, TOURNAMENT_GAMES), index: -1, points, gained: {} };
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
