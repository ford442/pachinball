/**
 * planSceneGraph() decides which nodes the scene post-process Frame Graph has (#461 Slice B).
 * The tier from webgpu-post-process-profile.ts is the one input to "which nodes exist": the
 * image-processing node is left OUT on a strict adapter (not toggled off on a monolithic pipeline),
 * `?nopp=1` and tier `none` have no graph at all, and reduced motion drops sharpen and vignette.
 * Pure: no Babylon.
 */

import { describe, it, expect } from 'vitest'
import {
  BLOOM_QUALITY_PROFILE,
  SCENE_HEAVY_NODES,
  SCENE_NODE_ORDER,
  SCENE_MSAA_SAMPLES,
  SSAO_SAMPLES,
  planSceneGraph,
  sameSceneGraph,
  type SceneGraphFlags,
} from '../src/game/scene-graph-plan'
import { QualityTier } from '../src/game-elements/visual-language'
import {
  FULL_PIPELINE_UNIFORM_BUFFER_ESTIMATE,
  resolveWebGPUPostProcessProfile,
} from '../src/game/webgpu-post-process-profile'

const FLAGS: SceneGraphFlags = {
  tier: 'full',
  quality: QualityTier.MEDIUM,
  reducedMotion: false,
  effectIntensity: 1,
  noPostProcess: false,
  heavyAvailable: false,
  maxMsaaSamples: 1,
  mobile: false,
}

function webgpuEngine(maxUniformBuffersPerShaderStage: number) {
  return {
    getClassName: () => 'WebGPUEngine',
    currentLimits: { maxUniformBuffersPerShaderStage },
  } as never
}

describe('planSceneGraph', () => {
  it('full tier at MEDIUM: bloom, image processing, sharpen, FXAA, in that order', () => {
    const plan = planSceneGraph(FLAGS)
    expect(plan.nodes).toEqual(['bloom', 'imageProcessing', 'sharpen', 'fxaa'])
    expect(plan.vignette).toBe(true)
    expect(plan.omitted.map((o) => o.node)).toEqual(SCENE_HEAVY_NODES)
    expect(plan.omitted.every((o) => o.reason === 'quality-tier')).toBe(true)
  })

  it('bloom-only tier is bloom and nothing else: no image-processing, FXAA or sharpen node', () => {
    for (const tier of ['bloom-only', 'conservative'] as const) {
      const plan = planSceneGraph({ ...FLAGS, tier })
      expect(plan.nodes).toEqual(['bloom'])
      expect(plan.vignette).toBe(false)
      expect(plan.omitted).toContainEqual({ node: 'imageProcessing', reason: 'tier' })
      expect(plan.omitted).toContainEqual({ node: 'fxaa', reason: 'tier' })
      expect(plan.omitted).toContainEqual({ node: 'sharpen', reason: 'tier' })
    }
  })

  it('tier none has no node at all', () => {
    const plan = planSceneGraph({ ...FLAGS, tier: 'none' })
    expect(plan.nodes).toEqual([])
    expect(plan.omitted).toHaveLength(SCENE_NODE_ORDER.length)
    expect(plan.omitted.every((o) => o.reason === 'tier')).toBe(true)
  })

  it('?nopp=1 has no node at all, whatever the tier', () => {
    for (const tier of ['full', 'bloom-only', 'none'] as const) {
      const plan = planSceneGraph({ ...FLAGS, tier, noPostProcess: true })
      expect(plan.nodes).toEqual([])
      expect(plan.omitted.every((o) => o.reason === 'nopp')).toBe(true)
    }
  })

  it('reduced motion drops bloom, sharpen and the vignette; the grade and FXAA stay', () => {
    const plan = planSceneGraph({ ...FLAGS, reducedMotion: true })
    expect(plan.nodes).toEqual(['imageProcessing', 'fxaa'])
    expect(plan.vignette).toBe(false)
    expect(plan.omitted).toContainEqual({ node: 'sharpen', reason: 'reduced-motion' })
    expect(plan.omitted).toContainEqual({ node: 'bloom', reason: 'reduced-motion' })
  })

  it('effect intensity 0 leaves bloom out and nothing else', () => {
    const plan = planSceneGraph({ ...FLAGS, effectIntensity: 0 })
    expect(plan.nodes).toEqual(['imageProcessing', 'sharpen', 'fxaa'])
    expect(plan.omitted).toContainEqual({ node: 'bloom', reason: 'effect-intensity' })
  })

  it('sharpen is dropped at LOW quality, kept at MEDIUM and HIGH', () => {
    expect(planSceneGraph({ ...FLAGS, quality: QualityTier.LOW }).nodes).toEqual(['bloom', 'imageProcessing', 'fxaa'])
    expect(planSceneGraph({ ...FLAGS, quality: QualityTier.MEDIUM }).nodes).toContain('sharpen')
    expect(planSceneGraph({ ...FLAGS, quality: QualityTier.HIGH }).nodes).toContain('sharpen')
  })

  describe('HIGH-only nodes', () => {
    const high: SceneGraphFlags = { ...FLAGS, quality: QualityTier.HIGH, heavyAvailable: true }

    it('exist only on the full tier at HIGH, with motion allowed and a context that can afford them', () => {
      expect(planSceneGraph(high).nodes).toEqual([
        'ssao', 'ssr', 'motionBlur', 'bloom', 'imageProcessing', 'sharpen', 'fxaa',
      ])
      expect(planSceneGraph({ ...high, quality: QualityTier.MEDIUM }).nodes).toEqual(['bloom', 'imageProcessing', 'sharpen', 'fxaa'])
      expect(planSceneGraph({ ...high, reducedMotion: true }).nodes).toEqual(['imageProcessing', 'fxaa'])
      expect(planSceneGraph({ ...high, tier: 'bloom-only' }).nodes).toEqual(['bloom'])
    })

    it('are left out, with the reason, when the context cannot afford them', () => {
      const plan = planSceneGraph({ ...high, heavyAvailable: false })
      expect(plan.nodes).toEqual(['bloom', 'imageProcessing', 'sharpen', 'fxaa'])
      expect(plan.omitted).toEqual(SCENE_HEAVY_NODES.map((node) => ({ node, reason: 'heavy-unavailable' })))
    })
  })

  it('every plan lists each node exactly once, in nodes or in omitted', () => {
    for (const tier of ['full', 'conservative', 'bloom-only', 'none'] as const) {
      for (const quality of Object.values(QualityTier)) {
        for (const reducedMotion of [false, true]) {
          for (const noPostProcess of [false, true]) {
            const plan = planSceneGraph({ ...FLAGS, tier, quality, reducedMotion, noPostProcess, heavyAvailable: true })
            const all = [...plan.nodes, ...plan.omitted.map((o) => o.node)].sort()
            expect(all).toEqual([...SCENE_NODE_ORDER].sort())
            // execution order is the contract
            expect(plan.nodes).toEqual(SCENE_NODE_ORDER.filter((n) => plan.nodes.includes(n)))
          }
        }
      }
    }
  })

  it('takes its tier from resolveWebGPUPostProcessProfile, so the same adapters get the same nodes', () => {
    const nodesAt = (cap: number) =>
      planSceneGraph({ ...FLAGS, tier: resolveWebGPUPostProcessProfile(webgpuEngine(cap)).tier }).nodes
    // The spec minimum (12) is below the estimate: no image-processing node.
    expect(nodesAt(12)).toEqual(['bloom'])
    expect(nodesAt(FULL_PIPELINE_UNIFORM_BUFFER_ESTIMATE - 1)).toEqual(['bloom'])
    expect(nodesAt(FULL_PIPELINE_UNIFORM_BUFFER_ESTIMATE)).toContain('imageProcessing')
    expect(nodesAt(24)).toContain('imageProcessing')
  })

  it('WebGL2 resolves to the full tier, so it gets the full node set', () => {
    const profile = resolveWebGPUPostProcessProfile({ getClassName: () => 'Engine' } as never)
    expect(planSceneGraph({ ...FLAGS, tier: profile.tier }).nodes).toContain('imageProcessing')
  })
})

describe('sameSceneGraph', () => {
  it('compares nodes only: the vignette is a setting of an existing node', () => {
    const a = planSceneGraph(FLAGS)
    expect(sameSceneGraph(a, planSceneGraph(FLAGS))).toBe(true)
    expect(sameSceneGraph(a, planSceneGraph({ ...FLAGS, quality: QualityTier.LOW }))).toBe(false)
    expect(sameSceneGraph(a, planSceneGraph({ ...FLAGS, tier: 'bloom-only' }))).toBe(false)
  })
})

describe('BLOOM_QUALITY_PROFILE', () => {
  it('shrinks kernel, scale and weight cap with the quality tier', () => {
    const { HIGH, MEDIUM, LOW } = QualityTier
    expect(BLOOM_QUALITY_PROFILE[HIGH]).toMatchObject({ kernel: 64, scale: 0.5 })
    expect(BLOOM_QUALITY_PROFILE[MEDIUM]).toMatchObject({ kernel: 32, scale: 0.35, maxWeight: 0.25 })
    expect(BLOOM_QUALITY_PROFILE[LOW]).toMatchObject({ kernel: 16, scale: 0.2, maxWeight: 0.12 })
  })

  describe('anti-aliasing (#488 §3)', () => {
    const msaa: SceneGraphFlags = { ...FLAGS, maxMsaaSamples: 4 }

    it('MEDIUM and HIGH multisample the scene target and drop FXAA', () => {
      for (const quality of [QualityTier.MEDIUM, QualityTier.HIGH]) {
        const plan = planSceneGraph({ ...msaa, quality })
        expect(plan.msaaSamples).toBe(SCENE_MSAA_SAMPLES)
        expect(plan.nodes).not.toContain('fxaa')
        expect(plan.omitted).toContainEqual({ node: 'fxaa', reason: 'msaa' })
      }
    })

    it('LOW keeps FXAA and no MSAA', () => {
      const plan = planSceneGraph({ ...msaa, quality: QualityTier.LOW })
      expect(plan.msaaSamples).toBe(1)
      expect(plan.nodes.at(-1)).toBe('fxaa')
    })

    it('a context without MSAA keeps FXAA on every tier', () => {
      for (const quality of Object.values(QualityTier)) {
        const plan = planSceneGraph({ ...FLAGS, quality })
        expect(plan.msaaSamples).toBe(1)
        expect(plan.nodes).toContain('fxaa')
      }
    })

    it('no graph, no MSAA: the camera renders straight to the canvas', () => {
      expect(planSceneGraph({ ...msaa, noPostProcess: true }).msaaSamples).toBe(1)
      expect(planSceneGraph({ ...msaa, tier: 'none' }).msaaSamples).toBe(1)
    })

    it('bloom-only still multisamples (the target is not a node)', () => {
      const plan = planSceneGraph({ ...msaa, tier: 'bloom-only' })
      expect(plan.nodes).toEqual(['bloom'])
      expect(plan.msaaSamples).toBe(SCENE_MSAA_SAMPLES)
    })

    it('a tier change across LOW rebuilds (the sample count differs)', () => {
      const medium = planSceneGraph({ ...msaa, quality: QualityTier.MEDIUM })
      const low = planSceneGraph({ ...msaa, quality: QualityTier.LOW })
      expect(sameSceneGraph(medium, low)).toBe(false)
    })
  })

  describe('SSAO cost', () => {
    const high: SceneGraphFlags = { ...FLAGS, quality: QualityTier.HIGH, heavyAvailable: true }

    it('16 samples on desktop, 8 on mobile, none without the node', () => {
      expect(planSceneGraph(high).ssaoSamples).toBe(SSAO_SAMPLES.desktop)
      expect(planSceneGraph({ ...high, mobile: true }).ssaoSamples).toBe(SSAO_SAMPLES.mobile)
      expect(planSceneGraph(FLAGS).ssaoSamples).toBe(0)
      expect(SSAO_SAMPLES.desktop).toBeLessThan(32)
    })
  })
})
