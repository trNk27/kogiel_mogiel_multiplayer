/**
 * Low-latency tuning and live numbers for the second-screen video (host/mirror.ts and
 * screen/receiver.ts). The summarising is pure so it can be tested without a browser.
 */

/** One entry of an RTCStatsReport, loosely typed: browsers differ in which fields they fill in. */
export type StatsEntry = { id: string; type: string; timestamp: number; [key: string]: unknown };

/** What the panels show about one video connection. Missing numbers are null. */
export interface MirrorStats {
  /** Round trip between the two screens. */
  rttMs: number | null;
  /** The video goes through a TURN server instead of straight across. */
  relay: boolean;
  fps: number | null;
  width: number | null;
  height: number | null;
  /** "H264", "VP8", … */
  codec: string | null;
  kbps: number | null;
  /** Hardware (power-efficient) encoder on the host, or decoder on a screen, if the browser says. */
  hardware: boolean | null;
  /** Host: time to encode a frame, over the last sample. */
  encodeMs: number | null;
  /** Host: what holds the quality back ("cpu", "bandwidth" or "none"). */
  limit: string | null;
  /** Screen: time a frame waits in the jitter buffer, over the last sample. */
  bufferMs: number | null;
  /** Screen: time to decode a frame, over the last sample. */
  decodeMs: number | null;
  /** Screen: frames dropped since the last sample. */
  dropped: number | null;
}

/** Turn a browser stats report into plain entries (what `summarize` takes). */
export async function snapshot(pc: RTCPeerConnection): Promise<StatsEntry[]> {
  const report = await pc.getStats();
  const out: StatsEntry[] = [];
  report.forEach((s: StatsEntry) => out.push(s));
  return out;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Change of a counter between two samples, or null if either is missing (or it went backwards). */
function delta(cur: StatsEntry | undefined, prev: StatsEntry | undefined, key: string): number | null {
  const a = num(cur?.[key]);
  const b = num(prev?.[key]);
  if (a === null) return null;
  if (b === null) return a;
  return a >= b ? a - b : null;
}

/** Per-frame average of `total` (seconds) over `count` frames, between two samples, in ms. */
function perFrameMs(cur: StatsEntry, prev: StatsEntry | undefined, total: string, count: string): number | null {
  const t = delta(cur, prev, total);
  const n = delta(cur, prev, count);
  return t === null || !n ? null : (t / n) * 1000;
}

/**
 * Sum up the video side of a connection: the host's outbound-rtp or a screen's inbound-rtp.
 * `prev` is the previous sample, so rates and averages cover just the last interval.
 */
export function summarize(cur: StatsEntry[], prev: StatsEntry[] | null, side: 'send' | 'receive'): MirrorStats {
  const byId = new Map(cur.map((s) => [s.id, s]));
  const prevById = new Map((prev ?? []).map((s) => [s.id, s]));
  const rtpType = side === 'send' ? 'outbound-rtp' : 'inbound-rtp';
  const rtp = cur.find((s) => s.type === rtpType && (s.kind ?? s.mediaType) === 'video');
  const old = rtp ? prevById.get(rtp.id) : undefined;

  // The candidate pair in use: the transport names it, or else the nominated, working one.
  const transport = cur.find((s) => s.type === 'transport' && typeof s.selectedCandidatePairId === 'string');
  const pair =
    (transport && byId.get(transport.selectedCandidatePairId as string)) ??
    cur.find((s) => s.type === 'candidate-pair' && s.nominated === true && s.state === 'succeeded');
  const local = pair ? byId.get(pair.localCandidateId as string) : undefined;
  const remote = pair ? byId.get(pair.remoteCandidateId as string) : undefined;
  const rtt = num(pair?.currentRoundTripTime);

  const codecEntry = rtp ? byId.get(rtp.codecId as string) : undefined;
  const mime = typeof codecEntry?.mimeType === 'string' ? codecEntry.mimeType : null;

  const bytes = rtp ? delta(rtp, old, side === 'send' ? 'bytesSent' : 'bytesReceived') : null;
  const seconds = rtp && old ? (rtp.timestamp - old.timestamp) / 1000 : null;
  const hw = rtp?.[side === 'send' ? 'powerEfficientEncoder' : 'powerEfficientDecoder'];

  return {
    rttMs: rtt === null ? null : rtt * 1000,
    relay: local?.candidateType === 'relay' || remote?.candidateType === 'relay',
    fps: num(rtp?.framesPerSecond),
    width: num(rtp?.frameWidth),
    height: num(rtp?.frameHeight),
    codec: mime ? mime.replace(/^video\//i, '') : null,
    kbps: bytes !== null && seconds ? (bytes * 8) / seconds / 1000 : null,
    hardware: typeof hw === 'boolean' ? hw : null,
    encodeMs: rtp && side === 'send' ? perFrameMs(rtp, old, 'totalEncodeTime', 'framesEncoded') : null,
    limit: side === 'send' && typeof rtp?.qualityLimitationReason === 'string' ? rtp.qualityLimitationReason : null,
    bufferMs: rtp && side === 'receive' ? perFrameMs(rtp, old, 'jitterBufferDelay', 'jitterBufferEmittedCount') : null,
    decodeMs: rtp && side === 'receive' ? perFrameMs(rtp, old, 'totalDecodeTime', 'framesDecoded') : null,
    dropped: rtp && side === 'receive' ? delta(rtp, old, 'framesDropped') : null,
  };
}

/**
 * Rough time from the host sending a frame to this screen showing it: half the round trip, the
 * jitter buffer and decoding. (Capturing and encoding on the host come on top.)
 */
export function estimateDelayMs(s: MirrorStats): number | null {
  if (s.rttMs === null && s.bufferMs === null) return null;
  return (s.rttMs ?? 0) / 2 + (s.bufferMs ?? 0) + (s.decodeMs ?? 0);
}

/** One line for the panels, e.g. "1280×720 · 30 fps · H264 (hw) · 2400 kbit/s · RTT 38 ms · direct". */
export function describe(s: MirrorStats): string {
  const parts: string[] = [];
  if (s.width && s.height) parts.push(`${s.width}×${s.height}`);
  if (s.fps !== null) parts.push(`${Math.round(s.fps)} fps`);
  if (s.codec) parts.push(s.hardware ? `${s.codec} (hw)` : s.codec);
  if (s.kbps !== null) parts.push(`${Math.round(s.kbps)} kbit/s`);
  if (s.rttMs !== null) parts.push(`RTT ${Math.round(s.rttMs)} ms`);
  parts.push(s.relay ? 'via TURN' : 'direct');
  return parts.join(' · ');
}

// ---- tuning ----------------------------------------------------------------------

/**
 * Offer H.264 first: laptops usually encode it in hardware and TVs/consoles decode it in hardware,
 * which takes milliseconds off every frame and frees the host's CPU for the game. The other codecs
 * stay listed, so a screen without H.264 still gets VP8/VP9. Call before createOffer.
 */
export function preferH264(pc: RTCPeerConnection) {
  const caps = typeof RTCRtpReceiver !== 'undefined' ? RTCRtpReceiver.getCapabilities?.('video') : null;
  if (!caps) return;
  const rank = (c: RTCRtpCodec) => {
    if (!/h264/i.test(c.mimeType)) return 2;
    // packetization-mode=1 is what hardware encoders and most decoders want.
    return /packetization-mode=1/.test(c.sdpFmtpLine ?? '') ? 0 : 1;
  };
  const codecs = [...caps.codecs].sort((a, b) => rank(a) - rank(b));
  if (rank(codecs[0]!) === 2) return; // no H.264 here
  for (const t of pc.getTransceivers()) {
    if (t.sender.track?.kind !== 'video' || !t.setCodecPreferences) continue;
    try {
      t.setCodecPreferences(codecs);
    } catch (err) {
      console.warn('[mirror] codec preferences', err);
    }
  }
}

/**
 * Ask the browser to play incoming audio and video as soon as it can instead of building up a
 * safety buffer (which, after a hiccup, can stay hundreds of ms long). Costs a little smoothness
 * on a bad network.
 */
export function lowLatency(receiver: RTCRtpReceiver) {
  const r = receiver as unknown as { jitterBufferTarget?: number | null; playoutDelayHint?: number };
  try {
    if ('jitterBufferTarget' in receiver) r.jitterBufferTarget = 0;
    else r.playoutDelayHint = 0; // older Chrome
  } catch {
    /* not supported */
  }
}
