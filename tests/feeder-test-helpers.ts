import { vi } from 'vitest'

export function createMockBall(pos: { x: number; y: number; z: number }) {
  let position = { ...pos }
  let bodyType = 'Dynamic'
  const linvel = { x: 0, y: 0, z: 0 }
  return {
    translation: () => ({ ...position }),
    setBodyType: vi.fn((type: string) => {
      bodyType = type
    }),
    setLinvel: vi.fn((v: { x: number; y: number; z: number }) => {
      linvel.x = v.x
      linvel.y = v.y
      linvel.z = v.z
    }),
    setAngvel: vi.fn(),
    setNextKinematicTranslation: vi.fn((p: { x: number; y: number; z: number }) => {
      position = { ...p }
    }),
    setNextKinematicRotation: vi.fn(),
    setTranslation: vi.fn((p: { x: number; y: number; z: number }) => {
      position = { ...p }
    }),
    applyImpulse: vi.fn(),
    collider: vi.fn(() => 1),
    getBodyType: () => bodyType,
  }
}

export function createMockWorld(opts?: { intersectionPair?: boolean }) {
  const colliders: unknown[] = []
  return {
    createRigidBody: vi.fn().mockReturnValue({
      collider: vi.fn(() => 0),
    }),
    createCollider: vi.fn((desc: unknown) => {
      colliders.push(desc)
    }),
    intersectionPair: vi.fn(() => opts?.intersectionPair ?? false),
    colliders,
  }
}

export function createMockRapier() {
  return {
    RigidBodyDesc: {
      fixed: vi.fn().mockReturnValue({
        setTranslation: vi.fn().mockReturnThis(),
      }),
    },
    RigidBodyType: {
      Dynamic: 'Dynamic',
      KinematicPositionBased: 'KinematicPositionBased',
    },
    ColliderDesc: {
      ball: vi.fn().mockReturnValue({
        setSensor: vi.fn().mockReturnThis(),
        setActiveEvents: vi.fn().mockReturnThis(),
      }),
      cylinder: vi.fn().mockReturnValue({
        setTranslation: vi.fn().mockReturnThis(),
        setRotation: vi.fn().mockReturnThis(),
        setRestitution: vi.fn().mockReturnThis(),
        setSensor: vi.fn().mockReturnThis(),
        setActiveEvents: vi.fn().mockReturnThis(),
      }),
      cuboid: vi.fn().mockReturnValue({
        setTranslation: vi.fn().mockReturnThis(),
        setRotation: vi.fn().mockReturnThis(),
      }),
    },
    ActiveEvents: {
      COLLISION_EVENTS: 1,
    },
  }
}

export function mockBabylonCore() {
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
    scale(s: number) {
      return new MockVector3(this.x * s, this.y * s, this.z * s)
    }
    normalize() {
      const len = Math.sqrt(this.x ** 2 + this.y ** 2 + this.z ** 2) || 1
      return new MockVector3(this.x / len, this.y / len, this.z / len)
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
  }

  return {
    Mesh: { NO_CAP: 0 },
    TransformNode: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
      this.position = new MockVector3()
      this.rotation = { y: 0, x: 0, z: 0 }
      this.getChildren = vi.fn(() => [])
      return this
    }),
    MeshBuilder: {
      CreateCylinder: vi.fn().mockReturnValue({
        position: new MockVector3(),
        rotation: { y: 0, x: 0, z: 0 },
        material: null,
        parent: null,
        scaling: { setAll: vi.fn(), x: 1, y: 1, z: 1 },
        getChildren: vi.fn(() => []),
        bakeTransformIntoVertices: vi.fn(),
      }),
      CreateTorus: vi.fn().mockReturnValue({
        position: new MockVector3(),
        rotation: { y: 0, z: 0 },
        material: null,
        parent: null,
        scaling: { setAll: vi.fn(), x: 1, y: 1, z: 1 },
        getChildren: vi.fn(() => []),
      }),
      CreateBox: vi.fn().mockReturnValue({ position: new MockVector3(), material: null }),
      CreatePolyhedron: vi.fn().mockReturnValue({
        position: new MockVector3(),
        rotation: { y: 0, x: 0, z: 0 },
        material: null,
        scaling: { y: 1, x: 1, z: 1, setAll: vi.fn() },
      }),
      CreateDisc: vi.fn().mockReturnValue({ rotation: { y: 0 }, material: null, parent: null }),
      CreateSphere: vi.fn().mockReturnValue({
        position: new MockVector3(),
        material: null,
        scaling: { setAll: vi.fn(), y: 1, x: 1, z: 1 },
        dispose: vi.fn(),
      }),
    },
    Vector3: MockVector3,
    StandardMaterial: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
      this.emissiveColor = null
      this.diffuseColor = null
      this.alpha = 1
      this.backFaceCulling = true
      this.wireframe = false
      return this
    }),
    Color3: Object.assign(MockColor3, {
      Black: vi.fn().mockReturnValue(new MockColor3(0, 0, 0)),
      White: vi.fn().mockReturnValue(new MockColor3(1, 1, 1)),
      Green: vi.fn().mockReturnValue(new MockColor3(0, 1, 0)),
      Yellow: vi.fn().mockReturnValue(new MockColor3(1, 1, 0)),
      Red: vi.fn().mockReturnValue(new MockColor3(1, 0, 0)),
      Blue: vi.fn().mockReturnValue(new MockColor3(0, 0, 1)),
      Gray: vi.fn().mockReturnValue(new MockColor3(0.5, 0.5, 0.5)),
      FromHexString: vi.fn().mockReturnValue(new MockColor3(0, 1, 1)),
      Lerp: (a: MockColor3, b: MockColor3, t: number) => (t < 0.5 ? a : b),
    }),
    Scalar: {
      Lerp: (a: number, b: number, t: number) => a + (b - a) * t,
    },
    PointLight: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
      this.diffuse = null
      this.intensity = 0
      this.range = 0
      this.parent = null
      return this
    }),
    Quaternion: {
      FromEulerAngles: vi.fn().mockReturnValue({ x: 0, y: 0, z: 0, w: 1 }),
    },
    Matrix: {
      Translation: vi.fn().mockReturnValue({}),
    },
  }
}
