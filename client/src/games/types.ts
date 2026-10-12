import type { JSX } from 'preact';
import type { GameId, HostToPhone, LobbyOptions, PhoneMsg, PhoneView } from '../../../shared/protocol';
import type { Player } from '../host/controller';

/** What the host offers a running game. */
export interface GameHost {
  player(id: string): Player | undefined;
  /** Push current views to one participant, or all of them. Unchanged views are not re-sent. */
  refresh(id?: string): void;
  buzz(id: string, pattern: number[]): void;
  /** Send a message straight to some phones (for data that doesn't belong in a view, like photos). */
  message(ids: string[], m: HostToPhone): void;
  /** Ask the TV to re-render. */
  changed(): void;
  /** End the game with final scores. Co-op games also pass the team result. */
  finish(scores: Record<string, number>, coop?: CoopResult): void;
  readonly options: LobbyOptions;
  /** Part of a tournament: play the short version (fewer rounds, lower targets). */
  readonly short: boolean;
  /** No TV in this room: phones show the game themselves, and `render()` is never shown. */
  readonly noTv: boolean;
  /** The VIP's player id (games with their own menus let the VIP drive them). */
  vipId?(): string | null;
}

export interface CoopLevel {
  name: string;
  stars: number;
  score: number;
  served: number;
  missed: number;
}

export interface CoopResult {
  score: number;
  /** 0–3. Every player earns this many party points. */
  stars: number;
  served: number;
  missed: number;
  /** Per-level results, for games played in levels. */
  levels?: CoopLevel[];
  /**
   * How the results screen words it, for co-op games other than Pierogi Panic: the line under the stars,
   * the three numbers, what the crew's own scores count (one, many) and what the team score is called.
   */
  look?: { line: string; stats: { v: number; label: string }[]; unit: [string, string]; scoreUnit: string };
}

export interface Game {
  readonly id: GameId;
  /** Participant ids, in join order. */
  readonly ids: string[];
  start(): void;
  onMessage(id: string, m: PhoneMsg): void;
  onConnection?(id: string, connected: boolean): void;
  /** A participant was removed from the room (kicked or timed out). */
  onRemoved?(id: string): void;
  viewFor(id: string): PhoneView;
  render(): JSX.Element;
  dispose(): void;
}

export type GameFactory = (host: GameHost, ids: string[]) => Game;
