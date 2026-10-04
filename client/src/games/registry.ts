import type { GameId } from '../../../shared/protocol';
import type { Game, GameHost } from './types';
import { QuizGame } from './quiz/QuizGame';
import { TrailsGame } from './trails/TrailsGame';
import { BallparkGame } from './ballpark/BallparkGame';

export function createGame(id: GameId, host: GameHost, ids: string[]): Game {
  switch (id) {
    case 'quiz':
      return new QuizGame(host, ids);
    case 'trails':
      return new TrailsGame(host, ids);
    case 'ballpark':
      return new BallparkGame(host, ids);
  }
}
