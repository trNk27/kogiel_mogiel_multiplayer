import { describe, expect, it } from "vitest";
import data from "../data/kuba.json";
import {
  PTS,
  crackedIn,
  dealPrompts,
  drunkLevel,
  fill,
  isKuba,
  isShot,
  outcome,
  sanitize,
  scoreJoke,
  soberFor,
  KB_MAX,
} from "../client/src/games/kuba/logic";

describe("the sober one", () => {
  it("recognises Kuba", () => {
    for (const n of ["Kuba", "kuba", "Kuba K", "Jakub", "Kubuś"])
      expect(isKuba(n), n).toBe(true);
    for (const n of ["Savanna", "Maui", "Akuba"])
      expect(isKuba(n), n).toBe(false);
  });

  it("is always Kuba when he plays", () => {
    const players = [
      { id: "a", name: "Savanna" },
      { id: "b", name: "Kuba" },
      { id: "c", name: "Maui" },
    ];
    expect([1, 2, 3, 4].map((r) => soberFor(players, r))).toEqual([
      "b",
      "b",
      "b",
      "b",
    ]);
  });

  it("takes turns when there is no Kuba", () => {
    const players = [
      { id: "a", name: "Savanna" },
      { id: "b", name: "Ola" },
      { id: "c", name: "Maui" },
    ];
    expect([1, 2, 3, 4].map((r) => soberFor(players, r))).toEqual([
      "a",
      "b",
      "c",
      "a",
    ]);
  });
});

describe("verdicts", () => {
  it("a laugh is a shot", () => {
    expect(outcome(true, 3, 0)).toBe("admit");
    expect(outcome(true, 0, 0)).toBe("admit");
  });
  it("a laugh nobody saw is a pity laugh, still a shot", () => {
    expect(outcome(true, 1, 3)).toBe("pity");
    expect(isShot("pity")).toBe(true);
  });
  it("denying it when most saw you crack makes you a liar, and you drink", () => {
    expect(outcome(false, 3, 1)).toBe("liar");
    expect(isShot("liar")).toBe(true);
  });
  it("a straight face that the table agrees with (or is split on) is no shot", () => {
    expect(outcome(false, 0, 3)).toBe("poker");
    expect(outcome(false, 2, 2)).toBe("poker");
    expect(isShot("poker")).toBe(false);
    expect(crackedIn("poker")).toBe(false);
  });
});

describe("scoring", () => {
  it("pays the author for laughs and haha, the sober one for a poker face", () => {
    expect(scoreJoke("admit", 4)).toEqual({
      author: PTS.admit + 4 * PTS.haha,
      sober: PTS.honest,
      guess: PTS.guess,
    });
    expect(scoreJoke("liar", 2.5).author).toBe(PTS.liar + 100);
    expect(scoreJoke("liar", 2.5).sober).toBe(0);
    expect(scoreJoke("poker", 1)).toEqual({
      author: PTS.haha,
      sober: PTS.poker,
      guess: PTS.guess,
    });
    expect(scoreJoke("admit", 0).author).toBeGreaterThan(
      scoreJoke("pity", 0).author,
    );
  });

  it("gets drunker with every shot", () => {
    expect(drunkLevel(0).level).toBe(0);
    expect(drunkLevel(1).level).toBe(1);
    expect(drunkLevel(3).label).toBe("Tipsy");
    expect(drunkLevel(20).level).toBe(5);
    for (let s = 1; s < 12; s++)
      expect(drunkLevel(s).level).toBeGreaterThanOrEqual(
        drunkLevel(s - 1).level,
      );
  });
});

describe("prompts", () => {
  it("fills in the sober one and keeps answers short and clean", () => {
    expect(fill("The real reason {name} doesn't drink", "Kuba")).toBe(
      "The real reason Kuba doesn't drink",
    );
    expect(sanitize("  hi <b>there</b>\n friend ")).toBe("hi bthere/b friend");
    expect(sanitize("x".repeat(500))).toHaveLength(KB_MAX);
    expect(sanitize(42)).toBe("");
  });

  it("deals everyone a different prompt while the pool lasts", () => {
    const p = dealPrompts(data.joke, 9);
    expect(new Set(p).size).toBe(9);
    expect(dealPrompts(["a", "b"], 5)).toHaveLength(5);
  });

  it("has enough prompts for 9 writers in every round, voices and dad jokes", () => {
    expect(data.joke.length).toBeGreaterThanOrEqual(9);
    expect(data.finish.length).toBeGreaterThanOrEqual(9);
    expect(data.draw.length).toBeGreaterThanOrEqual(9);
    expect(data.roast.length).toBeGreaterThanOrEqual(1);
    expect(data.styles.length).toBeGreaterThanOrEqual(10);
    expect(data.safety.length).toBeGreaterThanOrEqual(10);
    for (const s of data.safety) expect(s.length).toBeLessThanOrEqual(KB_MAX);
    for (const p of [...data.joke, ...data.finish, ...data.draw, ...data.roast])
      expect(p.length).toBeLessThan(80);
  });
});
