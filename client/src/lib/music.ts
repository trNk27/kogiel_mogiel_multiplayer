/**
 * Background music for the TV, synthesized with WebAudio like the sound effects (no audio files).
 * Plays the tracks written out in tracks.ts with a small lookahead scheduler, and follows the mute button.
 */
import { sound } from './sound';
import { TRACKS, parsePart, type Inst, type NoteEvent, type TrackId } from './tracks';

/** Overall music level, under the sound effects. */
const LEVEL = 0.35;
const LOOKAHEAD = 0.25;
const TICK_MS = 50;
const FADE = 0.6;

interface Prepared {
  id: TrackId;
  stepDur: number;
  swing: number;
  length: number;
  /** Per step: what starts there. */
  at: { inst: Inst; vol: number; ev: NoteEvent }[][];
}

function prepare(id: TrackId): Prepared {
  const t = TRACKS[id];
  const length = t.bars * t.beatsPerBar * t.steps;
  const at: Prepared['at'] = Array.from({ length }, () => []);
  for (const p of t.parts) {
    for (const ev of parsePart(p.seq, p.inst === 'drums').events) at[ev.step % length].push({ inst: p.inst, vol: p.vol, ev });
  }
  return { id, stepDur: 60 / t.bpm / t.steps, swing: t.swing ?? 0, length, at };
}

const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);

class Music {
  private track: Prepared | null = null;
  private bus: GainNode | null = null;
  private step = 0;
  private time = 0;
  private timer: number | undefined;
  private noiseBuf: AudioBuffer | null = null;
  private cache = new Map<TrackId, Prepared>();

  /** Switch to a track (or silence). Asking for the one already playing does nothing. */
  play(id: TrackId | null) {
    if ((this.track?.id ?? null) === id) return;
    this.fadeOut();
    if (!id) {
      this.track = null;
      return;
    }
    if (!this.cache.has(id)) this.cache.set(id, prepare(id));
    this.track = this.cache.get(id)!;
    this.step = 0;
    this.time = 0;
    if (this.timer === undefined) this.timer = window.setInterval(() => this.tick(), TICK_MS);
  }

  stop() {
    this.play(null);
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private fadeOut() {
    const ctx = sound.context;
    const bus = this.bus;
    this.bus = null;
    if (!ctx || !bus) return;
    bus.gain.cancelScheduledValues(ctx.currentTime);
    bus.gain.setTargetAtTime(0, ctx.currentTime, FADE / 4);
    window.setTimeout(() => bus.disconnect(), FADE * 2000);
  }

  private tick() {
    const ctx = sound.context;
    const t = this.track;
    if (!ctx || ctx.state !== 'running' || !t) return;
    const now = ctx.currentTime;
    if (!this.bus) {
      this.bus = ctx.createGain();
      this.bus.gain.value = 0;
      this.bus.connect(ctx.destination);
      // A new track starts just after the old one has faded a little.
      this.time = now + 0.15;
    }
    this.bus.gain.setTargetAtTime(sound.muted ? 0 : LEVEL, now, 0.15);
    // After a stall (a hidden tab), pick up from now rather than rushing to catch up.
    if (this.time < now - 0.1) this.time = now + 0.05;
    while (this.time < now + LOOKAHEAD) {
      const swing = this.step % 2 === 1 ? t.swing * t.stepDur : 0;
      if (!sound.muted) for (const n of t.at[this.step]) this.voice(ctx, this.bus, n.inst, n.vol, n.ev, this.time + swing, n.ev.len * t.stepDur);
      this.time += t.stepDur;
      this.step = (this.step + 1) % t.length;
    }
  }

  private noise(ctx: AudioContext) {
    if (!this.noiseBuf || this.noiseBuf.sampleRate !== ctx.sampleRate) {
      const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    return src;
  }

  private voice(ctx: AudioContext, out: AudioNode, inst: Inst, vol: number, ev: NoteEvent, t: number, dur: number) {
    if (inst === 'drums') {
      for (const d of ev.notes) this.drum(ctx, out, String(d), vol, t);
      return;
    }
    for (const n of ev.notes) this.tone(ctx, out, inst, hz(Number(n)), vol / Math.sqrt(ev.notes.length), t, dur);
  }

  /** One pitched note: oscillators → filter → envelope. */
  private tone(ctx: AudioContext, out: AudioNode, inst: Inst, f: number, vol: number, t: number, dur: number) {
    const env = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.connect(env).connect(out);
    const oscs: OscillatorNode[] = [];
    const osc = (type: OscillatorType, mult = 1, detune = 0, gain = 1) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f * mult;
      o.detune.value = detune;
      if (gain === 1) o.connect(filter);
      else {
        const g = ctx.createGain();
        g.gain.value = gain;
        o.connect(g).connect(filter);
      }
      oscs.push(o);
      return o;
    };
    const g = env.gain;
    let end = t + dur;
    // attack, decay to sustain, release
    const adsr = (a: number, d: number, s: number, r: number) => {
      g.setValueAtTime(0.0001, t);
      g.linearRampToValueAtTime(vol, t + a);
      g.setTargetAtTime(vol * s, t + a, d / 3);
      const off = Math.max(t + a, t + dur - 0.02);
      g.setTargetAtTime(0.0001, off, r / 4);
      end = off + r;
    };
    switch (inst) {
      case 'bass':
        osc('triangle');
        osc('sine', 0.5, 0, 0.6);
        filter.frequency.value = 700;
        adsr(0.01, 0.25, 0.55, 0.08);
        break;
      case 'accordion': {
        osc('sawtooth', 1, -7);
        osc('sawtooth', 1, 7);
        osc('square', 2, 0, 0.25);
        filter.frequency.value = 1900;
        filter.Q.value = 1.5;
        const lfo = ctx.createOscillator();
        const depth = ctx.createGain();
        lfo.frequency.value = 5.5;
        depth.gain.value = 6;
        lfo.connect(depth);
        for (const o of oscs) depth.connect(o.detune);
        oscs.push(lfo);
        adsr(0.03, 0.2, 0.8, 0.08);
        break;
      }
      case 'pluck':
        osc('triangle');
        osc('square', 1, 0, 0.2);
        filter.frequency.setValueAtTime(4000, t);
        filter.frequency.exponentialRampToValueAtTime(600, t + 0.25);
        adsr(0.005, 0.18, 0.15, 0.12);
        break;
      case 'ep':
        osc('sine');
        osc('sine', 2, 3, 0.25);
        osc('triangle', 1, -4, 0.3);
        filter.frequency.value = 2600;
        adsr(0.008, 1.2, 0.25, 0.3);
        break;
      case 'pad':
        osc('sawtooth', 1, -10);
        osc('sawtooth', 1, 10);
        filter.frequency.value = 900;
        adsr(0.25, 0.5, 0.8, 0.4);
        break;
      case 'lead':
        osc('square');
        osc('square', 1, 8, 0.5);
        filter.frequency.value = 2800;
        adsr(0.01, 0.15, 0.7, 0.06);
        break;
      case 'sax': {
        osc('sawtooth');
        osc('triangle', 1, 5, 0.5);
        filter.frequency.value = 1500;
        filter.Q.value = 3;
        // Vibrato that grows into long notes.
        const lfo = ctx.createOscillator();
        const depth = ctx.createGain();
        lfo.frequency.value = 5;
        depth.gain.setValueAtTime(0, t);
        depth.gain.linearRampToValueAtTime(14, t + Math.min(0.6, dur));
        lfo.connect(depth);
        for (const o of oscs) depth.connect(o.detune);
        oscs.push(lfo);
        adsr(0.07, 0.3, 0.75, 0.15);
        break;
      }
      case 'bell':
        osc('sine');
        osc('sine', 2.76, 0, 0.3);
        osc('sine', 5.4, 0, 0.1);
        filter.frequency.value = 8000;
        g.setValueAtTime(0.0001, t);
        g.linearRampToValueAtTime(vol, t + 0.005);
        g.setTargetAtTime(0.0001, t + 0.005, 0.5);
        end = t + 2.2;
        break;
    }
    for (const o of oscs) {
      o.start(t);
      o.stop(end + 0.05);
    }
  }

  private drum(ctx: AudioContext, out: AudioNode, d: string, vol: number, t: number) {
    const env = ctx.createGain();
    env.connect(out);
    const hit = (peak: number, decay: number) => {
      env.gain.setValueAtTime(peak * vol, t);
      env.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    };
    const noise = (type: BiquadFilterType, freq: number, decay: number, q = 1) => {
      const src = this.noise(ctx);
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      src.connect(f).connect(env);
      src.start(t, Math.random() * 0.5);
      src.stop(t + decay + 0.05);
    };
    switch (d) {
      case 'k': {
        const o = ctx.createOscillator();
        o.frequency.setValueAtTime(150, t);
        o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
        o.connect(env);
        o.start(t);
        o.stop(t + 0.4);
        hit(0.65, 0.3);
        break;
      }
      case 's': {
        noise('highpass', 1200, 0.16);
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = 190;
        o.connect(env);
        o.start(t);
        o.stop(t + 0.12);
        hit(0.45, 0.16);
        break;
      }
      case 'h':
        noise('highpass', 7000, 0.05);
        hit(0.22, 0.05);
        break;
      case 'o':
        noise('highpass', 6500, 0.28);
        hit(0.2, 0.28);
        break;
      case 'r': {
        noise('bandpass', 1800, 0.04, 4);
        hit(0.5, 0.04);
        break;
      }
      case 'b':
        noise('bandpass', 2800, 0.22, 0.7);
        env.gain.setValueAtTime(0.0001, t);
        env.gain.linearRampToValueAtTime(0.18 * vol, t + 0.05);
        env.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
        break;
      case 'c':
        noise('bandpass', 1500, 0.14, 1.2);
        hit(0.5, 0.14);
        break;
      case 'x':
        noise('highpass', 5000, 0.07);
        env.gain.setValueAtTime(0.0001, t);
        env.gain.linearRampToValueAtTime(0.16 * vol, t + 0.02);
        env.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
        break;
    }
  }
}

export const music = new Music();
