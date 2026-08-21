/**
 * Pachinko impact voice — modal-ish filtered noise, not oscillator beeps.
 * Main thread posts { type, velocity, pan, metal, spin, fever, impact } once per contact.
 *
 * Parameters duck the current voice; new hits are one-shots queued on the processor.
 */
class PachinkoVoiceProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.voices = []
    this.phase = 0
    this.port.onmessage = (event) => {
      const data = event.data || {}
      const vel = clamp01(Number(data.velocity) || 0)
      const impact = clamp01(Number(data.impact) ?? vel)
      if (impact < 0.02) return
      const metal = clamp01(Number(data.metal) ?? 0.5)
      const spin = clamp01(Number(data.spin) ?? 0)
      const fever = clamp01(Number(data.fever) ?? 0)
      const pan = Math.max(-1, Math.min(1, Number(data.pan) || 0))
      const duration = 0.006 + impact * 0.024
      this.voices.push({
        samplesLeft: Math.max(1, Math.floor(sampleRate * duration)),
        total: Math.max(1, Math.floor(sampleRate * duration)),
        impact,
        metal,
        spin,
        fever,
        pan,
        seed: (Math.random() * 1e9) | 0,
      })
      if (this.voices.length > 24) this.voices.shift()
    }
  }

  process(_inputs, outputs) {
    const output = outputs[0]
    if (!output || !output[0]) return true
    const left = output[0]
    const right = output[1] || output[0]
    left.fill(0)
    if (right !== left) right.fill(0)

    for (let v = this.voices.length - 1; v >= 0; v--) {
      const voice = this.voices[v]
      const lp = 0.12 + voice.metal * 0.55 + voice.fever * 0.2
      let s = 0
      let y = 0
      for (let i = 0; i < left.length; i++) {
        if (voice.samplesLeft <= 0) break
        voice.seed = (voice.seed * 1664525 + 1013904223) | 0
        const noise = ((voice.seed >>> 8) / 0x1000000) * 2 - 1
        const env = voice.samplesLeft / voice.total
        const attack = 1 - Math.min(1, (voice.total - voice.samplesLeft) / Math.max(1, sampleRate * 0.0015))
        const gain = voice.impact * env * env * (0.35 + (1 - attack) * 0.65)
        // Cheap 1-pole + metal ring
        y += lp * (noise - y)
        this.phase += (420 + voice.metal * 1800 + voice.spin * 90) / sampleRate
        const ring = Math.sin(this.phase * Math.PI * 2) * voice.metal * 0.35
        const sample = (y * (0.55 + voice.metal * 0.35) + ring * env) * gain
        const panL = Math.min(1, 1 - voice.pan) * 0.707
        const panR = Math.min(1, 1 + voice.pan) * 0.707
        left[i] += sample * panL
        if (right !== left) right[i] += sample * panR
        voice.samplesLeft -= 1
        s++
      }
      if (voice.samplesLeft <= 0) this.voices.splice(v, 1)
    }
    return true
  }
}

function clamp01(n) {
  if (!Number.isFinite(n)) return 0
  return n < 0 ? 0 : n > 1 ? 1 : n
}

registerProcessor('pachinko-voice', PachinkoVoiceProcessor)
