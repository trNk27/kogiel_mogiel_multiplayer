import { colorHex, type PhoneMsg, type PhoneView } from '../../../../shared/protocol';
import type { Game, GameHost } from '../types';
import {
  FORK_LEAD_MS,
  FORK_ROUNDS,
  FORK_ROUNDS_SHORT,
  forkRoundLength,
  makeForkRound,
  scoreFork,
  stabLabel,
  validStab,
  type ForkStep,
} from './logic';
import { FORK_ITEM_NAMES, ForkThing, Plate } from './art';
import { Pierogi } from '../../lib/art';
import { sound } from '../../lib/sound';

const RESULT_MS = 5500;
/** After the plate closes, stabs still in flight get this long to arrive. */
const LATE_MS = 1200;

type Phase = 'play' | 'result';

export class ForkGame implements Game {
  readonly id = 'fork' as const;
  private readonly rounds: number;
  private round = 0;
  private phase: Phase = 'play';
  /** Date.now() when the plates open on the phones. */
  private startAt = 0;
  private steps: ForkStep[] = [];
  private stabs = new Map<string, number>();
  private roundPts: Record<string, number> = {};
  private places: Record<string, number> = {};
  private scores: Record<string, number> = {};
  private timer: number | undefined;

  constructor(
    private host: GameHost,
    public ids: string[],
  ) {
    this.rounds = host.short ? FORK_ROUNDS_SHORT : FORK_ROUNDS;
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

  private next() {
    this.round++;
    if (this.round > this.rounds) {
      this.host.finish(this.scores);
      return;
    }
    this.phase = 'play';
    // Later rounds have more fakes; in a short game, start from the middle.
    this.steps = makeForkRound(this.host.short ? this.round + 2 : this.round - 1);
    this.stabs.clear();
    this.roundPts = {};
    this.places = {};
    this.startAt = Date.now() + FORK_LEAD_MS;
    sound.reveal();
    this.after(FORK_LEAD_MS + forkRoundLength(this.steps) + LATE_MS, () => this.reveal());
    this.update();
  }

  private reveal() {
    if (this.phase !== 'play') return;
    this.phase = 'result';
    const { points, places } = scoreFork(Object.fromEntries(this.stabs));
    this.roundPts = points;
    this.places = places;
    for (const [id, pts] of Object.entries(points)) {
      this.scores[id] = Math.max(0, (this.scores[id] ?? 0) + pts);
      this.host.buzz(id, pts > 0 ? [60, 60, 60] : [250]);
    }
    if (Object.keys(places).length) sound.correct();
    else sound.wrong();
    this.after(RESULT_MS, () => this.next());
    this.update();
  }

  private everyoneStabbed() {
    return this.ids.every((id) => this.stabs.has(id) || !this.host.player(id)?.connected);
  }

  onMessage(id: string, m: PhoneMsg) {
    if (m.t !== 'fork' || this.phase !== 'play' || m.r !== this.round || this.stabs.has(id) || !validStab(m.ms)) return;
    this.stabs.set(id, m.ms);
    sound.tick();
    this.host.refresh(id);
    this.host.changed();
    if (this.everyoneStabbed()) this.after(700, () => this.reveal());
  }

  onConnection() {
    if (this.phase === 'play' && this.stabs.size > 0 && this.everyoneStabbed()) this.after(700, () => this.reveal());
    this.host.changed();
  }

  onRemoved(id: string) {
    this.ids = this.ids.filter((x) => x !== id);
    delete this.scores[id];
    this.stabs.delete(id);
    if (this.ids.length === 0) this.host.finish({});
    else this.onConnection();
  }

  viewFor(id: string): PhoneView {
    return {
      v: 'fork',
      phase: this.phase,
      round: this.round,
      rounds: this.rounds,
      startAt: this.startAt,
      steps: this.steps,
      stab: this.stabs.get(id) ?? null,
      place: this.places[id] ?? null,
      pts: this.roundPts[id] ?? 0,
      total: this.scores[id] ?? 0,
    };
  }

  render() {
    const players = this.ids.map((id) => this.host.player(id)).filter((p) => !!p);
    const revealed = this.phase === 'result';
    const rows = players
      .map((p) => ({ p, ms: this.stabs.get(p.id) ?? null }))
      .sort((a, b) => rank(a.ms) - rank(b.ms));
    return (
      <div class="screen fork" key={`fork-${this.round}`}>
        <div class="quiz-top">
          <div class="pill">
            Round {this.round} / {this.rounds}
          </div>
          <div class="fork-rule">
            Stab the <b>pierogi</b> – not the sock, the slipper or the duck!
          </div>
        </div>
        {!revealed ? (
          <div class="fork-stage">
            <Plate size={420}>
              <div class="fork-cloche">
                <div class="fork-eyes">👀</div>
                <div>
                  Eyes on
                  <br />
                  your phone!
                </div>
              </div>
            </Plate>
          </div>
        ) : (
          <div class="fork-reveal">
            <div class="fork-steps">
              {this.steps.map((s, i) => (
                <>
                  {i > 0 && <span class="fork-arrow">→</span>}
                  <div class={`fork-step ${s.k === 'pierogi' ? 'real' : 'fake'}`}>
                    <ForkThing k={s.k} size={110} />
                    <span>{FORK_ITEM_NAMES[s.k]}</span>
                  </div>
                </>
              ))}
            </div>
            <div class="fork-board">
              {rows.map(({ p, ms }) => {
                const pts = this.roundPts[p.id] ?? 0;
                return (
                  <div class={`fork-row ${ms !== null && ms >= 0 ? 'good' : ms === null ? 'none' : 'foul'}`}>
                    <span class="fork-place">{this.places[p.id] ?? '–'}</span>
                    <Pierogi color={colorHex(p.color)} size={56} mood={ms !== null && ms >= 0 ? (this.places[p.id] === 1 ? 'wow' : 'happy') : 'dead'} />
                    <span class="fork-name">{p.name}</span>
                    <span class="fork-time">{stabLabel(ms)}</span>
                    <b class={`fork-pts ${pts > 0 ? 'gain' : pts < 0 ? 'loss' : ''}`}>{pts > 0 ? `+${pts}` : pts < 0 ? pts : '0'}</b>
                    <span class="fork-total">{this.scores[p.id] ?? 0}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {!revealed && (
          <div class="answer-strip">
            {players.map((p) => {
              const done = this.stabs.has(p.id);
              return (
                <div class={`answer-chip ${done ? 'done' : ''} ${p.connected ? '' : 'offline'}`}>
                  <Pierogi color={colorHex(p.color)} size={60} mood={!p.connected ? 'sleep' : done ? 'happy' : 'wow'} />
                  <span>{p.name}</span>
                  <b>{done ? 'Stabbed!' : `${this.scores[p.id] ?? 0} pts`}</b>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  }
}

/** Sort order on the board: fastest stabs, then no stab, then fouls. */
function rank(ms: number | null) {
  if (ms === null) return 1e6;
  if (ms < 0) return 2e6 - ms;
  return ms;
}
