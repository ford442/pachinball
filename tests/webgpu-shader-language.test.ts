/**
 * #488 §1: no WebGPU path compiles a GLSL-only shader (a GLSL effect on WebGPU makes Babylon fetch
 * glslang + twgsl from cdn.babylonjs.com).
 *
 * - Every shader registered in `ShadersStore` has a `ShadersStoreWGSL` twin under the same key.
 * - Each WGSL twin is WGSL and declares the same uniforms, samplers and varyings as its GLSL source.
 * - On WebGPU the grid ShaderMaterial and every backbox pass ask for `ShaderLanguage.WGSL`, and the
 *   backbox Frame Graph hands that language (and the lazy WGSL loader) to Babylon's post-process task.
 * - On WebGL2 they stay GLSL and load nothing.
 *
 * Babylon is mocked at the module boundary (CLAUDE.md); the real compile is in
 * tests/webgpu-no-glslang.spec.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const hoisted = vi.hoisted(() => {
  const glsl: Record<string, string> = {}
  const wgsl: Record<string, string> = {}
  const ShaderLanguage = { GLSL: 0, WGSL: 1 } as const

  const ctx = new Proxy({}, { get: (_t, key) => (key === 'canvas' ? { width: 256, height: 256 } : vi.fn()), set: () => true })
  class DynamicTexture {
    getContext = () => ctx
    update = vi.fn()
    dispose = vi.fn()
  }
  class ShaderMaterial {
    static created: ShaderMaterial[] = []
    constructor(
      public name: string,
      _scene: unknown,
      public shaderPath: unknown,
      public options: { shaderLanguage?: number; extraInitializationsAsync?: () => Promise<void> },
    ) {
      ShaderMaterial.created.push(this)
    }
    setFloat = vi.fn()
    setColor3 = vi.fn()
    dispose = vi.fn()
  }

  let handles = 1
  class Task {
    disabled = false
    readonly outputTexture = handles++
    readonly outputDepthTexture = handles++
    targetTexture?: number
    sourceTexture?: number
    depthTexture?: number
    constructor(public name: string) {}
  }
  class FrameGraphCustomPostProcessTask extends Task {
    onApplyObservable = { add: vi.fn() }
    constructor(
      name: string,
      _fg: unknown,
      public options: { fragmentShader: string; shaderLanguage?: number; extraInitializationsAsync?: () => Promise<void> },
    ) {
      super(name)
    }
  }
  class FrameGraphObjectRendererTask extends Task {
    objectList = { meshes: [] as unknown[], particleSystems: [] as unknown[] }
  }
  class FrameGraph {
    static last: FrameGraph | null = null
    tasks: Task[] = []
    textureManager = { createRenderTargetTexture: () => handles++, importTexture: () => handles++ }
    constructor() {
      FrameGraph.last = this
    }
    addTask(t: Task) {
      this.tasks.push(t)
    }
    clear() {
      this.tasks = []
    }
    async buildAsync() {}
    async whenReadyAsync() {}
    execute() {}
    dispose() {}
  }
  const mkMesh = () => ({
    parent: null as unknown,
    position: { z: 0 },
    rotation: { y: 0 },
    material: null as unknown,
    isPickable: true,
    isVisible: true,
    layerMask: 0x0fffffff,
    setEnabled: vi.fn(),
    isEnabled: () => true,
    isDisposed: () => false,
    freezeWorldMatrix: vi.fn(),
    dispose: vi.fn(),
  })

  return {
    glsl,
    wgsl,
    ShaderLanguage,
    DynamicTexture,
    ShaderMaterial,
    Task,
    FrameGraph,
    FrameGraphCustomPostProcessTask,
    FrameGraphObjectRendererTask,
    mkMesh,
  }
})

vi.mock('@babylonjs/core', () => ({
  Effect: { ShadersStore: hoisted.glsl },
  ShaderStore: { ShadersStore: hoisted.glsl, ShadersStoreWGSL: hoisted.wgsl },
  ShaderLanguage: hoisted.ShaderLanguage,
  ShaderMaterial: hoisted.ShaderMaterial,
  DynamicTexture: hoisted.DynamicTexture,
  Color3: { FromHexString: () => ({}), Black: () => ({}) },
  Color4: class {},
  Vector3: class {},
  MeshBuilder: { CreatePlane: () => hoisted.mkMesh() },
  Camera: { ORTHOGRAPHIC_CAMERA: 1 },
  FreeCamera: class {
    rotation = { y: 0 }
    dispose = vi.fn()
  },
  Constants: new Proxy({}, { get: () => 0 }),
  FrameGraph: hoisted.FrameGraph,
  FrameGraphClearTextureTask: hoisted.Task,
  FrameGraphCopyToTextureTask: hoisted.Task,
  FrameGraphObjectRendererTask: hoisted.FrameGraphObjectRendererTask,
  FrameGraphCustomPostProcessTask: hoisted.FrameGraphCustomPostProcessTask,
  StandardMaterial: class {
    dispose = vi.fn()
  },
  BaseTexture: class {
    name = ''
    dispose = vi.fn()
  },
}))

import { DisplayShaderLayer } from '../src/display/display-shader'
import { BACKBOX_WGSL_SHADERS, registerBackboxWgslShaders } from '../src/display/backbox-shaders-wgsl'
import { BACKBOX_GLSL_SHADERS, registerBackboxGlslShaders } from '../src/display/backbox-shaders-glsl'
import { BackboxFrameGraph } from '../src/display/backbox-frame-graph'
import { planBackboxGraph } from '../src/display/backbox-graph-plan'
import { DEFAULT_DISPLAY_CONFIG } from '../src/display/display-types'
import { QualityTier } from '../src/game-elements/visual-language'
import { crtEffectShader } from '../src/shaders/crt-effect'
import { cyberGridShader } from '../src/shaders/cyber-grid'
import { jackpotOverlayPostProcessFragment } from '../src/shaders/jackpotOverlay'
import { lcdTablePixelShader } from '../src/shaders/lcd-table'
import { scanlinePixelShader } from '../src/shaders/scanline'
import { crtEffectFragmentWGSL } from '../src/shaders/wgsl/crt-effect'
import { cyberGridFragmentWGSL, cyberGridVertexWGSL } from '../src/shaders/wgsl/cyber-grid'
import { jackpotOverlayFragmentWGSL } from '../src/shaders/wgsl/jackpot-overlay'
import { lcdTableFragmentWGSL } from '../src/shaders/wgsl/lcd-table'
import { scanlineFragmentWGSL } from '../src/shaders/wgsl/scanline'

const { WGSL, GLSL } = hoisted.ShaderLanguage

/** Every GLSL shader in src/shaders with its WGSL twin. */
const PAIRS: Array<{ name: string; stage: 'vertex' | 'fragment'; glsl: string; wgsl: string }> = [
  { name: 'crtEffect', stage: 'fragment', glsl: crtEffectShader.fragment, wgsl: crtEffectFragmentWGSL },
  { name: 'jackpotOverlay', stage: 'fragment', glsl: jackpotOverlayPostProcessFragment, wgsl: jackpotOverlayFragmentWGSL },
  { name: 'cyberGrid', stage: 'vertex', glsl: cyberGridShader.vertex, wgsl: cyberGridVertexWGSL },
  { name: 'cyberGrid', stage: 'fragment', glsl: cyberGridShader.fragment, wgsl: cyberGridFragmentWGSL },
  { name: 'lcdTable', stage: 'fragment', glsl: lcdTablePixelShader.fragment, wgsl: lcdTableFragmentWGSL },
  { name: 'scanline', stage: 'fragment', glsl: scanlinePixelShader.fragment, wgsl: scanlineFragmentWGSL },
]

const stripComments = (src: string) => src.replace(/\/\/.*$/gm, '')
const names = (src: string, re: RegExp) => [...stripComments(src).matchAll(re)].map((m) => m[1]!).sort()

function glslInterface(src: string) {
  const decls = [...stripComments(src).matchAll(/^\s*uniform\s+(\w+)\s+(\w+)\s*;/gm)]
  return {
    uniforms: decls.filter((d) => d[1] !== 'sampler2D').map((d) => d[2]!).sort(),
    samplers: decls.filter((d) => d[1] === 'sampler2D').map((d) => d[2]!).sort(),
    varyings: names(src, /^\s*varying\s+\w+\s+(\w+)\s*;/gm),
    attributes: names(src, /^\s*attribute\s+\w+\s+(\w+)\s*;/gm),
  }
}

function wgslInterface(src: string) {
  return {
    uniforms: names(src, /^\s*uniform\s+(\w+)\s*:/gm),
    samplers: names(src, /^\s*var\s+(\w+)\s*:\s*texture_2d<f32>\s*;/gm),
    varyings: names(src, /^\s*varying\s+(\w+)\s*:/gm),
    attributes: names(src, /^\s*attribute\s+(\w+)\s*:/gm),
  }
}

function webgpuScene() {
  return {
    postProcessesEnabled: true,
    getEngine: () => ({
      isWebGPU: true,
      createRenderTargetTexture: () => ({ texture: { incrementReferences: vi.fn() }, dispose: vi.fn() }),
    }),
    onBeforeRenderObservable: { add: vi.fn(() => ({})), remove: vi.fn() },
  }
}

function clear(store: Record<string, string>) {
  for (const key of Object.keys(store)) delete store[key]
}

describe('WGSL twins of the GLSL shaders', () => {
  it('every shader registered in ShadersStore has a ShadersStoreWGSL twin under the same key', () => {
    // Neither language registers at module load: each is a lazy chunk (entry-chunk budget).
    clear(hoisted.glsl)
    registerBackboxGlslShaders()
    expect(Object.keys(hoisted.glsl).sort()).toEqual(
      ['crtEffectFragmentShader', 'cyberGridFragmentShader', 'cyberGridVertexShader', 'jackpotOverlayFragmentShader'],
    )
    expect(Object.keys(BACKBOX_GLSL_SHADERS).sort()).toEqual(Object.keys(hoisted.glsl).sort())
    clear(hoisted.wgsl)
    registerBackboxWgslShaders()
    expect(Object.keys(hoisted.wgsl).sort()).toEqual(Object.keys(hoisted.glsl).sort())
    expect(Object.keys(BACKBOX_WGSL_SHADERS).sort()).toEqual(Object.keys(hoisted.glsl).sort())
  })

  it.each(PAIRS)('$name ($stage): the WGSL twin is WGSL with the same uniforms, samplers and varyings', ({ stage, glsl, wgsl }) => {
    expect(wgsl).toContain(stage === 'vertex' ? '@vertex' : '@fragment')
    expect(stripComments(wgsl)).not.toMatch(/gl_FragColor|gl_Position|texture2D|precision\s+highp|void\s+main|\bvec[234]\(|sampler2D/)
    if (stage === 'fragment') expect(wgsl).toMatch(/fragmentOutputs\.color\s*=/)

    const g = glslInterface(glsl)
    const w = wgslInterface(wgsl)
    expect(w).toEqual(g)
    // Babylon binds `<texture>` with the sampler `<texture>Sampler`.
    for (const sampler of w.samplers) expect(wgsl).toMatch(new RegExp(`var\\s+${sampler}Sampler\\s*:\\s*sampler\\s*;`))
  })
})

describe('the WebGPU path compiles WGSL only', () => {
  beforeEach(() => {
    hoisted.ShaderMaterial.created.length = 0
    clear(hoisted.wgsl)
  })

  it('on WebGPU the grid material and every backbox pass ask for WGSL, loaded lazily before compile', async () => {
    const layer = new DisplayShaderLayer(webgpuScene() as never, DEFAULT_DISPLAY_CONFIG)
    const [grid] = hoisted.ShaderMaterial.created
    expect(grid!.shaderPath).toEqual({ vertex: 'cyberGrid', fragment: 'cyberGrid' })
    expect(grid!.options.shaderLanguage).toBe(WGSL)
    expect(grid!.options.extraInitializationsAsync).toBeTypeOf('function')

    const passes = Object.values(layer.getEffectPasses())
    for (const pass of passes) {
      expect(pass.shaderLanguage).toBe(WGSL)
      expect(pass.extraInitializationsAsync).toBeTypeOf('function')
    }

    // Nothing is registered until Babylon runs the hook, which then registers every source used.
    expect(hoisted.wgsl).toEqual({})
    await grid!.options.extraInitializationsAsync!()
    expect(hoisted.wgsl['cyberGridVertexShader']).toBe(cyberGridVertexWGSL)
    expect(hoisted.wgsl['cyberGridFragmentShader']).toBe(cyberGridFragmentWGSL)
    for (const pass of passes) {
      await pass.extraInitializationsAsync!()
      expect(hoisted.wgsl[`${pass.fragmentShader}FragmentShader`], pass.fragmentShader).toBeTruthy()
    }
  })

  it('on WebGL2 they stay GLSL, loaded lazily from the GLSL chunk, and register no WGSL', async () => {
    clear(hoisted.glsl)
    const scene = { getEngine: () => ({ isWebGPU: false }) }
    const layer = new DisplayShaderLayer(scene as never, DEFAULT_DISPLAY_CONFIG)
    const [grid] = hoisted.ShaderMaterial.created
    expect(grid!.options.shaderLanguage).toBe(GLSL)
    expect(hoisted.glsl).toEqual({})
    await grid!.options.extraInitializationsAsync!()
    expect(hoisted.glsl['cyberGridVertexShader']).toBe(cyberGridShader.vertex)
    for (const pass of Object.values(layer.getEffectPasses())) {
      expect(pass.shaderLanguage).toBe(GLSL)
      await pass.extraInitializationsAsync!()
      expect(hoisted.glsl[`${pass.fragmentShader}FragmentShader`], pass.fragmentShader).toBeTruthy()
    }
    expect(hoisted.wgsl).toEqual({})
  })

  it('the backbox Frame Graph hands each pass language and loader to its post-process task', async () => {
    const scene = webgpuScene()
    const layer = new DisplayShaderLayer(scene as never, DEFAULT_DISPLAY_CONFIG)
    const effects = layer.getEffectPasses()
    const flags = { photosensitive: false, noPostProcess: false }
    for (const reducedMotion of [false, true]) {
      const plan = planBackboxGraph({ ...flags, reducedMotion }, QualityTier.MEDIUM, 16 / 9)
      const graph = await BackboxFrameGraph.create(
        {
          scene: scene as never,
          root: {} as never,
          displayWidth: 16,
          displayHeight: 9,
          planeZ: 0,
          layers: [{ id: 'grid', meshes: () => layer.getMeshes() }],
          effects,
        },
        plan,
      )
      const postTasks = hoisted.FrameGraph.last!.tasks.filter(
        (t): t is InstanceType<typeof hoisted.FrameGraphCustomPostProcessTask> => t instanceof hoisted.FrameGraphCustomPostProcessTask,
      )
      expect(postTasks.map((t) => t.name)).toEqual(plan.effects.map((node) => `backbox:${node}`))
      for (const task of postTasks) {
        const pass = effects[task.name.replace('backbox:', '') as keyof typeof effects]
        expect(task.options.shaderLanguage).toBe(WGSL)
        expect(task.options.extraInitializationsAsync).toBe(pass.extraInitializationsAsync)
      }
      graph.dispose()
    }
  })
})
