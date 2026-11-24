import { useEffect, useRef, useState } from 'preact/hooks';
import { colorHex, type PadButton, type PhoneMsg, type PhoneView } from '../../../../shared/protocol';
import type { Game, GameHost } from '../types';
import { ArenaInput } from '../arena/input';
import { PIXEL_W, PIXEL_H, resources } from '../../lib/assets';
import { BigCountdown } from '../../host/components';
import { Pierogi } from '../../lib/art';
import { sound } from '../../lib/sound';
import {
  DT,
  FLOORS,
  ROUND_S,
  TOWER_ROUNDS,
  TOWER_ROUNDS_SHORT,
  TOWER_THEMES,
  TowerSim,
  comboLabel,
  type TowerEvent,
} from './logic';
import { TOWER_PACK_ID } from './sprites';
import { TowerScene } from './scene';
import '../cookbook/cookbook.css';
import './tower.css';

const COUNTDOWN_MS = 3500;
const OVER_MS = 6000;
const BANNER_DELAY_MS = 1000;
const HUD_MS = 120;

type Phase = 'ready' | 'play' | 'over';

export class TowerGame implements Game {
  readonly id = 'tower' as const;
  readonly rounds: number;
  round = 0;
  phase: Phase = 'ready';
  sim!: TowerSim;
  readonly input: ArenaInput;
  scores: number[];
  roundPts: number[];
  winners: number[] = [];
  goAt = 0;
  overAt = 0;
  readonly removed = new Set<number>();
  private scene: TowerScene | null = null;
  private raf = 0;
  private acc = 0;
  private lastFrame = 0;
  private lastHud = 0;
  private timers: number[] = [];

  constructor(
    private host: GameHost,
    public ids: string[],
  ) {
    this.rounds = host.short ? TOWER_ROUNDS_SHORT : TOWER_ROUNDS;
    this.input = new ArenaInput(ids);
    this.scores = ids.map(() => 0);
    this.roundPts = ids.map(() => 0);
    void resources.preload(['pixel-common', TOWER_PACK_ID]);
  }

  start() {
    if (new URLSearchParams(location.search).has('debug')) (window as unknown as Record<string, TowerGame>).tower = this;
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
    this.scene = new TowerScene(
      canvas,
      this.ids.map((id) => {
        const p = this.host.player(id);
        return { name: p?.name ?? '?', color: colorHex(p?.color ?? 'sourcream'), colorId: p?.color ?? 'sourcream' };
      }),
    );
    this.scene.reset(this.sim);
    this.removed.forEach((i) => this.scene?.hide(i));
  }

  detach() {
    this.scene?.dispose();
    this.scene = null;
  }

  private themeForRound(): number {
    // Short tournament version plays the Aurora Ice round (index 1).
    if (this.host.short) return 1;
    return (this.round - 1) % TOWER_THEMES.length;
  }

  private newRound() {
    this.round++;
    this.input.release();
    this.sim = new TowerSim(
      this.ids.length,
      this.themeForRound(),
      Math.random,
      this.ids.map((_, i) => this.removed.has(i)),
    );
    this.scene?.reset(this.sim);
    this.removed.forEach((i) => this.scene?.hide(i));
    this.roundPts = this.ids.map(() => 0);
    this.winners = [];
    this.phase = 'ready';
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
    this.roundPts = r.points;
    this.winners = r.winners;
    r.points.forEach((p, i) => (this.scores[i] += p));
    this.overAt = performance.now();
    if (this.sim.time >= ROUND_S && this.sim.finishCount === 0) sound.whistle();
    this.later(BANNER_DELAY_MS, () => this.phase === 'over' && sound.fanfare());
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

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const elapsed = Math.min(0.25, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    this.acc += elapsed;
    while (this.acc >= DT) {
      this.acc -= DT;
      this.tick();
    }
    this.scene?.render(this.sim, elapsed);
    if (now - this.lastHud > HUD_MS) {
      this.lastHud = now;
      this.host.changed();
    }
  };

  private tick() {
    const sim = this.sim;
    this.ids.forEach((id, i) => {
      const live = !this.removed.has(i) && !!this.host.player(id)?.connected && this.phase === 'play';
      const pad = this.input.pads[i];
      sim.setInput(i, live ? pad.x : 0);
      const n = this.input.takePresses(i, 0);
      if (live && n > 0) sim.pressJump(i);
    });
    const events = sim.step();
    if (events.length) this.handle(events);
  }

  private handle(events: TowerEvent[]) {
    let refresh = false;
    for (const e of events) {
      this.scene?.onEvent(e, this.sim);
      switch (e.t) {
        case 'jump':
          sound.note(440, 0.1, { type: 'square', vol: 0.05, slide: 680 });
          break;
        case 'superJump':
          sound.note(520, 0.14, { type: 'square', vol: 0.06, slide: 1020 });
          break;
        case 'wallBounce':
          sound.note(720, 0.09, { type: 'triangle', vol: 0.07, slide: 1120 });
          this.host.buzz(this.ids[e.i], [35]);
          break;
        case 'spring':
          sound.note(360, 0.16, { type: 'square', vol: 0.06, slide: 980 });
          this.host.buzz(this.ids[e.i], [45]);
          break;
        case 'bonk':
          sound.plop();
          break;
        case 'combo':
          sound.pickup();
          this.host.buzz(this.ids[e.i], [50, 30, 70]);
          refresh = true;
          break;
        case 'crumble':
          sound.hiss(0.12, 0.06);
          break;
        case 'crown':
          sound.serve();
          this.host.buzz(this.ids[e.i], [70, 40, 120]);
          refresh = true;
          break;
        case 'freeze':
          sound.hiss(0.25, 0.14);
          sound.note(320, 0.2, { type: 'sawtooth', vol: 0.05, slide: 120 });
          this.host.buzz(this.ids[e.i], [180]);
          refresh = true;
          break;
        case 'hurry':
          sound.note(660, 0.14, { type: 'square', vol: 0.08 });
          sound.note(880, 0.22, { type: 'square', vol: 0.08, delay: 0.14 });
          refresh = true;
          break;
        case 'over':
          this.endRound();
          refresh = false;
          break;
      }
    }
    if (refresh) this.update();
  }

  onMessage(id: string, m: PhoneMsg) {
    this.input.handle(id, m);
  }

  onConnection(id: string, connected: boolean) {
    if (!connected) this.input.release(this.ids.indexOf(id));
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
      this.host.finish({});
      return;
    }
    this.update();
  }

  viewFor(id: string): PhoneView {
    const i = this.ids.indexOf(id);
    const sim = this.sim;
    const p = sim.players[i];
    const jump: PadButton = { label: 'Jump!', color: '#79d2ff' };
    const base = { v: 'pad' as const, game: 'tower' as const, round: this.round, rounds: this.rounds, score: this.scores[i] ?? 0 };
    const floorVal = p ? `${p.bestFloor}/${FLOORS}` : `0/${FLOORS}`;
    const comboStr = p && p.comboFloors >= 2 ? `${p.comboFloors}F` : p && p.bestCombo >= 4 ? `Best ${p.bestCombo}F` : '—';
    const stats = [
      { k: 'Floor', v: floorVal },
      { k: 'Combo', v: comboStr },
    ];
    if (this.phase === 'ready') {
      return { ...base, phase: 'ready', title: 'Get ready!', text: 'Run fast & bounce off the walls!', buttons: [{ ...jump, off: true }], stats };
    }
    if (this.phase === 'over') {
      const pts = this.roundPts[i] ?? 0;
      const won = this.winners.includes(i);
      return {
        ...base,
        phase: 'over',
        noStick: true,
        title: sim.solo
          ? p?.finished
            ? `Summit in ${p.finishTime?.toFixed(1)}s!`
            : `Floor ${p?.bestFloor ?? 0}/${FLOORS}`
          : won
            ? this.winners.length > 1
              ? 'Tied for the crown!'
              : 'King of the tower!'
            : 'Round over',
        text: `+${pts} point${pts === 1 ? '' : 's'}`,
        accent: won ? '#ffd23f' : undefined,
        buttons: [],
        stats,
      };
    }
    if (!p || !p.alive) {
      return { ...base, phase: 'out', noStick: true, title: 'Frozen solid!', text: 'Watch the climb on TV', accent: '#79d2ff', buttons: [], stats };
    }
    if (p.finished) {
      return { ...base, phase: 'play', noStick: true, title: `Summit #${p.finishOrder}!`, text: 'Waiting for the others…', accent: '#ffd23f', buttons: [], stats };
    }
    return {
      ...base,
      phase: 'play',
      title: p.comboFloors >= 4 ? `${comboLabel(p.comboFloors)} (${p.comboFloors}F)` : sim.hurry ? 'Hurry! Frost rising!' : 'Climb to the crown!',
      text: p.comboFloors >= 4 ? 'Keep skipping floors!' : 'Steer & tap Jump at speed',
      accent: p.comboFloors >= 4 ? '#ffd23f' : sim.hurry ? '#ff5c8a' : '#79d2ff',
      buttons: [jump],
      stats,
    };
  }

  render() {
    return <TowerView game={this} />;
  }

  hud() {
    const now = performance.now();
    const sim = this.sim;
    const players = this.ids.map((id) => this.host.player(id));
    const theme = TOWER_THEMES[((sim.themeIndex % 3) + 3) % 3];
    const left = Math.ceil(sim.timeLeft);
    const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    const hurry = this.phase === 'play' && (sim.hurry || sim.rushEndsAt !== null || left <= 10);

    const liveIndices = this.ids.map((_, i) => i).filter((i) => !this.removed.has(i) && !!players[i]);
    const splitRight = liveIndices.length > 4;
    const leftPlayers = splitRight ? liveIndices.slice(0, 4) : liveIndices;
    const rightPlayers = splitRight ? liveIndices.slice(4) : [];

    const playerCard = (i: number) => {
      const p = players[i]!;
      const tp = sim.players[i];
      if (!tp) return null;
      const out = !tp.alive;
      const col = colorHex(p.color);
      const comboText = tp.comboFloors >= 4 ? comboLabel(tp.comboFloors) : tp.comboFloors >= 2 ? `${tp.comboFloors}F` : null;
      return (
        <div class={`tower-pcard ${out ? 'out' : ''} ${tp.finished ? 'crowned' : ''}`} style={{ '--pc': col }} key={p.id}>
          <div class="tower-pdot" />
          <Pierogi color={col} size={36} mood={out ? 'dead' : tp.finished ? 'wow' : p.connected ? 'happy' : 'sleep'} />
          <div class="tower-pinfo">
            <div class="tower-pname">{p.name}</div>
            <div class="tower-psub">
              {tp.finished ? `👑 #${tp.finishOrder} · ${tp.finishTime?.toFixed(1)}s` : out ? `❄ Froze at F${tp.bestFloor}` : `Floor ${tp.bestFloor}/${FLOORS}`}
            </div>
          </div>
          {comboText && <span class="tower-combo-tag">{comboText}</span>}
          <div class="tower-ppts">{this.phase === 'over' ? this.scores[i] : this.scores[i] + sim.scoreOf(i)}</div>
        </div>
      );
    };

    return (
      <>
        {/* Left Flank: outside the central tower walls */}
        <div class="tower-flank left">
          <div class="tower-box tower-header">
            <div class="tower-round">
              Round {this.round}/{this.rounds} · {theme.name}
            </div>
            <div class="tower-title">Lodowa Wieża</div>
            <div class={`tower-clock ${hurry ? 'hurry' : ''}`}>{clock}</div>
            {sim.rushEndsAt !== null && <div class="tower-alert">👑 CROWN CLAIMED · HURRY!</div>}
            {sim.hurry && sim.rushEndsAt === null && <div class="tower-alert">❄ FROST RISING FAST!</div>}
          </div>

          <div class="tower-plist">{leftPlayers.map(playerCard)}</div>

          <div class="tower-box tower-tips">
            <div>◀ ▶ Run fast for higher jumps</div>
            <div>🧱 Bounce off walls to spin</div>
            <div>⚡ Skip 2+ floors for Combos</div>
          </div>
        </div>

        {/* Right Flank: Vertical altitude ruler + overflow players */}
        <div class="tower-flank right">
          <div class="tower-box tower-alt-panel">
            <div class="tower-round">Altitude · {FLOORS} Floors</div>
            <div class="tower-gauge">
              <div class="tower-gauge-track">
                {Array.from({ length: FLOORS + 1 }, (_, f) => (
                  <div class={`tower-gauge-tick ${f % 5 === 0 || f === FLOORS ? 'major' : ''}`} style={{ bottom: `${(f / FLOORS) * 100}%` }} key={f}>
                    {(f === 0 || f === 5 || f === 10 || f === 15 || f === FLOORS) && <span>{f === FLOORS ? '👑' : f}</span>}
                  </div>
                ))}
                {/* Rising frost indicator on the ruler */}
                {sim.frostY < 360 && (
                  <div class="tower-gauge-frost" style={{ height: `${Math.max(0, Math.min(100, ((342 - sim.frostY) / (342 - 38)) * 100))}%` }} />
                )}
                {/* Live player markers */}
                {liveIndices.map((i) => {
                  const p = players[i]!;
                  const tp = sim.players[i];
                  if (!tp) return null;
                  const pct = Math.max(0, Math.min(100, ((342 - tp.y) / (342 - 38)) * 100));
                  return (
                    <div
                      class={`tower-gauge-pin ${!tp.alive ? 'out' : ''}`}
                      style={{ bottom: `${pct}%`, background: colorHex(p.color), left: `${18 + (i % 4) * 14}px` }}
                      title={p.name}
                      key={p.id}
                    />
                  );
                })}
              </div>
            </div>
          </div>

          {rightPlayers.length > 0 && <div class="tower-plist">{rightPlayers.map(playerCard)}</div>}
        </div>

        {this.phase === 'ready' && <BigCountdown key={this.goAt} endsAt={this.goAt} />}
        {this.phase === 'over' && now - this.overAt > BANNER_DELAY_MS && this.banner(players)}
      </>
    );
  }

  private banner(players: ReturnType<GameHost['player']>[]) {
    const sim = this.sim;
    const name = (i: number) => players[i]?.name ?? '?';
    const order = this.ids
      .map((_, i) => i)
      .filter((i) => !this.removed.has(i))
      .sort((a, b) => this.roundPts[b] - this.roundPts[a] || (sim.players[b]?.bestFloor ?? 0) - (sim.players[a]?.bestFloor ?? 0));

    let big: string;
    if (sim.solo) {
      const p = sim.players[0];
      big = p?.finished ? `Summit in ${p.finishTime?.toFixed(1)} s!` : `Reached Floor ${p?.bestFloor ?? 0}!`;
    } else if (this.winners.length === 1) {
      big = `${name(this.winners[0])} rules the tower!`;
    } else if (this.winners.length > 1) {
      big = `A tie: ${this.winners.map(name).join(' & ')}`;
    } else {
      big = 'Round over';
    }

    return (
      <div class="trails-banner cookbook-banner tower-banner pop-in">
        <div class="trails-banner-small">
          Round {this.round} of {this.rounds} · {TOWER_THEMES[((sim.themeIndex % 3) + 3) % 3].name}
        </div>
        <div class="trails-banner-big cookbook-banner-big">{big}</div>
        <div class="cookbook-banner-list">
          {order.map((i) => {
            const p = players[i];
            const tp = sim.players[i];
            const won = this.winners.includes(i);
            return p && tp ? (
              <div class={`cookbook-banner-row ${won ? 'win' : ''}`} style={{ '--pc': colorHex(p.color) }} key={p.id}>
                <Pierogi color={colorHex(p.color)} size={38} mood={won || tp.finished ? 'wow' : !tp.alive ? 'dead' : 'happy'} />
                <span class="grow">{p.name}</span>
                <small class="tower-row-meta">
                  {tp.finished ? `👑 #${tp.finishOrder}` : `F${tp.bestFloor}`}
                  {tp.comboBonus > 0 ? ` · +${tp.comboBonus} combo` : ''}
                </small>
                <b>+{this.roundPts[i]}</b>
              </div>
            ) : null;
          })}
        </div>
        <div class="trails-banner-small cookbook-next">{this.round < this.rounds ? 'Next tower rising…' : 'That was the last climb!'}</div>
      </div>
    );
  }
}

function TowerView({ game }: { game: TowerGame }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [, force] = useState(0);
  useEffect(() => {
    game.attach(canvas.current!);
    force(1);
    return () => game.detach();
  }, [game]);
  return (
    <div class="rally tower">
      <canvas ref={canvas} class="rally-canvas tower-canvas" width={PIXEL_W} height={PIXEL_H} />
      {game.hud()}
    </div>
  );
}
