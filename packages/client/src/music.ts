// Ocean ambience and a generative sea shanty, both synthesized. The shanty is in D dorian at
// 96 bpm: accordion chords, plucked bass and a tin-whistle melody built from seeded phrases
// (A A B A), with a drum layer that fades in while fighting is on screen.
import type { AudioEngine, Kit } from './audio.ts';

const BPM = 96;
const STEP = 60 / BPM / 2; // eighth notes
/** Lookahead for scheduling notes ahead of the audio clock. */
const AHEAD = 0.25;

/** D dorian, semitones from D. */
const SCALE = [0, 2, 3, 5, 7, 9, 10];
/** Chord roots (scale degree) per bar over 8 bars: i VII VI VII | i III VII i. */
const PROGRESSION = [0, 6, 5, 6, 0, 2, 6, 0];
const D3 = 146.83;

const freq = (degree: number, octave = 0) => {
  const d = ((degree % 7) + 7) % 7, o = Math.floor(degree / 7) + octave;
  return D3 * 2 ** ((SCALE[d]! + 12 * o) / 12);
};

/** Small seeded generator so a melody repeats the same way each time around. */
function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
}

/** A two-bar melody: degrees (or null for a rest) on eighth-note steps. */
function phrase(seed: number, startDegree: number): (number | null)[] {
  const r = rng(seed);
  const out: (number | null)[] = [];
  let d = startDegree;
  const rhythm = [[1, 0, 1, 1, 1, 0, 1, 0], [1, 1, 1, 0, 1, 0, 1, 1], [1, 0, 0, 1, 1, 1, 1, 0]];
  for (let bar = 0; bar < 2; bar++) {
    const pattern = rhythm[Math.floor(r() * rhythm.length)]!;
    for (const hit of pattern) {
      if (!hit) { out.push(null); continue; }
      d += [-2, -1, -1, 0, 1, 1, 2][Math.floor(r() * 7)]!;
      d = Math.max(3, Math.min(12, d));
      out.push(d);
    }
  }
  return out;
}

export class Music {
  private readonly audio: AudioEngine;
  private step = 0;
  private nextAt = 0;
  private timer: number | undefined;
  private intensity = 0;
  private melodies: (number | null)[][] = [];
  private layers!: { pad: Kit; bass: Kit; lead: Kit; drums: Kit; drumGain: GainNode; leadGain: GainNode };
  /** Rain on the sea, faded in by the weather. */
  private rainGain?: GainNode;
  private rain = 0;

  constructor(audio: AudioEngine) {
    this.audio = audio;
    const a = phrase(7, 7), b = phrase(19, 9);
    this.melodies = [a, a, b, a];
  }

  start(): void {
    const ctx = this.audio.ctx;
    const out = this.audio.musicOut;
    if (!ctx || !out || this.timer !== undefined) return;
    const layer = (gain: number) => { const g = ctx.createGain(); g.gain.value = gain; g.connect(out); return g; };
    const drumGain = layer(0), leadGain = layer(0.5);
    this.layers = { pad: this.audio.kit(layer(0.5)), bass: this.audio.kit(layer(0.7)), lead: this.audio.kit(leadGain), drums: this.audio.kit(drumGain), drumGain, leadGain };
    this.startOcean(ctx);
    this.nextAt = ctx.currentTime + 0.3;
    this.timer = window.setInterval(() => this.schedule(), 60);
  }

  /** 0 (calm) to 1 (battle on screen); drums and the lead follow it smoothly. */
  setIntensity(value: number): void {
    this.intensity += (value - this.intensity) * 0.05;
    const ctx = this.audio.ctx;
    if (!ctx || !this.layers) return;
    this.layers.drumGain.gain.setTargetAtTime(this.intensity * 0.9, ctx.currentTime, 0.5);
    this.layers.leadGain.gain.setTargetAtTime(0.35 + this.intensity * 0.3, ctx.currentTime, 0.5);
  }

  private schedule(): void {
    const ctx = this.audio.ctx!;
    while (this.nextAt < ctx.currentTime + AHEAD) {
      this.playStep(this.step, this.nextAt);
      this.nextAt += STEP;
      this.step++;
    }
  }

  private playStep(step: number, t: number): void {
    const { pad, bass, lead, drums } = this.layers;
    const inBar = step % 8, bar = Math.floor(step / 8) % PROGRESSION.length;
    const root = PROGRESSION[bar]!;
    // Accordion: the triad held through the bar, re-pressed on beat 3 with a lighter touch.
    if (inBar === 0 || inBar === 4) {
      for (const deg of [root, root + 2, root + 4]) {
        const f = freq(deg, 1);
        const v = inBar === 0 ? 0.05 : 0.035;
        pad.tone(t, STEP * 4 * 0.95, 'sawtooth', f, v, { lowpass: 1300, attack: 0.04, detune: -7 });
        pad.tone(t, STEP * 4 * 0.95, 'sawtooth', f, v, { lowpass: 1300, attack: 0.04, detune: 7 });
      }
    }
    // Bass: root and fifth on the beats, oom-pah.
    if (inBar % 2 === 0) bass.tone(t, STEP * 1.6, 'triangle', freq(inBar % 4 === 0 ? root : root + 4, -1), 0.3, { attack: 0.005 });
    // Melody: four two-bar phrases.
    const melody = this.melodies[Math.floor(step / 16) % this.melodies.length]!;
    const deg = melody[step % 16];
    if (deg !== null && deg !== undefined) {
      lead.tone(t, STEP * 1.4, 'triangle', freq(deg, 1), 0.16, { attack: 0.01 });
      lead.tone(t, STEP * 0.9, 'square', freq(deg, 1), 0.03, { attack: 0.01, lowpass: 2400 });
    }
    // Drums (battle layer): kick on 1 and 3, frame drum on 2 and 4, shaker on eighths.
    if (inBar % 4 === 0) drums.tone(t, 0.25, 'sine', 120, 0.6, { toFreq: 45, sweep: 0.15 });
    if (inBar % 4 === 2) drums.noise(t, 0.18, 'bandpass', 900, 0.35, { toFreq: 300, q: 1 });
    drums.noise(t, 0.05, 'highpass', 7000, inBar % 2 ? 0.05 : 0.08);
  }

  /** Waves: low filtered noise swelling slowly, with a hiss of surf on top. */
  private startOcean(ctx: AudioContext): void {
    const out = this.audio.ambienceOut;
    if (!out) return;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; data[i] = last * 3.5; }
    const layer = (filter: BiquadFilterType, f: number, gain: number, lfoHz: number, depth: number) => {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      const bq = ctx.createBiquadFilter();
      bq.type = filter;
      bq.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = gain;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = lfoHz;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = depth;
      lfo.connect(lfoGain).connect(g.gain);
      src.connect(bq).connect(g).connect(out);
      src.start();
      lfo.start();
    };
    layer('lowpass', 420, 0.35, 0.09, 0.2);
    layer('bandpass', 1800, 0.06, 0.13, 0.05);
    // Rain: a bright hiss, silent until the weather turns.
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2600;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = this.rain;
    src.connect(hp).connect(this.rainGain).connect(out);
    src.start();
  }

  /** Rain loudness, 0 (dry) … 1 (downpour), faded over a few seconds. */
  setRain(level: number): void {
    this.rain = level * 0.5;
    const g = this.rainGain;
    if (g) g.gain.setTargetAtTime(this.rain, g.context.currentTime, 2);
  }
}
