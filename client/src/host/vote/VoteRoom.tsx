/**
 * Party mode's vote before each tournament game, on the TV: the players walk their pierogi onto one of
 * a few market stalls, one per game, and then a ticket per vote goes into the draw.
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { colorHex, gameInfo, type GameId, type PadView, type PhoneMsg } from '../../../../shared/protocol';
import { ARENA_SCALE } from '../../games/arena/kit';
import { ArenaInput } from '../../games/arena/input';
import { Pierogi } from '../../lib/art';
import { sound } from '../../lib/sound';
import { GameIcon } from '../GameIcon';
import type { Player } from '../controller';
import { DT, VoteSim } from './logic';
import { CHOICE_COLORS, VoteScene } from './scene';
import './vote.css';

const HUD_MS = 150;

export interface VoteHost {
  player(id: string): Player | undefined;
  refresh(id?: string): void;
  buzz(id: string, pattern: number[]): void;
  changed(): void;
}

export class VoteRoom {
  readonly sim: VoteSim;
  private input: ArenaInput;
  private scene: VoteScene | null = null;
  private glError = false;
  private raf = 0;
  private acc = 0;
  private last = 0;
  private lastHud = 0;
  private lastSec = -1;
  private lastLit = -1;
  private done = false;
  /** Labels over the stalls, in stage pixels (updated as the scene renders). */
  labels: ({ x: number; y: number } | null)[] = [];

  constructor(
    private host: VoteHost,
    readonly ids: string[],
    /** The games to vote between. */
    readonly choices: GameId[],
    /** Which game of the tournament this is for ("Game 2 of 5"). */
    readonly game: number,
    readonly games: number,
    /** Called once with the game the draw picked. */
    private onChosen: (game: GameId) => void,
    /** Tournament points so far, by player id (shown on the phones). */
    private points: Record<string, number> = {},
  ) {
    this.input = new ArenaInput(ids);
    this.sim = new VoteSim(ids.length, choices.length, Math.random, ids.map((id) => !!host.player(id)));
  }

  start() {
    if (new URLSearchParams(location.search).has('debug')) (window as unknown as Record<string, VoteRoom>).vote = this;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
    this.host.refresh();
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.detach();
  }

  attach(canvas: HTMLCanvasElement) {
    try {
      this.scene = new VoteScene(
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

  // ---- loop ----------------------------------------------------------------------------

  private frame = (now: number) => {
    this.raf = requestAnimationFrame(this.frame);
    const elapsed = Math.min(0.25, (now - this.last) / 1000);
    this.last = now;
    this.acc += elapsed;
    while (this.acc >= DT) {
      this.acc -= DT;
      this.tick();
    }
    if (this.scene) {
      this.scene.render(elapsed);
      this.labels = this.choices.map((_, i) => this.scene?.labelAt(i) ?? null);
    }
    if (now - this.lastHud > HUD_MS) {
      this.lastHud = now;
      this.host.changed();
    }
  };

  private tick() {
    const sim = this.sim;
    const before = sim.votes();
    for (let i = 0; i < this.ids.length; i++) {
      const pad = this.input.pads[i];
      sim.setInput(i, pad.x, pad.y);
    }
    const ev = sim.step();
    // A vote changed: tell that phone, and give it a little buzz.
    const after = sim.votes();
    after.forEach((v, i) => {
      if (v === before[i]) return;
      if (v !== null) {
        sound.tick();
        this.host.buzz(this.ids[i], [25]);
      }
      this.host.refresh(this.ids[i]);
    });
    if (sim.phase === 'vote') {
      const sec = Math.ceil(sim.left);
      if (sec !== this.lastSec && sim.left < 3.05) {
        this.lastSec = sec;
        sound.count();
      }
    }
    if (sim.phase === 'spin') {
      const lit = sim.lit();
      if (lit !== this.lastLit && lit >= 0) sound.tick();
      this.lastLit = lit;
    }
    if (ev === 'spin') {
      sound.whoosh();
      this.input.release();
      this.host.refresh();
    } else if (ev === 'chosen') {
      sound.fanfare();
      const w = sim.winner();
      sim.votes().forEach((v, i) => v === w && this.host.buzz(this.ids[i], [120, 60, 240]));
      this.host.refresh();
    } else if (ev === 'done' && !this.done) {
      this.done = true;
      cancelAnimationFrame(this.raf);
      this.onChosen(this.choices[sim.winner() ?? 0]);
    }
  }

  // ---- phones --------------------------------------------------------------------------

  onMessage(id: string, m: PhoneMsg) {
    this.input.handle(id, m);
  }

  onConnection(id: string, connected: boolean) {
    const i = this.ids.indexOf(id);
    if (i >= 0 && !connected) this.input.release(i);
  }

  onRemoved(id: string) {
    const i = this.ids.indexOf(id);
    if (i < 0) return;
    this.input.release(i);
    this.sim.remove(i);
  }

  viewFor(id: string): PadView {
    const i = this.ids.indexOf(id);
    const sim = this.sim;
    const base = { v: 'pad' as const, game: 'vote' as const, round: 1, rounds: 1, score: this.points[id] ?? 0, buttons: [] };
    const stats = [{ k: 'Game', v: `${this.game}/${this.games}` }];
    const mine = i >= 0 ? sim.votes()[i] : null;
    if (sim.phase === 'vote') {
      if (mine === null) return { ...base, phase: 'play', title: 'Vote for the next game!', text: 'Walk onto a stall’s mat · 📺', stats };
      return { ...base, phase: 'play', title: gameInfo(this.choices[mine]).title, text: 'Your vote – stay on the mat, or walk to another', accent: CHOICE_COLORS[mine], stats };
    }
    if (sim.phase === 'spin') {
      return { ...base, phase: 'over', title: 'The draw!', text: mine === null ? 'Every vote is a ticket · 📺' : `Your ticket: ${gameInfo(this.choices[mine]).title}`, noStick: true, stats };
    }
    const w = sim.winner() ?? 0;
    return {
      ...base,
      phase: 'over',
      title: gameInfo(this.choices[w]).title,
      text: mine === w ? 'Your game won!' : 'Up next · 📺 look up',
      accent: CHOICE_COLORS[w],
      noStick: true,
      stats,
    };
  }

  // ---- TV ------------------------------------------------------------------------------

  render() {
    return <VoteView room={this} />;
  }

  hud() {
    const sim = this.sim;
    const counts = sim.counts();
    const winner = sim.winner();
    const lit = sim.lit();
    const players = this.ids.map((id) => this.host.player(id));
    return (
      <>
        <div class="vote-top">
          <div class="pill">
            🏆 {this.game} / {this.games}
          </div>
          <div class="vote-rule">{sim.phase === 'vote' ? 'Walk onto the game you want to play' : sim.phase === 'spin' ? 'Every vote is a ticket…' : 'Up next!'}</div>
          {sim.phase === 'vote' && <div class={`vote-clock ${sim.left < 3.05 ? 'hurry' : ''}`}>{Math.ceil(sim.left)}</div>}
        </div>

        {this.choices.map((g, i) => {
          const at = this.labels[i];
          if (!at) return null;
          const won = sim.phase === 'chosen' && winner === i;
          const lost = sim.phase === 'chosen' && winner !== i;
          const hot = sim.phase === 'spin' && lit >= 0 && sim.tickets[lit] === i;
          return (
            <div
              class={`vote-label ${won ? 'won' : ''} ${lost ? 'lost' : ''} ${hot ? 'hot' : ''}`}
              style={{ left: `${at.x}px`, top: `${at.y}px`, '--cc': CHOICE_COLORS[i % CHOICE_COLORS.length] }}
              key={g}
            >
              <GameIcon game={g} size={won ? 150 : 118} />
              <b>{gameInfo(g).title}</b>
              {sim.phase === 'vote' && (
                <span class="vote-count">
                  {counts[i]} vote{counts[i] === 1 ? '' : 's'}
                </span>
              )}
            </div>
          );
        })}

        {sim.phase !== 'vote' && (
          <div class="vote-tickets pop-in">
            {sim.tickets.map((c, k) => {
              const owner = sim.owners[k];
              const p = owner >= 0 ? players[owner] : undefined;
              const on = lit === k;
              return (
                <div class={`vote-ticket ${on ? 'on' : ''} ${sim.phase === 'chosen' && !on ? 'dim' : ''}`} style={{ '--cc': CHOICE_COLORS[c % CHOICE_COLORS.length] }} key={k}>
                  {p ? <Pierogi color={colorHex(p.color)} size={58} mood={on && sim.phase === 'chosen' ? 'wow' : 'happy'} /> : <GameIcon game={this.choices[c]} size={58} />}
                  <small>{p ? p.name : gameInfo(this.choices[c]).title}</small>
                </div>
              );
            })}
          </div>
        )}
        {sim.phase !== 'vote' && sim.owners.every((o) => o < 0) && <div class="vote-note">Nobody voted – every game gets one ticket</div>}

        {sim.phase === 'chosen' && winner !== null && (
          <div class="vote-chosen pop-in" style={{ '--cc': CHOICE_COLORS[winner % CHOICE_COLORS.length] }}>
            <small>Next up</small>
            <b>{gameInfo(this.choices[winner]).title}</b>
          </div>
        )}
        {this.glError && <div class="vote-note vote-gl">This screen can’t show 3D graphics (WebGL is off).</div>}
      </>
    );
  }
}


function VoteView({ room }: { room: VoteRoom }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [, force] = useState(0);
  useEffect(() => {
    room.attach(canvas.current!);
    force(1);
    return () => room.detach();
  }, [room]);
  return (
    <div class="rally vote-room">
      <canvas ref={canvas} class="rally-canvas" width={Math.round(1920 * ARENA_SCALE)} height={Math.round(1080 * ARENA_SCALE)} />
      {room.hud()}
    </div>
  );
}
