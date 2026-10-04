import type { GameId } from '../../../shared/protocol';
import type { Game, GameHost } from './types';

/** Placeholder until the games land: shows a card and returns to the results screen. */
class ComingSoon implements Game {
  private timer: number | undefined;
  constructor(
    readonly id: GameId,
    private host: GameHost,
    public ids: string[],
  ) {}
  start() {
    this.timer = window.setTimeout(() => this.host.finish({}), 3000);
  }
  onMessage() {}
  viewFor() {
    return { v: 'wait' as const, title: 'Coming soon' };
  }
  render() {
    return <div class="screen intro"><h1 class="intro-title">Coming soon</h1></div>;
  }
  dispose() {
    clearTimeout(this.timer);
  }
}

export function createGame(id: GameId, host: GameHost, ids: string[]): Game {
  return new ComingSoon(id, host, ids);
}
