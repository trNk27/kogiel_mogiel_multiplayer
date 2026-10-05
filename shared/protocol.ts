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

export type GameId = 'trails' | 'quiz' | 'ballpark' | 'kitchen' | 'toty' | 'rally';

export interface GameInfo {
  id: GameId;
  title: string;
  tagline: string;
  minPlayers: number;
  /** Most players the game takes (default MAX_PLAYERS). */
  maxPlayers?: number;
}

export const GAMES: readonly GameInfo[] = [
  { id: 'trails', title: 'Trails', tagline: 'Steer your noodle. Don’t touch anything.', minPlayers: 2 },
  { id: 'quiz', title: 'Quiz', tagline: '10 questions. Fast fingers win.', minPlayers: 1 },
  { id: 'ballpark', title: 'Ballpark', tagline: 'Guess the number. Bet on the closest.', minPlayers: 1 },
  { id: 'kitchen', title: 'Pierogi Panic', tagline: 'Co-op cooking. Serve every order in time.', minPlayers: 1 },
  { id: 'rally', title: 'Maluch Rally', tagline: 'Split-screen racing for up to 4. Your thumb is the wheel.', minPlayers: 1, maxPlayers: 4 },
  { id: 'toty', title: 'To Ty!', tagline: 'Selfies, “who’s most likely to…” and doodles.', minPlayers: 3 },
];

export function gameInfo(id: GameId): GameInfo {
  return GAMES.find((g) => g.id === id)!;
}

/** Why a game can't start with this many players in the room, or null if it can. */
export function playerCountProblem(info: GameInfo, connected: number, inRoom: number): string | null {
  if (connected < info.minPlayers) return `${info.title} needs at least ${info.minPlayers} players.`;
  if (info.maxPlayers && inRoom > info.maxPlayers) return `${info.title} is for up to ${info.maxPlayers} players.`;
  return null;
}

export interface LobbyOptions {
  /** Trails v2: power-ups. */
  powerups: boolean;
  /** TV sound effects. */
  sound: boolean;
  /** Pierogi Panic: how often orders arrive, 1 (relaxed) to 5 (chaos). */
  difficulty: number;
  /** Pierogi Panic: level to start from (1-based). */
  level: number;
  /** Maluch Rally: item boxes on the track. */
  items: boolean;
}

export const DEFAULT_OPTIONS: LobbyOptions = { powerups: false, sound: true, difficulty: 3, level: 1, items: true };

export const DIFFICULTIES = [
  { name: 'Relaxed', pace: 1.6, ttl: 1.3 },
  { name: 'Easy', pace: 1.3, ttl: 1.15 },
  { name: 'Normal', pace: 1, ttl: 1 },
  { name: 'Hard', pace: 0.8, ttl: 0.9 },
  { name: 'Chaos', pace: 0.62, ttl: 0.8 },
] as const;

export function difficultyName(d: number) {
  return DIFFICULTIES[Math.max(1, Math.min(5, Math.round(d))) - 1].name;
}

/** Pierogi Panic levels, in order (details live with the game). */
export const KITCHEN_LEVELS = [
  { name: 'Babcia’s Kitchen', news: 'Potato & cheese pierogi, boiled' },
  { name: 'The Village Inn', news: 'New fillings: sauerkraut and meat' },
  { name: 'The Wedding Feast', news: 'Blueberries – and fried pierogi in the pans!' },
] as const;

/** Maluch Rally items. You pick one up from a ? box and fire it by lifting your thumb. */
export type RallyItem = 'boost' | 'butter' | 'pickle' | 'lid' | 'storm' | 'rocket';

export const RALLY_ITEMS: Record<RallyItem, { name: string; does: string }> = {
  boost: { name: 'Kompot Boost', does: 'A burst of speed' },
  butter: { name: 'Butter Slick', does: 'Dropped behind you – anyone who drives over it spins' },
  pickle: { name: 'Pickle Missile', does: 'Chases the car in front of you' },
  lid: { name: 'Pot Lid', does: 'Blocks the next hit' },
  storm: { name: 'Thunderstorm', does: 'Slows down everyone ahead of you' },
  rocket: { name: 'Maluch Rocket', does: 'Drives itself, very fast, and nothing can stop it' },
};

/** What's happening to a car right now (for the phone). */
export type RallyEffect = 'spin' | 'rocket' | 'boost' | 'shield' | 'slow';

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
// Pierogi Panic (co-op kitchen)
// ---------------------------------------------------------------------------

export type Filling = 'potato' | 'cabbage' | 'meat' | 'berry';

export const FILLINGS: readonly { id: Filling; name: string; hex: string }[] = [
  { id: 'potato', name: 'Potato & cheese', hex: '#f3cf6b' },
  { id: 'cabbage', name: 'Sauerkraut', hex: '#a9c94a' },
  { id: 'meat', name: 'Meat', hex: '#c0583a' },
  { id: 'berry', name: 'Blueberry', hex: '#5a4bb5' },
];

export function fillingInfo(f: Filling) {
  return FILLINGS.find((x) => x.id === f)!;
}

/** Something a cook can carry or put down. */
export type KitchenItem =
  | { k: 'flour' }
  | { k: 'dough' }
  | { k: 'fill'; f: Filling }
  | { k: 'raw'; f: Filling }
  /** A clean plate, optionally with boiled (or fried) pierogi on it. */
  | { k: 'plate'; f?: Filling; fried?: boolean }
  | { k: 'dirty'; n: number };

export type KitchenMiniKind = 'roll' | 'fold' | 'boil' | 'fry' | 'wash';

export interface KitchenMini {
  /** Unique per started minigame, so stale messages can be ignored. */
  id: number;
  kind: KitchenMiniKind;
  f?: Filling;
}

// ---------------------------------------------------------------------------
// To Ty! ("That's you!": selfies, votes about each other, doodles on photos)
// ---------------------------------------------------------------------------

/** Selfies are square JPEG data URLs. Phones shrink them until they fit. */
export const PHOTO_SIZE = 320;
export const MAX_PHOTO_CHARS = 56_000;
/** Doodles live on a 1000 × 1000 canvas laid over the photo. */
export const DOODLE_SPACE = 1000;
export const DOODLE_COLORS = ['#2a120a', '#fff4dc', '#ff3d6e', '#ffd23f', '#2fd6a8', '#4f9dff', '#ff8a2a', '#b27bff'] as const;
export const DOODLE_WIDTHS = [10, 24, 48] as const;
/** Upper bound on points in one doodle, which keeps a doodle message well under the relay limit. */
export const MAX_DOODLE_POINTS = 2500;
/** One stroke: [colour index, width index, x0, y0, x1, y1, …] with coordinates in 0..DOODLE_SPACE. */
export type Stroke = number[];

export interface TyPlayer {
  id: string;
  name: string;
  color: ColorId;
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
  | {
      v: 'kitchen';
      phase: 'prep' | 'play' | 'over';
      hold: KitchenItem | null;
      /** What the action button does right now ("Take flour"), or null if nothing. */
      hint: string | null;
      mini: KitchenMini | null;
      score: number;
      /** 1-based level number and how many levels there are. */
      level: number;
      levels: number;
    }
  /** Maluch Rally. `pos` is your current race position (1-based) out of `of`. */
  | {
      v: 'rally';
      phase: 'countdown' | 'race' | 'finished' | 'standings';
      race: number;
      races: number;
      lap: number;
      laps: number;
      pos: number;
      of: number;
      item: RallyItem | null;
      fx: RallyEffect | null;
    }
  /** To Ty! Take a selfie. `rev` is the host's version of your photo (null = none yet). */
  | { v: 'tySelfie'; id: string; endsAt: number; rev: number | null; done: boolean }
  /** To Ty! Vote for a player. `ph` maps player id → photo version, so the phone can fetch missing photos. */
  | {
      v: 'tyVote';
      q: number;
      total: number;
      question: string;
      double: boolean;
      endsAt: number;
      players: TyPlayer[];
      ph: Record<string, number>;
      picked: string | null;
    }
  | { v: 'tyDraw'; prompt: string; subject: TyPlayer; ph: Record<string, number>; endsAt: number; done: boolean }
  /** To Ty! Vote for the best doodle, by the letter shown on the TV. */
  | { v: 'tyPick'; endsAt: number; letters: string[]; mine: number | null; picked: number | null }
  | {
      v: 'tyResult';
      kind: 'vote' | 'doodle';
      points: number;
      total: number;
      /** Vote rounds: the room's pick(s) and whether you matched them. */
      winners?: string[];
      matched?: boolean;
      /** Votes you (or your doodle) received. */
      votes: number;
    }
  | {
      v: 'results';
      game: GameId;
      place: number;
      score: number;
      players: number;
      vip: boolean;
      /** Co-op games: the team result instead of a place. */
      coop?: { stars: number; score: number };
    };

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
  /** Joystick, each axis -100..100 (Pierogi Panic: walk; Maluch Rally: x steers, -y is gas). Sent when it changes (throttled). */
  | { t: 'stick'; x: number; y: number }
  /** Pierogi Panic action button; Maluch Rally: use your item (sent when the thumb lifts). */
  | { t: 'act' }
  /** Pierogi Panic station minigame: progress (0..1), finished or abandoned. */
  | { t: 'mini'; id: number; ev: 'prog' | 'done' | 'cancel'; p?: number }
  /** To Ty! selfie as a JPEG data URL, '' to skip and be a pierogi, or 'keep' for last game's photo. */
  | { t: 'selfie'; data: string }
  /** To Ty! Ask the host for photos this phone is missing. */
  | { t: 'photos'; ids: string[] }
  /** To Ty! Vote for a player. */
  | { t: 'vote'; id: string }
  /** To Ty! Vote for a doodle, by its position in the gallery. */
  | { t: 'pick'; i: number }
  | { t: 'doodle'; strokes: Stroke[] }
  // VIP-only actions (the host ignores them from anybody else)
  | { t: 'select'; game: GameId }
  | { t: 'option'; key: keyof LobbyOptions; value: boolean | number }
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
  /** To Ty! A player's selfie (`data` '' = no photo, show their pierogi). */
  | { t: 'photo'; id: string; rev: number; data: string }
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
