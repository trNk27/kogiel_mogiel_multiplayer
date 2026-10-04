/**
 * Shared, typed message protocol used by the TV host, the phones and the Worker.
 *
 * Topology:  phone  <->  RoomDO (relay)  <->  host (TV, authoritative)
 *
 * The Durable Object never interprets game messages. It only:
 *  - tells the host when phones connect / disconnect,
 *  - wraps phone messages with the sender's playerId and forwards them to the host,
 *  - delivers host messages to one, several or all phones.
 *
 * All messages are JSON objects with a short `t` (type) discriminator to keep payloads small.
 */

// ---------------------------------------------------------------------------
// Room codes & identifiers
// ---------------------------------------------------------------------------

/** Room code alphabet: no I, O or Q (too easily confused with 1, 0 and O). */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPRSTUVWXYZ';
export const CODE_LENGTH = 4;
export const CODE_RE = /^[ABCDEFGHJKLMNPRSTUVWXYZ]{4}$/;
export const PLAYER_ID_RE = /^[A-Za-z0-9_-]{8,40}$/;

export const MAX_PLAYERS = 8;
export const MAX_NAME_LENGTH = 12;
/** How long the host keeps a disconnected player's slot (ms). */
export const RECONNECT_GRACE_MS = 60_000;
/** Rooms with no traffic for this long are destroyed. */
export const ROOM_IDLE_MS = 30 * 60_000;
/** Phones and host send "ping"; the Durable Object auto-replies "pong" without waking up. */
export const PING = 'ping';
export const PONG = 'pong';

export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z]/g, '').slice(0, CODE_LENGTH);
}

export function sanitizeName(raw: string): string {
  return raw.replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH);
}

// ---------------------------------------------------------------------------
// Player colours (named after Polish food, of course)
// ---------------------------------------------------------------------------

export const PLAYER_COLORS = [
  { id: 'beetroot', name: 'Beetroot', hex: '#ff3d6e' },
  { id: 'paprika', name: 'Paprika', hex: '#ff8a2a' },
  { id: 'yolk', name: 'Egg Yolk', hex: '#ffd23f' },
  { id: 'pickle', name: 'Pickle', hex: '#a3e048' },
  { id: 'dill', name: 'Dill', hex: '#2fd6a8' },
  { id: 'blueberry', name: 'Blueberry', hex: '#4f9dff' },
  { id: 'plum', name: 'Plum', hex: '#b27bff' },
  { id: 'raspberry', name: 'Raspberry', hex: '#ff7ad1' },
  { id: 'sourcream', name: 'Sour Cream', hex: '#fff4dc' },
] as const;

export type ColorId = (typeof PLAYER_COLORS)[number]['id'];

export function colorHex(id: ColorId | string): string {
  return PLAYER_COLORS.find((c) => c.id === id)?.hex ?? '#ffffff';
}
export function colorName(id: ColorId | string): string {
  return PLAYER_COLORS.find((c) => c.id === id)?.name ?? id;
}
export function isColorId(x: unknown): x is ColorId {
  return typeof x === 'string' && PLAYER_COLORS.some((c) => c.id === x);
}

/** Answer colours for the quiz – shared so phone buttons exactly match the TV. */
export const ANSWER_STYLES = [
  { hex: '#e8335a', shape: 'triangle', label: 'Beetroot' },
  { hex: '#3d7eff', shape: 'diamond', label: 'Blueberry' },
  { hex: '#f2b705', shape: 'circle', label: 'Egg Yolk' },
  { hex: '#4caf50', shape: 'square', label: 'Pickle' },
] as const;

// ---------------------------------------------------------------------------
// Games
// ---------------------------------------------------------------------------

export type GameId = 'trails' | 'quiz' | 'ballpark';

export interface GameInfo {
  id: GameId;
  title: string;
  tagline: string;
  minPlayers: number;
}

export const GAMES: readonly GameInfo[] = [
  { id: 'trails', title: 'Trails', tagline: 'Steer your noodle. Don’t touch anything.', minPlayers: 2 },
  { id: 'quiz', title: 'Quiz', tagline: '10 questions. Fast fingers win.', minPlayers: 1 },
  { id: 'ballpark', title: 'Ballpark', tagline: 'Guess the number. Bet on the closest.', minPlayers: 1 },
];

export function gameInfo(id: GameId): GameInfo {
  return GAMES.find((g) => g.id === id)!;
}

export interface LobbyOptions {
  /** Trails v2: power-ups. */
  powerups: boolean;
  /** TV sound effects. */
  sound: boolean;
}

export interface PlayerSummary {
  id: string;
  name: string;
  color: ColorId;
  connected: boolean;
  vip: boolean;
}

/** One slot on the Ballpark betting board. */
export interface BetSlot {
  /** Lower bound of this slot (the guess). `null` = "smaller than every guess". */
  value: number | null;
  /** Payout multiplier. */
  payout: number;
  /** Names of the players who guessed this value. */
  guessers: string[];
}

// ---------------------------------------------------------------------------
// What a phone should show. The host sends a view only when it changes,
// and re-sends the current one when a phone reconnects.
// ---------------------------------------------------------------------------

export type PhoneView =
  | {
      v: 'lobby';
      vip: boolean;
      selected: GameId;
      options: LobbyOptions;
      /** Only filled for the VIP (used for kicking). */
      players: PlayerSummary[];
      playerCount: number;
      vipName: string;
    }
  | { v: 'wait'; title: string; text?: string; icon?: string }
  | {
      v: 'trails';
      phase: 'countdown' | 'play' | 'dead' | 'roundOver';
      score: number;
      target: number;
      round: number;
      /** Name of the round winner when phase === 'roundOver'. */
      winner?: string | null;
    }
  | {
      v: 'quiz';
      phase: 'answer' | 'locked';
      q: number;
      total: number;
      /** Deadline in host clock ms (see the `now` field of the view message). */
      endsAt: number;
      picked: number | null;
    }
  | { v: 'quizResult'; correct: boolean | null; points: number; total: number; rank: number }
  | { v: 'bpGuess'; q: number; total: number; question: string; unit: string; endsAt: number; submitted: number | null }
  | { v: 'bpBet'; slots: BetSlot[]; unit: string; endsAt: number; picked: number | null }
  | { v: 'bpResult'; guessWon: boolean; betWon: boolean; points: number; total: number }
  | { v: 'results'; game: GameId; place: number; score: number; players: number; vip: boolean };

// ---------------------------------------------------------------------------
// Phone -> host (relayed by the Durable Object)
// ---------------------------------------------------------------------------

export type PhoneMsg =
  | { t: 'join'; name: string; color: ColorId }
  /** Trails steering: sent only when the pressed state changes. */
  | { t: 'steer'; l: boolean; r: boolean }
  | { t: 'answer'; i: number }
  | { t: 'guess'; value: number }
  | { t: 'bet'; slot: number }
  // VIP-only actions (the host ignores them from anybody else)
  | { t: 'select'; game: GameId }
  | { t: 'option'; key: keyof LobbyOptions; value: boolean }
  | { t: 'start' }
  | { t: 'kick'; id: string }
  | { t: 'again' }
  | { t: 'lobby' };

// ---------------------------------------------------------------------------
// Host -> phone (relayed by the Durable Object)
// ---------------------------------------------------------------------------

export type HostToPhone =
  /** Sent to a phone the host does not know yet (or no longer knows). */
  | { t: 'hello'; taken: ColorId[]; full: boolean; inGame: boolean }
  | { t: 'joinError'; reason: string; taken: ColorId[] }
  /** `now` is the host's clock when sending, so phones can convert `endsAt` deadlines. */
  | { t: 'view'; view: PhoneView; me: { name: string; color: ColorId; vip: boolean }; now: number }
  | { t: 'buzz'; pattern: number[] }
  | { t: 'kicked' };

/** Extra messages the Durable Object itself sends to phones. */
export type ServerToPhone =
  | HostToPhone
  | { t: 'host'; online: boolean }
  | { t: 'err'; code: 'no_room' | 'bad_request' };

// ---------------------------------------------------------------------------
// Host <-> Durable Object
// ---------------------------------------------------------------------------

export type HostToServer =
  | { t: 'to'; ids: string[]; m: HostToPhone }
  | { t: 'all'; m: HostToPhone }
  /** Close a player's connection (after kicking them). */
  | { t: 'drop'; id: string };

export type ServerToHost =
  /** Sent right after the host (re)connects: ids of phones currently connected. */
  | { t: 'room'; code: string; players: string[] }
  | { t: 'conn'; id: string }
  | { t: 'disc'; id: string }
  | { t: 'msg'; id: string; m: PhoneMsg };

// ---------------------------------------------------------------------------
// HTTP API
// ---------------------------------------------------------------------------

export interface CreateRoomResponse {
  code: string;
  hostKey: string;
}

export interface RoomInfoResponse {
  exists: boolean;
}

/** WebSocket close codes used by the relay. */
export const CLOSE = {
  replaced: 4000,
  kicked: 4002,
  expired: 4004,
  noRoom: 4404,
  forbidden: 4403,
} as const;
