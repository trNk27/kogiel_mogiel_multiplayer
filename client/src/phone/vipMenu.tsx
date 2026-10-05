import { useState } from 'preact/hooks';
import type { Send } from './PhoneApp';

/** The VIP's ⋯ menu during a game. */
export function VipMenu({ send }: { send: Send }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button class="vip-menu-btn" onClick={() => setOpen(true)} aria-label="VIP menu">
        ⋯
      </button>
      {open && (
        <div class="sheet-backdrop" onClick={() => setOpen(false)}>
          <div class="sheet" onClick={(e) => e.stopPropagation()}>
            <div class="sheet-title">VIP menu</div>
            <button
              class="btn btn-big btn-beet"
              onClick={() => {
                send({ t: 'lobby' });
                setOpen(false);
              }}
            >
              End game & back to lobby
            </button>
            <button class="btn btn-ghost" onClick={() => setOpen(false)}>
              Keep playing
            </button>
          </div>
        </div>
      )}
    </>
  );
}
