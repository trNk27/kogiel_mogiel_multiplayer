/**
 * Spacer z Bają (Baja's walk): Exit 8, Baja-style. A first-person walk through an L-shaped, minimal,
 * sunlit flat, while Baja trots towards you with her green dragon toy. One player walks (joystick); everyone else votes:
 * anything off → turn back, all normal → keep going. Right calls count up the exits; one wrong call and
 * you're back at Exit 0. Like the real thing, the game itself decides each loop whether there's an anomaly.
 */

export type AnomalyId =
  // Baja (and her dragon)
  | "stare"
  | "backwards"
  | "huge"
  | "twoBajas"
  | "hindLegs"
  | "blackBaja"
  | "glowEyes"
  | "noBaja"
  | "zoomies"
  | "withYou"
  | "dragonSwap"
  | "noToy"
  // Creepy
  | "figure"
  | "sofaFigure"
  | "handprints"
  | "bookEyes"
  | "portraitEyes"
  | "emptyPortrait"
  | "wallWriting"
  | "doorDark"
  | "windowShadow"
  | "lightsOut"
  // The flat
  | "paintingUpside"
  | "paintingBaja"
  | "extraPainting"
  | "booksFallen"
  | "bookOut"
  | "lampOff"
  | "flicker"
  | "pendantSwing"
  | "clockBackwards"
  | "fridgeOpen"
  | "bowlOverflow"
  | "nightWindow"
  | "curtainsClosed"
  | "plantDead"
  | "rugColour"
  | "sofaMoved"
  | "stoolUpside"
  | "longRoom"
  | "ceilingLow";

export interface Anomaly {
  id: AnomalyId;
  /** What the reveal calls it. */
  label: string;
  /** 1 easy to spot … 3 sneaky. */
  tier: 1 | 2 | 3;
  /** Spooky ones get a creepy sound in the reveal. */
  creepy?: boolean;
}

export const ANOMALIES: readonly Anomaly[] = [
  { id: "stare", label: "Baja stopped and stared at you", tier: 2 },
  { id: "backwards", label: "Baja walked backwards", tier: 2 },
  { id: "huge", label: "Baja was enormous", tier: 1 },
  { id: "twoBajas", label: "There were two Bajas", tier: 1 },
  { id: "hindLegs", label: "Baja walked on two legs", tier: 1 },
  { id: "blackBaja", label: "Baja was the wrong colour", tier: 2 },
  { id: "glowEyes", label: "Baja's eyes glowed red", tier: 2, creepy: true },
  { id: "noBaja", label: "No Baja, only barking", tier: 1 },
  { id: "zoomies", label: "Baja zoomed past way too fast", tier: 1 },
  { id: "withYou", label: "Baja walked away from you", tier: 2 },
  { id: "dragonSwap", label: "The dragon was carrying Baja", tier: 1 },
  { id: "noToy", label: "Baja came without her dragon", tier: 3 },
  {
    id: "figure",
    label: "A dark figure in the back wall",
    tier: 1,
    creepy: true,
  },
  {
    id: "sofaFigure",
    label: "Someone was sitting on the sofa",
    tier: 1,
    creepy: true,
  },
  {
    id: "handprints",
    label: "Handprints on the window",
    tier: 2,
    creepy: true,
  },
  { id: "bookEyes", label: "Eyes in the bookcase", tier: 2, creepy: true },
  {
    id: "portraitEyes",
    label: "The portrait’s eyes followed you",
    tier: 3,
    creepy: true,
  },
  {
    id: "emptyPortrait",
    label: "The portrait was empty",
    tier: 3,
    creepy: true,
  },
  {
    id: "wallWriting",
    label: "WRÓĆ written on the wall",
    tier: 1,
    creepy: true,
  },
  {
    id: "doorDark",
    label: "The bedroom door was open, with eyes in the dark",
    tier: 2,
    creepy: true,
  },
  {
    id: "windowShadow",
    label: "Someone was standing outside the window",
    tier: 2,
    creepy: true,
  },
  { id: "lightsOut", label: "The lights were out", tier: 1, creepy: true },
  { id: "paintingUpside", label: "A painting was upside down", tier: 2 },
  { id: "paintingBaja", label: "A painting turned into Baja", tier: 2 },
  { id: "extraPainting", label: "There was an extra painting", tier: 3 },
  { id: "booksFallen", label: "Books had fallen on the floor", tier: 1 },
  { id: "bookOut", label: "One book was sticking out", tier: 3 },
  { id: "lampOff", label: "The floor lamp was off", tier: 3 },
  { id: "flicker", label: "The lights flickered", tier: 1, creepy: true },
  {
    id: "pendantSwing",
    label: "A ceiling lamp was swinging",
    tier: 2,
    creepy: true,
  },
  { id: "clockBackwards", label: "The clock ran backwards", tier: 3 },
  { id: "fridgeOpen", label: "The fridge was open", tier: 1 },
  { id: "bowlOverflow", label: "Baja’s bowl was overflowing", tier: 2 },
  { id: "nightWindow", label: "It was night outside the windows", tier: 1 },
  { id: "curtainsClosed", label: "The curtains were closed", tier: 2 },
  { id: "plantDead", label: "The plant was dead", tier: 3 },
  { id: "rugColour", label: "The rug was a different colour", tier: 3 },
  { id: "sofaMoved", label: "The sofa faced the wall", tier: 2 },
  { id: "stoolUpside", label: "A kitchen stool was upside down", tier: 3 },
  { id: "longRoom", label: "The room was longer", tier: 3 },
  { id: "ceilingLow", label: "The ceiling was lower", tier: 3 },
];

export function anomaly(id: AnomalyId): Anomaly {
  return ANOMALIES.find((a) => a.id === id)!;
}

export const GOAL = 8;
export const GOAL_SHORT = 4;
/** The game ends after this many loops even if you never get out. */
export const MAX_LOOPS = 22;
export const MAX_LOOPS_SHORT = 10;
/** How often a loop has an anomaly. */
export const ANOMALY_CHANCE = 0.55;

/** Walking speed in metres per second at full stick. */
export const WALK_SPEED = 2.2;
/** If the walker doesn't move for this long (or drops out), the walk carries on by itself, slowly. */
export const IDLE_MS = 6000;
export const AUTO_SPEED = 1.1;
export const DECIDE_MS = 7000;
export const TURN_MS = 2600;
export const REVEAL_MS = 5500;
export const EXIT_MS = 9000;

export const PTS = { right: 100, escape: 300 };

/** Which anomalies can turn up at this exit: obvious ones early, sneaky ones near the end. */
export function tiersFor(level: number, goal = GOAL): (1 | 2 | 3)[] {
  const f = level / goal;
  if (f < 0.25) return [1, 2];
  if (f < 0.6) return [1, 2, 3];
  return [2, 3];
}

/** This loop's anomaly, or none: the right tiers, ones not seen yet first. */
export function pickAnomaly(
  level: number,
  used: ReadonlySet<AnomalyId>,
  goal = GOAL,
  rnd = Math.random,
): AnomalyId | null {
  if (rnd() >= ANOMALY_CHANCE) return null;
  const tiers = tiersFor(level, goal);
  const pool = ANOMALIES.filter((a) => tiers.includes(a.tier));
  const fresh = pool.filter((a) => !used.has(a.id));
  const from = fresh.length ? fresh : pool;
  return from[Math.floor(rnd() * from.length)].id;
}

/** The group's call: most votes wins, and a tie plays it safe and turns back. */
export function groupCall(back: number, forward: number): "back" | "forward" {
  return forward > back ? "forward" : "back";
}

export function rightCall(a: AnomalyId | null): "back" | "forward" {
  return a ? "back" : "forward";
}

/** The next exit: one up for a right call, back to 0 for a wrong one. */
export function nextLevel(
  level: number,
  call: "back" | "forward",
  a: AnomalyId | null,
): number {
  return call === rightCall(a) ? level + 1 : 0;
}

/** Who walks this loop: everyone in turn. */
export function walkerFor(ids: string[], loop: number): string {
  return ids[loop % ids.length];
}

export function howTo(short: boolean): string[] {
  return [
    "One of you walks through Baja’s flat (joystick). Everyone watches for anything strange",
    "Vote on your phone: ↩ Go back if something is off, ➡ Keep going if all is normal",
    `${short ? GOAL_SHORT : GOAL} right calls in a row reach Exit ${short ? GOAL_SHORT : GOAL}. One wrong call: back to Exit 0`,
  ];
}
