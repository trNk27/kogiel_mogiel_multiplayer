/** STUB – replaced by the real game. */
import type { PhoneMsg, PhoneView } from '../../../../shared/protocol';
import type { Game, GameHost } from '../types';

export class MushroomGame implements Game {
  readonly id = 'mushroom' as const;
  constructor(
    private host: GameHost,
    public ids: string[],
  ) {}
  start() {
    window.setTimeout(() => this.host.finish(Object.fromEntries(this.ids.map((id) => [id, 0]))), 1000);
  }
  onMessage(_id: string, _m: PhoneMsg) {}
  viewFor(): PhoneView {
    return { v: 'pad', game: 'mushroom', phase: 'play', round: 1, rounds: 1, buttons: [{ label: 'A' }, { label: 'B' }], score: 0 };
  }
  render() {
    return <div class="screen" />;
  }
  dispose() {}
}
