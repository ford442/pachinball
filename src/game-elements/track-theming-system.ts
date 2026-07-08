import { Color3 } from '@babylonjs/core'
import type { Scene } from '@babylonjs/core'

import { getMaterialLibrary } from '../materials'
import type { DisplaySystem } from '../display'
import type { EffectsSystem } from '../effects'
import type { BallManager } from './ball-manager'
import { TRACK_CATALOG, type TrackInfo } from './adventure-track-progression'
import { PALETTE, SURFACES, INTENSITY, emissive, color, QualityTier } from './visual-language'
import {
  getTrackThemeProfile,
  type TrackMaterialRole,
  type TrackThemeProfile,
} from './track-theme-profiles'
import type { SpinnerBumperVisual, MovingGateState, GameObjects } from '../objects'
import type { TableMapManager } from '../game/game-maps'
import type { AdventureMode } from '../adventure'
import { getCabinetBuilder } from '../cabinet'

type SurfaceTintKey = keyof typeof SURFACES

export interface TrackVisualTheme {
  primary: keyof typeof PALETTE
  accent?: keyof typeof PALETTE
  surfaceTint?: SurfaceTintKey
}

export const TRACK_THEME_OVERRIDES: Record<string, TrackVisualTheme> = {
  NEON_HELIX: { primary: 'CYAN', accent: 'MAGENTA', surfaceTint: 'PLAYFIELD' },
  PACHINKO_HALL: { primary: 'GOLD', accent: 'MAGENTA', surfaceTint: 'PLAYFIELD' },
  CYBER_CORE: { primary: 'MAGENTA', accent: 'CYAN', surfaceTint: 'PLAYFIELD_DEEP' },
  QUANTUM_GRID: { primary: 'PURPLE', accent: 'WHITE', surfaceTint: 'GLASS' },
  PACHINKO_SPIRE: { primary: 'GOLD', accent: 'ALERT', surfaceTint: 'PLAYFIELD' },
  SINGULARITY_WELL: { primary: 'ALERT', accent: 'AMBIENT', surfaceTint: 'PLAYFIELD_DEEP' },
  GLITCH_SPIRE: { primary: 'MATRIX', accent: 'CYAN', surfaceTint: 'GLASS' },
  RETRO_WAVE_HILLS: { primary: 'MAGENTA', accent: 'CYAN', surfaceTint: 'PLAYFIELD' },
  CHRONO_CORE: { primary: 'GOLD', accent: 'ALERT', surfaceTint: 'PLAYFIELD_DEEP' },
  HYPER_DRIFT: { primary: 'CYAN', accent: 'WHITE', surfaceTint: 'PLAYFIELD' },
  ORBITAL_JUNKYARD: { primary: 'AMBIENT', accent: 'ALERT', surfaceTint: 'PLAYFIELD_DEEP' },
  FIREWALL_BREACH: { primary: 'ALERT', accent: 'GOLD', surfaceTint: 'PLAYFIELD_DEEP' },
  CPU_CORE: { primary: 'MATRIX', accent: 'CYAN', surfaceTint: 'GLASS' },
  CRYO_CHAMBER: { primary: 'WHITE', accent: 'CYAN', surfaceTint: 'GLASS' },
  BIO_HAZARD_LAB: { primary: 'MATRIX', accent: 'ALERT', surfaceTint: 'PLAYFIELD' },
  GRAVITY_FORGE: { primary: 'ALERT', accent: 'PURPLE', surfaceTint: 'PLAYFIELD_DEEP' },
  TIDAL_NEXUS: { primary: 'CYAN', accent: 'MATRIX', surfaceTint: 'GLASS' },
  DIGITAL_ZEN_GARDEN: { primary: 'MATRIX', accent: 'PURPLE', surfaceTint: 'PLAYFIELD' },
  SYNTHWAVE_SURF: { primary: 'MAGENTA', accent: 'CYAN', surfaceTint: 'PLAYFIELD' },
  SOLAR_FLARE: { primary: 'GOLD', accent: 'ALERT', surfaceTint: 'PLAYFIELD' },
  PRISM_PATHWAY: { primary: 'WHITE', accent: 'GOLD', surfaceTint: 'GLASS' },
  MAGNETIC_STORAGE: { primary: 'PURPLE', accent: 'MAGENTA', surfaceTint: 'PLAYFIELD_DEEP' },
  NEURAL_NETWORK: { primary: 'MATRIX', accent: 'GOLD', surfaceTint: 'GLASS' },
  NEON_STRONGHOLD: { primary: 'CYAN', accent: 'PURPLE', surfaceTint: 'PLAYFIELD' },
  CASINO_HEIST: { primary: 'GOLD', accent: 'MAGENTA', surfaceTint: 'PLAYFIELD_DEEP' },
  TESLA_TOWER: { primary: 'WHITE', accent: 'PURPLE', surfaceTint: 'GLASS' },
  NEON_SKYLINE: { primary: 'MAGENTA', accent: 'CYAN', surfaceTint: 'PLAYFIELD' },
  POLYCHROME_VOID: { primary: 'WHITE', accent: 'PURPLE', surfaceTint: 'GLASS' },
}

interface EmissiveMaterialLike {
  emissiveColor: Color3
}

export function applyThemeEmissiveColor(
  material: EmissiveMaterialLike,
  primaryColor: keyof typeof PALETTE,
  intensity: number = INTENSITY.ACTIVE,
): void {
  material.emissiveColor.copyFrom(emissive(PALETTE[primaryColor], intensity))
}

export interface TrackThemingSystemDeps {
  gameObjects: GameObjects | null
  ballManager: BallManager | null
  spinnerVisuals: SpinnerBumperVisual[]
  gateStates: MovingGateState[]
  cabinetNeonLights: Array<{ diffuse: Color3 }>
  display: DisplaySystem | null
  effects: EffectsSystem | null
  mapManager: TableMapManager | null
  qualityTier: QualityTier
  scene: Scene
  adventureMode?: AdventureMode | null
}

export class TrackThemingSystem {
  private readonly deps: TrackThemingSystemDeps
  private activeTrackId: string | null = null
  private activeTheme: TrackVisualTheme | null = null

  constructor(deps: TrackThemingSystemDeps) {
    this.deps = deps
  }

  resolveTheme(trackId: string): TrackVisualTheme {
    const catalogTheme = this.getCatalogTheme(trackId)
    if (catalogTheme) return catalogTheme
    return TRACK_THEME_OVERRIDES[trackId] ?? { primary: 'CYAN', accent: 'MAGENTA', surfaceTint: 'PLAYFIELD' }
  }

  update(trackId: string | null): void {
    if (!trackId) {
      if (this.activeTrackId) {
        this.applyMapFallbackTheme()
      }
      this.activeTrackId = null
      this.activeTheme = null
      return
    }

    const theme = this.resolveTheme(trackId)
    if (this.activeTrackId === trackId && this.activeTheme && !this.needsReapply(theme)) {
      return
    }

    this.applyTheme(trackId, theme)
  }

  applyTheme(trackId: string, theme: TrackVisualTheme = this.resolveTheme(trackId)): void {
    const profile = getTrackThemeProfile(trackId)
    const palette = profile?.palette ?? theme
    const primaryKey = palette.primary
    const accentKey = palette.accent ?? palette.primary
    const surfaceKey = palette.surfaceTint ?? theme.surfaceTint ?? 'PLAYFIELD'

    const primaryHex = profile?.cabinet.primary ?? PALETTE[primaryKey]
    const accentHex = profile?.cabinet.accent ?? PALETTE[accentKey]
    const surfaceHex = SURFACES[surfaceKey]
    const matLib = getMaterialLibrary(this.deps.scene)

    this.applyBumperTheme(primaryKey)
    this.applySpinnerTheme(primaryKey)
    this.applyGateTheme(primaryKey)

    this.deps.ballManager?.updateBallMaterialColor(primaryHex)
    this.deps.gameObjects?.updateBumperColors(primaryHex)
    matLib.updateFlipperMaterialEmissive(primaryHex)
    matLib.updatePinMaterialEmissive(primaryHex)
    matLib.updateBrushedMetalMaterialEmissive(primaryHex)
    matLib.updateChromeMaterialEmissive(primaryHex)
    matLib.updateLCDTableEmissive(primaryHex)
    if (this.deps.qualityTier !== QualityTier.LOW) {
      matLib.updatePlayfieldTheme(surfaceHex, accentHex)
    }

    this.applyCabinetTheme(primaryKey, accentKey)
    getCabinetBuilder(this.deps.scene).setThemeFromColors(primaryHex, accentHex)
    this.deps.display?.setTrackTheme(primaryHex, accentHex)
    this.deps.effects?.setCabinetColor(primaryHex)

    if (profile) {
      this.applyPremiumProfile(profile)
    } else {
      this.deps.effects?.setTrackThemeProfile(null)
    }

    this.activeTrackId = trackId
    this.activeTheme = theme
  }

  private applyPremiumProfile(profile: TrackThemeProfile): void {
    this.retintAdventureTrackMaterials(profile)
    this.deps.effects?.setTrackThemeProfile(profile)
  }

  private retintAdventureTrackMaterials(profile: TrackThemeProfile): void {
    const materials = this.deps.adventureMode?.getTrackMaterials() ?? []
    for (const mat of materials) {
      const role = mat.metadata?.trackMaterialRole as TrackMaterialRole | undefined
      if (!role) continue
      const hex = profile.materials[role]
      mat.emissiveColor = Color3.FromHexString(hex)
      if ('emissiveIntensity' in mat && typeof mat.emissiveIntensity === 'number') {
        mat.emissiveIntensity = role === 'energy' ? 1.5 : 1.2
      }
    }
  }

  private getCatalogTheme(trackId: string): TrackVisualTheme | null {
    const track = TRACK_CATALOG[trackId] as TrackInfo | undefined
    if (!track?.visualTheme) return null
    return {
      primary: track.visualTheme.primary,
      accent: track.visualTheme.accent,
      surfaceTint: track.visualTheme.surfaceTint as SurfaceTintKey | undefined,
    }
  }

  private applyBumperTheme(primaryColor: keyof typeof PALETTE): void {
    const visuals = this.deps.gameObjects?.getBumperVisuals() ?? []
    const target = emissive(PALETTE[primaryColor], INTENSITY.ACTIVE)
    for (const visual of visuals) {
      visual.color = PALETTE[primaryColor]
      visual.targetEmissive = target.clone()
      visual.currentEmissive = target.clone()
      visual.flashTimer = 0

      const mat = visual.mesh.material as EmissiveMaterialLike | null
      if (mat?.emissiveColor) {
        applyThemeEmissiveColor(mat, primaryColor, INTENSITY.ACTIVE)
      }
      const ringMat = visual.wireframeRing?.material as EmissiveMaterialLike | null
      if (ringMat?.emissiveColor) {
        applyThemeEmissiveColor(ringMat, primaryColor, INTENSITY.HIGH)
      }
    }
  }

  private applySpinnerTheme(primaryColor: keyof typeof PALETTE): void {
    for (const spinner of this.deps.spinnerVisuals) {
      spinner.color = PALETTE[primaryColor]
      const mat = spinner.mesh.material as EmissiveMaterialLike | null
      if (mat?.emissiveColor) {
        applyThemeEmissiveColor(mat, primaryColor, INTENSITY.ACTIVE)
      }
    }
  }

  private applyGateTheme(primaryColor: keyof typeof PALETTE): void {
    for (const gate of this.deps.gateStates) {
      gate.gateColor = PALETTE[primaryColor]
      const mat = gate.mesh.material as EmissiveMaterialLike | null
      if (mat?.emissiveColor) {
        applyThemeEmissiveColor(mat, primaryColor, INTENSITY.ACTIVE)
      }
    }
  }

  private applyCabinetTheme(primaryColor: keyof typeof PALETTE, accentColor: keyof typeof PALETTE): void {
    const primary = color(PALETTE[primaryColor])
    const accent = color(PALETTE[accentColor])
    const blend = Color3.Lerp(primary, accent, 0.5)

    if (this.deps.cabinetNeonLights[0]) this.deps.cabinetNeonLights[0].diffuse = primary
    if (this.deps.cabinetNeonLights[1]) this.deps.cabinetNeonLights[1].diffuse = accent
    if (this.deps.cabinetNeonLights[2]) this.deps.cabinetNeonLights[2].diffuse = blend
    if (this.deps.cabinetNeonLights[3]) this.deps.cabinetNeonLights[3].diffuse = primary
  }

  private applyMapFallbackTheme(): void {
    this.deps.effects?.setTrackThemeProfile(null)

    const mapConfig = this.deps.mapManager?.getCurrentConfig()
    if (!mapConfig) return

    const matLib = getMaterialLibrary(this.deps.scene)
    this.deps.ballManager?.updateBallMaterialColor(mapConfig.baseColor)
    this.deps.gameObjects?.updateBumperColors(mapConfig.baseColor)
    matLib.updateFlipperMaterialEmissive(mapConfig.baseColor)
    matLib.updatePinMaterialEmissive(mapConfig.baseColor)
    matLib.updateBrushedMetalMaterialEmissive(mapConfig.baseColor)
    matLib.updateChromeMaterialEmissive(mapConfig.baseColor)
    matLib.updateLCDTableEmissive(mapConfig.baseColor)
    this.deps.display?.setTrackTheme(mapConfig.baseColor, mapConfig.accentColor)
    this.deps.effects?.setCabinetColor(mapConfig.baseColor)

    const primary = color(mapConfig.baseColor)
    const accent = color(mapConfig.accentColor)
    const blend = Color3.Lerp(primary, accent, 0.5)
    if (this.deps.cabinetNeonLights[0]) this.deps.cabinetNeonLights[0].diffuse = primary
    if (this.deps.cabinetNeonLights[1]) this.deps.cabinetNeonLights[1].diffuse = accent
    if (this.deps.cabinetNeonLights[2]) this.deps.cabinetNeonLights[2].diffuse = blend
    if (this.deps.cabinetNeonLights[3]) this.deps.cabinetNeonLights[3].diffuse = primary
  }

  private needsReapply(theme: TrackVisualTheme): boolean {
    const expected = PALETTE[theme.primary]
    const bumperVisual = this.deps.gameObjects?.getBumperVisuals()?.[0]
    if (bumperVisual?.color && bumperVisual.color !== expected) return true

    const spinnerVisual = this.deps.spinnerVisuals[0]
    if (spinnerVisual?.color && spinnerVisual.color !== expected) return true

    const gateState = this.deps.gateStates[0]
    if (gateState?.gateColor && gateState.gateColor !== expected) return true

    return false
  }
}

let trackThemingSystem: TrackThemingSystem | null = null

export function initializeTrackThemingSystem(deps: TrackThemingSystemDeps): TrackThemingSystem {
  trackThemingSystem = new TrackThemingSystem(deps)
  return trackThemingSystem
}

export function getTrackThemingSystem(): TrackThemingSystem | null {
  return trackThemingSystem
}

export function resetTrackThemingSystem(): void {
  trackThemingSystem = null
}
