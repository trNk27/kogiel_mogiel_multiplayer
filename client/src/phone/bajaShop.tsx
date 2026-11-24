import { COSMETICS, type CosmeticId } from '../../../shared/cosmetics';
import { colorHex, type ColorId } from '../../../shared/protocol';
import { Pierogi } from '../lib/art';
import { CosmeticPreview } from '../lib/cosmeticsArt';
import type { Send } from './PhoneApp';

interface BajaShopModalProps {
  color: ColorId;
  bones: number;
  owned: readonly CosmeticId[];
  equipped: readonly CosmeticId[];
  send: Send;
  onClose: () => void;
}

export function BajaShopModal({ color, bones, owned, equipped, send, onClose }: BajaShopModalProps) {
  return (
    <div class="baja-shop-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()} role="dialog" aria-label="Pierogi Wardrobe">
      <div class="baja-shop-card">
        <div class="baja-shop-head">
          <div>
            <b>Pierogi Wardrobe</b>
            <small>Lobby-only cosmetics · stack as many as you like!</small>
          </div>
          <span class="bone-pill">🦴 {bones}</span>
        </div>

        <div class="baja-shop-preview">
          <Pierogi color={colorHex(color)} size={124} cosmetics={equipped} class="bob" />
        </div>

        <div class="baja-shop-grid">
          {COSMETICS.map((item) => {
            const isOwned = owned.includes(item.id);
            const isOn = equipped.includes(item.id);
            const canAfford = bones >= item.price;
            return (
              <button
                key={item.id}
                type="button"
                class={`shop-item ${isOwned ? 'owned' : ''} ${isOn ? 'equipped' : ''}`}
                disabled={!isOwned && !canAfford}
                onClick={() => send(isOwned ? { t: 'toggleCosmetic', id: item.id } : { t: 'buyCosmetic', id: item.id })}
              >
                <CosmeticPreview id={item.id} size={42} />
                <b>{item.name}</b>
                <span class="shop-tag">
                  {isOn ? 'Wearing ✓' : isOwned ? 'Wear' : `🦴 ${item.price}`}
                </span>
              </button>
            );
          })}
        </div>

        <button type="button" class="btn btn-big btn-yolk shop-done" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
