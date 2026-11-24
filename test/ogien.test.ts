import { describe, expect, it } from "vitest";
import {
  COLS,
  CLEAR_PTS,
  GEM_PTS,
  LEVELS,
  OgienSim,
  RESPAWN_S,
  checkLevel,
  reachable,
  teamFor,
  Grid,
  type LevelDef,
  type Team,
} from "../client/src/games/ogien/logic";

const blank = (
  rows: Record<number, string>,
  extra: Partial<LevelDef> = {},
): LevelDef => {
  const map: string[] = [];
  for (let y = 0; y < 18; y++)
    map.push(
      rows[y] ??
        (y === 0 || y === 17 ? "#".repeat(32) : "#" + ".".repeat(30) + "#"),
    );
  return { name: "t", tip: "", map, ...extra };
};

/** Run a sim for `s` seconds with a fixed input per hero. */
function run(
  sim: OgienSim,
  s: number,
  input: (i: number, t: number) => { x: number; jump: boolean } = () => ({
    x: 0,
    jump: false,
  }),
) {
  const ev = [];
  for (let k = 0; k < Math.round(s * 60); k++) {
    sim.heroes.forEach((_, i) => {
      const inp = input(i, k / 60);
      sim.setInput(i, inp.x, inp.jump);
      if (inp.jump) sim.pressJump(i);
    });
    ev.push(...sim.step());
  }
  return ev;
}

const go = (def: LevelDef, teams: Team[]) => {
  const sim = new OgienSim(def, teams);
  sim.running = true;
  return sim;
};

describe("levels", () => {
  it("has 15 levels, all 32×18 with one door per team and spawns for both", () => {
    expect(LEVELS).toHaveLength(15);
    for (const l of LEVELS) {
      expect(l.map).toHaveLength(18);
      for (const r of l.map) expect(r).toHaveLength(32);
      const all = l.map.join("");
      expect(all.split("F").length - 1).toBe(1);
      expect(all.split("I").length - 1).toBe(1);
      expect(all).toContain("f");
      expect(all).toContain("i");
      const g = new Grid(l);
      for (const [ch, list] of g.portals)
        expect(list, `${l.name} portal ${ch}`).toHaveLength(2);
      for (const d of g.doors)
        expect(
          g.plates.some((p) => p.link === d.link),
          `${l.name} door ${d.link}`,
        ).toBe(true);
    }
  });

  it("every level can be finished by both teams with the plates held, and every gem and plate can be reached", () => {
    for (const l of LEVELS)
      expect(checkLevel(l), l.name).toEqual({
        fireHome: true,
        iceHome: true,
        gemsUnreachable: 0,
        platesUnreachable: 0,
      });
  });

  it("from level 2 on, nobody gets home without someone holding a plate", () => {
    const off = { a: false, b: false, c: false, d: false, e: false };
    LEVELS.slice(1).forEach((l) => {
      const g = new Grid(l);
      const fire = reachable(l, "fire", off).has(
        g.exits.fire[1] * COLS + g.exits.fire[0],
      );
      const ice = reachable(l, "ice", off).has(
        g.exits.ice[1] * COLS + g.exits.ice[0],
      );
      expect(fire && ice, l.name).toBe(false);
    });
  });
});

describe("physics", () => {
  it("a running jump gets up a ledge three tiles high", () => {
    const def = blank({
      14: "#" + ".".repeat(8) + "#".repeat(22) + "#",
      16: "#f" + ".".repeat(29) + "#",
    });
    const sim = go(def, ["fire"]);
    run(sim, 0.3);
    const h = sim.heroes[0];
    let jumped = false;
    run(sim, 1.6, () => {
      const jump = !jumped && h.x > 7.3;
      if (jump) jumped = true;
      return { x: 1, jump: jumped && h.vy < 0 ? true : jump };
    });
    expect(h.ground).toBe(true);
    expect(h.y).toBeCloseTo(14, 1);
    expect(h.x).toBeGreaterThan(9);
  });

  it("a four-tall wall is too high", () => {
    const def = blank({
      13: "#" + ".".repeat(8) + "#".repeat(22) + "#",
      14: "#" + ".".repeat(8) + "#".repeat(22) + "#",
      15: "#" + ".".repeat(8) + "#".repeat(22) + "#",
      16: "#f" + ".".repeat(7) + "#".repeat(22) + "#",
    });
    const sim = go(def, ["fire"]);
    run(sim, 2, () => ({ x: 1, jump: true }));
    expect(sim.heroes[0].x).toBeLessThan(9);
  });

  it("lava kills ice but not fire, water the other way round, goo kills everyone", () => {
    const def = blank({
      16: "#fi" + ".".repeat(28) + "#",
      17: "#" + "L".repeat(30) + "#",
    });
    const sim = go(def, ["fire", "ice"]);
    const ev = run(sim, 0.5);
    expect(sim.heroes[0].alive).toBe(true);
    expect(sim.heroes[1].alive).toBe(false);
    expect(ev).toContainEqual(
      expect.objectContaining({ t: "die", i: 1, cause: "lava" }),
    );

    const water = go(
      blank({
        16: "#fi" + ".".repeat(28) + "#",
        17: "#" + "W".repeat(30) + "#",
      }),
      ["fire", "ice"],
    );
    run(water, 0.5);
    expect(water.heroes.map((h) => h.alive)).toEqual([false, true]);

    const goo = go(
      blank({
        16: "#fi" + ".".repeat(28) + "#",
        17: "#" + "G".repeat(30) + "#",
      }),
      ["fire", "ice"],
    );
    run(goo, 0.5);
    expect(goo.heroes.map((h) => h.alive)).toEqual([false, false]);
  });

  it("the dead come back at their spawn", () => {
    const sim = go(
      blank({
        16: "#i" + ".".repeat(29) + "#",
        17: "#" + "#".repeat(5) + "L".repeat(25) + "#",
      }),
      ["ice"],
    );
    run(sim, 1.5, () => ({ x: 1, jump: false }));
    expect(sim.heroes[0].deaths).toBe(1);
    run(sim, RESPAWN_S + 0.1);
    const h = sim.heroes[0];
    expect(h.alive).toBe(true);
    expect(Math.floor(h.x)).toBe(1);
  });

  it("flames stop ice, icicles stop fire", () => {
    const def = blank({ 16: "#fi....^....v.." + ".".repeat(16) + "#" });
    const sim = go(def, ["fire", "ice"]);
    run(sim, 2.5, () => ({ x: 1, jump: false }));
    const [fire, ice] = sim.heroes;
    expect(fire.x).toBeGreaterThan(8);
    expect(fire.x).toBeLessThan(12);
    expect(ice.x).toBeLessThan(7);
  });
});

describe("plates", () => {
  const doorLevel = blank({ 16: "#f.a..A...F." + ".".repeat(19) + "#" });

  it("a door is open only while someone stands on its plate", () => {
    const sim = go(doorLevel, ["fire", "fire"]);
    run(sim, 0.2);
    expect(sim.active.a).toBe(false);
    // Hero 0 walks onto the plate and stops; hero 1 waits.
    run(sim, 0.4, (i) => ({ x: i === 0 ? 1 : 0, jump: false }));
    run(sim, 0.3);
    expect(sim.held.a).toBe(1);
    expect(sim.active.a).toBe(true);
    // Hero 1 can now walk through and into the door.
    const ev = run(sim, 2.5, (i) => ({ x: i === 1 ? 1 : 0, jump: false }));
    expect(ev).toContainEqual({ t: "home", i: 1 });
    // Hero 0 steps off: the door shuts and the holder can't follow.
    run(sim, 3, () => ({ x: 1, jump: false }));
    expect(sim.active.a).toBe(false);
    expect(sim.heroes[0].home).toBe(false);
    expect(sim.heroes[0].x).toBeLessThan(6);
  });

  it("a heavy plate needs that many people, but never everyone still out there", () => {
    const def = blank(
      { 16: "#fffaaaaa.A.F" + ".".repeat(18) + "#" },
      { need: { a: 3 } },
    );
    const two = go(def, ["fire", "fire"]);
    expect(two.needFor("a")).toBe(1);
    const five = go(def, ["fire", "fire", "fire", "fire", "fire"]);
    expect(five.needFor("a")).toBe(3);
    const four = go(def, ["fire", "fire", "fire", "fire"]);
    expect(four.needFor("a")).toBe(3);
    four.heroes[3].home = true;
    expect(four.needFor("a")).toBe(2);
  });

  it("bridges are solid only while held", () => {
    const def = blank(
      {
        14: "#" + ".".repeat(4) + "BBBBBBBB" + ".".repeat(18) + "#",
        16: "#fb" + ".".repeat(28) + "#",
      },
      { bridges: ["b"] },
    );
    const sim = go(def, ["fire"]);
    const g = sim.grid;
    expect(g.solid(6, 14, "fire", sim.active)).toBe(false);
    run(sim, 0.12, () => ({ x: 1, jump: false }));
    run(sim, 0.3);
    expect(sim.active.b).toBe(true);
    expect(g.solid(6, 14, "fire", sim.active)).toBe(true);
  });

  it("a gated portal works only while its plate is held", () => {
    const def = blank(
      {
        4: "#" + ".".repeat(20) + "1" + ".".repeat(9) + "#",
        5: "#".repeat(32),
        16: "#f.1..c.f" + ".".repeat(22) + "#",
      },
      { portals: { "1": "c" } },
    );
    const sim = go(def, ["fire", "fire"]);
    expect(sim.portalOn("1")).toBe(false);
    // Hero 1 starts at x≈8 and walks left onto the plate at 6; hero 0 waits, then walks onto the portal.
    run(sim, 0.4, (i) => ({ x: i === 1 ? -1 : 0, jump: false }));
    run(sim, 0.3);
    expect(sim.active.c).toBe(true);
    const ev = run(sim, 0.6, (i) => ({ x: i === 0 ? 1 : 0, jump: false }));
    expect(ev.some((e) => e.t === "portal" && e.i === 0)).toBe(true);
    expect(sim.heroes[0].y).toBeLessThan(6);
  });
});

describe("levels end", () => {
  it("is cleared when everyone is home, with points for the clear and gems", () => {
    const def = blank({ 16: "#f*.F.i+..I" + ".".repeat(20) + "#" });
    const sim = go(def, ["fire", "ice"]);
    const ev = run(sim, 2, () => ({ x: 1, jump: false }));
    expect(ev).toContainEqual({ t: "clear" });
    expect(sim.over).toBe("clear");
    const pts = sim.points();
    expect(pts[0]).toBeGreaterThanOrEqual(CLEAR_PTS + GEM_PTS);
    expect(pts[1]).toBeGreaterThanOrEqual(CLEAR_PTS + GEM_PTS);
    expect(sim.stars()).toBe(3);
  });

  it("a player who leaves no longer holds up the level", () => {
    const def = blank({ 16: "#f..F..i" + ".".repeat(23) + "#" });
    const sim = go(def, ["fire", "ice"]);
    sim.setActive(1, false);
    const ev = run(sim, 1.5, (i) => ({ x: i === 0 ? 1 : 0, jump: false }));
    expect(ev).toContainEqual({ t: "clear" });
  });

  it("times out after the level clock runs down", () => {
    const sim = go(blank({ 16: "#f..F..i" + ".".repeat(23) + "#" }), ["fire"]);
    sim.time = 149.99;
    const ev = run(sim, 0.1);
    expect(ev).toContainEqual({ t: "timeout" });
    expect(sim.stars()).toBe(0);
  });

  it("splits players into fire and ice in turn", () => {
    expect([0, 1, 2, 3, 4].map(teamFor)).toEqual([
      "fire",
      "ice",
      "fire",
      "ice",
      "fire",
    ]);
  });
});
