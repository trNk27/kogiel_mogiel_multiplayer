import { defineSpritePack, type ImageSpriteDef, type ResourceManager } from '../manager';

export const SWAP_SPRITES = [
  'apples',
  'babka',
  'beetroot',
  'bread',
  'cabbage-rolls',
  'carrots',
  'clock',
  'cucumbers',
  'cutlery',
  'eggs',
  'garlic',
  'gingerbread',
  'grater',
  'grinder',
  'honey',
  'jam',
  'kettle',
  'kielbasa',
  'kompot',
  'makowiec',
  'milk',
  'mortar',
  'mushrooms',
  'onion',
  'oscypek',
  'paczek',
  'pickles',
  'plums',
  'radishes',
  'scale',
  'sieve',
  'spoon',
  'sugar',
  'tea',
  'teapot',
  'whisk',
] as const;

const entries: Record<string, ImageSpriteDef> = {};
for (const name of SWAP_SPRITES) {
  entries[name] = { kind: 'image', url: `/sprites/swap/${name}.webp` };
}

export const SWAP_PACK = defineSpritePack({
  id: 'swap',
  style: 'cartoon',
  description: 'Podmianka cartoon pantry objects, jars, pastries, and kitchenware.',
  sprites: entries,
});

export function registerSwapPack(mgr: ResourceManager): void {
  mgr.registerPack(SWAP_PACK);
}
