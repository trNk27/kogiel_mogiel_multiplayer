import type { MirrorSignal } from '../../../shared/protocol';
import { canShareScreen, iceJson, iceServers, serial } from '../lib/rtc';
import { preferH264, snapshot, summarize, type MirrorStats, type StatsEntry } from '../lib/rtcStats';

/** How a second screen is doing, as the host TV shows it. */
export type ScreenState = 'waiting' | 'connecting' | 'live' | 'failed';

interface Peer {
  id: string;
  pc: RTCPeerConnection | null;
  state: ScreenState;
  /** Failed connections in a row (the retry waits longer each time). */
  fails: number;
  /** Bumped whenever the connection is replaced or dropped, so a step still setting one up gives up. */
  gen: number;
  retry: number | undefined;
  run: ReturnType<typeof serial>;
  /** The last stats sample, so the next one can work out rates. */
  lastStats: StatsEntry[] | null;
}

/**
 * 720p rather than 1080p: half the pixels to capture and encode, so frames leave sooner and the
 * host's own game keeps its frame rate. Still sharp on a TV for these games.
 */
const MAX_WIDTH = 1280;
const MAX_HEIGHT = 720;
/**
 * Video bitrate per second screen: enough for 720p30 of a game. Kept low on purpose: at 3 Mbit/s
 * two screens filled weak links (the host's Wi-Fi, or a screen's), the packets queued up and the
 * round trip went from ~50 to ~180 ms, with the jitter buffer growing to match.
 */
const MAX_BITRATE = 1_500_000;
const MAX_FPS = 30;

/**
 * The host TV's side of second screens. When the host shares its tab, the picture and sound are
 * streamed to every second screen in the room over WebRTC (one peer connection each, host offers).
 * The Durable Object only relays the signalling, via `send`.
 */
export class MirrorHost {
  readonly supported = canShareScreen();
  stream: MediaStream | null = null;
  /** Why sharing didn't start, for the panel. */
  error: string | null = null;
  starting = false;
  private peers = new Map<string, Peer>();

  constructor(
    private send: (id: string, m: MirrorSignal) => void,
    private changed: () => void,
  ) {}

  get sharing() {
    return this.stream !== null;
  }

  /** Second screens in the room and how each is doing. */
  screens(): { id: string; state: ScreenState }[] {
    return [...this.peers.values()].map((p) => ({ id: p.id, state: p.state }));
  }

  /** Live numbers for every connected screen (rates cover the time since the last call). */
  async stats(): Promise<Map<string, MirrorStats>> {
    const out = new Map<string, MirrorStats>();
    await Promise.all(
      [...this.peers.values()].map(async (p) => {
        const pc = p.pc;
        if (!pc || p.state !== 'live') return;
        const cur = await snapshot(pc).catch(() => null);
        if (!cur || p.pc !== pc) return;
        out.set(p.id, summarize(cur, p.lastStats, 'send'));
        p.lastStats = cur;
      }),
    );
    return out;
  }

  /** Ask the browser to share this tab. Must run from a click. */
  async start() {
    if (this.stream || this.starting || !this.supported) return;
    this.starting = true;
    this.error = null;
    this.changed();
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: MAX_FPS, max: MAX_FPS }, width: { max: MAX_WIDTH }, height: { max: MAX_HEIGHT } },
        audio: true,
        // Chrome / Edge: offer this tab first, and don't let the share wander to another one.
        preferCurrentTab: true,
        selfBrowserSurface: 'include',
        surfaceSwitching: 'exclude',
        systemAudio: 'exclude',
      } as DisplayMediaStreamOptions);
      const [video] = stream.getVideoTracks();
      if (video) video.contentHint = 'motion';
      // The browser's own "Stop sharing" button.
      video?.addEventListener('ended', () => this.stop());
      this.stream = stream;
      for (const p of this.peers.values()) this.offer(p);
    } catch (err) {
      const name = (err as Error).name;
      this.error = name === 'NotAllowedError' ? 'Sharing was cancelled.' : `This browser couldn't share the screen (${name || 'error'}).`;
    }
    this.starting = false;
    this.changed();
  }

  stop() {
    if (!this.stream) return;
    for (const t of this.stream.getTracks()) t.stop();
    this.stream = null;
    for (const p of this.peers.values()) {
      this.closePeer(p);
      p.state = 'waiting';
      this.send(p.id, { t: 'idle' });
    }
    this.changed();
  }

  // ---- from the relay ---------------------------------------------------------

  /** The host (re)connected: these screens are in the room right now. */
  sync(ids: string[]) {
    const present = new Set(ids);
    for (const p of [...this.peers.values()]) if (!present.has(p.id)) this.gone(p.id);
    for (const id of ids) {
      if (!this.peers.has(id)) this.connected(id);
      const p = this.peers.get(id)!;
      // These screens won't say hello again (their sockets stayed open), so reach out to them.
      if (!this.stream) this.send(id, { t: 'idle' });
      else if (!p.pc || p.state === 'failed') this.offer(p);
    }
  }

  connected(id: string) {
    let p = this.peers.get(id);
    if (!p) {
      p = { id, pc: null, state: 'waiting', fails: 0, gen: 0, retry: undefined, run: serial(), lastStats: null };
      this.peers.set(id, p);
      this.changed();
    }
    // The screen says hello when its socket opens; that's when it gets an offer.
  }

  gone(id: string) {
    const p = this.peers.get(id);
    if (!p) return;
    this.closePeer(p);
    this.peers.delete(id);
    this.changed();
  }

  signal(id: string, m: MirrorSignal) {
    if (!this.peers.has(id)) this.connected(id);
    const p = this.peers.get(id)!;
    switch (m.t) {
      case 'hello':
        if (!this.stream) this.send(id, { t: 'idle' });
        // A screen whose socket blipped keeps its video; a fresh or broken one gets a new offer.
        else if (!m.live || !p.pc || p.state === 'failed') this.offer(p);
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

  // ---- peer connections -------------------------------------------------------

  private offer(p: Peer) {
    const stream = this.stream;
    if (!stream) return;
    this.closePeer(p);
    p.state = 'connecting';
    this.changed();
    const gen = p.gen;
    p.run(async () => {
      const servers = await iceServers();
      if (gen !== p.gen || this.stream !== stream) return;
      const pc = new RTCPeerConnection({ iceServers: servers });
      p.pc = pc;
      for (const track of stream.getTracks()) pc.addTrack(track, stream);
      preferH264(pc);
      pc.onicecandidate = (e) => {
        if (e.candidate && p.pc === pc) this.send(p.id, { t: 'ice', c: iceJson(e.candidate) });
      };
      pc.onconnectionstatechange = () => {
        if (p.pc !== pc) return;
        const s = pc.connectionState;
        if (s === 'connected') {
          p.state = 'live';
          p.fails = 0;
        } else if (s === 'failed') {
          p.state = 'failed';
          this.retryLater(p);
        }
        this.changed();
      };
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      for (const sender of pc.getSenders()) {
        if (sender.track?.kind !== 'video') continue;
        const params = sender.getParameters();
        if (!params.encodings?.length) continue;
        params.encodings[0].maxBitrate = MAX_BITRATE;
        params.encodings[0].maxFramerate = MAX_FPS;
        // When the CPU or network can't keep up, drop resolution rather than frames: a skipped
        // frame is felt as lag in a fast game, a softer picture much less.
        const withPref = { ...params, degradationPreference: 'maintain-framerate' } as RTCRtpSendParameters;
        await sender.setParameters(withPref).catch(() => sender.setParameters(params).catch(() => {}));
      }
      this.send(p.id, { t: 'offer', sdp: pc.localDescription!.sdp });
    });
  }

  /** A connection failed (a network change, or a NAT that needs TURN): try again in a while. */
  private retryLater(p: Peer) {
    clearTimeout(p.retry);
    const delay = Math.min(20_000, 2000 * 2 ** p.fails);
    p.fails++;
    p.retry = window.setTimeout(() => {
      if (this.peers.get(p.id) === p && this.stream && p.state === 'failed') this.offer(p);
    }, delay);
  }

  private closePeer(p: Peer) {
    p.gen++;
    p.lastStats = null;
    clearTimeout(p.retry);
    p.retry = undefined;
    if (p.pc) {
      p.pc.onicecandidate = p.pc.onconnectionstatechange = null;
      p.pc.close();
      p.pc = null;
    }
  }
}
