import {
  CLOSE,
  GAMES,
  MAX_PLAYERS,
  RECONNECT_GRACE_MS,
  gameInfo,
  isColorId,
  sanitizeName,
  type ColorId,
  type CreateRoomResponse,
  type GameId,
  type HostToPhone,
  type HostToServer,
  type LobbyOptions,
  type PhoneMsg,
  type PhoneView,
  type PlayerSummary,
  type ServerToHost,
} from '../../../shared/protocol';
import type { Game, GameHost } from '../games/types';
import { createGame } from '../games/registry';
import { ReconnectingSocket, wsUrl, type SocketStatus } from '../lib/socket';
import { sound } from '../lib/sound';
import { placesFor } from './standings';

export interface Player {
  id: string;
  name: string;
  color: ColorId;
  connected: boolean;
  joinedAt: number;
  disconnectedAt: number | null;
  /** Party points across games (3 / 2 / 1 for podium places). */
  party: number;
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
  | { s: 'results'; game: GameId; standings: Standing[] };

const SESSION_KEY = 'cp.host';
const SESSION_MAX_AGE = 30 * 60_000;
const INTRO_MS = 6000;

interface SavedSession {
  code: string;
  hostKey: string;
  players: Pick<Player, 'id' | 'name' | 'color' | 'joinedAt' | 'party'>[];
  selected: GameId;
  options: LobbyOptions;
  gamesPlayed: number;
  savedAt: number;
}

/**
 * The authoritative brain of a room. Lives on the TV.
 * Owns the roster, VIP rules, reconnection grace periods and the running game.
 */
export class HostController implements GameHost {
  code = '';
  private hostKey = '';
  players = new Map<string, Player>();
  /** Connected phones that have not joined yet (they are looking at the colour picker). */
  private pending = new Set<string>();
  selected: GameId = 'quiz';
  options: LobbyOptions = { powerups: false, sound: true };
  screen: Screen = { s: 'landing' };
  game: Game | null = null;
  gamesPlayed = 0;
  status: SocketStatus = 'closed';

  private socket: ReconnectingSocket<ServerToHost, HostToServer> | null = null;
  private lastSent = new Map<string, string>();
  private listeners = new Set<() => void>();
  private introTimer: number | undefined;
  private sweepTimer: number | undefined;
  private version = 0;

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
  }

  // ---- room lifecycle ---------------------------------------------------------

  static savedSession(): SavedSession | null {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
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
      this.connect();
      this.screen = { s: 'lobby' };
      this.persist();
    } catch (err) {
      this.screen = { s: 'landing', error: `Could not create a room. ${(err as Error).message}` };
    }
    this.changed();
  }

  async resume(saved: SavedSession) {
    sound.unlock();
    const res = await fetch(`/api/rooms/${saved.code}`).catch(() => null);
    const info = res && res.ok ? ((await res.json()) as { exists: boolean }) : { exists: false };
    if (!info.exists) {
      sessionStorage.removeItem(SESSION_KEY);
      this.screen = { s: 'landing', error: `Room ${saved.code} has expired.` };
      this.changed();
      return;
    }
    this.code = saved.code;
    this.hostKey = saved.hostKey;
    this.selected = saved.selected;
    this.options = saved.options;
    this.gamesPlayed = saved.gamesPlayed;
    sound.muted = !this.options.sound;
    const now = Date.now();
    for (const p of saved.players) {
      this.players.set(p.id, { ...p, connected: false, disconnectedAt: now });
    }
    this.screen = { s: 'lobby' };
    this.connect();
    this.changed();
  }

  private connect() {
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
        this.endGame();
        sessionStorage.removeItem(SESSION_KEY);
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
      players: [...this.players.values()].map(({ id, name, color, joinedAt, party }) => ({ id, name, color, joinedAt, party })),
      selected: this.selected,
      options: this.options,
      gamesPlayed: this.gamesPlayed,
      savedAt: Date.now(),
    };
    try {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(data));
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
          if (was !== p.connected) this.game?.onConnection?.(p.id, p.connected);
        }
        for (const id of online) {
          if (this.players.has(id)) this.sendView(id, true);
          else this.greet(id);
        }
        this.changed();
        break;
      }
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
    this.game?.onConnection?.(id, false);
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

  private greet(id: string) {
    this.pending.add(id);
    this.sendTo([id], {
      t: 'hello',
      taken: this.takenColors(),
      full: this.players.size >= MAX_PLAYERS,
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
        if (isVip && this.screen.s === 'lobby' && GAMES.some((g) => g.id === m.game)) {
          this.selected = m.game;
          sound.tick();
          this.afterLobbyChange();
        }
        return;
      case 'option':
        if (isVip && (m.key === 'powerups' || m.key === 'sound')) {
          this.options = { ...this.options, [m.key]: !!m.value };
          sound.muted = !this.options.sound;
          this.afterLobbyChange();
        }
        return;
      case 'start':
        if (isVip && this.screen.s === 'lobby' && this.canStart()) this.startGame(this.selected);
        return;
      case 'again':
        if (isVip && this.screen.s === 'results') {
          if (this.canStart(this.screen.game)) this.startGame(this.screen.game);
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
      default:
        if (this.screen.s === 'game' && this.game?.ids.includes(id)) this.game.onMessage(id, m);
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
    else if (this.players.size >= MAX_PLAYERS) reason = `This room is full (${MAX_PLAYERS} players max).`;
    else if (!isColorId(color)) reason = 'Please pick a colour.';
    else if (taken.includes(color)) reason = 'Someone just grabbed that colour – pick another!';
    else if ([...this.players.values()].some((p) => p.name.toLowerCase() === name.toLowerCase()))
      reason = 'That name is taken – try another one.';
    if (reason) {
      this.sendTo([id], { t: 'joinError', reason, taken });
      return;
    }
    this.pending.delete(id);
    this.players.set(id, { id, name, color, connected: true, joinedAt: Date.now(), disconnectedAt: null, party: 0 });
    sound.join();
    this.afterRosterChange();
  }

  private removePlayer(id: string) {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    this.lastSent.delete(id);
    sound.leave();
    if (this.game?.ids.includes(id)) this.game.onRemoved?.(id);
    this.afterRosterChange();
  }

  private afterRosterChange() {
    // Colours/fullness changed for phones still at the colour picker.
    for (const pid of this.pending) this.greet(pid);
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

  canStart(game: GameId = this.selected) {
    return this.connectedCount() >= gameInfo(game).minPlayers;
  }

  private startGame(id: GameId) {
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
  }

  private toLobby() {
    this.endGame();
    this.screen = { s: 'lobby' };
    this.refresh();
    this.persist();
    this.changed();
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

  finish(scores: Record<string, number>) {
    const game = this.game?.id ?? this.selected;
    const entries = Object.entries(scores)
      .filter(([id]) => this.players.has(id))
      .map(([id, score]) => {
        const p = this.players.get(id)!;
        return { id, name: p.name, color: p.color, score, place: 0 };
      });
    const places = placesFor(entries.map((e) => e.score));
    entries.forEach((e, i) => (e.place = places[i]));
    entries.sort((a, b) => a.place - b.place);
    for (const e of entries) {
      const p = this.players.get(e.id)!;
      if (entries.length > 1) p.party += e.place === 1 ? 3 : e.place === 2 ? 2 : e.place === 3 ? 1 : 0;
    }
    this.endGame();
    this.gamesPlayed++;
    this.screen = { s: 'results', game, standings: entries };
    sound.fanfare();
    this.refresh();
    this.persist();
    this.changed();
  }

  // ---- views ------------------------------------------------------------------

  vipId(): string | null {
    let best: Player | null = null;
    for (const p of this.players.values()) if (!best || p.joinedAt < best.joinedAt) best = p;
    return best?.id ?? null;
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
    return [...this.players.values()].map((p) => ({ id: p.id, name: p.name, color: p.color, connected: p.connected, vip: p.id === vip }));
  }

  private viewFor(id: string): PhoneView {
    const vip = this.vipId() === id;
    const s = this.screen;
    switch (s.s) {
      case 'lobby':
        return {
          v: 'lobby',
          vip,
          selected: this.selected,
          options: this.options,
          players: vip ? this.summaries() : [],
          playerCount: this.players.size,
          vipName: this.players.get(this.vipId() ?? '')?.name ?? '',
        };
      case 'intro':
        return { v: 'wait', title: gameInfo(s.game).title, text: 'Get ready – look at the TV!', icon: s.game };
      case 'game':
        if (this.game?.ids.includes(id)) return this.game.viewFor(id);
        return { v: 'wait', title: 'Game in progress', text: 'Hang tight – you’ll be in the next one!', icon: 'sleep' };
      case 'results': {
        const st = s.standings.find((x) => x.id === id);
        return { v: 'results', game: s.game, place: st?.place ?? 0, score: st?.score ?? 0, players: s.standings.length, vip };
      }
      default:
        return { v: 'wait', title: 'Hold on…' };
    }
  }

  private sendView(id: string, force = false) {
    const p = this.players.get(id);
    if (!p || !p.connected) return;
    const view = this.viewFor(id);
    const me = { name: p.name, color: p.color, vip: this.vipId() === id };
    const key = JSON.stringify([view, me]);
    if (!force && this.lastSent.get(id) === key) return;
    this.lastSent.set(id, key);
    this.sendTo([id], { t: 'view', view, me, now: Date.now() });
  }

  private sendTo(ids: string[], m: HostToPhone) {
    this.send({ t: 'to', ids, m });
  }

  private send(m: HostToServer) {
    this.socket?.send(m);
  }
}
