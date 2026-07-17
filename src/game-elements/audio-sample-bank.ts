import type { ImpactCategory } from './audio-synth'

/** Keys for short SFX samples under `public/audio/`. */
export type AudioSampleKey =
  | 'flipper'
  | 'bumper'
  | 'drain'
  | 'gold-collect'
  | 'jackpot-phase1'
  | 'jackpot-phase2'
  | 'jackpot-phase3'
  | 'portal'
  | 'slot-stop'

/** Loopable music stems under `public/audio/`. */
export type AudioMusicStem = 'attract' | 'fever'

export type AudioSourceMode = 'synth' | 'samples'

export type SampleCategory = 'peg' | 'bumper' | 'flipper' | 'jackpot' | 'fever' | 'launch' | 'drain'

export interface LocalSampleDef {
  key: AudioSampleKey
  file: string
  category: SampleCategory
  impactCategory?: ImpactCategory
}

export interface LocalMusicDef {
  stem: AudioMusicStem
  file: string
  title: string
}

export const LOCAL_SAMPLE_BANK: readonly LocalSampleDef[] = [
  { key: 'flipper', file: 'flipper.ogg', category: 'flipper', impactCategory: 'flipper' },
  { key: 'bumper', file: 'bumper.ogg', category: 'bumper', impactCategory: 'bumper' },
  { key: 'drain', file: 'drain.ogg', category: 'drain', impactCategory: 'drain' },
  { key: 'gold-collect', file: 'gold-collect.ogg', category: 'jackpot', impactCategory: 'jackpot' },
  { key: 'jackpot-phase1', file: 'jackpot-phase1.ogg', category: 'jackpot' },
  { key: 'jackpot-phase2', file: 'jackpot-phase2.ogg', category: 'jackpot' },
  { key: 'jackpot-phase3', file: 'jackpot-phase3.ogg', category: 'jackpot' },
  { key: 'portal', file: 'portal.ogg', category: 'jackpot' },
  { key: 'slot-stop', file: 'slot-stop.ogg', category: 'jackpot' },
] as const

export const LOCAL_MUSIC_STEMS: readonly LocalMusicDef[] = [
  { stem: 'attract', file: 'music-attract.ogg', title: 'Attract Loop' },
  { stem: 'fever', file: 'music-fever.ogg', title: 'Fever Loop' },
] as const

const IMPACT_TO_SAMPLE = new Map<ImpactCategory, AudioSampleKey>(
  LOCAL_SAMPLE_BANK
    .filter((def): def is LocalSampleDef & { impactCategory: ImpactCategory } => def.impactCategory !== undefined)
    .map((def) => [def.impactCategory, def.key]),
)

const CATEGORY_TO_SAMPLE = new Map<SampleCategory, AudioSampleKey>([
  ['flipper', 'flipper'],
  ['bumper', 'bumper'],
  ['drain', 'drain'],
])

/** Resolve a public/audio path for Vite static serving. */
export function getLocalAudioPath(fileName: string): string {
  const base = (import.meta.env.BASE_URL as string) || '/'
  return `${base}audio/${fileName}`
}

export function getSampleKeyForImpact(category: ImpactCategory): AudioSampleKey | undefined {
  return IMPACT_TO_SAMPLE.get(category)
}

export function getSampleKeyForCategory(category: SampleCategory): AudioSampleKey | undefined {
  return CATEGORY_TO_SAMPLE.get(category)
}

export function getJackpotPhaseSampleKey(phase: number): AudioSampleKey | undefined {
  if (phase === 1) return 'jackpot-phase1'
  if (phase === 2) return 'jackpot-phase2'
  if (phase === 3) return 'jackpot-phase3'
  return undefined
}
