/**
 * Backbox Frame Graph (#461 Slice A): the backbox layers composed into one texture on the GPU,
 * shown in the scene as one textured plane.
 *
 *   clear ─▶ physical ─▶ grid ─▶ reels ─▶ video ─▶ image ─▶ character ─▶ lcd ─▶ [crt] ─▶ [jackpot] ─▶ plane
 *
 * - One `FrameGraphObjectRendererTask` per layer, all drawing into the same composite texture in
 *   that order through an orthographic backbox camera. The order is explicit; nothing depends on
 *   local-Z offsets or alpha sorting between layers any more.
 * - The layer meshes move to `BACKBOX_LAYER_MASK`, so the scene camera no longer draws them.
 *   Canvas `DynamicTexture` uploads and video decode stay where they were (CPU side, in each
 *   layer); a task only samples the result.
 * - CRT and the jackpot pass run on the composite, so they shade the glass and never the
 *   playfield. Which of them exist is decided by `planBackboxGraph()`; whether one runs on a
 *   given frame is `task.disabled`, which passes the input through unchanged.
 *
 * This graph is not `scene.frameGraph`: the scene still renders through its camera and the
 * existing post-process pipeline (Slice B moves that into a graph). It is executed once per frame
 * from `scene.onBeforeRenderObservable`, before the scene camera samples its output.
 *
 * Nothing here reads accessibility or tier settings: the caller passes a plan in.
 */

import '@babylonjs/core/Engines/Extensions/engine.multiRender'
import '@babylonjs/core/Engines/Extensions/engine.renderTarget'
import '@babylonjs/core/Engines/WebGPU/Extensions/engine.multiRender'
import '@babylonjs/core/Engines/WebGPU/Extensions/engine.renderTarget'
import { Camera } from '@babylonjs/core/Cameras/camera'
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera'
import { Constants } from '@babylonjs/core/Engines/constants'
import type { RenderTargetWrapper } from '@babylonjs/core/Engines/renderTargetWrapper'
import { FrameGraph } from '@babylonjs/core/FrameGraph/frameGraph'
import type { FrameGraphTask } from '@babylonjs/core/FrameGraph/frameGraphTask'
import type { FrameGraphTextureCreationOptions, FrameGraphTextureHandle } from '@babylonjs/core/FrameGraph/frameGraphTypes'
import { FrameGraphCustomPostProcessTask } from '@babylonjs/core/FrameGraph/Tasks/PostProcesses/customPostProcessTask'
import { FrameGraphObjectRendererTask } from '@babylonjs/core/FrameGraph/Tasks/Rendering/objectRendererTask'
import { FrameGraphClearTextureTask } from '@babylonjs/core/FrameGraph/Tasks/Texture/clearTextureTask'
import { FrameGraphCopyToTextureTask } from '@babylonjs/core/FrameGraph/Tasks/Texture/copyToTextureTask'
import type { Effect } from '@babylonjs/core/Materials/effect'
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial'
import { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture'
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color'
import { Vector3 } from '@babylonjs/core/Maths/math.vector'
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh'
import type { Mesh } from '@babylonjs/core/Meshes/mesh'
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder'
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode'
import type { Observer } from '@babylonjs/core/Misc/observable'
import type { Scene } from '@babylonjs/core/scene'
import { sameBackboxGraph, type BackboxEffectNode, type BackboxGraphPlan, type BackboxLayerId } from './backbox-graph-plan'

/**
 * Layer mask for every mesh the backbox graph draws. The scene camera keeps Babylon's default
 * mask (0x0FFFFFFF), which has no bit in common with this one.
 */
export const BACKBOX_LAYER_MASK = 0x10000000
const DEFAULT_LAYER_MASK = 0x0fffffff

export interface BackboxLayerSource {
  id: BackboxLayerId
  /** Read every frame, so a layer may create, swap or drop its meshes at any time. */
  meshes(): readonly AbstractMesh[]
}

/** One effect pass on the composite. The shader is registered in `ShaderStore.ShadersStore`. */
export interface BackboxEffectPass {
  /** ShaderStore name (`<name>FragmentShader`); samples the composite as `textureSampler`. */
  fragmentShader: string
  uniforms: readonly string[]
  /** Extra samplers besides `textureSampler`. */
  samplers: readonly string[]
  /** Per frame: false passes the composite through unchanged. */
  isActive(): boolean
  bind(effect: Effect): void
}

export interface BackboxFrameGraphOptions {
  scene: Scene
  /** The backbox root; the backbox camera and the composite plane are parented to it. */
  root: TransformNode
  displayWidth: number
  displayHeight: number
  /** Local Z of the composite plane (the glass the player looks at). */
  planeZ: number
  layers: readonly BackboxLayerSource[]
  effects: Readonly<Record<BackboxEffectNode, BackboxEffectPass>>
  /** Called when meshes moved to `BACKBOX_LAYER_MASK`, so a frozen active-mesh list can be thawed. */
  onLayerMasksChanged?: () => void
}

export interface BackboxGraphInfo {
  backend: 'webgpu' | 'webgl2'
  /** Task names in execution order, e.g. `backbox:clear`, `backbox:physical`, …, `backbox:crt`. */
  nodes: string[]
  effects: BackboxEffectNode[]
  omitted: Array<BackboxGraphPlan['omitted'][number]>
  /** Effect passes that ran on the last executed frame (disabled ones pass through). */
  activeEffects: BackboxEffectNode[]
  width: number
  height: number
  executedFrames: number
}

interface LayerTask {
  source: BackboxLayerSource
  task: FrameGraphObjectRendererTask
}

interface EffectTask {
  node: BackboxEffectNode
  pass: BackboxEffectPass
  task: FrameGraphCustomPostProcessTask
}

export class BackboxFrameGraph {
  /** The composite as a sampleable texture; the scene plane shows it. */
  readonly texture: BaseTexture
  readonly plane: Mesh

  private readonly scene: Scene
  private readonly options: BackboxFrameGraphOptions
  private readonly camera: FreeCamera
  private readonly frameGraph: FrameGraph
  private readonly material: StandardMaterial
  private output: RenderTargetWrapper
  /** The plan the graph was last built with. */
  private plan: BackboxGraphPlan | null = null
  /** The plan most recently asked for; ahead of `plan` while a rebuild compiles. */
  private requested: BackboxGraphPlan | null = null
  private layerTasks: LayerTask[] = []
  private effectTasks: EffectTask[] = []
  private ready = false
  private disposed = false
  private executedFrames = 0
  private buildGeneration = 0
  private observer: Observer<Scene> | null = null
  private readonly adopted = new Set<AbstractMesh>()

  private constructor(options: BackboxFrameGraphOptions, plan: BackboxGraphPlan) {
    this.options = options
    const { scene, root, displayWidth, displayHeight } = options
    this.scene = scene

    // Orthographic camera on the front side of the layer stack, looking down -Z through it: the
    // layer planes face +Z (rotation.y = π), so they read the right way round from here.
    const camera = new FreeCamera('backboxCamera', new Vector3(0, 0, 10), scene, false)
    camera.parent = root
    camera.rotation.y = Math.PI
    camera.mode = Camera.ORTHOGRAPHIC_CAMERA
    camera.orthoLeft = -displayWidth / 2
    camera.orthoRight = displayWidth / 2
    camera.orthoTop = displayHeight / 2
    camera.orthoBottom = -displayHeight / 2
    camera.minZ = 0.1
    camera.maxZ = 30
    camera.layerMask = BACKBOX_LAYER_MASK
    this.camera = camera

    this.frameGraph = new FrameGraph(scene)
    this.output = this.createOutput(plan)
    // Not a RenderTargetTexture: nothing may ever render the scene into it. Only the graph writes it.
    this.output.texture?.incrementReferences()
    this.texture = new BaseTexture(scene, this.output.texture)
    this.texture.name = 'backboxCompositeTexture'

    // The one plane the scene camera sees. It faces -Z (toward the playfield camera); the
    // composite's left edge is the backbox camera's left, which is the player's left too.
    const plane = MeshBuilder.CreatePlane('backboxComposite', { width: displayWidth, height: displayHeight }, scene)
    plane.parent = root
    plane.position.z = options.planeZ
    plane.isPickable = false
    plane.setEnabled(false) // until the first build succeeds
    const material = new StandardMaterial('backboxCompositeMat', scene)
    material.disableLighting = true
    material.diffuseColor = Color3.Black()
    material.specularColor = Color3.Black()
    material.emissiveTexture = this.texture
    plane.material = material
    this.plane = plane
    this.material = material
  }

  static async create(options: BackboxFrameGraphOptions, plan: BackboxGraphPlan): Promise<BackboxFrameGraph> {
    const graph = new BackboxFrameGraph(options, plan)
    try {
      await graph.build(plan)
    } catch (err) {
      graph.dispose()
      throw err
    }
    return graph
  }

  /** Rebuild with another plan (accessibility changed). A plan with the same nodes is a no-op. */
  async rebuild(plan: BackboxGraphPlan): Promise<void> {
    if (this.disposed) return
    // Compare with the latest request, not the last finished build: toggling a setting off and on
    // again while the first rebuild compiles must still end on the latest plan.
    if (this.requested && sameBackboxGraph(this.requested, plan)) return
    if (this.requested && (plan.width !== this.requested.width || plan.height !== this.requested.height)) {
      throw new Error('[BackboxFrameGraph] The composite size is fixed for the graph lifetime')
    }
    await this.build(plan)
  }

  getInfo(): BackboxGraphInfo {
    const plan = this.plan
    return {
      backend: this.scene.getEngine().isWebGPU ? 'webgpu' : 'webgl2',
      nodes: this.frameGraph.tasks.map((t: FrameGraphTask) => t.name),
      effects: plan ? [...plan.effects] : [],
      omitted: plan ? plan.omitted.map((o) => ({ ...o })) : [],
      activeEffects: this.effectTasks.filter((e) => !e.task.disabled).map((e) => e.node),
      width: plan?.width ?? 0,
      height: plan?.height ?? 0,
      executedFrames: this.executedFrames,
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.ready = false
    if (this.observer) this.scene.onBeforeRenderObservable.remove(this.observer)
    this.observer = null
    // Hand the layers back to the scene camera, so a failed or torn-down graph never hides them.
    for (const mesh of this.adopted) {
      if (!mesh.isDisposed() && mesh.layerMask === BACKBOX_LAYER_MASK) mesh.layerMask = DEFAULT_LAYER_MASK
    }
    this.adopted.clear()
    this.frameGraph.dispose()
    this.plane.dispose()
    this.material.dispose()
    this.texture.dispose()
    this.output.dispose()
    this.camera.dispose()
  }

  private createOutput(plan: BackboxGraphPlan): RenderTargetWrapper {
    return this.scene.getEngine().createRenderTargetTexture(
      { width: plan.width, height: plan.height },
      {
        generateMipMaps: false,
        generateDepthBuffer: false,
        generateStencilBuffer: false,
        type: Constants.TEXTURETYPE_UNSIGNED_BYTE,
        format: Constants.TEXTUREFORMAT_RGBA,
        samplingMode: Constants.TEXTURE_BILINEAR_SAMPLINGMODE,
        label: 'backboxComposite',
      },
    )
  }

  private async build(plan: BackboxGraphPlan): Promise<void> {
    const generation = ++this.buildGeneration
    this.requested = plan
    this.ready = false
    this.frameGraph.clear()
    this.layerTasks = []
    this.effectTasks = []
    this.addTasks(plan)
    await this.frameGraph.buildAsync()
    await this.frameGraph.whenReadyAsync()
    // A dispose or a newer rebuild landed while this one was compiling.
    if (this.disposed || generation !== this.buildGeneration) return
    this.plan = plan
    this.adoptLayerMeshes()
    this.plane.setEnabled(true)
    this.ready = true
    this.observer ??= this.scene.onBeforeRenderObservable.add(() => this.execute())
  }

  private addTasks(plan: BackboxGraphPlan): void {
    const fg = this.frameGraph
    const tm = fg.textureManager
    const size = { width: plan.width, height: plan.height }
    const colorOptions: FrameGraphTextureCreationOptions = {
      size,
      sizeIsPercentage: false,
      options: {
        createMipMaps: false,
        samples: 1,
        types: [Constants.TEXTURETYPE_UNSIGNED_BYTE],
        formats: [Constants.TEXTUREFORMAT_RGBA],
        useSRGBBuffers: [false],
      },
    }
    const composite = tm.createRenderTargetTexture('backboxComposite', colorOptions)
    const depth = tm.createRenderTargetTexture('backboxDepth', {
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
    const outputTexture = this.output.texture
    if (!outputTexture) throw new Error('[BackboxFrameGraph] Composite output texture was not created')
    const output = tm.importTexture('backboxOutput', outputTexture)

    // The backbox interior is dark glass: start every frame from opaque black.
    const clear = new FrameGraphClearTextureTask('backbox:clear', fg)
    clear.color = new Color4(0, 0, 0, 1)
    clear.clearColor = true
    clear.clearDepth = true
    clear.targetTexture = composite
    clear.depthTexture = depth
    fg.addTask(clear)

    let previous: FrameGraphTextureHandle = clear.outputTexture
    for (const id of plan.layers) {
      const source = this.options.layers.find((l) => l.id === id)
      if (!source) continue
      const task = new FrameGraphObjectRendererTask(`backbox:${id}`, fg, this.scene)
      task.targetTexture = previous
      task.camera = this.camera
      task.objectList = { meshes: [], particleSystems: [] }
      // Colours go into the composite as authored; the scene pipeline grades the plane once.
      task.disableImageProcessing = true
      task.disableShadows = true
      if (id === 'physical') {
        // The only 3-D layer (rotating drums): it needs depth within itself. Every later layer is a
        // flat plane drawn over what is already there, so it neither tests nor writes depth.
        task.depthTexture = clear.outputDepthTexture
        task.depthTest = true
        task.depthWrite = true
      } else {
        task.depthTest = false
        task.depthWrite = false
      }
      fg.addTask(task)
      this.layerTasks.push({ source, task })
      previous = task.outputTexture
    }

    plan.effects.forEach((node, index) => {
      const pass = this.options.effects[node]
      const task = new FrameGraphCustomPostProcessTask(`backbox:${node}`, fg, {
        name: `backbox:${node}`,
        fragmentShader: pass.fragmentShader,
        useShaderStore: true,
        uniforms: [...pass.uniforms],
        samplers: [...pass.samplers],
      })
      task.sourceTexture = previous
      if (index === plan.effects.length - 1) task.targetTexture = output
      task.onApplyObservable.add((effect) => pass.bind(effect))
      fg.addTask(task)
      this.effectTasks.push({ node, pass, task })
      previous = task.outputTexture
    })

    if (plan.effects.length === 0) {
      const copy = new FrameGraphCopyToTextureTask('backbox:output', fg)
      copy.sourceTexture = previous
      copy.targetTexture = output
      fg.addTask(copy)
    }
  }

  /**
   * Move a layer's meshes onto the backbox mask. Cheap when nothing changed.
   * @returns true when at least one mesh moved
   */
  private adopt(meshes: readonly AbstractMesh[]): boolean {
    let changed = false
    for (const mesh of meshes) {
      if (mesh.layerMask !== BACKBOX_LAYER_MASK) {
        mesh.layerMask = BACKBOX_LAYER_MASK
        changed = true
      }
      this.adopted.add(mesh)
    }
    return changed
  }

  private adoptLayerMeshes(): void {
    let changed = false
    for (const { source } of this.layerTasks) changed = this.adopt(source.meshes()) || changed
    if (changed) this.options.onLayerMasksChanged?.()
  }

  private execute(): void {
    if (!this.ready || this.disposed) return
    let adoptedNew = false
    for (const { source, task } of this.layerTasks) {
      const meshes = source.meshes()
      adoptedNew = this.adopt(meshes) || adoptedNew
      task.objectList.meshes = meshes as AbstractMesh[]
      // A layer with nothing visible keeps the composite as it is (its disabled pass is a no-op).
      task.disabled = !meshes.some((m) => m.isVisible && m.isEnabled())
    }
    if (adoptedNew) this.options.onLayerMasksChanged?.()
    // The SceneOptimizer switches post-processing off under load; the glass passes follow it, as
    // the camera post-processes they replace did.
    const postProcessesEnabled = this.scene.postProcessesEnabled
    for (const { pass, task } of this.effectTasks) {
      task.disabled = !postProcessesEnabled || !pass.isActive()
    }
    this.frameGraph.execute()
    this.executedFrames++
  }
}
