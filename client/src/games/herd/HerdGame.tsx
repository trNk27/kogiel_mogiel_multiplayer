import type { PhoneMsg, PhoneView } from '../../../../shared/protocol';
import type { Game, GameHost } from '../types';

/** Placeholder: replaced by the real game. */
export class HerdGame implements Game {
  readonly id = 'herd' as const;
  constructor(
    private host: GameHost,
    public ids: string[],
  ) {}
  start() {
    this.host.refresh();
  }
  onMessage(_id: string, _m: PhoneMsg) {}
  viewFor(_id: string): PhoneView {
    return { v: 'wait', title: 'Coming soon' };
  }
  render() {
    return <div class="screen" />;
  }
  dispose() {}
}
