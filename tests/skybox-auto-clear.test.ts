import { describe, expect, it } from 'vitest'
import {
  SkyboxAutoClear,
  isCameraInsideSkybox,
  shouldSkipColorClear,
  type AutoClearCamera,
  type AutoClearScene,
  type SkyboxLike,
} from '../src/game/skybox-auto-clear'

const SIZE = 200
const inputs = { skyboxEnabled: true, skyboxVisible: true, cameraInsideSkybox: true, mobile: false }

describe('shouldSkipColorClear', () => {
  it('skips only when every condition holds', () => {
    expect(shouldSkipColorClear(inputs)).toBe(true)
    expect(shouldSkipColorClear({ ...inputs, skyboxEnabled: false })).toBe(false)
    expect(shouldSkipColorClear({ ...inputs, skyboxVisible: false })).toBe(false)
    expect(shouldSkipColorClear({ ...inputs, cameraInsideSkybox: false })).toBe(false)
    expect(shouldSkipColorClear({ ...inputs, mobile: true })).toBe(false)
  })
})

describe('isCameraInsideSkybox', () => {
  const skybox: SkyboxLike = { isVisible: true, isEnabled: () => true, position: { x: 0, y: 0, z: 0 } }
  const camera = (x: number, y: number, z: number, maxZ = 10_000): AutoClearCamera => ({ globalPosition: { x, y, z }, maxZ })

  it('accepts the cabinet camera', () => {
    expect(isCameraInsideSkybox(camera(0, 16, -21), skybox, SIZE)).toBe(true)
  })

  it('rejects a camera outside, or within the margin of a face', () => {
    expect(isCameraInsideSkybox(camera(0, 16, -150), skybox, SIZE)).toBe(false)
    expect(isCameraInsideSkybox(camera(95, 0, 0), skybox, SIZE)).toBe(false) // 90% margin = 90
    expect(isCameraInsideSkybox(camera(85, 0, 0), skybox, SIZE)).toBe(true)
  })

  it('rejects a camera whose far plane cannot reach the farthest corner', () => {
    expect(isCameraInsideSkybox(camera(0, 0, 0, 100), skybox, SIZE)).toBe(false)
    expect(isCameraInsideSkybox(camera(0, 0, 0, 200), skybox, SIZE)).toBe(true)
  })

  it('measures from the skybox centre, not the origin', () => {
    const moved: SkyboxLike = { ...skybox, position: { x: 500, y: 0, z: 0 } }
    expect(isCameraInsideSkybox(camera(0, 0, 0), moved, SIZE)).toBe(false)
    expect(isCameraInsideSkybox(camera(500, 0, 0), moved, SIZE)).toBe(true)
  })
})

describe('SkyboxAutoClear', () => {
  function rig(mobile = false) {
    const observers: Array<() => void> = []
    const scene: AutoClearScene = {
      autoClear: true,
      activeCamera: { globalPosition: { x: 0, y: 16, z: -21 }, maxZ: 10_000 },
      onBeforeRenderObservable: {
        add: (cb) => { observers.push(cb); return cb },
        remove: (o) => { observers.splice(observers.indexOf(o as () => void), 1) },
      },
    }
    const skybox = { isVisible: true, enabled: true, position: { x: 0, y: 0, z: 0 }, isEnabled() { return this.enabled } }
    const auto = new SkyboxAutoClear(scene, skybox, SIZE, mobile)
    return { scene, skybox, auto, frame: () => observers.forEach((cb) => cb()), observers }
  }

  it('turns the clear off while the skybox covers the frame, and back on when it stops', () => {
    const { scene, skybox, frame } = rig()
    frame()
    expect(scene.autoClear).toBe(false)

    skybox.enabled = false
    frame()
    expect(scene.autoClear).toBe(true)

    skybox.enabled = true
    skybox.isVisible = false
    frame()
    expect(scene.autoClear).toBe(true)

    skybox.isVisible = true
    scene.activeCamera = { globalPosition: { x: 300, y: 0, z: 0 }, maxZ: 10_000 } // a follow cam left the box
    frame()
    expect(scene.autoClear).toBe(true)

    scene.activeCamera = null
    frame()
    expect(scene.autoClear).toBe(true)
  })

  it('never turns the clear off on a mobile device', () => {
    const { scene, frame } = rig(true)
    frame()
    expect(scene.autoClear).toBe(true)
  })

  it('dispose restores the clear and stops observing', () => {
    const { scene, auto, frame, observers } = rig()
    frame()
    expect(scene.autoClear).toBe(false)
    auto.dispose()
    expect(scene.autoClear).toBe(true)
    expect(observers).toHaveLength(0)
    frame()
    expect(scene.autoClear).toBe(true)
  })
})
