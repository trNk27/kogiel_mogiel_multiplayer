import { CLOSE, type MirrorSignal, type ServerToScreen } from '../../../shared/protocol';
import { ReconnectingSocket, wsUrl } from '../lib/socket';
import { iceJson, iceServers, serial } from '../lib/rtc';

export type ReceiverState =
  /** Connecting to the room. */
  | 'connecting'
  /** In the room, but the host TV is offline or not sharing. */
  | 'waiting'
  /** The host is sending video: setting up the connection. */
  | 'starting'
  | 'live'
  /** The video connection failed; the host retries. */
  | 'failed';

/** If a broken video doesn't come back by itself, ask the host for a fresh one after this long. */
const ASK_AGAIN_MS = 8000;

/**
 * A second screen's side of the mirror: joins the room as a "screen", answers the host's WebRTC
 * offers and hands the incoming stream to the page.
 */
export class Receiver {
  state: ReceiverState = 'connecting';
  hostOnline = true;
  stream: MediaStream | null = null;
  private pc: RTCPeerConnection | null = null;
  private socket: ReconnectingSocket<ServerToScreen, MirrorSignal>;
  private run = serial();
  /** Bumped whenever the connection is replaced or dropped, so a step still setting one up gives up. */
  private gen = 0;
  private askTimer: number | undefined;

  constructor(
    readonly code: string,
    id: string,
    private onChange: () => void,
    /** The room is gone, full, or open on another tab: give up with this reason. */
    private onFatal: (reason: string) => void,
  ) {
    this.socket = new ReconnectingSocket<ServerToScreen, MirrorSignal>({
      url: () => wsUrl(`/ws/${code}?role=screen&id=${encodeURIComponent(id)}`),
      onMessage: (m) => this.handle(m),
      onStatus: (s) => {
        if (s === 'open') {
          this.socket.send({ t: 'hello', live: this.state === 'live' });
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

  close() {
    clearTimeout(this.askTimer);
    this.socket.close();
    this.closePeer();
  }

  private set(state: ReceiverState) {
    this.state = state;
    this.onChange();
  }

  private handle(m: ServerToScreen) {
    switch (m.t) {
      case 'host':
        this.hostOnline = m.online;
        this.onChange();
        break;
      case 'idle':
        this.closePeer();
        this.set('waiting');
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
      case 'err':
        break; // the close code that follows says why
    }
  }

  /** A (new) stream from the host: replace whatever we had. */
  private answer(sdp: string) {
    this.closePeer();
    this.set('starting');
    const gen = this.gen;
    this.run(async () => {
      const servers = await iceServers();
      if (gen !== this.gen) return;
      const pc = new RTCPeerConnection({ iceServers: servers });
      this.pc = pc;
      pc.ontrack = (e) => {
        if (this.pc !== pc) return;
        this.stream = e.streams[0] ?? new MediaStream([e.track]);
        this.onChange();
      };
      pc.onicecandidate = (e) => {
        if (e.candidate && this.pc === pc) this.socket.send({ t: 'ice', c: iceJson(e.candidate) });
      };
      pc.onconnectionstatechange = () => {
        if (this.pc !== pc) return;
        const s = pc.connectionState;
        if (s === 'connected') {
          clearTimeout(this.askTimer);
          this.set('live');
        } else if (s === 'disconnected') {
          // Often comes back by itself within seconds; don't leave a frozen picture up meanwhile.
          this.set('failed');
        } else if (s === 'failed') {
          this.set('failed');
          clearTimeout(this.askTimer);
          this.askTimer = window.setTimeout(() => {
            if (this.pc === pc && this.state === 'failed') this.socket.send({ t: 'hello', live: false });
          }, ASK_AGAIN_MS);
        }
      };
      await pc.setRemoteDescription({ type: 'offer', sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.socket.send({ t: 'answer', sdp: pc.localDescription!.sdp });
    });
  }

  private closePeer() {
    this.gen++;
    clearTimeout(this.askTimer);
    if (this.pc) {
      this.pc.ontrack = this.pc.onicecandidate = this.pc.onconnectionstatechange = null;
      this.pc.close();
      this.pc = null;
    }
    if (this.stream) {
      this.stream = null;
      this.onChange();
    }
  }
}
