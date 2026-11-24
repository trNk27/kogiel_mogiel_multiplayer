/**
 * Upij Kubę (Get Kuba Drunk). Kuba doesn't drink, so everyone else writes jokes to make him laugh. Each
 * joke is read out on the call in a silly voice; Kuba says on his phone whether he laughed, and everyone
 * else says whether they saw him crack. Every laugh is a shot, and so is getting caught lying about it.
 * If nobody called Kuba is playing, the sober one changes every round.
 */

export type KbRound = "joke" | "finish" | "draw" | "roast";
export const KB_ROUNDS: KbRound[] = ["joke", "finish", "draw", "roast"];
export const KB_ROUNDS_SHORT: KbRound[] = ["joke"];

export const KB_MAX = 140;
export const WRITE_MS = 80_000;
export const DRAW_MS = 90_000;
export const READ_MS = 14_000;
export const VERDICT_MS = 10_000;
export const RATE_MS = 9_000;
export const REVEAL_MS = 6_000;
export const TITLE_MS = 5_000;
export const SCORES_MS = 7_000;
export const END_MS = 9_000;

export const PTS = {
  admit: 500,
  pity: 300,
  liar: 400,
  /** The sober one, for keeping a straight face. */
  poker: 150,
  /** The sober one, for owning up to a laugh. */
  honest: 50,
  /** Per haha (the joke's average rating, 1–5). */
  haha: 40,
  /** Guessing right whether the sober one cracked. */
  guess: 75,
};

export const ROUND_INFO: Record<KbRound, { title: string; line: string }> = {
  joke: {
    title: "Jokes",
    line: "Write a joke for the prompt. Make {name} laugh!",
  },
  finish: {
    title: "Finish the sentence",
    line: "Finish the sentence about {name}.",
  },
  draw: {
    title: "Draw it",
    line: "Draw it on your phone, then explain it out loud.",
  },
  roast: {
    title: "The last shot",
    line: "One loving roast each. Last chance to get {name} drunk!",
  },
};

/** Is this the Kuba the game is named after? (Kuba, Kuba K., Jakub, Kubuś…) */
export function isKuba(name: string): boolean {
  return /^(kuba|kubu|jakub|kubi)/i.test(name.trim());
}

/**
 * Who stays sober in a round. A Kuba, if there's one playing; otherwise everyone takes a turn.
 * `ids` is the play order, `round` counts from 1.
 */
export function soberFor(
  players: { id: string; name: string }[],
  round: number,
): string {
  const kuba = players.find((p) => isKuba(p.name));
  if (kuba) return kuba.id;
  return players[(round - 1) % players.length].id;
}

export function fill(text: string, name: string): string {
  return text.replace(/\{name\}/g, name);
}

export function sanitize(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/\s+/g, " ")
    .replace(/[\u0000-\u001f<>]/g, "")
    .trim()
    .slice(0, KB_MAX)
    .trim();
}

/**
 * How a joke went.
 * admit: the sober one says they laughed (and the table agrees, or nobody voted) → shot.
 * pity: says they laughed, but the table saw nothing → still a shot.
 * liar: says no, but most of the table saw them crack → shot anyway.
 * poker: no laugh, and the table agrees (or is split) → no shot.
 */
export type Outcome = "admit" | "pity" | "liar" | "poker";

export function outcome(
  laughed: boolean,
  cracked: number,
  held: number,
): Outcome {
  if (laughed) return held > cracked ? "pity" : "admit";
  return cracked > held ? "liar" : "poker";
}

export function isShot(o: Outcome) {
  return o !== "poker";
}

/** Did the sober one crack, for scoring the guesses. */
export function crackedIn(o: Outcome) {
  return o !== "poker";
}

export function average(ratings: number[]): number {
  return ratings.length
    ? ratings.reduce((a, b) => a + b, 0) / ratings.length
    : 0;
}

export interface JokeScore {
  author: number;
  sober: number;
  /** Points per guesser who got it right. */
  guess: number;
}

export function scoreJoke(o: Outcome, avgRating: number): JokeScore {
  const haha = Math.round(avgRating * PTS.haha);
  switch (o) {
    case "admit":
      return { author: PTS.admit + haha, sober: PTS.honest, guess: PTS.guess };
    case "pity":
      return { author: PTS.pity + haha, sober: PTS.honest, guess: PTS.guess };
    case "liar":
      return { author: PTS.liar + haha, sober: 0, guess: PTS.guess };
    case "poker":
      return { author: haha, sober: PTS.poker, guess: PTS.guess };
  }
}

export const DRUNK = [
  { min: 0, label: "Stone cold sober", emoji: "😐" },
  { min: 1, label: "Warming up", emoji: "🙂" },
  { min: 2, label: "Tipsy", emoji: "😊" },
  { min: 4, label: "Wobbly", emoji: "🥴" },
  { min: 6, label: "Singing Sto lat", emoji: "🎤" },
  { min: 9, label: "Na zdrowie! Fully gone", emoji: "🍻" },
];

/** 0–5 for the picture, and the label to show. */
export function drunkLevel(shots: number): {
  level: number;
  label: string;
  emoji: string;
} {
  let level = 0;
  DRUNK.forEach((d, i) => shots >= d.min && (level = i));
  return { level, ...DRUNK[level] };
}

export function shuffle<T>(arr: T[], rnd = Math.random): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** One prompt per writer, all different while the pool lasts. */
export function dealPrompts(
  pool: string[],
  writers: number,
  rnd = Math.random,
): string[] {
  const deck = shuffle(pool, rnd);
  return Array.from({ length: writers }, (_, i) => deck[i % deck.length]);
}

export function howTo(short: boolean): string[] {
  return [
    "Kuba stays sober. Everyone else writes jokes (and draws one) to make him laugh",
    "Read yours out on the call in a silly voice. Kuba says if he laughed, you say if you saw him crack",
    short
      ? "Every laugh is a shot, and so is lying about it 🥃"
      : "4 rounds · Every laugh is a shot, and so is lying about it 🥃",
  ];
}
