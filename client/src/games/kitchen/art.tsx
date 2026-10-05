/**
 * Pierogi Panic art. Items and stations are painted sprites (generated with FLUX.2 [pro], cut out
 * and saved as 192 px WebP in client/public/sprites/kitchen). The same files are used as <img> on
 * the phones and TV tickets and drawn onto the TV canvas.
 */
import type { Filling, KitchenItem } from '../../../../shared/protocol';

export const SPRITES = [
  'flour',
  'dough',
  'fill-potato',
  'fill-cabbage',
  'fill-meat',
  'fill-berry',
  'ing-potato',
  'ing-cabbage',
  'ing-meat',
  'ing-berry',
  'crate-potato',
  'crate-cabbage',
  'crate-meat',
  'crate-berry',
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
export type Sprite = (typeof SPRITES)[number];

export function spriteUrl(name: Sprite) {
  return `/sprites/kitchen/${name}.webp`;
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

/** Image cache for drawing sprites onto a canvas. */
const images = new Map<Sprite, HTMLImageElement>();

export function spriteImage(name: Sprite): HTMLImageElement {
  let img = images.get(name);
  if (!img) {
    img = new Image();
    img.decoding = 'async';
    img.src = spriteUrl(name);
    images.set(name, img);
  }
  return img;
}

/** Resolves once every sprite has decoded (or failed). */
export function loadSprites() {
  return Promise.all(SPRITES.map((n) => spriteImage(n)).map((img) => (img.complete ? Promise.resolve() : img.decode().catch(() => {}))));
}
