/**
 * Cabinet Types - Shared type definitions for cabinet system
 */

import { Vector3 } from '@babylonjs/core'

export type CabinetType = 'classic' | 'neo' | 'vertical' | 'wide'

export interface CabinetPreset {
  /** Preset identifier */
  type: CabinetType
  /** Display name */
  name: string
  /** Description for UI */
  description: string

  // Dimensions
  width: number
  depth: number
  sideHeight: number
  baseY: number
  backboxZ: number
  backboxHeight: number
  backboxDepth: number

  // Materials
  bodyMaterial: 'wood' | 'metal' | 'matte_black' | 'carbon_fiber'
  trimMaterial: 'chrome' | 'black_metal' | 'gold' | 'copper'
  interiorMaterial: 'dark_felt' | 'matte_black' | 'gloss_black'

  // Neon layout
  neonLayout: {
    frontVertical: boolean
    sideHorizontal: boolean
    marquee: boolean
    coinDoor: boolean
    underCabinet: boolean
    backboxEdge: boolean
  }

  // Lighting positions (relative to cabinet center)
  lightPoints: {
    interior: Vector3
    leftAccent: Vector3
    rightAccent: Vector3
    marqueeSpot: { pos: Vector3; target: Vector3 }
    underGlow?: Vector3
  }

  // Special features
  hasAngledSides: boolean
  hasExtendedMarquee: boolean
  hasCoinDoor: boolean
}

export interface CabinetDimensions {
  width: number
  depth: number
  sideHeight: number
  baseY: number
  backboxZ: number
  backboxHeight: number
  backboxDepth: number
}

export interface CabinetPart {
  name: string
  meshName: string
  position: Vector3
  rotation?: Vector3
  scaling?: Vector3
}

export interface CabinetConfig {
  type: CabinetType
  name: string
  description: string
  dimensions: CabinetDimensions
  materials: {
    body: 'wood' | 'metal' | 'matte_black' | 'carbon_fiber'
    trim: 'chrome' | 'black_metal' | 'gold' | 'copper'
    interior: 'dark_felt' | 'matte_black' | 'gloss_black'
  }
  features: {
    hasAngledSides: boolean
    hasExtendedMarquee: boolean
    hasCoinDoor: boolean
  }
  neonLayout: CabinetPreset['neonLayout']
  lightPoints: CabinetPreset['lightPoints']
}
