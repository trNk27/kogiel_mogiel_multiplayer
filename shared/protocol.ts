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

export type GameId =
  | 'trails'
  | 'quiz'
  | 'ballpark'
  | 'kitchen'
  | 'toty'
  | 'bazgroly'
  | 'rally'
  | 'pedal'
  | 'fork'
  | 'parade'
  | 'tanks'
  | 'mushroom'
  | 'pushy'
  | 'gallery'
  | 'cookbook'
  | 'tiles'
  | 'swap'
  | 'smoke';

export interface GameInfo {
  id: GameId;
  title: string;
  tagline: string;
  minPlayers: number;
  /** Most players the game takes with a TV (default MAX_PLAYERS). */
  maxPlayers?: number;
  /**
   * Games that work without a TV (every phone shows its own screen) have a tagline for that mode.
   * Without a TV there's no split screen, so the player limit is MAX_PLAYERS.
   */
  noTv?: string;
  /** Co-op games (everybody wins or loses together) are left out of tournaments. */
  coop?: boolean;
}

export const GAMES: readonly GameInfo[] = [
  { id: 'trails', title: 'Trails', tagline: 'Steer your noodle. Touch nothing.', minPlayers: 2 },
  { id: 'quiz', title: 'Quiz', tagline: '10 questions. Fast fingers win.', minPlayers: 1 },
  { id: 'ballpark', title: 'Ballpark', tagline: 'Guess the number. Bet on the closest.', minPlayers: 1 },
  { id: 'kitchen', title: 'Pierogi Panic', tagline: 'Co-op cooking against the clock.', minPlayers: 1, coop: true },
  {
    id: 'rally',
    title: 'Maluch Rally', tagline: 'Little cars, big drifts. Up to 4.',
    minPlayers: 1,
    maxPlayers: 4,
    noTv: 'Racing on every phone. Up to 8 cars.',
  },
  { id: 'toty', title: 'To Ty!', tagline: 'Selfies, votes and doodles.', minPlayers: 3 },
  { id: 'bazgroly', title: 'Bazgroły', tagline: 'Draw it. Fake it. Spot the real title.', minPlayers: 3 },
  { id: 'pedal', title: 'Tour de Pierogi', tagline: 'Left, right, left – as fast as you can.', minPlayers: 1 },
  { id: 'fork', title: 'Fork Fight', tagline: 'Stab the pierogi. Spare the sock.', minPlayers: 1 },
  { id: 'parade', title: 'Pierogi Parade', tagline: 'Count your colour in the crowd.', minPlayers: 1 },
  { id: 'swap', title: 'Podmianka', tagline: 'Remember the shelves. Spot the swap.', minPlayers: 1 },
  { id: 'tanks', title: 'Czołgi', tagline: 'Bouncing shells. Last tank rolling.', minPlayers: 2 },
  { id: 'mushroom', title: 'Grzybki', tagline: 'Run to the mushroom Babcia calls.', minPlayers: 2 },
  { id: 'pushy', title: 'Pushy Pierogi', tagline: 'Shove everyone off the ice.', minPlayers: 2 },
  { id: 'gallery', title: 'Strzelnica', tagline: 'Pop the ghosts. Spare the babcias.', minPlayers: 1 },
  { id: 'cookbook', title: 'Babcia’s Cookbook', tagline: 'Squeeze into the hole in the page.', minPlayers: 1 },
  { id: 'tiles', title: 'Kafelki', tagline: 'Paint the floor your colour.', minPlayers: 2 },
  { id: 'smoke', title: 'Fajki', tagline: 'Grab your colour. Puff it right.', minPlayers: 1 },
];

export function gameInfo(id: GameId): GameInfo {
  return GAMES.find((g) => g.id === id)!;
}

/** Games you can pick in a room with (or without) a TV. */
export function gamesFor(noTv: boolean): readonly GameInfo[] {
  return noTv ? GAMES.filter((g) => g.noTv) : GAMES;
}

/** What the VIP has picked in the lobby: one game, or a tournament of several. */
export type Selection = GameId | 'tournament';

/** A tournament plays this many games by default, picked at random from the competitive ones. */
export const TOURNAMENT_GAMES = 5;
/** The VIP can set the length of a tournament between these. */
export const TOURNAMENT_MIN_GAMES = 2;
export const TOURNAMENT_MAX_GAMES = 10;
export const TOURNAMENT_MIN_PLAYERS = 2;
/** Games that can ever be in a tournament (the competitive ones). */
export const TOURNAMENT_CANDIDATES: readonly GameId[] = GAMES.filter((g) => !g.coop).map((g) => g.id);
/** Tournament points for 1st, 2nd, 3rd… place in each game (ties share a place). */
export const TOURNAMENT_POINTS = [10, 7, 5, 3, 2, 1, 0, 0] as const;

export function tournamentPoints(place: number): number {
  return TOURNAMENT_POINTS[place - 1] ?? 0;
}

/** Games a tournament can pick from with these players: competitive ones that can start and aren't switched off. */
export function tournamentPool(connected: number, inRoom: number, off: readonly GameId[] = []): GameId[] {
  return GAMES.filter((g) => !g.coop && !off.includes(g.id) && playerCountProblem(g, connected, inRoom) === null).map((g) => g.id);
}

/** How many games a tournament will play: what the VIP asked for, or fewer if not enough games are on. */
export function tournamentLength(wanted: number, poolSize: number): number {
  return Math.min(wanted, poolSize);
}

/** Why a tournament can't start, or null if it can. */
export function tournamentProblem(connected: number, inRoom: number, noTv = false, off: readonly GameId[] = []): string | null {
  if (noTv) return 'A tournament needs a TV.';
  if (connected < TOURNAMENT_MIN_PLAYERS) return `A tournament needs at least ${TOURNAMENT_MIN_PLAYERS} players.`;
  if (tournamentPool(connected, inRoom, off).length < TOURNAMENT_MIN_GAMES)
    return off.length ? `Switch on at least ${TOURNAMENT_MIN_GAMES} games that suit ${inRoom} players.` : `Not enough games for ${inRoom} players.`;
  return null;
}

/** Why a game can't start with this many players in the room, or null if it can. */
export function playerCountProblem(info: GameInfo, connected: number, inRoom: number, noTv = false): string | null {
  if (noTv && !info.noTv) return `${info.title} needs a TV.`;
  if (connected < info.minPlayers) return `${info.title} needs at least ${info.minPlayers} players.`;
  const max = noTv ? MAX_PLAYERS : info.maxPlayers;
  if (max && inRoom > max) return `${info.title} is for up to ${max} players.`;
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
  /** Maluch Rally: which tracks the cup is raced on (an id from RALLY_TRACKS). */
  track: string;
  /** Tournament: how many games (TOURNAMENT_MIN_GAMES to TOURNAMENT_MAX_GAMES). */
  tourGames: number;
  /** Tournament: play the short versions of the games. */
  tourShort: boolean;
  /** Tournament: games the VIP switched off (everything else can be drawn). */
  tourOff: GameId[];
  /** Tournament party mode: before every game, walk onto one of three games to vote for it. */
  tourParty: boolean;
}

export const DEFAULT_OPTIONS: LobbyOptions = {
  powerups: false,
  sound: true,
  difficulty: 3,
  level: 1,
  items: true,
  track: 'cup',
  tourGames: TOURNAMENT_GAMES,
  tourShort: true,
  tourOff: [],
  tourParty: false,
};

/**
 * Maluch Rally track choices: a cup of three different tracks, a cup of three hard ones,
 * or all three races on one kind of track (a new random layout each time).
 */
export const RALLY_TRACKS: readonly { id: string; name: string; hint: string; hard?: boolean; cup?: boolean }[] = [
  { id: 'cup', name: 'Mixed cup', hint: 'Three different tracks, mostly hard ones', cup: true },
  { id: 'hard', name: 'Hard cup', hint: 'Hairpins, S-bends and narrow barriers – drift!', cup: true, hard: true },
  { id: 'ring', name: 'Forest Ring', hint: 'Sweeping bends through the woods' },
  { id: 'kidney', name: 'Kidney Bend', hint: 'One long hook' },
  { id: 'clover', name: 'Clover Hills', hint: 'Three or four lobes' },
  { id: 'figure8', name: 'Figure Eight', hint: 'Over and under the bridge' },
  { id: 'town', name: 'Town Circuit', hint: 'Right-angle corners between the houses' },
  { id: 'speedway', name: 'Speedway', hint: 'Fast oval with a chicane' },
  { id: 'pass', name: 'Tatra Pass', hint: 'Switchbacks up a mountain', hard: true },
  { id: 'snake', name: 'Vistula Snake', hint: 'S-bend after S-bend', hard: true },
  { id: 'crown', name: 'Babcia’s Crown', hint: 'Six lobes, tight at every tip', hard: true },
];

export function rallyTrack(id: string) {
  return RALLY_TRACKS.find((t) => t.id === id) ?? RALLY_TRACKS[0];
}

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
export type RallyItem = 'boost' | 'butter' | 'pickle' | 'lid' | 'storm' | 'rocket' | 'bomb' | 'beet' | 'ghost' | 'hay' | 'spray';

export const RALLY_ITEMS: Record<RallyItem, { name: string; does: string }> = {
  boost: { name: 'Kompot Boost', does: 'A burst of speed' },
  butter: { name: 'Butter Slick', does: 'Dropped behind you – anyone who drives over it spins' },
  pickle: { name: 'Pickle Missile', does: 'Chases the car in front of you' },
  lid: { name: 'Pot Lid', does: 'Blocks the next hit' },
  storm: { name: 'Thunderstorm', does: 'Slows down everyone ahead of you' },
  rocket: { name: 'Maluch Rocket', does: 'Drives itself, very fast, and nothing can stop it' },
  bomb: { name: 'Cabbage Bomb', does: 'Lobbed down the road – it goes off and spins everyone near it' },
  beet: { name: 'Beet Splash', does: 'Barszcz on the windscreen of everyone ahead of you' },
  ghost: { name: 'Babcia’s Ghost', does: 'Go see-through and untouchable, and steal an item from someone ahead' },
  hay: { name: 'Hay Bale', does: 'Dropped behind you – anyone who drives into it stops dead' },
  spray: { name: 'Barszcz Sprayer', does: 'Sprays a red cloud behind you – anyone who drives through it can’t see a thing' },
};

/** What's happening to a car right now (for the phone). */
export type RallyEffect = 'spin' | 'rocket' | 'boost' | 'shield' | 'slow' | 'ink' | 'ghost';

/** No-TV Maluch Rally: what each phone needs to build the race locally. */
export interface RallyNet {
  /** Track seed and shape: every phone generates the same track from them. */
  seed: number;
  shape: string;
  /** Your car. */
  idx: number;
  items: boolean;
  cars: { name: string; color: ColorId }[];
  /** When the lights go green, in host clock ms. */
  goAt: number;
  /** Seconds left for the stragglers once someone finished (host clock ms deadline), or null. */
  closesAt: number | null;
  /** Between races: this race's result and the cup so far, in finishing order. */
  board?: { idx: number; time: number | null; pts: number; cup: number }[];
}

/** Fork Fight: what can land on the plate. Only the pierogi should be stabbed. */
export type ForkItem = 'pierogi' | 'sock' | 'slipper' | 'duck';

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
// Bazgroły ("scribbles": draw a secret prompt, everyone else makes up fake titles)
// ---------------------------------------------------------------------------

/** Longest fake title a player can type. */
export const MAX_TITLE_LENGTH = 40;

// ---------------------------------------------------------------------------
// What a phone should show. The host sends a view only when it changes,
// and re-sends the current one when a phone reconnects.
// ---------------------------------------------------------------------------

export type PhoneView =
  | {
      v: 'lobby';
      vip: boolean;
      selected: Selection;
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
      /** With a TV: your drift (0 none, 1 drifting, 2 blue sparks, 3 orange sparks), so the brake button can glow. */
      drift?: number;
      /** Only in rooms without a TV: the phone shows the race itself. */
      net?: RallyNet;
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
  /** Tour de Pierogi. `goAt` (host clock ms) is when pedalling starts; `place`/`pts` once you've finished or the heat is over. */
  | {
      v: 'pedal';
      phase: 'countdown' | 'race' | 'done' | 'heatOver';
      heat: number;
      heats: number;
      goal: number;
      goAt: number;
      place: number | null;
      pts: number;
      total: number;
    }
  /**
   * Fork Fight. The plate opens at `startAt` (host clock ms); `steps` say what lands on it and when
   * (ms after it opens). `stab` is your reaction in ms, or a foul code (-1 too early, -2 a fake).
   */
  | {
      v: 'fork';
      phase: 'play' | 'result';
      round: number;
      rounds: number;
      startAt: number;
      steps: { k: ForkItem; at: number; dur: number }[];
      stab: number | null;
      place: number | null;
      pts: number;
      total: number;
    }
  /** Pierogi Parade. Count the `color` pierogi until `endsAt` (host clock ms). */
  | {
      v: 'parade';
      phase: 'ready' | 'count' | 'result';
      round: number;
      rounds: number;
      color: string;
      colorName: string;
      endsAt: number;
      res: { n: number | null; answer: number; pts: number; total: number } | null;
    }
  /**
   * Podmianka: remember the shelves on the TV; after the curtain, tap the thing that's new.
   * `items` are sprite URLs of what's on the shelves now (only once you're allowed to pick).
   */
  | {
      v: 'swap';
      phase: 'look' | 'curtain' | 'pick' | 'result';
      round: number;
      rounds: number;
      endsAt: number;
      items: string[] | null;
      picked: number | null;
      res: { correct: boolean; answer: number; added: string; removed: string; removedSrc: string; pts: number; total: number } | null;
    }
  /**
   * Arena games (Czołgi, Grzybki, Pushy Pierogi, Strzelnica, Babcia’s Cookbook, Kafelki): the phone is a
   * joystick plus up to two buttons, and the game itself is on the TV. See `PadButton`.
   */
  | PadView
  /**
   * Fajki. `hand`: empty (GRAB), reaching for the tray, holding a cigarette of your colour (`left` of
   * CIG_LENGTH still to smoke), or coughing until `coughUntil` (host clock ms). The game ends at `endsAt`.
   */
  | {
      v: 'smoke';
      phase: 'ready' | 'play' | 'over';
      goAt: number;
      endsAt: number;
      hand: 'empty' | 'reach' | 'cig' | 'cough';
      left: number;
      coughUntil: number;
      /** Bumped on every grab, so the phone can reset its gesture. */
      n: number;
    }
  /** Bazgroły: draw your secret prompt on a blank page. */
  | { v: 'bzDraw'; prompt: string; round: number; rounds: number; endsAt: number; done: boolean }
  /**
   * Bazgroły: make up a title for the drawing on the TV (`yours`: it's your drawing, so just watch).
   * `lie` is what you handed in; `error` says why the last one was turned down.
   */
  | { v: 'bzLie'; n: number; of: number; artist: string; yours: boolean; endsAt: number; lie: string | null; error?: string }
  /** Bazgroły: pick the real title. `own` are the options you wrote, which you can't pick. */
  | { v: 'bzGuess'; artist: string; yours: boolean; options: string[]; own: number[]; endsAt: number; picked: number | null }
  /**
   * Bazgroły: how the last drawing went for you. As the artist, `found` people guessed it.
   * As a guesser, `correct` says if you found the truth, and `fooledBy` names whose lie you fell
   * for ('' for one of the game's own decoys). `fooled` is how many fell for your lie.
   */
  | {
      v: 'bzResult';
      truth: string;
      yours: boolean;
      points: number;
      total: number;
      found: number;
      correct: boolean | null;
      fooledBy: string | null;
      fooled: number;
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
      /** Rooms without a TV: the final scores and party standings that the TV would show. */
      board?: { name: string; color: ColorId; score: number; place: number; party: number }[];
      /** In a tournament: this was game `game` of `games`; what you earned and where you stand. */
      tour?: { game: number; games: number; next: GameId | null; gained: number; points: number; place: number; vote?: boolean };
    }
  /** The end of a tournament. */
  | { v: 'tourResults'; place: number; points: number; players: number; vip: boolean };

/** A button on the arena pad. */
export interface PadButton {
  label: string;
  /** Background colour (hex); defaults to the player's colour. */
  color?: string;
  /** Host clock ms until which the button is cooling down (drawn as a filling ring); omit when ready. */
  readyAt?: number;
  /** Cooldown length in ms, so the ring can show how far along it is. */
  cool?: number;
  /** Greyed out and ignored. */
  off?: boolean;
}

/** The arena pad: a joystick (sent as `stick`) and buttons (sent as `btn`). */
export interface PadView {
  v: 'pad';
  /** 'vote': walking onto the next game in a party-mode tournament. */
  game: GameId | 'vote';
  /**
   * ready: the round is about to start (the stick works, buttons don't yet);
   * play: go; out: knocked out of this round, watch the TV; over: the round is over.
   */
  phase: 'ready' | 'play' | 'out' | 'over';
  round: number;
  rounds: number;
  /** Big line ("Run to the RED mushroom!", "You’re out!"). */
  title?: string;
  /** Small line under it. */
  text?: string;
  /** Colour for the title (hex). */
  accent?: string;
  /** 0–2 buttons, shown side by side under the joystick. */
  buttons: PadButton[];
  /** Hide the joystick (e.g. while out). */
  noStick?: boolean;
  /** Little stats in the top bar, e.g. [{ k: 'Armour', v: '♥♥♡' }]. */
  stats?: { k: string; v: string }[];
  score: number;
}

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
  /** Joystick, each axis -100..100, +y is down / towards the player (arena games and Pierogi Panic: walk; Maluch Rally: x steers, -y is gas, +y brakes – or drifts while turning). Sent when it changes (throttled). */
  | { t: 'stick'; x: number; y: number }
  /** Arena pad: button `b` (index in the view's `buttons`) went down (`on`) or up. */
  | { t: 'btn'; b: number; on: boolean }
  /** Pierogi Panic action button; Maluch Rally: use your item (sent when the thumb lifts). */
  | { t: 'act' }
  /** No-TV Maluch Rally: where my car is (~15 times a second). `r` is the race number; `d` is the drift (0 none, 1 drifting, 2 blue sparks, 3 orange sparks). */
  | { t: 'car'; r: number; x: number; z: number; a: number; v: number; d?: number }
  /** Pierogi Panic station minigame: progress (0..1), finished or abandoned. */
  | { t: 'mini'; id: number; ev: 'prog' | 'done' | 'cancel'; p?: number }
  /** To Ty! selfie as a JPEG data URL, '' to skip and be a pierogi, or 'keep' for last game's photo. */
  | { t: 'selfie'; data: string }
  /** To Ty! Ask the host for photos this phone is missing. */
  | { t: 'photos'; ids: string[] }
  /** To Ty! Vote for a player. */
  | { t: 'vote'; id: string }
  /** To Ty! Vote for a doodle, by its position in the gallery. Bazgroły: pick a title, by its position. Podmianka: the shelf slot you think is new. */
  | { t: 'pick'; i: number }
  /** To Ty! doodle on a photo; Bazgroły drawing of your prompt. */
  | { t: 'doodle'; strokes: Stroke[] }
  /** Tour de Pierogi: strokes pedalled so far in heat `h` (sent a few times a second while it changes). */
  | { t: 'pedal'; h: number; n: number }
  /** Fork Fight: your stab in round `r`: reaction in ms, or -1 (too early) / -2 (stabbed a fake). */
  | { t: 'fork'; r: number; ms: number }
  /** Pierogi Parade: your count in round `r` (sent while it changes). */
  | { t: 'count'; r: number; n: number }
  /** Fajki: reach for the cigarette in front of you. */
  | { t: 'grab' }
  /** Fajki: started pulling on the cigarette (`pull`), or let go: puff quality `q` (0–1) and how it went (`v`, see Verdict). */
  | { t: 'puff'; ev: 'pull' | 'blow'; q?: number; v?: number }
  /** Bazgroły: a fake title for the drawing on the TV, or `auto` to have the game make one up. */
  | { t: 'lie'; text: string; auto?: boolean }
  // VIP-only actions (the host ignores them from anybody else)
  | { t: 'select'; game: Selection }
  | { t: 'option'; key: keyof LobbyOptions; value: boolean | number | string | string[] }
  | { t: 'start' }
  | { t: 'kick'; id: string }
  /** Play the same game again – or, in a tournament, go on to the next game. */
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
  | { t: 'view'; view: PhoneView; me: { name: string; color: ColorId; vip: boolean }; now: number; noTv?: boolean }
  | { t: 'buzz'; pattern: number[] }
  /** To Ty! A player's selfie (`data` '' = no photo, show their pierogi). */
  | { t: 'photo'; id: string; rev: number; data: string }
  /**
   * No-TV Maluch Rally, ~15 times a second: where everything is. `r` is the race number.
   * c: per car [x, z, heading, speed, effect bits (RALLY_FX_BITS)]; b: indices of boxes that are gone;
   * s: per slick/bale/cloud [x, z, h, heading, kind (index in HAZARDS: butter, hay, spray)]; p: per pickle [d, lateral];
   * k: per cabbage [d, lateral, speed, age]; x: per blast [x, z, h, age].
   */
  | { t: 'rs'; r: number; c: number[]; b: number[]; s: number[]; p: number[]; k: number[]; x: number[] }
  /** No-TV Maluch Rally: something happened to your car (you used an item, or got hit). */
  | { t: 'rfx'; r: number; use?: RallyItem; hit?: RallyItem; blocked?: boolean; by?: string; lost?: RallyItem; got?: string }
  | { t: 'kicked' };

/** Effect bits in a no-TV rally snapshot. */
export const RALLY_FX_BITS = { spin: 1, rocket: 2, boost: 4, shield: 8, slow: 16, ghost: 32, parked: 64, drift: 128, sparks: 256, superSparks: 512 } as const;
/** Numbers per car in the snapshot's `c` array. */
export const RALLY_CAR_STRIDE = 5;

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
  | { t: 'drop'; id: string }
  /** WebRTC signalling for one second screen. */
  | { t: 'screen'; id: string; m: MirrorSignal };

export type ServerToHost =
  /** Sent right after the host (re)connects: ids of phones (and second screens) currently connected. */
  | { t: 'room'; code: string; players: string[]; screens?: string[] }
  | { t: 'conn'; id: string }
  | { t: 'disc'; id: string }
  | { t: 'msg'; id: string; m: PhoneMsg }
  /** A second screen connected / went away / sent a signalling message. */
  | { t: 'sconn'; id: string }
  | { t: 'sdisc'; id: string }
  | { t: 'smsg'; id: string; m: MirrorSignal };

// ---------------------------------------------------------------------------
// Second screens: a TV somewhere else that mirrors the host TV
// ---------------------------------------------------------------------------
//
// The host TV shares its own tab (getDisplayMedia) and streams it over WebRTC to every
// second screen in the room; the Durable Object only relays the signalling. Players by the
// second screen join with their phones as usual, so two groups far apart play in one room.

/** Second screens a room takes at once (the host encodes one video stream per screen). */
export const MAX_SCREENS = 4;

/** An ICE candidate as JSON (RTCIceCandidateInit, which the Worker's types don't have). */
export interface IceJson {
  candidate?: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
}

export type MirrorSignal =
  /** Screen → host, whenever its socket opens: is its video still running? */
  | { t: 'hello'; live: boolean }
  /** Host → screen: the host isn't sharing right now. */
  | { t: 'idle' }
  /** Host → screen: start (or restart) the stream. */
  | { t: 'offer'; sdp: string }
  /** Screen → host. */
  | { t: 'answer'; sdp: string }
  | { t: 'ice'; c: IceJson };

export type ServerToScreen =
  | MirrorSignal
  | { t: 'host'; online: boolean }
  | { t: 'err'; code: 'no_room' | 'bad_request' | 'full' };

export interface IceServersResponse {
  iceServers: { urls: string | string[]; username?: string; credential?: string }[];
}

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
  /** A room already has MAX_SCREENS second screens. */
  full: 4409,
} as const;
