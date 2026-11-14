/**
 * A machine's backbox clips mapped onto `GameConfig.backbox` (#506 Slice A).
 * Its own small module: `game/init/register-rendering.ts` (entry chunk) calls it, while
 * the loader and schema stay in the lazy machine chunk.
 */

import { backboxAssetUrl } from '../config/api'
import type { LegacyBackboxConfig } from '../display/display-types'
import type { MachineDescriptor } from '../schemas/machine'

/** Every field of the backbox config; `GameConfig.backbox` serves its paths as getters, which a spread would drop. */
const BACKBOX_KEYS = [
  'attractVideoPath', 'videoReplacesReels', 'attractImagePath', 'imageOpacity', 'imageBlendMode',
  'jackpotVideoPath', 'feverVideoPath', 'reachVideoPath', 'adventureVideoPath',
  'jackpotImagePath', 'feverImagePath', 'reachImagePath', 'adventureImagePath',
  'idleCharacterPath', 'reachCharacterPath', 'feverCharacterPath', 'jackpotCharacterPath',
] as const satisfies readonly (keyof LegacyBackboxConfig)[]

/** `GameConfig.backbox` with the machine's idle / reach / fever clips swapped in (a plain copy without a machine). */
export function machineBackboxConfig(base: LegacyBackboxConfig, machine: MachineDescriptor | null): LegacyBackboxConfig {
  const out: Record<string, unknown> = {}
  for (const key of BACKBOX_KEYS) if (base[key] !== undefined) out[key] = base[key]
  const config = out as LegacyBackboxConfig
  if (!machine) return config
  const { idle, reach, fever } = machine.backbox
  config.attractVideoPath = backboxAssetUrl(idle.video)
  if (idle.poster) config.attractImagePath = backboxAssetUrl(idle.poster)
  config.reachVideoPath = backboxAssetUrl(reach.video)
  if (reach.poster) config.reachImagePath = backboxAssetUrl(reach.poster)
  config.feverVideoPath = backboxAssetUrl(fever.video)
  if (fever.poster) config.feverImagePath = backboxAssetUrl(fever.poster)
  return config
}
