import { useEffect, useRef } from 'preact/hooks';
import { colorHex, type PhoneMsg, type PhoneView } from '../../../../shared/protocol';
import type { Game, GameHost } from '../types';
import { TimerRing } from '../../host/components';
import { sound } from '../../lib/sound';
import {
  GORZKO_MAX,
  GORZKO_MS,
  PAIR_LATE_MS,
  PAIR_POINTS,
  PAIR_TASKS,
  PAIR_TRIES,
  DANCE_MAX,
  DANCE_MS,
  DANCE_PASS_BONUS,
  TWIRL_POINTS,
  SHOT_POINTS,
  SURVIVOR_BONUS,
  WAKE_DRUNK,
  WESELE_SONGS,
  WESELE_SONGS_SHORT,
  clockFor,
  drink,
  gorzkoPoints,
  makePairs,
  mulberry32,
  pairOk,
  pairWindowMs,
  dancePassed,
  twirlsNeeded,
  wujekRelease,
  type PairTask,
  type Rng,
} from './logic';
import { Band, HeadTable, PGuest, RoundTable, Wujek, type Act } from './art';
import './wesele.css';

const INTRO_MS = 7000;
const SHOT_MS = 8000;
const SHOW_MS = 3800;
const DANCE_LEAD_MS = 3500;
const PAIR_LEAD_MS = 4200;
const GORZKO_LEAD_MS = 3000;
const RESULT_MS = 5000;
const END_MS = 8000;
/** Answers sent right at a deadline get this long to arrive. */
const LATE_MS = 1200;

type Phase = 'intro' | 'shot' | 'shotShow' | 'dance' | 'danceResult' | 'pair' | 'pairResult' | 'gorzko' | 'gorzkoResult' | 'end';

interface Guest {
  drunk: number;
  out: boolean;
  everOut: boolean;
  score: number;
}

interface Result {
  key: number;
  big: string;
  text: string;
  good: boolean;
  pts: number;
  drank: number;
}

type Pair = { a: string; b: string | null; ok?: boolean; wujekAt?: number };

export class WeseleGame implements Game {
  readonly id = 'wesele' as const;
  readonly songs: number;
  song = 0;
  phase: Phase = 'intro';
  key = 0;
  endsAt = 0;
  readonly g = new Map<string, Guest>();
  private rng: Rng;
  private timers: number[] = [];
  /** Who is taking part in the current task. */
  private inTask = new Set<string>();
  private answered = new Set<string>();
  private results = new Map<string, Result>();
  private resultKey = 0;
  // Twirl dance
  danceStart = 0;
  danceEnd = 0;
  need = 6;
  danceAttempt = 1;
  readonly twirls = new Map<string, number>();
  // Pair game
  pairs: Pair[] = [];
  task: PairTask = PAIR_TASKS[0];
  pairAttempt = 1;
  nowAt = 0;
  private releases = new Map<string, number>();
  // Gorzko
  gorzkoStart = 0;
  gorzkoEnd = 0;
  private counts = new Map<string, number>();

  constructor(
    private host: GameHost,
    public ids: string[],
    seed = Math.floor(Math.random() * 1e9),
  ) {
    this.rng = mulberry32(seed);
    this.songs = host.short ? WESELE_SONGS_SHORT : WESELE_SONGS;
    for (const id of ids) this.g.set(id, { drunk: 0, out: false, everOut: false, score: 0 });
  }

  start() {
    this.phase = 'intro';
    this.endsAt = Date.now() + INTRO_MS;
    sound.fanfare();
    this.at(INTRO_MS, () => this.nextSong());
    this.update();
  }

  dispose() {
    this.clear();
  }

  private clear() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  private at(ms: number, fn: () => void) {
    this.timers.push(window.setTimeout(fn, ms));
  }

  private update() {
    this.host.refresh();
    this.host.changed();
  }

  private present = (id: string) => !!this.host.player(id)?.connected;

  private awake() {
    return this.ids.filter((id) => !this.g.get(id)?.out);
  }

  private scores(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const id of this.ids) out[id] = this.g.get(id)?.score ?? 0;
    return out;
  }

  /** Down a shot. Returns true if that one put them under the table. */
  private drinkUp(id: string): boolean {
    const p = this.g.get(id);
    if (!p || p.out) return false;
    const d = drink(p.drunk);
    p.drunk = d.level;
    if (d.out) {
      p.out = true;
      p.everOut = true;
      this.host.buzz(id, [300, 100, 300]);
    }
    return d.out;
  }

  private give(id: string, pts: number) {
    const p = this.g.get(id);
    if (p) p.score += pts;
  }

  private result(id: string, r: Omit<Result, 'key'>) {
    const p = this.g.get(id);
    // Passing out trumps everything.
    if (p?.out && r.drank > 0) r = { ...r, big: 'Under the table! 💤', text: 'One shot too many. You wake up next song.', good: false };
    this.results.set(id, { ...r, key: this.resultKey });
  }

  private newTask(ids: string[]) {
    this.clear();
    this.key++;
    this.inTask = new Set(ids);
    this.answered.clear();
  }

  private allIn() {
    const waiting = [...this.inTask].filter((id) => this.present(id));
    return waiting.length > 0 && waiting.every((id) => this.answered.has(id));
  }

  private showResults(phase: Phase, next: () => void) {
    this.clear();
    this.phase = phase;
    this.endsAt = Date.now() + RESULT_MS;
    this.at(RESULT_MS, next);
    this.update();
  }

  // ---- The night ------------------------------------------------------------------

  private nextSong() {
    this.song++;
    if (this.song > this.songs) {
      this.end();
      return;
    }
    // Whoever passed out wakes up, still a bit drunk.
    for (const p of this.g.values())
      if (p.out) {
        p.out = false;
        p.drunk = WAKE_DRUNK;
      }
    this.shot();
  }

  // 1. Kolejka!
  private shot() {
    this.newTask(this.awake());
    this.resultKey = this.key;
    this.phase = 'shot';
    this.endsAt = Date.now() + SHOT_MS;
    sound.pickup();
    this.at(SHOT_MS + 400, () => this.shotDone());
    this.update();
  }

  private shotDone() {
    if (this.phase !== 'shot') return;
    for (const id of this.inTask) {
      const swiped = this.answered.has(id);
      if (swiped) this.give(id, SHOT_POINTS);
      this.drinkUp(id);
      this.result(id, {
        big: swiped ? 'Do dna! 🥃' : 'Wujek poured it in for you',
        text: swiped ? 'Bottoms up.' : 'Too slow, so no points. Still counts as a shot!',
        good: swiped,
        pts: swiped ? SHOT_POINTS : 0,
        drank: 1,
      });
    }
    sound.correct();
    this.clear();
    this.phase = 'shotShow';
    this.endsAt = Date.now() + SHOW_MS;
    this.at(SHOW_MS, () => this.dance(1, this.awake()));
    this.update();
  }

  // 2. Twirl with Wujek
  private dance(attempt: number, ids: string[]) {
    ids = ids.filter((id) => !this.g.get(id)?.out);
    if (!ids.length) {
      this.pair(1, null);
      return;
    }
    this.newTask(ids);
    this.resultKey = this.key;
    this.twirls.clear();
    this.danceAttempt = attempt;
    this.need = twirlsNeeded(this.song, this.songs);
    this.danceStart = Date.now() + DANCE_LEAD_MS;
    this.danceEnd = this.danceStart + DANCE_MS;
    this.endsAt = this.danceEnd;
    this.phase = 'dance';
    this.at(this.danceEnd - Date.now() + LATE_MS, () => this.danceDone());
    this.update();
  }

  private danceDone() {
    if (this.phase !== 'dance') return;
    const again: string[] = [];
    for (const id of this.inTask) {
      const n = this.twirls.get(id) ?? 0;
      const ok = dancePassed(n, this.need);
      const pts = n * TWIRL_POINTS + (ok ? DANCE_PASS_BONUS : 0);
      this.give(id, pts);
      if (ok) {
        this.result(id, { big: 'Wujek loves you! 💃', text: `${n} twirls!`, good: true, pts, drank: 0 });
      } else {
        const out = this.drinkUp(id);
        const retry = !out && this.danceAttempt < 2;
        if (retry) again.push(id);
        this.result(id, {
          big: 'Too dizzy to dance!',
          text: `${n} of ${this.need} twirls. Wujek says: drink${retry ? ' and dance again!' : '!'}`,
          good: false,
          pts,
          drank: 1,
        });
      }
    }
    if (this.inTask.size) (again.length < this.inTask.size ? sound.correct : sound.wrong).call(sound);
    this.showResults('danceResult', () => (again.length ? this.dance(2, again) : this.pair(1, null)));
  }

  // 3. Oczepiny pair game
  private pair(attempt: number, retry: Pair[] | null) {
    if (attempt === 1) {
      this.task = PAIR_TASKS[(this.song - 1) % PAIR_TASKS.length];
      this.pairs = makePairs(this.awake(), this.rng, true).map(([a, b]) => ({ a, b }));
    } else if (retry) {
      this.pairs = retry.map((p) => ({ a: p.a, b: p.b }));
    }
    // Anyone whose partner passed out gets Wujek instead.
    this.pairs = this.pairs
      .map((p) => {
        const aOut = this.g.get(p.a)?.out;
        const bOut = p.b !== null && this.g.get(p.b)?.out;
        if (aOut && (p.b === null || bOut)) return null;
        if (aOut) return { a: p.b as string, b: null };
        if (bOut) return { a: p.a, b: null };
        return p;
      })
      .filter((p): p is Pair => p !== null);
    if (!this.pairs.length) {
      this.gorzko();
      return;
    }
    for (const p of this.pairs) if (p.b === null) p.wujekAt = wujekRelease(this.rng);
    this.newTask(this.pairs.flatMap((p) => (p.b ? [p.a, p.b] : [p.a])));
    this.resultKey = this.key;
    this.releases.clear();
    this.pairAttempt = attempt;
    this.nowAt = Date.now() + PAIR_LEAD_MS;
    this.endsAt = this.nowAt + PAIR_LATE_MS;
    this.phase = 'pair';
    this.at(this.endsAt - Date.now() + LATE_MS, () => this.pairDone());
    this.update();
  }

  private pairDone() {
    if (this.phase !== 'pair') return;
    const again: Pair[] = [];
    for (const p of this.pairs) {
      const ra = this.releases.get(p.a) ?? null;
      const rb = p.b ? (this.releases.get(p.b) ?? null) : (p.wujekAt ?? 0);
      const da = this.g.get(p.a)?.drunk ?? 0;
      const db = p.b ? (this.g.get(p.b)?.drunk ?? 0) : 3;
      p.ok = pairOk(ra, rb, pairWindowMs(da, db));
      const humans = p.b ? [p.a, p.b] : [p.a];
      const gap = ra !== null && rb !== null ? Math.abs(ra - rb) : null;
      for (const id of humans) {
        if (p.ok) {
          const pts = PAIR_POINTS[this.pairAttempt - 1] ?? 0;
          this.give(id, pts);
          this.result(id, { big: this.task.done, text: gap !== null ? `Only ${gap} ms apart!` : '', good: true, pts, drank: 0 });
        } else {
          this.drinkUp(id);
          this.result(id, {
            big: 'Out of sync! 🥃',
            text: gap === null ? 'Someone never let go. You both drink.' : `${gap} ms apart. You both drink${this.pairAttempt < PAIR_TRIES ? ' and try again!' : '.'}`,
            good: false,
            pts: 0,
            drank: 1,
          });
        }
      }
      if (!p.ok && this.pairAttempt < PAIR_TRIES) again.push(p);
    }
    (this.pairs.some((p) => p.ok) ? sound.correct : sound.wrong).call(sound);
    this.showResults('pairResult', () => (again.length ? this.pair(this.pairAttempt + 1, again) : this.gorzko()));
  }

  // 4. Gorzko!
  private gorzko() {
    const ids = this.awake();
    if (!ids.length) {
      this.nextSong();
      return;
    }
    this.newTask(ids);
    this.resultKey = this.key;
    this.counts.clear();
    this.gorzkoStart = Date.now() + GORZKO_LEAD_MS;
    this.gorzkoEnd = this.gorzkoStart + GORZKO_MS;
    this.endsAt = this.gorzkoEnd;
    this.phase = 'gorzko';
    this.at(this.gorzkoEnd - Date.now() + LATE_MS, () => this.gorzkoDone());
    this.update();
  }

  private gorzkoDone() {
    if (this.phase !== 'gorzko') return;
    const counts: Record<string, number> = {};
    for (const id of this.inTask) counts[id] = this.counts.get(id) ?? 0;
    const { pts, slowest } = gorzkoPoints(counts);
    for (const id of this.inTask) {
      this.give(id, pts[id]);
      const slow = slowest.includes(id);
      if (slow) this.drinkUp(id);
      this.result(id, {
        big: slow ? 'Slowest! Drink! 🥃' : 'GORZKO!',
        text: `${counts[id]} taps.`,
        good: !slow,
        pts: pts[id],
        drank: slow ? 1 : 0,
      });
    }
    sound.fanfare();
    this.showResults('gorzkoResult', () => this.nextSong());
  }

  private end() {
    this.clear();
    this.phase = 'end';
    this.resultKey = ++this.key;
    for (const id of this.ids) {
      const p = this.g.get(id);
      if (p && !p.everOut) {
        p.score += SURVIVOR_BONUS;
        this.result(id, { big: 'You survived till 3:00!', text: 'Never once under the table.', good: true, pts: SURVIVOR_BONUS, drank: 0 });
      }
    }
    this.endsAt = Date.now() + END_MS;
    sound.fanfare();
    this.at(END_MS, () => this.host.finish(this.scores()));
    this.update();
  }

  // ---- Phones ---------------------------------------------------------------------

  onMessage(id: string, m: PhoneMsg) {
    if (m.t !== 'wesele' || m.key !== this.key || !this.inTask.has(id) || this.answered.has(id)) return;
    if (this.phase === 'shot' && m.drink) {
      this.answered.add(id);
      sound.plop();
    } else if (this.phase === 'dance' && typeof m.n === 'number' && Number.isFinite(m.n)) {
      // Twirls arrive as they happen, so the TV can spin you live. Never counts as "answered".
      const n = Math.max(0, Math.min(DANCE_MAX, Math.round(m.n)));
      if (n > (this.twirls.get(id) ?? 0)) {
        this.twirls.set(id, n);
        if (n === this.need) sound.pickup();
      }
      this.host.changed();
      return;
    } else if (this.phase === 'pair' && typeof m.at === 'number' && Number.isFinite(m.at)) {
      this.releases.set(id, Math.round(m.at));
      this.answered.add(id);
    } else if (this.phase === 'gorzko' && typeof m.n === 'number' && Number.isFinite(m.n)) {
      this.counts.set(id, Math.max(0, Math.min(GORZKO_MAX, Math.round(m.n))));
      this.answered.add(id);
    } else return;
    this.host.refresh(id);
    this.host.changed();
    if (this.allIn()) {
      const done = { shot: () => this.shotDone(), dance: () => this.danceDone(), pair: () => this.pairDone(), gorzko: () => this.gorzkoDone() } as Record<string, () => void>;
      const fn = done[this.phase];
      // Don't cut a timed task short: the pair game and Gorzko run to the end anyway.
      if (fn && (this.phase === 'shot' || Date.now() > this.endsAt)) {
        this.clear();
        this.at(600, fn);
      }
    }
  }

  onConnection() {
    if (this.phase === 'shot' && this.answered.size > 0 && this.allIn()) {
      this.clear();
      this.at(600, () => this.shotDone());
    }
    this.host.changed();
  }

  onRemoved(id: string) {
    this.ids = this.ids.filter((x) => x !== id);
    this.g.delete(id);
    this.inTask.delete(id);
    this.pairs = this.pairs.map((p) => (p.a === id && p.b ? { a: p.b, b: null, wujekAt: 0 } : p.b === id ? { ...p, b: null, wujekAt: 0 } : p)).filter((p) => p.a !== id);
    if (this.ids.length === 0) {
      this.clear();
      this.host.finish({});
      return;
    }
    this.onConnection();
  }

  viewFor(id: string): PhoneView {
    const p = this.g.get(id) ?? { drunk: 0, out: false, everOut: false, score: 0 };
    const r = this.results.get(id);
    const base = {
      v: 'wesele' as const,
      key: this.key,
      song: Math.max(1, Math.min(this.song, this.songs)),
      songs: this.songs,
      clock: clockFor(this.phase === 'end' ? this.songs + 1 : Math.max(1, this.song), this.songs),
      drunk: p.drunk,
      total: p.score,
      endsAt: this.endsAt,
      done: this.answered.has(id),
    };
    const res = r && r.key === this.resultKey ? { big: r.big, text: r.text, good: r.good, pts: r.pts, drank: r.drank } : undefined;
    if (this.phase === 'intro') return { ...base, phase: 'intro' };
    if (this.phase === 'end') return { ...base, phase: 'end', result: res };
    if (p.out && !res) return { ...base, phase: 'out' };
    if (this.phase === 'shotShow' || this.phase === 'danceResult' || this.phase === 'pairResult' || this.phase === 'gorzkoResult') {
      return res ? { ...base, phase: 'result', result: res } : { ...base, phase: 'wait', text: 'Watching the others…' };
    }
    if (!this.inTask.has(id)) {
      const text = this.phase === 'dance' ? 'You danced well. Watch the others twirl with Wujek!' : this.phase === 'pair' ? 'You did it! Watch the others try.' : 'Hang on…';
      return { ...base, phase: 'wait', text };
    }
    if (this.phase === 'shot') return { ...base, phase: 'shot' };
    if (this.phase === 'dance') return { ...base, phase: 'dance', dance: { startAt: this.danceStart, endAt: this.danceEnd, need: this.need, attempt: this.danceAttempt } };
    if (this.phase === 'pair') {
      const pr = this.pairs.find((x) => x.a === id || x.b === id);
      const partnerId = pr ? (pr.a === id ? pr.b : pr.a) : null;
      const partner = partnerId ? this.host.player(partnerId) : undefined;
      return {
        ...base,
        phase: 'pair',
        pair: {
          title: this.task.title,
          button: this.task.button,
          partner: partner?.name ?? 'Wujek Zbyszek',
          partnerColor: partner?.color ?? null,
          nowAt: this.nowAt,
          attempt: this.pairAttempt,
        },
      };
    }
    return { ...base, phase: 'gorzko', gorzko: { startAt: this.gorzkoStart, endAt: this.gorzkoEnd } };
  }

  // ---- TV -------------------------------------------------------------------------

  private banner(): { title: string; sub?: string } {
    switch (this.phase) {
      case 'intro':
        return { title: 'Wesele!', sub: 'Shots, twirls with Wujek, oczepiny and Gorzko. Survive till 3:00.' };
      case 'shot':
        return { title: 'KOLEJKA! 🥃', sub: 'Swipe the glass up on your phone to drink' };
      case 'shotShow':
        return { title: 'Na zdrowie!', sub: 'Everyone is a little drunker' };
      case 'dance':
        return {
          title: this.danceAttempt > 1 ? 'Dance again!' : 'Twirl with Wujek Zbyszek!',
          sub: `Spin your finger in circles on your phone · ${this.need} twirls or you drink`,
        };
      case 'danceResult':
        return { title: 'How was the dance?' };
      case 'pair':
        return { title: this.task.title, sub: `Oczepiny · hold the button, let go together on NOW!${this.pairAttempt > 1 ? ` · try ${this.pairAttempt}` : ''}` };
      case 'pairResult':
        return { title: 'Oczepiny results' };
      case 'gorzko':
        return { title: 'GORZKO! GORZKO!', sub: 'Tap as fast as you can. The slowest drinks!' };
      case 'gorzkoResult':
        return { title: 'Gorzko!' };
      case 'end':
        return { title: '3:00. The band packs up.', sub: 'Who is the king or queen of the wedding?' };
    }
  }

  private badge(id: string): { text: string; good: boolean } | null {
    const showing = this.phase === 'shotShow' || this.phase.endsWith('Result') || this.phase === 'end';
    const r = this.results.get(id);
    if (!showing || !r || r.key !== this.resultKey) return null;
    if (r.drank) return { text: this.g.get(id)?.out ? '💤 out!' : '🥃 drink!', good: false };
    return { text: r.pts ? `+${r.pts}` : '✓', good: true };
  }

  /** Where guest `i` sits: four seats behind each of the two round tables. Bottom-centre of the pierogi. */
  private seat(i: number): { x: number; y: number } {
    // Alternate the guests between the two tables, so both sides of the hall fill up.
    const table = TABLES[i % 2];
    const [dx, dy] = SEATS[Math.floor(i / 2) % 4];
    return { x: table.x + dx, y: table.y + dy };
  }

  /** Where each guest stands right now, and what they're doing. */
  private placeAll(): Map<string, { x: number; y: number; act: Act; z: number }> {
    const out = new Map<string, { x: number; y: number; act: Act; z: number }>();
    const ph = this.phase;
    // Dancers ring round Wujek in the middle of the floor.
    if (ph === 'dance' || ph === 'danceResult') {
      const dancers = this.ids.filter((id) => this.inTask.has(id));
      dancers.forEach((id, k) => {
        const a = -Math.PI / 2 + ((k + 0.5) / dancers.length) * Math.PI * 2;
        out.set(id, { x: FLOOR.x + Math.cos(a) * 420, y: FLOOR.y + 40 + Math.sin(a) * 100, act: ph === 'dance' ? 'twirl' : 'stand', z: 20 + Math.round(Math.sin(a) * 10) });
      });
    }
    // Pairs face each other across the floor.
    if (ph === 'pair' || ph === 'pairResult') {
      const n = this.pairs.length;
      const gap = Math.min(450, 1150 / Math.max(1, n));
      this.pairs.forEach((p, k) => {
        const cx = FLOOR.x + (k - (n - 1) / 2) * gap;
        const act: Act = ph === 'pairResult' && p.ok ? 'clink' : 'stand';
        out.set(p.a, { x: cx - 70, y: FLOOR.y + 70, act, z: 20 });
        if (p.b) out.set(p.b, { x: cx + 70, y: FLOOR.y + 70, act, z: 20 });
      });
    }
    this.ids.forEach((id, i) => {
      if (out.has(id)) return;
      const p = this.g.get(id);
      const s = this.seat(i);
      if (p?.out) {
        out.set(id, { x: s.x, y: s.y + 175, act: 'out', z: 8 });
        return;
      }
      const drinking = (ph === 'shot' && this.answered.has(id)) || ph === 'shotShow';
      const act: Act = drinking ? 'drink' : ph === 'gorzko' ? 'bang' : 'sit';
      out.set(id, { x: s.x, y: s.y, act, z: 2 });
    });
    return out;
  }

  render() {
    const b = this.banner();
    const lead = this.phase === 'end' ? Math.max(...this.ids.map((id) => this.g.get(id)?.score ?? 0)) : -1;
    const places = this.placeAll();
    const dancing = this.phase === 'dance';
    const wujekOnFloor = this.phase === 'dance' || this.phase === 'danceResult';
    const wPair = this.phase === 'pair' || this.phase === 'pairResult' ? this.pairs.find((p) => p.b === null) : undefined;
    const wPartner = wPair ? places.get(wPair.a) : undefined;

    return (
      <div class={`screen wes-screen ph-${this.phase}`}>
        <div class="wes-hall">
          <div class="wes-drapes" />
          <div class="wes-lights" />
          <div class="wes-floor" />
        </div>

        <div class="wes-stage">
          <Band playing={this.phase !== 'end'} />
        </div>
        <div class="wes-banner-hang">Młodej Parze Sto Lat!</div>
        <HeadTable kiss={this.phase === 'gorzko' || this.phase === 'gorzkoResult'} />

        {TABLES.map((t) => (
          <div class="wes-table-wrap" style={{ left: `${t.x}px`, top: `${t.y}px` }}>
            <RoundTable />
          </div>
        ))}

        <div
          class={`wes-wujek ${wujekOnFloor ? 'floor' : ''} ${dancing ? 'dance' : ''}`}
          style={wujekOnFloor ? { left: `${FLOOR.x}px`, top: `${FLOOR.y + 40}px` } : wPartner ? { left: `${wPartner.x + 140}px`, top: `${wPartner.y}px` } : { left: '150px', top: '960px' }}
        >
          <Wujek size={wujekOnFloor ? 170 : 150} dancing={dancing || this.phase === 'intro' || this.phase === 'end'} />
        </div>

        {this.ids.map((id) => {
          const pl = this.host.player(id);
          const p = this.g.get(id);
          const at = places.get(id);
          if (!pl || !p || !at) return null;
          const badge = this.badge(id);
          const live = dancing && this.inTask.has(id) ? (this.twirls.get(id) ?? 0) : null;
          const spin = live !== null ? Math.max(0.25, 1.4 - live * 0.11) : null;
          return (
            <div
              key={id}
              class={`wes-spot ${at.act === 'twirl' && live !== null && live >= this.need ? 'made-it' : ''}`}
              style={{ left: `${at.x}px`, top: `${at.y}px`, zIndex: at.z, '--spin': spin !== null ? `${spin}s` : undefined }}
            >
              {this.phase === 'end' && p.score === lead && <span class="wes-crown">👑</span>}
              {badge && <span class={`wes-badge ${badge.good ? 'good' : 'bad'}`}>{badge.text}</span>}
              {live !== null && (
                <span class="wes-twirls">
                  🌀 {live}/{this.need}
                </span>
              )}
              <PGuest
                color={colorHex(pl.color)}
                name={pl.name}
                drunk={p.drunk}
                act={at.act}
                size={120}
                tag={<b class="pg-score">{p.score.toLocaleString('en-US')}</b>}
              />
            </div>
          );
        })}

        <div class="wes-top">
          <div class="pill">🕐 {clockFor(this.phase === 'end' ? this.songs + 1 : Math.max(1, this.song), this.songs)}</div>
          {this.song > 0 && this.phase !== 'end' && (
            <div class="pill">
              Song {this.song} / {this.songs}
            </div>
          )}
          <div class="grow" />
          {(this.phase === 'shot' || this.phase === 'gorzko' || this.phase === 'dance') && (
            <TimerRing key={`t${this.key}`} endsAt={this.endsAt} total={Math.max(1000, this.endsAt - Date.now())} size={100} />
          )}
        </div>

        <div class="wes-banner pop-in" key={`b${this.phase}-${this.key}`}>
          <b>{b.title}</b>
          {b.sub && <span>{b.sub}</span>}
        </div>

        {this.phase === 'dance' && <StartCall at={this.danceStart} go="TWIRL! 🌀" />}
        {this.phase === 'pair' && <NowCall nowAt={this.nowAt} />}
        {this.phase === 'gorzko' && <GorzkoCall startAt={this.gorzkoStart} />}
      </div>
    );
  }
}

/** Guest tables (centre of the table top) and the four seats behind each, relative to it. */
const TABLES = [
  { x: 270, y: 560 },
  { x: 1458, y: 560 },
];
const SEATS: [number, number][] = [
  [-160, -25],
  [-58, -52],
  [58, -52],
  [160, -25],
];
const FLOOR = { x: 864, y: 790 };

/** A countdown, then a "go" word that stays up. */
function StartCall({ at, go }: { at: number; go: string }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    let last = '';
    const loop = () => {
      const t = at - Date.now();
      const txt = t > 0 ? String(Math.ceil(t / 1000)) : go;
      if (el.current && txt !== last) {
        last = txt;
        el.current.textContent = txt;
        el.current.className = `wes-call ${t > 0 ? 'count' : 'now'}`;
        if (t > 0) sound.count();
        else sound.go();
      }
      if (t > -1200) raf = requestAnimationFrame(loop);
      else if (el.current) el.current.className = 'wes-call gone';
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [at]);
  return <div class="wes-call" ref={el} />;
}

/** 3, 2, 1, NOW! for the pair game. */
function NowCall({ nowAt }: { nowAt: number }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    let last = '';
    const loop = () => {
      const t = nowAt - Date.now();
      const txt = t > 3000 ? 'Hold your button…' : t > 0 ? String(Math.ceil(t / 1000)) : 'NOW!';
      if (el.current && txt !== last) {
        last = txt;
        el.current.textContent = txt;
        el.current.className = `wes-call ${txt === 'NOW!' ? 'now' : 'count'}`;
        if (txt === 'NOW!') sound.go();
        else if (t <= 3000) sound.count();
      }
      if (t > -1500) raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [nowAt]);
  return <div class="wes-call" ref={el} />;
}

/** The room chanting while everyone taps. */
function GorzkoCall({ startAt }: { startAt: number }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    let last = '';
    const loop = () => {
      const t = startAt - Date.now();
      const txt = t > 0 ? String(Math.ceil(t / 1000)) : 'TAP! TAP! TAP!';
      if (el.current && txt !== last) {
        last = txt;
        el.current.textContent = txt;
        el.current.className = `wes-call ${t > 0 ? 'count' : 'now chant'}`;
        if (t > 0) sound.count();
        else sound.go();
      }
      if (t > -GORZKO_MS) raf = requestAnimationFrame(loop);
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [startAt]);
  return <div class="wes-call" ref={el} />;
}
