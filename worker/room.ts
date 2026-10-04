import { DurableObject } from 'cloudflare:workers';
import {
  CLOSE,
  PING,
  PLAYER_ID_RE,
  PONG,
  ROOM_IDLE_MS,
  type HostToServer,
  type PhoneMsg,
  type ServerToHost,
  type ServerToPhone,
} from '../shared/protocol';
import type { Env } from './index';

type Attachment = { role: 'host' } | { role: 'player'; id: string };

const ALARM_EVERY_MS = 10 * 60_000;
const PERSIST_ACTIVITY_EVERY_MS = 5 * 60_000;
const MAX_PHONE_MESSAGE = 2048;
const MAX_HOST_MESSAGE = 64 * 1024;
const OPEN = 1;

/**
 * One Durable Object per room. It is a thin relay between the TV (host) and the phones.
 *
 * Uses the WebSocket Hibernation API: everything needed to route a message lives in the
 * socket's tags/attachment, so the object can be evicted from memory between messages
 * while the sockets stay connected (and cost nothing).
 */
export class RoomDO extends DurableObject<Env> {
  private code: string | null = null;
  private hostKey: string | null = null;
  private lastActivity = Date.now();
  private lastPersisted = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // Keep-alive pings are answered by the runtime without waking the object.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
    ctx.blockConcurrencyWhile(async () => {
      this.code = (await ctx.storage.get<string>('code')) ?? null;
      this.hostKey = (await ctx.storage.get<string>('hostKey')) ?? null;
      const last = await ctx.storage.get<number>('last');
      // `last` is only persisted every few minutes, so assume activity continued until the
      // next write would have happened. Errs on the side of keeping rooms alive.
      if (last) this.lastActivity = Math.min(Date.now(), last + PERSIST_ACTIVITY_EVERY_MS);
      this.lastPersisted = last ?? 0;
    });
  }

  // ---- RPC ------------------------------------------------------------------

  /** Claim this room for a new host. Fails if it is still in use. */
  async claim(code: string, hostKey: string): Promise<boolean> {
    if (this.hostKey && !this.isIdle()) return false;
    for (const ws of this.ctx.getWebSockets()) this.safeClose(ws, CLOSE.expired, 'Room reset');
    await this.ctx.storage.deleteAll();
    this.code = code;
    this.hostKey = hostKey;
    this.lastActivity = Date.now();
    await this.ctx.storage.put({ code, hostKey, last: this.lastActivity });
    this.lastPersisted = this.lastActivity;
    await this.ctx.storage.setAlarm(Date.now() + ALARM_EVERY_MS);
    return true;
  }

  async exists(): Promise<boolean> {
    return !!this.hostKey && !this.isIdle();
  }

  // ---- WebSocket upgrade ----------------------------------------------------

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const role = url.searchParams.get('role');
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];

    if (role === 'host') {
      if (!this.hostKey || url.searchParams.get('key') !== this.hostKey) {
        return new Response('Forbidden', { status: 403 });
      }
      // Only one TV at a time: a new host connection replaces the old one.
      for (const old of this.ctx.getWebSockets('host')) this.safeClose(old, CLOSE.replaced, 'Replaced');
      this.ctx.acceptWebSocket(server, ['host']);
      server.serializeAttachment({ role: 'host' } satisfies Attachment);
      this.touch();
      this.sendTo(server, { t: 'room', code: this.code ?? '', players: this.connectedPlayerIds() } satisfies ServerToHost);
      this.broadcastPlayers({ t: 'host', online: true });
      return new Response(null, { status: 101, webSocket: client });
    }

    if (role === 'player') {
      const id = url.searchParams.get('id') ?? '';
      this.ctx.acceptWebSocket(server, ['player', `p:${id}`]);
      if (!PLAYER_ID_RE.test(id)) {
        this.sendTo(server, { t: 'err', code: 'bad_request' } satisfies ServerToPhone);
        this.safeClose(server, CLOSE.forbidden, 'Bad player id');
        return new Response(null, { status: 101, webSocket: client });
      }
      if (!this.hostKey || this.isIdle()) {
        this.sendTo(server, { t: 'err', code: 'no_room' } satisfies ServerToPhone);
        this.safeClose(server, CLOSE.noRoom, 'No such room');
        return new Response(null, { status: 101, webSocket: client });
      }
      // A phone that reconnects replaces its own stale socket (e.g. after a screen lock).
      for (const old of this.ctx.getWebSockets(`p:${id}`)) {
        if (old !== server) this.safeClose(old, CLOSE.replaced, 'Replaced');
      }
      server.serializeAttachment({ role: 'player', id } satisfies Attachment);
      this.touch();
      this.sendTo(server, { t: 'host', online: this.hostSocket() !== null } satisfies ServerToPhone);
      this.sendHost({ t: 'conn', id });
      return new Response(null, { status: 101, webSocket: client });
    }

    return new Response('Unknown role', { status: 400 });
  }

  // ---- Hibernation handlers -------------------------------------------------

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return;
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att) return;
    this.touch();

    if (att.role === 'player') {
      if (message.length > MAX_PHONE_MESSAGE) return;
      let m: PhoneMsg;
      try {
        m = JSON.parse(message);
      } catch {
        return;
      }
      if (!m || typeof m !== 'object' || typeof (m as { t?: unknown }).t !== 'string') return;
      this.sendHost({ t: 'msg', id: att.id, m });
      return;
    }

    if (message.length > MAX_HOST_MESSAGE) return;
    let m: HostToServer;
    try {
      m = JSON.parse(message);
    } catch {
      return;
    }
    switch (m.t) {
      case 'to': {
        const payload = JSON.stringify(m.m);
        for (const id of m.ids) for (const s of this.ctx.getWebSockets(`p:${id}`)) this.sendRaw(s, payload);
        break;
      }
      case 'all': {
        const payload = JSON.stringify(m.m);
        for (const s of this.ctx.getWebSockets('player')) this.sendRaw(s, payload);
        break;
      }
      case 'drop':
        for (const s of this.ctx.getWebSockets(`p:${m.id}`)) this.safeClose(s, CLOSE.kicked, 'Removed by the VIP');
        break;
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    this.safeClose(ws, code === 1005 || code === 1006 ? 1000 : code, reason);
    this.onGone(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.onGone(ws);
  }

  async alarm(): Promise<void> {
    if (this.hostKey && this.isIdle()) {
      for (const ws of this.ctx.getWebSockets()) this.safeClose(ws, CLOSE.expired, 'Room expired');
      await this.ctx.storage.deleteAll();
      this.hostKey = null;
      this.code = null;
      return; // no further alarm: the room is gone
    }
    if (this.hostKey) await this.ctx.storage.setAlarm(Date.now() + ALARM_EVERY_MS);
  }

  // ---- Helpers --------------------------------------------------------------

  private onGone(ws: WebSocket) {
    const att = ws.deserializeAttachment() as Attachment | null;
    if (!att) return;
    if (att.role === 'player') {
      const stillThere = this.ctx.getWebSockets(`p:${att.id}`).some((s) => s !== ws && s.readyState === OPEN);
      if (!stillThere) this.sendHost({ t: 'disc', id: att.id });
    } else if (this.hostSocket(ws) === null) {
      this.broadcastPlayers({ t: 'host', online: false });
    }
  }

  private isIdle(): boolean {
    return Date.now() - this.lastActivity > ROOM_IDLE_MS;
  }

  private touch() {
    const now = Date.now();
    this.lastActivity = now;
    if (now - this.lastPersisted > PERSIST_ACTIVITY_EVERY_MS) {
      this.lastPersisted = now;
      void this.ctx.storage.put('last', now);
    }
  }

  private hostSocket(except?: WebSocket): WebSocket | null {
    return this.ctx.getWebSockets('host').find((s) => s !== except && s.readyState === OPEN) ?? null;
  }

  private connectedPlayerIds(): string[] {
    const ids = new Set<string>();
    for (const s of this.ctx.getWebSockets('player')) {
      const att = s.deserializeAttachment() as Attachment | null;
      if (att?.role === 'player' && s.readyState === OPEN) ids.add(att.id);
    }
    return [...ids];
  }

  private sendHost(msg: ServerToHost) {
    const host = this.hostSocket();
    if (host) this.sendTo(host, msg);
  }

  private broadcastPlayers(msg: ServerToPhone) {
    const payload = JSON.stringify(msg);
    for (const s of this.ctx.getWebSockets('player')) this.sendRaw(s, payload);
  }

  private sendTo(ws: WebSocket, msg: unknown) {
    this.sendRaw(ws, JSON.stringify(msg));
  }

  private sendRaw(ws: WebSocket, payload: string) {
    try {
      ws.send(payload);
    } catch {
      /* socket already closing */
    }
  }

  private safeClose(ws: WebSocket, code: number, reason: string) {
    try {
      ws.close(code, reason);
    } catch {
      /* already closed */
    }
  }
}
