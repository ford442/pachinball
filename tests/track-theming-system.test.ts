import { describe, it, expect, vi, beforeEach } from 'vitest'

import { TrackThemingSystem, applyThemeEmissiveColor } from '../src/game-elements/track-theming-system'
import { PALETTE, INTENSITY, color, emissive, QualityTier } from '../src/game-elements/visual-language'

const materialLibraryMock = {
  updateFlipperMaterialEmissive: vi.fn(),
  updatePinMaterialEmissive: vi.fn(),
  updateBrushedMetalMaterialEmissive: vi.fn(),
  updateChromeMaterialEmissive: vi.fn(),
  updateLCDTableEmissive: vi.fn(),
  updatePlayfieldTheme: vi.fn(),
}

vi.mock('../src/materials', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/materials')>()
  return {
    ...actual,
    getMaterialLibrary: () => materialLibraryMock,
  }
})

describe('TrackThemingSystem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('applies expected emissive color to bumper materials', () => {
    const bumperMaterial = { emissiveColor: color(PALETTE.CYAN) }
    const gameObjects = {
      getBumperVisuals: () => [
        {
          mesh: { material: bumperMaterial },
          wireframeRing: { material: { emissiveColor: color(PALETTE.CYAN) } },
          color: PALETTE.CYAN,
          targetEmissive: color(PALETTE.CYAN),
          currentEmissive: color(PALETTE.CYAN),
          flashTimer: 0,
        },
      ],
      updateBumperColors: vi.fn(),
    }

    const system = new TrackThemingSystem({
      gameObjects: gameObjects as never,
      ballManager: { updateBallMaterialColor: vi.fn() } as never,
      spinnerVisuals: [],
      gateStates: [],
      cabinetNeonLights: [],
      display: { setTrackTheme: vi.fn() } as never,
      effects: { setCabinetColor: vi.fn() } as never,
      mapManager: null,
      qualityTier: QualityTier.MEDIUM,
      scene: {} as never,
    })

    system.applyTheme('CYBER_CORE')
    expect(bumperMaterial.emissiveColor).toEqual(emissive(PALETTE.MAGENTA, INTENSITY.ACTIVE))
  })

  it('prefers TrackInfo visualTheme and falls back to override map', () => {
    const system = new TrackThemingSystem({
      gameObjects: null,
      ballManager: null,
      spinnerVisuals: [],
      gateStates: [],
      cabinetNeonLights: [],
      display: null,
      effects: null,
      mapManager: null,
      qualityTier: QualityTier.LOW,
      scene: {} as never,
    })

    expect(system.resolveTheme('NEON_HELIX').primary).toBe('CYAN')
    expect(system.resolveTheme('TESLA_TOWER').primary).toBe('WHITE')
  })
})

describe('applyThemeEmissiveColor', () => {
  it('writes emissive using visual-language helpers', () => {
    const material = { emissiveColor: color(PALETTE.CYAN) }
    applyThemeEmissiveColor(material, 'GOLD')
    expect(material.emissiveColor).toEqual(emissive(PALETTE.GOLD, INTENSITY.ACTIVE))
  })
})
