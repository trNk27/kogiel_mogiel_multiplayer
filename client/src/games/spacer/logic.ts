/**
 * Spacer z Bają (Baja's walk). An "Exit 8"-style loop: the group walks the same little street past the
 * pet shop again and again while Baja trots past the other way. If anything is off, turn back; if
 * everything is normal, keep walking. Eight right calls in a row reach Exit 8; one wrong call and you're
 * back at Exit 0. Each walk one secret player plants the anomaly (or bluffs with nothing).
 */

export type AnomalyId =
  | "withYou"
  | "backwards"
  | "huge"
  | "twoBajas"
  | "hindLegs"
  | "blackBaja"
  | "sitting"
  | "glowEyes"
  | "briefcase"
  | "skyLeash"
  | "catShadow"
  | "noBaja"
  | "posterEyes"
  | "fishStare"
  | "signTypo"
  | "extraLamp"
  | "lightsOut"
  | "bigPigeon"
  | "snowUp"
  | "puddleCat"
  | "houseSeven"
  | "benchWatcher"
  | "carCreeps"
  | "tramBack"
  | "windowsOpen"
  | "snowHalf"
  | "graffiti"
  | "kibble"
  | "longStreet"
  | "ballWave";

export interface Anomaly {
  id: AnomalyId;
  /** What the phones and the reveal call it. */
  label: string;
  /** 1 easy to spot … 3 sneaky. */
  tier: 1 | 2 | 3;
  /** Where on the street it is (world px), for the reveal. Baja ones are shown where she passes. */
  x: number;
}

export const STREET_W = 3600;
export const VIEW_W = 1728;
/** Where the group walks on screen. */
export const GROUP_X = 380;

export const ANOMALIES: readonly Anomaly[] = [
  { id: "withYou", label: "Baja walks with you", tier: 1, x: 900 },
  { id: "backwards", label: "Baja walks backwards", tier: 2, x: 1500 },
  { id: "huge", label: "Baja is twice as big", tier: 1, x: 1500 },
  { id: "twoBajas", label: "Two Bajas", tier: 1, x: 1500 },
  { id: "hindLegs", label: "Baja walks on two legs", tier: 1, x: 1500 },
  { id: "blackBaja", label: "Baja is the wrong colour", tier: 2, x: 1500 },
  { id: "sitting", label: "Baja sits still and watches", tier: 2, x: 1500 },
  { id: "glowEyes", label: "Baja's eyes glow", tier: 2, x: 1500 },
  { id: "briefcase", label: "Baja carries a briefcase", tier: 2, x: 1500 },
  { id: "skyLeash", label: "A leash going up into the sky", tier: 2, x: 1500 },
  { id: "catShadow", label: "Baja's shadow is a cat", tier: 3, x: 1500 },
  { id: "noBaja", label: "No Baja (but barking)", tier: 1, x: 1500 },
  { id: "posterEyes", label: "The poster’s eyes follow you", tier: 3, x: 1820 },
  { id: "fishStare", label: "The fish all stare at you", tier: 2, x: 2050 },
  { id: "signTypo", label: "The shop sign is spelled wrong", tier: 3, x: 2050 },
  { id: "extraLamp", label: "One extra street lamp", tier: 3, x: 1150 },
  { id: "lightsOut", label: "Lights go out behind you", tier: 2, x: 850 },
  { id: "bigPigeon", label: "A giant pigeon", tier: 1, x: 1330 },
  { id: "snowUp", label: "Snow falls upwards", tier: 2, x: 1500 },
  { id: "puddleCat", label: "A cat in the puddle", tier: 3, x: 1620 },
  { id: "houseSeven", label: "House 8 is now 7", tier: 3, x: 2700 },
  {
    id: "benchWatcher",
    label: "The pierogi on the bench watches you",
    tier: 2,
    x: 1330,
  },
  { id: "carCreeps", label: "The parked car creeps along", tier: 2, x: 2850 },
  { id: "tramBack", label: "The tram goes the wrong way", tier: 3, x: 1500 },
  { id: "windowsOpen", label: "Every window is open", tier: 2, x: 2700 },
  { id: "snowHalf", label: "Snow on one side only", tier: 2, x: 1500 },
  { id: "graffiti", label: "The graffiti says WRÓĆ", tier: 2, x: 950 },
  { id: "kibble", label: "The kibble bowl keeps refilling", tier: 3, x: 2300 },
  { id: "longStreet", label: "The street is longer", tier: 3, x: 1500 },
  { id: "ballWave", label: "A wave of tennis balls", tier: 1, x: 1500 },
];

export function anomaly(id: AnomalyId): Anomaly {
  return ANOMALIES.find((a) => a.id === id)!;
}

export const GOAL = 8;
export const GOAL_SHORT = 4;
/** The game ends after this many walks even if you never get out. */
export const MAX_WALKS = 20;
export const MAX_WALKS_SHORT = 9;

export const LEARN_MS = 16_000;
export const PLANT_MS = 9_000;
export const WALK_MS = 15_000;
/** Votes stay open this long after the walk ends. */
export const DECIDE_MS = 7_000;
export const REVEAL_MS = 7_000;
export const EXIT_MS = 9_000;

export const PTS = { right: 100, named: 50, fooled: 100, escape: 300 };

/** Which anomalies the planter can choose from at this exit: obvious ones early, sneaky ones near the end. */
export function tiersFor(level: number, goal = GOAL): (1 | 2 | 3)[] {
  const f = level / goal;
  if (f < 0.25) return [1, 2];
  if (f < 0.6) return [1, 2, 3];
  return [2, 3];
}

export function shuffle<T>(arr: readonly T[], rnd = Math.random): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Three anomalies for the planter to choose from, preferring ones the group hasn't seen yet. */
export function plantOptions(
  level: number,
  used: ReadonlySet<AnomalyId>,
  goal = GOAL,
  rnd = Math.random,
): AnomalyId[] {
  const tiers = tiersFor(level, goal);
  const fresh = shuffle(
    ANOMALIES.filter((a) => tiers.includes(a.tier) && !used.has(a.id)),
    rnd,
  );
  const old = shuffle(
    ANOMALIES.filter((a) => tiers.includes(a.tier) && used.has(a.id)),
    rnd,
  );
  return [...fresh, ...old].slice(0, 3).map((a) => a.id);
}

/** Four answers for "What did you see?": the real one (if any) and decoys. */
export function nameOptions(
  real: AnomalyId | null,
  rnd = Math.random,
): AnomalyId[] {
  const decoys = shuffle(
    ANOMALIES.filter((a) => a.id !== real),
    rnd,
  )
    .slice(0, real ? 3 : 4)
    .map((a) => a.id);
  return shuffle(real ? [real, ...decoys] : decoys, rnd);
}

/** The group's call: most votes wins, and a tie plays it safe and turns back. */
export function groupCall(back: number, forward: number): "back" | "forward" {
  return forward > back ? "forward" : "back";
}

export function rightCall(planted: AnomalyId | null): "back" | "forward" {
  return planted ? "back" : "forward";
}

/** The next exit: one up for a right call, back to 0 for a wrong one. */
export function nextLevel(
  level: number,
  call: "back" | "forward",
  planted: AnomalyId | null,
): number {
  return call === rightCall(planted) ? level + 1 : 0;
}

/** Who plants next: a different player from last time, everyone getting turns. */
export function nextPlanter(
  ids: string[],
  turns: ReadonlyMap<string, number>,
  last: string | null,
  rnd = Math.random,
): string {
  const pool = ids.length > 1 ? ids.filter((id) => id !== last) : ids;
  const fewest = Math.min(...pool.map((id) => turns.get(id) ?? 0));
  const low = pool.filter((id) => (turns.get(id) ?? 0) === fewest);
  return low[Math.floor(rnd() * low.length)];
}

export function howTo(short: boolean): string[] {
  return [
    "Walk the street with Baja. Anything weird? Tap ↩ Go back. All normal? ➡ Keep walking",
    "Each walk, one of you secretly plants the weird thing, or bluffs with nothing",
    short
      ? `${GOAL_SHORT} right calls in a row to get out. One wrong one: back to Exit 0`
      : `${GOAL} right calls in a row reach Exit 8. One wrong one: back to Exit 0`,
  ];
}
