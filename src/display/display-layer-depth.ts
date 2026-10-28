/**
 * PLAN.md §1 layer depth constants for the backbox display stack.
 * Values are local Z offsets within the backbox root.
 *
 * Draw order is NOT decided by these offsets any more: the backbox Frame Graph renders one task per
 * layer in `BACKBOX_LAYER_ORDER` (backbox-graph-plan.ts) through an orthographic camera on the +Z
 * side of the stack, looking toward -Z. The offsets only keep each plane inside that camera's range
 * and give the physical drums room in front of their backdrop.
 *
 * Back → Front:
 *   PHYSICAL  — mechanical drums / static art (Layer 1)
 *   SHADER    — ambient cyber grid (depth atmosphere)
 *   REELS     — slot drums when visible
 *   MAIN      — primary video / image (Layer 2)
 *   CHARACTER — Nexus character take, composited over MAIN (display-character.ts)
 *   LCD       — transparent UI overlay (Layer 3)
 *
 * COMPOSITE is the one plane the scene camera sees (the glass). The scene camera is on the -Z side,
 * so the composite sits behind the layer stack's back, nearest the player.
 */

export const DISPLAY_LAYER_Z = {
  PHYSICAL: -0.65,
  SHADER: -0.5,
  REELS: -0.32,
  MAIN_VIDEO: 0.08,
  MAIN_IMAGE: 0.12,
  CHARACTER: 0.24,
  LCD: 0.38,
  COMPOSITE: -0.75,
} as const

export type DisplayLayerId = keyof typeof DISPLAY_LAYER_Z
