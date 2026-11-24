import { PLAYER_COLORS } from '../../../../../shared/protocol';
import { defineSpritePack, type ImageSpriteDef, type ResourceManager } from '../manager';

export const KITCHEN_SPRITES = [
  'flour',
  'dough',
  'fill-potato',
  'fill-cabbage',
  'fill-meat',
  'fill-berry',
  'fill-mushroom',
  'fill-wigilia',
  'ing-potato',
  'ing-cabbage',
  'ing-meat',
  'ing-berry',
  'ing-mushroom',
  'ing-wigilia',
  'crate-potato',
  'crate-cabbage',
  'crate-meat',
  'crate-berry',
  'crate-mushroom',
  'raw',
  'plate',
  'plate-boiled',
  'plate-fried',
  'dirty',
  'pot',
  'pot-raw',
  'pot-cooked',
  'mushy',
  'pan',
  'pan-raw',
  'fried-pan',
  'burnt',
  'bin',
  'pin',
  'bell',
] as const;

export const KITCHEN_TEXTURES = ['floor-1a', 'floor-1b', 'floor-2a', 'floor-2b', 'floor-3a', 'floor-3b', 'counter', 'wall'] as const;

export const KITCHEN_CHEFS = PLAYER_COLORS.flatMap((c) => (['front', 'back', 'side'] as const).map((pose) => `chef-${c.id}-${pose}`));

const entries: Record<string, ImageSpriteDef> = {};
for (const name of [...KITCHEN_SPRITES, ...KITCHEN_TEXTURES, ...KITCHEN_CHEFS]) {
  entries[name] = { kind: 'image', url: `/sprites/kitchen/${name}.webp` };
}

export const KITCHEN_PACK = defineSpritePack({
  id: 'kitchen',
  style: 'cartoon',
  description: 'Pierogi Panic cartoon kitchen props, chef poses, and Bolesławiec floor/wall tiles.',
  sprites: entries,
});

export function registerKitchenPack(mgr: ResourceManager): void {
  mgr.registerPack(KITCHEN_PACK);
}
