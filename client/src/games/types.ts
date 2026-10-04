import type { JSX } from 'preact';
import type { GameId, LobbyOptions, PhoneMsg, PhoneView } from '../../../shared/protocol';
import type { Player } from '../host/controller';

/** What the host offers a running game. */
export interface GameHost {
  player(id: string): Player | undefined;
  /** Push current views to one participant, or all of them. Unchanged views are not re-sent. */
  refresh(id?: string): void;
  buzz(id: string, pattern: number[]): void;
  /** Ask the TV to re-render. */
  changed(): void;
  /** End the game with final scores. */
  finish(scores: Record<string, number>): void;
  readonly options: LobbyOptions;
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
