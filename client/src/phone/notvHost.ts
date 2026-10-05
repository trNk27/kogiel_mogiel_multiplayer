/**
 * Hosting a party without a TV: the phone that starts it runs the host (the same brain the
 * TV would run) in the background, and joins its own room as a player.
 * Loaded on demand, since it brings all the game logic with it.
 */
import { HostController, noTvSessionKey } from '../host/controller';

const params = new URLSearchParams(location.search);
const KEY = noTvSessionKey(params.get('dev'));

let controller: HostController | null = null;

/** Start a new room. Resolves to its code. */
export async function startHosting(): Promise<string> {
  controller?.stop();
  controller = new HostController({ noTv: true, sessionKey: KEY });
  await controller.create();
  const s = controller.screen;
  if (s.s !== 'lobby') throw new Error(s.s === 'landing' && s.error ? s.error : 'Could not create a room.');
  return controller.code;
}

/** Pick up the room this tab was hosting before a reload. Resolves to its code, or null. */
export async function resumeHosting(): Promise<string | null> {
  const saved = HostController.savedSession(KEY);
  if (!saved) return null;
  controller?.stop();
  controller = new HostController({ noTv: true, sessionKey: KEY });
  await controller.resume(saved);
  return controller.screen.s === 'lobby' ? controller.code : null;
}

export function stopHosting() {
  controller?.stop();
  controller = null;
}
