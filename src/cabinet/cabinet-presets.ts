/**
 * Cabinet preset data — the four `CabinetPreset` configs, kept apart from the
 * procedural builders so the boot graph carries only this data. The builders
 * (`cabinet-classic.ts` etc.) are loaded on demand by `CabinetBuilder` when a
 * preset is actually built (bundle-budget.json).
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { CabinetPreset } from './cabinet-types'

export const CLASSIC_CONFIG: CabinetPreset = {
  type: 'classic',
  name: 'Classic Pinball',
  description: 'Traditional wooden cabinet with chrome trim',

  width: 32,
  depth: 44,
  sideHeight: 20,
  baseY: -10,
  backboxZ: 30,
  backboxHeight: 18,
  backboxDepth: 10,

  bodyMaterial: 'wood',
  trimMaterial: 'chrome',
  interiorMaterial: 'dark_felt',

  neonLayout: {
    frontVertical: true,
    sideHorizontal: false,
    marquee: true,
    coinDoor: true,
    underCabinet: false,
    backboxEdge: false,
  },

  lightPoints: {
    interior: new Vector3(0, 2, 5),
    leftAccent: new Vector3(-15, 6, -8),
    rightAccent: new Vector3(15, 6, -8),
    marqueeSpot: {
      pos: new Vector3(0, 19, 26),
      target: new Vector3(0, -1, 0.3),
    },
  },

  hasAngledSides: false,
  hasExtendedMarquee: false,
  hasCoinDoor: true,

  gltf: {
    simpleUrl: 'models/cabinet/classic/simple.glb',
    highUrl: 'models/cabinet/classic/high.glb',
    loadTimeoutMs: 15_000,
  },
}

export const NEO_CONFIG: CabinetPreset = {
  type: 'neo',
  name: 'Neo Arcade',
  description: 'Sleek black metal with aggressive angles and intense neon',

  width: 30,
  depth: 42,
  sideHeight: 18,
  baseY: -10,
  backboxZ: 28,
  backboxHeight: 16,
  backboxDepth: 8,

  bodyMaterial: 'matte_black',
  trimMaterial: 'black_metal',
  interiorMaterial: 'gloss_black',

  neonLayout: {
    frontVertical: true,
    sideHorizontal: true,
    marquee: true,
    coinDoor: true,
    underCabinet: true,
    backboxEdge: true,
  },

  lightPoints: {
    interior: new Vector3(0, 1, 5),
    leftAccent: new Vector3(-14, 4, -10),
    rightAccent: new Vector3(14, 4, -10),
    marqueeSpot: {
      pos: new Vector3(0, 17, 24),
      target: new Vector3(0, -1, 0.2),
    },
    underGlow: new Vector3(0, -8, 5),
  },

  hasAngledSides: true,
  hasExtendedMarquee: true,
  hasCoinDoor: true,
}

export const VERTICAL_CONFIG: CabinetPreset = {
  type: 'vertical',
  name: 'Vertical Shooter',
  description: 'Tall narrow cabinet for vertical orientation games',

  width: 26,
  depth: 38,
  sideHeight: 22,
  baseY: -10,
  backboxZ: 24,
  backboxHeight: 24,
  backboxDepth: 12,

  bodyMaterial: 'carbon_fiber',
  trimMaterial: 'copper',
  interiorMaterial: 'matte_black',

  neonLayout: {
    frontVertical: true,
    sideHorizontal: false,
    marquee: true,
    coinDoor: false,
    underCabinet: true,
    backboxEdge: true,
  },

  lightPoints: {
    interior: new Vector3(0, 3, 5),
    leftAccent: new Vector3(-12, 8, -6),
    rightAccent: new Vector3(12, 8, -6),
    marqueeSpot: {
      pos: new Vector3(0, 21, 20),
      target: new Vector3(0, -1, 0.4),
    },
    underGlow: new Vector3(0, -8, 5),
  },

  hasAngledSides: false,
  hasExtendedMarquee: true,
  hasCoinDoor: false,
}

export const WIDE_CONFIG: CabinetPreset = {
  type: 'wide',
  name: 'Deluxe Wide',
  description: 'Extra wide cabinet for deluxe experience',

  width: 38,
  depth: 48,
  sideHeight: 20,
  baseY: -10,
  backboxZ: 32,
  backboxHeight: 18,
  backboxDepth: 10,

  bodyMaterial: 'metal',
  trimMaterial: 'gold',
  interiorMaterial: 'dark_felt',

  neonLayout: {
    frontVertical: true,
    sideHorizontal: true,
    marquee: true,
    coinDoor: true,
    underCabinet: false,
    backboxEdge: true,
  },

  lightPoints: {
    interior: new Vector3(0, 2, 5),
    leftAccent: new Vector3(-18, 6, -8),
    rightAccent: new Vector3(18, 6, -8),
    marqueeSpot: {
      pos: new Vector3(0, 19, 28),
      target: new Vector3(0, -1, 0.3),
    },
  },

  hasAngledSides: false,
  hasExtendedMarquee: false,
  hasCoinDoor: true,
}
