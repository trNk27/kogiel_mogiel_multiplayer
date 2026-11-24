import { resources } from './manager';
import { registerKitchenPack } from './packs/kitchen';
import { registerPixelCommonPack } from './packs/pixelCommon';
import { registerSwapPack } from './packs/swap';

registerKitchenPack(resources);
registerSwapPack(resources);
registerPixelCommonPack(resources);

export * from './styles';
export * from './pixel';
export * from './manager';
export * from './bajaCameo';
export { KITCHEN_CHEFS, KITCHEN_PACK, KITCHEN_SPRITES, KITCHEN_TEXTURES } from './packs/kitchen';
export { SWAP_PACK, SWAP_SPRITES } from './packs/swap';
export { PIXEL_COMMON_PACK } from './packs/pixelCommon';
