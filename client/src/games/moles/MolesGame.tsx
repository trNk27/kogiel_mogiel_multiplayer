import { useEffect, useRef, useState } from 'preact/hooks';
import { colorHex, type PadButton, type PhoneMsg, type PhoneView } from '../../../../shared/protocol';
import type { Game, GameHost } from '../types';
import { ARENA_SCALE } from '../arena/kit';
import { ArenaInput } from '../arena/input';
import { BigCountdown } from '../../host/components';
import { Pierogi } from '../../lib/art';
import { sound } from '../../lib/sound';
import { DT, MolesSim, ROUNDS, ROUNDS_SHORT, WHACK_CD, type Kind, type MolesEvent, type MolesInput } from './logic';
import { MolesScene } from './scene';
import '../cookbook/cookbook.css';
import './moles.css';

const COUNTDOWN_MS = 3500;
/** How long the round-over banner (and the wait before the next round) lasts. */
const OVER_MS = 6500;
const BANNER_DELAY_MS = 900;
const HUD_MS = 150;
const PHONE_MS = 300;
const POP_MS = 1100;

type Phase = 'ready' | 'play' | 'over';

interface Popup {
  x: number;
  z: number;
  text: string;
  kind: Kind | 'bonk';
  color: string;
  until: number;
  key: number;
}

export class MolesGame implements Game {
  readonly id = 'moles' as const;
  readonly rounds: number;
  round = 0;
  phase: Phase = 'ready';
  sim: MolesSim;
  readonly input: ArenaInput;
  /** Points over the rounds already finished. */
  scores: number[];
  /** Points in the round just finished (while phase is 'over'). */
  roundPts: number[];
  winners: number[] = [];
  goAt = 0;
  overAt = 0;
  popups: Popup[] = [];
  readonly removed = new Set<number>();
  /** Host clock ms until which each player's spoon is cooling down. */
  private readyAt: number[];
  private readonly layout = Math.floor(Math.random() * 1e9);
  private scene: MolesScene | null = null;
  private glError = false;
  private raf = 0;
  private acc = 0;
  private lastFrame = 0;
  private lastHud = 0;
  private lastPhone = 0;
  private tickedSec = -1;
  private popKey = 0;
  private lastPop = 0;
  private timers: number[] = [];

  constructor(
    private host: GameHost,
    public ids: string[],
  ) {
    this.rounds = host.short ? ROUNDS_SHORT : ROUNDS;
    this.input = new ArenaInput(ids);
    this.scores = ids.map(() => 0);
    this.roundPts = ids.map(() => 0);
    this.readyAt = ids.map(() => 0);
    this.sim = this.newSim();
  }

  private newSim() {
    const sim = new MolesSim(this.ids.length, { layout: this.layout });
    this.removed.forEach((i) => sim.remove(i));
    return sim;
  }

  start() {
    if (new URLSearchParams(location.search).has('debug')) (window as unknown as Record<string, MolesGame>).moles = this;
    this.newRound();
    this.lastFrame = performance.now();
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
      this.scene = new MolesScene(
        canvas,
        this.ids.map((id) => {
          const p = this.host.player(id);
          return { name: p?.name ?? '?', color: colorHex(p?.color ?? 'sourcream') };
        }),
        this.sim,
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
    if (this.round > 1) this.sim = this.newSim();
    this.scene?.reset(this.sim);
    this.roundPts = this.ids.map(() => 0);
    this.readyAt = this.ids.map(() => 0);
    this.winners = [];
    this.popups = [];
    this.phase = 'ready';
    this.acc = 0;
    this.tickedSec = -1;
    this.goAt = Date.now() + COUNTDOWN_MS;
    [COUNTDOWN_MS - 3000, COUNTDOWN_MS - 2000, COUNTDOWN_MS - 1000].forEach((ms) => this.later(ms, () => this.phase === 'ready' && sound.count()));
    this.later(COUNTDOWN_MS, () => {
      if (this.phase !== 'ready') return;
      this.phase = 'play';
      this.sim.begin();
      sound.go();
      this.update();
    });
    this.update();
  }

  private endRound() {
    if (this.phase === 'over') return;
    const r = this.sim.results();
    this.phase = 'over';
    this.roundPts = r.points.map((p, i) => (this.removed.has(i) ? 0 : p));
    this.winners = r.winners;
    this.roundPts.forEach((p, i) => (this.scores[i] += p));
    this.overAt = performance.now();
    this.input.release();
    sound.whistle();
    this.later(BANNER_DELAY_MS, () => this.phase === 'over' && sound.fanfare());
    for (const w of this.winners) this.host.buzz(this.ids[w], [120, 60, 120, 60, 240]);
    this.later(OVER_MS, () => (this.round < this.rounds ? this.newRound() : this.finish()));
    this.update();
  }

  private finish() {
    const out: Record<string, number> = {};
    this.ids.forEach((id, i) => !this.removed.has(i) && (out[id] = this.scores[i]));
    this.host.finish(out);
  }

  private update() {
    this.host.refresh();
    this.host.changed();
  }

  // ---- loop --------------------------------------------------------------------------------------

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const elapsed = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    if (this.phase !== 'over') {
      const press = this.ids.map((_, i) => this.input.takePresses(i, 0) > 0);
      this.acc += elapsed;
      let first = true;
      while (this.acc >= DT && (this.phase as Phase) !== 'over') {
        this.acc -= DT;
        this.stepOnce(first ? press : null);
        first = false;
      }
    } else this.ids.forEach((_, i) => this.input.takePresses(i, 0));
    this.scene?.render(this.sim, elapsed);
    if (now - this.lastHud > HUD_MS) {
      this.lastHud = now;
      this.popups = this.popups.filter((p) => p.until > now);
      this.host.changed();
    }
    if (this.phase === 'play' && now - this.lastPhone > PHONE_MS) {
      this.lastPhone = now;
      this.host.refresh();
    }
  };

  private stepOnce(press: boolean[] | null) {
    const inputs: MolesInput[] = this.ids.map((id, i) => {
      const pad = this.input.pads[i];
      const live = !this.removed.has(i) && !!this.host.player(id)?.connected;
      return live ? { x: pad.x, z: pad.y, whack: !!press?.[i] && this.phase === 'play' } : { x: 0, z: 0 };
    });
    const ev = this.sim.step(inputs);
    if (ev.length) {
      this.scene?.events(ev, this.sim);
      this.react(ev);
    }
    if (this.phase === 'play') {
      const sec = Math.ceil(this.sim.left);
      if (sec !== this.tickedSec) {
        if (sec <= 5 && sec > 0) sound.tick();
        this.tickedSec = sec;
      }
    }
  }

  private popup(x: number, z: number, text: string, kind: Popup['kind'], color: string) {
    const now = performance.now();
    this.popups.push({ x, z, text, kind, color, until: now + POP_MS, key: ++this.popKey });
  }

  /** Sounds, buzzes, popups and phone updates for what just happened. */
  private react(ev: MolesEvent[]) {
    const now = performance.now();
    for (const e of ev) {
      switch (e.t) {
        case 'pop':
          if (now - this.lastPop > 90) {
            this.lastPop = now;
            sound.note(e.c.kind === 'gold' ? 880 : e.c.kind === 'hedgehog' ? 240 : 360, 0.09, { type: 'sine', vol: 0.07, slide: e.c.kind === 'gold' ? 1500 : 620 });
          }
          if (e.c.kind === 'gold') sound.note(1760, 0.18, { type: 'triangle', vol: 0.05, delay: 0.06 });
          break;
        case 'swing':
          this.readyAt[e.p] = Date.now() + WHACK_CD * 1000;
          this.host.refresh(this.ids[e.p]);
          break;
        case 'miss':
          sound.note(200, 0.12, { type: 'sine', vol: 0.08, slide: 90 });
          break;
        case 'hit': {
          const color = colorHex(this.host.player(this.ids[e.p])?.color ?? 'sourcream');
          if (e.kind === 'hedgehog') {
            sound.note(1400, 0.08, { type: 'square', vol: 0.06 });
            sound.wrong();
            this.popup(e.x, e.z, e.pts < 0 ? `Ouch! −${-e.pts}` : 'Ouch!', 'hedgehog', color);
            this.host.buzz(this.ids[e.p], [200, 60, 200]);
          } else {
            sound.hiss(0.12, 0.35);
            sound.note(e.kind === 'gold' ? 660 : 520, 0.1, { type: 'square', vol: 0.08, slide: 160 });
            if (e.kind === 'gold') sound.pickup();
            this.popup(e.x, e.z, `+${e.pts}${e.kind === 'gold' ? ' ★' : ''}`, e.kind, color);
            this.host.buzz(this.ids[e.p], e.kind === 'gold' ? [60, 40, 60, 40, 120] : [50]);
          }
          this.host.refresh(this.ids[e.p]);
          break;
        }
        case 'bonk': {
          const p = this.sim.players[e.p];
          sound.note(300, 0.15, { type: 'triangle', vol: 0.14, slide: 120 });
          sound.hiss(0.1, 0.3);
          this.popup(p.x, p.z, 'Bonk!', 'bonk', colorHex(this.host.player(this.ids[e.by])?.color ?? 'sourcream'));
          this.host.buzz(this.ids[e.p], [140, 40, 100]);
          this.host.refresh(this.ids[e.p]);
          break;
        }
        case 'over':
          this.endRound();
          break;
        default:
          break;
      }
    }
  }

  /** For tests in the browser (/?debug): run the round forward without waiting. */
  debugAdvance(seconds: number) {
    for (let k = 0; k < Math.round(seconds / DT) && this.phase === 'play'; k++) this.stepOnce(null);
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

  /** A player's points so far, this round included. */
  total(i: number) {
    return (this.scores[i] ?? 0) + (this.phase === 'over' ? 0 : (this.sim.points[i] ?? 0));
  }

  viewFor(id: string): PhoneView {
    const i = this.ids.indexOf(id);
    const p = this.sim.players[i];
    const ready = this.readyAt[i] ?? 0;
    const whack: PadButton = { label: 'Whack!', color: '#ffd23f', cool: WHACK_CD * 1000, ...(ready > Date.now() ? { readyAt: ready } : {}) };
    const base = { v: 'pad' as const, game: 'moles' as const, round: this.round, rounds: this.rounds, score: this.total(i) };
    const pts = this.phase === 'over' ? (this.roundPts[i] ?? 0) : (this.sim.points[i] ?? 0);
    const stats = [
      { k: 'Points', v: String(pts) },
      { k: 'Moles', v: String((p?.moles ?? 0) + (p?.golds ?? 0)) },
    ];
    if (this.phase === 'ready') return { ...base, phase: 'ready', title: 'Get ready!', text: 'Walk to a molehill and whack the mole', buttons: [{ ...whack, off: true }], stats };
    if (this.phase === 'over') {
      const won = this.winners.includes(i);
      return {
        ...base,
        phase: 'over',
        title: this.sim.solo ? `${pts} point${pts === 1 ? '' : 's'}!` : won ? (this.winners.length > 1 ? 'A tie for first!' : 'You win the round!') : 'Round over',
        text: `+${pts} this round · ${this.scores[i] ?? 0} in all`,
        accent: won ? '#ffc93c' : undefined,
        buttons: [],
        stats,
      };
    }
    if (!p || !p.alive) return { ...base, phase: 'out', title: 'Out', text: 'Watch the TV', buttons: [], stats };
    if (p.stun > 0) return { ...base, phase: 'play', title: 'Bonk!', text: 'Seeing stars…', accent: '#ff7a8a', buttons: [{ ...whack, off: true }], stats };
    if (p.ouch > 0) return { ...base, phase: 'play', title: 'Ouch! Prickly!', text: 'That was a hedgehog', accent: '#ff7a8a', buttons: [{ ...whack, off: true }], stats };
    return { ...base, phase: 'play', title: 'Whack the moles!', text: 'Not the hedgehogs!', buttons: [whack], stats };
  }

  // ---- TV ------------------------------------------------------------------------------------------

  render() {
    return <MolesView game={this} />;
  }

  hud() {
    const now = performance.now();
    const sim = this.sim;
    const players = this.ids.map((id) => this.host.player(id));
    const left = Math.ceil(sim.left);
    const order = this.ids
      .map((_, i) => i)
      .filter((i) => players[i] && !this.removed.has(i))
      .sort((a, b) => this.total(b) - this.total(a) || a - b);
    const lead = this.phase === 'play' && order.length > 1 && this.total(order[0]) > this.total(order[1]) ? order[0] : -1;
    const low = this.phase === 'play' && left <= 10;
    return (
      <>
        <div class="moles-top">
          <span class="pill">
            Round {this.round} / {this.rounds}
          </span>
          <div class={`moles-timer ${low ? 'low' : ''}`} key={low ? left : 'x'}>
            {this.phase === 'ready' ? Math.round(sim.length) : left}
            <small>s</small>
          </div>
          <span class="moles-rule">
            Mole <b>+1</b> · golden <b class="gold">+3</b> · hedgehog <b class="hog">−2</b>
          </span>
        </div>
        {this.popups.map((s) => {
          if (s.until < now) return null;
          const at = this.scene?.toStage(s.x, 1.9, s.z);
          if (!at) return null;
          return (
            <div class={`moles-pop ${s.kind}`} key={s.key} style={{ left: at.x, top: at.y, '--pc': s.color }}>
              {s.text}
            </div>
          );
        })}
        <div class="cookbook-chips moles-chips">
          {order.map((i) => {
            const p = players[i]!;
            const a = sim.players[i];
            const dizzy = (a?.stun ?? 0) > 0 || (a?.ouch ?? 0) > 0;
            return (
              <div class={`cookbook-chip ${lead === i ? 'lead' : ''}`} style={{ '--pc': colorHex(p.color) }} key={this.ids[i]}>
                <Pierogi color={colorHex(p.color)} size={46} mood={!p.connected ? 'sleep' : dizzy ? 'dead' : lead === i ? 'wow' : 'happy'} />
                <span class="cookbook-chip-text">
                  <b>{p.name}</b>
                  <small>{this.rounds > 1 ? `${this.phase === 'over' ? this.roundPts[i] : (sim.points[i] ?? 0)} this round` : `${(a?.moles ?? 0) + (a?.golds ?? 0)} moles`}</small>
                </span>
                <b class="moles-chip-n">{this.total(i)}</b>
              </div>
            );
          })}
        </div>
        {this.phase === 'ready' && (
          <>
            <div class="moles-intro">
              <div class="moles-intro-small">
                Round {this.round} of {this.rounds}
              </div>
              <div class="moles-intro-big">Whack the moles!</div>
            </div>
            <BigCountdown key={this.goAt} endsAt={this.goAt} go="Whack!" />
          </>
        )}
        {this.phase === 'over' && now - this.overAt > BANNER_DELAY_MS && this.banner(players)}
        {this.glError && <div class="trails-banner">This screen can’t show 3D graphics (WebGL is off).</div>}
      </>
    );
  }

  private banner(players: ReturnType<GameHost['player']>[]) {
    const sim = this.sim;
    const name = (i: number) => players[i]?.name ?? '?';
    const order = this.ids
      .map((_, i) => i)
      .filter((i) => !this.removed.has(i) && players[i])
      .sort((a, b) => this.roundPts[b] - this.roundPts[a] || this.scores[b] - this.scores[a] || a - b);
    const last = this.round >= this.rounds;
    let big: string;
    if (sim.solo) big = `${this.roundPts[order[0]] ?? 0} point${this.roundPts[order[0]] === 1 ? '' : 's'}!`;
    else if (this.winners.length === 1) big = `${name(this.winners[0])} wins the round!`;
    else if (this.winners.length > 1) big = `A tie: ${this.winners.map(name).join(' & ')}`;
    else big = 'The moles win this one!';
    return (
      <div class="trails-banner cookbook-banner pop-in">
        <div class="trails-banner-small">
          Round {this.round} of {this.rounds} · time’s up!
        </div>
        <div class="trails-banner-big cookbook-banner-big">{big}</div>
        <div class="cookbook-banner-list">
          {order.map((i) => {
            const p = players[i]!;
            const a = sim.players[i];
            const win = this.winners.includes(i);
            return (
              <div class={`cookbook-banner-row ${win ? 'win' : ''}`} style={{ '--pc': colorHex(p.color) }} key={this.ids[i]}>
                <Pierogi color={colorHex(p.color)} size={38} mood={win ? 'wow' : 'happy'} />
                <span class="grow">{p.name}</span>
                <span class="moles-banner-tally">
                  {[`${a?.moles ?? 0} mole${a?.moles === 1 ? '' : 's'}`, a?.golds ? `${a.golds} ★` : '', a?.hedgehogs ? `${a.hedgehogs} ouch` : ''].filter(Boolean).join(' · ')}
                </span>
                <b>+{this.roundPts[i]}</b>
                {this.rounds > 1 && <span class="moles-banner-total">{this.scores[i]}</span>}
              </div>
            );
          })}
        </div>
        <div class="trails-banner-small cookbook-next">{last ? 'That was the last round!' : 'The moles are digging new tunnels…'}</div>
      </div>
    );
  }
}

function MolesView({ game }: { game: MolesGame }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [, force] = useState(0);
  useEffect(() => {
    game.attach(canvas.current!);
    force(1);
    return () => game.detach();
  }, [game]);
  return (
    <div class="rally cookbook moles">
      <canvas ref={canvas} class="rally-canvas" width={Math.round(1920 * ARENA_SCALE)} height={Math.round(1080 * ARENA_SCALE)} />
      {game.hud()}
    </div>
  );
}
