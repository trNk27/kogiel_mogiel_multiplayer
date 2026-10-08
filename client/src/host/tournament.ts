import { TOURNAMENT_GAMES, tournamentPoints, type GameId } from '../../../shared/protocol';
import type { Rng } from '../games/rng';
import { shuffle } from '../games/quiz/logic';
import { placesFor } from './standings';

/** A run of short games with its own points table. */
export interface Tournament {
  /** The games, in order. In party mode only the ones voted for so far. */
  games: GameId[];
  /** How many games the tournament plays. */
  total: number;
  /** Party mode: before every game the players vote between a few, instead of a random line-up. */
  party: boolean;
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
  /** Party mode: vote for each game. */
  party?: boolean;
}

/**
 * Pick the games: `settings.games` different ones from `pool`, in random order.
 * In party mode none are picked yet: the players vote before each game.
 */
export function newTournament(pool: readonly GameId[], ids: readonly string[], rng: Rng = Math.random, settings: TournamentSettings = {}): Tournament {
  const points: Record<string, number> = {};
  for (const id of ids) points[id] = 0;
  const count = Math.min(settings.games ?? TOURNAMENT_GAMES, pool.length);
  const party = !!settings.party;
  const games = party ? [] : shuffle(pool, rng).slice(0, count);
  return { games, total: party ? count : games.length, party, index: -1, short: settings.short ?? true, points, gained: {}, log: [] };
}

/** Games to vote between in party mode. */
export const PARTY_CHOICES = 3;

/** Is there another game to play after the current one? */
export function hasNext(t: Tournament): boolean {
  return t.index + 1 < t.total;
}

/**
 * Party mode, before each game: up to `n` different games to vote between, from the ones that can be
 * played now. Games not played yet in this tournament come first; played ones only fill up the choice.
 */
export function partyChoices(t: Tournament, pool: readonly GameId[], rng: Rng = Math.random, n = PARTY_CHOICES): GameId[] {
  const fresh = shuffle(pool.filter((g) => !t.games.includes(g)), rng);
  const played = shuffle(pool.filter((g) => t.games.includes(g)), rng);
  return [...fresh, ...played].slice(0, n);
}

/**
 * Party mode, before each game: move on, and return the games to vote between – or null when the
 * tournament is over (all its games played, or none of the games can be played any more).
 */
export function nextVote(t: Tournament, pool: readonly GameId[], rng: Rng = Math.random): GameId[] | null {
  if (!hasNext(t)) return null;
  const choices = partyChoices(t, pool, rng);
  if (choices.length === 0) {
    t.total = t.index + 1;
    return null;
  }
  t.index++;
  return choices;
}

/** Party mode: the vote is in – this is the game being played now. */
export function setVoted(t: Tournament, game: GameId) {
  t.games[t.index] = game;
}

/**
 * Party mode, the draw (as in Ultimate Chicken Horse): every vote is a ticket, and one ticket wins.
 * Without a single vote every choice gets one ticket. Returns the tickets (choice indices, in order)
 * and the index of the winning ticket.
 */
export function drawVote(votes: readonly (number | null)[], choices: number, rng: Rng = Math.random): { tickets: number[]; win: number } {
  let tickets = votes.filter((v): v is number => v !== null && v >= 0 && v < choices).sort((a, b) => a - b);
  if (tickets.length === 0) tickets = Array.from({ length: choices }, (_, i) => i);
  return { tickets, win: Math.min(tickets.length - 1, Math.floor(rng() * tickets.length)) };
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
  t.total = t.games.length;
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
