/**
 * Background music for the TV, synthesized with WebAudio like the sound effects (no audio files).
 * Plays the tracks written out in tracks.ts with a small lookahead scheduler, through a little mixing desk:
 * each part has its own place left to right and sends to a room reverb and the track's echo, the kick pumps
 * the other parts, and a compressor glues it all together. Follows the mute button and dips under sound effects.
 */
import { sound } from './sound';
import { TRACKS, parsePart, type Inst, type NoteEvent, type TrackDef, type TrackId } from './tracks';

/** Overall music level, under the sound effects. */
const LEVEL = 0.35;
const LOOKAHEAD = 0.25;
const TICK_MS = 50;
const FADE = 0.6;
/** How far the music dips while a sound effect plays. */
const DIP = 0.7;
const GRACE = 0.055;
const GLIDE = 0.09;
const TRILL = 0.065;
/** Random wobble on every note's loudness, so repeats don't sound like a machine. */
const VEL_SLOP = 0.1;

/** How much of each instrument goes to the room reverb, unless a part says otherwise. */
const REVERB: Record<Inst, number> = { bass: 0, accordion: 0.2, pluck: 0.2, ep: 0.25, pad: 0.45, lead: 0.15, sax: 0.3, bell: 0.5, drums: 0.08 };
/** How loose each instrument plays, in seconds either side of the beat. The bass and the kick stay tight. */
const LOOSE: Record<Inst, number> = { bass: 0.002, accordion: 0.008, pluck: 0.006, ep: 0.008, pad: 0.01, lead: 0.005, sax: 0.012, bell: 0.006, drums: 0.004 };

interface Scheduled {
  part: number;
  inst: Inst;
  vol: number;
  /** Step and length in grid steps. */
  ev: NoteEvent;
}

interface Prepared {
  id: TrackId;
  def: TrackDef;
  /** Grid steps per loop. */
  length: number;
  loopDur: number;
  /** Per grid step: what starts there. */
  at: Scheduled[][];
  /** Seconds from the start of a loop to grid position `pos` (fractional or past the end too), swing included. */
  time: (pos: number) => number;
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

function prepare(id: TrackId): Prepared {
  const t = TRACKS[id];
  // The scheduler runs on the finest grid any part is written in.
  const grid = t.parts.reduce((g, p) => (g * (p.steps ?? t.steps)) / gcd(g, p.steps ?? t.steps), t.steps);
  const length = t.bars * t.beatsPerBar * grid;
  const at: Prepared['at'] = Array.from({ length }, () => []);
  t.parts.forEach((p, part) => {
    const k = grid / (p.steps ?? t.steps);
    for (const ev of parsePart(p.seq, p.inst === 'drums').events) {
      at[(ev.step * k) % length].push({ part, inst: p.inst, vol: p.vol, ev: { ...ev, step: ev.step * k, len: ev.len * k } });
    }
  });
  // Swing pushes the off-beat of every pair of the track's steps late, and squeezes the time around it to fit.
  const base = 60 / t.bpm / t.steps;
  const perBase = grid / t.steps;
  const swing = t.swing ?? 0;
  const time = (pos: number) => {
    const p = pos / perBase;
    const pair = Math.floor(p / 2);
    const w = p - 2 * pair;
    return (2 * pair + (w <= 1 ? w * (1 + swing) : 1 + swing + (w - 1) * (1 - swing))) * base;
  };
  return { id, def: t, length, loopDur: length * (base / perBase), at, time };
}

const hz = (m: number) => 440 * 2 ** ((m - 69) / 12);
const slop = (amount: number) => (Math.random() * 2 - 1) * amount;
/** Nudges a time, but never before the context's time 0 (WebAudio refuses those). */
const nudge = (t: number, by: number) => Math.max(0, t + by);

/** One track's strip on the desk. */
interface Mix {
  /** Fades the track in and out and mutes it. */
  out: GainNode;
  /** Pushed down by every kick. */
  pump: GainNode;
  /** Where each part plays into. */
  parts: AudioNode[];
}

class Music {
  private track: Prepared | null = null;
  private mix: Mix | null = null;
  private step = 0;
  /** When the current loop started, in context time. */
  private loopStart = 0;
  private timer: number | undefined;
  private noiseBuf: AudioBuffer | null = null;
  private roomBuf: AudioBuffer | null = null;
  private master: { ctx: BaseAudioContext; input: GainNode; dip: GainNode } | null = null;
  private dipUntil = 0;
  private cache = new Map<TrackId, Prepared>();

  constructor() {
    sound.onPlay = (end) => this.dip(end);
  }

  /** Switch to a track (or silence). Asking for the one already playing does nothing. */
  play(id: TrackId | null) {
    if ((this.track?.id ?? null) === id) return;
    this.fadeOut();
    if (!id) {
      this.track = null;
      return;
    }
    this.track = this.prepared(id);
    this.step = 0;
    if (this.timer === undefined) this.timer = window.setInterval(() => this.tick(), TICK_MS);
  }

  stop() {
    this.play(null);
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private prepared(id: TrackId): Prepared {
    if (!this.cache.has(id)) this.cache.set(id, prepare(id));
    return this.cache.get(id)!;
  }

  private fadeOut() {
    const ctx = sound.context;
    const mix = this.mix;
    this.mix = null;
    if (!ctx || !mix) return;
    mix.out.gain.cancelScheduledValues(ctx.currentTime);
    mix.out.gain.setTargetAtTime(0, ctx.currentTime, FADE / 4);
    window.setTimeout(() => mix.out.disconnect(), FADE * 2000);
  }

  private tick() {
    const ctx = sound.context;
    const t = this.track;
    if (!ctx || ctx.state !== 'running' || !t) return;
    const now = ctx.currentTime;
    if (!this.mix) {
      this.mix = this.createMix(ctx, t);
      // A new track starts just after the old one has faded a little.
      this.loopStart = now + 0.15;
    }
    this.mix.out.gain.setTargetAtTime(sound.muted ? 0 : 1, now, 0.15);
    // After a stall (a hidden tab), pick up from now rather than rushing to catch up.
    const next = this.loopStart + t.time(this.step);
    if (next < now - 0.1) this.loopStart += now + 0.05 - next;
    for (;;) {
      const start = this.loopStart + t.time(this.step);
      if (start >= now + LOOKAHEAD) break;
      if (!sound.muted) for (const n of t.at[this.step]) this.voice(ctx, this.mix, t, n, start);
      if (++this.step === t.length) {
        this.step = 0;
        this.loopStart += t.loopDur;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // The desk
  // ---------------------------------------------------------------------------

  /** Everything goes through one compressor, then the music level, then a dip for the sound effects. */
  private masterIn(ctx: BaseAudioContext): AudioNode {
    if (this.master?.ctx !== ctx) {
      const input = ctx.createGain();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -20;
      comp.knee.value = 12;
      comp.ratio.value = 3.5;
      comp.attack.value = 0.006;
      comp.release.value = 0.25;
      const level = ctx.createGain();
      level.gain.value = LEVEL;
      const dip = ctx.createGain();
      input.connect(comp).connect(level).connect(dip).connect(ctx.destination);
      this.master = { ctx, input, dip };
    }
    return this.master.input;
  }

  /** Ducks the music while a sound effect plays, until `end` (context time). */
  private dip(end: number) {
    const ctx = sound.context;
    if (!ctx || this.master?.ctx !== ctx) return;
    const now = ctx.currentTime;
    this.dipUntil = Math.max(this.dipUntil, end);
    const g = this.master.dip.gain;
    g.cancelScheduledValues(now);
    g.setTargetAtTime(DIP, now, 0.02);
    g.setTargetAtTime(1, this.dipUntil, 0.12);
  }

  private createMix(ctx: BaseAudioContext, t: Prepared): Mix {
    const def = t.def;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(this.masterIn(ctx));
    const pump = ctx.createGain();
    pump.connect(out);
    const reverb = ctx.createConvolver();
    reverb.buffer = this.room(ctx);
    reverb.connect(out);
    let echo: AudioNode | null = null;
    if (def.echo) {
      // Each repeat comes back a little darker.
      const delay = ctx.createDelay(2);
      delay.delayTime.value = (def.echo.beats * 60) / def.bpm;
      const tone = ctx.createBiquadFilter();
      tone.type = 'lowpass';
      tone.frequency.value = 2500;
      const feedback = ctx.createGain();
      feedback.gain.value = def.echo.feedback;
      delay.connect(tone).connect(feedback).connect(delay);
      tone.connect(pump);
      echo = delay;
    }
    const send = (from: AudioNode, to: AudioNode, amount: number) => {
      if (amount <= 0) return;
      const g = ctx.createGain();
      g.gain.value = amount;
      from.connect(g).connect(to);
    };
    const parts = def.parts.map((p) => {
      const pan = ctx.createStereoPanner();
      pan.pan.value = p.pan ?? 0;
      pan.connect(def.pump && p.inst !== 'drums' ? pump : out);
      send(pan, reverb, p.rev ?? REVERB[p.inst]);
      if (echo) send(pan, echo, p.echo ?? 0);
      return pan;
    });
    return { out, pump, parts };
  }

  /** A made-up room: stereo noise that dies away over 1.8 s and gets darker as it goes. */
  private room(ctx: BaseAudioContext): AudioBuffer {
    if (!this.roomBuf || this.roomBuf.sampleRate !== ctx.sampleRate) {
      const sr = ctx.sampleRate;
      const sec = 1.8;
      const buf = ctx.createBuffer(2, Math.floor(sec * sr), sr);
      for (let c = 0; c < 2; c++) {
        const d = buf.getChannelData(c);
        let lp = 0;
        for (let i = 0; i < d.length; i++) {
          const s = i / sr;
          lp += (Math.random() * 2 - 1 - lp) * (0.9 - 0.75 * (i / d.length));
          d[i] = lp * Math.exp((-6.9 * s) / sec) * Math.min(1, s / 0.01);
        }
      }
      this.roomBuf = buf;
    }
    return this.roomBuf;
  }

  private noise(ctx: BaseAudioContext) {
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

  // ---------------------------------------------------------------------------
  // The band
  // ---------------------------------------------------------------------------

  private voice(ctx: BaseAudioContext, mix: Mix, t: Prepared, n: Scheduled, start: number) {
    const { ev, inst } = n;
    const out = mix.parts[n.part];
    if (inst === 'drums') {
      ev.notes.forEach((d, i) => {
        // The kick stays on the grid: it's what the pump follows.
        const at = d === 'k' ? start : nudge(start, slop(LOOSE.drums));
        if (d === 'k' && t.def.pump) this.pumpAt(mix, t.def.pump, at);
        this.drum(ctx, out, String(d), n.vol * ev.vel[i] * (1 + slop(VEL_SLOP)), at);
      });
      return;
    }
    const at = nudge(start, slop(LOOSE[inst]));
    const dur = t.time(ev.step + ev.len) - t.time(ev.step);
    const each = n.vol / Math.sqrt(ev.notes.length);
    ev.notes.forEach((m, i) => {
      const vel = ev.vel[i];
      this.tone(ctx, out, inst, hz(Number(m)), each * vel * (1 + slop(VEL_SLOP)), at, dur, {
        bright: vel,
        from: ev.slide === undefined ? undefined : hz(ev.slide),
        trill: ev.trill === undefined ? undefined : hz(ev.trill),
      });
    });
    if (ev.grace !== undefined) this.tone(ctx, out, inst, hz(ev.grace), each * 0.7, nudge(at, -GRACE), GRACE, { bright: 1 });
  }

  private pumpAt(mix: Mix, depth: number, t: number) {
    const g = mix.pump.gain;
    g.setTargetAtTime(1 - depth, t, 0.004);
    g.setTargetAtTime(1, t + 0.04, 0.09);
  }

  /** One pitched note: oscillators → filter → envelope. Louder notes are a little brighter too. */
  private tone(
    ctx: BaseAudioContext,
    out: AudioNode,
    inst: Inst,
    f: number,
    vol: number,
    t: number,
    dur: number,
    opts: { bright: number; from?: number; trill?: number },
  ) {
    const env = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.connect(env).connect(out);
    const bright = 0.65 + 0.35 * opts.bright;
    const cutoff = (v: number) => (filter.frequency.value = v * bright);
    const oscs: { o: OscillatorNode; mult: number }[] = [];
    const lfos: OscillatorNode[] = [];
    /** `pan` spreads detuned oscillators apart for width. */
    const osc = (type: OscillatorType, mult = 1, detune = 0, gain = 1, pan = 0) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f * mult;
      o.detune.value = detune;
      let to: AudioNode = filter;
      if (pan) {
        const p = ctx.createStereoPanner();
        p.pan.value = pan;
        p.connect(to);
        to = p;
      }
      if (gain !== 1) {
        const g = ctx.createGain();
        g.gain.value = gain;
        g.connect(to);
        to = g;
      }
      o.connect(to);
      oscs.push({ o, mult });
      return o;
    };
    const vibrato = (rate: number, depth: GainNode) => {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = rate;
      lfo.connect(depth);
      for (const { o } of oscs) depth.connect(o.detune);
      lfos.push(lfo);
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
        cutoff(700);
        adsr(0.01, 0.25, 0.55, 0.08);
        break;
      case 'accordion': {
        osc('sawtooth', 1, -7, 1, -0.5);
        osc('sawtooth', 1, 7, 1, 0.5);
        osc('square', 2, 0, 0.25);
        cutoff(1900);
        filter.Q.value = 1.5;
        const depth = ctx.createGain();
        depth.gain.value = 6;
        vibrato(5.5, depth);
        adsr(0.03, 0.2, 0.8, 0.08);
        break;
      }
      case 'pluck':
        osc('triangle');
        osc('square', 1, 0, 0.2);
        filter.frequency.setValueAtTime(4000 * bright, t);
        filter.frequency.exponentialRampToValueAtTime(600 * bright, t + 0.25);
        adsr(0.005, 0.18, 0.15, 0.12);
        break;
      case 'ep':
        osc('sine');
        osc('sine', 2, 3, 0.25);
        osc('triangle', 1, -4, 0.3);
        cutoff(2600);
        adsr(0.008, 1.2, 0.25, 0.3);
        break;
      case 'pad':
        osc('sawtooth', 1, -10, 1, -0.6);
        osc('sawtooth', 1, 10, 1, 0.6);
        cutoff(900);
        adsr(0.25, 0.5, 0.8, 0.4);
        break;
      case 'lead':
        osc('square', 1, 0, 1, -0.3);
        osc('square', 1, 8, 0.5, 0.3);
        cutoff(2800);
        adsr(0.01, 0.15, 0.7, 0.06);
        break;
      case 'sax': {
        osc('sawtooth');
        osc('triangle', 1, 5, 0.5);
        cutoff(1500);
        filter.Q.value = 3;
        // Vibrato that grows into long notes.
        const depth = ctx.createGain();
        depth.gain.setValueAtTime(0, t);
        depth.gain.linearRampToValueAtTime(14, t + Math.min(0.6, dur));
        vibrato(5, depth);
        adsr(0.07, 0.3, 0.75, 0.15);
        break;
      }
      case 'bell':
        osc('sine');
        osc('sine', 2.76, 0, 0.3);
        osc('sine', 5.4, 0, 0.1);
        cutoff(8000);
        g.setValueAtTime(0.0001, t);
        g.linearRampToValueAtTime(vol, t + 0.005);
        g.setTargetAtTime(0.0001, t + 0.005, 0.5);
        end = t + 2.2;
        break;
    }
    for (const { o, mult } of oscs) {
      if (opts.from) {
        o.frequency.setValueAtTime(opts.from * mult, t);
        o.frequency.exponentialRampToValueAtTime(f * mult, t + Math.min(GLIDE, dur / 2));
      }
      if (opts.trill) {
        // Starts on the note, then flutters with the one above until the note ends.
        for (let k = 1; t + k * TRILL < t + dur - TRILL / 2; k++) o.frequency.setValueAtTime((k % 2 ? opts.trill : f) * mult, t + k * TRILL);
      }
    }
    for (const o of [...oscs.map((x) => x.o), ...lfos]) {
      o.start(t);
      o.stop(end + 0.05);
    }
  }

  private drum(ctx: BaseAudioContext, out: AudioNode, d: string, vol: number, t: number) {
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
