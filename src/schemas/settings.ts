/**
 * The stored `GameSettings` record (`pachinball.settings` in `localStorage`),
 * as a Valibot schema (#505 §A). Every field is lenient: a field an older
 * build wrote with another type, or not at all, reads as absent and takes its
 * default; the rest of the record survives. `scanlineIntensity` is the
 * pre-split name of `scanlineWeight`, still read for migration.
 *
 * The one schema on the boot path, so it stays small.
 */

import * as v from 'valibot'
import { lenient } from './record-kit'

const finite = () => v.pipe(v.number(), v.finite())

export const QUALITY_PRESETS = ['low', 'medium', 'high'] as const
export const AUDIO_SOURCES = ['synth', 'samples'] as const

export const StoredSettingsSchema = v.object({
  reducedMotion: lenient(v.boolean()),
  shakeIntensity: lenient(finite()),
  photosensitiveMode: lenient(v.boolean()),
  qualityPreset: lenient(v.picklist(QUALITY_PRESETS)),
  enableFog: lenient(v.boolean()),
  enableShadows: lenient(v.boolean()),
  scanlineWeight: lenient(finite()),
  scanlineEnabled: lenient(v.boolean()),
  scanlineIntensityMultiplier: lenient(finite()),
  enableDebugHUD: lenient(v.boolean()),
  enablePhysicsTuning: lenient(v.boolean()),
  masterVolume: lenient(finite()),
  musicVolume: lenient(finite()),
  sfxVolume: lenient(finite()),
  muted: lenient(v.boolean()),
  audioSource: lenient(v.picklist(AUDIO_SOURCES)),
  reducedAudio: lenient(v.boolean()),
  hapticsEnabled: lenient(v.boolean()),
  /** Legacy name of `scanlineWeight`. */
  scanlineIntensity: lenient(finite()),
})

export type StoredSettings = v.InferOutput<typeof StoredSettingsSchema>
