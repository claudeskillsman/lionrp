/*
 * Goldgrass procedural audio engine.
 *
 * Everything here is synthesised at runtime with the Web Audio API: noise buffers, oscillators,
 * biquad filters, envelopes and a convolution reverb whose impulse response is generated.
 * No external files are loaded.
 *
 * Signal flow
 *   ambienceBus ─┐
 *   sfxBus ──────┼─> worldDuck (pause duck) ─> worldFilter (underwater / pause muffle) ─┐
 *   reverb ──────┘                                                                    ├─> master ─> trim ─> glue comp ─> limiter ─> out
 *   uiBus ────────────────────────────────────────────────────────────────────────────┤
 *   musicBus (+ feedback delay) ──────────────────────────────────────────────────────┘
 *
 * Rough gain staging (pre-master, volumes at 1): a close roar peaks at about 0.9, footsteps at
 * about 0.1–0.25, the ambience bed sits around 0.03–0.08 RMS, distant birds peak around 0.01–0.08.
 */

export type Surface = 'grass' | 'dirt' | 'rock' | 'water' | 'mud' | 'sand';
export type CallKind = 'roar' | 'growl' | 'chuff' | 'meow' | 'snarl' | 'purr' | 'yawn';
export interface BiomeMix {
  grassland: number;
  woodland: number;
  kopjes: number;
  river: number;
  waterhole: number;
  canyon: number;
  highland: number;
}

type Vec3 = { x: number; y: number; z: number };
interface Volumes { master: number; ambience: number; sfx: number; music: number }
interface UpdateState {
  listener: { x: number; y: number; z: number; fx: number; fz: number };
  biome: BiomeMix;
  hour: number;
  rain: number;
  wind: number;
  underwater?: boolean;
  paused?: boolean;
}

// ---------------------------------------------------------------------------------------------
// Tuning knobs
// ---------------------------------------------------------------------------------------------

/** Overall trim of the continuous ambience bed (wind, water, rain, insects). */
const BED_TRIM = 1.15;
/** Overall trim of ambient one-shots (birds, frogs, owls...). */
const CRITTER_TRIM = 1.0;
/** Overall trim for animal calls (roar etc.). */
const CALL_TRIM = 1.0;
/** Overall trim for footsteps. */
const STEP_TRIM = 3.0;
/** Bed parameters are refreshed at this rate (Hz) rather than every frame. */
const CTRL_HZ = 15;
/** Volume slider -> gain curve (perceptual). */
const volCurve = (v: number): number => {
  const x = clamp(Number.isFinite(v) ? v : 0, 0, 1);
  return x * x;
};

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

const TAU = Math.PI * 2;
function clamp(x: number, a: number, b: number): number {
  return x < a ? a : x > b ? b : x;
}
const rand = (a: number, b: number): number => a + Math.random() * (b - a);
const randExp = (a: number, b: number): number => a * Math.pow(b / a, Math.random());
const randInt = (a: number, b: number): number => Math.floor(rand(a, b + 1));
const smooth = (t: number): number => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};
const smoothstep = (e0: number, e1: number, x: number): number => smooth((x - e0) / (e1 - e0));
const bell = (x: number, c: number, w: number): number => Math.exp(-(((x - c) / w) ** 2));
const expSample = (mean: number): number => -Math.log(1 - Math.random()) * mean;
const fin = (x: number, d = 0): number => (Number.isFinite(x) ? x : d);

/** Piecewise interpolation with smoothstep easing. k = [u0, v0, u1, v1, ...]. */
function pw(u: number, k: readonly number[]): number {
  if (u <= k[0]) return k[1];
  for (let i = 2; i < k.length; i += 2) {
    if (u <= k[i]) {
      const u0 = k[i - 2];
      const v0 = k[i - 1];
      const f = smooth((u - u0) / (k[i] - u0 || 1));
      return v0 + (k[i + 1] - v0) * f;
    }
  }
  return k[k.length - 1];
}

function pickWeighted<T extends string>(w: [T, number][]): T {
  let sum = 0;
  for (const [, x] of w) sum += Math.max(0, x);
  let r = Math.random() * sum;
  for (const [k, x] of w) {
    r -= Math.max(0, x);
    if (r <= 0) return k;
  }
  return w[0][0];
}

interface DayF { day: number; night: number; dawn: number; dusk: number; heat: number }
function dayFactors(hour: number): DayF {
  const h = ((fin(hour, 12) % 24) + 24) % 24;
  const up = smoothstep(5.5, 7, h);
  const down = 1 - smoothstep(17.5, 19.5, h);
  const day = Math.min(up, down);
  return {
    day,
    night: 1 - day,
    dawn: bell(h, 6.2, 0.85),
    dusk: bell(h, 18.5, 0.9),
    heat: 0.45 + 0.55 * bell(h, 13.5, 3.5),
  };
}

// ---------------------------------------------------------------------------------------------
// Buffer generators
// ---------------------------------------------------------------------------------------------

/** Loopable, DC-free noise normalised to RMS 0.3. */
function makeNoiseBuffer(ctx: BaseAudioContext, seconds: number, kind: 'white' | 'pink' | 'brown'): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * seconds);
  const fade = Math.floor(sr * 0.05);
  const raw = new Float32Array(n + fade);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, br = 0;
  for (let i = 0; i < raw.length; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === 'white') raw[i] = w;
    else if (kind === 'pink') {
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      raw[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
    } else {
      br = (br + 0.02 * w) / 1.02;
      raw[i] = br;
    }
  }
  let mean = 0;
  for (let i = 0; i < raw.length; i++) mean += raw[i];
  mean /= raw.length;
  let sq = 0;
  for (let i = 0; i < raw.length; i++) {
    raw[i] -= mean;
    sq += raw[i] * raw[i];
  }
  const k = 0.3 / Math.sqrt(sq / raw.length || 1e-9);
  const buf = ctx.createBuffer(1, n, sr);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) {
    let x = raw[i];
    if (i < fade) {
      // equal-power crossfade so the loop seam (end -> start) is continuous
      const a = i / fade;
      x = raw[i] * Math.sqrt(a) + raw[n + i] * Math.sqrt(1 - a);
    }
    d[i] = x * k;
  }
  return buf;
}

/** Smooth random control signal in [-1, 1] with `stepsPerSec` random points per second; loopable. */
function makeJitterBuffer(ctx: BaseAudioContext, seconds: number, stepsPerSec: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * seconds);
  const steps = Math.max(2, Math.round(seconds * stepsPerSec));
  const pts = new Float32Array(steps + 1);
  for (let i = 0; i < steps; i++) pts[i] = Math.random() * 2 - 1;
  pts[steps] = pts[0];
  const buf = ctx.createBuffer(1, n, sr);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) {
    const p = (i / n) * steps;
    const k = Math.floor(p);
    const s = (1 - Math.cos((p - k) * Math.PI)) / 2;
    d[i] = pts[k] * (1 - s) + pts[k + 1] * s;
  }
  return buf;
}

/** Outdoor-ish stereo reverb IR: pre-delay, sparse early reflections, damped diffuse tail. */
function makeIR(ctx: BaseAudioContext, dur: number, rt60: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const n = Math.floor(sr * dur);
  const ir = ctx.createBuffer(2, n, sr);
  const pre = Math.floor(0.018 * sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    let lp = 0;
    for (let i = pre; i < n; i++) {
      const t = (i - pre) / sr;
      const env = Math.exp((-6.91 * t) / rt60);
      const k = 0.07 + 0.88 * Math.exp(-t * 2.4); // bright early, darker late
      lp += k * (Math.random() * 2 - 1 - lp);
      d[i] = lp * env * Math.min(1, t / 0.006);
    }
    for (let r = 0; r < 12; r++) {
      const t = 0.008 + Math.random() * 0.11;
      const i = pre + Math.floor(t * sr);
      if (i < n) d[i] += (Math.random() < 0.5 ? -1 : 1) * rand(0.15, 0.5) * Math.exp(-t * 10);
    }
    // fade the very end
    const f = Math.floor(sr * 0.05);
    for (let i = 0; i < f; i++) d[n - 1 - i] *= i / f;
  }
  return ir;
}

const shaperCache = new Map<number, Float32Array>();
/** tanh soft-clip curve. Paired with a 0.5 pre-gain: in a -> tanh(drive*a)/tanh(2*drive). */
function shaperCurve(drive: number): Float32Array {
  const key = Math.round(drive * 10) / 10;
  const hit = shaperCache.get(key);
  if (hit) return hit;
  const n = 2048;
  const c = new Float32Array(n);
  const norm = Math.tanh(key * 2);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.tanh(key * 2 * x) / norm;
  }
  shaperCache.set(key, c);
  return c;
}

// ---------------------------------------------------------------------------------------------
// Voice bookkeeping
// ---------------------------------------------------------------------------------------------

class Voice {
  nodes: AudioNode[] = [];
  last: AudioScheduledSourceNode | null = null;
  lastStop = 0;
  add<T extends AudioNode>(n: T): T {
    this.nodes.push(n);
    return n;
  }
  play<T extends AudioScheduledSourceNode>(n: T, t0: number, t1: number, offset?: number): T {
    this.nodes.push(n);
    if (offset !== undefined && n instanceof AudioBufferSourceNode) n.start(t0, offset);
    else n.start(t0);
    n.stop(t1);
    if (t1 >= this.lastStop) {
      this.lastStop = t1;
      this.last = n;
    }
    return n;
  }
}

interface Pool { ends: number[]; max: number }
interface Layer { out: GainNode; f: BiquadFilterNode[][] }
interface Cicada { swell: GainNode; cur: number; target: number; timer: number }
interface Cricket { g: GainNode; next: number; period: number; pulses: number; pp: number; pw: number }
interface Note { t: number; d: number; f0: number; f1: number; a: number; pluck?: boolean; vib?: number; vd?: number }
interface ToneOpts { wave?: OscillatorType; h2?: number; h3?: number; bp?: [number, number]; level: number; dist: number; h: number }

interface VocalSpec {
  dur: number;
  f0: (t: number) => number;
  amp: (t: number) => number;
  noise: (t: number) => number;
  f1: (t: number) => number;
  f2: (t: number) => number;
  f3: (t: number) => number;
  hiss?: (t: number) => number;
  q: [number, number, number];
  fg: [number, number, number];
  body: number;
  bodyCut: number;
  sub: number;
  /** f0 jitter in cents */
  jitter: number;
  /** random amplitude-modulation depth (0..0.9) and its speed multiplier */
  rough: number;
  roughRate: number;
  /** periodic AM (purr) */
  pulseHz?: number;
  pulseDepth?: number;
  drive: number;
  gain: number;
  ref: number;
  wet: number;
  wave?: OscillatorType;
}

// ---------------------------------------------------------------------------------------------
// Core (only exists once an AudioContext is running)
// ---------------------------------------------------------------------------------------------

class Core {
  readonly ctx: AudioContext;
  private readonly nyq: number;
  private readonly white: AudioBuffer;
  private readonly pink: AudioBuffer;
  private readonly brown: AudioBuffer;
  private readonly jit: AudioBuffer;

  private readonly master: GainNode;
  private readonly worldDuck: GainNode;
  private readonly worldFilter: BiquadFilterNode;
  private readonly ambBus: GainNode;
  private readonly sfxBus: GainNode;
  private readonly uiBus: GainNode;
  private readonly musicBus: GainNode;
  private readonly revReturn: GainNode;
  private readonly ambRev: GainNode;
  private readonly sfxRev: GainNode;

  private vol: Volumes;
  private L = { x: 0, y: 0, z: 0, fx: 0, fz: -1 };
  private readonly pools = {
    sfx: { ends: [], max: 16 } as Pool,
    step: { ends: [], max: 14 } as Pool,
    amb: { ends: [], max: 12 } as Pool,
    tick: { ends: [], max: 18 } as Pool,
    bubble: { ends: [], max: 12 } as Pool,
    ui: { ends: [], max: 8 } as Pool,
    music: { ends: [], max: 3 } as Pool,
    thunder: { ends: [], max: 3 } as Pool,
  };

  // bed layers
  private windBody!: Layer;
  private windAir!: Layer;
  private rustle!: Layer;
  private whistleA!: Layer;
  private whistleB!: Layer;
  private waterBody!: Layer;
  private waterHiss!: Layer;
  private lapping!: Layer;
  private rainHiss!: Layer;
  private rainBody!: Layer;
  private underLayer!: Layer;
  private cicadas: Cicada[] = [];
  private insectField!: GainNode;
  private cricketOut!: GainNode;
  private crickets: Cricket[] = [];

  // state
  private bm: BiomeMix = { grassland: 1, woodland: 0, kopjes: 0, river: 0, waterhole: 0, canyon: 0, highland: 0 };
  private df: DayF = dayFactors(12);
  private rain = 0;
  private wind = 0.5;
  private gust = 0.7;
  private gustTarget = 0.7;
  private gustTimer = 0;
  private time = 0;
  private ctrlAcc = 1;
  private cricketLevel = 0;
  private timers: Record<string, number> = {};
  private padTimer = rand(6, 14);
  private paused = false;
  private under = false;

  constructor(ctx: AudioContext, vol: Volumes) {
    this.ctx = ctx;
    this.vol = { ...vol };
    this.nyq = ctx.sampleRate * 0.45;
    const c = ctx;

    this.white = makeNoiseBuffer(c, 3, 'white');
    this.pink = makeNoiseBuffer(c, 6, 'pink');
    this.brown = makeNoiseBuffer(c, 6, 'brown');
    this.jit = makeJitterBuffer(c, 4, 50);

    // master chain
    this.master = c.createGain();
    const trim = c.createGain();
    trim.gain.value = 0.7; // compensates the compressors' automatic make-up gain
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.knee.value = 10;
    comp.ratio.value = 2;
    comp.attack.value = 0.015;
    comp.release.value = 0.3;
    const lim = c.createDynamicsCompressor();
    lim.threshold.value = -2;
    lim.knee.value = 0;
    lim.ratio.value = 20;
    lim.attack.value = 0.001;
    lim.release.value = 0.12;
    this.master.connect(trim);
    trim.connect(comp);
    comp.connect(lim);
    lim.connect(c.destination);

    this.worldFilter = c.createBiquadFilter();
    this.worldFilter.type = 'lowpass';
    this.worldFilter.frequency.value = this.nyq;
    this.worldFilter.Q.value = 0.5;
    this.worldFilter.connect(this.master);
    this.worldDuck = c.createGain();
    this.worldDuck.connect(this.worldFilter);

    this.ambBus = c.createGain();
    this.sfxBus = c.createGain();
    this.uiBus = c.createGain();
    this.musicBus = c.createGain();
    this.ambBus.connect(this.worldDuck);
    this.sfxBus.connect(this.worldDuck);
    this.uiBus.connect(this.master);
    this.musicBus.connect(this.master);

    // shared reverb
    const reverb = c.createConvolver();
    reverb.buffer = makeIR(c, 3.2, 2.4);
    this.revReturn = c.createGain();
    this.revReturn.gain.value = 0.6;
    this.ambRev = c.createGain();
    this.sfxRev = c.createGain();
    this.ambRev.connect(reverb);
    this.sfxRev.connect(reverb);
    reverb.connect(this.revReturn);
    this.revReturn.connect(this.worldDuck);

    // music: soft feedback delay for space
    const dl = c.createDelay(2);
    dl.delayTime.value = 0.43;
    const dlf = c.createBiquadFilter();
    dlf.type = 'lowpass';
    dlf.frequency.value = 2200;
    const fb = c.createGain();
    fb.gain.value = 0.42;
    const wet = c.createGain();
    wet.gain.value = 0.35;
    this.musicBus.connect(dl);
    dl.connect(dlf);
    dlf.connect(fb);
    fb.connect(dl);
    dlf.connect(wet);
    wet.connect(this.master);

    const Ls = c.listener;
    if (Ls.upX) {
      Ls.upX.value = 0;
      Ls.upY.value = 1;
      Ls.upZ.value = 0;
    }

    this.applyVolumes(this.vol, true);
    this.buildBed();
  }

  // -------------------------------------------------------------------------------------------
  // generic utilities
  // -------------------------------------------------------------------------------------------

  private canPlay(p: Pool): boolean {
    if (p.ends.length >= p.max) {
      const now = this.ctx.currentTime;
      p.ends = p.ends.filter((e) => e > now);
    }
    return p.ends.length < p.max;
  }

  private finish(v: Voice, p: Pool): void {
    p.ends.push(v.lastStop);
    const last = v.last;
    const nodes = v.nodes;
    if (!last) {
      for (const n of nodes) n.disconnect();
      return;
    }
    last.onended = () => {
      for (const n of nodes) {
        try {
          n.disconnect();
        } catch {
          /* already disconnected */
        }
      }
    };
  }

  private setP(p: AudioParam, v: number, tc = 0.3): void {
    p.setTargetAtTime(fin(v), this.ctx.currentTime, tc);
  }

  private distTo(p: Vec3): number {
    return Math.hypot(p.x - this.L.x, p.y - this.L.y, p.z - this.L.z);
  }

  private setPannerPos(p: PannerNode, x: number, y: number, z: number): void {
    if (p.positionX) {
      p.positionX.value = x;
      p.positionY.value = y;
      p.positionZ.value = z;
    } else {
      p.setPosition(x, y, z);
    }
  }

  private noiseSrc(v: Voice, buf: AudioBuffer, t0: number, dur: number, rate = 1): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.playbackRate.value = rate;
    v.play(s, t0, t0 + dur, Math.random() * buf.duration * 0.95);
    return s;
  }

  /** Filtered noise transient: linear attack, exponential (time-constant `tau`) decay. */
  private burst(
    v: Voice, dest: AudioNode, buf: AudioBuffer, t: number, type: BiquadFilterType, f: number, q: number,
    peak: number, atk: number, tau: number, sweepTo?: number, rate = 1,
  ): void {
    const c = this.ctx;
    const len = atk + tau * 7 + 0.01;
    const s = this.noiseSrc(v, buf, t, len, rate);
    const bq = v.add(c.createBiquadFilter());
    bq.type = type;
    bq.Q.value = q;
    bq.frequency.setValueAtTime(clamp(f, 20, this.nyq), t);
    if (sweepTo !== undefined) bq.frequency.exponentialRampToValueAtTime(clamp(sweepTo, 20, this.nyq), t + atk + tau * 2.5);
    const g = v.add(c.createGain());
    g.gain.value = 0;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + atk);
    g.gain.setTargetAtTime(0, t + atk, tau);
    s.connect(bq);
    bq.connect(g);
    g.connect(dest);
  }

  /** Sine blip with exponential pitch glide (bubbles, knocks). */
  private blip(v: Voice, dest: AudioNode, t: number, f0: number, f1: number, dur: number, a: number, type: OscillatorType = 'sine'): void {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(clamp(f0, 20, this.nyq), t);
    o.frequency.exponentialRampToValueAtTime(clamp(f1, 20, this.nyq), t + dur);
    const g = v.add(c.createGain());
    g.gain.value = 0;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(a, t + 0.004);
    g.gain.setTargetAtTime(0, t + 0.004, dur / 3);
    o.connect(g);
    g.connect(dest);
    v.play(o, t, t + dur * 2.2 + 0.02);
  }

  /** Mallet-like tone: sine fundamental plus a short 4x partial (UI and music plucks). */
  private pluck(v: Voice, dest: AudioNode, t: number, f: number, a: number, tau: number): void {
    const c = this.ctx;
    const parts: [number, number, number][] = [[1, 1, tau], [4, 0.22, tau * 0.18], [2, 0.12, tau * 0.5]];
    for (const [m, lvl, tc] of parts) {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = clamp(f * m, 20, this.nyq);
      const g = v.add(c.createGain());
      g.gain.value = 0;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(a * lvl, t + 0.004);
      g.gain.setTargetAtTime(0, t + 0.004, tc);
      o.connect(g);
      g.connect(dest);
      v.play(o, t, t + tc * 7 + 0.02);
    }
  }

  /** Positional output for gameplay sounds. Returns the input gain node. */
  private sfxOut(v: Voice, pos: Vec3, ref: number, wetBase: number, hrtf: boolean, rolloff = 1): GainNode {
    const c = this.ctx;
    const d = this.distTo(pos);
    const inp = v.add(c.createGain());
    const air = v.add(c.createBiquadFilter());
    air.type = 'lowpass';
    air.Q.value = 0.5;
    air.frequency.value = clamp(22000 * Math.exp(-d / 350), 1800, this.nyq);
    const p = v.add(c.createPanner());
    p.panningModel = hrtf ? 'HRTF' : 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.rolloffFactor = rolloff;
    p.maxDistance = 10000;
    this.setPannerPos(p, pos.x, pos.y, pos.z);
    inp.connect(air);
    air.connect(p);
    p.connect(this.sfxBus);
    // wet falls off slower than dry (1/sqrt(d) vs 1/d) so distant sounds are more reverberant
    const wet = v.add(c.createGain());
    wet.gain.value = wetBase * Math.sqrt(ref / Math.max(d, ref)) * (1 + Math.min(1.5, d / 120));
    air.connect(wet);
    wet.connect(this.sfxRev);
    return inp;
  }

  /** Positional output for distant ambient critters around the listener (cheap equal-power 3D). */
  private ambOut(v: Voice, dist: number, h: number, level: number): GainNode {
    const c = this.ctx;
    const a = Math.random() * TAU;
    const inp = v.add(c.createGain());
    inp.gain.value = level * CRITTER_TRIM * Math.min(1, 25 / Math.max(1, dist));
    const air = v.add(c.createBiquadFilter());
    air.type = 'lowpass';
    air.Q.value = 0.5;
    air.frequency.value = clamp(20000 * Math.exp(-dist / 110), 1800, this.nyq);
    const p = v.add(c.createPanner());
    p.panningModel = 'equalpower';
    p.distanceModel = 'linear';
    p.rolloffFactor = 0; // level handled manually above
    this.setPannerPos(p, this.L.x + Math.cos(a) * dist, this.L.y + h, this.L.z + Math.sin(a) * dist);
    inp.connect(air);
    air.connect(p);
    p.connect(this.ambBus);
    const wet = v.add(c.createGain());
    wet.gain.value = clamp(0.12 + dist / 260, 0.12, 0.7);
    air.connect(wet);
    wet.connect(this.ambRev);
    return inp;
  }

  // -------------------------------------------------------------------------------------------
  // volumes / mode
  // -------------------------------------------------------------------------------------------

  applyVolumes(v: Volumes, immediate = false): void {
    this.vol = { ...v };
    const tc = immediate ? 0.001 : 0.08;
    this.setP(this.master.gain, volCurve(v.master), tc);
    this.setP(this.ambBus.gain, volCurve(v.ambience), tc);
    this.setP(this.ambRev.gain, volCurve(v.ambience), tc);
    this.setP(this.sfxBus.gain, volCurve(v.sfx), tc);
    this.setP(this.sfxRev.gain, volCurve(v.sfx), tc);
    this.setP(this.uiBus.gain, volCurve(v.sfx), tc);
    this.setP(this.musicBus.gain, volCurve(v.music), tc);
  }

  // -------------------------------------------------------------------------------------------
  // ambience bed
  // -------------------------------------------------------------------------------------------

  private layer(buf: AudioBuffer, specs: [BiquadFilterType, number, number][], spread: number, dest: AudioNode): Layer {
    const c = this.ctx;
    const out = c.createGain();
    out.gain.value = 0;
    out.connect(dest);
    const f: BiquadFilterNode[][] = specs.map(() => []);
    for (const side of [-1, 1]) {
      const src = c.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.playbackRate.value = 1 + side * rand(0.004, 0.015);
      let node: AudioNode = src;
      specs.forEach(([type, freq, q], i) => {
        const bq = c.createBiquadFilter();
        bq.type = type;
        bq.frequency.value = clamp(freq, 20, this.nyq);
        bq.Q.value = q;
        node.connect(bq);
        node = bq;
        f[i].push(bq);
      });
      const pan = c.createStereoPanner();
      pan.pan.value = side * spread;
      node.connect(pan);
      pan.connect(out);
      src.start(c.currentTime, Math.random() * buf.duration * 0.95);
    }
    return { out, f };
  }

  private setF(l: Layer, idx: number, freq: number, tc = 0.3): void {
    for (const bq of l.f[idx]) this.setP(bq.frequency, clamp(freq, 20, this.nyq), tc);
  }

  private loopSrc(buf: AudioBuffer, rate: number): AudioBufferSourceNode {
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.playbackRate.value = rate;
    s.start(this.ctx.currentTime, Math.random() * buf.duration * 0.95);
    return s;
  }

  private buildBed(): void {
    const c = this.ctx;
    const A = this.ambBus;
    this.windBody = this.layer(this.pink, [['lowpass', 500, 0.5]], 0.5, A);
    this.windAir = this.layer(this.pink, [['bandpass', 1800, 0.6]], 0.8, A);
    this.rustle = this.layer(this.white, [['highpass', 1800, 0.5], ['lowpass', 7000, 0.5]], 0.9, A);
    // grass/leaf flutter: random fast AM on the rustle layer
    {
      const am = c.createGain();
      am.gain.value = 1;
      this.rustle.out.disconnect();
      this.rustle.out.connect(am);
      am.connect(A);
      const j = this.loopSrc(this.jit, 0.16);
      const jg = c.createGain();
      jg.gain.value = 0.55;
      j.connect(jg);
      jg.connect(am.gain);
    }
    this.whistleA = this.layer(this.pink, [['bandpass', 620, 28]], 0.6, A);
    this.whistleB = this.layer(this.pink, [['bandpass', 980, 32]], 0.7, A);
    this.waterBody = this.layer(this.pink, [['bandpass', 600, 0.7]], 0.7, A);
    this.waterHiss = this.layer(this.white, [['bandpass', 2500, 1.0]], 0.8, A);
    this.lapping = this.layer(this.pink, [['lowpass', 450, 0.7]], 0.6, A);
    this.rainHiss = this.layer(this.white, [['highpass', 1200, 0.5], ['lowpass', 9000, 0.5]], 0.95, A);
    this.rainBody = this.layer(this.pink, [['lowpass', 900, 0.5]], 0.6, A);
    this.underLayer = this.layer(this.brown, [['lowpass', 280, 0.7]], 0.4, A);

    // cicadas: band-passed noise gated by a buzzy square LFO, slow swells
    const cicOut = c.createGain();
    cicOut.connect(A);
    const cicSpecs: [number, number, number, number][] = [[4300, 6, 96, -0.55], [5600, 7, 131, 0.5], [3700, 5, 78, 0.05]];
    for (const [f, q, lfoHz, pan] of cicSpecs) {
      const src = this.loopSrc(this.white, rand(0.97, 1.03));
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = q;
      const am = c.createGain();
      am.gain.value = 0.5;
      const lfo = c.createOscillator();
      lfo.type = 'square';
      lfo.frequency.value = lfoHz;
      const lg = c.createGain();
      lg.gain.value = 0.5;
      lfo.connect(lg);
      lg.connect(am.gain);
      lfo.start();
      const swell = c.createGain();
      swell.gain.value = 0;
      const p = c.createStereoPanner();
      p.pan.value = pan;
      src.connect(bp);
      bp.connect(am);
      am.connect(swell);
      swell.connect(p);
      p.connect(cicOut);
      this.cicadas.push({ swell, cur: 0, target: rand(0.3, 1), timer: rand(1, 6) });
    }

    // night insect field (dense distant crickets)
    {
      this.insectField = c.createGain();
      this.insectField.gain.value = 0;
      this.insectField.connect(A);
      for (const [f, rate, pan] of [[4700, 28, -0.4], [5150, 33, 0.45]] as [number, number, number][]) {
        const src = this.loopSrc(this.white, 1);
        const bp = c.createBiquadFilter();
        bp.type = 'bandpass';
        bp.frequency.value = f;
        bp.Q.value = 10;
        const am = c.createGain();
        am.gain.value = 0.5;
        const lfo = c.createOscillator();
        lfo.type = 'triangle';
        lfo.frequency.value = rate;
        const lg = c.createGain();
        lg.gain.value = 0.5;
        lfo.connect(lg);
        lg.connect(am.gain);
        lfo.start();
        const p = c.createStereoPanner();
        p.pan.value = pan;
        src.connect(bp);
        bp.connect(am);
        am.connect(p);
        p.connect(this.insectField);
      }
    }

    // individual crickets: persistent sine carriers, chirps scheduled as gain automation
    this.cricketOut = c.createGain();
    this.cricketOut.gain.value = 0;
    this.cricketOut.connect(A);
    const ck: [number, number][] = [[4350, -0.7], [4800, 0.6], [5250, -0.15], [3950, 0.3]];
    for (const [f, pan] of ck) {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = c.createGain();
      g.gain.value = 0;
      const p = c.createStereoPanner();
      p.pan.value = pan;
      o.connect(g);
      g.connect(p);
      p.connect(this.cricketOut);
      o.start();
      this.crickets.push({
        g, next: c.currentTime + rand(0.2, 2), period: rand(0.38, 0.75), pulses: randInt(2, 4),
        pp: rand(0.026, 0.036), pw: rand(0.012, 0.018),
      });
    }
  }

  private updateBed(): void {
    const b = this.bm;
    const d = this.df;
    const rain = this.rain;
    const under = this.under;
    const dry = under ? 0.3 : 1;
    const T = BED_TRIM;
    const nightSoft = 0.65 + 0.35 * d.day;
    const g = clamp(this.gust, 0, 1.4);
    const windAmt = this.wind * (0.45 + 0.55 * g) * nightSoft;

    // wind
    this.setP(this.windBody.out.gain, T * 0.15 * windAmt * (0.8 + 0.4 * (b.grassland + b.highland + b.canyon)) * dry);
    this.setF(this.windBody, 0, 220 + 420 * windAmt + 260 * b.highland);
    this.setP(this.windAir.out.gain, T * 0.075 * windAmt * (0.15 + b.highland + 0.4 * b.canyon) * dry);
    this.setF(this.windAir, 0, 1400 + 900 * g + 500 * b.highland);
    const veg = b.grassland + 0.8 * b.woodland + 0.35 * b.kopjes + 0.3 * (b.river + b.waterhole);
    this.setP(this.rustle.out.gain, T * 0.18 * veg * Math.pow(windAmt, 1.3) * dry);
    this.setF(this.rustle, 0, 1900 + 700 * b.grassland - 700 * b.woodland);
    this.setF(this.rustle, 1, 5500 + 2500 * g);
    const rocky = b.canyon + 0.6 * b.highland + 0.25 * b.kopjes;
    const wh = rocky * clamp(windAmt - 0.15, 0, 1.2) * (0.35 + 0.65 * g * g) * dry;
    this.setP(this.whistleA.out.gain, T * 0.75 * wh, 0.6);
    this.setP(this.whistleB.out.gain, T * 0.5 * wh * (0.6 + 0.4 * Math.sin(this.time * 0.37)), 0.6);
    this.setF(this.whistleA, 0, 620 * (1 + 0.04 * Math.sin(this.time * 0.13) + 0.07 * (g - 0.7)), 0.8);
    this.setF(this.whistleB, 0, 980 * (1 + 0.03 * Math.sin(this.time * 0.21 + 1) + 0.06 * (g - 0.7)), 0.8);

    // water
    this.setP(this.waterBody.out.gain, T * (0.13 * b.river + 0.03 * b.waterhole));
    this.setP(this.waterHiss.out.gain, T * 0.14 * b.river);
    const lp = 0.5 + 0.5 * Math.sin(this.time * TAU * 0.22 + 1.7 * Math.sin(this.time * 0.31));
    this.setP(this.lapping.out.gain, T * 0.1 * b.waterhole * (0.2 + 0.8 * lp * lp), 0.12);

    // rain
    this.setP(this.rainHiss.out.gain, T * 0.24 * Math.pow(rain, 0.8), 0.5);
    this.setF(this.rainHiss, 1, 5500 + 4000 * rain);
    this.setP(this.rainBody.out.gain, T * 0.1 * rain, 0.5);

    // insects
    const habDay = b.grassland + 1.2 * b.woodland + 0.9 * b.kopjes + 0.6 * b.river + 0.7 * b.waterhole + 0.4 * b.canyon + 0.2 * b.highland;
    const cic = d.day * (1 - 0.6 * d.dawn) * (1 - rain) * habDay * d.heat * dry;
    const step = 1 / CTRL_HZ;
    for (const k of this.cicadas) {
      k.timer -= step;
      if (k.timer <= 0) {
        k.target = Math.random() < 0.2 ? rand(0, 0.15) : rand(0.35, 1);
        k.timer = rand(3, 11);
      }
      k.cur += (k.target - k.cur) * (1 - Math.exp(-step * 0.6));
      this.setP(k.swell.gain, T * 0.38 * cic * k.cur, 0.4);
    }
    const habNight = b.grassland + b.woodland + 0.8 * b.kopjes + 1.1 * b.river + 1.1 * b.waterhole + 0.4 * b.canyon + 0.3 * b.highland;
    const nightIns = (d.night + 0.5 * d.dusk) * (1 - 0.75 * rain) * habNight * dry;
    this.cricketLevel = nightIns;
    this.setP(this.insectField.gain, T * 0.11 * nightIns, 0.8);
    this.setP(this.cricketOut.gain, T * 0.024 * nightIns, 0.8);

    this.setP(this.underLayer.out.gain, under ? 0.05 : 0, 0.15);
    this.setP(this.revReturn.gain, clamp(0.55 + 0.9 * b.canyon + 0.35 * b.kopjes + 0.2 * b.highland - 0.15 * b.grassland, 0.35, 1.5), 1);
  }

  private scheduleCrickets(now: number): void {
    for (const k of this.crickets) {
      if (k.next < now) k.next = now + rand(0.05, 0.4);
      while (k.next < now + 0.3) {
        const t = k.next;
        if (this.cricketLevel > 0.02) {
          const A = rand(0.55, 1);
          for (let p = 0; p < k.pulses; p++) {
            const tp = t + p * k.pp;
            k.g.gain.setValueAtTime(0, tp);
            k.g.gain.linearRampToValueAtTime(A, tp + 0.004);
            k.g.gain.linearRampToValueAtTime(0, tp + k.pw);
          }
        }
        k.next = t + k.period * rand(0.93, 1.07) + (Math.random() < 0.06 ? rand(0.8, 3.5) : 0);
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // per-frame update
  // -------------------------------------------------------------------------------------------

  update(dt: number, s: UpdateState): void {
    const c = this.ctx;
    if (c.state !== 'running') return;
    dt = clamp(fin(dt), 0, 0.25);
    this.time += dt;
    const now = c.currentTime;

    // listener
    const l = s.listener;
    let fx = fin(l.fx);
    let fz = fin(l.fz, -1);
    const fl = Math.hypot(fx, fz);
    if (fl < 1e-6) {
      fx = 0;
      fz = -1;
    } else {
      fx /= fl;
      fz /= fl;
    }
    this.L = { x: fin(l.x), y: fin(l.y), z: fin(l.z), fx, fz };
    const Ls = c.listener;
    if (Ls.positionX) {
      const tc = 0.015;
      Ls.positionX.setTargetAtTime(this.L.x, now, tc);
      Ls.positionY.setTargetAtTime(this.L.y, now, tc);
      Ls.positionZ.setTargetAtTime(this.L.z, now, tc);
      Ls.forwardX.setTargetAtTime(fx, now, tc);
      Ls.forwardY.setTargetAtTime(0, now, tc);
      Ls.forwardZ.setTargetAtTime(fz, now, tc);
    } else {
      Ls.setPosition(this.L.x, this.L.y, this.L.z);
      Ls.setOrientation(fx, 0, fz, 0, 1, 0);
    }

    // environment
    const bi = s.biome;
    const keys: (keyof BiomeMix)[] = ['grassland', 'woodland', 'kopjes', 'river', 'waterhole', 'canyon', 'highland'];
    let sum = 0;
    for (const k of keys) sum += Math.max(0, fin(bi[k]));
    if (sum < 1e-4) this.bm = { grassland: 1, woodland: 0, kopjes: 0, river: 0, waterhole: 0, canyon: 0, highland: 0 };
    else {
      const m = { ...this.bm };
      for (const k of keys) m[k] = Math.max(0, fin(bi[k])) / sum;
      this.bm = m;
    }
    this.df = dayFactors(s.hour);
    this.rain = clamp(fin(s.rain), 0, 1);
    this.wind = clamp(fin(s.wind), 0, 1.5);

    const paused = !!s.paused;
    const under = !!s.underwater;
    if (paused !== this.paused || under !== this.under) {
      this.paused = paused;
      this.under = under;
      this.setP(this.worldDuck.gain, paused ? 0.35 : 1, 0.12);
      this.setP(this.worldFilter.frequency, under ? 420 : paused ? 1400 : this.nyq, under ? 0.05 : 0.15);
      this.setP(this.worldFilter.Q, under ? 0.9 : 0.5, 0.1);
      this.ctrlAcc = 1; // refresh bed now
    }

    // gusts
    this.gustTimer -= dt;
    if (this.gustTimer <= 0) {
      this.gustTarget = Math.random() < 0.15 ? rand(1.0, 1.35) : rand(0.25, 1.0);
      this.gustTimer = rand(1.5, 6);
    }
    this.gust += (this.gustTarget - this.gust) * (1 - Math.exp(-dt * 0.8));

    this.ctrlAcc += dt;
    if (this.ctrlAcc >= 1 / CTRL_HZ) {
      this.ctrlAcc = 0;
      this.updateBed();
    }
    this.scheduleCrickets(now);
    this.spawnTextures(dt, now);
    if (!paused) this.spawnCritters(dt);
    this.updateMusic(dt);
  }

  private poisson(rate: number, dt: number, fire: (t: number) => void): void {
    const n = rate * dt;
    let k = Math.floor(n) + (Math.random() < n - Math.floor(n) ? 1 : 0);
    k = Math.min(k, 4);
    const now = this.ctx.currentTime;
    for (let i = 0; i < k; i++) fire(now + 0.01 + Math.random() * dt);
  }

  /** Thinned Poisson timer: draws exponential waits at rMax, fires with probability rate/rMax. */
  private event(key: string, rMax: number, rate: number, dt: number, fire: () => void): void {
    let t = this.timers[key] ?? expSample(1 / rMax);
    t -= dt;
    let guard = 0;
    while (t <= 0 && guard++ < 4) {
      if (Math.random() < clamp(rate / rMax, 0, 1)) fire();
      t += expSample(1 / rMax);
    }
    if (t <= 0) t = expSample(1 / rMax);
    this.timers[key] = t;
  }

  private spawnTextures(dt: number, _now: number): void {
    const b = this.bm;
    const bubbleRate = (b.river * 12 + b.waterhole * 2.5) * (this.under ? 0.5 : 1);
    if (bubbleRate > 0.05) this.poisson(bubbleRate, dt, (t) => this.bubble(t, 0.5 + 0.5 * clamp(b.river + 0.4 * b.waterhole, 0, 1)));
    const r = this.rain;
    const tickRate = r * (10 + 40 * r) * (1 + 0.6 * b.woodland);
    if (tickRate > 0.05) this.poisson(tickRate, dt, (t) => this.rainTick(t));
  }

  private spawnCritters(dt: number): void {
    const b = this.bm;
    const d = this.df;
    const rain = this.rain;
    const uw = this.under ? 0.3 : 1;

    const hab = b.grassland * 0.6 + b.woodland * 1.5 + b.kopjes * 0.9 + b.river * 1.1 + b.waterhole * 1.2 + b.canyon * 0.35 + b.highland * 0.45;
    const birdRate = 0.32 * hab * (d.day + 0.6 * d.dawn) * (1 + 3 * d.dawn + 0.8 * d.dusk) * (1 - 0.85 * rain) * uw;
    this.event('bird', 3, birdRate, dt, () => this.bird());

    const owl = 0.035 * d.night * (0.2 + b.woodland + 0.7 * b.kopjes + 0.5 * b.river) * (1 - 0.7 * rain) * uw;
    this.event('owl', 0.2, owl, dt, () => this.owl());
    const nj = 0.05 * (d.night + 0.8 * d.dusk) * (0.2 + b.grassland + b.woodland) * (1 - 0.8 * rain) * uw;
    this.event('nightjar', 0.2, nj, dt, () => this.nightjar());
    const hy = 0.008 * d.night * (0.3 + b.grassland + 0.6 * b.waterhole) * uw;
    this.event('hyena', 0.05, hy, dt, () => this.hyena());
    const frog = 3.2 * (b.river + b.waterhole) * (0.15 + 0.85 * clamp(d.night + 0.5 * d.dusk, 0, 1)) * (1 + 0.8 * rain) * uw;
    this.event('frog', 5, frog, dt, () => this.frog());
  }

  // -------------------------------------------------------------------------------------------
  // textures
  // -------------------------------------------------------------------------------------------

  private bubble(t: number, lvl: number): void {
    if (!this.canPlay(this.pools.bubble)) return;
    const c = this.ctx;
    const v = new Voice();
    const p = v.add(c.createStereoPanner());
    p.pan.value = rand(-0.9, 0.9);
    const g = v.add(c.createGain());
    g.gain.value = BED_TRIM;
    g.connect(p);
    p.connect(this.ambBus);
    const f = randExp(350, 1700);
    this.blip(v, g, t, f, f * rand(1.5, 2.6), rand(0.025, 0.06) * Math.sqrt(900 / f), 0.028 * rand(0.3, 1) * lvl);
    this.finish(v, this.pools.bubble);
  }

  private rainTick(t: number): void {
    if (!this.canPlay(this.pools.tick)) return;
    const c = this.ctx;
    const v = new Voice();
    const p = v.add(c.createStereoPanner());
    p.pan.value = rand(-1, 1);
    p.connect(this.ambBus);
    const leaf = Math.random() < this.bm.woodland * 0.6;
    this.burst(
      v, p, this.white, t, 'bandpass', leaf ? randExp(900, 2500) : randExp(1800, 7000), rand(1.5, 4),
      BED_TRIM * rand(0.02, 0.09) * Math.sqrt(this.rain) * (leaf ? 1.4 : 1), 0.001, rand(0.006, 0.02),
    );
    this.finish(v, this.pools.tick);
  }

  // -------------------------------------------------------------------------------------------
  // critter voices (birds, frogs, night calls)
  // -------------------------------------------------------------------------------------------

  private tone(notes: Note[], o: ToneOpts): void {
    if (!notes.length || !this.canPlay(this.pools.amb)) return;
    const c = this.ctx;
    const v = new Voice();
    const t0 = c.currentTime + 0.03 + Math.random() * 0.05;
    let D = 0;
    for (const n of notes) D = Math.max(D, n.t + n.d);
    D += 0.03;
    const R = 400;
    const N = Math.max(2, Math.ceil(D * R) + 1);
    const fa = new Float32Array(N);
    const aa = new Float32Array(N);
    let lastF = notes[0].f0;
    for (let i = 0; i < N; i++) {
      const t = (i / (N - 1)) * D;
      let best = 0;
      let bf = lastF;
      for (const n of notes) {
        if (t < n.t || t > n.t + n.d) continue;
        const x = (t - n.t) / n.d;
        let e = n.pluck
          ? (x < 0.05 ? x / 0.05 : Math.exp(-(x - 0.05) * 5)) * (x > 0.85 ? (1 - x) / 0.15 : 1)
          : smooth(x / 0.15) * smooth((1 - x) / 0.3);
        e *= n.a;
        let f = n.f0 * Math.pow(n.f1 / n.f0, x);
        if (n.vib) f *= 1 + (n.vd ?? 0.03) * Math.sin(TAU * n.vib * (t - n.t));
        if (e >= best) {
          best = e;
          bf = f;
        }
      }
      aa[i] = best;
      fa[i] = clamp(bf, 20, this.nyq);
      lastF = bf;
    }
    aa[N - 1] = 0;
    const amp = v.add(c.createGain());
    amp.gain.value = 0;
    amp.gain.setValueCurveAtTime(aa, t0, D);
    const mk = (mul: number, lvl: number, type: OscillatorType): void => {
      const os = c.createOscillator();
      os.type = type;
      const arr = mul === 1 ? fa : fa.map((x) => clamp(x * mul, 20, this.nyq));
      os.frequency.value = arr[0];
      os.frequency.setValueCurveAtTime(arr, t0, D);
      const g = v.add(c.createGain());
      g.gain.value = lvl;
      os.connect(g);
      g.connect(amp);
      v.play(os, t0, t0 + D + 0.02);
    };
    mk(1, 1, o.wave ?? 'sine');
    if (o.h2) mk(2, o.h2, 'sine');
    if (o.h3) mk(3, o.h3, 'sine');
    let out: AudioNode = amp;
    if (o.bp) {
      const bp = v.add(c.createBiquadFilter());
      bp.type = 'bandpass';
      bp.frequency.value = clamp(o.bp[0], 20, this.nyq);
      bp.Q.value = o.bp[1];
      amp.connect(bp);
      out = bp;
    }
    out.connect(this.ambOut(v, o.dist, o.h, o.level));
    this.finish(v, this.pools.amb);
  }

  private bird(): void {
    const b = this.bm;
    const d = this.df;
    const kind = pickWeighted<string>([
      ['chirp', 1.0],
      ['trill', 0.45 + 0.6 * b.grassland],
      ['warble', 0.3 + 0.9 * (b.woodland + b.river + b.waterhole + 0.5 * b.kopjes)],
      ['dove', 0.9 * (b.woodland + 0.6 * b.grassland + 0.8 * b.kopjes) * (1 + d.dawn)],
      ['hornbill', 1.1 * b.woodland + 0.3 * b.kopjes],
      ['high', 0.2 + 0.9 * b.highland],
      ['raptor', 0.2 * (b.canyon + b.highland + 0.3 * b.kopjes)],
      ['fisheagle', 0.3 * (b.river + b.waterhole)],
    ]);
    const near = rand(20, 120);
    const h = rand(3, 14);
    const notes: Note[] = [];
    switch (kind) {
      case 'chirp': {
        const base = randExp(2600, 4800);
        let t = 0;
        const n = randInt(2, 6);
        const up = Math.random() < 0.5;
        for (let i = 0; i < n; i++) {
          const dd = rand(0.04, 0.09);
          const f0 = base * rand(0.92, 1.08);
          notes.push({ t, d: dd, f0, f1: f0 * (up ? rand(1.15, 1.4) : rand(0.65, 0.85)), a: rand(0.7, 1) });
          t += dd + rand(0.05, 0.14);
        }
        this.tone(notes, { h2: 0.08, level: 0.08, dist: near, h });
        break;
      }
      case 'trill': {
        const base = randExp(3000, 5200);
        const D = rand(0.6, 1.4);
        const rate = rand(14, 26);
        for (let t = 0; t < D; t += 1 / rate) {
          const f = base * (1 - 0.22 * (t / D));
          notes.push({ t, d: 0.6 / rate, f0: f, f1: f * 1.12, a: 0.55 + 0.45 * Math.sin((Math.PI * t) / D) });
        }
        this.tone(notes, { h2: 0.06, level: 0.06, dist: near, h });
        break;
      }
      case 'warble': {
        const ratios = [1, 9 / 8, 5 / 4, 3 / 2, 5 / 3, 2];
        const root = randExp(1700, 2600);
        let t = 0;
        const n = randInt(4, 8);
        for (let i = 0; i < n; i++) {
          const dd = rand(0.07, 0.18);
          const f0 = root * ratios[randInt(0, ratios.length - 1)];
          notes.push({ t, d: dd, f0, f1: f0 * rand(0.92, 1.12), a: rand(0.6, 1), vib: dd > 0.14 ? rand(20, 35) : undefined, vd: 0.025 });
          t += dd + rand(0.02, 0.06);
        }
        this.tone(notes, { h2: 0.12, level: 0.08, dist: near, h });
        break;
      }
      case 'dove': {
        // ring-necked dove style "coo-COOO-cuh", repeated
        const root = randExp(430, 560);
        const reps = randInt(2, 4);
        for (let r = 0; r < reps; r++) {
          const t = r * rand(1.1, 1.3);
          notes.push({ t, d: 0.18, f0: root, f1: root * 0.95, a: 0.6 });
          notes.push({ t: t + 0.23, d: 0.42, f0: root * 1.08, f1: root * 0.97, a: 1 });
          notes.push({ t: t + 0.73, d: 0.22, f0: root * 0.98, f1: root * 0.9, a: 0.7 });
        }
        this.tone(notes, { h2: 0.18, h3: 0.05, level: 0.09, dist: rand(25, 110), h });
        break;
      }
      case 'hornbill': {
        // accelerating "tok tok tok-tok-toka"
        const f = randExp(800, 1100);
        const n = randInt(6, 14);
        let t = 0;
        let gap = rand(0.28, 0.36);
        for (let i = 0; i < n; i++) {
          notes.push({ t, d: 0.05, f0: f, f1: f * 0.92, a: 0.6 + (0.4 * i) / n, pluck: true });
          t += gap;
          gap = Math.max(0.11, gap * 0.88);
        }
        this.tone(notes, { wave: 'triangle', h2: 0.4, h3: 0.2, level: 0.08, dist: near, h });
        break;
      }
      case 'high': {
        const base = randExp(6000, 7600);
        let t = 0;
        const n = randInt(2, 5);
        for (let i = 0; i < n; i++) {
          const dd = rand(0.03, 0.06);
          notes.push({ t, d: dd, f0: base * rand(0.95, 1.05), f1: base * rand(0.8, 0.9), a: rand(0.6, 1) });
          t += dd + rand(0.05, 0.09);
        }
        this.tone(notes, { level: 0.04, dist: rand(20, 80), h });
        break;
      }
      case 'raptor': {
        const reps = randInt(1, 2);
        for (let r = 0; r < reps; r++) {
          notes.push({ t: r * 1.3, d: rand(0.7, 1.0), f0: rand(2800, 3200), f1: rand(1800, 2000), a: 1, vib: 25, vd: 0.015 });
        }
        this.tone(notes, { h2: 0.1, level: 0.06, dist: rand(70, 160), h: rand(20, 50) });
        break;
      }
      case 'fisheagle': {
        // "weee-ah, kyo-kyo-kyo"
        notes.push({ t: 0, d: 0.45, f0: 1700, f1: 2100, a: 0.9, vib: 30, vd: 0.02 });
        notes.push({ t: 0.48, d: 0.35, f0: 2000, f1: 1300, a: 1, vib: 30, vd: 0.02 });
        const n = randInt(3, 5);
        for (let i = 0; i < n; i++) notes.push({ t: 0.95 + i * 0.2, d: 0.14, f0: 1700, f1: 1350, a: 0.85 - i * 0.08 });
        this.tone(notes, { h2: 0.35, h3: 0.18, level: 0.1, dist: rand(80, 160), h: rand(8, 25) });
        break;
      }
    }
  }

  private owl(): void {
    const f = randExp(300, 380);
    const notes: Note[] = [];
    const reps = randInt(1, 2);
    for (let r = 0; r < reps; r++) {
      const t = r * rand(2.2, 3.5);
      notes.push({ t, d: 0.28, f0: f * 0.97, f1: f, a: 0.7 });
      notes.push({ t: t + 0.4, d: 0.55, f0: f * 1.03, f1: f * 0.93, a: 1 });
    }
    this.tone(notes, { h2: 0.12, level: 0.1, dist: rand(40, 150), h: rand(4, 12) });
  }

  private nightjar(): void {
    const notes: Note[] = [];
    if (Math.random() < 0.55) {
      // fiery-necked nightjar "good lord, de-li-ver us"
      const k = rand(0.92, 1.08);
      notes.push({ t: 0, d: 0.12, f0: 1300 * k, f1: 1500 * k, a: 0.7 });
      notes.push({ t: 0.2, d: 0.22, f0: 1600 * k, f1: 1750 * k, a: 1 });
      const desc = [1700, 1600, 1500, 1400];
      desc.forEach((f, i) => {
        const last = i === desc.length - 1;
        notes.push({ t: 0.5 + i * 0.16, d: last ? 0.35 : 0.13, f0: f * k, f1: f * k * 0.96, a: 0.85, vib: last ? 18 : undefined, vd: 0.04 });
      });
    } else {
      // churring trill
      const D = rand(1.2, 2.5);
      const f = rand(1100, 1300);
      for (let t = 0; t < D; t += 1 / 38) {
        const alt = Math.sin((TAU * t) / 0.8) > 0 ? 1.06 : 1;
        notes.push({ t, d: 0.016, f0: f * alt, f1: f * alt, a: 0.7 + 0.3 * Math.sin((Math.PI * t) / D) });
      }
    }
    this.tone(notes, { h2: 0.08, level: 0.07, dist: rand(25, 120), h: rand(0.5, 3) });
  }

  private hyena(): void {
    const notes: Note[] = [];
    const n = randInt(1, 3);
    let t = 0;
    for (let i = 0; i < n; i++) {
      const dd = rand(1.0, 1.5);
      const f0 = randExp(320, 420);
      notes.push({ t, d: dd, f0, f1: f0 * rand(2.2, 3), a: 1 - i * 0.12 });
      t += dd + rand(1.2, 2.2);
    }
    this.tone(notes, { wave: 'triangle', h2: 0.3, level: 0.08, dist: rand(120, 200), h: 1 });
  }

  private frog(): void {
    const notes: Note[] = [];
    const dist = rand(5, 45);
    if (Math.random() < 0.6) {
      const f = rand(150, 260);
      const reps = randInt(1, 3);
      const rate = rand(22, 32);
      const len = rand(0.18, 0.4);
      for (let r = 0; r < reps; r++) {
        const t0 = r * rand(0.35, 0.5);
        for (let t = 0; t < len; t += 1 / rate) notes.push({ t: t0 + t, d: 0.55 / rate, f0: f, f1: f * 0.97, a: 0.6 + 0.4 * Math.sin((Math.PI * t) / len) });
      }
      this.tone(notes, { wave: 'sawtooth', bp: [rand(700, 1100), 2.5], level: 0.3, dist, h: 0.2 });
    } else {
      const f = rand(2800, 3700);
      const n = randInt(1, 4);
      for (let i = 0; i < n; i++) notes.push({ t: i * rand(0.2, 0.3), d: 0.05, f0: f, f1: f * 1.04, a: 1, pluck: true });
      this.tone(notes, { h2: 0.05, level: 0.035, dist, h: 0.5 });
    }
  }

  // -------------------------------------------------------------------------------------------
  // public one-shots
  // -------------------------------------------------------------------------------------------

  footstep(surface: Surface, pos: Vec3, weight: number, speed: number): void {
    if (this.distTo(pos) > 45 || !this.canPlay(this.pools.step)) return;
    const w = clamp(fin(weight, 0.5), 0, 1);
    const sp = clamp(fin(speed, 0.5), 0, 1);
    const c = this.ctx;
    const v = new Voice();
    const t = c.currentTime + 0.005;
    const out = this.sfxOut(v, pos, 3, 0.05, false, 1.2);
    out.gain.value = STEP_TRIM * (0.35 + 0.65 * w) * (0.4 + 0.6 * sp);
    const pt = (1.25 - 0.45 * w) * rand(0.9, 1.1);
    const W = this.white;
    const P = this.pink;
    switch (surface) {
      case 'grass':
        this.burst(v, out, W, t, 'bandpass', 2600 * pt, 0.8, 0.28, 0.018, 0.045 * (1 + 0.5 * sp), 1800 * pt);
        this.burst(v, out, W, t + rand(0.02, 0.04), 'bandpass', 4200 * pt, 1.5, 0.08, 0.01, 0.03);
        this.burst(v, out, P, t, 'lowpass', 160 * pt, 0.7, 0.1 + 0.35 * w, 0.004, 0.025);
        break;
      case 'dirt':
        this.burst(v, out, P, t, 'lowpass', 320 * pt, 0.9, 0.6, 0.003, 0.03);
        this.burst(v, out, W, t, 'bandpass', 900 * pt, 1, 0.1, 0.006, 0.03);
        this.burst(v, out, W, t + 0.004, 'highpass', 2500, 0.7, 0.07, 0.002, 0.012);
        break;
      case 'sand':
        this.burst(v, out, W, t, 'bandpass', 1500 * pt, 0.6, 0.22, 0.012, 0.05, 1100 * pt);
        this.burst(v, out, P, t, 'lowpass', 200 * pt, 0.8, 0.35, 0.004, 0.022);
        break;
      case 'rock':
        this.burst(v, out, W, t, 'bandpass', 2800 * pt, 4, 0.45, 0.0008, 0.005);
        this.blip(v, out, t, 800 * pt, 600 * pt, 0.05, 0.05);
        this.burst(v, out, P, t, 'lowpass', 280 * pt, 1, 0.35, 0.002, 0.015);
        break;
      case 'mud':
        this.burst(v, out, P, t, 'bandpass', 380 * pt, 5, 1.6, 0.012, 0.05, 1200 * pt);
        this.burst(v, out, P, t, 'lowpass', 250 * pt, 0.7, 0.4, 0.006, 0.04);
        this.burst(v, out, W, t + rand(0.08, 0.12), 'bandpass', 1100 * pt, 4, 0.14, 0.02, 0.03, 600 * pt);
        break;
      case 'water': {
        this.burst(v, out, W, t, 'bandpass', 1300 * pt, 1.1, 0.35, 0.004, 0.05, 2600 * pt);
        this.burst(v, out, P, t, 'lowpass', 500, 0.7, 0.4, 0.01, 0.06);
        const n = randInt(1, 3);
        for (let i = 0; i < n; i++) {
          const f = randExp(600, 1500);
          this.blip(v, out, t + rand(0.02, 0.15), f, f * 2, 0.04, 0.08);
        }
        break;
      }
    }
    this.finish(v, this.pools.step);
  }

  splash(pos: Vec3, strength: number): void {
    if (!this.canPlay(this.pools.sfx)) return;
    const s = clamp(fin(strength, 0.5), 0.05, 1.5);
    const c = this.ctx;
    const v = new Voice();
    const t = c.currentTime + 0.01;
    const out = this.sfxOut(v, pos, 4 + 4 * s, 0.12, true);
    out.gain.value = 0.9;
    const dur = 0.25 + 0.5 * s;
    // main body: noise with a fast upward then slow downward filter sweep
    {
      const src = this.noiseSrc(v, this.white, t, dur * 3 + 0.1);
      const bp = v.add(c.createBiquadFilter());
      bp.type = 'bandpass';
      bp.Q.value = 0.9;
      bp.frequency.setValueAtTime(700, t);
      bp.frequency.exponentialRampToValueAtTime(2600, t + 0.04);
      bp.frequency.exponentialRampToValueAtTime(900, t + dur);
      const g = v.add(c.createGain());
      g.gain.value = 0;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.55 * Math.pow(s, 0.7), t + 0.008);
      g.gain.setTargetAtTime(0, t + 0.02, dur * 0.35);
      src.connect(bp);
      bp.connect(g);
      g.connect(out);
    }
    this.burst(v, out, this.pink, t, 'lowpass', 600, 0.7, 0.3 * s, 0.02, 0.15);
    if (s > 0.3) this.blip(v, out, t, 160, 55, 0.15, 0.35 * s);
    const nb = Math.round(3 + 8 * s);
    for (let i = 0; i < nb; i++) {
      const f = randExp(500, 1800);
      this.blip(v, out, t + rand(0.03, 0.5), f, f * rand(1.6, 2.4), rand(0.03, 0.06), 0.06 * s);
    }
    const nd = Math.round(2 + 8 * s);
    for (let i = 0; i < nd; i++) {
      this.burst(v, out, this.white, t + rand(0.25, 0.9) * (0.6 + 0.4 * s), 'bandpass', randExp(1500, 5000), 3, 0.08 * s, 0.001, rand(0.01, 0.025));
    }
    this.finish(v, this.pools.sfx);
  }

  thunder(distance: number): void {
    if (!this.canPlay(this.pools.thunder)) return;
    const dist = Math.max(0, fin(distance, 2000));
    const c = this.ctx;
    const v = new Voice();
    const t0 = c.currentTime + 0.05 + Math.min(dist / 343, 12);
    const near = clamp(1 - dist / 1500, 0, 1);
    const L = 0.5 / (1 + dist / 1200);
    const D = 4 + Math.min(6, dist / 600) + rand(0, 2);
    const out = v.add(c.createGain());
    out.gain.value = 1;
    out.connect(this.ambBus);
    const wet = v.add(c.createGain());
    wet.gain.value = 0.35;
    out.connect(wet);
    wet.connect(this.ambRev);
    const R = 100;
    const N = Math.ceil(D * R) + 1;
    for (const side of [-1, 1]) {
      const src = this.noiseSrc(v, this.brown, t0, D + 0.2, rand(0.85, 1.1));
      const lp = v.add(c.createBiquadFilter());
      lp.type = 'lowpass';
      lp.Q.value = 0.7;
      lp.frequency.value = 90 + 700 * Math.exp(-dist / 1200) + 150 * near;
      // rolling envelope: sum of soft bumps
      const bumps: [number, number, number, number][] = [];
      const nb = randInt(3, 7);
      for (let i = 0; i < nb; i++) {
        bumps.push([i === 0 ? rand(0, 0.25) : rand(0, D * 0.6), rand(0.4, 1) * (i === 0 ? 1 : 0.8), rand(0.12, 0.5) * (1 + dist / 2000), rand(0.6, 1.8)]);
      }
      const env = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const t = (i / (N - 1)) * D;
        let s = 0;
        for (const [bt, ba, atk, tau] of bumps) {
          if (t < bt) continue;
          const x = t - bt;
          s += ba * (x < atk ? x / atk : Math.exp(-(x - atk) / tau));
        }
        env[i] = L * Math.min(1.2, s) * smooth((D - t) / 0.8);
      }
      env[N - 1] = 0;
      const g = v.add(c.createGain());
      g.gain.value = 0;
      g.gain.setValueCurveAtTime(env, t0, D);
      const p = v.add(c.createStereoPanner());
      p.pan.value = side * 0.7;
      src.connect(lp);
      lp.connect(g);
      g.connect(p);
      p.connect(out);
    }
    if (near > 0) {
      this.burst(v, out, this.white, t0, 'highpass', 1200, 0.5, 0.45 * near, 0.002, 0.08);
      const n = randInt(2, 5);
      for (let i = 0; i < n; i++) {
        this.burst(v, out, this.white, t0 + rand(0.03, 0.35), 'bandpass', randExp(800, 4000), 0.8, 0.3 * near * rand(0.4, 1), 0.002, rand(0.03, 0.09));
      }
      this.burst(v, out, this.brown, t0, 'lowpass', 120, 0.7, 0.9 * near, 0.01, 0.35);
    }
    this.finish(v, this.pools.thunder);
  }

  ui(kind: 'click' | 'hover' | 'open' | 'close' | 'notify' | 'success'): void {
    if (!this.canPlay(this.pools.ui)) return;
    const c = this.ctx;
    const v = new Voice();
    const t = c.currentTime + 0.005;
    const out = v.add(c.createGain());
    out.gain.value = 1;
    out.connect(this.uiBus);
    const W = this.white;
    switch (kind) {
      case 'click':
        this.pluck(v, out, t, 1046.5, 0.09, 0.03);
        this.burst(v, out, W, t, 'bandpass', 3200, 5, 0.06, 0.001, 0.004);
        break;
      case 'hover':
        this.pluck(v, out, t, 1568, 0.03, 0.02);
        break;
      case 'open':
        this.pluck(v, out, t, 587.3, 0.08, 0.16);
        this.pluck(v, out, t + 0.07, 880, 0.07, 0.2);
        this.burst(v, out, W, t, 'bandpass', 600, 1.2, 0.025, 0.08, 0.06, 2400);
        break;
      case 'close':
        this.pluck(v, out, t, 880, 0.07, 0.14);
        this.pluck(v, out, t + 0.07, 587.3, 0.07, 0.18);
        this.burst(v, out, W, t, 'bandpass', 2400, 1.2, 0.022, 0.06, 0.05, 700);
        break;
      case 'notify':
        this.pluck(v, out, t, 659.3, 0.08, 0.3);
        this.pluck(v, out, t + 0.12, 987.8, 0.08, 0.4);
        break;
      case 'success':
        [587.3, 740, 880, 1174.7].forEach((f, i) => this.pluck(v, out, t + i * 0.085, f, 0.075, 0.3 + i * 0.08));
        break;
    }
    this.finish(v, this.pools.ui);
  }

  // -------------------------------------------------------------------------------------------
  // big-cat vocal synth
  // -------------------------------------------------------------------------------------------

  call(kind: CallKind, pos: Vec3, size: number): void {
    const sc = clamp(fin(size, 1), 0.3, 1.4);
    const spec = vocalSpec(kind, sc);
    if (this.distTo(pos) > spec.ref * 300 || !this.canPlay(this.pools.sfx)) return;
    this.vocal(spec, pos);
  }

  private vocal(sp: VocalSpec, pos: Vec3): void {
    const c = this.ctx;
    const v = new Voice();
    const t0 = c.currentTime + 0.02;
    const D = sp.dur;
    const tEnd = t0 + D + 0.05;
    const R = 200;
    const N = Math.max(2, Math.ceil(D * R) + 1);
    const f0 = new Float32Array(N);
    const fs = new Float32Array(N);
    const amp = new Float32Array(N);
    const nz = new Float32Array(N);
    const F1 = new Float32Array(N);
    const F2 = new Float32Array(N);
    const F3 = new Float32Array(N);
    const hs = sp.hiss ? new Float32Array(N) : null;
    for (let i = 0; i < N; i++) {
      const t = (i / (N - 1)) * D;
      const f = clamp(sp.f0(t), 15, this.nyq);
      f0[i] = f;
      fs[i] = f * 0.5;
      amp[i] = Math.max(0, sp.amp(t));
      nz[i] = Math.max(0, sp.noise(t));
      F1[i] = clamp(sp.f1(t), 40, this.nyq);
      F2[i] = clamp(sp.f2(t), 40, this.nyq);
      F3[i] = clamp(sp.f3(t), 40, this.nyq);
      if (hs && sp.hiss) hs[i] = Math.max(0, sp.hiss(t));
    }
    amp[N - 1] = 0;
    nz[N - 1] = 0;
    if (hs) hs[N - 1] = 0;

    // jitter (shared by main and sub oscillator detune)
    const jSrc = this.noiseSrc(v, this.jit, t0, D + 0.05, 0.5 * rand(0.8, 1.2));
    const jg = v.add(c.createGain());
    jg.gain.value = sp.jitter;
    jSrc.connect(jg);

    const voiced = v.add(c.createGain());
    voiced.gain.value = 0;
    voiced.gain.setValueCurveAtTime(amp, t0, D);
    const osc = c.createOscillator();
    osc.type = sp.wave ?? 'sawtooth';
    osc.frequency.value = f0[0];
    osc.frequency.setValueCurveAtTime(f0, t0, D);
    jg.connect(osc.detune);
    osc.connect(voiced);
    v.play(osc, t0, tEnd);
    if (sp.sub > 0) {
      const sub = c.createOscillator();
      sub.type = 'sawtooth';
      sub.frequency.value = fs[0];
      sub.frequency.setValueCurveAtTime(fs, t0, D);
      jg.connect(sub.detune);
      const sg = v.add(c.createGain());
      sg.gain.value = sp.sub;
      sub.connect(sg);
      sg.connect(voiced);
      v.play(sub, t0, tEnd);
    }

    const nSrc = this.noiseSrc(v, this.pink, t0, D + 0.05);
    const ng = v.add(c.createGain());
    ng.gain.value = 0;
    ng.gain.setValueCurveAtTime(nz, t0, D);
    nSrc.connect(ng);

    // roughness (random AM) and optional periodic pulse AM
    const rough = v.add(c.createGain());
    rough.gain.value = 1;
    if (sp.rough > 0) {
      const r = this.noiseSrc(v, this.jit, t0, D + 0.05, sp.roughRate * rand(0.85, 1.15));
      const rg = v.add(c.createGain());
      rg.gain.value = sp.rough;
      r.connect(rg);
      rg.connect(rough.gain);
    }
    if (sp.pulseHz && sp.pulseDepth) {
      const po = c.createOscillator();
      po.type = 'square';
      po.frequency.value = sp.pulseHz;
      const pf = v.add(c.createBiquadFilter()); // soften the square edges
      pf.type = 'lowpass';
      pf.frequency.value = sp.pulseHz * 4;
      const pg = v.add(c.createGain());
      pg.gain.value = sp.pulseDepth;
      po.connect(pf);
      pf.connect(pg);
      pg.connect(rough.gain);
      v.play(po, t0, tEnd);
    }
    voiced.connect(rough);
    ng.connect(rough);

    // formant bank + body
    const sum = v.add(c.createGain());
    sum.gain.value = 1;
    const formants: [Float32Array, number, number][] = [[F1, sp.q[0], sp.fg[0]], [F2, sp.q[1], sp.fg[1]], [F3, sp.q[2], sp.fg[2]]];
    for (const [arr, q, gain] of formants) {
      if (gain <= 0) continue;
      const bp = v.add(c.createBiquadFilter());
      bp.type = 'bandpass';
      bp.Q.value = q;
      bp.frequency.value = arr[0];
      bp.frequency.setValueCurveAtTime(arr, t0, D);
      const g = v.add(c.createGain());
      g.gain.value = gain;
      rough.connect(bp);
      bp.connect(g);
      g.connect(sum);
    }
    if (sp.body > 0) {
      const lp = v.add(c.createBiquadFilter());
      lp.type = 'lowpass';
      lp.frequency.value = clamp(sp.bodyCut, 40, this.nyq);
      lp.Q.value = 0.8;
      const g = v.add(c.createGain());
      g.gain.value = sp.body;
      rough.connect(lp);
      lp.connect(g);
      g.connect(sum);
    }

    const pre = v.add(c.createGain());
    pre.gain.value = 0.5;
    const shaper = v.add(c.createWaveShaper());
    shaper.curve = shaperCurve(sp.drive);
    shaper.oversample = '2x';
    // gentle high-cut after the shaper to tame fizz
    const tone = v.add(c.createBiquadFilter());
    tone.type = 'lowpass';
    tone.frequency.value = clamp(5500, 40, this.nyq);
    tone.Q.value = 0.5;
    const post = v.add(c.createGain());
    post.gain.value = sp.gain * CALL_TRIM;
    sum.connect(pre);
    pre.connect(shaper);
    shaper.connect(tone);
    tone.connect(post);

    if (hs) {
      const hSrc = this.noiseSrc(v, this.white, t0, D + 0.05);
      const hp = v.add(c.createBiquadFilter());
      hp.type = 'highpass';
      hp.frequency.value = 2800;
      hp.Q.value = 0.6;
      const hg = v.add(c.createGain());
      hg.gain.value = 0;
      hg.gain.setValueCurveAtTime(hs, t0, D);
      hSrc.connect(hp);
      hp.connect(hg);
      hg.connect(post);
    }

    post.connect(this.sfxOut(v, pos, sp.ref, sp.wet, true));
    this.finish(v, this.pools.sfx);
  }

  // -------------------------------------------------------------------------------------------
  // sparse generative music
  // -------------------------------------------------------------------------------------------

  private updateMusic(dt: number): void {
    if (volCurve(this.vol.music) < 0.002) return;
    this.padTimer -= dt;
    if (this.padTimer > 0) return;
    this.padTimer = rand(24, 48);
    if (!this.canPlay(this.pools.music)) return;
    const c = this.ctx;
    const v = new Voice();
    const out = v.add(c.createGain());
    out.gain.value = 1;
    out.connect(this.musicBus);
    const lp = v.add(c.createBiquadFilter());
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    lp.Q.value = 0.3;
    lp.connect(out);
    const night = this.df.night > 0.5;
    const scale = night ? [0, 3, 5, 7, 10] : [0, 2, 4, 7, 9];
    const root = 146.83; // D3
    const semi = (n: number): number => Math.pow(2, n / 12);
    const t0 = c.currentTime + 0.1;
    const atk = rand(3.5, 5);
    const hold = rand(3, 6);
    const rel = rand(6, 8);
    const end = t0 + atk + hold + rel * 5;
    const notes = [root * 0.5 * (Math.random() < 0.6 ? 1 : semi(7))];
    const picks = [...scale].sort(() => Math.random() - 0.5).slice(0, 2);
    for (const p of picks) notes.push(root * semi(p + (Math.random() < 0.4 ? 12 : 0)));
    notes.forEach((f, i) => {
      for (const det of [-7, 7]) {
        const o = c.createOscillator();
        o.type = 'triangle';
        o.frequency.value = f;
        o.detune.value = det + rand(-2, 2);
        const g = v.add(c.createGain());
        const peak = i === 0 ? 0.03 : 0.022;
        g.gain.value = 0;
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(peak, t0 + atk + i * 0.4);
        g.gain.setValueAtTime(peak, t0 + atk + hold);
        g.gain.setTargetAtTime(0, t0 + atk + hold, rel);
        o.connect(g);
        g.connect(lp);
        v.play(o, t0, end);
      }
    });
    // occasional soft mallet motif above the pad
    if (Math.random() < 0.45) {
      let t = t0 + rand(2, 4);
      const n = randInt(2, 4);
      for (let i = 0; i < n; i++) {
        const deg = scale[randInt(0, scale.length - 1)];
        this.pluck(v, out, t, root * semi(deg + 12), 0.035, rand(0.5, 0.9));
        t += rand(1.2, 2.8);
      }
    }
    this.finish(v, this.pools.music);
  }
}

// ---------------------------------------------------------------------------------------------
// Call designs
// ---------------------------------------------------------------------------------------------

function vocalSpec(kind: CallKind, sc: number): VocalSpec {
  const pm = Math.pow(1 / sc, 0.85); // pitch scale: bigger = lower
  const fm = Math.pow(1 / sc, 0.45); // formant scale: bigger = darker
  switch (kind) {
    case 'roar': {
      const dm = 0.7 + 0.35 * sc; // bigger = longer
      const Tm = 1.55 * dm * rand(0.95, 1.08);
      const nG = (sc < 0.6 ? 2 : sc < 0.9 ? 3 : 4) + (Math.random() < 0.5 ? 1 : 0);
      const gd = 0.24 * dm;
      const gs: number[] = [];
      let tg = Tm + 0.15 * dm;
      let gap = 0.42 * dm;
      for (let i = 0; i < nG; i++) {
        gs.push(tg);
        tg += gap;
        gap *= 0.9;
      }
      const dur = gs[gs.length - 1] + gd + 0.15;
      const grunt = (t: number): [number, number, number] => {
        // returns [index, local x 0..1, amp] of the grunt covering t
        for (let k = 0; k < gs.length; k++) {
          const x = (t - gs[k]) / gd;
          if (x >= 0 && x <= 1) {
            const e = x < 0.12 ? x / 0.12 : Math.pow(1 - (x - 0.12) / 0.88, 1.5);
            return [k, x, e * 0.62 * Math.pow(0.8, k)];
          }
        }
        return [-1, 0, 0];
      };
      return {
        dur,
        f0: (t) => {
          if (t < Tm) return 185 * pm * pw(t / Tm, [0, 0.55, 0.15, 0.92, 0.35, 1, 0.6, 0.8, 0.85, 0.52, 1, 0.4]);
          const [k, x] = grunt(t);
          return k < 0 ? 75 * pm : (105 - 30 * x) * pm * (1 - 0.06 * k);
        },
        amp: (t) => (t < Tm ? pw(t / Tm, [0, 0, 0.08, 0.35, 0.22, 0.9, 0.35, 1, 0.6, 0.92, 0.82, 0.55, 1, 0]) : grunt(t)[2]),
        noise: (t) => {
          if (t < Tm) return 0.3 * pw(t / Tm, [0, 0.4, 0.1, 0.5, 0.3, 1, 0.8, 0.7, 1, 0]);
          return 0.55 * grunt(t)[2];
        },
        f1: (t) => (t < Tm ? fm * pw(t / Tm, [0, 300, 0.3, 560, 0.7, 520, 1, 330]) : 380 * fm),
        f2: (t) => (t < Tm ? fm * pw(t / Tm, [0, 850, 0.3, 1200, 0.7, 1100, 1, 800]) : 900 * fm),
        f3: () => 2300 * fm,
        q: [2.5, 4, 5],
        fg: [1, 0.55, 0.22],
        body: 0.8,
        bodyCut: 260 * fm,
        sub: 0.35,
        jitter: 45,
        rough: 0.45,
        roughRate: 1.3,
        drive: 2.2,
        gain: 0.9,
        ref: 4 + 10 * sc,
        wet: 0.2,
      };
    }
    case 'growl': {
      const dur = rand(1.3, 1.8) * (0.8 + 0.3 * sc);
      const ph = rand(0, TAU);
      const env = (t: number): number => smooth(t / 0.25) * smooth((dur - t) / 0.35) * (0.85 + 0.15 * Math.sin(TAU * 0.9 * t + ph));
      return {
        dur,
        f0: (t) => 62 * pm * (1 + 0.06 * Math.sin(TAU * 1.3 * t + ph)),
        amp: env,
        noise: (t) => 0.35 * env(t),
        f1: () => 320 * fm,
        f2: () => 780 * fm,
        f3: () => 2100 * fm,
        q: [3, 4, 5],
        fg: [1, 0.5, 0.15],
        body: 1.0,
        bodyCut: 220 * fm,
        sub: 0.5,
        jitter: 60,
        rough: 0.7,
        roughRate: 0.45,
        drive: 2.5,
        gain: 0.75,
        ref: 5 + 4 * sc,
        wet: 0.12,
      };
    }
    case 'snarl': {
      const dur = rand(0.75, 1.05);
      const env = (t: number): number => pw(t / dur, [0, 0, 0.06, 1, 0.5, 0.85, 0.8, 0.6, 1, 0]);
      return {
        dur,
        f0: (t) => pm * pw(t / dur, [0, 150, 0.2, 230, 0.7, 200, 1, 140]),
        amp: env,
        noise: (t) => 0.8 * env(t),
        hiss: (t) => 0.18 * smooth(t / 0.03) * smooth((0.35 - t) / 0.2),
        f1: (t) => fm * pw(t / dur, [0, 500, 0.2, 750, 1, 600]),
        f2: () => 1500 * fm,
        f3: () => 2700 * fm,
        q: [3, 5, 6],
        fg: [1, 0.7, 0.4],
        body: 0.4,
        bodyCut: 300 * fm,
        sub: 0.4,
        jitter: 90,
        rough: 0.75,
        roughRate: 1.6,
        drive: 3.5,
        gain: 0.75,
        ref: 5 + 4 * sc,
        wet: 0.12,
      };
    }
    case 'chuff': {
      const n = Math.random() < 0.5 ? 2 : 3;
      const sp = 0.19;
      const pd = 0.13;
      const dur = n * sp + 0.12;
      const pulse = (t: number): number => {
        const k = Math.floor(t / sp);
        if (k >= n) return 0;
        const x = (t - k * sp) / pd;
        if (x < 0 || x > 1) return 0;
        return (x < 0.08 ? x / 0.08 : Math.pow(1 - x, 2)) * (1 - 0.15 * k);
      };
      return {
        dur,
        f0: () => 85 * pm,
        amp: (t) => 0.25 * pulse(t),
        noise: pulse,
        f1: () => 450 * fm,
        f2: () => 1100 * fm,
        f3: () => 2400 * fm,
        q: [1.5, 2.5, 3],
        fg: [1, 0.6, 0.25],
        body: 0.6,
        bodyCut: 300 * fm,
        sub: 0,
        jitter: 30,
        rough: 0.85,
        roughRate: 0.9,
        drive: 1.3,
        gain: 1.0,
        ref: 3 + 2 * sc,
        wet: 0.08,
      };
    }
    case 'meow': {
      const dur = 0.5 * (0.75 + 0.45 * sc) * rand(0.9, 1.15);
      const fm2 = Math.pow(1 / sc, 0.6);
      const base = 330 * pm * rand(0.95, 1.06);
      const env = (t: number): number => pw(t / dur, [0, 0, 0.1, 0.8, 0.35, 1, 0.75, 0.8, 1, 0]);
      return {
        dur,
        f0: (t) => base * pw(t / dur, [0, 0.82, 0.3, 1.12, 0.6, 1.05, 1, 0.72]) * (1 + 0.015 * Math.sin(TAU * 6 * t)),
        amp: env,
        noise: (t) => 0.12 * env(t) + 0.04 * smooth(t / 0.02) * smooth((dur - t) / 0.05),
        f1: (t) => fm2 * pw(t / dur, [0, 650, 0.4, 1100, 1, 600]),
        f2: (t) => fm2 * pw(t / dur, [0, 1900, 0.4, 1600, 1, 1000]),
        f3: () => 3000 * fm2,
        q: [4, 6, 7],
        fg: [1, 0.7, 0.3],
        body: 0.2,
        bodyCut: 600 * fm2,
        sub: 0.05,
        jitter: 25,
        rough: sc < 0.6 ? 0.2 : 0.15,
        roughRate: 1.4,
        drive: 1.4,
        gain: 0.9,
        ref: 3 + 3 * sc,
        wet: 0.12,
      };
    }
    case 'purr': {
      const dur = 3.6 * rand(0.9, 1.2);
      const P = 1.9;
      const breath = (t: number): [number, boolean] => {
        const x = t % P;
        if (x < 1.05) return [smooth(x / 0.12) * smooth((1.05 - x) / 0.12), true];
        if (x > 1.15 && x < 1.85) return [0.7 * smooth((x - 1.15) / 0.12) * smooth((1.85 - x) / 0.12), false];
        return [0, true];
      };
      const fp = Math.pow(1 / sc, 0.25);
      const env = (t: number): number => breath(t)[0] * smooth((dur - t) / 0.2);
      return {
        dur,
        f0: (t) => (breath(t)[1] ? 25 : 28) * fp,
        amp: env,
        noise: (t) => 0.6 * env(t),
        f1: () => 380 * fm,
        f2: () => 900 * fm,
        f3: () => 2000 * fm,
        q: [2, 3, 4],
        fg: [0.7, 0.3, 0.1],
        body: 1.2,
        bodyCut: 400 * fm,
        sub: 0,
        jitter: 20,
        rough: 0.2,
        roughRate: 1,
        pulseHz: 25 * fp,
        pulseDepth: 0.8,
        drive: 1.2,
        gain: 0.6,
        ref: 1.5 + 1.5 * sc,
        wet: 0.04,
      };
    }
    case 'yawn': {
      const dur = 2.0 * (0.8 + 0.3 * sc) * rand(0.9, 1.1);
      const env = (t: number): number => pw(t / dur, [0, 0, 0.1, 0.5, 0.3, 0.9, 0.7, 0.7, 0.92, 0.3, 1, 0]);
      return {
        dur,
        f0: (t) => pm * pw(t / dur, [0, 170, 0.15, 260, 0.45, 230, 0.8, 150, 1, 110]),
        amp: env,
        noise: (t) => 0.5 * env(t) + 0.05 * smooth(t / 0.05) * smooth((dur - t) / 0.1),
        f1: (t) => fm * pw(t / dur, [0, 350, 0.35, 900, 0.7, 700, 1, 300]),
        f2: (t) => fm * pw(t / dur, [0, 900, 0.35, 1350, 1, 700]),
        f3: () => 2500 * fm,
        q: [3, 4, 5],
        fg: [1, 0.6, 0.25],
        body: 0.4,
        bodyCut: 350 * fm,
        sub: 0.15,
        jitter: 40,
        rough: 0.3,
        roughRate: 1,
        drive: 1.6,
        gain: 0.6,
        ref: 3 + 3 * sc,
        wet: 0.1,
      };
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Public facade
// ---------------------------------------------------------------------------------------------

export class AudioEngine {
  private core: Core | null = null;
  private failed = false;
  private unlocking: Promise<void> | null = null;
  private vol: Volumes = { master: 0.8, ambience: 0.8, sfx: 0.8, music: 0.5 };

  constructor() {
    /* nothing: the AudioContext is created lazily in unlock() from a user gesture */
  }

  /** Must be called from a user gesture (click/keydown). Safe to call repeatedly. */
  unlock(): Promise<void> {
    if (this.core) {
      const ctx = this.core.ctx;
      if (ctx.state !== 'running' && ctx.state !== 'closed') return ctx.resume().catch(() => undefined);
      return Promise.resolve();
    }
    if (this.failed) return Promise.resolve();
    if (this.unlocking) return this.unlocking;
    let ctx: AudioContext | null = null;
    try {
      const g = globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
      const Ctor = g.AudioContext ?? g.webkitAudioContext;
      if (!Ctor) {
        this.failed = true;
        return Promise.resolve();
      }
      ctx = new Ctor({ latencyHint: 'interactive' });
      // resume synchronously inside the gesture, before building the graph
      const resumed = ctx.resume().catch(() => undefined);
      // iOS: play a silent buffer inside the gesture
      try {
        const b = ctx.createBuffer(1, 1, ctx.sampleRate);
        const s = ctx.createBufferSource();
        s.buffer = b;
        s.connect(ctx.destination);
        s.start();
      } catch {
        /* ignore */
      }
      this.core = new Core(ctx, this.vol);
      this.unlocking = resumed.then(() => {
        this.unlocking = null;
      });
      return this.unlocking;
    } catch (e) {
      console.warn('[audio] unavailable:', e);
      this.failed = true;
      this.core = null;
      try {
        void ctx?.close();
      } catch {
        /* ignore */
      }
      return Promise.resolve();
    }
  }

  /**
   * Volumes 0..1 (squared internally for a perceptual slider feel). Also accepts the settings
   * object shape `{ masterVolume, ambienceVolume, sfxVolume, musicVolume }`.
   */
  setVolumes(
    v:
      | { master: number; ambience: number; sfx: number; music: number }
      | { masterVolume: number; ambienceVolume: number; sfxVolume: number; musicVolume: number },
  ): void {
    const n = 'master' in v
      ? v
      : { master: v.masterVolume, ambience: v.ambienceVolume, sfx: v.sfxVolume, music: v.musicVolume };
    this.vol = { master: fin(n.master, 0.8), ambience: fin(n.ambience, 0.8), sfx: fin(n.sfx, 0.8), music: fin(n.music, 0.5) };
    if (!this.core) return;
    try {
      this.core.applyVolumes(this.vol);
    } catch {
      /* ignore */
    }
  }

  /** Called every frame. Listener position/orientation in world metres; (fx, fz) is the horizontal forward vector. */
  update(
    dt: number,
    s: {
      listener: { x: number; y: number; z: number; fx: number; fz: number };
      biome: BiomeMix;
      hour: number;
      rain: number;
      wind: number;
      underwater?: boolean;
      paused?: boolean;
    },
  ): void {
    this.guard(() => this.core?.update(dt, s));
  }

  footstep(surface: Surface, pos: { x: number; y: number; z: number }, weight: number, speed: number): void {
    this.guard(() => this.core?.footstep(surface, pos, weight, speed));
  }

  call(kind: CallKind, pos: { x: number; y: number; z: number }, size: number): void {
    this.guard(() => this.core?.call(kind, pos, size));
  }

  splash(pos: { x: number; y: number; z: number }, strength: number): void {
    this.guard(() => this.core?.splash(pos, strength));
  }

  ui(kind: 'click' | 'hover' | 'open' | 'close' | 'notify' | 'success'): void {
    this.guard(() => this.core?.ui(kind));
  }

  /** Distance in metres; the rumble is delayed by distance / 343 m/s (capped at 12 s). */
  thunder(distance: number): void {
    this.guard(() => this.core?.thunder(distance));
  }

  private guard(fn: () => void): void {
    if (!this.core || this.core.ctx.state !== 'running') return;
    try {
      fn();
    } catch (e) {
      if (!this.warned) {
        this.warned = true;
        console.warn('[audio] error (further errors suppressed):', e);
      }
    }
  }
  private warned = false;
}
