import { useEffect, useRef, useState } from 'preact/hooks';
import { colorHex, type PadButton, type PhoneMsg, type PhoneView } from '../../../../shared/protocol';
import type { Game, GameHost } from '../types';
import { ARENA_SCALE } from '../arena/kit';
import { ArenaInput } from '../arena/input';
import { BigCountdown } from '../../host/components';
import { Pierogi } from '../../lib/art';
import { sound } from '../../lib/sound';
import { ChickSim, DT, MAX_CARRY, ROUNDS, ROUNDS_SHORT, SHOVE_CD, placeText, type ChickEvent, type ChickInput } from './logic';
import { ChickScene } from './scene';
import '../cookbook/cookbook.css';
import './chickens.css';

const READY_MS = 3500;
/** How long the round-over banner (and the wait before the next round) lasts. */
const OVER_MS = 7500;
const BANNER_DELAY_MS = 1000;
const HUD_MS = 120;

type Phase = 'ready' | 'play' | 'over';

interface Pop {
  text: string;
  x: number;
  y: number;
  z: number;
  color: string;
  until: number;
  key: number;
  big?: boolean;
}

export class ChickensGame implements Game {
  readonly id = 'chickens' as const;
  readonly rounds: number;
  round = 0;
  phase: Phase = 'ready';
  sim!: ChickSim;
  /** Points from finished rounds. */
  totals: number[];
  /** Points in the round just played (while phase is 'over'). */
  roundPts: number[];
  goAt = 0;
  overAt = 0;
  rushAt = -1e9;
  pops: Pop[] = [];
  readonly removed = new Set<number>();
  private input: ArenaInput;
  private scene: ChickScene | null = null;
  private glError = false;
  private raf = 0;
  private acc = 0;
  private last = 0;
  private lastHud = 0;
  private timers: number[] = [];
  private shoveReady: number[];
  private tickedSec = -1;
  private popKey = 0;
  private lastCluck = 0;

  constructor(
    private host: GameHost,
    public ids: string[],
  ) {
    this.rounds = host.short ? ROUNDS_SHORT : ROUNDS;
    this.input = new ArenaInput(ids);
    this.totals = ids.map(() => 0);
    this.roundPts = ids.map(() => 0);
    this.shoveReady = ids.map(() => 0);
  }

  start() {
    if (new URLSearchParams(location.search).has('debug')) (window as unknown as Record<string, ChickensGame>).chickens = this;
    this.newRound();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.timers.forEach((t) => clearTimeout(t));
    this.timers = [];
    this.detach();
  }

  private later(ms: number, fn: () => void) {
    this.timers.push(window.setTimeout(fn, ms));
  }

  attach(canvas: HTMLCanvasElement) {
    try {
      this.scene = new ChickScene(
        canvas,
        this.ids.map((id) => {
          const p = this.host.player(id);
          return { name: p?.name ?? '?', color: colorHex(p?.color ?? 'sourcream') };
        }),
        this.sim.coops,
      );
      this.removed.forEach((i) => this.scene?.hide(i));
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

  // ---- round flow --------------------------------------------------------------------------------

  private newRound() {
    this.round++;
    this.input.release();
    this.sim = new ChickSim(this.ids.length, { gone: this.ids.map((_, i) => this.removed.has(i)) });
    this.scene?.reset();
    this.roundPts = this.ids.map(() => 0);
    this.shoveReady = this.ids.map(() => 0);
    this.pops = [];
    this.phase = 'ready';
    this.acc = 0;
    this.tickedSec = -1;
    this.rushAt = -1e9;
    this.goAt = Date.now() + READY_MS;
    [READY_MS - 3000, READY_MS - 2000, READY_MS - 1000].forEach((ms) => this.later(ms, () => this.phase === 'ready' && sound.count()));
    this.later(READY_MS, () => {
      if (this.phase !== 'ready') return;
      this.phase = 'play';
      this.acc = 0;
      sound.go();
      this.update();
    });
    this.update();
  }

  private endRound() {
    if (this.phase !== 'play') return;
    this.phase = 'over';
    this.roundPts = this.sim.points.slice();
    this.roundPts.forEach((c, i) => (this.totals[i] += this.removed.has(i) ? 0 : c));
    this.overAt = performance.now();
    sound.whistle();
    this.later(BANNER_DELAY_MS, () => this.phase === 'over' && sound.fanfare());
    const best = this.sim.ranking()[0];
    if (best !== undefined && this.sim.points[best] > 0) this.host.buzz(this.ids[best], [120, 60, 120, 60, 240]);
    this.later(OVER_MS, () => (this.round < this.rounds ? this.newRound() : this.finish()));
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

  // ---- loop --------------------------------------------------------------------------------------

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const elapsed = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const live = this.phase === 'play';
    const press = this.ids.map((_, i) => [this.input.takePresses(i, 0) > 0, this.input.takePresses(i, 1) > 0]);
    this.acc += elapsed;
    let first = true;
    while (this.acc >= DT) {
      this.acc -= DT;
      this.stepOnce(first && live ? press : null, live && this.phase === 'play');
      first = false;
    }
    this.scene?.render(this.sim, elapsed);
    if (now - this.lastHud > HUD_MS) {
      this.lastHud = now;
      this.pops = this.pops.filter((p) => p.until > now);
      this.host.changed();
    }
  };

  private stepOnce(press: boolean[][] | null, live: boolean) {
    const inputs: ChickInput[] = this.ids.map((id, i) => {
      const pad = this.input.pads[i];
      const on = !this.removed.has(i) && !!this.host.player(id)?.connected;
      if (!on) return { x: 0, z: 0 };
      return { x: pad.x, z: pad.y, grab: press ? press[i][0] : false, shove: press ? press[i][1] : false };
    });
    const ev = this.sim.step(inputs, live);
    if (ev.length) {
      this.scene?.events(ev, this.sim);
      this.react(ev);
    }
    if (live) {
      const sec = Math.ceil(this.sim.left);
      if (sec !== this.tickedSec) {
        if (sec <= 5 && sec > 0) sound.tick();
        this.tickedSec = sec;
      }
      if (this.sim.done) this.endRound();
    }
  }

  private pop(text: string, x: number, y: number, z: number, color: string, ms = 1500, big = false) {
    this.pops.push({ text, x, y, z, color, until: performance.now() + ms, key: ++this.popKey, big });
  }

  private cluck(vol = 0.12) {
    const now = performance.now();
    if (now - this.lastCluck < 90) return;
    this.lastCluck = now;
    const f = 700 + Math.random() * 300;
    sound.note(f, 0.06, { type: 'square', vol, slide: f * 1.4 });
    sound.note(f * 0.8, 0.08, { type: 'square', vol: vol * 0.8, delay: 0.07, slide: f * 0.6 });
  }

  /** Sounds, buzzes and phone updates for what just happened. */
  private react(ev: ChickEvent[]) {
    for (const e of ev) {
      switch (e.t) {
        case 'grab': {
          sound.pickup();
          this.cluck(0.16);
          this.host.buzz(this.ids[e.p], [30]);
          this.host.refresh(this.ids[e.p]);
          break;
        }
        case 'miss':
          if (e.full) {
            const p = this.sim.players[e.p];
            this.pop('Full!', p.x, 3.4, p.z, '#fbf0d9', 900);
          }
          break;
        case 'deliver': {
          const c = this.sim.coops[e.p];
          const color = colorHex(this.host.player(this.ids[e.p])?.color ?? 'sourcream');
          const gold = e.kinds.includes('gold');
          this.pop(`+${e.pts}`, c.x, 3.6, c.z, gold ? '#ffd23f' : color, 1600, true);
          if (gold) sound.fanfare();
          else sound.correct();
          this.later(180, () => this.cluck(0.14));
          this.host.buzz(this.ids[e.p], gold ? [60, 40, 60, 40, 160] : [60, 40, 90]);
          this.host.refresh(this.ids[e.p]);
          break;
        }
        case 'lunge':
          sound.whoosh();
          this.shoveReady[e.p] = Date.now() + SHOVE_CD * 1000;
          this.host.refresh(this.ids[e.p]);
          break;
        case 'shove': {
          sound.crash();
          const p = this.sim.players[e.p];
          if (e.dropped.length) {
            this.pop('Dropped them!', p.x, 3.2, p.z, '#ff7a8a', 1300);
            for (let k = 0; k < e.dropped.length; k++) this.later(k * 90, () => this.cluck(0.18));
          }
          this.host.buzz(this.ids[e.p], [180, 40, 120]);
          this.host.refresh(this.ids[e.p]);
          break;
        }
        case 'drop':
          this.cluck(0.16);
          break;
        case 'hop':
          if (Math.random() < 0.5) this.cluck(0.07);
          break;
        case 'rush':
          this.rushAt = performance.now();
          sound.whistle();
          break;
        default:
          break;
      }
    }
  }

  /** For tests in the browser (/?debug): run the round forward without waiting. */
  debugAdvance(seconds: number) {
    const steps = Math.round(seconds / DT);
    for (let k = 0; k < steps && this.phase === 'play'; k++) this.stepOnce(null, true);
  }

  // ---- phones ------------------------------------------------------------------------------------

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
    this.scene?.hide(i);
    if (this.removed.size >= this.ids.length) {
      this.timers.forEach((t) => clearTimeout(t));
      this.timers = [];
      this.host.finish({});
      return;
    }
    this.update();
  }

  viewFor(id: string): PhoneView {
    const i = this.ids.indexOf(id);
    const p = this.host.player(id);
    const f = this.sim?.players[i];
    const accent = colorHex(p?.color ?? 'sourcream');
    const live = this.phase === 'play' ? (this.sim?.points[i] ?? 0) : 0;
    const base = {
      v: 'pad' as const,
      game: 'chickens' as const,
      round: this.round,
      rounds: this.rounds,
      accent,
      score: (this.totals[i] ?? 0) + live,
    };
    const ready = this.shoveReady[i] ?? 0;
    const playing = this.phase === 'play';
    const buttons: PadButton[] = [
      { label: 'Grab', color: '#ffd23f', ...(playing ? {} : { off: true }) },
      { label: 'Shove', color: '#ff3d6e', ...(ready > Date.now() ? { readyAt: ready } : {}), cool: SHOVE_CD * 1000, ...(playing ? {} : { off: true }) },
    ];
    const carrying = f?.carry.length ?? 0;
    const stats = [
      { k: 'Carrying', v: `${carrying}/${MAX_CARRY}` },
      { k: 'In the coop', v: String(this.sim?.points[i] ?? 0) },
    ];
    if (this.phase === 'ready') return { ...base, phase: 'ready', title: 'Get ready!', text: 'Catch hens, bring them to your coop', buttons, stats };
    if (this.phase === 'over') {
      const place = this.sim.ranking().indexOf(i) + 1;
      const pts = this.roundPts[i] ?? 0;
      return {
        ...base,
        phase: 'over',
        title: this.sim.solo ? `${pts} in the coop!` : `${placeText(place)} · ${pts} in the coop`,
        text: this.round < this.rounds ? 'Next round coming up' : 'That’s the lot!',
        accent: place === 1 && !this.sim.solo ? '#ffc93c' : accent,
        buttons,
        stats,
      };
    }
    const text = carrying >= MAX_CARRY ? 'Head full! Run to your coop' : carrying > 0 ? 'Take them home – or grab more' : 'Grab a hen!';
    return { ...base, phase: 'play', title: f && f.stun > 0 ? 'Oof!' : undefined, text, buttons, stats };
  }

  // ---- TV ------------------------------------------------------------------------------------------

  render() {
    return <ChickensView game={this} />;
  }

  get contenders() {
    return this.ids.map((id, idx) => ({ id, idx, p: this.host.player(id) })).filter((c) => c.p && !this.removed.has(c.idx));
  }

  get glFailed() {
    return this.glError;
  }

  toStage(x: number, y: number, z: number) {
    return this.scene?.toStage(x, y, z) ?? null;
  }
}

function ChickensView({ game }: { game: ChickensGame }) {
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
  const lead = game.phase === 'play' ? sim.ranking()[0] : -1;
  const leadOk = lead !== undefined && lead >= 0 && sim.points[lead] > 0 && people.length > 1;
  const rush = now - game.rushAt < 2200;
  return (
    <div class="rally cookbook chickens">
      <canvas ref={canvas} class="rally-canvas" width={Math.round(1920 * ARENA_SCALE)} height={Math.round(1080 * ARENA_SCALE)} />
      {/* How many hens are in each coop, over the coop. */}
      {people.map((c) => {
        const coop = sim.coops[c.idx];
        const at = game.toStage(coop.x, 4.3, coop.z);
        if (!at) return null;
        return (
          <div class="chick-coop" style={{ left: at.x, top: at.y, '--pc': colorHex(c.p!.color) }} key={`coop${c.id}`}>
            {sim.points[c.idx]}
          </div>
        );
      })}
      {game.pops.map((s) => {
        const at = game.toStage(s.x, s.y, s.z);
        if (!at || s.until < now) return null;
        return (
          <div class={`chick-pop ${s.big ? 'big' : ''}`} key={s.key} style={{ left: at.x, top: at.y, '--pc': s.color }}>
            {s.text}
          </div>
        );
      })}
      <div class="chick-top">
        <div class="pill">
          Round {game.round} / {game.rounds}
        </div>
        <div class={`chick-timer ${game.phase === 'play' && left <= 10 ? 'low' : ''}`} key={game.phase === 'play' && left <= 10 ? left : 'x'}>
          {game.phase === 'ready' ? Math.round(sim.length) : left}
          <small>s</small>
        </div>
        <div class="chick-rule">
          <b>Grab</b> hens · take them <b>home</b> · golden <b>+3</b>
        </div>
      </div>
      {rush && game.phase === 'play' && (
        <div class="chick-rush" key={`r${game.rushAt}`}>
          Ostatnie 10 sekund!
          <small>The hens are running faster!</small>
        </div>
      )}
      <div class={`chick-chips n${people.length}`}>
        {people.map((c) => {
          const f = sim.players[c.idx];
          const carry = f?.carry ?? [];
          return (
            <div class={`chick-chip ${leadOk && lead === c.idx ? 'lead' : ''} ${c.p!.connected ? '' : 'away'}`} style={{ '--pc': colorHex(c.p!.color) }} key={c.id}>
              <Pierogi color={colorHex(c.p!.color)} size={people.length > 5 ? 40 : 50} mood={!c.p!.connected ? 'sleep' : (f?.stun ?? 0) > 0 ? 'dead' : carry.length ? 'wow' : 'happy'} />
              <div class="chick-chip-body">
                <div class="chick-chip-name">{c.p!.name}</div>
                <div class="chick-chip-eggs">
                  {Array.from({ length: MAX_CARRY }, (_, k) => {
                    const h = carry[k] !== undefined ? sim.hen(carry[k]) : undefined;
                    return <i class={h ? `on ${h.kind}` : ''} key={k} />;
                  })}
                  {game.rounds > 1 && game.round > 1 && <span class="chick-chip-total">{game.totals[c.idx]} total</span>}
                </div>
              </div>
              <b class="chick-chip-n">{sim.points[c.idx]}</b>
            </div>
          );
        })}
      </div>
      {game.phase === 'ready' && (
        <>
          <div class="chick-intro">
            <div class="chick-intro-small">
              Round {game.round} of {game.rounds}
            </div>
            <div class="chick-intro-big">Catch the hens!</div>
          </div>
          <BigCountdown endsAt={game.goAt} key={game.round} />
        </>
      )}
      {game.phase === 'over' && now - game.overAt > BANNER_DELAY_MS && <Banner game={game} />}
      {game.glFailed && <div class="trails-banner">This screen can’t show 3D graphics (WebGL is off).</div>}
    </div>
  );
}

function Banner({ game }: { game: ChickensGame }) {
  const people = game.contenders;
  const order = [...people].sort((a, b) => game.roundPts[b.idx] - game.roundPts[a.idx] || a.idx - b.idx);
  const solo = people.length <= 1;
  const top = order.length ? game.roundPts[order[0].idx] : 0;
  const winners = top > 0 ? order.filter((c) => game.roundPts[c.idx] === top) : [];
  const last = game.round >= game.rounds;
  let big: string;
  if (solo) big = `${top} point${top === 1 ? '' : 's'} in the coop!`;
  else if (!winners.length) big = 'The hens win this one!';
  else if (winners.length > 1) big = `A tie: ${winners.map((w) => w.p!.name).join(' & ')}`;
  else big = `${winners[0].p!.name} wins the round!`;
  return (
    <div class="trails-banner cookbook-banner chick-banner pop-in">
      <div class="trails-banner-small">
        Round {game.round} of {game.rounds} · hens in the coop
      </div>
      <div class="trails-banner-big cookbook-banner-big">{big}</div>
      <div class="cookbook-banner-list">
        {order.map((c, k) => (
          <div class={`cookbook-banner-row ${winners.includes(c) ? 'win' : ''}`} style={{ '--pc': colorHex(c.p!.color) }} key={c.id}>
            <span class="chick-banner-place">{k + 1}</span>
            <Pierogi color={colorHex(c.p!.color)} size={38} mood={winners.includes(c) ? 'wow' : 'happy'} />
            <span class="grow">{c.p!.name}</span>
            <b>+{game.roundPts[c.idx]}</b>
            {game.rounds > 1 && <span class="chick-banner-total">{game.totals[c.idx]}</span>}
          </div>
        ))}
      </div>
      <div class="trails-banner-small cookbook-next">{last ? 'That was the last round!' : 'Fresh hens are coming through the gate…'}</div>
    </div>
  );
}
