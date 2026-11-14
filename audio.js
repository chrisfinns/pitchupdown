// Synthesized piano voice (Web Audio). Additive partials with string
// inharmonicity, velocity-dependent brightness and loudness, hammer noise,
// and a small room reverb. Pitch is exact to the hundredth of a cent, so
// microtonal steps are reliable.

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const dbToGain = (db) => Math.pow(10, db / 20);

export const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

// Inharmonicity coefficient for a string at this frequency (rises with pitch).
export const inharmonicity = (freq) => clamp(0.00035 * Math.pow(freq / 262, 1.1), 0.00006, 0.002);

function makeNoise(ctx, seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function makeImpulse(ctx, seconds, decay) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
  }
  return buf;
}

export class Piano {
  constructor(ctx) {
    this.ctx = ctx;
    this.voices = new Set();
    this.noise = makeNoise(ctx, 0.2);

    this.bus = ctx.createGain();
    const dry = ctx.createGain();
    const wet = ctx.createGain();
    const verb = ctx.createConvolver();
    verb.buffer = makeImpulse(ctx, 1.8, 3.2);
    wet.gain.value = 0.16;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -4;
    comp.knee.value = 4;
    comp.ratio.value = 10;
    comp.attack.value = 0.002;
    comp.release.value = 0.15;

    this.bus.connect(dry).connect(comp);
    this.bus.connect(verb).connect(wet).connect(comp);
    comp.connect(ctx.destination);
  }

  /**
   * Strike a note.
   * @param {number} freq     Hz (any value — not limited to 12-TET)
   * @param {number} t0       AudioContext time to strike
   * @param {object} o
   * @param {number} o.velocity 0..1 — loudness and brightness
   * @param {number} o.duration seconds before the damper falls
   * @param {number} o.B        inharmonicity (keep equal across a compared pair)
   */
  play(freq, t0, { velocity = 0.7, duration = 1.0, B = inharmonicity(freq) } = {}) {
    const ctx = this.ctx;
    const v = clamp(velocity, 0.05, 1);
    const nodes = [];

    // Note output with damper release.
    const out = ctx.createGain();
    out.gain.setValueAtTime(1, t0 + duration);
    out.gain.setTargetAtTime(0, t0 + duration, 0.07);
    out.connect(this.bus);

    // Tone filter: harder strikes are brighter; the sound darkens as it rings.
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.Q.value = 0.4;
    const c0 = Math.min(16000, freq * (3 + 20 * v * v));
    tone.frequency.setValueAtTime(c0, t0);
    tone.frequency.setTargetAtTime(Math.max(freq * 1.5, c0 * 0.4), t0 + 0.01, 0.6);
    tone.connect(out);

    const peak = dbToGain(-24 + 19 * v); // soft ≈ -23 dB, full ≈ -5 dB
    const tilt = 2.3 - 1.3 * v; // spectral slope: soft = steeper (darker)
    const maxF = Math.min(9000, ctx.sampleRate * 0.45);

    const partials = [];
    for (let n = 1; n <= 28; n++) {
      const fn = n * freq * Math.sqrt(1 + B * n * n);
      if (fn > maxF) break;
      // Hammer strikes near 1/7 of the string length, notching those partials.
      const strike = 0.35 + 0.65 * Math.abs(Math.sin((Math.PI * n) / 7));
      partials.push({ n, fn, a: strike / Math.pow(n, tilt) });
    }
    const norm = partials.reduce((s, p) => s + p.a, 0);

    const T = clamp(5 * Math.pow(130 / freq, 0.7), 0.6, 7); // fundamental decay (s)
    const atk = 0.002 + 0.006 * (1 - v);
    const stopAt = t0 + duration + 0.6;

    for (const p of partials) {
      const g = ctx.createGain();
      const amp = (peak * p.a) / norm;
      const tau = T / (1 + 0.45 * (p.n - 1));
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(amp, t0 + atk);
      g.gain.setTargetAtTime(0, t0 + atk, tau);
      g.connect(tone);

      const o = ctx.createOscillator();
      o.frequency.value = p.fn;
      o.connect(g);
      o.start(t0);
      o.stop(stopAt);
      nodes.push(o);
    }

    // Hammer thump.
    const ns = ctx.createBufferSource();
    ns.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = clamp(freq * 4, 400, 5000);
    bp.Q.value = 0.8;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0, t0);
    ng.gain.linearRampToValueAtTime(peak * 0.35 * v, t0 + 0.001);
    ng.gain.setTargetAtTime(0, t0 + 0.001, 0.01);
    ns.connect(bp).connect(ng).connect(out);
    ns.start(t0);
    ns.stop(t0 + 0.15);
    nodes.push(ns);

    const voice = { out, nodes };
    this.voices.add(voice);
    nodes[0].onended = () => this.voices.delete(voice);
    return voice;
  }

  // Quickly silence everything, including notes scheduled in the future.
  stopAll() {
    const now = this.ctx.currentTime;
    for (const { out, nodes } of this.voices) {
      const g = out.gain;
      if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(now);
      else g.cancelScheduledValues(now);
      g.setTargetAtTime(0, now, 0.012);
      for (const n of nodes) {
        try { n.stop(now + 0.08); } catch (_) { /* already stopped */ }
      }
    }
    this.voices.clear();
  }
}
