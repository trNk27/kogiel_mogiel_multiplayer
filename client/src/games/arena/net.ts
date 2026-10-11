/**
 * No-TV arena games (Grzybki, Pushy Pierogi): the host phone runs the game and sends every phone a
 * snapshot of the arena ~15 times a second; each phone draws the arena itself.
 *
 * Snapshots carry the host's clock. Phones play them back INTERP_MS behind the newest one they
 * could have, interpolating between the two around that moment, and fire each snapshot's events
 * when playback reaches it, so splashes happen where the pierogi are drawn.
 */

/** How often the host sends a snapshot. */
export const SNAPSHOT_MS = 66;
/** How far behind the host phones draw the arena (a bit more than one snapshot plus jitter). */
export const INTERP_MS = 120;

/** Round to `k` steps per unit, to keep snapshots short. */
export const rnd = (v: number, k = 100) => Math.round(v * k) / k;

/** A copy of a game event with its numbers rounded to centimetres, for the snapshot. */
export function slim<T extends object>(e: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(e)) out[k] = typeof v === 'number' && !Number.isInteger(v) ? rnd(v) : v;
  return out as T;
}

/** Interpolate an angle the short way round. */
export function lerpAngle(a: number, b: number, k: number) {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * k;
}

export interface Snap {
  /** Host clock ms. */
  at: number;
  s: number[];
  e: unknown[];
  fired: boolean;
}

/** One frame of playback: the snapshots either side of now, how far between them, and new events. */
export interface Frame {
  a: Snap;
  b: Snap;
  k: number;
  events: unknown[];
}

export class SnapBuffer {
  private snaps: Snap[] = [];
  /** Local clock minus host clock, as seen by the fastest recent snapshot. */
  private off: number | null = null;

  constructor(private now: () => number = Date.now) {}

  push(at: number, s: number[], e: unknown[] = []) {
    const o = this.now() - at;
    // The fastest delivery is the best guess for the clock offset; let it creep back up slowly
    // so a single lucky packet (or a clock change) doesn't hold it down for ever.
    if (this.off === null || o < this.off) this.off = o;
    else this.off += (o - this.off) * 0.01;
    const last = this.snaps[this.snaps.length - 1];
    if (last && at <= last.at) return;
    this.snaps.push({ at, s, e, fired: false });
    if (this.snaps.length > 30) this.snaps.splice(0, this.snaps.length - 30);
  }

  get empty() {
    return this.snaps.length === 0;
  }

  /** Advance playback to now. Null until the first snapshot arrives. */
  frame(): Frame | null {
    if (this.snaps.length === 0 || this.off === null) return null;
    const t = this.now() - this.off - INTERP_MS;
    let ai = 0;
    for (let i = 0; i < this.snaps.length; i++) if (this.snaps[i].at <= t) ai = i;
    const a = this.snaps[ai];
    const b = this.snaps[ai + 1] && a.at <= t ? this.snaps[ai + 1] : a;
    const k = b.at > a.at ? Math.max(0, Math.min(1, (t - a.at) / (b.at - a.at))) : 0;
    const events: unknown[] = [];
    for (let i = 0; i <= ai; i++) {
      const s = this.snaps[i];
      if (s.fired || s.at > t) continue;
      s.fired = true;
      events.push(...s.e);
    }
    // Keep the one we're playing from.
    if (ai > 0) this.snaps.splice(0, ai);
    return { a, b, k, events };
  }
}
