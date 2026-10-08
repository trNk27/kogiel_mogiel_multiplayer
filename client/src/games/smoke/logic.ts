/**
 * Fajki: a lazy Susan of cigarettes spins in the middle of the table. GRAB when one in your colour
 * passes in front of you, then smoke it: pull down on the phone at the right speed, hold, let go.
 * A cigarette in someone else's colour makes you cough. Yellowest teeth at the end win.
 */

export const SMOKE_MS = 60_000;
/** Tournament version. */
export const SMOKE_MS_SHORT = 40_000;
export const SMOKE_COUNTDOWN_MS = 3500;
/** How long a hand takes to reach the tray, and to come back. */
export const REACH_MS = 320;
export const RETURN_MS = 320;
export const COUGH_MS = 3000;
/** Tobacco in a cigarette; a perfect puff smokes PUFF_MAX of it. */
export const CIG_LENGTH = 100;
export const PUFF_MAX = 25;
/** Puffs closer together than this are ignored (a real pull and hold takes longer). */
export const MIN_PUFF_GAP_MS = 700;
/** An empty slot on the tray is refilled after this long (ms, random in between). */
export const REFILL_MS: readonly [number, number] = [900, 2200];

/**
 * The tower at the end. The pierogi fall in one by one (a new one every DROP_MS, each falling for
 * FALL_MS), the camera flashes and they grin, the teeth go yellow, then a crown hovers over the
 * tower, hopping from pierogi to pierogi, before it drops onto the winner.
 */
export const DROP_MS = 650;
export const FALL_MS = 550;
export const GRIN_MS = 2200;
export const SUSPENSE_MS = 3400;
export const REVEAL_MS = 4000;

/** When each part of the finale happens, in ms after it starts, for a tower of `n`. */
export function finaleTimes(n: number) {
  const landed = Math.max(0, n - 1) * DROP_MS + FALL_MS;
  const flash = landed + 600;
  const suspense = flash + GRIN_MS;
  const reveal = suspense + SUSPENSE_MS;
  return { landed, flash, suspense, reveal, end: reveal + REVEAL_MS };
}
export type FinaleTimes = ReturnType<typeof finaleTimes>;

/**
 * Where the crown hovers during the suspense: tower floors and when it gets there (ms after the
 * suspense starts). It hops quickly at first and slows down, like a wheel of fortune, and the last
 * hop is onto `winner` (or anyone, with no winner). Never the same floor twice in a row.
 */
export function crownHops(floors: number, winner: number | null, total: number, rnd: () => number): { at: number; floor: number }[] {
  const hops: { at: number; floor: number }[] = [];
  let at = 0;
  let dwell = 170;
  while (at + dwell < total) {
    hops.push({ at, floor: 0 });
    at += dwell;
    dwell *= 1.24;
  }
  if (hops.length === 0) hops.push({ at: 0, floor: 0 });
  const last = winner ?? Math.floor(rnd() * floors);
  for (let k = hops.length - 1; k >= 0; k--) {
    if (k === hops.length - 1) hops[k].floor = last;
    else if (floors < 2) hops[k].floor = 0;
    else {
      // Anything but the floor it hops to next.
      const next = hops[k + 1].floor;
      const f = Math.floor(rnd() * (floors - 1));
      hops[k].floor = f >= next ? f + 1 : f;
    }
  }
  return hops;
}

/** The pull: from touch to the bottom of the track. Inside this window it's perfect (ms). */
export const PULL_IDEAL: readonly [number, number] = [480, 1050];
/** The ghost on the phone shows this pace. */
export const PULL_GHOST_MS = 750;
/** Hold at the bottom at least this long for a full puff; longer than HOLD_MAX and you cough. */
export const HOLD_MIN_MS = 350;
export const HOLD_MAX_MS = 2600;

/** How a puff went: perfect, too fast, too slow, let go too soon, held too long (cough). */
export const Verdict = { Perfect: 0, Fast: 1, Slow: 2, Short: 3, Long: 4 } as const;
export type Verdict = (typeof Verdict)[keyof typeof Verdict];

export const VERDICT_LABEL = ['Perfect!', 'Too fast!', 'Too slow!', 'Hold it!', 'Too long!'] as const;

/**
 * Score a puff. `pullMs` is how long the whole pull took (or would have, at that pace),
 * `frac` how much of the track was pulled (0–1), `holdMs` how long it was held at the bottom.
 */
export function ratePuff(pullMs: number, frac: number, holdMs: number): { q: number; v: Verdict } {
  if (holdMs > HOLD_MAX_MS) return { q: 0, v: Verdict.Long };
  const [lo, hi] = PULL_IDEAL;
  let speed = 1;
  let v: Verdict = Verdict.Perfect;
  if (pullMs < lo) {
    speed = 0.25 + 0.75 * Math.max(0, (pullMs - 150) / (lo - 150));
    v = Verdict.Fast;
  } else if (pullMs > hi) {
    speed = 0.25 + 0.75 * Math.max(0, 1 - (pullMs - hi) / 1300);
    v = Verdict.Slow;
  }
  const f = Math.max(0, Math.min(1, frac));
  const hold = 0.35 + 0.65 * Math.min(1, Math.max(0, holdMs) / HOLD_MIN_MS);
  if (v === Verdict.Perfect && (f < 1 || holdMs < HOLD_MIN_MS)) v = Verdict.Short;
  return { q: Math.round(speed * f * hold * 100) / 100, v };
}

/** How much a puff of quality q smokes from a cigarette with `left` to go. */
export function puffAmount(q: number, left: number): number {
  if (!Number.isFinite(q)) return 0;
  return Math.max(0, Math.min(left, Math.round(Math.max(0, Math.min(1, q)) * PUFF_MAX)));
}

/** Slots on the tray for this many seats. */
export function slotCount(seats: number): number {
  return Math.max(10, 2 * seats + 2);
}

/** Smallest difference between two angles (radians, 0..π). */
export function angleDiff(a: number, b: number): number {
  const d = (((a - b) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI);
  return Math.abs(d - Math.PI);
}

/**
 * The slot whose cigarette is in front of a seat: the tray is turned by `tray` radians and slot k
 * sits at tray + k·2π/n. Returns -1 when the nearest slot is too far off (between two slots).
 */
export function slotInFront(tray: number, n: number, seat: number, tolerance = 0.5): number {
  const step = (2 * Math.PI) / n;
  let best = -1;
  let bestD = Infinity;
  for (let k = 0; k < n; k++) {
    const d = angleDiff(tray + k * step, seat);
    if (d < bestD) {
      bestD = d;
      best = k;
    }
  }
  return bestD <= step * tolerance ? best : -1;
}

/**
 * The colour for a refilled slot: the colour with the fewest cigarettes on the tray most of the
 * time, so everybody's colour keeps coming round.
 */
export function refillColor(colors: readonly string[], onTray: readonly (string | null)[], rnd: () => number): string {
  if (rnd() < 0.35) return colors[Math.floor(rnd() * colors.length)];
  const count = (c: string) => onTray.filter((x) => x === c).length;
  const fewest = Math.min(...colors.map(count));
  const pick = colors.filter((c) => count(c) === fewest);
  return pick[Math.floor(rnd() * pick.length)];
}

/** Tray speed (radians per second, signed) for a stretch of the game: faster and twistier as it goes. */
export function traySpeed(progress: number, rnd: () => number): number {
  const base = 0.65 + 0.75 * Math.max(0, Math.min(1, progress));
  const speed = base * (0.8 + 0.4 * rnd());
  return rnd() < 0.3 + 0.2 * progress ? -speed : speed;
}

/** Teeth from white to tobacco yellow: 0 = clean, 1 = the full yellow. */
export function teethColor(t: number): string {
  const stops = [
    [251, 248, 238],
    [244, 214, 92],
    [196, 140, 38],
  ];
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  const f = x - i;
  const c = stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * f));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

/** How yellow each player's teeth are: relative to the heaviest smoker, but never fully yellow for a puff or two. */
export function yellowness(smoked: readonly number[]): number[] {
  const top = Math.max(CIG_LENGTH * 1.5, ...smoked);
  return smoked.map((s) => Math.max(0, s) / top);
}

export function howTo(): string[] {
  return ['GRAB your colour', 'Pull down · hold · let go', 'Yellowest teeth win'];
}
