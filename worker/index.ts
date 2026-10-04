import { CODE_ALPHABET, CODE_LENGTH, CODE_RE, type CreateRoomResponse, type RoomInfoResponse } from '../shared/protocol';
import { RoomDO } from './room';

export { RoomDO };

export interface Env {
  ROOMS: DurableObjectNamespace<RoomDO>;
  ASSETS: Fetcher;
}

/** Codes we'd rather not show on a family TV. */
const BLOCKED = new Set(['ANUS', 'ARSE', 'CUNT', 'DICK', 'FUCK', 'JIZZ', 'NAZI', 'PISS', 'SHAT', 'SHIT', 'SLUT', 'TWAT', 'WANK', 'DAMN', 'CRAP', 'PUKE', 'KKKK']);

function randomCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  let code = '';
  for (const b of bytes) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return code;
}

function randomKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}

function room(env: Env, code: string) {
  return env.ROOMS.get(env.ROOMS.idFromName(code));
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Create a room: pick a free code and claim it with a secret host key.
    if (path === '/api/rooms' && request.method === 'POST') {
      const hostKey = randomKey();
      for (let attempt = 0; attempt < 12; attempt++) {
        const code = randomCode();
        if (BLOCKED.has(code)) continue;
        if (await room(env, code).claim(code, hostKey)) {
          return json({ code, hostKey } satisfies CreateRoomResponse);
        }
      }
      return json({ error: 'Could not allocate a room, please try again.' }, 503);
    }

    // Does a room exist? (used by the join page before asking for a colour)
    const info = path.match(/^\/api\/rooms\/([A-Za-z]{4})$/);
    if (info && request.method === 'GET') {
      const code = info[1].toUpperCase();
      const exists = CODE_RE.test(code) && (await room(env, code).exists());
      return json({ exists } satisfies RoomInfoResponse);
    }

    // WebSocket into a room: /ws/ABCD?role=host&key=… or /ws/ABCD?role=player&id=…
    const ws = path.match(/^\/ws\/([A-Za-z]{4})$/);
    if (ws) {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('Expected a WebSocket upgrade', { status: 426 });
      }
      const code = ws[1].toUpperCase();
      if (!CODE_RE.test(code)) return new Response('Bad room code', { status: 400 });
      return room(env, code).fetch(request);
    }

    if (path.startsWith('/api/') || path.startsWith('/ws/')) {
      return json({ error: 'Not found' }, 404);
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
