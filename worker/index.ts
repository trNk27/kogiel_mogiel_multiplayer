import { CODE_ALPHABET, CODE_LENGTH, CODE_RE, type CreateRoomResponse, type IceServersResponse, type RoomInfoResponse } from '../shared/protocol';
import { RoomDO } from './room';

export { RoomDO };

export interface Env {
  ROOMS: DurableObjectNamespace<RoomDO>;
  ASSETS: Fetcher;
  /**
   * Optional Cloudflare TURN key (Realtime → TURN Server in the dashboard). Without it, second
   * screens connect with STUN only, which works on most home networks but not behind every NAT.
   */
  TURN_KEY_ID?: string;
  TURN_KEY_API_TOKEN?: string;
}

const STUN_ONLY: IceServersResponse = {
  iceServers: [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }],
};

/** ICE servers for a second screen's video: Cloudflare TURN when a key is set, STUN otherwise. */
async function iceServers(env: Env): Promise<IceServersResponse> {
  if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return STUN_ONLY;
  try {
    const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ ttl: 12 * 3600 }),
    });
    if (!res.ok) return STUN_ONLY;
    const data = (await res.json()) as { iceServers?: IceServersResponse['iceServers'] | IceServersResponse['iceServers'][number] };
    const list = Array.isArray(data.iceServers) ? data.iceServers : data.iceServers ? [data.iceServers] : [];
    // Browsers time out on port 53, which Cloudflare also lists: leave it out.
    const servers = list
      .map((s) => ({ ...s, urls: (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => !/:53(\?|$)/.test(u)) }))
      .filter((s) => s.urls.length > 0);
    return servers.length ? { iceServers: servers } : STUN_ONLY;
  } catch {
    return STUN_ONLY;
  }
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

    // STUN/TURN servers for the second screens' video.
    if (path === '/api/ice' && request.method === 'GET') {
      return json(await iceServers(env));
    }

    // WebSocket into a room: /ws/ABCD?role=host&key=…, ?role=player&id=… or ?role=screen&id=…
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
