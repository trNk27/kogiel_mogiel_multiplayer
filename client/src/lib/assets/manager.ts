import { colorHex, isColorId } from '../../../../shared/protocol';
import { compilePixelGrid, expandPixelPalette } from './pixel';
import { getArtStyle, type ArtStyleId } from './styles';

export interface ImageSpriteDef {
  kind: 'image';
  url: string;
  width?: number;
  height?: number;
}

export interface PixelSpriteDef {
  kind: 'pixel';
  pixels: readonly string[];
  palette: Record<string, string>;
}

export interface PixelAnimDef {
  kind: 'pixelAnim';
  frames: readonly (readonly string[])[];
  palette: Record<string, string>;
  fps: number;
}

export interface PixelTile3Def {
  kind: 'pixelTile3';
  left: readonly string[];
  mid: readonly string[];
  right: readonly string[];
  palette: Record<string, string>;
}

export type SpriteDef = ImageSpriteDef | PixelSpriteDef | PixelAnimDef | PixelTile3Def;

export interface SpritePack {
  id: string;
  style: ArtStyleId;
  description?: string;
  sprites: Record<string, SpriteDef>;
}

export interface DrawSpriteOpts {
  w?: number;
  h?: number;
  scale?: number;
  anchor?: 'center' | 'bottom' | 'topleft';
  flipX?: boolean;
  flipY?: boolean;
  /** Player color ID (e.g. `'beetroot'`) or hex color for dynamic `$base`/`$out` pixel palettes. */
  color?: string;
  frame?: number;
  /** Animation clock in seconds (used when `frame` is omitted on `pixelAnim`). */
  time?: number;
  alpha?: number;
}

/** Type-safe identity helper for defining sprite packs. */
export function defineSpritePack<T extends SpritePack>(pack: T): T {
  return pack;
}

function resolveColor(color?: string): string {
  if (!color) return '#fff4dc';
  if (color.startsWith('#')) return color;
  return isColorId(color) ? colorHex(color) : color;
}

/**
 * Unified asset & sprite resource manager across all Kogiel Mogiel art styles.
 *
 * Manages external WebP/PNG image preloading alongside compiled, player-colorable
 * declarative pixel sprites, animations, and 3-slice tile rows.
 */
export class ResourceManager {
  private packs = new Map<string, SpritePack>();
  private images = new Map<string, HTMLImageElement>();
  private preloadPromises = new Map<string, Promise<void>>();
  private pixelCanvases = new Map<string, HTMLCanvasElement>();
  private dataUrls = new Map<string, string>();

  registerPack(pack: SpritePack): void {
    this.packs.set(pack.id, pack);
  }

  hasPack(packId: string): boolean {
    return this.packs.has(packId);
  }

  getPack(packId: string): SpritePack | undefined {
    return this.packs.get(packId);
  }

  listPacks(style?: ArtStyleId): SpritePack[] {
    const all = [...this.packs.values()];
    return style ? all.filter((p) => p.style === style) : all;
  }

  listSprites(packId: string): string[] {
    const pack = this.packs.get(packId);
    return pack ? Object.keys(pack.sprites) : [];
  }

  getDef(packId: string, spriteId: string): SpriteDef | undefined {
    return this.packs.get(packId)?.sprites[spriteId];
  }

  url(packId: string, spriteId: string): string | null {
    const def = this.getDef(packId, spriteId);
    return def?.kind === 'image' ? def.url : null;
  }

  getImage(packId: string, spriteId: string): HTMLImageElement | null {
    const def = this.getDef(packId, spriteId);
    if (!def || def.kind !== 'image' || typeof Image === 'undefined') return null;
    const key = `${packId}:${spriteId}`;
    let img = this.images.get(key);
    if (!img) {
      img = new Image();
      img.decoding = 'async';
      img.src = def.url;
      this.images.set(key, img);
    }
    return img;
  }

  preload(packIds: string | readonly string[]): Promise<void> {
    const ids = typeof packIds === 'string' ? [packIds] : packIds;
    if (typeof Image === 'undefined') return Promise.resolve();
    const tasks: Promise<void>[] = [];
    for (const packId of ids) {
      const existing = this.preloadPromises.get(packId);
      if (existing) {
        tasks.push(existing);
        continue;
      }
      const pack = this.packs.get(packId);
      if (!pack) continue;
      const p = Promise.all(
        Object.entries(pack.sprites).map(([spriteId, def]) => {
          if (def.kind !== 'image') return Promise.resolve();
          const img = this.getImage(packId, spriteId);
          if (!img) return Promise.resolve();
          return img.complete ? Promise.resolve() : img.decode().catch(() => {});
        }),
      ).then(() => {});
      this.preloadPromises.set(packId, p);
      tasks.push(p);
    }
    return Promise.all(tasks).then(() => {});
  }

  getPixelCanvas(
    packId: string,
    spriteId: string,
    opts: { color?: string; frame?: number; flipX?: boolean; part?: 'left' | 'mid' | 'right' } = {},
  ): HTMLCanvasElement | null {
    if (typeof document === 'undefined') return null;
    const def = this.getDef(packId, spriteId);
    if (!def || def.kind === 'image') return null;

    let grid: readonly string[];
    let frameIndex = 0;
    if (def.kind === 'pixel') {
      grid = def.pixels;
    } else if (def.kind === 'pixelAnim') {
      const count = def.frames.length;
      if (!count) return null;
      frameIndex = ((opts.frame ?? 0) % count + count) % count;
      grid = def.frames[frameIndex];
    } else {
      const part = opts.part ?? 'mid';
      grid = def[part];
    }

    const col = resolveColor(opts.color);
    const flip = !!opts.flipX;
    const partKey = def.kind === 'pixelTile3' ? opts.part ?? 'mid' : '';
    const cacheKey = `${packId}:${spriteId}:${col}:${frameIndex}:${flip ? 1 : 0}:${partKey}`;
    let cached = this.pixelCanvases.get(cacheKey);
    if (!cached) {
      const pal = expandPixelPalette(def.palette, col);
      const compiled = compilePixelGrid(grid, pal, flip);
      if (!compiled) return null;
      cached = compiled;
      this.pixelCanvases.set(cacheKey, cached);
    }
    return cached;
  }

  prepareCanvas(canvas: HTMLCanvasElement, styleId: ArtStyleId): CanvasRenderingContext2D | null {
    const spec = getArtStyle(styleId);
    const [w, h] = spec.baseResolution;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = spec.smoothing;
    return ctx;
  }

  draw(ctx: CanvasRenderingContext2D, packId: string, spriteId: string, x: number, y: number, opts: DrawSpriteOpts = {}): boolean {
    const pack = this.packs.get(packId);
    const def = pack?.sprites[spriteId];
    if (!pack || !def) return false;

    const style = getArtStyle(pack.style);
    ctx.imageSmoothingEnabled = style.smoothing;

    let source: HTMLImageElement | HTMLCanvasElement | null = null;
    let natW = 0;
    let natH = 0;

    if (def.kind === 'image') {
      const img = this.getImage(packId, spriteId);
      if (!img || !img.complete || img.naturalWidth === 0) return false;
      source = img;
      natW = img.naturalWidth;
      natH = img.naturalHeight;
    } else {
      let frame = opts.frame ?? 0;
      if (def.kind === 'pixelAnim' && opts.frame === undefined && opts.time !== undefined) {
        frame = Math.floor(Math.max(0, opts.time) * def.fps) % Math.max(1, def.frames.length);
      }
      const c = this.getPixelCanvas(packId, spriteId, { color: opts.color, frame, flipX: opts.flipX });
      if (!c) return false;
      source = c;
      natW = c.width;
      natH = c.height;
    }

    const scale = opts.scale ?? 1;
    const w = opts.w ?? natW * scale;
    const h = opts.h ?? natH * scale;
    const anchor = opts.anchor ?? 'center';
    const rawX = anchor === 'center' || anchor === 'bottom' ? x - w / 2 : x;
    const rawY = anchor === 'center' ? y - h / 2 : anchor === 'bottom' ? y - h : y;
    const dx = style.smoothing ? rawX : Math.round(rawX);
    const dy = style.smoothing ? rawY : Math.round(rawY);
    const dw = style.smoothing ? w : Math.round(w);
    const dh = style.smoothing ? h : Math.round(h);

    const needFlipX = def.kind === 'image' && !!opts.flipX;
    const needFlipY = !!opts.flipY;
    const hasAlpha = opts.alpha !== undefined && opts.alpha !== 1;

    if (!needFlipX && !needFlipY && !hasAlpha) {
      ctx.drawImage(source, dx, dy, dw, dh);
      return true;
    }

    ctx.save();
    if (hasAlpha) ctx.globalAlpha = opts.alpha!;
    if (needFlipX || needFlipY) {
      ctx.translate(dx + (needFlipX ? dw : 0), dy + (needFlipY ? dh : 0));
      ctx.scale(needFlipX ? -1 : 1, needFlipY ? -1 : 1);
      ctx.drawImage(source, 0, 0, dw, dh);
    } else {
      ctx.drawImage(source, dx, dy, dw, dh);
    }
    ctx.restore();
    return true;
  }

  /**
   * Draws a 3-slice (`pixelTile3`) sprite horizontally across `[x, x + width)` at top-left `y`.
   */
  drawTileRow(
    ctx: CanvasRenderingContext2D,
    packId: string,
    spriteId: string,
    x: number,
    y: number,
    width: number,
    opts: { color?: string; scale?: number } = {},
  ): boolean {
    const pack = this.packs.get(packId);
    const def = pack?.sprites[spriteId];
    if (!pack || !def || def.kind !== 'pixelTile3') return false;

    const style = getArtStyle(pack.style);
    ctx.imageSmoothingEnabled = style.smoothing;

    const left = this.getPixelCanvas(packId, spriteId, { color: opts.color, part: 'left' });
    const mid = this.getPixelCanvas(packId, spriteId, { color: opts.color, part: 'mid' });
    const right = this.getPixelCanvas(packId, spriteId, { color: opts.color, part: 'right' });
    if (!left || !mid || !right) return false;

    const scale = opts.scale ?? 1;
    const ix = Math.round(x);
    const iy = Math.round(y);
    const iw = Math.max(1, Math.round(width));
    const lw = Math.round(left.width * scale);
    const rw = Math.round(right.width * scale);
    const mw = Math.max(1, Math.round(mid.width * scale));
    const lh = Math.round(left.height * scale);
    const mh = Math.round(mid.height * scale);
    const rh = Math.round(right.height * scale);

    if (iw <= lw + rw) {
      const half = Math.floor(iw / 2);
      ctx.drawImage(left, 0, 0, Math.min(left.width, half), left.height, ix, iy, half, lh);
      const rem = iw - half;
      ctx.drawImage(right, Math.max(0, right.width - rem), 0, Math.min(right.width, rem), right.height, ix + half, iy, rem, rh);
      return true;
    }

    ctx.drawImage(left, ix, iy, lw, lh);
    const midEnd = ix + iw - rw;
    for (let cx = ix + lw; cx < midEnd; cx += mw) {
      const drawW = Math.min(mw, midEnd - cx);
      const srcW = Math.max(1, Math.round((drawW / mw) * mid.width));
      ctx.drawImage(mid, 0, 0, srcW, mid.height, cx, iy, drawW, mh);
    }
    ctx.drawImage(right, midEnd, iy, rw, rh);
    return true;
  }

  spriteDataUrl(packId: string, spriteId: string, opts: { color?: string; frame?: number; scale?: number } = {}): string | null {
    const def = this.getDef(packId, spriteId);
    if (!def) return null;
    if (def.kind === 'image') return def.url;
    if (typeof document === 'undefined') return null;

    const col = resolveColor(opts.color);
    const frame = opts.frame ?? 0;
    const scale = Math.max(1, Math.round(opts.scale ?? 1));
    const key = `${packId}:${spriteId}:${col}:${frame}:${scale}`;
    const cached = this.dataUrls.get(key);
    if (cached) return cached;

    if (def.kind === 'pixelTile3') {
      const l = this.getPixelCanvas(packId, spriteId, { color: col, part: 'left' });
      const m = this.getPixelCanvas(packId, spriteId, { color: col, part: 'mid' });
      const r = this.getPixelCanvas(packId, spriteId, { color: col, part: 'right' });
      if (!l || !m || !r) return null;
      const w = (l.width + m.width * 2 + r.width) * scale;
      const h = Math.max(l.height, m.height, r.height) * scale;
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d')!;
      ctx.imageSmoothingEnabled = false;
      this.drawTileRow(ctx, packId, spriteId, 0, 0, w, { color: col, scale });
      const url = c.toDataURL();
      this.dataUrls.set(key, url);
      return url;
    }

    const src = this.getPixelCanvas(packId, spriteId, { color: col, frame });
    if (!src) return null;
    const c = document.createElement('canvas');
    c.width = src.width * scale;
    c.height = src.height * scale;
    const ctx = c.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(src, 0, 0, c.width, c.height);
    const url = c.toDataURL();
    this.dataUrls.set(key, url);
    return url;
  }

  clearCache(): void {
    this.images.clear();
    this.preloadPromises.clear();
    this.pixelCanvases.clear();
    this.dataUrls.clear();
  }
}

export const resources = new ResourceManager();
