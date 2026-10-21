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
import { SwapGame } from './swap/SwapGame';
import { TanksGame } from './tanks/TanksGame';
import { MushroomGame } from './mushroom/MushroomGame';
import { PushyGame } from './pushy/PushyGame';
import { GalleryGame } from './gallery/GalleryGame';
import { CookbookGame } from './cookbook/CookbookGame';
import { TilesGame } from './tiles/TilesGame';
import { RopeGame } from './rope/RopeGame';
import { BlastGame } from './blast/BlastGame';
import { FlagsGame } from './flags/FlagsGame';
import { PotatoGame } from './potato/PotatoGame';
import { FloesGame } from './floes/FloesGame';
import { ChairsGame } from './chairs/ChairsGame';
import { ChickensGame } from './chickens/ChickensGame';
import { CrownGame } from './crown/CrownGame';
import { CoinsGame } from './coins/CoinsGame';
import { MolesGame } from './moles/MolesGame';
import { SheepGame } from './sheep/SheepGame';
import { ClockGame } from './clock/ClockGame';
import { BoulesGame } from './boules/BoulesGame';
import { BellsGame } from './bells/BellsGame';
import { QuipGame } from './quip/QuipGame';
import { SpyGame } from './spy/SpyGame';
import { HerdGame } from './herd/HerdGame';
import { WaveGame } from './wave/WaveGame';
import { TelephoneGame } from './telephone/TelephoneGame';
import { SmokeGame } from './smoke/SmokeGame';
import { PremiumGame } from './premium/PremiumGame';
import { CastleGame } from './castle/CastleGame';

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
    case 'swap':
      return new SwapGame(host, ids);
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
    case 'rope':
      return new RopeGame(host, ids);
    case 'blast':
      return new BlastGame(host, ids);
    case 'flags':
      return new FlagsGame(host, ids);
    case 'potato':
      return new PotatoGame(host, ids);
    case 'floes':
      return new FloesGame(host, ids);
    case 'chairs':
      return new ChairsGame(host, ids);
    case 'chickens':
      return new ChickensGame(host, ids);
    case 'crown':
      return new CrownGame(host, ids);
    case 'coins':
      return new CoinsGame(host, ids);
    case 'moles':
      return new MolesGame(host, ids);
    case 'sheep':
      return new SheepGame(host, ids);
    case 'clock':
      return new ClockGame(host, ids);
    case 'boules':
      return new BoulesGame(host, ids);
    case 'bells':
      return new BellsGame(host, ids);
    case 'quip':
      return new QuipGame(host, ids);
    case 'spy':
      return new SpyGame(host, ids);
    case 'herd':
      return new HerdGame(host, ids);
    case 'wave':
      return new WaveGame(host, ids);
    case 'telephone':
      return new TelephoneGame(host, ids);
    case 'smoke':
      return new SmokeGame(host, ids);
    case 'castle':
      return new CastleGame(host, ids);
    case 'premium':
      return new PremiumGame(host, ids);
  }
}
