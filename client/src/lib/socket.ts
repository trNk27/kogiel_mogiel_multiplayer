import { CLOSE, PING, PONG } from '../../../shared/protocol';

export type SocketStatus = 'connecting' | 'open' | 'closed';

export interface SocketOptions<In> {
  url: () => string;
  onMessage: (msg: In) => void;
  onStatus?: (status: SocketStatus) => void;
  /** Called on a close the socket will not recover from (kicked, room gone, …). */
  onFatal?: (code: number) => void;
  /** Close codes after which we stop reconnecting. */
  fatalCodes?: number[];
}

const PING_EVERY_MS = 8000;
const PONG_TIMEOUT_MS = 5000;
const MAX_BACKOFF_MS = 4000;

/**
 * A WebSocket that keeps itself alive:
 *  - pings every few seconds (answered by the Durable Object's auto-response, no wake-up),
 *  - detects dead connections (phones that were locked) and reconnects quickly,
 *  - reconnects immediately when the page becomes visible again or the network returns.
 */
export class ReconnectingSocket<In, Out> {
  private ws: WebSocket | null = null;
  private status: SocketStatus = 'closed';
  private stopped = false;
  private attempt = 0;
  private retryTimer: number | undefined;
  private pingTimer: number | undefined;
  private pongTimer: number | undefined;
  private lastHeard = 0;

  constructor(private opts: SocketOptions<In>) {
    document.addEventListener('visibilitychange', this.onWake);
    window.addEventListener('online', this.onWake);
    window.addEventListener('pageshow', this.onWake);
    window.addEventListener('focus', this.onWake);
    this.connect();
  }

  get isOpen() {
    return this.status === 'open';
  }

  send(msg: Out): boolean {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }

  close() {
    this.stopped = true;
    this.clearTimers();
    document.removeEventListener('visibilitychange', this.onWake);
    window.removeEventListener('online', this.onWake);
    window.removeEventListener('pageshow', this.onWake);
    window.removeEventListener('focus', this.onWake);
    this.ws?.close(1000, 'bye');
    this.ws = null;
    this.setStatus('closed');
  }

  /** Force a fresh connection now (e.g. after unlocking the phone). */
  reconnectNow() {
    if (this.stopped) return;
    this.attempt = 0;
    this.dropSocket();
    this.connect();
  }

  private onWake = () => {
    if (this.stopped || document.visibilityState !== 'visible') return;
    if (!this.ws || this.ws.readyState >= WebSocket.CLOSING) {
      this.reconnectNow();
      return;
    }
    // The socket claims to be open but may be a zombie after a screen lock: verify quickly.
    if (this.ws.readyState === WebSocket.OPEN) {
      if (Date.now() - this.lastHeard > PING_EVERY_MS) this.ping(2000);
    }
  };

  private connect() {
    if (this.stopped) return;
    clearTimeout(this.retryTimer);
    this.setStatus('connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.opts.url());
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.attempt = 0;
      this.lastHeard = Date.now();
      this.setStatus('open');
      this.schedulePing();
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      this.lastHeard = Date.now();
      clearTimeout(this.pongTimer);
      this.pongTimer = undefined;
      if (ev.data === PONG) return;
      let msg: In;
      try {
        msg = JSON.parse(ev.data as string);
      } catch {
        return;
      }
      this.opts.onMessage(msg);
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.clearTimers();
      const fatal = this.opts.fatalCodes ?? [CLOSE.kicked, CLOSE.noRoom, CLOSE.expired, CLOSE.replaced];
      if (fatal.includes(ev.code)) {
        this.stopped = true;
        this.setStatus('closed');
        this.opts.onFatal?.(ev.code);
        return;
      }
      this.setStatus('connecting');
      this.scheduleRetry();
    };
    ws.onerror = () => {
      /* onclose follows */
    };
  }

  private scheduleRetry() {
    if (this.stopped) return;
    const delay = Math.min(MAX_BACKOFF_MS, 250 * 2 ** this.attempt) + Math.random() * 250;
    this.attempt++;
    clearTimeout(this.retryTimer);
    this.retryTimer = window.setTimeout(() => this.connect(), delay);
  }

  private schedulePing() {
    clearTimeout(this.pingTimer);
    this.pingTimer = window.setTimeout(() => {
      this.ping(PONG_TIMEOUT_MS);
      this.schedulePing();
    }, PING_EVERY_MS);
  }

  private ping(timeout: number) {
    const ws = this.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(PING);
    } catch {
      /* ignore */
    }
    if (this.pongTimer === undefined) {
      this.pongTimer = window.setTimeout(() => {
        this.pongTimer = undefined;
        if (this.ws === ws && Date.now() - this.lastHeard >= timeout) {
          // Dead connection: drop it and reconnect.
          this.dropSocket();
          this.setStatus('connecting');
          this.connect();
        }
      }, timeout);
    }
  }

  private dropSocket() {
    const ws = this.ws;
    this.ws = null;
    this.clearTimers();
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      try {
        ws.close(1000, 'reconnect');
      } catch {
        /* ignore */
      }
    }
  }

  private clearTimers() {
    clearTimeout(this.pingTimer);
    clearTimeout(this.pongTimer);
    clearTimeout(this.retryTimer);
    this.pongTimer = undefined;
  }

  private setStatus(s: SocketStatus) {
    if (this.status === s) return;
    this.status = s;
    this.opts.onStatus?.(s);
  }
}

export function wsUrl(path: string): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}${path}`;
}
