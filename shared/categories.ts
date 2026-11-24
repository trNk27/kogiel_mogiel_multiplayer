/**
 * Game categories for the lobby, so the VIP isn't scrolling through 50 games. The TV and the phone both
 * show one category at a time. A game that isn't listed here (a brand-new one) lands in "New".
 *
 * Adding a game: put its id in the category that fits, in the order you want it shown.
 */
import type { GameId, GameInfo } from './protocol';

export type CategoryId = 'laughs' | 'draw' | 'brains' | 'together' | 'battle' | 'hands' | 'race' | 'nights' | 'new';

export interface Category {
  id: CategoryId;
  emoji: string;
  title: string;
  /** One line under the title on the TV. */
  blurb: string;
}

export const CATEGORIES: readonly Category[] = [
  { id: 'laughs', emoji: '💬', title: 'Jokes & words', blurb: 'Type on your phone, read it out, vote for the funniest.' },
  { id: 'draw', emoji: '✏️', title: 'Drawing', blurb: 'Doodle on your phone. Being bad at it is the fun part.' },
  { id: 'brains', emoji: '🧠', title: 'Guess & remember', blurb: 'Quizzes, guesses and memory. Think fast.' },
  { id: 'together', emoji: '🤝', title: 'Team up', blurb: 'Everyone on the same side. Win or lose together.' },
  { id: 'battle', emoji: '⚔️', title: 'Last one standing', blurb: 'Push, dodge and blow each other up. One winner.' },
  { id: 'hands', emoji: '🎯', title: 'Quick hands', blurb: 'Grab, catch, whack and aim. Highest score wins.' },
  { id: 'race', emoji: '🏁', title: 'Race & climb', blurb: 'Steer, drift and jump to the finish.' },
  { id: 'nights', emoji: '🎉', title: 'Big nights out', blurb: 'Long, silly adventures for the whole group.' },
  { id: 'new', emoji: '✨', title: 'New', blurb: 'Fresh games that haven’t got a shelf yet.' },
];

/** Which games go where, best first. Ids are plain strings so games still in a pull request can be listed. */
const SHELVES: Record<Exclude<CategoryId, 'new'>, readonly string[]> = {
  laughs: ['quip', 'kuba', 'gossip', 'dictionary', 'spy', 'herd', 'split', 'survey'],
  draw: ['bazgroly', 'telephone', 'toty'],
  brains: ['quiz', 'ballpark', 'wave', 'swap', 'parade', 'bells', 'footsteps', 'clock'],
  together: ['ogien', 'baja', 'kitchen', 'castle'],
  battle: ['tanks', 'pushy', 'blast', 'potato', 'chairs', 'floes', 'crown', 'tiles', 'mushroom', 'flags'],
  hands: ['fork', 'gallery', 'moles', 'coins', 'chickens', 'sheep', 'cows', 'cookbook', 'rope', 'pedal', 'boules', 'marina', 'smoke'],
  race: ['premium', 'rally', 'trails', 'tower'],
  nights: ['wesele', 'markt'],
};

export function categoryOf(id: GameId | string): CategoryId {
  for (const [cat, ids] of Object.entries(SHELVES)) if (ids.includes(id)) return cat as CategoryId;
  return 'new';
}

export function category(id: CategoryId): Category {
  return CATEGORIES.find((c) => c.id === id)!;
}

/** The categories that have games in this list, each with its games in shelf order. */
export function shelves(games: readonly GameInfo[]): { cat: Category; games: GameInfo[] }[] {
  return CATEGORIES.map((cat) => {
    const list = games.filter((g) => categoryOf(g.id) === cat.id);
    const order = cat.id === 'new' ? [] : SHELVES[cat.id];
    list.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    return { cat, games: list };
  }).filter((s) => s.games.length > 0);
}
