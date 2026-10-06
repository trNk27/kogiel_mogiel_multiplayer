import { colorHex, type PhoneMsg, type PhoneView } from '../../../../shared/protocol';
import type { Game, GameHost } from '../types';
import {
  PARADE_COLORS,
  PARADE_GRACE_MS,
  PARADE_LANES,
  PARADE_READY_MS,
  PARADE_ROUNDS,
  PARADE_ROUNDS_SHORT,
  makeParade,
  paradePoints,
  validCount,
  type Parade,
} from './logic';
import { BigCountdown, CountUp, TimerRing } from '../../host/components';
import { Pierogi } from '../../lib/art';
import { sound } from '../../lib/sound';

const RESULT_MS = 8000;
/** Counts sent just before the deadline get this long to arrive. */
const LATE_MS = 500;
const LANE_H = 136;

type Phase = 'ready' | 'count' | 'result';

export class ParadeGame implements Game {
  readonly id = 'parade' as const;
  private readonly rounds: number;
  private round = 0;
  private phase: Phase = 'ready';
  private parade!: Parade;
  /** Date.now() when the parade starts, and when counting closes. */
  private startAt = 0;
  private endsAt = 0;
  private counts = new Map<string, number>();
  private roundPts: Record<string, number> = {};
  private scores: Record<string, number> = {};
  private timer: number | undefined;

  constructor(
    private host: GameHost,
    public ids: string[],
  ) {
    this.rounds = host.short ? PARADE_ROUNDS_SHORT : PARADE_ROUNDS;
    for (const id of ids) this.scores[id] = 0;
  }

  start() {
    this.next();
  }

  dispose() {
    clearTimeout(this.timer);
  }

  private after(ms: number, fn: () => void) {
    clearTimeout(this.timer);
    this.timer = window.setTimeout(fn, ms);
  }

  private update() {
    this.host.refresh();
    this.host.changed();
  }

  private get colour() {
    return PARADE_COLORS[this.parade.target];
  }

  private next() {
    this.round++;
    if (this.round > this.rounds) {
      this.host.finish(this.scores);
      return;
    }
    // A short game plays the middle difficulty.
    this.parade = makeParade(this.host.short ? 1 : this.round - 1);
    this.phase = 'ready';
    this.counts.clear();
    this.roundPts = {};
    this.startAt = Date.now() + PARADE_READY_MS;
    this.endsAt = this.startAt + this.parade.length + PARADE_GRACE_MS;
    sound.reveal();
    this.after(PARADE_READY_MS, () => {
      this.phase = 'count';
      sound.go();
      this.after(this.parade.length + PARADE_GRACE_MS + LATE_MS, () => this.reveal());
      this.update();
    });
    this.update();
  }

  private reveal() {
    this.phase = 'result';
    let exact = false;
    for (const id of this.ids) {
      const n = this.counts.get(id);
      const pts = n === undefined ? 0 : paradePoints(n, this.parade.answer);
      this.roundPts[id] = pts;
      this.scores[id] = (this.scores[id] ?? 0) + pts;
      if (pts > 0) this.host.buzz(id, [60, 60, 60]);
      if (n === this.parade.answer) exact = true;
    }
    if (exact) sound.correct();
    else sound.wrong();
    this.after(RESULT_MS, () => this.next());
    this.update();
  }

  onMessage(id: string, m: PhoneMsg) {
    if (m.t !== 'count' || this.phase === 'result' || m.r !== this.round || !validCount(m.n)) return;
    this.counts.set(id, m.n);
  }

  onConnection() {
    this.host.changed();
  }

  onRemoved(id: string) {
    this.ids = this.ids.filter((x) => x !== id);
    delete this.scores[id];
    if (this.ids.length === 0) this.host.finish({});
    else this.host.changed();
  }

  viewFor(id: string): PhoneView {
    const n = this.counts.get(id);
    return {
      v: 'parade',
      phase: this.phase,
      round: this.round,
      rounds: this.rounds,
      color: this.colour.hex,
      colorName: this.colour.name,
      endsAt: this.endsAt,
      res: this.phase === 'result' ? { n: n ?? null, answer: this.parade.answer, pts: this.roundPts[id] ?? 0, total: this.scores[id] ?? 0 } : null,
    };
  }

  render() {
    const colour = this.colour;
    const players = this.ids.map((id) => this.host.player(id)).filter((p) => !!p);
    const head = (
      <div class="quiz-top">
        <div class="pill">
          Round {this.round} / {this.rounds}
        </div>
        <div class="parade-ask">
          Count the <Pierogi color={colour.hex} size={70} /> <b style={{ color: colour.hex }}>{colour.name}</b> pierogi!
        </div>
        <div class="grow" />
        {this.phase === 'count' && <TimerRing endsAt={this.endsAt} total={this.endsAt - this.startAt} size={110} />}
      </div>
    );

    if (this.phase === 'ready') {
      const decoys = PARADE_COLORS.filter((_, i) => i !== this.parade.target && this.parade.marchers.some((m) => m.c === i));
      return (
        <div class="screen parade parade-ready" key={`ready-${this.round}`}>
          <div class="parade-ready-card">
            <div class="parade-ready-small">Tap your phone once for every…</div>
            <Pierogi color={colour.hex} size={300} mood="wow" class="bob" />
            <div class="parade-ready-big" style={{ color: colour.hex }}>
              {colour.name} pierogi
            </div>
            <div class="parade-ignore">
              Ignore
              {decoys.map((c) => (
                <Pierogi color={c.hex} size={56} mood="sleep" />
              ))}
            </div>
          </div>
          <BigCountdown endsAt={this.startAt} go="Count!" />
        </div>
      );
    }

    if (this.phase === 'count') {
      return (
        <div class="screen parade" key={`count-${this.round}`}>
          {head}
          <div class="parade-street">
            {Array.from({ length: PARADE_LANES }, (_, i) => (
              <div class="parade-lane" style={{ top: `${i * LANE_H + LANE_H - 18}px` }} />
            ))}
            {this.parade.marchers.map((m, i) => (
              <div
                class="parade-walker"
                key={i}
                style={{
                  top: `${m.lane * LANE_H + LANE_H - 18 - 110 * m.size * 0.8}px`,
                  animationName: m.dir > 0 ? 'parade-ltr' : 'parade-rtl',
                  animationDuration: `${m.dur}ms`,
                  animationDelay: `${m.at}ms`,
                }}
              >
                <div class={m.hop ? 'parade-hop' : 'parade-waddle'}>
                  <Pierogi color={PARADE_COLORS[m.c].hex} size={110 * m.size} />
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    const answer = this.parade.answer;
    const rows = players
      .map((p) => ({ p, n: this.counts.get(p.id) ?? null }))
      .sort((a, b) => (a.n === null ? 999 : Math.abs(a.n - answer)) - (b.n === null ? 999 : Math.abs(b.n - answer)));
    return (
      <div class="screen parade parade-result" key={`result-${this.round}`}>
        {head}
        <div class="parade-answer">
          <span>There were</span>
          <b style={{ color: colour.hex }}>
            <CountUp value={answer} ms={1600} />
          </b>
          <span>{colour.name} pierogi</span>
        </div>
        <div class="fork-board parade-board">
          {rows.map(({ p, n }) => {
            const pts = this.roundPts[p.id] ?? 0;
            return (
              <div class={`fork-row ${pts > 0 ? 'good' : 'none'}`}>
                <Pierogi color={colorHex(p.color)} size={56} mood={n === answer ? 'wow' : pts > 0 ? 'happy' : 'dead'} />
                <span class="fork-name">{p.name}</span>
                <span class="fork-time">
                  {n === null ? 'No count' : `counted ${n}`}
                  {n !== null && n !== answer && <small> ({n > answer ? '+' : ''}{n - answer})</small>}
                </span>
                <b class={`fork-pts ${pts > 0 ? 'gain' : ''}`}>{pts > 0 ? `+${pts}` : '0'}</b>
                <span class="fork-total">{this.scores[p.id] ?? 0}</span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }
}
