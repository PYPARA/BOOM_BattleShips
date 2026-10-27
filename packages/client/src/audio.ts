// Sound: a Web Audio mixer (effects, music, interface), positional volume and panning relative
// to where the camera looks, voice limits so a fleet battle does not turn into noise, and
// synthesized sounds. The image API offers no audio models, so every sound is built from
// oscillators and noise; a file at public/audio/<name>.ogg replaces its synth version.

export type SoundName =
  | 'cannon' | 'bigCannon' | 'hit' | 'splash' | 'explosion' | 'bigExplosion' | 'sink'
  | 'fire' | 'frost' | 'lightning' | 'magic' | 'heal' | 'curse' | 'shield' | 'blink' | 'buff'
  | 'click' | 'coin' | 'buy' | 'deny' | 'levelUp' | 'learn' | 'respawn'
  | 'announce' | 'killed' | 'victory' | 'defeat';

interface Voice { name: SoundName; at: number }

/** How far (world units) from the camera target a sound can still be heard. */
const HEARING = 3200;
/** Per sound: the most voices at once and the shortest gap between two of them (ms). */
const LIMITS: Partial<Record<SoundName, [number, number]>> = {
  cannon: [10, 35], bigCannon: [6, 60], hit: [8, 40], splash: [6, 60], explosion: [8, 80], coin: [3, 60],
};
const MAX_VOICES = 28;

const STORAGE_KEY = 'boom.audio';

export interface AudioSettings { sfx: number; music: number; muted: boolean }

export class AudioEngine {
  ctx: AudioContext | undefined;
  private master!: GainNode;
  private sfxBus!: GainNode;
  private musicBus!: GainNode;
  private noise!: AudioBuffer;
  private voices: Voice[] = [];
  private readonly files = new Map<SoundName, AudioBuffer>();
  private listener = { x: 0, y: 0, distance: 2400 };
  readonly settings: AudioSettings = { sfx: 0.8, music: 0.45, muted: false };
  /** Called once the context exists (after the first user gesture). */
  onStart: (() => void) | undefined;

  constructor() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<AudioSettings> | null;
      if (saved) Object.assign(this.settings, saved);
    } catch { /* storage may be unavailable */ }
    // Browsers only allow audio after a gesture.
    const start = () => { this.start(); window.removeEventListener('pointerdown', start); window.removeEventListener('keydown', start); };
    window.addEventListener('pointerdown', start);
    window.addEventListener('keydown', start);
  }

  private start(): void {
    if (this.ctx) return;
    const ctx = new AudioContext();
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.connect(comp);
    this.sfxBus = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.sfxBus.connect(this.master);
    this.musicBus.connect(this.master);
    this.applySettings();
    // Two seconds of white noise, shared by every noisy sound.
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    void this.loadFiles();
    this.onStart?.();
  }

  /** Optional recorded replacements; missing files are fine. */
  private async loadFiles(): Promise<void> {
    const names: SoundName[] = ['cannon', 'bigCannon', 'hit', 'splash', 'explosion', 'bigExplosion', 'sink', 'fire', 'frost', 'lightning',
      'magic', 'heal', 'curse', 'shield', 'blink', 'buff', 'click', 'coin', 'buy', 'deny', 'levelUp', 'learn', 'respawn', 'announce', 'killed', 'victory', 'defeat'];
    await Promise.all(names.map(async (n) => {
      try {
        const r = await fetch(`${import.meta.env.BASE_URL}audio/${n}.ogg`);
        if (!r.ok || !(r.headers.get('content-type') ?? '').includes('audio')) return;
        this.files.set(n, await this.ctx!.decodeAudioData(await r.arrayBuffer()));
      } catch { /* keep the synth version */ }
    }));
  }

  applySettings(): void {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings)); } catch { /* ignore */ }
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.settings.muted ? 0 : 1, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(this.settings.sfx, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.settings.music, t, 0.05);
  }

  get musicOut(): GainNode | undefined { return this.ctx ? this.musicBus : undefined; }
  /** Ambience (the sea) follows the effects volume. */
  get ambienceOut(): GainNode | undefined { return this.ctx ? this.sfxBus : undefined; }

  /** Where the camera looks (sim space) and how far out it is zoomed. */
  setListener(x: number, y: number, distance: number): void {
    this.listener = { x, y, distance };
  }

  /**
   * Plays a sound. With a position it is quieter and panned by distance from the camera
   * target; without one it is an interface sound at full volume.
   */
  play(name: SoundName, at?: { x: number; y: number }, opts: { gain?: number; pitch?: number; size?: number } = {}): void {
    const ctx = this.ctx;
    if (!ctx || this.settings.muted) return;
    const now = performance.now();
    this.voices = this.voices.filter((v) => now - v.at < 1500);
    const [max, gap] = LIMITS[name] ?? [6, 20];
    const same = this.voices.filter((v) => v.name === name);
    if (same.length >= max || (same.length && now - same[same.length - 1]!.at < gap) || this.voices.length >= MAX_VOICES) return;

    let gain = opts.gain ?? 1, pan = 0;
    if (at) {
      const dx = at.x - this.listener.x, dy = at.y - this.listener.y;
      const range = HEARING * Math.max(0.7, this.listener.distance / 2400);
      const d = Math.hypot(dx, dy);
      if (d > range) return;
      gain *= (1 - d / range) ** 1.6 * Math.min(1, 1900 / Math.max(900, this.listener.distance));
      pan = Math.max(-0.9, Math.min(0.9, dx / (range * 0.6)));
      if (gain < 0.02) return;
    }
    this.voices.push({ name, at: now });
    const out = ctx.createGain();
    out.gain.value = gain;
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    out.connect(panner).connect(this.sfxBus);
    const t = ctx.currentTime + 0.005;
    const file = this.files.get(name);
    if (file) {
      const src = ctx.createBufferSource();
      src.buffer = file;
      src.playbackRate.value = opts.pitch ?? 1;
      src.connect(out);
      src.start(t);
      return;
    }
    SYNTHS[name](this.kit(out), t, opts.size ?? 1, opts.pitch ?? 1);
  }

  /** Building blocks the synth recipes use, bound to an output node. */
  kit(out: AudioNode): Kit {
    const ctx = this.ctx!;
    const noise = this.noise;
    const env = (node: GainNode, t: number, attack: number, peak: number, decay: number) => {
      node.gain.setValueAtTime(0.0001, t);
      node.gain.exponentialRampToValueAtTime(peak, t + attack);
      node.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    };
    return {
      ctx,
      noise: (t, dur, filter: BiquadFilterType, freq: number, peak: number, opts = {}) => {
        const src = ctx.createBufferSource();
        src.buffer = noise;
        src.loop = true;
        const f = ctx.createBiquadFilter();
        f.type = filter;
        f.frequency.setValueAtTime(freq, t);
        if (opts.toFreq) f.frequency.exponentialRampToValueAtTime(opts.toFreq, t + dur);
        f.Q.value = opts.q ?? 0.8;
        const g = ctx.createGain();
        env(g, t, opts.attack ?? 0.004, peak, dur);
        src.connect(f).connect(g).connect(out);
        src.start(t, Math.random() * 1.5);
        src.stop(t + dur + 0.1);
      },
      tone: (t, dur, type: OscillatorType, freq: number, peak: number, opts = {}) => {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.setValueAtTime(freq, t);
        if (opts.toFreq) o.frequency.exponentialRampToValueAtTime(opts.toFreq, t + (opts.sweep ?? dur));
        o.detune.value = opts.detune ?? 0;
        const g = ctx.createGain();
        env(g, t, opts.attack ?? 0.005, peak, dur);
        let node: AudioNode = o;
        if (opts.lowpass) {
          const f = ctx.createBiquadFilter();
          f.type = 'lowpass';
          f.frequency.value = opts.lowpass;
          node = o.connect(f);
        }
        node.connect(g).connect(out);
        o.start(t);
        o.stop(t + (opts.attack ?? 0.005) + dur + 0.05);
      },
    };
  }
}

export interface Kit {
  ctx: AudioContext;
  noise(t: number, dur: number, filter: BiquadFilterType, freq: number, peak: number, opts?: { toFreq?: number; q?: number; attack?: number }): void;
  tone(t: number, dur: number, type: OscillatorType, freq: number, peak: number, opts?: { toFreq?: number; sweep?: number; detune?: number; attack?: number; lowpass?: number }): void;
}

type Synth = (k: Kit, t: number, size: number, pitch: number) => void;

/** A note's frequency, semitones from A4. */
const note = (semi: number) => 440 * 2 ** (semi / 12);

const SYNTHS: Record<SoundName, Synth> = {
  cannon: (k, t, s, p) => {
    k.noise(t, 0.28 * s, 'lowpass', 1400 * p, 0.55, { toFreq: 300 });
    k.tone(t, 0.22 * s, 'sine', 120 * p, 0.6, { toFreq: 45 });
  },
  bigCannon: (k, t, s, p) => {
    k.noise(t, 0.6 * s, 'lowpass', 900 * p, 0.7, { toFreq: 150 });
    k.tone(t, 0.45 * s, 'sine', 80 * p, 0.8, { toFreq: 30 });
    k.noise(t + 0.03, 0.9, 'bandpass', 300, 0.2, { toFreq: 120 });
  },
  hit: (k, t, s, p) => {
    k.noise(t, 0.12 * s, 'bandpass', 1800 * p, 0.45, { q: 1.4, toFreq: 700 });
    k.tone(t, 0.06, 'square', 220 * p, 0.12, { toFreq: 90, lowpass: 1500 });
  },
  splash: (k, t, s) => {
    k.noise(t, 0.45 * s, 'bandpass', 2600, 0.35, { toFreq: 600, q: 0.7, attack: 0.01 });
    k.noise(t + 0.05, 0.3 * s, 'highpass', 4000, 0.12);
  },
  explosion: (k, t, s, p) => {
    k.noise(t, 0.9 * s, 'lowpass', 1200 * p, 0.8, { toFreq: 120 });
    k.tone(t, 0.6 * s, 'sine', 70 * p, 0.7, { toFreq: 28 });
    k.noise(t + 0.08, 0.5, 'bandpass', 2500, 0.15, { toFreq: 800 });
  },
  bigExplosion: (k, t, s) => {
    k.noise(t, 1.8 * s, 'lowpass', 900, 1, { toFreq: 60 });
    k.tone(t, 1.2 * s, 'sine', 55, 0.9, { toFreq: 22 });
    for (let i = 0; i < 4; i++) k.noise(t + 0.15 + i * 0.18 * Math.random(), 0.4, 'bandpass', 1500 + Math.random() * 1500, 0.15, { toFreq: 400 });
  },
  sink: (k, t) => {
    SYNTHS.explosion(k, t, 1.1, 0.9);
    // Timbers groaning, then bubbles.
    k.tone(t + 0.3, 1.4, 'sawtooth', 70, 0.12, { toFreq: 48, lowpass: 500, attack: 0.3 });
    for (let i = 0; i < 9; i++) k.tone(t + 0.6 + i * 0.15 + Math.random() * 0.1, 0.08, 'sine', 300 + Math.random() * 500, 0.08, { toFreq: 900 + Math.random() * 600 });
    k.noise(t + 0.4, 1.6, 'lowpass', 600, 0.2, { toFreq: 200, attack: 0.4 });
  },
  fire: (k, t, s) => {
    k.noise(t, 1.1 * s, 'bandpass', 500, 0.45, { toFreq: 1800, attack: 0.15, q: 0.5 });
    for (let i = 0; i < 6; i++) k.noise(t + Math.random() * 0.9, 0.03, 'highpass', 3000, 0.15);
  },
  frost: (k, t) => {
    for (let i = 0; i < 6; i++) k.tone(t + i * 0.035, 0.9, 'sine', note(24 + [0, 3, 7, 10, 14, 19][i]!), 0.07, { detune: Math.random() * 20 });
    k.noise(t, 0.5, 'highpass', 5000, 0.25, { toFreq: 9000 });
    for (let i = 0; i < 8; i++) k.noise(t + 0.1 + Math.random() * 0.5, 0.02, 'highpass', 6000, 0.15);
  },
  lightning: (k, t) => {
    k.noise(t, 0.18, 'highpass', 2500, 0.7);
    k.tone(t, 0.25, 'sawtooth', 1800, 0.18, { toFreq: 90, lowpass: 4000 });
    k.noise(t + 0.06, 0.8, 'lowpass', 400, 0.35, { toFreq: 80 });
  },
  magic: (k, t, _s, p) => {
    for (let i = 0; i < 3; i++) k.tone(t + i * 0.02, 0.7, 'sine', 300 * p * (1 + i * 0.5), 0.12, { toFreq: 900 * p * (1 + i * 0.5), sweep: 0.5, attack: 0.05 });
    k.noise(t, 0.6, 'bandpass', 1200, 0.12, { toFreq: 4000, attack: 0.1 });
  },
  heal: (k, t) => {
    [0, 4, 7, 12].forEach((n, i) => k.tone(t + i * 0.08, 0.6, 'triangle', note(n + 3), 0.14));
    k.noise(t, 0.7, 'highpass', 6000, 0.06, { attack: 0.2 });
  },
  curse: (k, t) => {
    k.tone(t, 0.9, 'sawtooth', 110, 0.15, { toFreq: 70, lowpass: 700, attack: 0.08 });
    k.tone(t, 0.9, 'sawtooth', 116, 0.12, { toFreq: 74, lowpass: 700, attack: 0.08 });
    k.noise(t, 0.6, 'bandpass', 500, 0.12, { toFreq: 200 });
  },
  shield: (k, t) => {
    k.tone(t, 0.8, 'sine', 220, 0.18, { toFreq: 660, sweep: 0.3, attack: 0.03 });
    k.tone(t, 0.8, 'sine', 331, 0.1, { toFreq: 990, sweep: 0.3, attack: 0.03 });
    k.noise(t, 0.4, 'bandpass', 2000, 0.08, { toFreq: 6000 });
  },
  blink: (k, t) => {
    k.noise(t, 0.35, 'bandpass', 600, 0.3, { toFreq: 5000, attack: 0.05 });
    k.tone(t, 0.3, 'sine', 400, 0.12, { toFreq: 1600 });
  },
  buff: (k, t) => {
    [0, 7, 12].forEach((n, i) => k.tone(t + i * 0.05, 0.35, 'square', note(n), 0.05, { lowpass: 2500 }));
    k.noise(t, 0.4, 'bandpass', 900, 0.12, { toFreq: 3000, attack: 0.05 });
  },
  click: (k, t) => k.tone(t, 0.05, 'sine', 1300, 0.12, { toFreq: 900 }),
  coin: (k, t) => { k.tone(t, 0.08, 'square', note(26), 0.05, { lowpass: 5000 }); k.tone(t + 0.07, 0.2, 'square', note(31), 0.05, { lowpass: 5000 }); },
  buy: (k, t) => { SYNTHS.coin(k, t, 1, 1); k.tone(t + 0.12, 0.25, 'triangle', note(19), 0.1); },
  deny: (k, t) => { k.tone(t, 0.12, 'square', 140, 0.08, { lowpass: 900 }); k.tone(t + 0.13, 0.18, 'square', 110, 0.08, { lowpass: 900 }); },
  levelUp: (k, t) => [0, 4, 7, 12, 16].forEach((n, i) => k.tone(t + i * 0.07, 0.5, 'triangle', note(n + 3), 0.16)),
  learn: (k, t) => { k.tone(t, 0.25, 'triangle', note(15), 0.12); k.tone(t + 0.08, 0.35, 'triangle', note(22), 0.12); },
  respawn: (k, t) => brass(k, t, [-9, -2, 3], 0.9),
  announce: (k, t) => { brass(k, t, [-5, -1, 2], 0.25); brass(k, t + 0.22, [0, 4, 7], 0.7); k.noise(t, 0.6, 'lowpass', 300, 0.4, { toFreq: 60 }); },
  killed: (k, t) => { brass(k, t, [-12, -9, -5], 0.9); k.noise(t, 0.8, 'lowpass', 200, 0.4, { toFreq: 50 }); },
  victory: (k, t) => { brass(k, t, [0, 4, 7], 0.35); brass(k, t + 0.35, [2, 5, 9], 0.35); brass(k, t + 0.7, [4, 7, 12], 1.6); },
  defeat: (k, t) => { brass(k, t, [-3, 0, 4], 0.5); brass(k, t + 0.5, [-5, -2, 2], 0.5); brass(k, t + 1, [-8, -5, -1], 1.8); },
};

/** A brassy chord (detuned saws through a lowpass), semitones from A4. */
function brass(k: Kit, t: number, chord: number[], dur: number): void {
  for (const n of chord) {
    k.tone(t, dur, 'sawtooth', note(n - 12), 0.07, { lowpass: 1800, attack: 0.04, detune: -6 });
    k.tone(t, dur, 'sawtooth', note(n - 12), 0.07, { lowpass: 1800, attack: 0.04, detune: 6 });
  }
}

/** A speaker button that opens effects and music volume sliders and a mute switch. */
export function createVolumeControl(audio: AudioEngine): void {
  const root = Object.assign(document.body.appendChild(document.createElement('div')), { className: 'volume' });
  const s = audio.settings;
  root.innerHTML = `<button class="speaker" title="声音"></button>
    <div class="volume-panel">
      <label>音效<input type="range" min="0" max="1" step="0.05" data-key="sfx" value="${s.sfx}"></label>
      <label>音乐<input type="range" min="0" max="1" step="0.05" data-key="music" value="${s.music}"></label>
      <label class="mute"><input type="checkbox" data-key="muted" ${s.muted ? 'checked' : ''}>静音</label>
    </div>`;
  const speaker = root.querySelector<HTMLButtonElement>('.speaker')!;
  const icon = () => { speaker.textContent = s.muted ? '🔇' : '🔊'; };
  icon();
  speaker.addEventListener('click', () => root.classList.toggle('open'));
  root.addEventListener('input', (e) => {
    const input = e.target as HTMLInputElement;
    const key = input.dataset.key as keyof AudioSettings;
    if (key === 'muted') s.muted = input.checked;
    else s[key] = Number(input.value);
    audio.applySettings();
    icon();
  });
  // Sliders keep their keys to themselves (no skill hotkeys while dragging).
  root.addEventListener('keydown', (e) => e.stopPropagation());
}
