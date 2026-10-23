import { useEffect, useRef, useState } from 'preact/hooks';
import { colorHex, type PhoneMsg, type PhoneView } from '../../../../shared/protocol';
import type { Game, GameHost } from '../types';
import { ARENA_SCALE } from '../arena/kit';
import { ArenaInput } from '../arena/input';
import { BigCountdown } from '../../host/components';
import { Pierogi } from '../../lib/art';
import { sound } from '../../lib/sound';
import { CowsSim, DT, FINISH_BONUS, MISS_CD, ROUNDS, ROUNDS_SHORT, placeText, type CowsEvent, type CowsInput } from './logic';
import { CowsScene } from './scene';
import '../tiles/tiles.css';
import './cows.css';

const READY_MS = 3500;
const TALLY_MS = 8500;
/** After someone pens their last cow, the confetti flies for this long before the tally. */
const FINISH_MS = 1600;
const HUD_MS = 200;

type Phase = 'ready' | 'play' | 'tally';

export class CowsGame implements Game {
  readonly id = 'cows' as const;
  readonly rounds: number;
  round = 0;
  phase: Phase = 'ready';
  sim: CowsSim;
  /** Points over finished rounds. */
  totals: number[];
  /** Points per player in the round just played (while phase is 'tally'). */
  roundPts: number[];
  goAt = 0;
  toast: { text: string; color: string; until: number } = { text: '', color: '', until: 0 };
  readonly removed = new Set<number>();
  private input: ArenaInput;
  private scene: CowsScene | null = null;
  private glError = false;
  private raf = 0;
  private timer: number | undefined;
  private acc = 0;
  private last = 0;
  private lastHud = 0;
  private lastMoo = 0;
  private missReady: number[];
  private tickedSec = -1;
  private ending = false;

  constructor(
    private host: GameHost,
    public ids: string[],
  ) {
    this.rounds = host.short ? ROUNDS_SHORT : ROUNDS;
    this.input = new ArenaInput(ids);
    this.totals = ids.map(() => 0);
    this.roundPts = ids.map(() => 0);
    this.missReady = ids.map(() => 0);
    this.sim = new CowsSim(ids.length, { short: host.short });
  }

  start() {
    if (new URLSearchParams(location.search).has('debug')) (window as unknown as Record<string, CowsGame>).cows = this;
    this.newRound();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    clearTimeout(this.timer);
    this.detach();
  }

  /** Called by the view once its canvas exists. */
  attach(canvas: HTMLCanvasElement) {
    try {
      this.scene = new CowsScene(
        canvas,
        this.ids.map((id) => {
          const p = this.host.player(id);
          return { name: p?.name ?? '?', color: colorHex(p?.color ?? 'sourcream') };
        }),
        this.sim,
      );
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

  // ---- flow -------------------------------------------------------------------

  private newRound() {
    this.round++;
    if (this.round > 1) this.sim = new CowsSim(this.ids.length, { short: this.host.short });
    this.removed.forEach((i) => this.sim.remove(i));
    this.input.release();
    this.scene?.reset(this.sim);
    this.missReady = this.ids.map(() => 0);
    this.phase = 'ready';
    this.ending = false;
    this.acc = 0;
    this.tickedSec = -1;
    this.goAt = Date.now() + READY_MS;
    [READY_MS - 3000, READY_MS - 2000, READY_MS - 1000].forEach((ms) => window.setTimeout(() => this.phase === 'ready' && sound.count(), ms));
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.phase = 'play';
      this.acc = 0;
      sound.go();
      sound.moo();
      this.update();
    }, READY_MS);
    this.update();
  }

  private endRound() {
    if (this.phase !== 'play') return;
    this.phase = 'tally';
    this.roundPts = this.sim.scores();
    this.roundPts.forEach((c, i) => (this.totals[i] += this.removed.has(i) ? 0 : c));
    sound.fanfare();
    const best = this.sim.ranking()[0];
    if (best !== undefined) this.host.buzz(this.ids[best], [120, 60, 120, 60, 240]);
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => (this.round < this.rounds ? this.newRound() : this.finish()), TALLY_MS);
    this.update();
  }

  private finish() {
    const out: Record<string, number> = {};
    this.ids.forEach((id, i) => !this.removed.has(i) && (out[id] = this.totals[i]));
    this.host.finish(out);
  }

  private update() {
    this.host.refresh();
    this.host.changed();
  }

  // ---- loop -------------------------------------------------------------------

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const elapsed = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (this.phase === 'play' && !this.ending) {
      const press = this.ids.map((_, i) => this.input.takePresses(i, 0) > 0);
      this.acc += elapsed;
      let first = true;
      while (this.acc >= DT && this.phase === 'play' && !this.ending) {
        this.acc -= DT;
        this.stepOnce(first ? press : null);
        first = false;
      }
    } else this.ids.forEach((_, i) => this.input.takePresses(i, 0));
    this.scene?.render(this.sim, elapsed);
    if (now - this.lastHud > HUD_MS) {
      this.lastHud = now;
      this.host.changed();
    }
  };

  private stepOnce(press: boolean[] | null) {
    const inputs: CowsInput[] = this.ids.map((_, i) => {
      const pad = this.input.pads[i];
      return { x: pad.x, z: pad.y, lasso: press ? press[i] : false };
    });
    const ev = this.sim.step(inputs);
    if (ev.length) {
      this.scene?.events(ev, this.sim);
      this.react(ev);
    }
    const sec = Math.ceil(this.sim.left);
    if (sec !== this.tickedSec) {
      if (sec <= 5 && sec > 0) sound.tick();
      this.tickedSec = sec;
    }
    if (this.sim.done && !this.ending) {
      this.ending = true;
      if (this.sim.winner < 0) this.endRound();
      else {
        clearTimeout(this.timer);
        this.timer = window.setTimeout(() => this.endRound(), FINISH_MS);
        this.update();
      }
    }
  }

  /** Sounds, buzzes and phone updates for what just happened. */
  private react(ev: CowsEvent[]) {
    for (const e of ev) {
      switch (e.t) {
        case 'throw':
          sound.whoosh();
          this.host.buzz(this.ids[e.p], [20]);
          break;
        case 'catch':
          sound.pickup();
          this.host.buzz(this.ids[e.p], [40, 30, 60]);
          this.host.refresh(this.ids[e.p]);
          break;
        case 'miss':
          sound.plop();
          this.missReady[e.p] = Date.now() + MISS_CD * 1000;
          this.host.refresh(this.ids[e.p]);
          break;
        case 'release':
          sound.lockIn();
          this.host.refresh(this.ids[e.p]);
          break;
        case 'pen':
          sound.serve();
          this.host.buzz(this.ids[e.p], [60, 40, 120]);
          this.host.refresh(this.ids[e.p]);
          if (e.count === this.sim.cowsEach - 1) this.say(`${this.name(e.p)} has one cow to go!`, e.p);
          break;
        case 'done':
          sound.correct();
          this.say(`${this.name(e.p)}’s herd is home!`, e.p);
          break;
        case 'moo': {
          const now = performance.now();
          if (now - this.lastMoo > 1500) {
            this.lastMoo = now;
            sound.moo();
          }
          break;
        }
      }
    }
  }

  private name(i: number) {
    return this.host.player(this.ids[i])?.name ?? '?';
  }

  private say(text: string, p: number) {
    this.toast = { text, color: colorHex(this.host.player(this.ids[p])?.color ?? 'sourcream'), until: performance.now() + 2600 };
  }

  /** For tests in the browser (/?debug): run the round forward without waiting. */
  debugAdvance(seconds: number) {
    if (this.phase !== 'play') return;
    const steps = Math.round(seconds / DT);
    const inputs = this.ids.map((_, i) => ({ x: this.input.pads[i].x, z: this.input.pads[i].y }));
    for (let k = 0; k < steps && !this.sim.done; k++) {
      const ev = this.sim.step(inputs);
      if (ev.length) this.scene?.events(ev, this.sim);
    }
  }

  // ---- phones -----------------------------------------------------------------

  onMessage(id: string, m: PhoneMsg) {
    this.input.handle(id, m);
  }

  onConnection(id: string, connected: boolean) {
    const i = this.ids.indexOf(id);
    if (i >= 0 && !connected) this.input.release(i);
    this.host.changed();
  }

  onRemoved(id: string) {
    const i = this.ids.indexOf(id);
    if (i < 0 || this.removed.has(i)) return;
    this.removed.add(i);
    this.input.release(i);
    this.sim.remove(i);
    if (this.removed.size >= this.ids.length) {
      clearTimeout(this.timer);
      this.host.finish({});
      return;
    }
    this.update();
  }

  viewFor(id: string): PhoneView {
    const i = this.ids.indexOf(id);
    const p = this.sim.players[i];
    const accent = colorHex(this.host.player(id)?.color ?? 'sourcream');
    const holding = (p?.hold ?? -1) >= 0;
    const base = {
      v: 'pad' as const,
      game: 'cows' as const,
      round: this.round,
      rounds: this.rounds,
      accent,
      score: this.totals[i] ?? 0,
    };
    const ready = this.missReady[i] ?? 0;
    const lasso = holding
      ? { label: 'Let go', color: '#ffd23f' }
      : { label: 'Lasso', ...(ready > Date.now() ? { readyAt: ready } : {}), cool: MISS_CD * 1000 };
    const stats = [{ k: 'Penned', v: `${p?.penned ?? 0}/${this.sim.cowsEach}` }];
    if (this.phase === 'ready') return { ...base, phase: 'ready', title: 'Get ready!', text: 'Lasso the cows in your colour', buttons: [{ ...lasso, off: true }], stats };
    if (this.phase === 'tally') {
      const place = this.sim.ranking().indexOf(i) + 1;
      const pts = this.roundPts[i] ?? 0;
      return {
        ...base,
        phase: 'over',
        title: `${placeText(place)} · ${pts} point${pts === 1 ? '' : 's'}`,
        text: this.round < this.rounds ? 'Next round coming up' : 'That’s the lot!',
        buttons: [{ ...lasso, off: true }],
        stats,
      };
    }
    if (this.ending) return { ...base, phase: 'over', title: this.sim.winner === i ? 'All home!' : 'Time’s up!', buttons: [{ ...lasso, off: true }], stats };
    return { ...base, phase: 'play', text: holding ? 'Drag it into your pen!' : 'Face a cow in your colour · Lasso', buttons: [lasso], stats };
  }

  // ---- TV -----------------------------------------------------------------------

  render() {
    return <CowsView game={this} />;
  }

  get contenders() {
    return this.ids.map((id, idx) => ({ id, idx, p: this.host.player(id) })).filter((c) => c.p && !this.removed.has(c.idx));
  }

  get glFailed() {
    return this.glError;
  }
}

function CowsView({ game }: { game: CowsGame }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [, force] = useState(0);
  useEffect(() => {
    game.attach(canvas.current!);
    force(1);
    return () => game.detach();
  }, [game]);
  const sim = game.sim;
  const people = game.contenders;
  const left = Math.ceil(sim.left);
  const now = performance.now();
  const best = Math.max(0, ...people.map((c) => sim.players[c.idx]?.penned ?? 0));
  return (
    <div class="tiles-root cows-root">
      <canvas ref={canvas} class="rally-canvas" width={Math.round(1920 * ARENA_SCALE)} height={Math.round(1080 * ARENA_SCALE)} />
      <div class="tiles-hud">
        <div class="tiles-top">
          <div class="pill">
            Round {game.round} / {game.rounds}
          </div>
          <div class={`tiles-timer ${game.phase === 'play' && left <= 10 ? 'low' : ''}`} key={game.phase === 'play' && left <= 10 ? left : 'x'}>
            {game.phase === 'ready' ? Math.round(sim.length) : left}
            <small>s</small>
          </div>
          <div class="tiles-rule">
            Face your cow · <b>Lasso</b> · drag it home
          </div>
        </div>
        {game.toast.until > now && (
          <div class="tiles-toast pop-in" style={{ color: game.toast.color }} key={game.toast.text + game.toast.until}>
            {game.toast.text}
          </div>
        )}
        <div class={`tiles-chips n${people.length}`}>
          {people.map((c) => {
            const pl = sim.players[c.idx];
            const n = pl?.penned ?? 0;
            return (
              <div class={`tiles-chip ${best > 0 && n === best ? 'lead' : ''} ${c.p!.connected ? '' : 'away'}`} style={{ '--pc': colorHex(c.p!.color) }} key={c.id}>
                <Pierogi color={colorHex(c.p!.color)} size={people.length > 5 ? 40 : 52} mood={!c.p!.connected ? 'sleep' : (pl?.hold ?? -1) >= 0 ? 'wow' : 'happy'} />
                <div class="tiles-chip-body">
                  <div class="tiles-chip-name">{c.p!.name}</div>
                  <div class="cows-dots">
                    {Array.from({ length: sim.cowsEach }, (_, k) => (
                      <i class={k < n ? 'on' : ''} key={k} />
                    ))}
                  </div>
                </div>
                <b class="tiles-chip-n">{n}</b>
              </div>
            );
          })}
        </div>
      </div>
      {game.phase === 'ready' && (
        <>
          <div class="tiles-intro">
            <div class="tiles-intro-small">
              Round {game.round} of {game.rounds}
            </div>
            <div class="tiles-intro-big">Round up your cows!</div>
          </div>
          <BigCountdown endsAt={game.goAt} key={game.round} />
        </>
      )}
      {game.phase === 'tally' && <Tally game={game} key={game.round} />}
      {game.glFailed && <div class="tiles-nogl">This screen can’t show 3D graphics (WebGL is off).</div>}
    </div>
  );
}

/** The end-of-round tally: bars grow from the last place to the first, then the winner is announced. */
function Tally({ game }: { game: CowsGame }) {
  const [t, setT] = useState(0);
  useEffect(() => {
    const t0 = performance.now();
    let raf = 0;
    const loop = (now: number) => {
      const s = (now - t0) / 1000;
      setT(s);
      if (s < 5) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
  const sim = game.sim;
  const people = game.contenders;
  const pts = game.roundPts;
  const order = [...people].sort((a, b) => pts[b.idx] - pts[a.idx] || a.idx - b.idx);
  const max = Math.max(1, ...order.map((c) => pts[c.idx]));
  const n = order.length;
  const last = game.round >= game.rounds;
  const overall = [...people].sort((a, b) => game.totals[b.idx] - game.totals[a.idx] || a.idx - b.idx);
  const tie = (list: typeof order, score: (i: number) => number) => (list.length ? list.filter((c) => score(c.idx) === score(list[0].idx)) : []);
  const winners = last && game.rounds > 1 ? tie(overall, (i) => game.totals[i]) : tie(order, (i) => pts[i]);
  const names = winners.map((w) => w.p!.name).join(' & ');
  const showWinner = t > 2.9 && winners.length > 0 && people.length > 1;
  return (
    <div class="tiles-tally">
      <div class="tiles-tally-card">
        <div class="tiles-tally-title">
          Round {game.round} of {game.rounds}
          <small>{sim.winner >= 0 ? `Cows penned · +${FINISH_BONUS} for the first full pen` : 'Cows penned when the time ran out'}</small>
        </div>
        <div class="tiles-tally-rows">
          {order.map((c, k) => {
            const v = pts[c.idx];
            const start = 0.25 + (n - 1 - k) * 0.22;
            const p = ease(Math.min(1, Math.max(0, (t - start) / 1.3)));
            return (
              <div class={`tiles-tally-row ${showWinner && winners.includes(c) ? 'win' : ''}`} style={{ '--pc': colorHex(c.p!.color) }} key={c.id}>
                <Pierogi color={colorHex(c.p!.color)} size={46} mood={showWinner && winners.includes(c) ? 'wow' : 'happy'} />
                <span class="tiles-tally-name">
                  {c.p!.name}
                  {sim.winner === c.idx && <span class="cows-star"> ★</span>}
                </span>
                <div class="tiles-tally-track">
                  <i style={{ width: `${(v / max) * 100 * p}%` }} />
                </div>
                <b class="tiles-tally-n">{Math.round(v * p)}</b>
                {game.rounds > 1 && <span class="tiles-tally-total">{game.totals[c.idx]}</span>}
              </div>
            );
          })}
        </div>
        {game.rounds > 1 && <div class="tiles-tally-legend muted">Bars: this round · right: total so far</div>}
        {showWinner && (
          <div class="tiles-tally-banner pop-in" style={{ color: colorHex(winners[0].p!.color) }}>
            {winners.length > 1 ? `${names} tie!` : last && game.rounds > 1 ? `${names} wins Krówki!` : `${names} wins${game.rounds > 1 ? ' the round' : ''}!`}
          </div>
        )}
      </div>
    </div>
  );
}

const ease = (x: number) => 1 - Math.pow(1 - x, 3);
