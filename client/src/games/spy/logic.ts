/**
 * Szpieg (“spy”): everyone gets the secret word except the spy. One-word clues in turn, then a vote.
 * Pure rules – no DOM – so they can be unit-tested. The flow and timers live in SpyGame.tsx.
 */
import type { Rng } from '../rng';

export interface SpyWord {
  w: string;
  /** Optional emoji for the word. */
  e?: string;
}

export interface SpyCategory {
  name: string;
  icon: string;
  words: SpyWord[];
}

export const WORDS_PER_CATEGORY = 16;
/** Everybody looks at their secret card. */
export const CARD_MS = 9000;
/** One clue. */
export const CLUE_MS = 25_000;
/** A player who isn't connected when their turn comes is skipped this quickly. */
export const OFFLINE_TURN_MS = 3000;
export const VOTE_MS = 30_000;
/** The caught spy's last guess. */
export const GUESS_MS = 20_000;
export const MAX_CLUE = 20;
/** The clue of a player who ran out of time. */
export const SKIPPED = '…';

export const SPY_ESCAPE_POINTS = 300;
export const SPY_STEAL_POINTS = 200;
export const CATCH_POINTS = 100;
/** Extra, for each non-spy who voted for the spy (when the spy is caught and guesses wrong). */
export const VOTE_BONUS = 100;

/** One round per player (3 to 6); three in a tournament. */
export function roundsFor(players: number, short = false): number {
  return short ? 3 : Math.min(6, Math.max(3, players));
}

/** Small groups go round the table twice. */
export function lapsFor(players: number): number {
  return players <= 4 ? 2 : 1;
}

/**
 * Pick the spy. `history` is the spy of every earlier round, in order. Never last round's spy (unless
 * nobody else is left), and among the rest whoever has been the spy the fewest times.
 */
export function pickSpy(ids: readonly string[], history: readonly string[], rng: Rng = Math.random): string {
  const last = history[history.length - 1];
  let pool = ids.filter((id) => id !== last);
  if (pool.length === 0) pool = [...ids];
  const times = (id: string) => history.filter((h) => h === id).length;
  const fewest = Math.min(...pool.map(times));
  pool = pool.filter((id) => times(id) === fewest);
  return pool[Math.floor(rng() * pool.length) % pool.length];
}

/** A category not played yet in this session (`used` holds names; it starts over once all are used). Mutates `used`. */
export function pickCategory(pool: readonly SpyCategory[], used: Set<string>, rng: Rng = Math.random): SpyCategory {
  let fresh = pool.filter((c) => !used.has(c.name));
  if (fresh.length === 0) {
    used.clear();
    fresh = [...pool];
  }
  const c = fresh[Math.floor(rng() * fresh.length) % fresh.length];
  used.add(c.name);
  return c;
}

/** How words compare: lower case, no accents, letters and digits only. "Kraków" = "krakow". */
export function wordKey(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/ł/g, 'l')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

export type ClueCheck = { ok: true; clue: string } | { ok: false; error: string };

/**
 * Check a typed clue: one word (no spaces), at most MAX_CLUE characters, some letters or digits.
 * Players who know the word can't say it (or a long part of it); the spy is never told, as that would
 * give the word away.
 */
export function checkClue(raw: unknown, secret: string, isSpy: boolean): ClueCheck {
  if (typeof raw !== 'string') return { ok: false, error: 'Type a word first.' };
  const clue = raw
    .replace(/\s+/g, ' ')
    .replace(/[\u0000-\u001f<>]/g, '')
    .trim();
  if (!clue) return { ok: false, error: 'Type a word first.' };
  if (/\s/.test(clue)) return { ok: false, error: 'One word only – no spaces!' };
  if ([...clue].length > MAX_CLUE) return { ok: false, error: `Too long – ${MAX_CLUE} letters at most.` };
  const key = wordKey(clue);
  if (!key) return { ok: false, error: 'Use letters, please.' };
  if (!isSpy) {
    if (key === wordKey(secret)) return { ok: false, error: 'That’s the secret word! Give a clue instead.' };
    const parts = secret
      .split(/[\s-]+/)
      .map(wordKey)
      .filter((p) => p.length > 3);
    if (parts.includes(key)) return { ok: false, error: 'That’s part of the secret word – try another!' };
  }
  return { ok: true, clue };
}

/** Who gives clues when: everybody in seat order from `start`, `laps` times round. */
export function turnOrder(ids: readonly string[], start: number, laps: number): string[] {
  const n = ids.length;
  const out: string[] = [];
  for (let lap = 0; lap < laps; lap++) for (let k = 0; k < n; k++) out.push(ids[(((start + k) % n) + n) % n]);
  return out;
}

export interface Tally {
  /** Votes per player (every player in `ids`, 0 if nobody picked them). */
  counts: Record<string, number>;
  /** The players with the most votes (empty if nobody got any). */
  top: string[];
  max: number;
}

/** Count the votes. Votes by or for players not in `ids`, and votes for yourself, don't count. */
export function tallyVotes(votes: ReadonlyMap<string, string> | Record<string, string>, ids: readonly string[]): Tally {
  const counts: Record<string, number> = {};
  for (const id of ids) counts[id] = 0;
  const entries = votes instanceof Map ? [...votes.entries()] : Object.entries(votes);
  for (const [voter, target] of entries) {
    if (voter === target || !(voter in counts) || !(target in counts)) continue;
    counts[target]++;
  }
  const max = Math.max(0, ...Object.values(counts));
  return { counts, max, top: max > 0 ? ids.filter((id) => counts[id] === max) : [] };
}

/** The spy is caught only with strictly the most votes: a tie means the spy escapes. */
export function isCaught(t: Tally, spy: string): boolean {
  return t.top.length === 1 && t.top[0] === spy;
}

/** escaped: not caught · stole: caught, but guessed the word · caught: caught and guessed wrong · void: the spy left. */
export type Outcome = 'escaped' | 'stole' | 'caught' | 'void';

/** Round points for everyone in `ids`. */
export function scoreRound(outcome: Outcome, ids: readonly string[], spy: string, votes: ReadonlyMap<string, string>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of ids) out[id] = 0;
  if (outcome === 'escaped' && spy in out) out[spy] += SPY_ESCAPE_POINTS;
  else if (outcome === 'stole' && spy in out) out[spy] += SPY_STEAL_POINTS;
  else if (outcome === 'caught') for (const id of ids) if (id !== spy) out[id] += CATCH_POINTS + (votes.get(id) === spy ? VOTE_BONUS : 0);
  return out;
}

export interface Clue {
  id: string;
  text: string;
  /** 0 for the first time round the table. */
  lap: number;
  skipped?: boolean;
}

/** One round: the spy, the word, the clues, the votes and the spy's last guess. */
export class SpyRound {
  /** The players at the start, in seat order (the clue board's columns). */
  readonly seats: string[];
  /** The players still here. */
  ids: string[];
  readonly order: string[];
  readonly laps: number;
  turn = 0;
  clues: Clue[] = [];
  votes = new Map<string, string>();
  /** Voting is over: the tally is final (removals no longer change it). */
  tally: Tally | null = null;
  guess: number | null = null;
  /** The spy left before the round was scored. */
  void = false;
  settled = false;

  constructor(
    ids: readonly string[],
    readonly spy: string,
    readonly category: SpyCategory,
    readonly word: number,
    start = 0,
    laps = lapsFor(ids.length),
  ) {
    this.seats = [...ids];
    this.ids = [...ids];
    this.laps = laps;
    this.order = turnOrder(ids, start, laps);
  }

  get secret(): string {
    return this.category.words[this.word]?.w ?? '';
  }

  /** Whose turn it is to give a clue (undefined once everyone has). */
  get current(): string | undefined {
    return this.order[this.turn];
  }

  get lap(): number {
    return Math.floor(this.turn / Math.max(1, this.seats.length));
  }

  get cluesDone(): boolean {
    return this.turn >= this.order.length;
  }

  cluesBy(id: string): Clue[] {
    return this.clues.filter((c) => c.id === id);
  }

  giveClue(id: string, raw: unknown): ClueCheck {
    if (this.void || this.cluesDone || id !== this.current) return { ok: false, error: 'It’s not your turn.' };
    const c = checkClue(raw, this.secret, id === this.spy);
    if (c.ok) {
      this.clues.push({ id, text: c.clue, lap: this.lap });
      this.next();
    }
    return c;
  }

  /** The current player ran out of time. */
  skip() {
    const id = this.current;
    if (id === undefined) return;
    this.clues.push({ id, text: SKIPPED, lap: this.lap, skipped: true });
    this.next();
  }

  private next() {
    this.turn++;
    while (this.turn < this.order.length && !this.ids.includes(this.order[this.turn])) this.turn++;
  }

  /** The players `voter` can vote for, in seat order. */
  candidates(voter: string): string[] {
    return this.seats.filter((id) => id !== voter && this.ids.includes(id));
  }

  vote(voter: string, target: string): boolean {
    if (this.tally || this.void || this.votes.has(voter) || !this.ids.includes(voter) || !this.candidates(voter).includes(target)) return false;
    this.votes.set(voter, target);
    return true;
  }

  /** End the vote. */
  lock(): Tally {
    if (!this.tally) this.tally = tallyVotes(this.votes, this.ids);
    return this.tally;
  }

  get caught(): boolean {
    return !!this.tally && isCaught(this.tally, this.spy);
  }

  /** The caught spy picks a word (index into the category). */
  guessWord(i: number): boolean {
    if (!this.caught || this.guess !== null || this.void || !Number.isInteger(i) || i < 0 || i >= this.category.words.length) return false;
    this.guess = i;
    return true;
  }

  get guessedRight(): boolean {
    return this.guess === this.word;
  }

  outcome(): Outcome {
    if (this.void) return 'void';
    if (!this.caught) return 'escaped';
    return this.guessedRight ? 'stole' : 'caught';
  }

  /** Score the round (once). */
  settle(): Record<string, number> {
    if (!this.tally && !this.void) this.lock();
    this.settled = true;
    return scoreRound(this.outcome(), this.ids, this.spy, this.votes);
  }

  points(): Record<string, number> {
    return scoreRound(this.outcome(), this.ids, this.spy, this.votes);
  }

  /**
   * A player left. Their clue turns are skipped; before the vote is over their vote and votes for them
   * are dropped (those voters vote again). If the spy leaves before the round is scored, it is void.
   */
  remove(id: string): 'spy' | 'current' | 'other' | 'none' {
    if (!this.ids.includes(id)) return 'none';
    const wasCurrent = !this.cluesDone && this.current === id;
    this.ids = this.ids.filter((x) => x !== id);
    if (!this.tally) {
      this.votes.delete(id);
      for (const [voter, target] of [...this.votes]) if (target === id) this.votes.delete(voter);
    }
    if (id === this.spy) {
      if (!this.settled) this.void = true;
      return 'spy';
    }
    if (wasCurrent) {
      this.next();
      return 'current';
    }
    return 'other';
  }
}

export function howTo(short: boolean): string[] {
  return [
    'Everyone gets the secret word – except the spy 🕵️',
    'One-word clues in turn, then vote out the spy',
    short ? 'Three rounds · a caught spy gets one last guess' : 'A round per player · a caught spy gets one last guess',
  ];
}
