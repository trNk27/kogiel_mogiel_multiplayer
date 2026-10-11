import { afterEach, describe as group, expect, it, vi } from 'vitest';
import { describe, estimateDelayMs, preferH264, summarize, type StatsEntry } from '../client/src/lib/rtcStats';

const e = (id: string, type: string, timestamp: number, rest: Record<string, unknown> = {}): StatsEntry => ({ id, type, timestamp, ...rest });

function receiveSample(t: number, frames: number, buffer: number, decode: number, bytes: number, dropped: number, relay = false): StatsEntry[] {
  return [
    e('IT01V', 'inbound-rtp', t, {
      kind: 'video',
      codecId: 'C1',
      framesPerSecond: 30,
      frameWidth: 1280,
      frameHeight: 720,
      jitterBufferDelay: buffer,
      jitterBufferEmittedCount: frames,
      totalDecodeTime: decode,
      framesDecoded: frames,
      framesDropped: dropped,
      bytesReceived: bytes,
      powerEfficientDecoder: true,
    }),
    e('IT01A', 'inbound-rtp', t, { kind: 'audio', jitterBufferDelay: 999, jitterBufferEmittedCount: 1 }),
    e('C1', 'codec', t, { mimeType: 'video/H264' }),
    e('T1', 'transport', t, { selectedCandidatePairId: 'P1' }),
    e('P1', 'candidate-pair', t, { localCandidateId: 'L1', remoteCandidateId: 'R1', currentRoundTripTime: 0.04 }),
    e('P2', 'candidate-pair', t, { localCandidateId: 'L2', remoteCandidateId: 'R1', currentRoundTripTime: 0.5 }),
    e('L1', 'local-candidate', t, { candidateType: relay ? 'relay' : 'srflx' }),
    e('L2', 'local-candidate', t, { candidateType: 'relay' }),
    e('R1', 'remote-candidate', t, { candidateType: 'srflx' }),
  ];
}

group('summarize (second screen)', () => {
  it('averages the jitter buffer and decoding over the last interval only', () => {
    // First second: a 300 ms buffer per frame; second: 20 ms per frame.
    const a = receiveSample(1000, 30, 9, 0.3, 100_000, 2);
    const b = receiveSample(2000, 60, 9.6, 0.45, 400_000, 5);
    const s = summarize(b, a, 'receive');
    expect(s.bufferMs).toBeCloseTo(20);
    expect(s.decodeMs).toBeCloseTo(5);
    expect(s.dropped).toBe(3);
    expect(s.kbps).toBeCloseTo(2400);
    expect(s.rttMs).toBeCloseTo(40);
    expect(s.relay).toBe(false);
    expect(s.codec).toBe('H264');
    expect(s.hardware).toBe(true);
    expect(s.width).toBe(1280);
    expect(estimateDelayMs(s)).toBeCloseTo(45);
    expect(describe(s)).toBe('1280×720 · 30 fps · H264 (hw) · 2400 kbit/s · RTT 40 ms · direct');
  });

  it('uses the totals so far on the first sample, and spots TURN', () => {
    const s = summarize(receiveSample(1000, 30, 9, 0.3, 100_000, 2, true), null, 'receive');
    expect(s.bufferMs).toBeCloseTo(300);
    expect(s.kbps).toBeNull();
    expect(s.relay).toBe(true);
    expect(describe(s)).toContain('via TURN');
  });

  it('falls back to the nominated pair when there is no transport entry', () => {
    const stats = [
      e('P1', 'candidate-pair', 0, { nominated: false, state: 'succeeded', currentRoundTripTime: 0.9, localCandidateId: 'L1' }),
      e('P2', 'candidate-pair', 0, { nominated: true, state: 'succeeded', currentRoundTripTime: 0.02, localCandidateId: 'L2' }),
    ];
    expect(summarize(stats, null, 'receive').rttMs).toBeCloseTo(20);
  });
});

group('summarize (host)', () => {
  it('reports encoding time and what holds the quality back', () => {
    const out = (t: number, frames: number, enc: number, bytes: number): StatsEntry[] => [
      e('OT01V', 'outbound-rtp', t, {
        kind: 'video',
        codecId: 'C1',
        framesPerSecond: 30,
        frameWidth: 1280,
        frameHeight: 720,
        totalEncodeTime: enc,
        framesEncoded: frames,
        bytesSent: bytes,
        qualityLimitationReason: 'cpu',
        powerEfficientEncoder: false,
      }),
      e('C1', 'codec', t, { mimeType: 'video/VP8' }),
    ];
    const s = summarize(out(2000, 60, 1.2, 600_000), out(1000, 30, 0.3, 200_000), 'send');
    expect(s.encodeMs).toBeCloseTo(30);
    expect(s.limit).toBe('cpu');
    expect(s.codec).toBe('VP8');
    expect(s.hardware).toBe(false);
    expect(s.kbps).toBeCloseTo(3200);
    expect(s.bufferMs).toBeNull();
    expect(s.rttMs).toBeNull();
  });
});

group('preferH264', () => {
  afterEach(() => vi.unstubAllGlobals());

  function fakePc(codecs: { mimeType: string; sdpFmtpLine?: string }[]) {
    vi.stubGlobal('RTCRtpReceiver', { getCapabilities: () => ({ codecs, headerExtensions: [] }) });
    const set = vi.fn();
    const pc = {
      getTransceivers: () => [
        { sender: { track: { kind: 'audio' } }, setCodecPreferences: vi.fn() },
        { sender: { track: { kind: 'video' } }, setCodecPreferences: set },
      ],
    } as unknown as RTCPeerConnection;
    preferH264(pc);
    return set;
  }

  it('puts H.264 (packetization-mode=1 first) ahead of the rest, keeping the rest', () => {
    const set = fakePc([
      { mimeType: 'video/VP8' },
      { mimeType: 'video/rtx' },
      { mimeType: 'video/H264', sdpFmtpLine: 'packetization-mode=0;profile-level-id=42e01f' },
      { mimeType: 'video/H264', sdpFmtpLine: 'level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e01f' },
    ]);
    const order = (set.mock.calls[0]![0] as { mimeType: string; sdpFmtpLine?: string }[]).map((c) => `${c.mimeType} ${c.sdpFmtpLine ?? ''}`.trim());
    expect(order[0]).toContain('packetization-mode=1');
    expect(order[1]).toContain('packetization-mode=0');
    expect(order.slice(2)).toEqual(['video/VP8', 'video/rtx']);
  });

  it('leaves the order alone when there is no H.264', () => {
    expect(fakePc([{ mimeType: 'video/VP8' }, { mimeType: 'video/VP9' }])).not.toHaveBeenCalled();
  });
});
