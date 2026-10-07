import type { GameId } from '../../../shared/protocol';
import type { Game, GameHost } from './types';
import { QuizGame } from './quiz/QuizGame';
import { TrailsGame } from './trails/TrailsGame';
import { BallparkGame } from './ballpark/BallparkGame';
import { KitchenGame } from './kitchen/KitchenGame';
import { TotyGame } from './toty/TotyGame';
import { RallyGame } from './rally/RallyGame';
import { BazgrolyGame } from './bazgroly/BazgrolyGame';
import { PedalGame } from './pedal/PedalGame';
import { ForkGame } from './fork/ForkGame';
import { ParadeGame } from './parade/ParadeGame';
import { TanksGame } from './tanks/TanksGame';
import { MushroomGame } from './mushroom/MushroomGame';
import { PushyGame } from './pushy/PushyGame';
import { GalleryGame } from './gallery/GalleryGame';
import { CookbookGame } from './cookbook/CookbookGame';
import { TilesGame } from './tiles/TilesGame';

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
    case 'pedal':
      return new PedalGame(host, ids);
    case 'fork':
      return new ForkGame(host, ids);
    case 'parade':
      return new ParadeGame(host, ids);
    case 'tanks':
      return new TanksGame(host, ids);
    case 'mushroom':
      return new MushroomGame(host, ids);
    case 'pushy':
      return new PushyGame(host, ids);
    case 'gallery':
      return new GalleryGame(host, ids);
    case 'cookbook':
      return new CookbookGame(host, ids);
    case 'tiles':
      return new TilesGame(host, ids);
  }
}
