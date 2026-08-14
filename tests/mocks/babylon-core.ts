/**
 * Vitest stub for all @babylonjs/core deep imports.
 * Aliased via vitest.config.ts so Node tests never load the real engine.
 */
import { vi } from 'vitest'

class MockVector3 {
  x: number
  y: number
  z: number
  constructor(x = 0, y = 0, z = 0) {
    this.x = x
    this.y = y
    this.z = z
  }
  clone() {
    return new MockVector3(this.x, this.y, this.z)
  }
  set(x: number, y: number, z: number) {
    this.x = x
    this.y = y
    this.z = z
    return this
  }
  copyFrom(v: MockVector3) {
    this.x = v.x
    this.y = v.y
    this.z = v.z
    return this
  }
  add(v: MockVector3) {
    return new MockVector3(this.x + v.x, this.y + v.y, this.z + v.z)
  }
  addInPlace(v: MockVector3) {
    this.x += v.x
    this.y += v.y
    this.z += v.z
    return this
  }
  subtract(v: MockVector3) {
    return new MockVector3(this.x - v.x, this.y - v.y, this.z - v.z)
  }
  scale(s: number) {
    return new MockVector3(this.x * s, this.y * s, this.z * s)
  }
  scaleInPlace(s: number) {
    this.x *= s
    this.y *= s
    this.z *= s
    return this
  }
  normalize() {
    const len = Math.sqrt(this.x ** 2 + this.y ** 2 + this.z ** 2) || 1
    return new MockVector3(this.x / len, this.y / len, this.z / len)
  }
  length() {
    return Math.sqrt(this.x ** 2 + this.y ** 2 + this.z ** 2)
  }
  static Zero() {
    return new MockVector3(0, 0, 0)
  }
  static Distance(a: MockVector3, b: MockVector3) {
    return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2)
  }
  static Lerp(a: MockVector3, b: MockVector3, t: number) {
    return new MockVector3(
      a.x + (b.x - a.x) * t,
      a.y + (b.y - a.y) * t,
      a.z + (b.z - a.z) * t,
    )
  }
  static LerpToRef(a: MockVector3, b: MockVector3, t: number, ref: MockVector3) {
    ref.x = a.x + (b.x - a.x) * t
    ref.y = a.y + (b.y - a.y) * t
    ref.z = a.z + (b.z - a.z) * t
    return ref
  }
}

class MockColor3 {
  r: number
  g: number
  b: number
  constructor(r = 0, g = 0, b = 0) {
    this.r = r
    this.g = g
    this.b = b
  }
  scale(s: number) {
    return new MockColor3(this.r * s, this.g * s, this.b * s)
  }
  copyFrom(c: MockColor3) {
    this.r = c.r
    this.g = c.g
    this.b = c.b
    return this
  }
  clone() {
    return new MockColor3(this.r, this.g, this.b)
  }
}

function createMockMesh() {
  return {
    name: 'mesh',
    position: new MockVector3(),
    rotation: { x: 0, y: 0, z: 0 },
    rotationQuaternion: new MockQuaternion(),
    scaling: { x: 1, y: 1, z: 1, setAll: vi.fn() },
    material: null,
    parent: null,
    isVisible: true,
    isPickable: true,
    receiveShadows: false,
    getChildren: vi.fn(() => []),
    getBoundingInfo: vi.fn(() => ({
      boundingBox: { minimumWorld: new MockVector3(), maximumWorld: new MockVector3() },
    })),
    setEnabled: vi.fn(),
    dispose: vi.fn(),
    bakeTransformIntoVertices: vi.fn(),
  }
}

export const Mesh = Object.assign(
  vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    Object.assign(this, createMockMesh())
    return this
  }),
  { NO_CAP: 0 },
)

export const TransformNode = vi.fn().mockImplementation(function (this: Record<string, unknown>) {
  this.position = new MockVector3()
  this.rotation = { y: 0, x: 0, z: 0 }
  this.scaling = { x: 1, y: 1, z: 1 }
  this.getChildren = vi.fn(() => [])
  this.parent = null
  this.dispose = vi.fn()
  return this
})

export const MeshBuilder = {
  CreateSphere: vi.fn().mockImplementation(() => createMockMesh()),
  CreateTorus: vi.fn().mockImplementation(() => createMockMesh()),
  CreateCylinder: vi.fn().mockImplementation(() => createMockMesh()),
  CreateBox: vi.fn().mockImplementation(() => createMockMesh()),
  CreatePolyhedron: vi.fn().mockImplementation(() => createMockMesh()),
  CreateDisc: vi.fn().mockImplementation(() => createMockMesh()),
  CreatePlane: vi.fn().mockImplementation(() => createMockMesh()),
  CreateGround: vi.fn().mockImplementation(() => createMockMesh()),
  CreateTiledGround: vi.fn().mockImplementation(() => createMockMesh()),
  CreateCapsule: vi.fn().mockImplementation(() => createMockMesh()),
  CreateRibbon: vi.fn().mockImplementation(() => createMockMesh()),
}

export const Vector3 = MockVector3

export const Color3 = Object.assign(MockColor3, {
  Black: vi.fn().mockReturnValue(new MockColor3(0, 0, 0)),
  White: vi.fn().mockReturnValue(new MockColor3(1, 1, 1)),
  Green: vi.fn().mockReturnValue(new MockColor3(0, 1, 0)),
  Yellow: vi.fn().mockReturnValue(new MockColor3(1, 1, 0)),
  Red: vi.fn().mockReturnValue(new MockColor3(1, 0, 0)),
  Blue: vi.fn().mockReturnValue(new MockColor3(0, 0, 1)),
  Gray: vi.fn().mockReturnValue(new MockColor3(0.5, 0.5, 0.5)),
  FromHexString: vi.fn().mockReturnValue(new MockColor3(0, 1, 1)),
  Lerp: (a: MockColor3, b: MockColor3, t: number) => (t < 0.5 ? a : b),
})

export const Color4 = vi.fn().mockImplementation(function (this: Record<string, unknown>, r = 0, g = 0, b = 0, a = 1) {
  this.r = r
  this.g = g
  this.b = b
  this.a = a
  return this
})

export const StandardMaterial = vi.fn().mockImplementation(function (this: Record<string, unknown>) {
  this.emissiveColor = new MockColor3(0, 0, 0)
  this.emissiveColor.copyFrom = vi.fn(function (this: MockColor3, c: MockColor3) {
    this.r = c.r
    this.g = c.g
    this.b = c.b
    return this
  })
  this.diffuseColor = null
  this.alpha = 1
  this.backFaceCulling = true
  this.wireframe = false
  this.dispose = vi.fn()
  return this
})

export const PBRMaterial = vi.fn().mockImplementation(function (this: Record<string, unknown>) {
  this.emissiveColor = new MockColor3(0, 0, 0)
  this.albedoColor = null
  this.emissiveIntensity = 0
  this.alpha = 0.85
  this.metallic = 0
  this.roughness = 0
  this.subSurface = { isRefractionEnabled: false, tintColor: null }
  this.dispose = vi.fn()
  return this
})

export const TrailMesh = vi.fn().mockImplementation(function (this: { material: unknown; dispose: () => void }) {
  this.material = null
  this.dispose = vi.fn()
  return this
})

export const PointLight = vi.fn().mockImplementation(function (this: Record<string, unknown>) {
  this.diffuse = null
  this.intensity = 0
  this.range = 0
  this.parent = null
  return this
})

export class MockQuaternion {
  x: number
  y: number
  z: number
  w: number
  constructor(x = 0, y = 0, z = 0, w = 1) {
    this.x = x
    this.y = y
    this.z = z
    this.w = w
  }
  set(x: number, y: number, z: number, w: number) {
    this.x = x
    this.y = y
    this.z = z
    this.w = w
    return this
  }
  clone() {
    return new MockQuaternion(this.x, this.y, this.z, this.w)
  }
  copyFrom(q: MockQuaternion) {
    return this.set(q.x, q.y, q.z, q.w)
  }
  static SlerpToRef(
    a: MockQuaternion,
    b: MockQuaternion,
    t: number,
    ref: MockQuaternion,
  ) {
    ref.x = a.x + (b.x - a.x) * t
    ref.y = a.y + (b.y - a.y) * t
    ref.z = a.z + (b.z - a.z) * t
    ref.w = a.w + (b.w - a.w) * t
    return ref
  }
  static FromEulerAngles(x: number, y: number, z: number) {
    return new MockQuaternion(x, y, z, 1)
  }
  static Identity() {
    return new MockQuaternion(0, 0, 0, 1)
  }
}

export const Quaternion = MockQuaternion

export const Matrix = {
  Translation: vi.fn().mockReturnValue({}),
  Identity: vi.fn().mockReturnValue({}),
}

export const Scalar = {
  Lerp: (a: number, b: number, t: number) => a + (b - a) * t,
  Clamp: (value: number, min: number, max: number) => Math.min(max, Math.max(min, value)),
}

export const Scene = vi.fn().mockImplementation(function (this: Record<string, unknown>) {
  this.meshes = []
  this.materials = []
  this.lights = []
  this.cameras = []
  this.textures = []
  this.getUniqueId = vi.fn(() => 1)
  this.getMeshByName = vi.fn(() => null)
  this.getMaterialByName = vi.fn(() => null)
  this.getLightByName = vi.fn(() => null)
  this.registerBeforeRender = vi.fn()
  this.unregisterBeforeRender = vi.fn()
  this.onBeforeRenderObservable = { add: vi.fn(), remove: vi.fn() }
  this.onAfterRenderObservable = { add: vi.fn(), remove: vi.fn() }
  this.dispose = vi.fn()
  return this
})

export const Engine = Object.assign(
  vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.dispose = vi.fn()
    this.runRenderLoop = vi.fn()
    this.stopRenderLoop = vi.fn()
    this.resize = vi.fn()
    this.getClassName = vi.fn(() => 'Engine')
    return this
  }),
  { IsSupported: true },
)

export const WebGPUEngine = Object.assign(
  vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.dispose = vi.fn()
    this.getClassName = vi.fn(() => 'WebGPUEngine')
    return this
  }),
  { IsSupportedAsync: Promise.resolve(false), CreateAsync: vi.fn() },
)

export const Effect = {
  ShadersStore: {} as Record<string, string>,
  RegisterShader: vi.fn(),
}

export const ShaderMaterial = vi.fn().mockImplementation(function (this: Record<string, unknown>) {
  this.dispose = vi.fn()
  return this
})

export const PostProcess = vi.fn().mockImplementation(function (this: Record<string, unknown>) {
  this.dispose = vi.fn()
  return this
})

export const Texture = vi.fn().mockImplementation(function (this: Record<string, unknown>) {
  this.dispose = vi.fn()
  return this
})

export const DynamicTexture = vi.fn().mockImplementation(function (this: Record<string, unknown>) {
  this.dispose = vi.fn()
  this.getContext = vi.fn(() => ({
    fillStyle: '',
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    clearRect: vi.fn(),
    font: '',
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 0 })),
  }))
  return this
})

export const MirrorTexture = vi.fn().mockImplementation(function (this: Record<string, unknown>) {
  this.dispose = vi.fn()
  this.mirrorPlane = new MockVector3(0, 1, 0)
  return this
})

export const RenderTargetTexture = vi.fn().mockImplementation(function (this: Record<string, unknown>) {
  this.dispose = vi.fn()
  return this
})

export const AbstractMesh = Mesh

export const Camera = vi.fn()
export const TargetCamera = vi.fn()
export const FreeCamera = vi.fn()
export const ArcRotateCamera = vi.fn().mockImplementation(function (this: Record<string, unknown>) {
  this.position = new MockVector3()
  this.setTarget = vi.fn()
  this.attachControl = vi.fn()
  this.detachControl = vi.fn()
  return this
})

export const HemisphericLight = vi.fn().mockImplementation(function (this: Record<string, unknown>) {
  this.intensity = 1
  this.diffuse = null
  return this
})

export const MaterialPluginBase = class MaterialPluginBase {
  constructor(_material: unknown, _name: string, _priority: number, _defines?: unknown) {}
  isReadyForSubMesh(): boolean {
    return true
  }
  getClassName(): string {
    return 'MaterialPluginBase'
  }
}

export const ShaderLanguage = {
  GLSL: 0,
  WGSL: 1,
}

export const DirectionalLight = vi.fn().mockImplementation(function (this: Record<string, unknown>) {
  this.intensity = 1
  this.direction = new MockVector3(0, -1, 0)
  return this
})

export const SpotLight = vi.fn()

export const GlowLayer = vi.fn().mockImplementation(function (this: Record<string, unknown>) {
  this.dispose = vi.fn()
  return this
})

export const ParticleSystem = vi.fn().mockImplementation(function (this: Record<string, unknown>) {
  this.dispose = vi.fn()
  return this
})

export const Animation = vi.fn()
export const EasingFunction = vi.fn()
export const ElasticEase = vi.fn()

export const BloomEffect = vi.fn()
export const SSAO2RenderingPipeline = vi.fn()
export const SSRRenderingPipeline = vi.fn()
export const MotionBlurPostProcess = vi.fn()
export const PostProcessRenderPipeline = vi.fn()
export const DepthOfFieldEffectBlurLevel = { Low: 0, Medium: 1, High: 2 }

export const AbstractEngine = Engine
export const BaseTexture = Texture
export const CubeTexture = Texture
export const VideoTexture = Texture
export const ImageProcessingConfiguration = vi.fn()
export const EngineInstrumentation = vi.fn()
export const SceneInstrumentation = vi.fn()
export const LinesMesh = Mesh
export const VertexBuffer = vi.fn()
export const VertexData = { ApplyToMesh: vi.fn() }
export const TmpVectors = { Vector3: [new MockVector3()] }
export const Tools = { RandomGUID: vi.fn(() => 'mock-guid') }

export type MaterialDefines = Record<string, unknown>
export type UniformBuffer = { update: () => void }


export const ShadowGenerator = vi.fn().mockImplementation(function (this: Record<string, unknown>) {
  this.dispose = vi.fn()
  this.addShadowCaster = vi.fn()
  return this
})

export const Plane = MockVector3

export const AssetContainer = vi.fn().mockImplementation(function (this: Record<string, unknown>) {
  this.meshes = []
  this.addAllToScene = vi.fn()
  this.removeAllFromScene = vi.fn()
  this.dispose = vi.fn()
  return this
})

export const SceneLoader = {
  LoadAssetContainerAsync: vi.fn().mockResolvedValue({ meshes: [], addAllToScene: vi.fn(), dispose: vi.fn() }),
}

export const SceneOptimizer = vi.fn().mockImplementation(function (this: Record<string, unknown>) {
  this.start = vi.fn()
  this.stop = vi.fn()
  this.dispose = vi.fn()
  return this
})

export const DefaultRenderingPipeline = vi.fn().mockImplementation(function (this: Record<string, unknown>) {
  this.dispose = vi.fn()
  return this
})

export type Nullable<T> = T | null
