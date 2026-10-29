/**
 * The HIGH-only nodes of the scene Frame Graph (#461 Slice B): SSAO, SSR and motion blur, plus the
 * one geometry pass they share. Split from `scene-frame-graph.ts` only to keep each
 * file readable; both are in the same lazily loaded chunk.
 *
 *   clear depth ─▶ geometry (view depth, view normal, reflectivity, velocity) ─┐
 *   scene:render ─▶ ssao ─▶ ssr ─▶ motionBlur ──────────────────────────────────┴▶ bloom ─▶ …
 *
 * They replace `SSAO2RenderingPipeline`, `SSRRenderingPipeline` and `MotionBlurPostProcess`, which
 * shared the engine's prepass renderer.
 * A graph needs no prepass: the geometry pass writes four colour attachments (WebGL2 guarantees 4),
 * where the prepass needed seven because it carried the PBR sub-surface buffers too. They run on the
 * linear HDR scene colour, before bloom and image processing, so SSR reads and writes linear light.
 *
 * Tuning is what the pipelines were set to. One difference: SSR's automatic thickness needs a second
 * geometry pass with reversed culling, so SSR uses its fixed `thickness` instead.
 *
 * There is no depth-of-field node, on purpose. `DefaultRenderingPipeline` was built once at boot with
 * automatic rebuilds off, so the `depthOfFieldEnabled = true` that `applyQualityTier(HIGH)` set later
 * never added the effect: depth of field has never rendered. Adding it now would be a new look (and
 * at its `focusDistance` of 2500 on a camera ~30 units from the table, a blur over the whole
 * playfield), not a port. `FrameGraphDepthOfFieldTask` is the node to add once someone tunes it.
 */

import { Constants } from '@babylonjs/core/Engines/constants'
import type { Camera } from '@babylonjs/core/Cameras/camera'
import type { FrameGraph } from '@babylonjs/core/FrameGraph/frameGraph'
import type { FrameGraphTask } from '@babylonjs/core/FrameGraph/frameGraphTask'
import type { FrameGraphTextureHandle } from '@babylonjs/core/FrameGraph/frameGraphTypes'
import { FrameGraphMotionBlurTask } from '@babylonjs/core/FrameGraph/Tasks/PostProcesses/motionBlurTask'
import { FrameGraphSSAO2RenderingPipelineTask } from '@babylonjs/core/FrameGraph/Tasks/PostProcesses/ssao2RenderingPipelineTask'
import { FrameGraphSSRRenderingPipelineTask } from '@babylonjs/core/FrameGraph/Tasks/PostProcesses/ssrRenderingPipelineTask'
import { FrameGraphGeometryRendererTask } from '@babylonjs/core/FrameGraph/Tasks/Rendering/geometryRendererTask'
import { FrameGraphClearTextureTask } from '@babylonjs/core/FrameGraph/Tasks/Texture/clearTextureTask'
import { ThinMotionBlurPostProcess } from '@babylonjs/core/PostProcesses/thinMotionBlurPostProcess'
import type { Scene } from '@babylonjs/core/scene'
import type { SceneGraphNodeId } from './scene-graph-plan'

/** The geometry pass and the handles of what it wrote. */
export interface GeometryPass {
  tasks: FrameGraphTask[]
  viewDepth: FrameGraphTextureHandle
  viewNormal: FrameGraphTextureHandle
  reflectivity: FrameGraphTextureHandle
  velocity: FrameGraphTextureHandle
}

export type HeavyTask =
  | FrameGraphSSAO2RenderingPipelineTask
  | FrameGraphSSRRenderingPipelineTask
  | FrameGraphMotionBlurTask

/** Which geometry buffers the planned heavy nodes read. */
function neededBuffers(nodes: readonly SceneGraphNodeId[]) {
  return {
    viewNormal: nodes.includes('ssao') || nodes.includes('ssr'),
    reflectivity: nodes.includes('ssr'),
    velocity: nodes.includes('motionBlur'),
  }
}

/**
 * Add the depth clear and the geometry pass for the planned heavy nodes. Depth is cleared by its
 * own task because the geometry renderer clears only its colour attachments.
 */
export function addGeometryPass(
  graph: FrameGraph,
  scene: Scene,
  camera: Camera,
  nodes: readonly SceneGraphNodeId[],
  size: { width: number; height: number },
): GeometryPass {
  const tm = graph.textureManager
  const need = neededBuffers(nodes)

  const depth = tm.createRenderTargetTexture('scene:geometryDepth', {
    size,
    sizeIsPercentage: false,
    options: {
      createMipMaps: false,
      samples: 1,
      types: [Constants.TEXTURETYPE_UNSIGNED_INT],
      formats: [Constants.TEXTUREFORMAT_DEPTH24_STENCIL8],
      useSRGBBuffers: [false],
    },
  })
  const clear = new FrameGraphClearTextureTask('scene:geometryClear', graph)
  clear.clearColor = false
  clear.clearDepth = true
  clear.depthTexture = depth
  graph.addTask(clear)

  const geometry = new FrameGraphGeometryRendererTask('scene:geometry', graph, scene)
  geometry.camera = camera
  // null lists: everything the camera's layer mask shows, which leaves out the backbox layer meshes.
  geometry.objectList = { meshes: null, particleSystems: null }
  geometry.size = size
  geometry.sizeIsPercentage = false
  geometry.samples = 1
  geometry.depthTexture = clear.outputDepthTexture
  geometry.depthTest = true
  geometry.depthWrite = true
  geometry.disableShadows = true
  geometry.textureDescriptions = [
    { type: Constants.PREPASS_DEPTH_TEXTURE_TYPE, textureType: Constants.TEXTURETYPE_FLOAT, textureFormat: Constants.TEXTUREFORMAT_RED },
    ...(need.viewNormal
      ? [{ type: Constants.PREPASS_NORMAL_TEXTURE_TYPE, textureType: Constants.TEXTURETYPE_HALF_FLOAT, textureFormat: Constants.TEXTUREFORMAT_RGBA }]
      : []),
    ...(need.reflectivity
      ? [{ type: Constants.PREPASS_REFLECTIVITY_TEXTURE_TYPE, textureType: Constants.TEXTURETYPE_UNSIGNED_BYTE, textureFormat: Constants.TEXTUREFORMAT_RGBA }]
      : []),
    ...(need.velocity
      ? [{ type: Constants.PREPASS_VELOCITY_TEXTURE_TYPE, textureType: Constants.TEXTURETYPE_UNSIGNED_BYTE, textureFormat: Constants.TEXTUREFORMAT_RGBA }]
      : []),
  ]
  graph.addTask(geometry)

  return {
    tasks: [clear, geometry],
    viewDepth: geometry.geometryViewDepthTexture,
    viewNormal: geometry.geometryViewNormalTexture,
    reflectivity: geometry.geometryReflectivityTexture,
    velocity: geometry.geometryVelocityTexture,
  }
}

/**
 * Build one heavy node, wired to the geometry pass and tuned as its pipeline was.
 * `textureType` is the scene colour's, so the nodes' own targets keep HDR range.
 */
export function createHeavyTask(
  node: Extract<SceneGraphNodeId, 'ssao' | 'ssr' | 'motionBlur'>,
  graph: FrameGraph,
  scene: Scene,
  camera: Camera,
  geometry: GeometryPass,
  textureType: number,
): HeavyTask {
  switch (node) {
    case 'ssao': {
      const task = new FrameGraphSSAO2RenderingPipelineTask('scene:ssao', graph, 1.0, 1.0, textureType)
      task.camera = camera
      task.depthTexture = geometry.viewDepth
      task.normalTexture = geometry.viewNormal
      task.ssao.radius = 1.5
      task.ssao.totalStrength = 0.6
      task.ssao.base = 0.5
      task.ssao.samples = 32
      task.ssao.maxZ = 50
      task.ssao.minZAspect = 0.5
      return task
    }
    case 'ssr': {
      const task = new FrameGraphSSRRenderingPipelineTask('scene:ssr', graph, textureType)
      task.camera = camera
      task.depthTexture = geometry.viewDepth
      task.normalTexture = geometry.viewNormal
      task.reflectivityTexture = geometry.reflectivity
      task.ssr.step = 0.5
      task.ssr.reflectionSpecularFalloffExponent = 3
      task.ssr.strength = 0.6
      task.ssr.thickness = 0.1
      task.ssr.selfCollisionNumSkip = 1
      task.ssr.enableSmoothReflections = true
      task.ssr.enableAutomaticThicknessComputation = false
      // The scene colour is linear here (the image-processing node grades it after), not gamma.
      task.ssr.inputTextureColorIsInGammaSpace = false
      task.ssr.generateOutputInGammaSpace = false
      return task
    }
    case 'motionBlur': {
      const thin = new ThinMotionBlurPostProcess('scene:motionBlur', scene)
      thin.isObjectBased = true
      thin.motionStrength = 0.15
      thin.motionBlurSamples = 16
      const task = new FrameGraphMotionBlurTask('scene:motionBlur', graph, thin)
      task.velocityTexture = geometry.velocity
      task.depthTexture = geometry.viewDepth
      return task
    }
  }
}
