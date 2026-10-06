import type { GameId } from '../../../shared/protocol';
import type { Game, GameHost } from './types';
import { QuizGame } from './quiz/QuizGame';
import { TrailsGame } from './trails/TrailsGame';
import { BallparkGame } from './ballpark/BallparkGame';
import { KitchenGame } from './kitchen/KitchenGame';
import { TotyGame } from './toty/TotyGame';
import { RallyGame } from './rally/RallyGame';
import { BazgrolyGame } from './bazgroly/BazgrolyGame';

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
    case 'bazgroly':
      return new BazgrolyGame(host, ids);
  }
}
