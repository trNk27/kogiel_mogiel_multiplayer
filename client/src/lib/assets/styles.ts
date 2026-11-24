import type { GameId } from '../../../../shared/protocol';

/**
 * The three standardized art styles across Kogiel Mogiel:
 *  - `cartoon`: 2D cartoon Polish-kitchen look (painted WebP sprites + SVG/vector cut-paper cards).
 *  - `3d`: Low-poly PS2-ish 3D arena/rally look (Three.js at 0.45× resolution).
 *  - `pixel`: Crisp 16-bit pixel-art look (640×360 scaled 3× integer to 1920×1080).
 */
export type ArtStyleId = 'cartoon' | '3d' | 'pixel';

export interface ArtStyleSpec {
  id: ArtStyleId;
  name: string;
  tagline: string;
  renderer: 'canvas2d' | 'webgl3d';
  /** Native drawing resolution before scaling to the 1920×1080 TV stage. */
  baseResolution: readonly [number, number];
  /** Scale relative to the 1920×1080 stage (`1` for cartoon, `0.45` for 3D, `1/3` for pixel art). */
  canvasScale: number;
  /** Whether bilinear image smoothing is enabled when drawing scaled sprites. */
  smoothing: boolean;
  /** CSS class added to containers using this style. */
  cssClass: string;
  /** Where developers and AI agents start when building a game in this style. */
  entryPoint: string;
  /** Shared packs and building blocks already available in the repo. */
  reusableAssets: readonly string[];
  /** Core palette tokens representing this style. */
  palette: Record<string, string>;
  /** Concise authoring rules for contributors creating new games in this style. */
  rules: readonly string[];
}

/** Canonical base resolution for 16-bit pixel-art games (exact 3× integer scale to 1920×1080). */
export const PIXEL_W = 640;
export const PIXEL_H = 360;
export const PIXEL_STAGE_SCALE = 3;

export const ART_STYLES: Record<ArtStyleId, ArtStyleSpec> = {
  cartoon: {
    id: 'cartoon',
    name: 'Cartoon 2D',
    tagline: 'Cozy Polish-kitchen cartoon sprites, thick #2a120a outlines, cut-paper cards & SVG Pierogi.',
    renderer: 'canvas2d',
    baseResolution: [1920, 1080],
    canvasScale: 1,
    smoothing: true,
    cssClass: 'style-cartoon',
    entryPoint: 'client/src/lib/assets + client/src/lib/art.tsx',
    reusableAssets: [
      'Pack "kitchen" (chefs, ingredients, stations, floor/wall tiles)',
      'Pack "swap" (36 Polish pantry objects)',
      'SVG Pierogi / Rosette / PIEROGI_PATH (client/src/lib/art.tsx)',
    ],
    palette: {
      bg: '#1d0d15',
      paper: '#fbf0d9',
      ink: '#2a120a',
      yolk: '#ffc93c',
      beet: '#e8335a',
      dill: '#2fd6a8',
      wood: '#c98a4b',
    },
    rules: [
      'Register external WebP/PNG sprites in a SpritePack with style: "cartoon" and preload via resources.preload().',
      'Use warm cel shading with thick #2a120a outlines, cream paper cards, and hard unblurred shadows.',
      'Reuse <Pierogi /> / PIEROGI_PATH from client/src/lib/art.tsx and existing kitchen/swap sprites.',
    ],
  },
  '3d': {
    id: '3d',
    name: 'Low-Poly 3D',
    tagline: 'Flat-shaded PS2-era low-poly Three.js scenes at 0.45× resolution with nearest-filtered pixel textures.',
    renderer: 'webgl3d',
    baseResolution: [864, 486],
    canvasScale: 0.45,
    smoothing: false,
    cssClass: 'style-3d',
    entryPoint: 'client/src/games/arena/kit.ts',
    reusableAssets: [
      'ArenaStage, buildPierogi, groundTexture, pixelTexture, nameTag, blobShadow, box (arena/kit.ts)',
      'buildBabcia (arena/babcia.ts)',
      'buildBaja, buildBajaBag, BajaCameo3D (arena/baja3d.ts)',
      'Puffs particle emitter (arena/puffs.ts)',
    ],
    palette: {
      sky: '#f2b38a',
      grass: '#568c3a',
      ice: '#c4e4f6',
      water: '#3478aa',
      wood: '#b07646',
      stone: '#968c80',
    },
    rules: [
      'Use ArenaStage (client/src/games/arena/kit.ts) with 0.45× internal resolution and CSS pixelated upscaling.',
      'Use flat-shaded MeshLambertMaterial (flat()) and 16×16 NearestFilter canvas textures.',
      'Reuse buildPierogi(), buildBabcia(), groundTexture(), and Puffs instead of building meshes from scratch.',
    ],
  },
  pixel: {
    id: 'pixel',
    name: '16-Bit Pixel Art',
    tagline: 'Crisp 640×360 pixel grid (exact 3× integer scale to 1920×1080) with hue-shifted shading and zero blur.',
    renderer: 'canvas2d',
    baseResolution: [PIXEL_W, PIXEL_H],
    canvasScale: 1 / PIXEL_STAGE_SCALE,
    smoothing: false,
    cssClass: 'style-pixel',
    entryPoint: 'client/src/lib/assets',
    reusableAssets: [
      'Pack "pixel-common" (Pixel Pierogi poses, Baja + carrier bag, 7 icons)',
      'Pack "tower" (3-slice ledges, walls, torches, frost)',
      'drawPixelText, ditherBand, playerPixelRamp (pixel.ts), BajaPatrol (bajaCameo.ts)',
    ],
    palette: {
      night: '#141838',
      slate: '#262d54',
      stone: '#525e84',
      ice: '#79d2ff',
      snow: '#f2fbff',
      gold: '#ffd23f',
      outline: '#120d1b',
    },
    rules: [
      'Prepare your canvas with resources.prepareCanvas(canvas, "pixel") (640×360, smoothing = false).',
      'Snap all draw coordinates to integers and use CSS image-rendering: pixelated.',
      'Define declarative pixel grids in SpritePacks with $out/$deep/$shade/$base/$hi tokens for automatic player recoloring.',
    ],
  },
};

export const GAME_ART_STYLES: Partial<Record<GameId, ArtStyleId>> = {
  tower: 'pixel',
  rally: '3d',
  premium: '3d',
  tanks: '3d',
  mushroom: '3d',
  pushy: '3d',
  gallery: '3d',
  cookbook: '3d',
  tiles: '3d',
  rope: '3d',
  blast: '3d',
  flags: '3d',
  potato: '3d',
  floes: '3d',
  chairs: '3d',
  chickens: '3d',
  crown: '3d',
  coins: '3d',
  moles: '3d',
  sheep: '3d',
  clock: '3d',
  boules: '3d',
  bells: '3d',
  herd: '3d',
  smoke: '3d',
  cows: '3d',
  footsteps: '3d',
  marina: '3d',
  castle: '3d',
  wesele: '3d',
};

export function getArtStyle(id: ArtStyleId): ArtStyleSpec {
  return ART_STYLES[id];
}

export function listArtStyles(): ArtStyleSpec[] {
  return Object.values(ART_STYLES);
}

export function artStyleForGame(id: GameId): ArtStyleId {
  return GAME_ART_STYLES[id] ?? 'cartoon';
}
