/**
 * Track material references that need no schema: the four theme roles and
 * the `pbr:#rrggbb` prefix. The compiler resolves materials with these, so it
 * stays free of the Valibot track schema (`src/schemas/track.ts`), which
 * loads lazily with the track data.
 */

import type { TrackMaterialRole } from './track-theme-profiles'

export const TRACK_MATERIAL_ROLES = ['structure', 'accent', 'energy', 'glow'] as const satisfies readonly TrackMaterialRole[]

const ROLE_SET: ReadonlySet<string> = new Set(TRACK_MATERIAL_ROLES)

/** Prefix of a material ref that asks for the PBR (glassy, clear-coat) track material. */
export const PBR_MATERIAL_PREFIX = 'pbr:'

export function isMaterialRole(ref: string): ref is TrackMaterialRole {
  return ROLE_SET.has(ref)
}
