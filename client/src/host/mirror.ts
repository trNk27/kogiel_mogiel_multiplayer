import type { HostToScreen, MirrorSignal, TvFrame } from '../../../shared/protocol';
import { iceJson, iceServers, roundTrip, serial } from '../lib/rtc';

/**
 * How a second screen is connected, as the host TV shows it: still saying hello, getting frames
 * through the server, or straight from this TV over a data channel.
 */
export type ScreenState = 'connecting' | 'relay' | 'direct';

interface Peer {
  id: string;
  pc: RTCPeerConnection | null;
  dc: RTCDataChannel | null;
  /** The screen has had a full frame and takes the stream of changes from here. */
  synced: boolean;
  /** Failed connections in a row (the retry waits longer each time). */
  fails: number;
  /** Bumped whenever the connection is replaced or dropped, so a step still setting one up gives up. */
  gen: number;
  retry: number | undefined;
  run: ReturnType<typeof serial>;
  /** Bytes sent since `since`, for the panel. */
  bytes: number;
  since: number;
}

/** Frames bigger than this go in parts: the relay takes messages up to 96 KB, escaped JSON included. */
const PART = 40_000;
/** A data channel this far behind is dropped back to a full frame once it drains. */
const BACKLOG = 4 * 1024 * 1024;

/** One second screen's numbers for the 📡 panel. */
export interface ScreenStats {
  kbps: number;
  rttMs: number | null;
}

/**
 * The host TV's side of second screens: who's connected, and how frames get to them. Each
 * screen gets frames through the Durable Object at first, and over a WebRTC data channel straight
 * from this TV as soon as one opens (lower delay, and nothing goes through the server). If the
 * channel fails, frames go back to the relay.
 */
export class MirrorHost {
  private peers = new Map<string, Peer>();

  constructor(
    private send: (id: string, m: HostToScreen) => void,
    private changed: () => void,
    /** A screen needs everything: send it a full frame now (through `deliver`). */
    private onReady: (id: string) => void,
  ) {}

  get count() {
    return this.peers.size;
  }

  screens(): { id: string; state: ScreenState }[] {
    return [...this.peers.values()].map((p) => ({ id: p.id, state: !p.synced ? 'connecting' : p.dc?.readyState === 'open' ? 'direct' : 'relay' }));
  }

  async stats(): Promise<Map<string, ScreenStats>> {
    const out = new Map<string, ScreenStats>();
    const now = performance.now();
    await Promise.all(
      [...this.peers.values()].map(async (p) => {
        const secs = Math.max(0.001, (now - p.since) / 1000);
        const kbps = (p.bytes * 8) / 1000 / secs;
        p.bytes = 0;
        p.since = now;
        const rttMs = p.pc && p.dc?.readyState === 'open' ? await roundTrip(p.pc) : null;
        out.set(p.id, { kbps, rttMs });
      }),
    );
    return out;
  }

  /** Send a frame to every screen that's in step. */
  broadcast(f: TvFrame) {
    let json: string | null = null;
    for (const p of this.peers.values()) {
      if (!p.synced) continue;
      json ??= JSON.stringify(f);
      this.deliver(p, f, json);
    }
  }

  /** Send a full frame to one screen: from now on it's in step. */
  sendFull(id: string, f: TvFrame) {
    const p = this.peers.get(id);
    if (!p) return;
    p.synced = true;
    this.deliver(p, f, JSON.stringify(f));
    this.changed();
  }

  stop() {
    for (const p of [...this.peers.values()]) this.gone(p.id);
  }

  // ---- from the relay ---------------------------------------------------------

  /** The host (re)connected: these screens are in the room right now. */
  sync(ids: string[]) {
    const present = new Set(ids);
    for (const p of [...this.peers.values()]) if (!present.has(p.id)) this.gone(p.id);
    // These screens won't say hello again (their sockets stayed open), so start them over.
    for (const id of ids) this.hello(id);
  }

  connected(id: string) {
    this.peer(id);
    // The screen says hello when its socket opens; that's when it gets its first frame.
  }

  gone(id: string) {
    const p = this.peers.get(id);
    if (!p) return;
    this.closePeer(p);
    this.peers.delete(id);
    this.changed();
  }

  signal(id: string, m: MirrorSignal) {
    const p = this.peer(id);
    switch (m.t) {
      case 'hello':
        this.hello(id);
        break;
      case 'answer': {
        const pc = p.pc;
        if (!pc) return;
        p.run(async () => {
          if (p.pc === pc && pc.signalingState === 'have-local-offer') await pc.setRemoteDescription({ type: 'answer', sdp: m.sdp });
        });
        break;
      }
      case 'ice': {
        const pc = p.pc;
        if (!pc) return;
        p.run(async () => {
          if (p.pc === pc && pc.remoteDescription) await pc.addIceCandidate(m.c);
        });
        break;
      }
    }
  }

  // ---- delivery ---------------------------------------------------------------

  private peer(id: string): Peer {
    let p = this.peers.get(id);
    if (!p) {
      p = { id, pc: null, dc: null, synced: false, fails: 0, gen: 0, retry: undefined, run: serial(), bytes: 0, since: performance.now() };
      this.peers.set(id, p);
      this.changed();
    }
    return p;
  }

  /** A screen (re)started: everything again through the relay, and a fresh direct connection. */
  private hello(id: string) {
    const p = this.peer(id);
    if (p.dc?.readyState !== 'open') this.closePeer(p);
    p.synced = false;
    this.onReady(id);
    if (!p.pc) this.offer(p);
  }

  private deliver(p: Peer, f: TvFrame, json: string) {
    p.bytes += json.length;
    const dc = p.dc?.readyState === 'open' ? p.dc : null;
    if (dc && dc.bufferedAmount > BACKLOG) {
      // The screen can't keep up: let the channel drain, then start it over.
      p.synced = false;
      dc.onbufferedamountlow = () => {
        dc.onbufferedamountlow = null;
        if (p.dc === dc && !p.synced) this.onReady(p.id);
      };
      dc.bufferedAmountLowThreshold = BACKLOG / 4;
      return;
    }
    const send = dc ? (m: HostToScreen, s?: string) => dc.send(s ?? JSON.stringify(m)) : (m: HostToScreen) => this.send(p.id, m);
    try {
      if (json.length <= PART) send(f, json);
      else {
        const of = Math.ceil(json.length / PART);
        for (let i = 0; i < of; i++) send({ t: 'part', n: f.n, i, of, s: json.slice(i * PART, (i + 1) * PART) });
      }
    } catch (err) {
      // A channel closing under us: the relay takes over.
      console.warn('[screens]', err);
      if (dc) this.dropChannel(p);
    }
  }

  // ---- direct connections -----------------------------------------------------

  private offer(p: Peer) {
    if (typeof RTCPeerConnection === 'undefined') return;
    this.closePeer(p);
    const gen = p.gen;
    p.run(async () => {
      const servers = await iceServers();
      if (gen !== p.gen || this.peers.get(p.id) !== p) return;
      const pc = new RTCPeerConnection({ iceServers: servers });
      p.pc = pc;
      const dc = pc.createDataChannel('tv', { ordered: true });
      p.dc = dc;
      dc.onopen = () => {
        if (p.dc !== dc) return;
        p.fails = 0;
        // Start the screen over on the channel: frames still on their way through the relay are older and get ignored.
        this.onReady(p.id);
      };
      dc.onclose = () => {
        if (p.dc === dc) this.dropChannel(p);
      };
      pc.onicecandidate = (e) => {
        if (e.candidate && p.pc === pc) this.send(p.id, { t: 'ice', c: iceJson(e.candidate) });
      };
      pc.onconnectionstatechange = () => {
        if (p.pc === pc && pc.connectionState === 'failed') this.dropChannel(p);
      };
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.send(p.id, { t: 'offer', sdp: pc.localDescription!.sdp });
    });
  }

  /** The direct connection broke: back to the relay, and try again in a while. */
  private dropChannel(p: Peer) {
    const wasOpen = p.dc?.readyState === 'open' || p.synced;
    this.closePeer(p);
    if (wasOpen && this.peers.get(p.id) === p) this.onReady(p.id);
    const delay = Math.min(30_000, 2000 * 2 ** p.fails);
    p.fails++;
    p.retry = window.setTimeout(() => {
      if (this.peers.get(p.id) === p && !p.pc) this.offer(p);
    }, delay);
    this.changed();
  }

  private closePeer(p: Peer) {
    p.gen++;
    clearTimeout(p.retry);
    p.retry = undefined;
    if (p.dc) {
      p.dc.onopen = p.dc.onclose = p.dc.onbufferedamountlow = null;
      p.dc = null;
    }
    if (p.pc) {
      p.pc.onicecandidate = p.pc.onconnectionstatechange = null;
      p.pc.close();
      p.pc = null;
    }
  }
}
