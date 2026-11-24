import { describe, expect, it } from 'vitest';
import {
  DT,
  FLOORS,
  FLOOR_STEP,
  GROUND_Y,
  MAX_VX,
  PLACE_BONUS,
  PLAYER_HALF_W,
  ROUND_S,
  SUMMIT_Y,
  TOWER_ROUNDS_SHORT,
  TowerSim,
  WALL_L,
  WALL_R,
  comboLabel,
  comboPoints,
  edgeGap,
  generatePlatforms,
  howTo,
  mulberry32,
  type TowerEvent,
} from '../client/src/games/tower/logic';

function stepFor(sim: TowerSim, seconds: number): TowerEvent[] {
  const out: TowerEvent[] = [];
  const steps = Math.round(seconds / DT);
  for (let k = 0; k < steps; k++) out.push(...sim.step());
  return out;
}

describe('generatePlatforms', () => {
  it('produces reachable non-scrolling floors inside the shaft across 100 seeds and 3 themes', () => {
    for (let theme = 0; theme < 3; theme++) {
      for (let seed = 1; seed <= 100; seed++) {
        const plats = generatePlatforms(theme, mulberry32(seed));
        expect(plats).toHaveLength(FLOORS + 1);

        // Floor 0 spans full shaft; Floor 16 is centered summit.
        expect(plats[0].floor).toBe(0);
        expect(plats[0].x).toBe(WALL_L);
        expect(plats[0].w).toBe(WALL_R - WALL_L);

        const summit = plats[FLOORS];
        expect(summit.floor).toBe(FLOORS);
        expect(summit.kind).toBe('summit');
        expect(summit.y).toBe(SUMMIT_Y);
        expect(summit.x + summit.w / 2).toBeCloseTo((WALL_L + WALL_R) / 2, 0);

        for (let f = 1; f <= FLOORS; f++) {
          const p = plats[f];
          const prev = plats[f - 1];
          expect(p.y).toBe(GROUND_Y - f * FLOOR_STEP);
          expect(p.baseX - p.moveAmp).toBeGreaterThanOrEqual(WALL_L);
          expect(p.baseX + p.w + p.moveAmp).toBeLessThanOrEqual(WALL_R);

          // Worst-case horizontal edge gap between consecutive floors stays reachable.
          const worstGap = edgeGap(prev.baseX, prev.w, p.baseX, p.w) + prev.moveAmp + p.moveAmp;
          expect(worstGap, `theme=${theme} seed=${seed} floor=${f}`).toBeLessThanOrEqual(76);
        }
      }
    }
  });
});

describe('TowerSim jumping, wall-bouncing, and combos', () => {
  it('standing jump clears 1 floor while running jump clears 2+ floors and spins', () => {
    const stand = new TowerSim(1, 0, mulberry32(1));
    stand.begin();
    stand.pressJump(0);
    let minYStand = GROUND_Y;
    const standEvs: TowerEvent[] = [];
    for (let k = 0; k < 45; k++) {
      standEvs.push(...stand.step());
      minYStand = Math.min(minYStand, stand.players[0].y);
    }
    expect(standEvs.some((e) => e.t === 'jump')).toBe(true);
    expect(minYStand).toBeLessThanOrEqual(GROUND_Y - FLOOR_STEP);
    expect(minYStand).toBeGreaterThan(GROUND_Y - FLOOR_STEP * 2);

    const run = new TowerSim(1, 0, mulberry32(1));
    run.begin();
    run.players[0].x = WALL_L + 24;
    run.players[0].vx = MAX_VX;
    run.setInput(0, 1);
    run.pressJump(0);
    const runEvs = run.step();
    expect(runEvs.some((e) => e.t === 'superJump')).toBe(true);
    expect(run.players[0].spinning).toBe(true);
    let minYRun = GROUND_Y;
    for (let k = 0; k < 50; k++) {
      run.step();
      minYRun = Math.min(minYRun, run.players[0].y);
    }
    expect(minYRun).toBeLessThanOrEqual(GROUND_Y - FLOOR_STEP * 3);
  });

  it('wall-bounces at high speed and wall-jumps cleanly', () => {
    const sim = new TowerSim(1, 0, mulberry32(2));
    sim.begin();
    const p = sim.players[0];
    p.grounded = false;
    p.x = WALL_R - PLAYER_HALF_W - 1;
    p.y = GROUND_Y - 30;
    p.vx = 160;
    p.vy = -40;
    sim.setInput(0, 1);
    const evs = stepFor(sim, 0.05);
    expect(evs.some((e) => e.t === 'wallBounce')).toBe(true);
    expect(p.vx).toBeLessThan(-100);
    expect(p.spinning).toBe(true);

    // Slow contact sets wallCoyote so pressing Jump performs a wall-jump.
    const wj = new TowerSim(1, 0, mulberry32(3));
    wj.begin();
    const q = wj.players[0];
    q.grounded = false;
    q.coyote = 0;
    q.x = WALL_L + PLAYER_HALF_W;
    q.y = GROUND_Y - 30;
    q.vx = -20;
    q.vy = 20;
    wj.step();
    expect(q.wallTouch).toBe(-1);
    expect(q.wallCoyote).toBeGreaterThan(0);
    wj.pressJump(0);
    const wjEvs = wj.step();
    expect(wjEvs.some((e) => e.t === 'wallBounce')).toBe(true);
    expect(q.vx).toBeGreaterThan(150);
    expect(q.vy).toBeLessThan(-200);
    expect(q.spinning).toBe(true);
  });

  it('chains floor skips into combos and cashes them in on single-floor landings or timeout', () => {
    expect(comboLabel(3)).toBeNull();
    expect(comboLabel(4)).toBe('GOOD!');
    expect(comboLabel(6)).toBe('SWEET!');
    expect(comboLabel(8)).toBe('GREAT!');
    expect(comboLabel(11)).toBe('SUPER!');
    expect(comboLabel(14)).toBe('NO WAY!');
    expect(comboPoints(3)).toBe(0);
    expect(comboPoints(8)).toBe(4);

    const sim = new TowerSim(2, 0, mulberry32(4));
    sim.begin();
    const p = sim.players[0];
    const plat3 = sim.platforms[3];
    const plat7 = sim.platforms[7];
    const plat8 = sim.platforms[8];

    // Skip 3 floors (0 -> 3)
    p.grounded = false;
    p.x = plat3.x + plat3.w / 2;
    p.y = plat3.y - 2;
    p.vy = 200;
    sim.step();
    expect(p.comboFloors).toBe(3);

    // Skip 4 more floors (3 -> 7) => 7-floor combo
    p.grounded = false;
    p.x = plat7.x + plat7.w / 2;
    p.y = plat7.y - 2;
    p.vy = 200;
    sim.step();
    expect(p.comboFloors).toBe(7);

    // Land 1 floor up (7 -> 8) => cashes in SWEET! (+3 pts)
    p.grounded = false;
    p.x = plat8.x + plat8.w / 2;
    p.y = plat8.y - 2;
    p.vy = 200;
    const evs = sim.step();
    const comboEv = evs.find((e) => e.t === 'combo');
    expect(comboEv).toBeDefined();
    if (comboEv?.t === 'combo') {
      expect(comboEv.floors).toBe(7);
      expect(comboEv.label).toBe('SWEET!');
      expect(comboEv.pts).toBe(3);
    }
    expect(p.comboBonus).toBe(3);
    expect(p.comboFloors).toBe(0);
  });
});

describe('TowerSim hazards, springs, crown, and round flow', () => {
  it('activates springs and crumbling snow platforms with respawn', () => {
    const sim = new TowerSim(1, 2, mulberry32(5));
    sim.begin();
    const p = sim.players[0];

    const springPlat = sim.platforms.find((pl) => pl.springOffset !== null)!;
    expect(springPlat).toBeDefined();
    p.grounded = false;
    p.x = springPlat.x + springPlat.springOffset! + 6;
    p.y = springPlat.y - 2;
    p.vy = 200;
    const evs = sim.step();
    expect(evs.some((e) => e.t === 'spring')).toBe(true);
    expect(p.vy).toBeLessThan(-300);

    const crumblePlat = sim.platforms.find((pl) => pl.kind === 'crumble')!;
    expect(crumblePlat).toBeDefined();
    p.grounded = false;
    p.x = crumblePlat.x + crumblePlat.w / 2;
    p.y = crumblePlat.y - 2;
    p.vy = 200;
    sim.step();
    expect(crumblePlat.crumbleState).toBe('shaking');
    const crEvs = stepFor(sim, 0.8);
    expect(crEvs.some((e) => e.t === 'crumble')).toBe(true);
    expect(crumblePlat.crumbleState).toBe('gone');
    stepFor(sim, 3.2);
    expect(crumblePlat.crumbleState).toBe('solid');
  });

  it('triggers hurry up, freezes slow climbers, and crowns summit finishers', () => {
    const sim = new TowerSim(2, 0, mulberry32(6));
    sim.begin();
    // Keep P0 safely up on Floor 10 while P1 stays on ground and freezes.
    const plat10 = sim.platforms[10];
    sim.players[0].x = plat10.x + plat10.w / 2;
    sim.players[0].y = plat10.y;
    sim.players[0].standingFloor = 10;
    sim.players[0].bestFloor = 10;
    const hurryEvs = stepFor(sim, 21);
    expect(sim.hurry).toBe(true);
    expect(hurryEvs.some((e) => e.t === 'hurry')).toBe(true);
    expect(sim.players[1].alive).toBe(false);
    expect(hurryEvs.some((e) => e.t === 'freeze' && e.i === 1)).toBe(true);

    // P0 grabs the summit crown and ends round (only 1 alive left).
    const summit = sim.platforms[FLOORS];
    sim.players[0].grounded = false;
    sim.players[0].x = summit.x + summit.w / 2;
    sim.players[0].y = summit.y - 2;
    sim.players[0].vy = 200;
    const endEvs = sim.step();
    expect(endEvs.some((e) => e.t === 'crown' && e.i === 0)).toBe(true);
    expect(endEvs.some((e) => e.t === 'over')).toBe(true);
    expect(sim.over).toBe(true);

    const res = sim.results();
    expect(res.winners).toEqual([0]);
    expect(res.points[0]).toBeGreaterThanOrEqual(FLOORS + PLACE_BONUS[0]);
    expect(res.points[1]).toBe(0);
  });

  it('supports solo scoring, short mode, player removal, and 3-line howTo', () => {
    expect(TOWER_ROUNDS_SHORT).toBe(1);
    expect(howTo(false)).toHaveLength(3);
    expect(howTo(true)).toHaveLength(3);

    const solo = new TowerSim(1, 1, mulberry32(9));
    solo.begin();
    stepFor(solo, 5);
    const summit = solo.platforms[FLOORS];
    solo.players[0].grounded = false;
    solo.players[0].x = summit.x + summit.w / 2;
    solo.players[0].y = summit.y - 2;
    solo.players[0].vy = 150;
    solo.step();
    expect(solo.over).toBe(true);
    const soloRes = solo.results();
    expect(soloRes.winners).toEqual([]);
    expect(soloRes.points[0]).toBe(FLOORS + Math.round((ROUND_S - solo.players[0].finishTime!) / 3) + solo.players[0].comboBonus);

    const multi = new TowerSim(3, 0, mulberry32(10));
    multi.begin();
    multi.remove(2);
    expect(multi.players[2].gone).toBe(true);
    expect(multi.scoreOf(2)).toBe(0);
  });
});
