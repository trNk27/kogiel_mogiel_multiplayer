/**
 * Lobby Baja feeding minigame timing, bone currency, and stackable lobby-only Pierogi cosmetics.
 * Pure & Node-safe so host, phone, and unit tests can share the same rules.
 */

export const BAJA_VISIT_MIN_MS = 20_000;
export const BAJA_VISIT_MAX_MS = 40_000;
export const BAJA_LEAP_MS = 1_050;
export const BAJA_PHONE_TIMEOUT_MS = 40_000;
export const BAJA_POPUP_MS = 5_500;
export const BAJA_FEED_ITEMS = 5;

export type CosmeticId =
  | 'bowtie'
  | 'mustache'
  | 'flower'
  | 'shades'
  | 'chef'
  | 'monocle'
  | 'tophat'
  | 'halo'
  | 'crown';

export interface CosmeticItem {
  id: CosmeticId;
  name: string;
  price: number;
  emoji: string;
}

export const COSMETICS: readonly CosmeticItem[] = [
  { id: 'bowtie', name: 'Bowtie', price: 1, emoji: '🎀' },
  { id: 'mustache', name: 'Mustache', price: 1, emoji: '🥸' },
  { id: 'flower', name: 'Folk Flower', price: 1, emoji: '🌸' },
  { id: 'shades', name: 'Sunglasses', price: 2, emoji: '🕶️' },
  { id: 'chef', name: 'Chef Hat', price: 2, emoji: '👨‍🍳' },
  { id: 'monocle', name: 'Monocle', price: 2, emoji: '🧐' },
  { id: 'tophat', name: 'Top Hat', price: 3, emoji: '🎩' },
  { id: 'halo', name: 'Halo', price: 3, emoji: '😇' },
  { id: 'crown', name: 'Tiny Crown', price: 4, emoji: '👑' },
];

const COSMETIC_SET = new Set<string>(COSMETICS.map((c) => c.id));

export function isCosmeticId(x: unknown): x is CosmeticId {
  return typeof x === 'string' && COSMETIC_SET.has(x);
}

export function cosmeticInfo(id: CosmeticId): CosmeticItem {
  return COSMETICS.find((c) => c.id === id) ?? COSMETICS[0];
}

export function clampFedCount(raw: unknown): number {
  const n = typeof raw === 'number' && Number.isFinite(raw) ? Math.round(raw) : 0;
  return Math.max(0, Math.min(BAJA_FEED_ITEMS, n));
}

export function nextBajaDelayMs(rnd = Math.random): number {
  return BAJA_VISIT_MIN_MS + Math.floor(rnd() * (BAJA_VISIT_MAX_MS - BAJA_VISIT_MIN_MS + 1));
}

export function eligibleBajaTargets(
  players: readonly { id: string; connected: boolean }[],
  vipId: string | null,
): string[] {
  return players.filter((p) => p.connected && p.id !== vipId).map((p) => p.id);
}

export function pickBajaTarget(
  connectedIds: readonly string[],
  lastId: string | null,
  rnd = Math.random,
): string | null {
  if (connectedIds.length === 0) return null;
  if (connectedIds.length === 1) return connectedIds[0];
  const pool = lastId ? connectedIds.filter((id) => id !== lastId) : connectedIds;
  const list = pool.length ? pool : connectedIds;
  return list[Math.floor(rnd() * list.length)] ?? list[0];
}

export interface CosmeticWallet {
  bones: number;
  owned: CosmeticId[];
  equipped: CosmeticId[];
}

export function buyCosmeticState(state: CosmeticWallet, id: CosmeticId): CosmeticWallet | null {
  if (state.owned.includes(id)) return null;
  const item = cosmeticInfo(id);
  if (state.bones < item.price) return null;
  return {
    bones: state.bones - item.price,
    owned: [...state.owned, id],
    equipped: state.equipped.includes(id) ? [...state.equipped] : [...state.equipped, id],
  };
}

export function toggleCosmeticState(
  state: Pick<CosmeticWallet, 'owned' | 'equipped'>,
  id: CosmeticId,
): CosmeticId[] | null {
  if (!state.owned.includes(id)) return null;
  if (state.equipped.includes(id)) {
    return state.equipped.filter((x) => x !== id);
  }
  return [...state.equipped, id];
}
