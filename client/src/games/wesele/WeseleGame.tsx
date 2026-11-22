/**
 * Wesele on the TV: a 3D village wedding hall with a disco polo band (see scene.ts), and the night's
 * flow. Each song: a toast (drink for points, or kompot), then three challenges. Every challenge ends
 * the same way – 🏆 best +300 · ✓ safe +100 · 🥃 the losers drink – and the TV says so in big letters.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { colorHex, type PhoneMsg, type PhoneView } from '../../../../shared/protocol';
import type { Game, GameHost } from '../types';
import { ARENA_SCALE } from '../arena/kit';
import { TimerRing } from '../../host/components';
import { Pierogi } from '../../lib/art';
import { music } from '../../lib/music';
import { sound } from '../../lib/sound';
import {
  CHALLENGES,
  DRUNK_NAMES,
  GORZKO_MAX,
  GORZKO_MS,
  MAX_DRUNK,
  MOVES,
  MOVES_MS,
  MOVE_SHOW_MS,
  PAIR_LATE_MS,
  PAIR_TASKS,
  POUR_MS,
  SONG_TITLES,
  SURVIVOR_BONUS,
  TOAST_PTS,
  TRAIN_BEATS,
  TRAIN_MISS_MS,
  TWIRL_MAX,
  TWIRL_MS,
  WAKE_DRUNK,
  WESELE_SONGS,
  WESELE_SONGS_SHORT,
  ZUREK,
  clockFor,
  drink,
  gradeGorzko,
  gradeMoves,
  gradePour,
  gradeTrain,
  gradeTwirl,
  grade,
  makeMoves,
  makePairs,
  movesNeeded,
  movesRight,
  mulberry32,
  pairOk,
  pairWindowMs,
  planNight,
  pointsFor,
  pourLine,
  spilled,
  trainBeatMs,
  twirlsNeeded,
  wujekRelease,
  zurekSong,
  type ChallengeId,
  type PairTask,
  type Rng,
  type ToastChoice,
  type Verdict,
} from './logic';
import { WeseleScene } from './scene';
import './wesele.css';

const INTRO_MS = 11000;
const SONG_MS = 4200;
const ZUREK_MS = 2500;
const TOAST_MS = 9000;
const TOAST_SHOW_MS = 4200;
/** The challenge card and countdown before the timed part starts. */
const LEAD_MS = 5000;
/** Extra "hold it…" before the pair game's countdown. */
const PAIR_HOLD_MS = 2000;
const RESULT_MS = 6000;
const END_MS = 10000;
/** Answers sent right at a deadline get this long to arrive. */
const LATE_MS = 1200;
const HUD_MS = 120;

export type Phase = 'intro' | 'song' | 'toast' | 'toastShow' | 'play' | 'result' | 'end';
/** What happened to a guest in the last task (shown over their head and on their phone). */
export type Outcome = Verdict | 'out' | 'toast' | 'kompot';

export interface Guest {
  drunk: number;
  out: boolean;
  everOut: boolean;
  score: number;
  gone: boolean;
}

export interface Pair {
  a: number;
  /** null: Wujek Zbyszek. */
  b: number | null;
  ok?: boolean;
  gap?: number | null;
  wujekAt?: number;
}

interface Result {
  key: number;
  verdict: Outcome | 'end';
  big: string;
  text: string;
  pts: number;
}

export class WeseleGame implements Game {
  readonly id = 'wesele' as const;
  readonly songs: number;
  readonly plan: ChallengeId[][];
  song = 0;
  /** Which challenge of the song (0-based). */
  step = 0;
  phase: Phase = 'intro';
  ch: ChallengeId | null = null;
  key = 0;
  /** When the current phase ends (for the timer). */
  endsAt = 0;
  /** When the phase started (Date.now). */
  phaseAt = 0;
  guests: Guest[];
  /** Taking part in the current task. */
  inTask: boolean[];
  answered: boolean[];
  /** Live progress per guest: twirls, taps, pour level, moves tapped, beats hit. */
  live: number[];
  /** The final result per guest this task (null: none). */
  value: (number | null)[];
  outcome: (Outcome | null)[];
  toast: (ToastChoice | null)[];
  pairs: Pair[] = [];
  task: PairTask = PAIR_TASKS[0];
  /** The timed part of the challenge: GO / NOW! / first beat … end. */
  goAt = 0;
  endAt = 0;
  /** Twirls needed, the pour line, the duck-dance moves and when you repeat them, the train's beat. */
  need = 0;
  line = 0.7;
  moves: number[] = [];
  inputAt = 0;
  beat = 600;
  /** The train's beats are the music's (false: the TV claps them itself). */
  synced = false;
  zurek = false;
  title = '';
  private rng: Rng;
  private results: (Result | null)[];
  private resultKey = 0;
  private timers: number[] = [];
  private scene: WeseleScene | null = null;
  private glError = false;
  private raf = 0;
  private lastFrame = 0;
  private lastHud = 0;

  constructor(
    private host: GameHost,
    public ids: string[],
    seed = Math.floor(Math.random() * 1e9),
  ) {
    this.rng = mulberry32(seed);
    this.songs = host.short ? WESELE_SONGS_SHORT : WESELE_SONGS;
    this.plan = planNight(this.songs, this.rng);
    const n = ids.length;
    this.guests = ids.map(() => ({ drunk: 0, out: false, everOut: false, score: 0, gone: false }));
    this.inTask = Array(n).fill(false);
    this.answered = Array(n).fill(false);
    this.live = Array(n).fill(0);
    this.value = Array(n).fill(null);
    this.outcome = Array(n).fill(null);
    this.toast = Array(n).fill(null);
    this.results = Array(n).fill(null);
  }

  start() {
    if (new URLSearchParams(location.search).has('debug')) (window as unknown as Record<string, WeseleGame>).wesele = this;
    this.setPhase('intro', INTRO_MS);
    sound.fanfare();
    this.at(INTRO_MS, () => this.nextSong());
    this.update();
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.clear();
    this.detach();
  }

  attach(canvas: HTMLCanvasElement) {
    try {
      this.scene = new WeseleScene(
        canvas,
        this.ids.map((id) => {
          const p = this.host.player(id);
          return { name: p?.name ?? '?', color: colorHex(p?.color ?? 'sourcream') };
        }),
      );
      this.guests.forEach((g, i) => g.gone && this.scene?.hide(i));
    } catch (err) {
      console.error(err);
      this.glError = true;
      this.host.changed();
    }
  }

  detach() {
    this.scene?.dispose();
    this.scene = null;
  }

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.scene?.render(this, dt);
    if (now - this.lastHud > HUD_MS) {
      this.lastHud = now;
      this.host.changed();
    }
  };

  // ---- helpers -------------------------------------------------------------------------------------

  private clear() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  private at(ms: number, fn: () => void) {
    this.timers.push(window.setTimeout(fn, Math.max(0, ms)));
  }

  private update() {
    this.host.refresh();
    this.host.changed();
  }

  private setPhase(phase: Phase, ms: number) {
    this.phase = phase;
    this.phaseAt = Date.now();
    this.endsAt = this.phaseAt + ms;
  }

  private present(i: number) {
    return !this.guests[i].gone && !!this.host.player(this.ids[i])?.connected;
  }

  private awake(): number[] {
    return this.guests.map((g, i) => (!g.gone && !g.out ? i : -1)).filter((i) => i >= 0);
  }

  /** Down a shot. Returns true if that one put them under the table. */
  private drinkUp(i: number): boolean {
    const g = this.guests[i];
    if (!g || g.out) return false;
    const d = drink(g.drunk);
    g.drunk = d.level;
    if (d.out) {
      g.out = true;
      g.everOut = true;
      this.host.buzz(this.ids[i], [300, 100, 300]);
    } else this.host.buzz(this.ids[i], [60, 40, 160]);
    return d.out;
  }

  private newTask(who: number[]) {
    this.clear();
    this.key++;
    const n = this.ids.length;
    this.inTask = Array(n).fill(false);
    for (const i of who) this.inTask[i] = true;
    this.answered = Array(n).fill(false);
    this.live = Array(n).fill(0);
    this.value = Array(n).fill(null);
    this.outcome = Array(n).fill(null);
  }

  private setResult(i: number, r: Omit<Result, 'key'>) {
    this.results[i] = { ...r, key: this.resultKey };
  }

  private allIn() {
    const waiting = this.inTask.map((t, i) => (t && this.present(i) ? i : -1)).filter((i) => i >= 0);
    return waiting.length > 0 && waiting.every((i) => this.answered[i]);
  }

  // ---- the night -----------------------------------------------------------------------------------

  private nextSong() {
    this.song++;
    this.step = 0;
    if (this.song > this.songs) {
      this.end();
      return;
    }
    // Whoever passed out wakes up, still a bit drunk.
    for (const g of this.guests)
      if (g.out) {
        g.out = false;
        g.drunk = WAKE_DRUNK;
      }
    this.zurek = this.song === zurekSong(this.songs);
    if (this.zurek) for (const g of this.guests) g.drunk = Math.max(0, g.drunk - ZUREK);
    this.title = SONG_TITLES[(this.song - 1 + Math.floor(this.rng() * 3)) % SONG_TITLES.length];
    this.newTask([]);
    this.ch = null;
    const ms = SONG_MS + (this.zurek ? ZUREK_MS : 0);
    this.setPhase('song', ms);
    sound.whoosh();
    this.at(ms, () => this.toastStart());
    this.update();
  }

  // The toast to the young couple: drink it for points, or have kompot.
  private toastStart() {
    const who = this.awake();
    this.newTask(who);
    this.resultKey = this.key;
    this.toast = this.ids.map(() => null);
    this.setPhase('toast', TOAST_MS);
    sound.pickup();
    this.at(TOAST_MS + 300, () => this.toastDone());
    this.update();
  }

  private toastDone() {
    if (this.phase !== 'toast') return;
    this.clear();
    let any = false;
    this.inTask.forEach((t, i) => {
      if (!t) return;
      const c = this.toast[i] ?? 'kompot';
      this.toast[i] = c;
      if (c === 'drink') {
        any = true;
        this.guests[i].score += TOAST_PTS;
        const out = this.drinkUp(i);
        this.outcome[i] = out ? 'out' : 'toast';
        this.setResult(i, out ? { verdict: 'out', big: 'Under the table! 💤', text: 'That toast was one too many. You wake up next song.', pts: TOAST_PTS } : { verdict: 'toast', big: 'Na zdrowie! 🥃', text: `+${TOAST_PTS} points, and one more shot in you.`, pts: TOAST_PTS });
      } else {
        this.outcome[i] = 'kompot';
        this.setResult(i, { verdict: 'kompot', big: 'Kompot 🧃', text: 'Sober and sensible. No points.', pts: 0 });
      }
    });
    if (any) sound.plop();
    this.setPhase('toastShow', TOAST_SHOW_MS);
    this.at(TOAST_SHOW_MS, () => this.challenge());
    this.update();
  }

  // ---- challenges ----------------------------------------------------------------------------------

  private challenge() {
    const ch = this.plan[this.song - 1]?.[this.step];
    if (!ch) {
      this.nextSong();
      return;
    }
    const who = this.awake();
    if (!who.length) {
      this.nextSong();
      return;
    }
    this.ch = ch;
    const now = Date.now();
    let goAt = now + LEAD_MS;
    let endAt = goAt;
    if (ch === 'pair') {
      this.task = PAIR_TASKS[Math.floor(this.rng() * PAIR_TASKS.length)];
      this.pairs = makePairs(who.map(String), this.rng, true).map(([a, b]) => ({ a: Number(a), b: b === null ? null : Number(b) }));
      for (const p of this.pairs) if (p.b === null) p.wujekAt = wujekRelease(this.rng);
      goAt = now + LEAD_MS + PAIR_HOLD_MS;
      endAt = goAt + PAIR_LATE_MS;
    } else if (ch === 'twirl') {
      this.need = twirlsNeeded(this.song, this.songs);
      endAt = goAt + TWIRL_MS;
    } else if (ch === 'gorzko') {
      endAt = goAt + GORZKO_MS;
    } else if (ch === 'pour') {
      this.line = pourLine(this.rng);
      endAt = goAt + POUR_MS;
    } else if (ch === 'kaczuchy') {
      this.moves = makeMoves(movesNeeded(this.song, this.songs), this.rng);
      this.inputAt = goAt + this.moves.length * MOVE_SHOW_MS + 700;
      endAt = this.inputAt + MOVES_MS;
    } else if (ch === 'train') {
      // In time with the band: the beats are the kick drum, starting on the first beat of a bar.
      // The dots roll in for two beats before the first one. Without music (sound not started yet), the
      // TV claps the beat instead.
      const grid = music.nextBar('disco', now + LEAD_MS + 1000);
      this.synced = !!grid;
      this.beat = grid ? grid.beatMs : trainBeatMs(this.song, this.songs);
      goAt = grid ? Math.round(grid.at) : now + LEAD_MS + this.beat * 2;
      endAt = goAt + (TRAIN_BEATS - 1) * this.beat + TRAIN_MISS_MS;
    }
    this.newTask(who);
    this.resultKey = this.key;
    this.goAt = goAt;
    this.endAt = endAt;
    this.setPhase('play', endAt - now);
    if (ch === 'train' && !this.synced) for (let k = 0; k < TRAIN_BEATS; k++) this.at(goAt + k * this.beat - now, () => this.phase === 'play' && clap(k));
    this.at(endAt - now + LATE_MS, () => this.finishPlay());
    this.update();
  }

  private finishPlay() {
    if (this.phase !== 'play' || !this.ch) return;
    this.clear();
    const ch = this.ch;
    const ids = this.inTask.map((t, i) => (t ? i : -1)).filter((i) => i >= 0);
    // Guests who left the room mid-task neither win nor drink.
    const playing = ids.filter((i) => this.answered[i] || this.present(i) || this.value[i] !== null);
    const vals: Record<string, number | null> = {};
    for (const i of playing) vals[i] = this.value[i];
    let verdicts: Record<string, Verdict>;
    const detail: Record<number, string> = {};
    switch (ch) {
      case 'twirl':
        for (const i of playing) {
          vals[i] = this.live[i];
          detail[i] = `${this.live[i]} of ${this.need} twirls`;
        }
        verdicts = gradeTwirl(vals, this.need);
        break;
      case 'gorzko':
        for (const i of playing) {
          vals[i] = this.value[i] ?? this.live[i];
          detail[i] = `${vals[i]} taps`;
        }
        verdicts = gradeGorzko(vals);
        break;
      case 'pour':
        for (const i of playing) {
          const l = this.value[i];
          vals[i] = l;
          detail[i] = l === null || l <= 0 ? 'Never poured' : spilled(l, this.line) ? 'Spilled it everywhere!' : `${Math.round(l * 100)}% full · the line was ${Math.round(this.line * 100)}%`;
        }
        verdicts = gradePour(vals, this.line);
        break;
      case 'kaczuchy':
        for (const i of playing) {
          const v = this.value[i];
          detail[i] = v === null ? (this.answered[i] ? 'Wrong move' : 'Not finished in time') : `All ${this.moves.length} moves in ${(v / 1000).toFixed(1)} s`;
        }
        verdicts = gradeMoves(vals);
        break;
      case 'train':
        for (const i of playing) {
          const v = this.value[i];
          detail[i] = v === null ? 'Missed the train' : `${v} ms off the beat on average`;
        }
        verdicts = gradeTrain(vals);
        break;
      case 'pair': {
        const gaps: Record<string, number | null> = {};
        for (const p of this.pairs) {
          const ra = this.value[p.a];
          const rb = p.b !== null ? this.value[p.b] : (p.wujekAt ?? 0);
          const db = p.b !== null ? this.guests[p.b].drunk : 3;
          p.ok = pairOk(ra, rb, pairWindowMs(this.guests[p.a].drunk, db));
          p.gap = ra !== null && rb !== null ? Math.abs(ra - rb) : null;
          const text = p.gap === null ? 'Someone never let go' : `${p.gap} ms apart`;
          for (const i of p.b !== null ? [p.a, p.b] : [p.a]) {
            if (!playing.includes(i)) continue;
            gaps[i] = p.ok ? (p.gap ?? 0) : null;
            detail[i] = p.ok ? `${this.task.done} ${text}` : text;
          }
        }
        verdicts = grade(gaps, { higherBetter: false, worstDrinks: false });
        break;
      }
    }
    const info = CHALLENGES[ch];
    let drinks = 0;
    for (const i of playing) {
      const v = verdicts[i] ?? 'drink';
      const pts = pointsFor(v);
      this.guests[i].score += pts;
      let o: Outcome = v;
      if (v === 'drink') {
        drinks++;
        if (this.drinkUp(i)) o = 'out';
      }
      this.outcome[i] = o;
      const why = detail[i] ?? '';
      this.setResult(
        i,
        o === 'win'
          ? { verdict: o, big: `🏆 Best! +${pts}`, text: why, pts }
          : o === 'safe'
            ? { verdict: o, big: `✓ Safe! +${pts}`, text: why, pts }
            : o === 'out'
              ? { verdict: o, big: 'Under the table! 💤', text: `${why}. One shot too many: you wake up next song.`, pts }
              : { verdict: o, big: '🥃 Drink!', text: `${why} · ${info.lose} drinks`, pts },
      );
    }
    (drinks < playing.length ? sound.correct : sound.wrong).call(sound);
    this.setPhase('result', RESULT_MS);
    this.at(RESULT_MS, () => {
      this.step++;
      this.challenge();
    });
    this.update();
  }

  private end() {
    this.clear();
    this.newTask([]);
    this.ch = null;
    this.resultKey = this.key;
    this.guests.forEach((g, i) => {
      if (g.gone) return;
      if (!g.everOut) {
        g.score += SURVIVOR_BONUS;
        this.setResult(i, { verdict: 'end', big: 'You survived till 3:00!', text: `Never once under the table: +${SURVIVOR_BONUS}.`, pts: SURVIVOR_BONUS });
      } else this.setResult(i, { verdict: 'end', big: '3:00. Go home!', text: 'You passed out tonight, so no survivor bonus.', pts: 0 });
    });
    this.setPhase('end', END_MS);
    sound.fanfare();
    this.at(END_MS, () => this.host.finish(this.scores()));
    this.update();
  }

  private scores(): Record<string, number> {
    const out: Record<string, number> = {};
    this.ids.forEach((id, i) => !this.guests[i].gone && (out[id] = this.guests[i].score));
    return out;
  }

  // ---- phones --------------------------------------------------------------------------------------

  onMessage(id: string, m: PhoneMsg) {
    const i = this.ids.indexOf(id);
    if (m.t !== 'wesele' || i < 0 || m.key !== this.key || !this.inTask[i] || this.answered[i]) return;
    const num = (x: unknown) => typeof x === 'number' && Number.isFinite(x);
    if (this.phase === 'toast') {
      if (m.choice !== 'drink' && m.choice !== 'kompot') return;
      this.toast[i] = m.choice;
      this.answered[i] = true;
      sound.lockIn();
    } else if (this.phase === 'play' && this.ch) {
      if (!num(m.v)) return;
      const v = m.v as number;
      const now = Date.now();
      switch (this.ch) {
        case 'twirl': {
          const n = Math.max(0, Math.min(TWIRL_MAX, Math.round(v)));
          if (n > this.live[i]) {
            this.live[i] = n;
            if (n === this.need) sound.pickup();
          }
          if (m.live) {
            this.host.changed();
            return;
          }
          break;
        }
        case 'gorzko': {
          const n = Math.max(0, Math.min(GORZKO_MAX, Math.round(v)));
          this.live[i] = Math.max(this.live[i], n);
          if (m.live) {
            this.host.changed();
            return;
          }
          this.value[i] = n;
          break;
        }
        case 'pour': {
          const l = Math.max(0, Math.min(1.2, v));
          this.live[i] = l;
          if (m.live) {
            this.host.changed();
            return;
          }
          if (now < this.goAt - 500) return;
          this.value[i] = l;
          sound.plop();
          break;
        }
        case 'kaczuchy': {
          if (m.live) {
            this.live[i] = Math.max(0, Math.min(this.moves.length, Math.round(v)));
            this.host.changed();
            return;
          }
          const ok = movesRight(this.moves, m.moves);
          this.live[i] = ok ? this.moves.length : Math.min(this.moves.length, m.moves?.length ?? 0);
          this.value[i] = ok ? Math.max(0, Math.min(MOVES_MS, Math.round(v))) : null;
          (ok ? sound.correct : sound.wrong).call(sound);
          break;
        }
        case 'train': {
          if (m.live) {
            this.live[i] = Math.max(0, Math.min(TRAIN_BEATS, Math.round(v)));
            this.host.changed();
            return;
          }
          this.value[i] = Math.max(0, Math.min(TRAIN_MISS_MS * 2, Math.round(v)));
          break;
        }
        case 'pair':
          this.value[i] = Math.round(v);
          break;
      }
      this.answered[i] = true;
    } else return;
    this.host.refresh(id);
    this.host.changed();
    this.checkAllIn();
  }

  /** Everyone's in: move on (but never before the timed part is over). */
  private checkAllIn() {
    if (!this.allIn()) return;
    const now = Date.now();
    if (this.phase === 'toast') {
      this.clear();
      this.at(900, () => this.toastDone());
    } else if (this.phase === 'play' && this.ch) {
      const earliest = this.ch === 'pair' ? this.goAt + PAIR_LATE_MS : this.ch === 'pour' || this.ch === 'kaczuchy' ? now : this.endAt;
      this.clear();
      this.at(Math.max(now, earliest) - now + 700, () => this.finishPlay());
    }
  }

  onConnection() {
    this.checkAllIn();
    this.host.changed();
  }

  onRemoved(id: string) {
    const i = this.ids.indexOf(id);
    if (i < 0 || this.guests[i].gone) return;
    this.guests[i].gone = true;
    this.inTask[i] = false;
    this.scene?.hide(i);
    // Their partner gets Wujek instead.
    this.pairs = this.pairs
      .map((p) => (p.a === i ? (p.b !== null ? { a: p.b, b: null, wujekAt: 0 } : null) : p.b === i ? { ...p, b: null, wujekAt: 0 } : p))
      .filter((p): p is Pair => p !== null);
    if (this.guests.every((g) => g.gone)) {
      this.clear();
      this.host.finish({});
      return;
    }
    this.checkAllIn();
    this.update();
  }

  viewFor(id: string): PhoneView {
    const i = this.ids.indexOf(id);
    const g = this.guests[i] ?? { drunk: 0, out: false, everOut: false, score: 0, gone: true };
    const r = this.results[i];
    const base = {
      v: 'wesele' as const,
      key: this.key,
      song: Math.max(1, Math.min(this.song, this.songs)),
      songs: this.songs,
      clock: this.clock(),
      drunk: g.drunk,
      total: g.score,
      endsAt: this.endsAt,
      done: !!this.answered[i],
    };
    const res = r && r.key === this.resultKey ? { verdict: r.verdict, big: r.big, text: r.text, pts: r.pts } : undefined;
    if (this.phase === 'intro') return { ...base, phase: 'intro' };
    if (this.phase === 'end') return { ...base, phase: 'end', result: res };
    if (this.phase === 'song') return { ...base, phase: 'song', title: this.title, zurek: this.zurek };
    if (g.out && !res) return { ...base, phase: 'out' };
    if (this.phase === 'toastShow' || this.phase === 'result') {
      return res ? { ...base, phase: 'result', result: res } : { ...base, phase: 'wait', text: 'Watch the TV' };
    }
    if (!this.inTask[i]) return { ...base, phase: 'wait', text: 'Hang on…' };
    if (this.phase === 'toast') return { ...base, phase: 'toast', toast: this.toast[i] };
    const ch = this.ch!;
    const c: NonNullable<Extract<PhoneView, { v: 'wesele' }>['ch']> = { id: ch, goAt: this.goAt, endAt: this.endAt };
    if (ch === 'twirl') c.need = this.need;
    if (ch === 'pour') c.line = this.line;
    if (ch === 'kaczuchy') {
      c.len = this.moves.length;
      c.inputAt = this.inputAt;
    }
    if (ch === 'train') {
      c.beat = this.beat;
      c.beats = TRAIN_BEATS;
    }
    if (ch === 'pair') {
      const pr = this.pairs.find((p) => p.a === i || p.b === i);
      const partnerIdx = pr ? (pr.a === i ? pr.b : pr.a) : null;
      const partner = partnerIdx !== null ? this.host.player(this.ids[partnerIdx]) : undefined;
      c.pair = { title: this.task.title, button: this.task.button, partner: partner?.name ?? 'Wujek Zbyszek', partnerColor: partner?.color ?? null };
    }
    return { ...base, phase: 'play', ch: c };
  }

  clock() {
    return clockFor(this.phase === 'end' ? this.songs + 1 : Math.max(1, this.song), this.songs);
  }

  // ---- TV ------------------------------------------------------------------------------------------

  render() {
    return <WeseleView game={this} />;
  }

  hud() {
    const players = this.ids.map((id) => this.host.player(id));
    const now = Date.now();
    const timed = this.phase === 'toast' || (this.phase === 'play' && now < this.endAt);
    const lead = this.phase === 'end' ? Math.max(...this.guests.filter((g) => !g.gone).map((g) => g.score)) : -1;
    return (
      <>
        <div class="wes-top">
          <span class="pill wes-clock">🕐 {this.clock()}</span>
          {this.song > 0 && this.phase !== 'end' && (
            <span class="pill">
              Song {this.song} / {this.songs}
            </span>
          )}
          {this.title && this.phase !== 'intro' && this.phase !== 'end' && <span class="wes-nowplaying">♪ {this.title}</span>}
          <span class="grow" />
          {timed && <TimerRing key={`t${this.key}-${this.phase}`} endsAt={this.endsAt} total={Math.max(1000, this.endsAt - this.phaseAt)} size={96} />}
        </div>

        {this.phase === 'intro' && <IntroCard short={this.songs === WESELE_SONGS_SHORT} />}
        {this.phase === 'song' && <SongCard game={this} />}
        {this.phase === 'toast' && (
          <div class="wes-card wes-card-top pop-in" key={`toast${this.key}`}>
            <div class="wes-card-kicker">A toast to the young couple!</div>
            <div class="wes-card-big">🥂 Sto lat! 🥂</div>
            <div class="wes-rules">
              <span class="wes-rule win">🥃 Drink: +{TOAST_PTS} points, +1 shot</span>
              <span class="wes-rule">🧃 Kompot: no points, stay sober</span>
            </div>
            <div class="wes-card-sub">Choose on your phone</div>
          </div>
        )}
        {this.phase === 'play' && this.ch && <ChallengeCard game={this} />}
        {this.phase === 'result' && this.ch && <ResultCard game={this} players={players} />}
        {this.phase === 'end' && <EndCard game={this} players={players} />}

        {this.phase === 'play' && this.ch === 'kaczuchy' && <MovesShow game={this} />}
        {this.phase === 'play' && this.ch === 'train' && <TrainLane game={this} />}
        {this.phase === 'play' && (this.ch === 'twirl' || this.ch === 'gorzko' || this.ch === 'pour') && <StartCall key={`s${this.key}`} at={this.goAt} go={this.ch === 'twirl' ? 'TWIRL! 🌀' : this.ch === 'pour' ? 'POUR! 🍾' : 'TAP! TAP! TAP!'} />}
        {this.phase === 'play' && this.ch === 'pair' && <NowCall key={`n${this.key}`} nowAt={this.goAt} />}

        {this.popSpots().map((at, i) => this.pop(i, at))}

        <div class="wes-chips">
          {this.ids.map((_, i) => {
            const p = players[i];
            const g = this.guests[i];
            if (!p || g.gone) return null;
            return (
              <div class={`wes-chip ${g.out ? 'out' : ''} ${lead >= 0 && g.score === lead ? 'king' : ''}`} style={{ '--pc': colorHex(p.color) }}>
                <Pierogi color={colorHex(p.color)} size={44} mood={g.out ? 'sleep' : !p.connected ? 'dead' : g.drunk >= 3 ? 'wow' : 'happy'} />
                <span class="wes-chip-text">
                  <b>{p.name}</b>
                  <small>{g.score.toLocaleString('en-US')} pts</small>
                  <span class="wes-glasses" title={DRUNK_NAMES[g.drunk]}>
                    {Array.from({ length: MAX_DRUNK }, (_, k) => (
                      <i class={k < g.drunk || g.out ? 'full' : ''} />
                    ))}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
        {this.glError && <div class="trails-banner">This screen can’t show 3D graphics (WebGL is off).</div>}
      </>
    );
  }

  /** Where each guest's label goes: over their head, nudged up so neighbours' labels don't overlap. */
  private popSpots() {
    const spots = this.ids.map((_, i) => (this.guests[i].gone ? null : (this.scene?.headAt(i) ?? null)));
    const placed: { x: number; y: number }[] = [];
    const order = spots.map((_, i) => i).sort((a, b) => (spots[b]?.y ?? 0) - (spots[a]?.y ?? 0));
    for (const i of order) {
      const at = spots[i];
      if (!at || !at.visible) continue;
      let y = at.y;
      while (placed.some((p) => Math.abs(p.x - at.x) < 190 && Math.abs(p.y - y) < 54)) y -= 56;
      placed.push({ x: at.x, y });
      spots[i] = { ...at, y };
    }
    return spots;
  }

  /** What floats over a guest's head: live progress while playing, the verdict after. */
  private pop(i: number, at: { x: number; y: number; visible: boolean } | null) {
    const g = this.guests[i];
    if (g.gone) return null;
    if (!at || !at.visible) return null;
    const style = { left: `${at.x}px`, top: `${at.y}px` };
    const o = this.outcome[i];
    if ((this.phase === 'result' || this.phase === 'toastShow') && o) {
      const text = o === 'win' ? '🏆 +300' : o === 'safe' ? '✓ +100' : o === 'drink' ? '🥃 DRINK!' : o === 'out' ? '💤 OUT!' : o === 'toast' ? `🥃 +${TOAST_PTS}` : '🧃';
      return (
        <div class={`wes-pop o-${o} pop-in`} style={style} key={`p${i}-${this.key}-${this.phase}`}>
          {text}
        </div>
      );
    }
    if (g.out) return null;
    if (this.phase === 'toast' && this.inTask[i]) {
      return (
        <div class={`wes-pop small ${this.answered[i] ? 'ready' : ''}`} style={style}>
          {this.answered[i] ? '✓' : '…'}
        </div>
      );
    }
    if (this.phase !== 'play' || !this.inTask[i] || !this.ch) return null;
    const v = this.live[i];
    switch (this.ch) {
      case 'twirl':
        return (
          <div class={`wes-pop small ${v >= this.need ? 'ready' : ''}`} style={style}>
            🌀 {v}/{this.need}
          </div>
        );
      case 'gorzko':
        return Date.now() >= this.goAt ? (
          <div class="wes-pop small" style={style}>
            💋 {v}
          </div>
        ) : null;
      case 'pour':
        return (
          <div class={`wes-pour ${this.answered[i] ? 'stopped' : ''}`} style={style}>
            <i style={{ height: `${Math.min(100, v * 100)}%` }} class={spilled(v, this.line) ? 'spill' : ''} />
            <b style={{ bottom: `${this.line * 100}%` }} />
          </div>
        );
      case 'kaczuchy':
        return Date.now() >= this.inputAt ? (
          <div class={`wes-pop small ${this.answered[i] ? 'ready' : ''}`} style={style}>
            {'●'.repeat(v)}
            {'○'.repeat(Math.max(0, this.moves.length - v))}
          </div>
        ) : null;
      case 'train':
        return Date.now() >= this.goAt ? (
          <div class="wes-pop small" style={style}>
            🚂 {v}/{TRAIN_BEATS}
          </div>
        ) : null;
      case 'pair':
        return (
          <div class={`wes-pop small ${this.answered[i] ? 'ready' : ''}`} style={style}>
            {this.answered[i] ? '✋' : CHALLENGES.pair.emoji}
          </div>
        );
    }
  }
}

function clap(k: number) {
  sound.note(k % 4 === 0 ? 880 : 660, 0.08, { type: 'square', vol: 0.05 });
  sound.hiss(0.05, 0.25);
}

// ---- TV cards --------------------------------------------------------------------------------------

function IntroCard({ short }: { short: boolean }) {
  return (
    <div class="wes-card wes-card-mid pop-in">
      <div class="wes-card-kicker">Wesele · a village wedding · 18:00 – 3:00</div>
      <div class="wes-card-big">How to win</div>
      <ol class="wes-howto">
        <li>
          <b>🏆</b>
          <span>
            Have the <em>most points</em> at 3:00. {short ? '2 songs' : '5 songs'}, each with a toast and 3 challenges.
          </span>
        </li>
        <li>
          <b>✓</b>
          <span>
            Every challenge: the best scores <em>+300</em>, everyone who makes it <em>+100</em>.
          </span>
        </li>
        <li>
          <b>🥃</b>
          <span>
            Lose a challenge and you <em>drink a shot</em>. Each shot makes your phone wobblier and harder to use.
          </span>
        </li>
        <li>
          <b>💤</b>
          <span>
            Drink with a full meter and you <em>pass out</em>: you miss the rest of the song and the +{SURVIVOR_BONUS} survivor bonus.
          </span>
        </li>
      </ol>
    </div>
  );
}

function SongCard({ game }: { game: WeseleGame }) {
  return (
    <div class="wes-card wes-card-mid pop-in" key={`song${game.song}`}>
      <div class="wes-card-kicker">
        Song {game.song} of {game.songs} · {game.clock()}
      </div>
      <div class="wes-card-big wes-songtitle">♪ {game.title} ♪</div>
      <div class="wes-card-sub">
        Coming up:{' '}
        {game.plan[game.song - 1].map((c) => (
          <span class="wes-up">
            {CHALLENGES[c].emoji} {CHALLENGES[c].name}
          </span>
        ))}
      </div>
      {game.zurek && <div class="wes-zurek pop-in">🍲 Hot żurek is served! Everyone sobers up: −{ZUREK} 🥃</div>}
    </div>
  );
}

function ChallengeCard({ game }: { game: WeseleGame }) {
  const info = CHALLENGES[game.ch!];
  const lead = Date.now() < game.goAt - (game.ch === 'pair' ? PAIR_HOLD_MS : 0);
  let sub = info.how;
  if (game.ch === 'twirl') sub = `Draw circles on your phone · ${game.need} twirls or you drink`;
  if (game.ch === 'pour') sub = `Hold to pour, let go at the line (${Math.round(game.line * 100)}% full)`;
  if (game.ch === 'pair') sub = game.task.title;
  if (game.ch === 'kaczuchy') sub = Date.now() < game.inputAt ? `Remember these ${game.moves.length} moves!` : 'Your turn: repeat the moves on your phone!';
  return (
    <div class={`wes-card wes-card-top ${lead ? 'lead' : 'mini'}`} key={`ch${game.key}`}>
      <div class="wes-card-kicker">
        Challenge {game.step + 1} of 3 · {info.en}
      </div>
      <div class="wes-card-big">
        {info.emoji} {info.name}
      </div>
      <div class="wes-card-sub">{sub}</div>
      {lead && (
        <div class="wes-rules">
          <span class="wes-rule win">🏆 {info.win}: +300</span>
          <span class="wes-rule safe">✓ Made it: +100</span>
          <span class="wes-rule lose">🥃 {info.lose}: drink</span>
        </div>
      )}
    </div>
  );
}

function ResultCard({ game, players }: { game: WeseleGame; players: ReturnType<GameHost['player']>[] }) {
  const info = CHALLENGES[game.ch!];
  const names = (o: Outcome[]) =>
    game.ids
      .map((_, i) => i)
      .filter((i) => game.outcome[i] && o.includes(game.outcome[i]!))
      .map((i) => players[i])
      .filter((p) => !!p);
  const win = names(['win']);
  const drank = names(['drink', 'out']);
  return (
    <div class="wes-card wes-card-bottom pop-in" key={`r${game.key}`}>
      <div class="wes-card-kicker">
        {info.emoji} {info.name} · results
      </div>
      <div class="wes-result-row win">
        <b>🏆</b>
        {win.length ? win.map((p) => <Name p={p!} />) : <span class="wes-nobody">Nobody wins</span>}
        {win.length > 0 && <small>+300</small>}
      </div>
      <div class="wes-result-row lose">
        <b>🥃</b>
        {drank.length ? drank.map((p) => <Name p={p!} />) : <span class="wes-nobody">Nobody drinks!</span>}
        {drank.length > 0 && <small>{drank.length === 1 ? 'drinks' : 'drink'}</small>}
      </div>
    </div>
  );
}

function EndCard({ game, players }: { game: WeseleGame; players: ReturnType<GameHost['player']>[] }) {
  const order = game.ids
    .map((_, i) => i)
    .filter((i) => !game.guests[i].gone && players[i])
    .sort((a, b) => game.guests[b].score - game.guests[a].score);
  const top = order.length ? game.guests[order[0]].score : 0;
  return (
    <div class="wes-card wes-card-mid pop-in">
      <div class="wes-card-kicker">3:00 · the band packs up</div>
      <div class="wes-card-big">{order.length && players[order[0]] ? `👑 ${players[order[0]]!.name} rules the wedding!` : 'Dobranoc!'}</div>
      <div class="wes-final">
        {order.map((i) => {
          const p = players[i]!;
          const g = game.guests[i];
          return (
            <div class={`wes-final-row ${g.score === top ? 'top' : ''}`} style={{ '--pc': colorHex(p.color) }}>
              <Pierogi color={colorHex(p.color)} size={40} mood={g.score === top ? 'wow' : g.everOut ? 'sleep' : 'happy'} />
              <span class="grow">{p.name}</span>
              {!g.everOut && <small>survivor +{SURVIVOR_BONUS}</small>}
              <b>{g.score.toLocaleString('en-US')}</b>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Name({ p }: { p: NonNullable<ReturnType<GameHost['player']>> }) {
  return (
    <span class="wes-name" style={{ '--pc': colorHex(p.color) }}>
      {p.name}
    </span>
  );
}

/** The duck-dance moves shown one by one, then hidden while everyone repeats them. */
function MovesShow({ game }: { game: WeseleGame }) {
  const now = Date.now();
  if (now < game.goAt) return null;
  const k = Math.floor((now - game.goAt) / MOVE_SHOW_MS);
  if (now >= game.inputAt) {
    return (
      <div class="wes-moves hidden">
        {game.moves.map(() => (
          <span>?</span>
        ))}
      </div>
    );
  }
  return (
    <div class="wes-moves">
      {game.moves.map((m, j) => (
        <span class={j === k ? 'now' : j < k ? 'past' : 'next'} key={j}>
          {j <= k ? MOVES[m].emoji : ''}
          {j === k && <small>{MOVES[m].name}</small>}
        </span>
      ))}
    </div>
  );
}

/** The train's beats on the TV: dots roll into a ring, one per beat. */
function TrainLane({ game }: { game: WeseleGame }) {
  const now = Date.now();
  const lead = 2 * game.beat;
  return (
    <div class="wes-lane">
      <div class="wes-lane-ring" />
      {Array.from({ length: TRAIN_BEATS }, (_, k) => {
        const t = game.goAt + k * game.beat - now;
        if (t > lead * 1.5 || t < -400) return null;
        return <span class="wes-lane-dot" style={{ left: `${120 + (t / lead) * 520}px`, opacity: t < 0 ? 0.3 : 1 }} />;
      })}
      <div class="wes-lane-label">🚂 {game.synced ? 'Tap on every kick drum!' : 'Tap on every clap!'}</div>
    </div>
  );
}

/** A countdown, then a "go" word that stays up a moment. */
function StartCall({ at, go }: { at: number; go: string }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    let last = '';
    const loop = () => {
      const t = at - Date.now();
      const txt = t > 3000 ? '' : t > 0 ? String(Math.ceil(t / 1000)) : go;
      if (el.current && txt !== last) {
        last = txt;
        el.current.textContent = txt;
        el.current.className = `wes-call ${t > 0 ? 'count' : 'now'}`;
        if (txt && t > 0) sound.count();
        else if (txt) sound.go();
      }
      if (t > -1200) raf = requestAnimationFrame(loop);
      else if (el.current) el.current.className = 'wes-call gone';
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [at]);
  return <div class="wes-call" ref={el} />;
}

/** Hold… 3, 2, 1, NOW! for the pair game. */
function NowCall({ nowAt }: { nowAt: number }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    let last = '';
    const loop = () => {
      const t = nowAt - Date.now();
      const txt = t > 3000 + PAIR_HOLD_MS ? '' : t > 3000 ? 'Hold your button…' : t > 0 ? String(Math.ceil(t / 1000)) : 'NOW!';
      if (el.current && txt !== last) {
        last = txt;
        el.current.textContent = txt;
        el.current.className = `wes-call ${txt === 'NOW!' ? 'now' : txt.length > 2 ? 'hold' : 'count'}`;
        if (txt === 'NOW!') sound.go();
        else if (t <= 3000) sound.count();
      }
      if (t > -1500) raf = requestAnimationFrame(loop);
      else if (el.current) el.current.className = 'wes-call gone';
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [nowAt]);
  return <div class="wes-call" ref={el} />;
}

function WeseleView({ game }: { game: WeseleGame }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [, force] = useState(0);
  useEffect(() => {
    game.attach(canvas.current!);
    force(1);
    return () => game.detach();
  }, [game]);
  return (
    <div class={`rally wes ph-${game.phase}`}>
      <canvas ref={canvas} class="rally-canvas" width={Math.round(1920 * ARENA_SCALE)} height={Math.round(1080 * ARENA_SCALE)} />
      {game.hud()}
    </div>
  );
}
