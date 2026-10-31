/**
 * ScenePostController is the post-process surface EffectsSystem and the quality tiers write to
 * (BloomPipelineController). It is plain retained state: it exists before the Frame Graph chunk has
 * loaded, the graph reads it every frame, and the one knob that is part of a built node (the bloom
 * scale) asks the graph for a rebuild.
 */

import { describe, it, expect, vi } from 'vitest'
import { ScenePostController, type ScenePostOwner } from '../src/game/scene-post-controller'

function owner(): ScenePostOwner & { requestRebuild: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> } {
  return { requestRebuild: vi.fn(), dispose: vi.fn() }
}

describe('ScenePostController', () => {
  it('retains knobs written before any graph is attached', () => {
    const c = new ScenePostController()
    c.bloomWeight = 0.12
    c.bloomKernel = 16
    c.bloomThreshold = 0.5
    c.sharpenEnabled = false
    expect(c).toMatchObject({ bloomWeight: 0.12, bloomKernel: 16, bloomThreshold: 0.5, sharpenEnabled: false })
  })

  it('asks the graph for a rebuild when the bloom scale really changes, and only then', () => {
    const c = new ScenePostController()
    const graph = owner()
    c.bloomScale = 0.35
    expect(graph.requestRebuild).not.toHaveBeenCalled() // nothing attached yet
    c.attach(graph)
    c.bloomScale = 0.35
    expect(graph.requestRebuild).not.toHaveBeenCalled() // same value
    c.bloomScale = 0.2
    expect(graph.requestRebuild).toHaveBeenCalledTimes(1)
    c.bloomWeight = 0.9 // a per-frame knob never rebuilds
    expect(graph.requestRebuild).toHaveBeenCalledTimes(1)
  })

  it('has no image-processing surface until the plan has the node', () => {
    const c = new ScenePostController()
    expect(c.imageProcessing).toBeNull()
    c.setImageProcessingPresent(true, true)
    expect(c.imageProcessing).toBe(c.imageProcessingState)
    c.setImageProcessingPresent(false, false)
    expect(c.imageProcessing).toBeNull()
  })

  it('bumps the image-processing version only when a value changes', () => {
    const ip = new ScenePostController().imageProcessingState
    const v0 = ip.version
    const { vignetteWeight, exposure } = ip
    ip.vignetteWeight = vignetteWeight // the value it already has
    ip.exposure = exposure
    expect(ip.version).toBe(v0)
    ip.exposure = 1.5
    expect(ip.version).toBe(v0 + 1)
    ip.vignetteWeight = 1.2
    expect(ip.version).toBe(v0 + 2)
  })

  it('keeps the vignette off, flashes included, when the plan does not allow it', () => {
    const c = new ScenePostController()
    c.setImageProcessingPresent(true, false) // reduced motion
    const ip = c.imageProcessingState
    ip.vignetteEnabled = true // what a screen flash does
    expect(ip.vignetteEnabled).toBe(false)
    c.setImageProcessingPresent(true, true)
    expect(ip.vignetteEnabled).toBe(true)
  })

  it('defaults to the look the game ships: no tone mapping, contrast and exposure 1', () => {
    const ip = new ScenePostController().imageProcessingState
    expect(ip).toMatchObject({
      toneMappingEnabled: false,
      contrast: 1,
      exposure: 1,
      vignetteEnabled: false,
      vignetteWeight: 1.5,
      colorCurvesEnabled: false,
    })
  })

  it('dispose() disposes the attached graph once and detaches it', () => {
    const c = new ScenePostController()
    const graph = owner()
    c.attach(graph)
    c.dispose()
    c.dispose()
    expect(graph.dispose).toHaveBeenCalledTimes(1)
    c.bloomScale = 0.1
    expect(graph.requestRebuild).not.toHaveBeenCalled()
  })
})
