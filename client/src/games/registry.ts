import type { GameId } from '../../../shared/protocol';
import type { Game, GameHost } from './types';
import { QuizGame } from './quiz/QuizGame';
import { TrailsGame } from './trails/TrailsGame';
import { BallparkGame } from './ballpark/BallparkGame';
import { KitchenGame } from './kitchen/KitchenGame';
import { TotyGame } from './toty/TotyGame';
import { RallyGame } from './rally/RallyGame';
import { PedalGame } from './pedal/PedalGame';
import { ForkGame } from './fork/ForkGame';
import { ParadeGame } from './parade/ParadeGame';

export function createGame(id: GameId, host: GameHost, ids: string[]): Game {
  switch (id) {
    case 'quiz':
      return new QuizGame(host, ids);
    case 'trails':
      return new TrailsGame(host, ids);
    case 'ballpark':
      return new BallparkGame(host, ids);
    case 'kitchen':
      return new KitchenGame(host, ids);
    case 'rally':
      return new RallyGame(host, ids);
    case 'toty':
      return new TotyGame(host, ids);
    case 'pedal':
      return new PedalGame(host, ids);
    case 'fork':
      return new ForkGame(host, ids);
    case 'parade':
      return new ParadeGame(host, ids);
  }
}
