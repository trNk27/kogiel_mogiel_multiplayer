import { describe, expect, it } from 'vitest';
import { GAMES, PLAYER_COLORS } from '../shared/protocol';
import {
  ART_STYLES,
  BajaPatrol,
  PIXEL_H,
  PIXEL_W,
  ResourceManager,
  artStyleForGame,
  expandPixelPalette,
  getArtStyle,
  listArtStyles,
  measurePixelText,
  playerPixelRamp,
  resources,
  validatePixelGrid,
} from '../client/src/lib/assets';
import { TOWER_PACK_ID } from '../client/src/games/tower/sprites';

function luminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

describe('standardized art styles', () => {
  it('defines the three canonical art styles with valid resolutions, entry points, and reusable assets', () => {
    const styles = listArtStyles();
    expect(styles.map((s) => s.id).sort()).toEqual(['3d', 'cartoon', 'pixel']);
    expect(getArtStyle('pixel').baseResolution).toEqual([PIXEL_W, PIXEL_H]);
    expect(getArtStyle('pixel').smoothing).toBe(false);
    expect(getArtStyle('3d').smoothing).toBe(false);
    expect(getArtStyle('cartoon').smoothing).toBe(true);
    for (const s of styles) {
      expect(s.baseResolution[0]).toBeGreaterThan(0);
      expect(s.baseResolution[1]).toBeGreaterThan(0);
      expect(s.canvasScale).toBeGreaterThan(0);
      expect(s.entryPoint.length).toBeGreaterThan(0);
      expect(s.reusableAssets.length).toBeGreaterThanOrEqual(2);
      expect(s.rules.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('maps every registered game to a valid standardized art style', () => {
    const validIds = new Set(Object.keys(ART_STYLES));
    for (const g of GAMES) {
      expect(validIds.has(artStyleForGame(g.id)), g.id).toBe(true);
    }
    expect(artStyleForGame('kitchen')).toBe('cartoon');
    expect(artStyleForGame('swap')).toBe('cartoon');
    expect(artStyleForGame('quiz')).toBe('cartoon');
    expect(artStyleForGame('tower')).toBe('pixel');
    expect(artStyleForGame('tanks')).toBe('3d');
    expect(artStyleForGame('rally')).toBe('3d');
  });
});

describe('pixel color ramps and typography', () => {
  it('generates readable 5-step hex ramps with hi > base > shade > deep > out for every player color', () => {
    for (const c of PLAYER_COLORS) {
      const ramp = playerPixelRamp(c.hex);
      for (const hex of Object.values(ramp)) {
        expect(hex).toMatch(/^#[0-9a-f]{6}$/);
      }
      expect(luminance(ramp.hi), `${c.id} hi`).toBeGreaterThan(luminance(ramp.base));
      expect(luminance(ramp.base), `${c.id} base`).toBeGreaterThan(luminance(ramp.shade));
      expect(luminance(ramp.shade), `${c.id} shade`).toBeGreaterThan(luminance(ramp.deep));
      expect(luminance(ramp.deep), `${c.id} deep`).toBeGreaterThan(luminance(ramp.out));
    }
  });

  it('expands dynamic tokens inside sprite palettes', () => {
    const expanded = expandPixelPalette({ O: '$out', D: '$deep', S: '$shade', B: '$base', H: '$hi', W: '#ffffff' }, '#ff3d6e');
    const ramp = playerPixelRamp('#ff3d6e');
    expect(expanded).toEqual({
      O: ramp.out,
      D: ramp.deep,
      S: ramp.shade,
      B: ramp.base,
      H: ramp.hi,
      W: '#ffffff',
    });
  });

  it('measures 5x7 pixel bitmap text accurately', () => {
    expect(measurePixelText('', 1)).toEqual({ width: 0, height: 7 });
    expect(measurePixelText('A', 1)).toEqual({ width: 5, height: 7 });
    expect(measurePixelText('HI!', 1)).toEqual({ width: 17, height: 7 });
    expect(measurePixelText('HI!', 2)).toEqual({ width: 34, height: 14 });
  });
});

describe('ResourceManager and sprite packs', () => {
  it('supports isolated registration, listing, and Node-safe lookup/preloading', async () => {
    const mgr = new ResourceManager();
    mgr.registerPack({
      id: 'demo',
      style: 'pixel',
      sprites: {
        dot: { kind: 'pixel', pixels: ['##', '##'], palette: { '#': '$base' } },
        pic: { kind: 'image', url: '/sprites/demo.webp' },
      },
    });
    expect(mgr.hasPack('demo')).toBe(true);
    expect(mgr.listPacks('pixel')).toHaveLength(1);
    expect(mgr.listSprites('demo')).toEqual(['dot', 'pic']);
    expect(mgr.url('demo', 'pic')).toBe('/sprites/demo.webp');
    expect(mgr.url('demo', 'dot')).toBeNull();
    expect(mgr.getImage('demo', 'pic')).toBeNull();
    expect(mgr.getPixelCanvas('demo', 'dot')).toBeNull();
    await expect(mgr.preload('demo')).resolves.toBeUndefined();
  });

  it('backs every painted sprite in kitchen and swap with a real WebP file on disk', () => {
    const diskFiles = new Set(Object.keys(import.meta.glob('../client/public/sprites/**/*.webp')).map((f) => f.replace('../client/public', '')));
    expect(diskFiles.size).toBeGreaterThan(50);

    for (const packId of ['kitchen', 'swap']) {
      expect(resources.hasPack(packId)).toBe(true);
      const sprites = resources.listSprites(packId);
      expect(sprites.length).toBeGreaterThan(20);
      for (const id of sprites) {
        const u = resources.url(packId, id);
        expect(u, `${packId}:${id}`).toBeTruthy();
        expect(diskFiles.has(u!), `${packId}:${id} -> ${u}`).toBe(true);
      }
    }
  });

  it('validates every pixel grid, animation frame, and 3-slice tile in pixel-common and tower', () => {
    const pixelCommonSprites = resources.listSprites('pixel-common');
    expect(pixelCommonSprites).toContain('baja-idle');
    expect(pixelCommonSprites).toContain('baja-run');
    expect(pixelCommonSprites).toContain('baja-bag');
    expect(pixelCommonSprites).toContain('baja-bag-empty');

    for (const packId of ['pixel-common', TOWER_PACK_ID]) {
      const pack = resources.getPack(packId);
      expect(pack, packId).toBeDefined();
      for (const [id, def] of Object.entries(pack!.sprites)) {
        if (def.kind === 'pixel') {
          const v = validatePixelGrid(def.pixels, def.palette);
          expect(v.errors, `${packId}:${id}`).toEqual([]);
          expect(v.width).toBeGreaterThan(0);
          expect(v.height).toBeGreaterThan(0);
        } else if (def.kind === 'pixelAnim') {
          expect(def.frames.length, `${packId}:${id}`).toBeGreaterThan(0);
          expect(def.fps).toBeGreaterThan(0);
          def.frames.forEach((frame, fi) => {
            const v = validatePixelGrid(frame, def.palette);
            expect(v.errors, `${packId}:${id}[${fi}]`).toEqual([]);
          });
        } else if (def.kind === 'pixelTile3') {
          for (const part of ['left', 'mid', 'right'] as const) {
            const v = validatePixelGrid(def[part], def.palette);
            expect(v.errors, `${packId}:${id}.${part}`).toEqual([]);
          }
        }
      }
    }
  });
});

describe('BajaPatrol cameo controller', () => {
  it('runs intermittent menu visits from hidden -> entering -> inBag -> roam -> back to hidden', () => {
    let cycles = 0;
    const patrol = new BajaPatrol({
      bagX: 30,
      waypoints: [
        [90, 0],
        [140, 0],
      ],
      speed: 60,
      hopHeight: 8,
      hideBetweenVisits: true,
      initialHidden: 0.4,
      hiddenRange: [5, 5],
      inBagRange: [1, 1],
      stopsRange: [1, 1],
      seed: 12,
      onCycleHidden: () => cycles++,
    });

    expect(patrol.phase).toBe('hidden');
    expect(patrol.bagVisible).toBe(false);

    const seen = new Set<string>([patrol.phase]);
    for (let k = 0; k < 400; k++) {
      patrol.update(0.05);
      seen.add(patrol.phase);
      if (cycles > 0) break;
    }

    expect(seen.has('entering')).toBe(true);
    expect(seen.has('inBag')).toBe(true);
    expect(seen.has('hopOut')).toBe(true);
    expect(seen.has('roam')).toBe(true);
    expect(seen.has('sniff')).toBe(true);
    expect(seen.has('return')).toBe(true);
    expect(seen.has('hopIn')).toBe(true);
    expect(seen.has('leaving')).toBe(true);
    expect(cycles).toBe(1);
    expect(patrol.phase).toBe('hidden');
  });

  it('keeps bag parked in world mode and triggers excited outings via celebrate()', () => {
    const patrol = new BajaPatrol({
      bagX: -12,
      bagZ: 5,
      waypoints: [
        [-10, 3],
        [-13, 6],
      ],
      speed: 2.5,
      hopHeight: 0.6,
      hideBetweenVisits: false,
      initialInBag: 8,
      stopsRange: [1, 2],
      seed: 5,
    });

    expect(patrol.phase).toBe('inBag');
    expect(patrol.bagVisible).toBe(true);

    patrol.celebrate();
    expect(patrol.showHeart).toBe(true);

    let sawRun = false;
    for (let k = 0; k < 60; k++) {
      patrol.update(0.05);
      if (patrol.running) sawRun = true;
    }
    expect(sawRun).toBe(true);
    expect(patrol.bagVisible).toBe(true);
  });
});
