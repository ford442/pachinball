/**
 * Pachinko impact voice: filtered noise plus a short metal ring, not oscillator beeps.
 *
 * Authored here, bundled by `scripts/build-audio-worklet.mjs` to the classic script
 * `public/audio/pachinko-voice-processor.js` (an AudioWorklet module loads outside the Vite
 * graph). `npm run check:worklet` fails when the committed script drifts from this source.
 *
 * Main thread posts one `VoiceHit` per contact. The voices live in a fixed `VoicePool`; neither
 * `onmessage` nor `process()` allocates. Typed against `worklet-globals.d.ts`
 * (tsconfig.worklet.json); this file is excluded from the DOM-lib app project.
 */
import { VOICE_POOL_SIZE, type VoiceHit } from './voice-hit'
import { VoicePool } from './voice-pool'

class PachinkoVoiceProcessor extends AudioWorkletProcessor {
  private readonly pool = new VoicePool(sampleRate, VOICE_POOL_SIZE)

  constructor() {
    super()
    // The main thread only ever posts a VoiceHit (AudioEngine.playVoice); no re-parsing here.
    this.port.onmessage = (event) => {
      this.pool.trigger(event.data as VoiceHit)
    }
  }

  override process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0]
    const left = output?.[0]
    if (!output || !left) return true
    this.pool.render(left, output[1] ?? left)
    return true
  }
}

registerProcessor('pachinko-voice', PachinkoVoiceProcessor)
