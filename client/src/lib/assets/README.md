# Kogiel Mogiel · Art Styles & Sprite Resource Manager

All game art in Kogiel Mogiel follows **one of three standardized styles** (`ArtStyleId` in [`styles.ts`](./styles.ts)) and loads/draws through the unified `resources` manager (`ResourceManager` in [`manager.ts`](./manager.ts)).

Preview all styles, palettes, and live sprite packs in the browser at **`http://localhost:8787/styles`** (`client/src/dev/styles.ts`).

---

## The 3 Standardized Styles

| Style ID | Name | Native Size | Smoothing | Where to Start | Built-in Reusable Assets |
| --- | --- | --- | --- | --- | --- |
| `'cartoon'` | **Cartoon 2D** | `1920×1080` | Yes | `client/src/lib/assets` + `client/src/lib/art.tsx` | `'kitchen'` & `'swap'` WebP sprite packs, `<Pierogi />`, `<Rosette />`, `PIEROGI_PATH` |
| `'3d'` | **Low-Poly 3D** | `864×486` (`0.45×`) | No (`pixelated`) | `client/src/games/arena/kit.ts` | `ArenaStage`, `buildPierogi()`, `buildBabcia()`, `buildBaja()`, `groundTexture()`, `Puffs` |
| `'pixel'` | **16-Bit Pixel Art** | `640×360` (`3×` integer scale) | No (`pixelated`) | `client/src/lib/assets` | `'pixel-common'` Pierogi + Baja + icons, `'tower'` platforms/tiles, `drawPixelText()` |

---

## Quick Recipes

### 1. Using Existing Cartoon Sprites (`'cartoon'`)

```ts
import { resources } from '../../lib/assets';

// Preload once when the game starts (deduplicated across games):
void resources.preload(['kitchen', 'swap']);

// Draw onto a 2D canvas:
resources.draw(ctx, 'kitchen', 'plate-boiled', x, y, { w: 96, h: 96 });

// Or get the URL for <img> tags in Preact:
const src = resources.url('swap', 'pickles');
```

For player avatars, use `<Pierogi color={colorHex(p.color)} />` or `PIEROGI_PATH` from `client/src/lib/art.tsx`.

### 2. Using Low-Poly 3D (`'3d'`)

```ts
import { ArenaStage, buildPierogi, flat, groundTexture } from '../arena/kit';
import { buildBabcia } from '../arena/babcia';
import { Puffs } from '../arena/puffs';

const stage = new ArenaStage(canvas, { sky: '#a6d8f0', fog: [55, 130], fov: 38 });
const pierogi = buildPierogi('#ff3d6e');
stage.add(pierogi.root);
```

### 3. Using Pixel Art & Dynamic Player Colors (`'pixel'`)

```ts
import { PIXEL_W, PIXEL_H, drawPixelText, resources } from '../../lib/assets';

// Sets canvas to 640×360 and imageSmoothingEnabled = false:
const ctx = resources.prepareCanvas(canvas, 'pixel')!;

// Draws an animated Pixel Pierogi automatically shaded for the player's color:
resources.draw(ctx, 'pixel-common', 'pierogi-run', Math.round(x), Math.round(y), {
  anchor: 'bottom',
  color: player.color, // ColorId (e.g. 'yolk') or '#rrggbb'
  flipX: facing < 0,
  time: elapsedSeconds,
});

// Draw a 3-slice platform of arbitrary width:
resources.drawTileRow(ctx, 'tower', 'plat-ice', plat.x, plat.y, plat.w);

// Draw crisp 5×7 pixel bitmap text:
drawPixelText(ctx, 'GREAT! +5', 320, 48, { align: 'center', color: '#ffd23f', outline: '#120d1b' });
```

**Available `'pixel-common'` sprites:**
- Player-colorable Pierogi poses (`color` option accepts any `ColorId` or hex): `pierogi-idle`, `pierogi-run`, `pierogi-jump`, `pierogi-fall`, `pierogi-spin`, `pierogi-win`, `pierogi-frozen`
- Cosmetic Baja mascot (Pomchi + brown & tan carrier bag): `baja-idle`, `baja-run`, `baja-bag`, `baja-bag-empty` (pair with `BajaPatrol` from `client/src/lib/assets`)
- Arcade icons: `crown`, `star`, `snowflake`, `sparkle`, `flag`, `heart`, `skull`

### 4. Dropping Cosmetic Baja into Any 3D or Pixel Scene

```ts
// Low-Poly 3D:
import { BajaCameo3D } from '../arena/baja3d';
const baja = new BajaCameo3D((x) => stage.keep(x), {
  bagPos: [12, 3],
  waypoints: [[12, 0.5], [13.5, 4]],
});
stage.add(baja.root);
// Inside frame loop: baja.update(dt);

// 16-Bit Pixel Art: use BajaPatrol + 'pixel-common' sprites ('baja-bag', 'baja-bag-empty', 'baja-idle', 'baja-run').
```

---

## Adding a New Sprite Pack (`SpritePack`)

Create `sprites.ts` inside your game folder (e.g. `client/src/games/<id>/sprites.ts`) or add shared packs under `client/src/lib/assets/packs/`:

```ts
import { defineSpritePack, resources } from '../../lib/assets';

export const MY_PACK = defineSpritePack({
  id: 'mygame',
  style: 'pixel', // 'cartoon' | '3d' | 'pixel'
  sprites: {
    // External WebP/PNG (for 'cartoon'):
    // badge: { kind: 'image', url: '/sprites/mygame/badge.webp' },

    // Declarative pixel grid using $out/$deep/$shade/$base/$hi player color tokens:
    gem: {
      kind: 'pixel',
      palette: { O: '$out', B: '$base', H: '$hi', W: '#ffffff' },
      pixels: [
        '.OOO.',
        'OHWBO',
        'OBBBO',
        '.OBO.',
        '..O..',
      ],
    },

    // Multi-frame animation:
    // flame: { kind: 'pixelAnim', fps: 8, palette: { ... }, frames: [[...], [...]] },

    // 3-slice horizontally tileable ledge/bar:
    // ledge: { kind: 'pixelTile3', palette: { ... }, left: [...], mid: [...], right: [...] },
  },
});

resources.registerPack(MY_PACK);
```

### Checklist for New Packs
1. **Validate pixel grids in tests** with `validatePixelGrid(grid, palette)` (see `test/assets.test.ts`) to catch ragged rows or undefined palette characters.
2. **Keep `logic.ts` free of DOM/Canvas imports** (Vitest runs in Node). `client/src/lib/assets` is Node-safe, so importing packs in tests is fine.
3. **Never write ad-hoc `new Image()` caches or duplicate Pixel Pierogi** — register sprites in `resources` and reuse `'pixel-common'`, `'kitchen'`, or `'swap'`.
4. **Preview visually** by opening `http://localhost:8787/styles` when running `npm run dev`.
