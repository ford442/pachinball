import { MeshBuilder, Vector3, Scene, StandardMaterial, Color3, PointLight } from '@babylonjs/core'
import type { PBRMaterial } from '@babylonjs/core'
import type { CabinetLight } from '../game-elements/types'
import { PALETTE, INTENSITY, STATE_COLORS, color, emissive, pulse, lerpColor } from '../game-elements/visual-language'
import type { AccessibilityConfig } from '../game-elements/accessibility-config'

export type CabinetState = {
  cabinetLights: CabinetLight[]
  decorativeLights: (StandardMaterial | PBRMaterial)[]
  currentCabinetColor: string
  lightingMode: 'normal' | 'hit' | 'fever' | 'reach'
  lightingTimer: number
  hitFlashIntensity: number
  isJackpotActive: boolean
  jackpotPhase: number
  isSolidGoldPulseActive: boolean
  solidGoldPulseTimer: number
  slotLightMode: 'idle' | 'spin' | 'stop' | 'win' | 'jackpot'
  slotLightTimer: number
  accessibility: AccessibilityConfig
  scene: Scene
}

export function createCabinetLighting(scene: Scene, cabinetLights: CabinetLight[], currentCabinetColor: string): void {
  const baseColor = currentCabinetColor
  const accentColor = lerpColor(baseColor, PALETTE.WHITE, 0.3).toHexString()

  const stripConfigs = [
    {
      pos: new Vector3(-12.5, 1.5, 5),
      size: { width: 0.2, height: 2.5, depth: 32 },
      color: baseColor,
      intensity: INTENSITY.NORMAL,
    },
    {
      pos: new Vector3(13.5, 1.5, 5),
      size: { width: 0.2, height: 2.5, depth: 32 },
      color: baseColor,
      intensity: INTENSITY.NORMAL,
    },
    {
      pos: new Vector3(0.75, 5.5, 5),
      size: { width: 26, height: 0.2, depth: 32 },
      color: accentColor,
      intensity: INTENSITY.AMBIENT,
    },
    {
      pos: new Vector3(-12.5, -1, 5),
      size: { width: 0.3, height: 0.1, depth: 32 },
      color: accentColor,
      intensity: INTENSITY.AMBIENT,
    },
    {
      pos: new Vector3(13.5, -1, 5),
      size: { width: 0.3, height: 0.1, depth: 32 },
      color: accentColor,
      intensity: INTENSITY.AMBIENT,
    },
    {
      pos: new Vector3(0, 8, 28),
      size: { width: 28, height: 0.15, depth: 0.15 },
      color: baseColor,
      intensity: INTENSITY.NORMAL,
    },
    {
      pos: new Vector3(0, 8, 22),
      size: { width: 28, height: 0.15, depth: 0.15 },
      color: accentColor,
      intensity: INTENSITY.AMBIENT,
    },
  ]

  stripConfigs.forEach((config, idx) => {
    const strip = MeshBuilder.CreateBox(
      `ledStrip${idx}`,
      { width: config.size.width, height: config.size.height, depth: config.size.depth },
      scene
    )
    strip.position.copyFrom(config.pos)

    const mat = new StandardMaterial(`ledStripMat${idx}`, scene)
    mat.emissiveColor = emissive(config.color, config.intensity)
    mat.alpha = Math.min(0.8, config.intensity)
    strip.material = mat

    const lightPos = config.pos.clone()
    lightPos.x *= 0.8
    const light = new PointLight(`stripLight${idx}`, lightPos, scene)
    light.diffuse = color(config.color)
    light.intensity = config.intensity
    light.range = 20
    light.shadowEnabled = false

    cabinetLights.push({ mesh: strip, material: mat, pointLight: light })
  })
}

export function updateCabinetLighting(state: CabinetState): void {
  const { cabinetLights, decorativeLights, accessibility } = state
  const time = performance.now() * 0.001

  if (state.isJackpotActive) {
    // updateJackpotSequence is intentionally left to caller to manage timers and phases
  } else if (state.isSolidGoldPulseActive) {
    // handled elsewhere (bloom/time)
  } else if (state.lightingTimer > 0) {
    const dt = 0.016
    state.lightingTimer -= dt
    if (state.lightingTimer <= 0) {
      state.lightingMode = 'normal'
    }
  }

  cabinetLights.forEach((light, idx) => {
    let targetColor: Color3
    let intensity = INTENSITY.NORMAL

    if (state.isJackpotActive) {
      if (state.jackpotPhase === 1) {
        const p = pulse(time, 4, 0.2, 1.0)
        targetColor = emissive(STATE_COLORS.REACH, p * INTENSITY.FLASH)
        intensity = INTENSITY.FLASH
      } else if (state.jackpotPhase === 2) {
        const flashFreq = accessibility.flashFrequencyMax
        const strobe = (Math.sin(time * Math.PI * 2 * flashFreq) + 1) * 0.5
        targetColor = emissive(PALETTE.GOLD, strobe * INTENSITY.BURST)
        intensity = INTENSITY.BURST
      } else {
        const hue = (time * 0.5 + idx * 0.1) % 1
        targetColor = Color3.FromHSV(hue * 360, 1.0, 1.0).scale(INTENSITY.HIGH)
        intensity = INTENSITY.HIGH
      }
    } else if (state.isSolidGoldPulseActive) {
      const progress = state.solidGoldPulseTimer / 1.5
      const fade = 1 - progress
      const goldColor = emissive(PALETTE.GOLD, INTENSITY.HIGH * fade)
      const magentaColor = emissive(PALETTE.MAGENTA, INTENSITY.HIGH * fade * 0.6)
      targetColor = Color3.Lerp(goldColor, magentaColor, Math.sin(progress * Math.PI))
      intensity = INTENSITY.HIGH * fade
    } else {
      switch (state.lightingMode) {
        case 'hit': {
          const dt = 0.016
          state.hitFlashIntensity = Math.max(0, state.hitFlashIntensity - dt * 5)
          const flashBoost = 1 + state.hitFlashIntensity * 2
          const flashColor = lerpColor(state.currentCabinetColor, PALETTE.WHITE, 0.5).toHexString()
          targetColor = emissive(flashColor, INTENSITY.FLASH * flashBoost)
          intensity = INTENSITY.FLASH * flashBoost
          break
        }
        case 'reach':
          targetColor = emissive(STATE_COLORS.REACH, pulse(time, 2, 0.3, INTENSITY.HIGH))
          intensity = INTENSITY.HIGH
          break
        case 'fever': {
          const hue = (time * 2 + idx * 0.3) % 1
          targetColor = Color3.FromHSV(hue * 360, 0.8, 1.0)
          intensity = INTENSITY.HIGH + Math.sin(time * 10) * 0.5
          break
        }
        case 'normal':
        default: {
          const breath = pulse(time, 0.7, INTENSITY.AMBIENT, INTENSITY.NORMAL)
          targetColor = emissive(state.currentCabinetColor, breath)
          intensity = breath
          break
        }
      }
    }

    light.material.emissiveColor = Color3.Lerp(light.material.emissiveColor, targetColor, 0.016 * 10)
    light.pointLight.diffuse = light.material.emissiveColor
    light.pointLight.intensity = intensity
  })

  decorativeLights.forEach((mat) => {
    if (state.isJackpotActive) {
      if (state.jackpotPhase === 3) {
        const hue = (time * 2) % 1
        mat.emissiveColor = Color3.FromHSV(hue * 360, 1.0, INTENSITY.HIGH)
      } else {
        mat.emissiveColor = emissive(STATE_COLORS.REACH, INTENSITY.HIGH)
      }
    } else if (state.isSolidGoldPulseActive) {
      const progress = state.solidGoldPulseTimer / 1.5
      const fade = 1 - progress
      mat.emissiveColor = emissive(PALETTE.GOLD, INTENSITY.HIGH * fade)
    } else if (state.lightingMode === 'fever') {
      mat.emissiveColor = emissive(PALETTE.GOLD, pulse(time, 2, INTENSITY.NORMAL, INTENSITY.HIGH))
    } else if (state.lightingMode === 'reach') {
      mat.emissiveColor = emissive(STATE_COLORS.REACH, pulse(time, 5, 0.3, INTENSITY.HIGH))
    } else {
      mat.emissiveColor = emissive(PALETTE.MAGENTA, INTENSITY.AMBIENT)
    }
  })
}

export function updateSlotLighting(state: CabinetState): void {
  if (state.slotLightMode === 'idle') return

  const dt = 0.016
  state.slotLightTimer += dt
  const time = performance.now() * 0.001

  state.cabinetLights.forEach((light, idx) => {
    let targetColor: Color3
    let intensity = INTENSITY.NORMAL

    switch (state.slotLightMode) {
      case 'spin': {
        const hue = (time * 5 + idx * 0.3) % 1
        targetColor = Color3.FromHSV(hue * 360, 1.0, 1.0)
        intensity = INTENSITY.HIGH
        break
      }

      case 'stop': {
        const flashFreq = Math.min(5, state.accessibility.flashFrequencyMax * 2.5)
        const flash = Math.sin(time * Math.PI * 2 * flashFreq) > 0
        targetColor = flash ? Color3.White() : emissive(PALETTE.GOLD, INTENSITY.AMBIENT)
        intensity = flash ? INTENSITY.FLASH : INTENSITY.NORMAL
        break
      }

      case 'win':
        targetColor = emissive(PALETTE.GOLD, pulse(time, 3, INTENSITY.NORMAL, INTENSITY.HIGH))
        intensity = INTENSITY.HIGH
        break

      case 'jackpot': {
        const jackpotHue = (time * 10 + idx * 0.2) % 1
        targetColor = Color3.FromHSV(jackpotHue * 360, 1.0, 1.0)
        intensity = INTENSITY.BURST
        break
      }

      default:
        targetColor = emissive(PALETTE.CYAN, INTENSITY.NORMAL)
    }

    light.material.emissiveColor = Color3.Lerp(light.material.emissiveColor, targetColor, dt * 15)
    light.pointLight.diffuse = light.material.emissiveColor
    light.pointLight.intensity = intensity
  })
}

// Helper used by EffectsSystem to pick transition flash color
export function getTransitionColor(state: 'normal' | 'hit' | 'fever' | 'reach'): Color3 {
  switch (state) {
    case 'hit':
      return emissive(PALETTE.WHITE, INTENSITY.FLASH)
    case 'reach':
      return emissive(STATE_COLORS.REACH, INTENSITY.HIGH)
    case 'fever':
      return emissive(STATE_COLORS.FEVER, INTENSITY.HIGH)
    case 'normal':
    default:
      return emissive(PALETTE.CYAN, INTENSITY.NORMAL)
  }
}
