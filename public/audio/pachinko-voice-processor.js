// GENERATED from src/audio/pachinko-voice-processor.ts by scripts/build-audio-worklet.mjs.
// Do not edit: `npm run build:worklet` rewrites this file, `npm run check:worklet` fails on drift.
(() => {
  // src/audio/voice-hit.ts
  var VOICE_POOL_SIZE = 24;
  var MIN_AUDIBLE_IMPACT = 0.02;

  // src/audio/voice-pool.ts
  var VoicePool = class {
    size;
    /** Samples still to render. 0 = free slot. */
    samplesLeft;
    total;
    impact;
    metal;
    spin;
    fever;
    panL;
    panR;
    /** Noise LCG state. */
    seed;
    /** Ring-oscillator phase, in cycles. */
    phase;
    /** One-pole low-pass state. */
    lp;
    sampleRate;
    attackSamples;
    liveCount = 0;
    constructor(sampleRate2, size = VOICE_POOL_SIZE) {
      this.size = size;
      this.sampleRate = sampleRate2;
      this.attackSamples = Math.max(1, sampleRate2 * 15e-4);
      this.samplesLeft = new Int32Array(size);
      this.total = new Int32Array(size);
      this.impact = new Float32Array(size);
      this.metal = new Float32Array(size);
      this.spin = new Float32Array(size);
      this.fever = new Float32Array(size);
      this.panL = new Float32Array(size);
      this.panR = new Float32Array(size);
      this.seed = new Int32Array(size);
      this.phase = new Float32Array(size);
      this.lp = new Float32Array(size);
    }
    /** Voices currently sounding. */
    get live() {
      return this.liveCount;
    }
    /** Current output level of a slot: its gain at this point of the decay. 0 for a free slot. */
    level(slot) {
      const left = this.samplesLeft[slot];
      if (left <= 0) return 0;
      const env = left / this.total[slot];
      return this.impact[slot] * env * env;
    }
    /**
     * Start a voice in a free slot, or steal the quietest live one when all `size` are sounding.
     * Returns the slot used, or -1 when the hit is below {@link MIN_AUDIBLE_IMPACT}.
     */
    trigger(hit) {
      const impact = hit.impact;
      if (!(impact >= MIN_AUDIBLE_IMPACT)) return -1;
      let slot = -1;
      let quietest = Infinity;
      for (let i = 0; i < this.size; i++) {
        const level = this.level(i);
        if (level < quietest) {
          quietest = level;
          slot = i;
          if (level === 0) break;
        }
      }
      const length = Math.max(1, Math.floor(this.sampleRate * (6e-3 + impact * 0.024)));
      if (this.samplesLeft[slot] <= 0) this.liveCount++;
      this.samplesLeft[slot] = length;
      this.total[slot] = length;
      this.impact[slot] = impact;
      this.metal[slot] = hit.metal;
      this.spin[slot] = hit.spin;
      this.fever[slot] = hit.fever;
      this.panL[slot] = Math.min(1, 1 - hit.pan) * 0.707;
      this.panR[slot] = Math.min(1, 1 + hit.pan) * 0.707;
      this.seed[slot] = Math.random() * 1e9 | 0;
      this.phase[slot] = 0;
      this.lp[slot] = 0;
      return slot;
    }
    /** Mix every live voice into `left` (and `right` unless it is the same buffer). Overwrites both. */
    render(left, right) {
      left.fill(0);
      const stereo = right !== left;
      if (stereo) right.fill(0);
      if (this.liveCount === 0) return;
      const sampleRate2 = this.sampleRate;
      const attackSamples = this.attackSamples;
      const frames = left.length;
      for (let v = 0; v < this.size; v++) {
        let remaining = this.samplesLeft[v];
        if (remaining <= 0) continue;
        const total = this.total[v];
        const impact = this.impact[v];
        const metal = this.metal[v];
        const coeff = 0.12 + metal * 0.55 + this.fever[v] * 0.2;
        const phaseStep = (420 + metal * 1800 + this.spin[v] * 90) / sampleRate2;
        const bodyGain = 0.55 + metal * 0.35;
        const panL = this.panL[v];
        const panR = this.panR[v];
        let seed = this.seed[v];
        let phase = this.phase[v];
        let y = this.lp[v];
        for (let i = 0; i < frames && remaining > 0; i++) {
          seed = Math.imul(seed, 1664525) + 1013904223 | 0;
          const noise = (seed >>> 8) / 16777216 * 2 - 1;
          const env = remaining / total;
          const attack = 1 - Math.min(1, (total - remaining) / attackSamples);
          const gain = impact * env * env * (0.35 + (1 - attack) * 0.65);
          y += coeff * (noise - y);
          phase += phaseStep;
          if (phase >= 1) phase -= 1;
          const ring = Math.sin(phase * Math.PI * 2) * metal * 0.35;
          const sample = (y * bodyGain + ring * env) * gain;
          left[i] += sample * panL;
          if (stereo) right[i] += sample * panR;
          remaining--;
        }
        this.samplesLeft[v] = remaining;
        this.seed[v] = seed;
        this.phase[v] = phase;
        this.lp[v] = y;
        if (remaining <= 0) this.liveCount--;
      }
    }
  };

  // src/audio/pachinko-voice-processor.ts
  var PachinkoVoiceProcessor = class extends AudioWorkletProcessor {
    pool = new VoicePool(sampleRate, VOICE_POOL_SIZE);
    constructor() {
      super();
      this.port.onmessage = (event) => {
        this.pool.trigger(event.data);
      };
    }
    process(_inputs, outputs) {
      const output = outputs[0];
      const left = output?.[0];
      if (!output || !left) return true;
      this.pool.render(left, output[1] ?? left);
      return true;
    }
  };
  registerProcessor("pachinko-voice", PachinkoVoiceProcessor);
})();
