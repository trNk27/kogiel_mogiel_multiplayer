import { describe, expect, it } from 'vitest';
import {
  BAJA_FEED_ITEMS,
  BAJA_VISIT_MAX_MS,
  BAJA_VISIT_MIN_MS,
  COSMETICS,
  buyCosmeticState,
  clampFedCount,
  eligibleBajaTargets,
  isCosmeticId,
  nextBajaDelayMs,
  pickBajaTarget,
  toggleCosmeticState,
  type CosmeticWallet,
} from '../shared/cosmetics';
import {
  BAG_INTRO_S,
  BajaFeedSim,
  FEED_H,
  FEED_W,
  HOP_OUT_S,
  PROMPT_S,
  RUN_BACK_S,
} from '../client/src/phone/bajaFeedLogic';

function step(sim: BajaFeedSim, seconds: number, dt = 1 / 60) {
  const n = Math.ceil(seconds / dt);
  for (let i = 0; i < n; i++) sim.update(dt);
}

describe('lobby Baja cosmetics & rules', () => {
  it('prices cosmetics from 2 bones up to 8 for the crown', () => {
    expect(COSMETICS.map((c) => c.price)).toEqual([2, 2, 2, 4, 4, 4, 6, 6, 8]);
  });

  it('defines 9 valid cosmetics with positive bone prices', () => {
    expect(COSMETICS).toHaveLength(9);
    for (const c of COSMETICS) {
      expect(isCosmeticId(c.id)).toBe(true);
      expect(c.price).toBeGreaterThan(0);
    }
    expect(isCosmeticId('missing')).toBe(false);
  });

  it('keeps random visit delays between 20 and 40 seconds', () => {
    expect(nextBajaDelayMs(() => 0)).toBe(BAJA_VISIT_MIN_MS);
    expect(nextBajaDelayMs(() => 0.999999)).toBe(BAJA_VISIT_MAX_MS);
  });

  it('avoids repeating the same target player and excludes VIP & disconnected players', () => {
    const ids = ['a', 'b', 'c'];
    for (let i = 0; i < 20; i++) {
      expect(pickBajaTarget(ids, 'b', () => i / 20)).not.toBe('b');
    }
    expect(pickBajaTarget(['solo'], 'solo', () => 0.5)).toBe('solo');
    expect(pickBajaTarget([], 'a')).toBeNull();

    expect(
      eligibleBajaTargets(
        [
          { id: 'vip1', connected: true },
          { id: 'p2', connected: true },
          { id: 'p3', connected: false },
          { id: 'p4', connected: true },
        ],
        'vip1',
      ),
    ).toEqual(['p2', 'p4']);
    expect(eligibleBajaTargets([{ id: 'vip1', connected: true }], 'vip1')).toEqual([]);
  });

  it('clamps fed count safely to 0..BAJA_FEED_ITEMS', () => {
    expect(clampFedCount(-3)).toBe(0);
    expect(clampFedCount(3.4)).toBe(3);
    expect(clampFedCount(99)).toBe(BAJA_FEED_ITEMS);
    expect(clampFedCount('bad')).toBe(0);
  });

  it('buys and stacks unlimited cosmetics on Pierogi wallets', () => {
    let wallet: CosmeticWallet = { bones: 10, owned: [], equipped: [] };
    wallet = buyCosmeticState(wallet, 'bowtie')!;
    expect(wallet).toEqual({ bones: 8, owned: ['bowtie'], equipped: ['bowtie'] });

    // Buying already owned fails cleanly
    expect(buyCosmeticState(wallet, 'bowtie')).toBeNull();

    // Buying unaffordable item fails cleanly
    expect(buyCosmeticState({ bones: 7, owned: [], equipped: [] }, 'crown')).toBeNull();

    // Stacking multiple items works without unequipping previous ones
    wallet = buyCosmeticState(wallet, 'shades')!;
    wallet = buyCosmeticState(wallet, 'mustache')!;
    expect(wallet.equipped).toEqual(['bowtie', 'shades', 'mustache']);
    expect(wallet.bones).toBe(2);

    // Toggling removes or restores any single item
    const unequipped = toggleCosmeticState(wallet, 'shades')!;
    expect(unequipped).toEqual(['bowtie', 'mustache']);
    const reequipped = toggleCosmeticState({ owned: wallet.owned, equipped: unequipped }, 'shades')!;
    expect(reequipped).toEqual(['bowtie', 'mustache', 'shades']);
    expect(toggleCosmeticState(wallet, 'crown')).toBeNull();
  });
});

describe('BajaFeedSim phone minigame', () => {
  it('plays the intro choreography: big in bag -> hop out -> run back & shrink -> FEED ME! -> play', () => {
    const sim = new BajaFeedSim(42);
    expect(sim.phase).toBe('bagIntro');
    expect(sim.bagScale).toBe(3);

    step(sim, BAG_INTRO_S + 0.05);
    expect(sim.phase).toBe('hopOut');
    expect(sim.bagEmpty).toBe(true);
    expect(sim.bajaVisible).toBe(true);

    step(sim, HOP_OUT_S + 0.05);
    expect(sim.phase).toBe('runBack');
    const midScale = sim.bajaScale;
    expect(midScale).toBeGreaterThan(1.4);

    step(sim, RUN_BACK_S + 0.05);
    expect(sim.phase).toBe('prompt');
    expect(sim.bajaScale).toBeLessThan(midScale);
    expect(sim.bajaY).toBeLessThan(105);

    step(sim, PROMPT_S + 0.05);
    expect(sim.phase).toBe('play');
  });

  it('ignores downward or tiny swipes without spending treats', () => {
    const sim = new BajaFeedSim(12);
    step(sim, BAG_INTRO_S + HOP_OUT_S + RUN_BACK_S + PROMPT_S + 0.1);
    expect(sim.phase).toBe('play');
    expect(sim.fling(0, 40, 120)).toBe(false);
    expect(sim.fling(3, -5, 120)).toBe(false);
    expect(sim.remaining).toBe(BAJA_FEED_ITEMS);
  });

  it('flings treats all the way off-screen when aimed away from Baja', () => {
    const sim = new BajaFeedSim(19);
    step(sim, BAG_INTRO_S + HOP_OUT_S + RUN_BACK_S + PROMPT_S + 0.1);

    // Push Baja to left edge or aim straight for opposite wall/top edge
    const aimDx = sim.bajaX > FEED_W / 2 ? -80 : 80;
    expect(sim.fling(aimDx, -190, 140, FEED_W / 2)).toBe(true);
    expect(sim.remaining).toBe(BAJA_FEED_ITEMS - 1);
    expect(sim.projectiles).toHaveLength(1);
    expect(sim.projectiles[0].vy).toBeLessThanOrEqual(-220);

    // After enough time, projectile travels completely off screen and is lost
    step(sim, 1.5);
    expect(sim.projectiles).toHaveLength(0);
    expect(sim.fed).toBe(0);
  });

  it('awards a bone on a direct hit and finishes once all 5 items resolve', () => {
    const sim = new BajaFeedSim(7);
    step(sim, BAG_INTRO_S + HOP_OUT_S + RUN_BACK_S + PROMPT_S + 0.1);

    for (let i = 0; i < BAJA_FEED_ITEMS; i++) {
      // Aim directly at Baja's current position with a fast upward fling
      const dx = sim.bajaX - FEED_W / 2;
      const dy = -Math.max(60, 244 - sim.bajaY);
      expect(sim.fling(dx, dy, 100, FEED_W / 2)).toBe(true);
      step(sim, 0.75);
    }

    expect(sim.remaining).toBe(0);
    expect(sim.projectiles).toHaveLength(0);
    expect(sim.fed).toBeGreaterThanOrEqual(3);
    expect(sim.fed).toBeLessThanOrEqual(BAJA_FEED_ITEMS);
    expect(sim.phase).toBe('done');
    expect(FEED_H).toBe(280);
  });
});
