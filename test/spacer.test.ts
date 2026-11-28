import { describe, expect, it } from "vitest";
import {
  ANOMALIES,
  GOAL,
  groupCall,
  nameOptions,
  nextLevel,
  nextPlanter,
  plantOptions,
  rightCall,
  tiersFor,
  type AnomalyId,
} from "../client/src/games/spacer/logic";

describe("anomalies", () => {
  it("has 30 different ones, easy to sneaky", () => {
    expect(ANOMALIES).toHaveLength(30);
    expect(new Set(ANOMALIES.map((a) => a.id)).size).toBe(30);
    for (const t of [1, 2, 3])
      expect(
        ANOMALIES.filter((a) => a.tier === t).length,
      ).toBeGreaterThanOrEqual(5);
    for (const a of ANOMALIES) expect(a.label.length).toBeLessThanOrEqual(40);
  });

  it("saves the sneaky ones for the last exits", () => {
    expect(tiersFor(0)).toEqual([1, 2]);
    expect(tiersFor(GOAL - 1)).toEqual([2, 3]);
  });

  it("offers the planter three fresh ones from the right tiers", () => {
    const used = new Set<AnomalyId>();
    const opts = plantOptions(0, used);
    expect(opts).toHaveLength(3);
    for (const o of opts)
      expect([1, 2]).toContain(ANOMALIES.find((a) => a.id === o)!.tier);
    // Fresh ones first.
    const allButThree = new Set(
      ANOMALIES.filter((a) => a.tier !== 3)
        .map((a) => a.id)
        .slice(3),
    );
    const fresh = plantOptions(0, allButThree);
    for (const o of fresh) expect(allButThree.has(o)).toBe(false);
  });

  it('"what did you see?" has four choices, including the real one', () => {
    const opts = nameOptions("twoBajas");
    expect(opts).toHaveLength(4);
    expect(opts).toContain("twoBajas");
    expect(new Set(opts).size).toBe(4);
    expect(nameOptions(null)).toHaveLength(4);
  });
});

describe("the loop", () => {
  it("turning back is right when something was planted, walking on when nothing was", () => {
    expect(rightCall("huge")).toBe("back");
    expect(rightCall(null)).toBe("forward");
  });

  it("goes with the majority, and a tie turns back", () => {
    expect(groupCall(3, 1)).toBe("back");
    expect(groupCall(1, 3)).toBe("forward");
    expect(groupCall(2, 2)).toBe("back");
    expect(groupCall(0, 0)).toBe("back");
  });

  it("a right call moves up an exit, a wrong one sends you back to 0", () => {
    expect(nextLevel(3, "back", "huge")).toBe(4);
    expect(nextLevel(3, "forward", null)).toBe(4);
    expect(nextLevel(7, "forward", "extraLamp")).toBe(0);
    expect(nextLevel(5, "back", null)).toBe(0);
  });

  it("gives everyone turns planting, never twice in a row", () => {
    const ids = ["a", "b", "c"];
    const turns = new Map<string, number>();
    let last: string | null = null;
    const seen: string[] = [];
    for (let i = 0; i < 6; i++) {
      const p = nextPlanter(ids, turns, last);
      expect(p).not.toBe(last);
      turns.set(p, (turns.get(p) ?? 0) + 1);
      seen.push(p);
      last = p;
    }
    for (const id of ids) expect(turns.get(id)).toBe(2);
  });
});
