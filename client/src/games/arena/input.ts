/** Host-side input for the arena games: each player's joystick and buttons, from `stick` and `btn` messages. */
import type { PhoneMsg } from '../../../../shared/protocol';

export interface PadState {
  /** Joystick, each axis -1..1 (+x right, +y down the phone screen = towards the TV viewer). Length ≤ 1. */
  x: number;
  y: number;
  /** Buttons held right now. */
  held: boolean[];
  /** Presses since the game last called `takePresses` (so a quick tap between frames still counts). */
  presses: number[];
}

export class ArenaInput {
  readonly pads: PadState[];

  constructor(private ids: readonly string[]) {
    this.pads = ids.map(() => ({ x: 0, y: 0, held: [false, false], presses: [0, 0] }));
  }

  /** Feed a phone message in. Returns the player's index if it was a pad message, else -1. */
  handle(id: string, m: PhoneMsg): number {
    const i = this.ids.indexOf(id);
    if (i < 0) return -1;
    const p = this.pads[i];
    if (m.t === 'stick') {
      const x = Number(m.x) / 100;
      const y = Number(m.y) / 100;
      if (!Number.isFinite(x) || !Number.isFinite(y)) return -1;
      const len = Math.hypot(x, y);
      const k = len > 1 ? 1 / len : 1;
      p.x = x * k;
      p.y = y * k;
      return i;
    }
    if (m.t === 'btn') {
      const b = m.b === 1 ? 1 : 0;
      const on = !!m.on;
      if (on && !p.held[b]) p.presses[b]++;
      p.held[b] = on;
      return i;
    }
    return -1;
  }

  /** How many times button `b` was pressed since the last call (and forget them). */
  takePresses(i: number, b: number): number {
    const p = this.pads[i];
    if (!p) return 0;
    const n = p.presses[b];
    p.presses[b] = 0;
    return n;
  }

  /** Let go of everything (a phone dropped out, or a new round starts). */
  release(i?: number) {
    for (const [k, p] of this.pads.entries()) {
      if (i !== undefined && k !== i) continue;
      p.x = p.y = 0;
      p.held = [false, false];
      p.presses = [0, 0];
    }
  }
}
