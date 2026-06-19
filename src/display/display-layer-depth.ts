/**
 * PLAN.md §1 layer depth constants for the backbox display stack.
 * Values are local Z offsets within the backbox root (camera faces -Z).
 *
 * Back → Front:
 *   PHYSICAL  — mechanical drums / static art (Layer 1)
 *   SHADER    — ambient cyber grid (depth atmosphere)
 *   REELS     — slot drums when visible
 *   MAIN      — primary video / image (Layer 2)
 *   LCD       — transparent UI overlay (Layer 3)
 */

export const DISPLAY_LAYER_Z = {
  PHYSICAL: -0.65,
  SHADER: -0.5,
  REELS: -0.32,
  MAIN_VIDEO: 0.08,
  MAIN_IMAGE: 0.12,
  LCD: 0.38,
} as const

export type DisplayLayerId = keyof typeof DISPLAY_LAYER_Z
