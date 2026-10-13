import { CLOSE, type HostToScreen, type MirrorSignal, type ServerToScreen, type TvFrame } from '../../../shared/protocol';
import { ReconnectingSocket, wsUrl } from '../lib/socket';
import { iceJson, iceServers, roundTrip, serial } from '../lib/rtc';
import type { HostController } from '../host/controller';
import { Replica, type ReplicaStats } from './replica';

export type ReceiverState =
  /** Connecting to the room. */
  | 'connecting'
  /** In the room, waiting for the host TV's first frame (or the host is offline). */
  | 'waiting'
  | 'live';

/** How the frames come: through the server, or straight from the host TV. */
export type Route = 'relay' | 'direct';

export interface ScreenStats extends ReplicaStats {
  route: Route;
  /** Round trip to the host TV (direct connections only). */
  rttMs: number | null;
}

/**
 * A second screen's side: joins the room as a "screen", takes the host TV's frames (through the
 * server at first, then over a WebRTC data channel once one opens) and feeds them to the replica.
 */
export class Receiver {
  state: ReceiverState = 'connecting';
  hostOnline = true;
  route: Route = 'relay';
  readonly replica: Replica;
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private socket: ReconnectingSocket<ServerToScreen, MirrorSignal>;
  private run = serial();
  /** Bumped whenever the connection is replaced or dropped, so a step still setting one up gives up. */
  private gen = 0;
  /** A frame coming in parts, per route. */
  private parts: Record<Route, { n: number; got: string[]; left: number } | null> = { relay: null, direct: null };

  constructor(
    readonly code: string,
    id: string,
    private onChange: () => void,
    /** The room is gone, full, or open on another tab: give up with this reason. */
    private onFatal: (reason: string) => void,
  ) {
    this.replica = new Replica((root) => {
      if (root && this.state !== 'live') this.state = 'live';
      this.onChange();
    });
    this.socket = new ReconnectingSocket<ServerToScreen, MirrorSignal>({
      url: () => wsUrl(`/ws/${code}?role=screen&id=${encodeURIComponent(id)}`),
      onMessage: (m, size) => this.handle(m, 'relay', size),
      onStatus: (s) => {
        if (s === 'open') {
          // Everything again: whatever happened while the socket was down is lost.
          this.socket.send({ t: 'hello' });
          if (this.state === 'connecting') this.set('waiting');
        } else if (s === 'connecting' && this.state !== 'live') this.set('connecting');
      },
      fatalCodes: [CLOSE.noRoom, CLOSE.expired, CLOSE.replaced, CLOSE.full, CLOSE.forbidden],
      onFatal: (code) => {
        this.closePeer();
        this.onFatal(
          code === CLOSE.full
            ? `Room ${this.code} already has the most second screens it can take.`
            : code === CLOSE.replaced
              ? 'This screen was opened in another tab.'
              : code === CLOSE.noRoom
                ? `There's no room ${this.code}. Check the code on the host TV.`
                : 'The room has closed.',
        );
      },
    });
  }

  get root(): HostController | null {
    return this.replica.root;
  }

  close() {
    this.socket.close();
    this.closePeer();
    this.replica.close();
  }

  async stats(): Promise<ScreenStats> {
    const rttMs = this.pc && this.route === 'direct' ? await roundTrip(this.pc) : null;
    return { ...this.replica.stats(), route: this.route, rttMs };
  }

  private set(state: ReceiverState) {
    this.state = state;
    this.onChange();
  }

  private handle(m: ServerToScreen, via: Route, size = 0) {
    switch (m.t) {
      case 'host':
        this.hostOnline = m.online;
        this.onChange();
        break;
      case 'offer':
        this.answer(m.sdp);
        break;
      case 'ice': {
        const pc = this.pc;
        if (!pc) return;
        this.run(async () => {
          if (this.pc === pc && pc.remoteDescription) await pc.addIceCandidate(m.c);
        });
        break;
      }
      case 'part': {
        let p = this.parts[via];
        if (!p || p.n !== m.n || m.i === 0) p = this.parts[via] = { n: m.n, got: [], left: m.of };
        if (p.got[m.i] === undefined) {
          p.got[m.i] = m.s;
          p.left--;
        }
        if (p.left === 0) {
          const json = p.got.join('');
          this.parts[via] = null;
          try {
            this.frame(JSON.parse(json) as TvFrame, via, json.length);
          } catch (err) {
            console.warn('[screen]', err);
          }
        }
        break;
      }
      case 'f':
      case 'F':
        this.frame(m, via, size);
        break;
      case 'err':
        break; // the close code that follows says why
    }
  }

  private frame(f: TvFrame, via: Route, size: number) {
    if (f.t === 'F' && via !== this.route) {
      this.route = via;
      this.onChange();
    }
    // Frames from the other route are from before the switch: the full frame covers them.
    if (via !== this.route) return;
    if (!this.replica.push(f, size)) this.socket.send({ t: 'hello' });
  }

  /** The host offers a direct connection: answer it, and take frames from its data channel. */
  private answer(sdp: string) {
    this.closePeer();
    // No WebRTC here: frames keep coming through the server.
    if (typeof RTCPeerConnection === 'undefined') return;
    const gen = this.gen;
    this.run(async () => {
      const servers = await iceServers();
      if (gen !== this.gen) return;
      const pc = new RTCPeerConnection({ iceServers: servers });
      this.pc = pc;
      pc.ondatachannel = (e) => {
        if (this.pc !== pc) return;
        const dc = e.channel;
        this.dc = dc;
        dc.onmessage = (ev) => {
          if (this.dc !== dc || typeof ev.data !== 'string') return;
          try {
            this.handle(JSON.parse(ev.data) as HostToScreen, 'direct', ev.data.length);
          } catch (err) {
            console.warn('[screen]', err);
          }
        };
        dc.onclose = () => {
          if (this.dc !== dc) return;
          // The host sends everything through the server again.
          this.route = 'relay';
          this.onChange();
        };
      };
      pc.onicecandidate = (e) => {
        if (e.candidate && this.pc === pc) this.socket.send({ t: 'ice', c: iceJson(e.candidate) });
      };
      await pc.setRemoteDescription({ type: 'offer', sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.socket.send({ t: 'answer', sdp: pc.localDescription!.sdp });
    });
  }

  private closePeer() {
    this.gen++;
    if (this.dc) {
      this.dc.onmessage = this.dc.onclose = null;
      this.dc = null;
    }
    if (this.pc) {
      this.pc.ondatachannel = this.pc.onicecandidate = null;
      this.pc.close();
      this.pc = null;
    }
    if (this.route !== 'relay') {
      this.route = 'relay';
      this.onChange();
    }
  }
}
