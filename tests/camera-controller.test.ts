import { describe, expect, it } from 'vitest'
import { Vector3 } from '@babylonjs/core'

import { CameraController, CameraMode, QualityTier, type CameraRuntimePolicy } from '../src/game-elements'

function createPolicy(overrides: Partial<CameraRuntimePolicy> = {}): CameraRuntimePolicy {
  return {
    reducedMotion: false,
    photosensitiveMode: false,
    qualityTier: QualityTier.MEDIUM,
    ...overrides,
  }
}

function createCameraStub() {
  return {
    target: new Vector3(0, 0, 2),
    fov: 0.9,
  } as unknown as import('@babylonjs/core').TargetCamera
}

describe('CameraController', () => {
  it('widens FOV under sustained high speed and stays bounded', () => {
    const tableCam = createCameraStub()
    const controller = new CameraController(tableCam)
    const ballPos = new Vector3(0, 0, 0)
    const lowVelocity = new Vector3(0, 0, 1)
    const highVelocity = new Vector3(0, 0, 30)

    for (let i = 0; i < 20; i += 1) {
      controller.update(1 / 60, ballPos, lowVelocity, CameraMode.IDLE, createPolicy())
    }
    const baselineFov = tableCam.fov

    for (let i = 0; i < 45; i += 1) {
      controller.update(1 / 60, ballPos, highVelocity, CameraMode.IDLE, createPolicy())
    }

    expect(tableCam.fov).toBeGreaterThan(baselineFov)
    expect(tableCam.fov).toBeLessThanOrEqual(1.05)
  })

  it('resets dynamic camera response immediately in reduced motion mode', () => {
    const tableCam = createCameraStub()
    const controller = new CameraController(tableCam)
    const ballPos = new Vector3(2, 0, -4)
    const highVelocity = new Vector3(0, 0, 30)

    for (let i = 0; i < 30; i += 1) {
      controller.update(1 / 60, ballPos, highVelocity, CameraMode.IDLE, createPolicy())
    }
    expect(tableCam.fov).toBeGreaterThan(0.9)

    controller.notifyImpact(new Vector3(4, 0, -8), 1)
    controller.update(1 / 60, ballPos, highVelocity, CameraMode.IDLE, createPolicy({ reducedMotion: true }))

    expect(tableCam.fov).toBeCloseTo(0.9, 5)
  })

  it('keeps legacy behavior on low quality tier', () => {
    const tableCam = createCameraStub()
    const controller = new CameraController(tableCam)
    const ballPos = new Vector3(0, 0, -6)
    const highVelocity = new Vector3(0, 0, 35)

    for (let i = 0; i < 50; i += 1) {
      controller.update(1 / 60, ballPos, highVelocity, CameraMode.IDLE, createPolicy({ qualityTier: QualityTier.LOW }))
    }

    expect(tableCam.fov).toBeCloseTo(0.9, 5)
  })
})
