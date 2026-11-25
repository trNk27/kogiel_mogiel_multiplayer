import {
  CLOSE,
  DEFAULT_OPTIONS,
  DIFFICULTIES,
  SIEGE_MODES,
  TEL_MAX_BOTS,
  KITCHEN_LEVELS,
  DEFAULT_MAX_PLAYERS,
  MAX_PLAYERS,
  RECONNECT_GRACE_MS,
  TOURNAMENT_CANDIDATES,
  TOURNAMENT_MAX_GAMES,
  TOURNAMENT_MIN_GAMES,
  gameInfo,
  gamesFor,
  RALLY_TRACKS,
  playerCountProblem,
  tournamentPool,
  tournamentProblem,
  isColorId,
  sanitizeName,
  type ColorId,
  type AiResponse,
  type AiStatusResponse,
  type AiTask,
  type CreateRoomResponse,
  type GameId,
  type HostToPhone,
  type HostToServer,
  type LobbyOptions,
  type PhoneMsg,
  type PhoneView,
  type PlayerSummary,
  type Selection,
  type ServerToHost,
} from '../../../shared/protocol';
import type { CoopResult, Game, GameHost } from '../games/types';
import { createGame } from '../games/registry';
import {
  BAJA_LEAP_MS,
  BAJA_PHONE_TIMEOUT_MS,
  BAJA_POPUP_MS,
  buyCosmeticState,
  clampFedCount,
  eligibleBajaTargets,
  isCosmeticId,
  nextBajaDelayMs,
  pickBajaTarget,
  toggleCosmeticState,
  type CosmeticId,
} from '../../../shared/cosmetics';
import { ReconnectingSocket, wsUrl, type SocketStatus } from '../lib/socket';
import { sound } from '../lib/sound';
import { placesFor } from './standings';
import { currentVip } from './vip';
import { awardGame, cleanTourOff, hasNext, newTournament, nextGame, nextVote, setVoted, tournamentPlaces, type Tournament } from './tournament';
import { VoteRoom } from './vote/VoteRoom';
import { MirrorHost } from './mirror';
import { TvCaster } from './caster';

export interface Player {
  id: string;
  name: string;
  color: ColorId;
  connected: boolean;
  joinedAt: number;
  disconnectedAt: number | null;
  /** Party points across games (3 / 2 / 1 for podium places). */
  party: number;
  /** Lobby bone currency earned by feeding Baja. */
  bones: number;
  owned: CosmeticId[];
  equipped: CosmeticId[];
}

/** One finished game (or whole tournament) and the party points it handed out, by player id. */
export interface PartyEntry {
  game: Selection;
  gained: Record<string, number>;
}

export interface Standing {
  id: string;
  name: string;
  color: ColorId;
  score: number;
  place: number;
}

export type Screen =
  | { s: 'landing'; error?: string }
  | { s: 'creating' }
  | { s: 'lobby' }
  | { s: 'intro'; game: GameId }
  | { s: 'game' }
  | { s: 'results'; game: GameId; standings: Standing[]; coop?: CoopResult }
  /** The games of a new tournament, before the first one starts. */
  | { s: 'tourIntro' }
  /** Party mode: walking onto the next game to vote for it. */
  | { s: 'vote' }
  /** The end of a tournament: everyone ranked by tournament points. */
  | { s: 'tourEnd'; standings: Standing[]; games: GameId[]; log: Tournament['log'] };

/** Party points for a place in one game (or a whole tournament). */
const partyPoints = (place: number) => (place === 1 ? 3 : place === 2 ? 2 : place === 3 ? 1 : 0);

const SESSION_KEY = 'cp.host';
const HISTORY_MAX = 30;
/** A phone hosting a room without a TV keeps its session separately (the /dev page runs several phones in one tab). */
export const noTvSessionKey = (dev: string | null) => `cp.notvhost${dev ? `.${dev}` : ''}`;
const SESSION_MAX_AGE = 30 * 60_000;
/** The how-to-play screen before every game. Keep in step with the bar in Intro (HostApp). */
export const INTRO_MS = 11_000;
const TOUR_INTRO_MS = 9000;

interface SavedSession {
  code: string;
  hostKey: string;
  players: (Pick<Player, 'id' | 'name' | 'color' | 'joinedAt' | 'party'> & {
    bones?: number;
    owned?: CosmeticId[];
    equipped?: CosmeticId[];
  })[];
  selected: Selection;
  options: LobbyOptions;
  gamesPlayed: number;
  vip?: string | null;
  history?: PartyEntry[];
  savedAt: number;
  noTv?: boolean;
}

export interface HostOptions {
  /** No TV: this controller runs hidden on a phone, and every phone shows the game itself. */
  noTv?: boolean;
  sessionKey?: string;
}

/**
 * The authoritative brain of a room. Lives on the TV (or, without a TV, hidden on the phone that started the party).
 * Owns the roster, VIP rules, reconnection grace periods and the running game.
 */
export class HostController implements GameHost {
  /** Not copied to second screens: connections, timers and the room's secret key. */
  static readonly replicaSkip = [
    'socket',
    'listeners',
    'mirror',
    'caster',
    'lastSent',
    'pending',
    'hostKey',
    'sessionKey',
    'introTimer',
    'sweepTimer',
    'bajaScheduleTimer',
    'bajaPhaseTimer',
    'bajaPopupTimer',
    'bajaKey',
    'lastBajaPlayerId',
    'version',
  ];
  /** A second screen's copy keeps its own store plumbing. */
  static replicaInit(c: HostController) {
    c.listeners = new Set();
    c.version = 0;
  }
  readonly noTv: boolean;
  private readonly sessionKey: string;
  code = '';
  private hostKey = '';
  players = new Map<string, Player>();
  /** Connected phones that have not joined yet (they are looking at the colour picker). */
  private pending = new Set<string>();
  selected: Selection = 'quiz';
  options: LobbyOptions = { ...DEFAULT_OPTIONS };
  screen: Screen = { s: 'landing' };
  game: Game | null = null;
  /** The tournament being played, if any. */
  tournament: Tournament | null = null;
  /** Party mode: the vote for the next game, while it's on. */
  vote: VoteRoom | null = null;
  /** Active Baja lobby feeding minigame visit (leap onto TV player slot -> phone toss -> done). */
  bajaVisit: { key: number; playerId: string; phase: 'leap' | 'phone'; startedAt: number } | null = null;
  /** Short popup next to a player's name on the TV after they finish feeding Baja. */
  bajaPopup: { key: number; playerId: string; fed: number; until: number } | null = null;
  gamesPlayed = 0;
  /** The worker has an AI key (checked once per connect), so AI bots can be offered. */
  aiAvailable = false;
  /** Whose turn it is to be VIP (null until the first game ends): it passes to the next player in joining order after every game. */
  private vip: string | null = null;
  /** Party points per finished game, oldest first – for the standings chart. */
  history: PartyEntry[] = [];
  status: SocketStatus = 'closed';
  /** Second screens: TVs elsewhere that draw this one from its state (see caster.ts). */
  readonly mirror = new MirrorHost(
    (id, m) => this.socket?.send({ t: 'screen', id, m }),
    () => this.changed(),
    (id) => this.caster.ready(id),
  );
  readonly caster = new TvCaster(this, this.mirror);

  private socket: ReconnectingSocket<ServerToHost, HostToServer> | null = null;
  private lastSent = new Map<string, string>();
  private listeners = new Set<() => void>();
  private introTimer: number | undefined;
  private sweepTimer: number | undefined;
  private bajaScheduleTimer: number | undefined;
  private bajaPhaseTimer: number | undefined;
  private bajaPopupTimer: number | undefined;
  private bajaKey = 0;
  private lastBajaPlayerId: string | null = null;
  private version = 0;

  constructor(opts: HostOptions = {}) {
    this.noTv = !!opts.noTv;
    this.sessionKey = opts.sessionKey ?? SESSION_KEY;
    if (this.noTv) {
      this.selected = gamesFor(true)[0].id;
      // The host phone is somebody's controller: it stays quiet.
      sound.muted = true;
    }
  }

  // ---- store plumbing ---------------------------------------------------------

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  getVersion() {
    return this.version;
  }
  changed() {
    this.version++;
    for (const fn of this.listeners) fn();
    this.caster?.changed();
  }

  // ---- room lifecycle ---------------------------------------------------------

  static savedSession(key = SESSION_KEY): SavedSession | null {
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return null;
      const s = JSON.parse(raw) as SavedSession;
      if (Date.now() - s.savedAt > SESSION_MAX_AGE) return null;
      return s;
    } catch {
      return null;
    }
  }

  async create() {
    sound.unlock();
    this.clearAllBaja();
    this.screen = { s: 'creating' };
    this.changed();
    try {
      const res = await fetch('/api/rooms', { method: 'POST' });
      if (!res.ok) throw new Error(`Server said ${res.status}`);
      const { code, hostKey } = (await res.json()) as CreateRoomResponse;
      this.code = code;
      this.hostKey = hostKey;
      this.players.clear();
      this.gamesPlayed = 0;
      this.vip = null;
      this.history = [];
      this.connect();
      this.screen = { s: 'lobby' };
      this.ensureBajaScheduled();
      this.persist();
    } catch (err) {
      this.screen = { s: 'landing', error: `Could not create a room. ${(err as Error).message}` };
    }
    this.changed();
  }

  async resume(saved: SavedSession) {
    sound.unlock();
    this.clearAllBaja();
    const res = await fetch(`/api/rooms/${saved.code}`).catch(() => null);
    const info = res && res.ok ? ((await res.json()) as { exists: boolean }) : { exists: false };
    if (!info.exists) {
      sessionStorage.removeItem(this.sessionKey);
      this.screen = { s: 'landing', error: `Room ${saved.code} has expired.` };
      this.changed();
      return;
    }
    this.code = saved.code;
    this.hostKey = saved.hostKey;
    if (this.selectable(saved.selected)) this.selected = saved.selected;
    this.options = { ...DEFAULT_OPTIONS, ...saved.options };
    this.gamesPlayed = saved.gamesPlayed;
    this.vip = saved.vip ?? null;
    this.history = saved.history ?? [];
    sound.muted = this.noTv || !this.options.sound;
    const now = Date.now();
    for (const p of saved.players) {
      this.players.set(p.id, {
        ...p,
        bones: p.bones ?? 0,
        owned: (p.owned ?? []).filter(isCosmeticId),
        equipped: (p.equipped ?? []).filter(isCosmeticId),
        connected: false,
        disconnectedAt: now,
      });
    }
    this.screen = { s: 'lobby' };
    this.ensureBajaScheduled();
    this.connect();
    this.changed();
  }

  /** Close the room from this side for good (a phone that stops hosting). */
  stop() {
    this.clearAllBaja();
    this.mirror.stop();
    this.endGame();
    clearInterval(this.sweepTimer);
    this.socket?.close();
    this.socket = null;
    try {
      sessionStorage.removeItem(this.sessionKey);
    } catch {
      /* private mode */
    }
  }

  /** Ask the worker once whether AI bots are set up. */
  private checkAi() {
    if (this.aiAvailable) return;
    fetch('/api/ai')
      .then((r) => (r.ok ? (r.json() as Promise<AiStatusResponse>) : { enabled: false }))
      .then((r) => {
        if (!r.enabled || this.aiAvailable) return;
        this.aiAvailable = true;
        this.refreshLobby();
        this.changed();
      })
      .catch(() => {});
  }

  /** GameHost: one AI task, done by the worker with this room's key. null if it failed. */
  async ai(task: AiTask, signal?: AbortSignal): Promise<AiResponse | null> {
    if (!this.aiAvailable || !this.code) return null;
    try {
      const res = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...task, code: this.code, key: this.hostKey }),
        signal,
      });
      if (!res.ok) return null;
      const out = (await res.json()) as AiResponse;
      return out.error ? null : out;
    } catch {
      return null;
    }
  }

  private connect() {
    this.checkAi();
    this.socket?.close();
    this.socket = new ReconnectingSocket<ServerToHost, HostToServer>({
      url: () => wsUrl(`/ws/${this.code}?role=host&key=${encodeURIComponent(this.hostKey)}`),
      onMessage: (m) => this.handle(m),
      onStatus: (s) => {
        this.status = s;
        this.changed();
      },
      fatalCodes: [CLOSE.replaced, CLOSE.expired],
      onFatal: (code) => {
        this.clearAllBaja();
        this.mirror.stop();
        this.endGame();
        sessionStorage.removeItem(this.sessionKey);
        this.screen = {
          s: 'landing',
          error: code === CLOSE.replaced ? 'This room was opened on another screen.' : 'The room expired.',
        };
        this.changed();
      },
    });
    clearInterval(this.sweepTimer);
    this.sweepTimer = window.setInterval(() => this.sweep(), 1000);
  }

  private persist() {
    const data: SavedSession = {
      code: this.code,
      hostKey: this.hostKey,
      players: [...this.players.values()].map(({ id, name, color, joinedAt, party, bones, owned, equipped }) => ({
        id,
        name,
        color,
        joinedAt,
        party,
        bones,
        owned,
        equipped,
      })),
      selected: this.selected,
      options: this.options,
      gamesPlayed: this.gamesPlayed,
      vip: this.vip,
      history: this.history,
      savedAt: Date.now(),
      noTv: this.noTv,
    };
    try {
      sessionStorage.setItem(this.sessionKey, JSON.stringify(data));
    } catch {
      /* private mode */
    }
  }

  // ---- relay messages ---------------------------------------------------------

  private handle(msg: ServerToHost) {
    switch (msg.t) {
      case 'room': {
        // (Re)connected to the relay: reconcile who is actually there.
        const online = new Set(msg.players);
        const now = Date.now();
        this.pending.clear();
        this.lastSent.clear();
        for (const p of this.players.values()) {
          const was = p.connected;
          p.connected = online.has(p.id);
          if (was && !p.connected) p.disconnectedAt = now;
          if (p.connected) p.disconnectedAt = null;
          if (was !== p.connected) {
            this.game?.onConnection?.(p.id, p.connected);
            this.vote?.onConnection(p.id, p.connected);
          }
        }
        if (this.bajaVisit && !online.has(this.bajaVisit.playerId)) {
          this.cancelBajaVisit(this.bajaVisit.key);
        }
        for (const id of online) {
          if (this.players.has(id)) this.sendView(id, true);
          else this.greet(id);
        }
        if (this.screen.s === 'lobby') this.ensureBajaScheduled();
        this.mirror.sync(msg.screens ?? []);
        this.changed();
        break;
      }
      case 'sconn':
        this.mirror.connected(msg.id);
        break;
      case 'sdisc':
        this.mirror.gone(msg.id);
        break;
      case 'smsg':
        this.mirror.signal(msg.id, msg.m);
        break;
      case 'conn':
        this.onConnect(msg.id);
        break;
      case 'disc':
        this.onDisconnect(msg.id);
        break;
      case 'msg':
        this.onPhone(msg.id, msg.m);
        break;
    }
  }

  private onConnect(id: string) {
    const p = this.players.get(id);
    if (!p) {
      this.greet(id);
      return;
    }
    const was = p.connected;
    p.connected = true;
    p.disconnectedAt = null;
    this.sendView(id, true);
    if (!was) {
      this.game?.onConnection?.(id, true);
      this.vote?.onConnection(id, true);
      if (this.screen.s === 'lobby') this.ensureBajaScheduled();
      this.refreshLobby();
      this.changed();
    }
  }

  private onDisconnect(id: string) {
    this.pending.delete(id);
    this.lastSent.delete(id);
    const p = this.players.get(id);
    if (!p || !p.connected) return;
    p.connected = false;
    p.disconnectedAt = Date.now();
    if (this.bajaVisit?.playerId === id) this.cancelBajaVisit(this.bajaVisit.key);
    this.game?.onConnection?.(id, false);
    this.vote?.onConnection(id, false);
    this.refreshLobby();
    this.changed();
  }

  /** Drop players whose grace period ran out. */
  private sweep() {
    const now = Date.now();
    let changed = false;
    for (const p of [...this.players.values()]) {
      if (!p.connected && p.disconnectedAt !== null && now - p.disconnectedAt > RECONNECT_GRACE_MS) {
        this.removePlayer(p.id);
        changed = true;
      }
    }
    if (changed) this.changed();
  }

  maxPlayers(): number {
    return this.noTv ? DEFAULT_MAX_PLAYERS : MAX_PLAYERS;
  }

  private greet(id: string) {
    this.pending.add(id);
    const max = this.maxPlayers();
    this.sendTo([id], {
      t: 'hello',
      taken: this.takenColors(),
      full: this.players.size >= max,
      max,
      inGame: this.screen.s !== 'lobby',
    });
  }

  private onPhone(id: string, m: PhoneMsg) {
    if (m.t === 'join') {
      this.onJoin(id, m.name, m.color);
      return;
    }
    const p = this.players.get(id);
    if (!p) return;
    if (!p.connected) this.onConnect(id);

    const isVip = this.vipId() === id;
    switch (m.t) {
      case 'select':
        if (isVip && this.screen.s === 'lobby' && this.selectable(m.game)) {
          this.selected = m.game;
          sound.tick();
          this.afterLobbyChange();
        }
        return;
      case 'option':
        if (!isVip) return;
        if (m.key === 'powerups' || m.key === 'sound' || m.key === 'items' || m.key === 'tourShort' || m.key === 'tourParty') this.options = { ...this.options, [m.key]: !!m.value };
        else if (m.key === 'tourGames') {
          const v = Math.round(Number(m.value));
          if (!(v >= TOURNAMENT_MIN_GAMES && v <= TOURNAMENT_MAX_GAMES)) return;
          this.options = { ...this.options, tourGames: v };
          sound.tick();
        } else if (m.key === 'tourOff') {
          const off = cleanTourOff(m.value, TOURNAMENT_CANDIDATES);
          if (!off) return;
          this.options = { ...this.options, tourOff: off };
          sound.tick();
        }
        else if (m.key === 'telBots') {
          const v = Math.round(Number(m.value));
          if (!(v >= 0 && v <= TEL_MAX_BOTS)) return;
          this.options = { ...this.options, telBots: v };
          sound.tick();
        }
        else if (m.key === 'track') {
          if (!RALLY_TRACKS.some((t) => t.id === m.value)) return;
          this.options = { ...this.options, track: String(m.value) };
          sound.tick();
        }
        else if (m.key === 'difficulty' || m.key === 'level' || m.key === 'siege') {
          const max = m.key === 'difficulty' ? DIFFICULTIES.length : m.key === 'siege' ? SIEGE_MODES.length : KITCHEN_LEVELS.length;
          const v = Math.round(Number(m.value));
          if (!(v >= 1 && v <= max)) return;
          this.options = { ...this.options, [m.key]: v };
          sound.tick();
        } else return;
        sound.muted = this.noTv || !this.options.sound;
        this.afterLobbyChange();
        return;
      case 'start':
        if (isVip && this.screen.s === 'lobby' && this.canStart()) {
          if (this.selected === 'tournament') this.startTournament();
          else this.startGame(this.selected);
        }
        return;
      case 'again':
        if (!isVip) return;
        if (this.screen.s === 'results' && this.tournament) this.nextTourGame();
        else if (this.screen.s === 'results') {
          if (this.canStart(this.screen.game)) this.startGame(this.screen.game);
          else this.toLobby();
        } else if (this.screen.s === 'tourEnd') {
          if (this.canStart('tournament')) this.startTournament();
          else this.toLobby();
        }
        return;
      case 'lobby':
        if (isVip && this.screen.s !== 'lobby') this.toLobby();
        return;
      case 'kick':
        if (isVip && m.id !== id && this.players.has(m.id)) {
          this.sendTo([m.id], { t: 'kicked' });
          this.send({ t: 'drop', id: m.id });
          this.removePlayer(m.id);
          this.changed();
        }
        return;
      case 'bajaFeedDone':
        if (this.screen.s === 'lobby' && this.bajaVisit?.key === m.key && this.bajaVisit.playerId === id) {
          const fed = clampFedCount(m.fed);
          p.bones += fed;
          clearTimeout(this.bajaPhaseTimer);
          this.bajaPhaseTimer = undefined;
          this.bajaVisit = null;
          const popupKey = m.key;
          this.bajaPopup = { key: popupKey, playerId: id, fed, until: Date.now() + BAJA_POPUP_MS };
          clearTimeout(this.bajaPopupTimer);
          this.bajaPopupTimer = window.setTimeout(() => {
            if (this.bajaPopup?.key === popupKey) {
              this.bajaPopup = null;
              this.changed();
            }
          }, BAJA_POPUP_MS);
          if (fed > 0) sound.serve();
          else sound.plop();
          this.ensureBajaScheduled();
          this.afterLobbyChange();
        }
        return;
      case 'buyCosmetic':
        if (this.screen.s === 'lobby' && isCosmeticId(m.id)) {
          const next = buyCosmeticState({ bones: p.bones, owned: p.owned, equipped: p.equipped }, m.id);
          if (next) {
            p.bones = next.bones;
            p.owned = next.owned;
            p.equipped = next.equipped;
            sound.pickup();
            this.afterLobbyChange();
          }
        }
        return;
      case 'toggleCosmetic':
        if (this.screen.s === 'lobby' && isCosmeticId(m.id)) {
          const next = toggleCosmeticState({ owned: p.owned, equipped: p.equipped }, m.id);
          if (next) {
            p.equipped = next;
            sound.tick();
            this.afterLobbyChange();
          }
        }
        return;
      default:
        if (this.screen.s === 'game' && this.game?.ids.includes(id)) this.game.onMessage(id, m);
        else if (this.screen.s === 'vote' && this.vote?.ids.includes(id)) this.vote.onMessage(id, m);
    }
  }

  private onJoin(id: string, rawName: string, color: ColorId) {
    if (this.players.has(id)) {
      this.sendView(id, true);
      return;
    }
    const name = sanitizeName(String(rawName ?? ''));
    const taken = this.takenColors();
    let reason = '';
    if (!name) reason = 'Please enter a name.';
    else if (this.players.size >= this.maxPlayers()) reason = `This room is full (${this.maxPlayers()} players max).`;
    else if (!isColorId(color)) reason = 'Please pick a colour.';
    else if (taken.includes(color)) reason = 'Someone just grabbed that colour – pick another!';
    else if ([...this.players.values()].some((p) => p.name.toLowerCase() === name.toLowerCase()))
      reason = 'That name is taken – try another one.';
    if (reason) {
      this.sendTo([id], { t: 'joinError', reason, taken });
      return;
    }
    this.pending.delete(id);
    this.players.set(id, {
      id,
      name,
      color,
      connected: true,
      joinedAt: Date.now(),
      disconnectedAt: null,
      party: 0,
      bones: 0,
      owned: [],
      equipped: [],
    });
    sound.join();
    if (this.screen.s === 'lobby') this.ensureBajaScheduled();
    this.afterRosterChange();
  }

  private removePlayer(id: string) {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    this.lastSent.delete(id);
    if (this.bajaVisit?.playerId === id) this.cancelBajaVisit(this.bajaVisit.key);
    if (this.bajaPopup?.playerId === id) {
      clearTimeout(this.bajaPopupTimer);
      this.bajaPopupTimer = undefined;
      this.bajaPopup = null;
    }
    sound.leave();
    if (this.game?.ids.includes(id)) this.game.onRemoved?.(id);
    this.vote?.onRemoved(id);
    this.afterRosterChange();
  }

  private afterRosterChange() {
    // Colours/fullness changed for phones still at the colour picker.
    for (const pid of this.pending) this.greet(pid);
    if (this.bajaVisit && this.bajaVisit.playerId === this.vipId()) {
      this.cancelBajaVisit(this.bajaVisit.key);
    } else if (this.screen.s === 'lobby') {
      this.ensureBajaScheduled();
    }
    // Everybody's lobby (VIP flag, player list) may have changed.
    for (const p of this.players.values()) if (p.connected) this.sendView(p.id);
    this.persist();
    this.changed();
  }

  private afterLobbyChange() {
    this.refreshLobby();
    this.persist();
    this.changed();
  }

  private refreshLobby() {
    if (this.screen.s !== 'lobby') return;
    for (const p of this.players.values()) if (p.connected) this.sendView(p.id);
  }

  // ---- games ------------------------------------------------------------------

  canStart(sel: Selection = this.selected) {
    return this.startProblem(sel) === null;
  }

  startProblem(sel: Selection = this.selected) {
    if (sel === 'tournament') return tournamentProblem(this.connectedCount(), this.players.size, this.noTv, this.options.tourOff);
    return playerCountProblem(gameInfo(sel), this.connectedCount(), this.players.size, this.noTv);
  }

  /** Can the VIP pick this in the lobby? Tournaments need a TV. */
  private selectable(sel: Selection) {
    return sel === 'tournament' ? !this.noTv : gamesFor(this.noTv).some((g) => g.id === sel);
  }

  /** Games in a tournament are the short versions, unless the VIP asked for the full ones. */
  get short() {
    return !!this.tournament?.short;
  }

  private logParty(game: Selection, gained: Record<string, number>) {
    this.history.push({ game, gained });
    // The chart only shows the latest games; totals come from the players' party points.
    if (this.history.length > HISTORY_MAX) this.history.splice(0, this.history.length - HISTORY_MAX);
  }

  /** The games a tournament can draw from right now. */
  private tourPool() {
    return tournamentPool(this.connectedCount(), this.players.size, this.options.tourOff);
  }

  private startTournament() {
    this.clearAllBaja();
    this.endGame();
    this.tournament = newTournament(this.tourPool(), [...this.players.keys()], Math.random, {
      games: this.options.tourGames,
      short: this.options.tourShort,
      party: this.options.tourParty,
    });
    this.screen = { s: 'tourIntro' };
    sound.fanfare();
    this.refresh();
    this.changed();
    this.introTimer = window.setTimeout(() => this.nextTourGame(), TOUR_INTRO_MS);
  }

  private nextTourGame() {
    const t = this.tournament;
    if (!t) return;
    if (t.party) {
      const pool = this.tourPool().filter((g) => this.canStart(g));
      const choices = nextVote(t, pool);
      if (!choices) this.endTournament();
      else if (choices.length === 1) {
        // Nothing to vote about.
        setVoted(t, choices[0]);
        this.startGame(choices[0]);
      } else this.startVote(choices);
      return;
    }
    const game = nextGame(t, (g) => this.canStart(g), this.tourPool());
    if (game) this.startGame(game);
    else this.endTournament();
  }

  /** Party mode: everybody walks onto the game they want next, then the draw picks one. */
  private startVote(choices: GameId[]) {
    const t = this.tournament!;
    this.endGame();
    this.screen = { s: 'vote' };
    const vote = new VoteRoom(this, [...this.players.keys()], choices, t.index + 1, t.total, (game) => {
      if (this.vote !== vote || this.tournament !== t) return;
      setVoted(t, game);
      this.startGame(game);
    }, t.points);
    this.vote = vote;
    this.lastSent.clear();
    sound.whoosh();
    vote.start();
    this.refresh();
    this.changed();
  }

  private endTournament() {
    const t = this.tournament;
    if (!t) return;
    this.endGame();
    const standings: Standing[] = tournamentPlaces(t, [...this.players.keys()]).map((r) => {
      const p = this.players.get(r.id)!;
      return { id: r.id, name: p.name, color: p.color, score: r.points, place: r.place };
    });
    // The tournament counts as one game in the party standings.
    const gained: Record<string, number> = {};
    for (const st of standings) {
      gained[st.id] = standings.length > 1 ? partyPoints(st.place) : 0;
      this.players.get(st.id)!.party += gained[st.id];
    }
    this.logParty('tournament', gained);
    this.tournament = null;
    this.gamesPlayed++;
    this.screen = { s: 'tourEnd', standings, games: t.games, log: t.log };
    sound.fanfare();
    this.refresh();
    this.persist();
    this.changed();
  }

  private startGame(id: GameId) {
    this.clearAllBaja();
    this.endGame();
    this.screen = { s: 'intro', game: id };
    sound.whoosh();
    this.refresh();
    this.changed();
    this.introTimer = window.setTimeout(() => {
      const ids = [...this.players.keys()];
      this.game = createGame(id, this, ids);
      this.screen = { s: 'game' };
      this.lastSent.clear();
      this.game.start();
      this.refresh();
      this.changed();
    }, INTRO_MS);
  }

  private endGame() {
    clearTimeout(this.introTimer);
    this.game?.dispose();
    this.game = null;
    this.vote?.dispose();
    this.vote = null;
  }

  private toLobby() {
    this.clearAllBaja();
    this.endGame();
    this.tournament = null;
    this.screen = { s: 'lobby' };
    this.ensureBajaScheduled();
    this.refresh();
    this.persist();
    this.changed();
  }

  // ---- Baja lobby cameo minigame ---------------------------------------------

  /** Trigger a Baja feeding visit right away (used by the 20-40s lobby timer and `/?debug`). */
  triggerBajaVisit(targetId?: string): boolean {
    if (this.screen.s !== 'lobby' || this.bajaVisit) return false;
    const eligible = eligibleBajaTargets([...this.players.values()], this.vipId());
    if (targetId && !eligible.includes(targetId)) return false;
    const playerId = targetId ?? pickBajaTarget(eligible, this.lastBajaPlayerId);
    if (!playerId) return false;

    clearTimeout(this.bajaScheduleTimer);
    this.bajaScheduleTimer = undefined;
    clearTimeout(this.bajaPhaseTimer);
    this.lastBajaPlayerId = playerId;

    const key = ++this.bajaKey;
    this.bajaVisit = { key, playerId, phase: 'leap', startedAt: Date.now() };
    sound.pickup();
    this.changed();

    this.bajaPhaseTimer = window.setTimeout(() => {
      if (this.screen.s !== 'lobby' || this.bajaVisit?.key !== key) return;
      this.bajaVisit = { key, playerId, phase: 'phone', startedAt: Date.now() };
      this.buzz(playerId, [40, 40, 80]);
      this.sendView(playerId, true);
      this.changed();
      this.bajaPhaseTimer = window.setTimeout(() => this.cancelBajaVisit(key), BAJA_PHONE_TIMEOUT_MS);
    }, BAJA_LEAP_MS);
    return true;
  }

  private ensureBajaScheduled() {
    if (this.screen.s !== 'lobby' || this.bajaVisit || this.bajaScheduleTimer !== undefined) return;
    if (eligibleBajaTargets([...this.players.values()], this.vipId()).length === 0) return;
    this.bajaScheduleTimer = window.setTimeout(() => {
      this.bajaScheduleTimer = undefined;
      this.triggerBajaVisit();
    }, nextBajaDelayMs());
  }

  private cancelBajaVisit(key?: number) {
    if (key !== undefined && this.bajaVisit?.key !== key) return;
    const prev = this.bajaVisit;
    clearTimeout(this.bajaPhaseTimer);
    this.bajaPhaseTimer = undefined;
    this.bajaVisit = null;
    if (prev && this.screen.s === 'lobby') this.sendView(prev.playerId);
    if (this.screen.s === 'lobby') this.ensureBajaScheduled();
    this.changed();
  }

  private clearAllBaja() {
    clearTimeout(this.bajaScheduleTimer);
    this.bajaScheduleTimer = undefined;
    clearTimeout(this.bajaPhaseTimer);
    this.bajaPhaseTimer = undefined;
    clearTimeout(this.bajaPopupTimer);
    this.bajaPopupTimer = undefined;
    this.bajaVisit = null;
    this.bajaPopup = null;
  }

  // GameHost
  player(id: string) {
    return this.players.get(id);
  }

  refresh(id?: string) {
    if (id) {
      this.sendView(id);
      return;
    }
    for (const p of this.players.values()) if (p.connected) this.sendView(p.id);
  }

  buzz(id: string, pattern: number[]) {
    this.sendTo([id], { t: 'buzz', pattern });
  }

  message(ids: string[], m: HostToPhone) {
    if (ids.length) this.sendTo(ids, m);
  }

  finish(scores: Record<string, number>, coop?: CoopResult) {
    const game = this.game?.id ?? (this.selected === 'tournament' ? 'quiz' : this.selected);
    const entries = Object.entries(scores)
      .filter(([id]) => this.players.has(id))
      .map(([id, score]) => {
        const p = this.players.get(id)!;
        return { id, name: p.name, color: p.color, score, place: 0 };
      });
    const places = placesFor(entries.map((e) => e.score));
    entries.forEach((e, i) => (e.place = places[i]));
    entries.sort((a, b) => a.place - b.place);
    if (this.tournament) {
      // In a tournament, games earn tournament points; the party points come at the end.
      awardGame(this.tournament, Object.fromEntries(entries.map((e) => [e.id, e.score])));
    } else {
      const gained: Record<string, number> = {};
      for (const e of entries) {
        gained[e.id] = coop ? coop.stars : entries.length > 1 ? partyPoints(e.place) : 0;
        this.players.get(e.id)!.party += gained[e.id];
      }
      this.logParty(game, gained);
      this.gamesPlayed++;
    }
    this.endGame();
    this.passVip();
    this.screen = { s: 'results', game, standings: entries, ...(coop ? { coop } : {}) };
    sound.fanfare();
    this.refresh();
    this.persist();
    this.changed();
  }

  // ---- views ------------------------------------------------------------------

  /** The VIP: whoever's turn it is, or the first to join if that player has left ("Mani" in the first round; see vip.ts). */
  vipId(): string | null {
    return currentVip(this.players.values(), this.vip);
  }

  /** After a game the VIP passes to the next player in joining order (skipping anyone who's away). */
  private passVip() {
    const order = [...this.players.values()].sort((a, b) => a.joinedAt - b.joinedAt);
    if (order.length === 0) return;
    const at = order.findIndex((p) => p.id === this.vipId());
    for (let k = 1; k <= order.length; k++) {
      const p = order[(at + k) % order.length];
      if (p.connected || k === order.length) {
        this.vip = p.id;
        return;
      }
    }
  }

  connectedCount() {
    let n = 0;
    for (const p of this.players.values()) if (p.connected) n++;
    return n;
  }

  takenColors(): ColorId[] {
    return [...this.players.values()].map((p) => p.color);
  }

  summaries(): PlayerSummary[] {
    const vip = this.vipId();
    return [...this.players.values()].map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      connected: p.connected,
      vip: p.id === vip,
      cosmetics: p.equipped,
    }));
  }

  private viewFor(id: string): PhoneView {
    const vip = this.vipId() === id;
    const s = this.screen;
    switch (s.s) {
      case 'lobby': {
        const me = this.players.get(id);
        const feeding = this.bajaVisit?.phase === 'phone' && this.bajaVisit.playerId === id;
        return {
          v: 'lobby',
          vip,
          selected: this.selected,
          options: this.options,
          players: vip ? this.summaries() : [],
          playerCount: this.players.size,
          vipName: this.players.get(this.vipId() ?? '')?.name ?? '',
          ...(this.aiAvailable ? { ai: true } : {}),
          ...(me ? { bones: me.bones, owned: me.owned, equipped: me.equipped } : {}),
          ...(feeding && this.bajaVisit ? { bajaFeed: { key: this.bajaVisit.key } } : {}),
        };
      }
      case 'intro': {
        const t = this.tournament;
        const ready = this.noTv ? 'Get ready!' : 'Get ready · 📺 look up';
        return { v: 'wait', title: gameInfo(s.game).title, text: t ? `🏆 ${t.index + 1} / ${t.total} · ${ready}` : ready, icon: s.game };
      }
      case 'tourIntro': {
        const t = this.tournament;
        const n = t?.total ?? 0;
        return { v: 'wait', title: t?.party ? 'Party tournament!' : 'Tournament!', text: `${n} ${t?.short ? 'quick ' : ''}games${t?.party ? ' · you vote for each' : ''} · 📺`, icon: 'tournament' };
      }
      case 'vote':
        if (this.vote?.ids.includes(id)) return this.vote.viewFor(id);
        return { v: 'wait', title: 'Voting for the next game', text: 'You’re in the next one · 📺', icon: 'tournament' };
      case 'tourEnd': {
        const st = s.standings.find((x) => x.id === id);
        return { v: 'tourResults', place: st?.place ?? 0, points: st?.score ?? 0, players: s.standings.length, vip };
      }
      case 'game':
        if (this.game?.ids.includes(id)) return this.game.viewFor(id);
        return { v: 'wait', title: 'Game in progress', text: 'You’re in the next one', icon: 'sleep' };
      case 'results': {
        const st = s.standings.find((x) => x.id === id);
        return {
          v: 'results',
          game: s.game,
          place: st?.place ?? 0,
          score: st?.score ?? 0,
          players: s.standings.length,
          vip,
          ...(s.coop ? { coop: { stars: s.coop.stars, score: s.coop.score, ...(s.coop.look ? { unit: s.coop.look.scoreUnit } : {}) } } : {}),
          ...(this.tournament ? { tour: this.tourView(id) } : {}),
          // Without a TV, every phone gets the scoreboard the TV would show.
          ...(this.noTv
            ? { board: s.standings.map((x) => ({ name: x.name, color: x.color, score: x.score, place: x.place, party: this.players.get(x.id)?.party ?? 0 })) }
            : {}),
        };
      }
      default:
        return { v: 'wait', title: 'Hold on…' };
    }
  }

  /** A player's tournament situation after a game. */
  private tourView(id: string) {
    const t = this.tournament!;
    const table = tournamentPlaces(t, [...this.players.keys()]);
    return {
      game: t.index + 1,
      games: t.total,
      next: t.games[t.index + 1] ?? null,
      ...(t.party && hasNext(t) ? { vote: true } : {}),
      gained: t.gained[id] ?? 0,
      points: t.points[id] ?? 0,
      place: table.find((r) => r.id === id)?.place ?? 0,
    };
  }

  private sendView(id: string, force = false) {
    const p = this.players.get(id);
    if (!p || !p.connected) return;
    const view = this.viewFor(id);
    const me = { name: p.name, color: p.color, vip: this.vipId() === id };
    const key = JSON.stringify([view, me]);
    if (!force && this.lastSent.get(id) === key) return;
    this.lastSent.set(id, key);
    this.sendTo([id], { t: 'view', view, me, now: Date.now(), ...(this.noTv ? { noTv: true } : {}) });
  }

  private sendTo(ids: string[], m: HostToPhone) {
    this.send({ t: 'to', ids, m });
  }

  private send(m: HostToServer) {
    this.socket?.send(m);
  }
}
