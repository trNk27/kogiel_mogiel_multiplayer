import { colorHex, type PhoneMsg, type PhoneView } from '../../../../shared/protocol';
import type { Game, GameHost } from '../types';
import { TimerRing } from '../../host/components';
import { Pierogi } from '../../lib/art';
import { resources } from '../../lib/assets';
import { sound } from '../../lib/sound';
import {
  ENTRANCES,
  GLUEHWEIN,
  HIDE_MS,
  HUNT_MS,
  LAUF_LEAD_MS,
  LAUF_MS,
  RUMOUR_EVERY_MS,
  RUMOUR_SHOW_MS,
  SELLER_TAPS,
  SNIFF_COOLDOWN_MS,
  SPOTS,
  TENT,
  TRICK_COOLDOWN_MS,
  canHide,
  edgeKey,
  findPoints,
  hidePoints,
  hiderOrder,
  laufPoints,
  attackSchedule,
  dodgePoints,
  MOVES,
  makeCrowds,
  mulberry32,
  neighbours,
  sniff,
  trueRumour,
  walkMs,
  type Clue,
  type Rng,
} from './logic';
import { GluehweinMug, Market, SPOT_SCALE, SPOT_XY, WatchSeller } from './art';
import { IceRink } from './rink';
import './markt.css';

const INTRO_MS = 7000;
const RESULT_MS = 7000;
const LAUF_RESULT_MS = 4500;
const END_MS = 6000;
/** Answers sent right at a deadline get this long to arrive. */
const LATE_MS = 1500;

type Phase = 'intro' | 'hide' | 'hunt' | 'lauf' | 'laufResult' | 'result' | 'end';

interface Seeker {
  at: number;
  walkingTo: number | null;
  arriveAt: number;
  /** While the hunt is paused for the Krampuslauf, how much of the walk is left. */
  walkLeft: number;
  boosted: boolean;
  sniffReadyAt: number;
  clue: { at: number; clue: Clue } | null;
  seller: number;
  sniffedAt: number;
}

interface Rumour {
  at: number;
  until: number;
  n: number;
}

interface Result {
  big: string;
  text: string;
  good: boolean;
  pts: number;
}

export class MarktGame implements Game {
  readonly id = 'markt' as const;
  readonly order: string[];
  round = 0;
  phase: Phase = 'intro';
  key = 0;
  endsAt = 0;
  scores: Record<string, number> = {};
  hiderId = '';
  hideAt = -1;
  crowds: Record<string, number> = {};
  readonly seekers = new Map<string, Seeker>();
  rumours: Rumour[] = [];
  private rumourN = 0;
  private trickReadyAt = 0;
  private sneakUsed = false;
  /** Hunt clock: when it ends, or how much was left when it paused. */
  private huntEndsAt = 0;
  private huntLeft = HUNT_MS;
  private laufDone = false;
  laufStart = 0;
  laufEnd = 0;
  attacks: [number, number][] = [];
  /** Per skater, per attack: the points they got for it (0: fell), or missing if not answered yet. */
  readonly dodges = new Map<string, (number | undefined)[]>();
  laufIds = new Set<string>();
  laufCaller = '';
  foundBy: string | null = null;
  private results = new Map<string, Result>();
  private rng: Rng;
  private timers: number[] = [];
  private walkTimers = new Map<string, number>();

  constructor(
    private host: GameHost,
    public ids: string[],
    seed = Math.floor(Math.random() * 1e9),
  ) {
    this.rng = mulberry32(seed);
    this.order = hiderOrder(ids, host.short);
    for (const id of ids) this.scores[id] = 0;
  }

  get rounds() {
    return this.order.length;
  }

  start() {
    this.phase = 'intro';
    this.endsAt = Date.now() + INTRO_MS;
    void resources.preload(['swap']);
    sound.bell();
    this.at(INTRO_MS, () => this.nextRound());
    this.update();
  }

  dispose() {
    this.clear();
    this.clearWalks();
  }

  private clear() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  private clearWalks() {
    for (const t of this.walkTimers.values()) clearTimeout(t);
    this.walkTimers.clear();
  }

  private at(ms: number, fn: () => void) {
    this.timers.push(window.setTimeout(fn, Math.max(0, ms)));
  }

  private update() {
    this.host.refresh();
    this.host.changed();
  }

  // ---- Rounds ---------------------------------------------------------------------

  private nextRound() {
    this.clear();
    this.clearWalks();
    // Skip hiders who have left.
    do this.round++;
    while (this.round <= this.rounds && !this.ids.includes(this.order[this.round - 1]));
    if (this.round > this.rounds || this.ids.length < 2) {
      this.end();
      return;
    }
    this.key++;
    this.hiderId = this.order[this.round - 1];
    this.hideAt = -1;
    this.crowds = makeCrowds(this.rng);
    this.seekers.clear();
    this.ids
      .filter((id) => id !== this.hiderId)
      .forEach((id, k) => this.seekers.set(id, this.newSeeker(ENTRANCES[k % ENTRANCES.length])));
    this.rumours = [];
    this.results.clear();
    this.trickReadyAt = 0;
    this.sneakUsed = false;
    this.laufDone = false;
    this.foundBy = null;
    this.huntLeft = HUNT_MS;
    this.phase = 'hide';
    this.endsAt = Date.now() + HIDE_MS;
    sound.whoosh();
    this.at(HIDE_MS + LATE_MS / 2, () => this.startHunt());
    this.update();
  }

  private newSeeker(at: number): Seeker {
    return { at, walkingTo: null, arriveAt: 0, walkLeft: 0, boosted: false, sniffReadyAt: 0, clue: null, seller: 0, sniffedAt: 0 };
  }

  private startHunt() {
    if (this.phase !== 'hide') return;
    if (this.hideAt < 0) {
      // Didn't choose: the crowd carries them somewhere.
      const ok = SPOTS.map((_, i) => i).filter(canHide);
      this.hideAt = ok[Math.floor(this.rng() * ok.length)];
    }
    this.resumeHunt();
    sound.go();
  }

  /** Start or resume the hunt clock (after the Krampuslauf). */
  private resumeHunt() {
    this.clear();
    this.phase = 'hunt';
    const now = Date.now();
    this.huntEndsAt = now + this.huntLeft;
    this.endsAt = this.huntEndsAt;
    for (const [id, s] of this.seekers)
      if (s.walkingTo !== null) {
        s.arriveAt = now + s.walkLeft;
        this.walkTimers.set(
          id,
          window.setTimeout(() => this.arrive(id), s.walkLeft),
        );
      }
    this.at(this.huntLeft, () => this.roundOver(null));
    this.scheduleRumour();
    this.update();
  }

  private scheduleRumour() {
    this.at(Math.min(RUMOUR_EVERY_MS, this.huntEndsAt - Date.now() - 3000), () => {
      if (this.phase !== 'hunt') return;
      this.rumour(trueRumour(this.hideAt, this.rng));
      this.scheduleRumour();
    });
  }

  private rumour(at: number) {
    const now = Date.now();
    this.rumours = this.rumours.filter((r) => r.until > now);
    this.rumours.push({ at, until: now + RUMOUR_SHOW_MS, n: ++this.rumourN });
    sound.bell();
    this.host.changed();
    this.at(RUMOUR_SHOW_MS + 50, () => this.host.changed());
  }

  private pauseHunt() {
    this.clear();
    const now = Date.now();
    this.huntLeft = Math.max(0, this.huntEndsAt - now);
    for (const [id, s] of this.seekers) {
      if (s.walkingTo !== null) s.walkLeft = Math.max(0, s.arriveAt - now);
      const t = this.walkTimers.get(id);
      if (t) clearTimeout(t);
    }
    this.walkTimers.clear();
  }

  private arrive(id: string) {
    const s = this.seekers.get(id);
    this.walkTimers.delete(id);
    if (!s || s.walkingTo === null || this.phase !== 'hunt') return;
    s.at = s.walkingTo;
    s.walkingTo = null;
    s.clue = null;
    if (s.at === this.hideAt) {
      this.roundOver(id);
      return;
    }
    if (s.at === TENT && !this.laufDone) {
      this.startLauf(id);
      return;
    }
    sound.plop();
    this.host.refresh(id);
    this.update();
  }

  private roundOver(finder: string | null) {
    if (this.phase !== 'hunt') return;
    this.clear();
    this.clearWalks();
    const now = Date.now();
    const left = Math.max(0, this.huntEndsAt - now);
    const hidden = HUNT_MS - left;
    this.foundBy = finder;
    const hiderName = this.host.player(this.hiderId)?.name ?? 'The hider';
    const spot = SPOTS[this.hideAt];
    const hp = hidePoints(hidden, finder !== null);
    this.scores[this.hiderId] = (this.scores[this.hiderId] ?? 0) + hp;
    this.results.set(this.hiderId, {
      big: finder ? 'Found you! 😱' : 'Never found! 🥷',
      text: finder ? `${this.host.player(finder)?.name ?? 'Someone'} found you at ${spot.name}.` : `Nobody looked behind ${spot.name}.`,
      good: !finder,
      pts: hp,
    });
    for (const id of this.seekers.keys()) {
      if (id === finder) {
        const fp = findPoints(left);
        this.scores[id] = (this.scores[id] ?? 0) + fp;
        this.results.set(id, { big: 'Gefunden! 🎉', text: `${hiderName} was at ${spot.emoji} ${spot.name}.`, good: true, pts: fp });
      } else {
        this.results.set(id, {
          big: finder ? 'Too slow!' : 'Nobody found them',
          text: `${hiderName} was at ${spot.emoji} ${spot.name}.`,
          good: false,
          pts: 0,
        });
      }
    }
    this.phase = 'result';
    this.endsAt = now + RESULT_MS;
    if (finder) {
      sound.fanfare();
      this.host.buzz(finder, [60, 40, 60, 40, 200]);
    } else sound.wrong();
    this.at(RESULT_MS, () => this.nextRound());
    this.update();
  }

  // ---- Krampuslauf ----------------------------------------------------------------

  private startLauf(caller: string) {
    this.pauseHunt();
    this.laufDone = true;
    this.laufCaller = caller;
    this.phase = 'lauf';
    this.attacks = attackSchedule(this.rng);
    this.laufStart = Date.now() + LAUF_LEAD_MS;
    this.laufEnd = this.laufStart + LAUF_MS;
    this.endsAt = this.laufEnd;
    this.dodges.clear();
    this.laufIds = new Set(this.ids.filter((id) => this.host.player(id)?.connected));
    for (const id of this.laufIds) this.dodges.set(id, []);
    // A whoosh and a growl for every attack, in time with the TV.
    for (const [t] of this.attacks) this.at(this.laufStart - Date.now() + t, () => (sound.whoosh(), this.host.changed()));
    sound.drumroll(LAUF_LEAD_MS / 1000);
    for (const id of this.ids) this.host.buzz(id, [200, 80, 200]);
    this.at(this.laufEnd - Date.now() + LATE_MS, () => this.laufDone_());
    this.update();
  }

  private laufDone_() {
    if (this.phase !== 'lauf') return;
    this.clear();
    const sums: Record<string, number> = {};
    for (const id of this.laufIds) {
      if (!this.ids.includes(id)) continue;
      sums[id] = (this.dodges.get(id) ?? []).reduce<number>((a, b) => a + (b ?? 0), 0);
    }
    const pts = laufPoints(sums);
    for (const id of Object.keys(pts)) this.scores[id] = (this.scores[id] ?? 0) + pts[id];
    this.laufPts = pts;
    this.phase = 'laufResult';
    this.endsAt = Date.now() + LAUF_RESULT_MS;
    sound.fanfare();
    this.at(LAUF_RESULT_MS, () => {
      // Out of the tent, back into the crowd.
      const s = this.seekers.get(this.laufCaller);
      if (s && s.at === TENT) s.clue = null;
      this.resumeHunt();
    });
    this.update();
  }

  laufPts: Record<string, number> = {};

  /** For the Krampuslauf panel. */
  host_player(id: string) {
    return this.host.player(id);
  }

  private end() {
    this.clear();
    this.clearWalks();
    this.phase = 'end';
    this.endsAt = Date.now() + END_MS;
    sound.fanfare();
    this.at(END_MS, () => this.host.finish(this.scores));
    this.update();
  }

  // ---- Phones ---------------------------------------------------------------------

  onMessage(id: string, m: PhoneMsg) {
    if (m.t !== 'markt' || m.key !== this.key) return;
    const now = Date.now();
    const isHider = id === this.hiderId;
    const s = this.seekers.get(id);

    if (this.phase === 'lauf') {
      const d = m.dodge;
      const mine = this.dodges.get(id);
      if (!d || !mine || !Number.isInteger(d.i) || d.i < 0 || d.i >= this.attacks.length || mine[d.i] !== undefined) return;
      if (!MOVES.some((x) => x.id === d.move) || !Number.isFinite(d.at)) return;
      // Too early to have seen it: ignore. (The phone only lets you answer while it shows.)
      if (now < this.laufStart + this.attacks[d.i][0] - 300) return;
      const pts = dodgePoints(this.attacks[d.i][1], d.move, d.at);
      mine[d.i] = pts;
      if (pts > 0) sound.correct();
      else {
        sound.wrong();
        this.host.buzz(id, [200]);
      }
      this.host.changed();
      return;
    }

    if (this.phase === 'hide' && isHider && typeof m.hide === 'number' && canHide(m.hide)) {
      this.hideAt = m.hide;
      sound.lockIn();
      this.host.refresh(id);
      // Hidden early: start straight away.
      this.clear();
      this.at(1200, () => this.startHunt());
      this.update();
      return;
    }
    if (this.phase !== 'hunt') return;

    if (isHider) {
      if (now < this.trickReadyAt) return;
      if (typeof m.fake === 'number' && m.fake >= 0 && m.fake < SPOTS.length && m.fake !== TENT) {
        this.trickReadyAt = now + TRICK_COOLDOWN_MS;
        this.rumour(m.fake);
      } else if (typeof m.seller === 'string') {
        const t = this.seekers.get(m.seller);
        if (!t || t.seller > 0) return;
        t.seller = SELLER_TAPS;
        this.trickReadyAt = now + TRICK_COOLDOWN_MS;
        sound.whistle();
        this.host.buzz(m.seller, [100, 50, 100, 50, 100]);
      } else if (typeof m.sneak === 'number' && !this.sneakUsed) {
        const to = m.sneak;
        if (!neighbours(this.hideAt).includes(to) || !canHide(to)) return;
        // Can't sneak into someone's arms.
        if ([...this.seekers.values()].some((x) => x.at === to || x.walkingTo === to)) return;
        this.hideAt = to;
        this.sneakUsed = true;
        this.trickReadyAt = now + TRICK_COOLDOWN_MS;
        sound.puff();
      } else return;
      this.update();
      return;
    }

    if (!s) return;
    if (m.nein && s.seller > 0) {
      s.seller--;
      if (s.seller === 0) sound.correct();
      this.host.refresh(id);
      this.host.changed();
      return;
    }
    if (s.seller > 0 || s.walkingTo !== null) return;
    if (typeof m.walk === 'number' && neighbours(s.at).includes(m.walk)) {
      const crowd = this.crowds[edgeKey(s.at, m.walk)] ?? 2;
      const ms = walkMs(crowd, s.boosted);
      s.walkingTo = m.walk;
      s.arriveAt = now + ms;
      s.clue = null;
      this.walkTimers.set(
        id,
        window.setTimeout(() => this.arrive(id), ms),
      );
      sound.pickup();
    } else if (m.sniff && now >= s.sniffReadyAt) {
      s.clue = { at: s.at, clue: sniff(s.at, this.hideAt) };
      s.sniffReadyAt = now + SNIFF_COOLDOWN_MS;
      s.sniffedAt = now;
      sound.note(1300, 0.06, { type: 'sine', vol: 0.06 });
      sound.note(1450, 0.06, { type: 'sine', vol: 0.06, delay: 0.12 });
    } else if (m.drink && s.at === GLUEHWEIN && !s.boosted) {
      s.boosted = true;
      sound.plop();
    } else return;
    this.update();
  }

  onConnection() {
    this.host.changed();
  }

  onRemoved(id: string) {
    this.ids = this.ids.filter((x) => x !== id);
    delete this.scores[id];
    this.seekers.delete(id);
    const t = this.walkTimers.get(id);
    if (t) clearTimeout(t);
    this.walkTimers.delete(id);
    this.laufIds.delete(id);
    if (this.ids.length < 2) {
      this.end();
      return;
    }
    // The hider left, or nobody is left to seek: on to the next round.
    if ((id === this.hiderId || this.seekers.size === 0) && (this.phase === 'hide' || this.phase === 'hunt' || this.phase === 'lauf')) {
      this.clear();
      this.clearWalks();
      this.nextRound();
      return;
    }
    this.update();
  }

  viewFor(id: string): PhoneView {
    const hp = this.host.player(this.hiderId);
    const s = this.seekers.get(id);
    const isHider = id === this.hiderId;
    const phase = this.phase === 'laufResult' ? 'lauf' : this.phase;
    const r = this.results.get(id);
    return {
      v: 'markt',
      phase: this.phase === 'laufResult' ? 'lauf' : phase,
      key: this.key,
      round: Math.max(1, Math.min(this.round, this.rounds)),
      rounds: this.rounds,
      role: isHider ? 'hider' : 'seeker',
      hider: hp?.name ?? '',
      hiderColor: hp?.color ?? null,
      endsAt: this.endsAt,
      total: this.scores[id] ?? 0,
      crowds: this.crowds,
      seekers: [...this.seekers.entries()].flatMap(([sid, x]) => {
        const p = this.host.player(sid);
        return p ? [{ id: sid, name: p.name, color: p.color, at: x.at }] : [];
      }),
      hideAt: isHider && this.hideAt >= 0 ? this.hideAt : null,
      trickReadyAt: isHider ? this.trickReadyAt : 0,
      sneakUsed: this.sneakUsed,
      at: s?.at ?? -1,
      walkingTo: s?.walkingTo ?? null,
      arriveAt: s?.arriveAt ?? 0,
      boosted: s?.boosted ?? false,
      sniffReadyAt: s?.sniffReadyAt ?? 0,
      clue: s?.clue ?? null,
      seller: s?.seller ?? 0,
      lauf:
        this.phase === 'lauf' && this.laufIds.has(id)
          ? { startAt: this.laufStart, endAt: this.laufEnd, attacks: this.attacks, done: (this.dodges.get(id) ?? []).map((x) => (x === undefined ? -1 : x)) }
          : undefined,
      result:
        this.phase === 'result' && r
          ? r
          : this.phase === 'laufResult'
            ? {
                big: 'Off the ice!',
                text: `You dodged Krampus ${(this.dodges.get(id) ?? []).filter((x) => (x ?? 0) > 0).length} of ${this.attacks.length} times.`,
                good: (this.laufPts[id] ?? 0) > 0,
                pts: this.laufPts[id] ?? 0,
              }
            : this.phase === 'end'
              ? { big: 'The market closes 🌙', text: 'Frohe Weihnachten!', good: true, pts: 0 }
              : undefined,
    };
  }

  // ---- TV -------------------------------------------------------------------------

  private banner(): { title: string; sub?: string } {
    const hn = this.host.player(this.hiderId)?.name ?? '';
    switch (this.phase) {
      case 'intro':
        return { title: 'Wo ist der Pieróg?', sub: 'Hide-and-seek at the Vienna Christmas market' };
      case 'hide':
        return { title: `${hn} is hiding…`, sub: this.hideAt >= 0 ? 'Hidden! Here we go…' : 'No peeking! The hider picks a stall on their phone' };
      case 'hunt':
        return { title: `Find ${hn}!`, sub: 'Walk stall to stall · sniff for clues · rumours can lie' };
      case 'lauf':
        return { title: 'Krampus auf dem Eis! 👹', sub: `${this.host.player(this.laufCaller)?.name ?? 'Someone'} woke Krampus. Jump, duck or swerve on your phone!` };
      case 'laufResult':
        return { title: 'Krampus goes back to sleep…' };
      case 'result':
        return this.foundBy
          ? { title: `${this.host.player(this.foundBy)?.name ?? ''} found ${hn}!`, sub: `Hiding at ${SPOTS[this.hideAt].emoji} ${SPOTS[this.hideAt].name}` }
          : { title: `${hn} was never found!`, sub: `Hiding at ${SPOTS[this.hideAt].emoji} ${SPOTS[this.hideAt].name}` };
      case 'end':
        return { title: 'Frohe Weihnachten!', sub: 'The market closes. Who takes home the gingerbread heart?' };
    }
  }

  render() {
    const b = this.banner();
    const now = Date.now();
    const players = this.ids.map((id) => this.host.player(id)).filter((p) => !!p);
    const lead = Math.max(...this.ids.map((id) => this.scores[id] ?? 0));
    const showHider = this.phase === 'result' || this.phase === 'intro' || this.phase === 'end';
    const hp = this.host.player(this.hiderId);
    const lauf = this.phase === 'lauf' || this.phase === 'laufResult';

    return (
      <div class={`screen mk-screen ph-${this.phase}`}>
        <Market crowds={this.crowds} />

        {/* Rumours: true ones and the hider's fakes look exactly the same. */}
        {this.phase === 'hunt' &&
          this.rumours
            .filter((r) => r.until > now)
            .map((r) => (
              <div key={`r${r.n}`} class="mk-rumour" style={{ left: `${SPOT_XY[r.at][0]}px`, top: `${SPOT_XY[r.at][1] - 150 * SPOT_SCALE[r.at]}px` }}>
                👀 Pierogi spotted near here!
              </div>
            ))}

        {/* Seekers, walking through the crowds. */}
        {[...this.seekers.entries()].map(([id, s], k) => {
          const p = this.host.player(id);
          if (!p) return null;
          const dest = s.walkingTo ?? s.at;
          const [x, y] = SPOT_XY[dest];
          const walking = s.walkingTo !== null && this.phase === 'hunt';
          const sc = SPOT_SCALE[dest];
          const off = ((k % 4) - 1.5) * 56 * sc;
          return (
            <div
              key={id}
              class={`mk-seeker ${walking ? 'walking' : ''} ${s.boosted ? 'boosted' : ''} ${this.foundBy === id ? 'finder' : ''}`}
              style={{
                left: `${x + off}px`,
                top: `${y + (40 + (k % 2) * 16) * sc}px`,
                zIndex: Math.round(y + 120),
                transitionDuration: walking ? `${Math.max(0, s.arriveAt - now)}ms` : '400ms',
                '--pc': colorHex(p.color),
                '--s': sc,
              }}
            >
              {s.seller > 0 && this.phase === 'hunt' && (
                <div class="mk-seller-wrap">
                  <WatchSeller />
                  <span class="mk-seller-say">Rolex? 10 €!</span>
                </div>
              )}
              {s.clue && now - s.sniffedAt < 2500 && this.phase === 'hunt' && <span class="mk-sniff">👃</span>}
              {s.boosted && (
                <span class="mk-mug">
                  <GluehweinMug class="mk-mug-svg" />
                </span>
              )}
              <Pierogi color={colorHex(p.color)} size={96} mood={this.foundBy === id ? 'wow' : 'happy'} />
              <span class="mk-name">{p.name}</span>
            </div>
          );
        })}

        {/* The hider, only when it's safe to show them. */}
        {hp && showHider && this.hideAt >= 0 && (
          <div class="mk-hider found pop-in" style={{ left: `${SPOT_XY[this.hideAt][0]}px`, top: `${SPOT_XY[this.hideAt][1] - 10}px`, '--pc': colorHex(hp.color), '--s': SPOT_SCALE[this.hideAt], zIndex: 1400 }}>
            <Pierogi color={colorHex(hp.color)} size={80} mood={this.foundBy ? 'dead' : 'wow'} />
            <span class="mk-name">{hp.name}</span>
          </div>
        )}
        {hp && this.phase === 'hide' && (
          <div class="mk-hider sneaking" style={{ '--pc': colorHex(hp.color) }}>
            <Pierogi color={colorHex(hp.color)} size={80} mood="happy" />
            <span class="mk-name">{hp.name} 🤫</span>
          </div>
        )}

        {lauf && <Lauf game={this} now={now} />}

        <div class="mk-top">
          <div class="pill">
            Round {Math.max(1, Math.min(this.round, this.rounds))} / {this.rounds}
          </div>
          {hp && this.phase !== 'intro' && this.phase !== 'end' && (
            <div class="pill mk-hiderpill" style={{ '--pc': colorHex(hp.color) }}>
              🥷 {hp.name}
            </div>
          )}
          <div class="grow" />
          {(this.phase === 'hide' || this.phase === 'hunt' || this.phase === 'lauf') && (
            <TimerRing
              key={`t${this.key}-${this.phase}-${this.endsAt}`}
              endsAt={this.endsAt}
              total={this.phase === 'hide' ? HIDE_MS : this.phase === 'lauf' ? LAUF_MS + LAUF_LEAD_MS : HUNT_MS}
              size={100}
              onTick={(s) => s <= 5 && s > 0 && sound.tick()}
            />
          )}
        </div>

        <div class="mk-banner pop-in" key={`b${this.phase}-${this.key}`}>
          <b>{b.title}</b>
          {b.sub && <span>{b.sub}</span>}
        </div>

        <div class="mk-board">
          {players
            .slice()
            .sort((a, c) => (this.scores[c.id] ?? 0) - (this.scores[a.id] ?? 0))
            .map((p) => (
              <div class={`mk-row ${p.connected ? '' : 'offline'}`} style={{ '--pc': colorHex(p.color) }}>
                {this.phase === 'end' && (this.scores[p.id] ?? 0) === lead && <span>💗</span>}
                {p.id === this.hiderId && this.phase !== 'end' && <span>🥷</span>}
                <Pierogi color={colorHex(p.color)} size={30} />
                <span class="mk-row-name">{p.name}</span>
                <b>{(this.scores[p.id] ?? 0).toLocaleString('en-US')}</b>
              </div>
            ))}
        </div>
      </div>
    );
  }
}

/** Krampus auf dem Eis: the rink, the skaters going round, Krampus attacking from the middle. */
function Lauf({ game }: { game: MarktGame; now: number }) {
  return <IceRink game={game} />;
}
