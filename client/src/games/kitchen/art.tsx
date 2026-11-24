/**
 * Pierogi Panic art. Items and stations are painted sprites (generated with FLUX.2 [pro], cut out
 * and saved as 192 px WebP in client/public/sprites/kitchen; the mushroom ones are drawn over them, see
 * tools/sprites). The same files are used as <img> on
 * the phones and TV tickets and drawn onto the TV canvas.
 */
import type { ColorId, Filling, KitchenItem } from '../../../../shared/protocol';
import { KITCHEN_SPRITES, KITCHEN_TEXTURES, resources } from '../../lib/assets';

export const SPRITES = KITCHEN_SPRITES;
export type Sprite = (typeof SPRITES)[number];

/** Floor, counter and wall textures (square tiles). */
export const TEXTURES = KITCHEN_TEXTURES;
export type Texture = (typeof TEXTURES)[number];

export type ChefPose = 'front' | 'back' | 'side';
/** Painted chef in a player colour: chef-<colour>-<pose>. Feet sit on the bottom edge. */
export function chefSprite(color: ColorId, pose: ChefPose) {
  return `chef-${color}-${pose}`;
}

export function spriteUrl(name: Sprite | Texture | string) {
  return resources.url('kitchen', name) ?? `/sprites/kitchen/${name}.webp`;
}

export function itemSprite(it: KitchenItem): Sprite {
  switch (it.k) {
    case 'flour':
      return 'flour';
    case 'dough':
      return 'dough';
    case 'fill':
      return `fill-${it.f}`;
    case 'raw':
      return 'raw';
    case 'plate':
      return it.f ? (it.fried ? 'plate-fried' : 'plate-boiled') : 'plate';
    case 'dirty':
      return 'dirty';
  }
}

/** Which filling to show as a little badge (pierogi all look alike from the outside). */
export function itemBadge(it: KitchenItem): Filling | null {
  return it.k === 'raw' || (it.k === 'plate' && it.f) ? it.f! : null;
}

export function ItemIcon({ item, size = 64, class: cls }: { item: KitchenItem; size?: number; class?: string }) {
  const badge = itemBadge(item);
  return (
    <span class={`item-icon ${cls ?? ''}`} style={{ width: size, height: size }}>
      <img src={spriteUrl(itemSprite(item))} width={size} height={size} alt="" draggable={false} />
      {badge && <img class="item-badge" src={spriteUrl(`ing-${badge}`)} alt="" draggable={false} />}
    </span>
  );
}

export function FillingIcon({ f, size = 48 }: { f: Filling; size?: number }) {
  return <img src={spriteUrl(`ing-${f}`)} width={size} height={size} alt="" draggable={false} />;
}

export function spriteImage(name: Sprite | Texture | string): HTMLImageElement {
  return resources.getImage('kitchen', name)!;
}

/** Resolves once every sprite has decoded (or failed). */
export function loadSprites() {
  return resources.preload('kitchen');
}
