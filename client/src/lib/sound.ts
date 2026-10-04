/** Tiny synthesized sound effects for the TV (no audio files to download). */

type Wave = OscillatorType;

class Sound {
  private ctx: AudioContext | null = null;
  muted = false;

  /** Must be called from a user gesture at least once (browser autoplay rules). */
  unlock() {
    try {
      if (!this.ctx) this.ctx = new AudioContext();
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      /* no audio support */
    }
  }

  private tone(freq: number, dur: number, opts: { type?: Wave; vol?: number; delay?: number; slide?: number } = {}) {
    if (this.muted || !this.ctx || this.ctx.state !== 'running') return;
    const { type = 'sine', vol = 0.2, delay = 0, slide } = opts;
    const t0 = this.ctx.currentTime + delay;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.05);
  }

  private noise(dur: number, vol = 0.25) {
    if (this.muted || !this.ctx || this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 2;
    const src = ctx.createBufferSource();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 1400;
    gain.gain.value = vol;
    src.buffer = buf;
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start();
  }

  join() {
    this.tone(520, 0.12, { type: 'triangle' });
    this.tone(780, 0.18, { type: 'triangle', delay: 0.08 });
  }
  leave() {
    this.tone(500, 0.15, { type: 'triangle', slide: 300 });
  }
  tick() {
    this.tone(1200, 0.05, { type: 'square', vol: 0.05 });
  }
  count() {
    this.tone(660, 0.16, { type: 'square', vol: 0.12 });
  }
  go() {
    this.tone(990, 0.35, { type: 'square', vol: 0.14 });
  }
  crash() {
    this.noise(0.35, 0.35);
    this.tone(180, 0.3, { type: 'sawtooth', vol: 0.12, slide: 60 });
  }
  pickup() {
    this.tone(880, 0.08, { type: 'triangle' });
    this.tone(1320, 0.12, { type: 'triangle', delay: 0.06 });
  }
  lockIn() {
    this.tone(700, 0.07, { type: 'triangle', vol: 0.12 });
  }
  correct() {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.22, { type: 'triangle', delay: i * 0.08 }));
  }
  wrong() {
    this.tone(220, 0.4, { type: 'sawtooth', vol: 0.1, slide: 140 });
  }
  reveal() {
    this.tone(392, 0.15, { type: 'triangle' });
    this.tone(523, 0.3, { type: 'triangle', delay: 0.12 });
  }
  fanfare() {
    const notes = [523, 523, 523, 698, 880, 784, 1047];
    const times = [0, 0.12, 0.24, 0.36, 0.6, 0.78, 0.96];
    notes.forEach((f, i) => this.tone(f, i === notes.length - 1 ? 0.7 : 0.18, { type: 'square', vol: 0.09, delay: times[i] }));
  }
  whoosh() {
    this.tone(300, 0.25, { type: 'sine', vol: 0.1, slide: 900 });
  }
}

export const sound = new Sound();
