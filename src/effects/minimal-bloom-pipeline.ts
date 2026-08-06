/**
 * Bloom-only post-process for WebGPU adapters that cannot run DefaultRenderingPipeline.
 * Uses the same BloomEffect stack DRP uses internally, without image-processing / FXAA layout.
 */

import { BloomEffect } from '@babylonjs/core/PostProcesses/bloomEffect'
import { PostProcessRenderPipeline } from '@babylonjs/core/PostProcesses/RenderPipeline/postProcessRenderPipeline'
import type { Camera } from '@babylonjs/core/Cameras/camera'
import type { Scene } from '@babylonjs/core/scene'
import type { BloomImageProcessingSurface, BloomPipelineController } from './bloom-pipeline-types'

const PIPELINE_NAME = 'pachinbloom-minimal'

export class MinimalBloomPipeline
  extends PostProcessRenderPipeline
  implements BloomPipelineController
{
  private readonly scene: Scene
  private readonly camerasToAttach: Camera[]
  private bloomEffect: BloomEffect
  private bloomEnabledFlag = true
  private bloomWeightValue = 0.25
  private bloomScaleValue = 0.5
  private bloomKernelValue = 64
  private bloomThresholdValue = 0.75
  private hardwareScaleLevel = 1
  private readonly textureType: number
  public sharpenEnabled = false
  public depthOfFieldEnabled = false
  public readonly imageProcessing: BloomImageProcessingSurface | null = null

  constructor(scene: Scene, cameras: Camera[]) {
    const engine = scene.getEngine()
    super(engine, PIPELINE_NAME)
    this.scene = scene
    this.camerasToAttach = cameras.slice()
    this.textureType = resolvePipelineTextureType(scene)
    this.hardwareScaleLevel = engine.getHardwareScalingLevel()

    scene.postProcessRenderPipelineManager.addPipeline(this)

    this.bloomEffect = this.createBloomEffect()
    this.buildPipeline()

    engine.onResizeObservable.add(() => {
      this.hardwareScaleLevel = engine.getHardwareScalingLevel()
      this.bloomKernel = this.bloomKernelValue
    })
  }

  get bloomWeight(): number {
    return this.bloomWeightValue
  }

  set bloomWeight(value: number) {
    this.bloomWeightValue = value
    this.bloomEffect.weight = value
  }

  get bloomScale(): number {
    return this.bloomScaleValue
  }

  set bloomScale(value: number) {
    if (this.bloomScaleValue === value) return
    this.bloomScaleValue = value
    this.rebuildBloom()
    this.buildPipeline()
  }

  get bloomKernel(): number {
    return this.bloomKernelValue
  }

  set bloomKernel(value: number) {
    this.bloomKernelValue = value
    this.bloomEffect.kernel = value / this.hardwareScaleLevel
  }

  get bloomEnabled(): boolean {
    return this.bloomEnabledFlag
  }

  set bloomEnabled(enabled: boolean) {
    if (this.bloomEnabledFlag === enabled) return
    this.bloomEnabledFlag = enabled
    this.buildPipeline()
  }

  get bloomThreshold(): number {
    return this.bloomThresholdValue
  }

  set bloomThreshold(value: number) {
    this.bloomThresholdValue = value
    this.bloomEffect.threshold = value
  }

  prepare(): void {
    if (!this.bloomEffect._isReady()) {
      this.bloomEffect._updateEffects()
    }
    this.buildPipeline()
  }

  dispose(): void {
    this.scene.postProcessRenderPipelineManager.detachCamerasFromRenderPipeline(
      PIPELINE_NAME,
      this.camerasToAttach,
    )
    this.scene.postProcessRenderPipelineManager.removePipeline(PIPELINE_NAME)
    for (const camera of this.camerasToAttach) {
      this.bloomEffect.disposeEffects(camera)
    }
  }

  private createBloomEffect(): BloomEffect {
    return new BloomEffect(
      this.scene,
      this.bloomScaleValue,
      this.bloomWeightValue,
      this.bloomKernelValue / this.hardwareScaleLevel,
      this.textureType,
      false,
    )
  }

  private rebuildBloom(): void {
    const oldBloom = this.bloomEffect
    this.bloomEffect = this.createBloomEffect()
    this.bloomEffect.threshold = this.bloomThresholdValue
    for (const camera of this.camerasToAttach) {
      oldBloom.disposeEffects(camera)
    }
  }

  private buildPipeline(): void {
    this.scene.postProcessRenderPipelineManager.detachCamerasFromRenderPipeline(
      PIPELINE_NAME,
      this.camerasToAttach,
    )
    this._reset()

    if (this.bloomEnabledFlag) {
      if (!this.bloomEffect._isReady()) {
        this.bloomEffect._updateEffects()
      }
      this.addEffect(this.bloomEffect)
    }

    this.scene.postProcessRenderPipelineManager.attachCamerasToRenderPipeline(
      PIPELINE_NAME,
      this.camerasToAttach,
    )
  }
}

function resolvePipelineTextureType(scene: Scene): number {
  const caps = scene.getEngine().getCaps()
  if (caps.textureHalfFloatRender) return 2
  if (caps.textureFloatRender) return 1
  return 0
}
