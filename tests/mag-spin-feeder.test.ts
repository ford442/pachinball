/**
 * Unit tests for MagSpinFeeder state machine and release logic.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { GameConfig } from '../src/config'
import { MagSpinFeeder, MagSpinState } from '../src/game-elements/mag-spin-feeder'

vi.mock('@babylonjs/core', () => {
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
  }

  return {
    Mesh: { NO_CAP: 0 },
    MeshBuilder: {
      CreateCylinder: vi.fn().mockReturnValue({ position: new MockVector3(), material: null }),
      CreateTorus: vi.fn().mockReturnValue({
        position: new MockVector3(),
        rotation: { y: 0 },
        material: null,
      }),
    },
    Vector3: MockVector3,
    StandardMaterial: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
      this.emissiveColor = null
      this.diffuseColor = null
      this.backFaceCulling = true
      return this
    }),
    Color3: {
      Black: vi.fn().mockReturnValue({ r: 0, g: 0, b: 0 }),
      Gray: vi.fn().mockReturnValue({ r: 0.5, g: 0.5, b: 0.5 }),
      FromHexString: vi.fn().mockReturnValue({ r: 0, g: 1, b: 1, scale: () => ({ r: 0, g: 1, b: 1 }) }),
    },
    Scalar: {
      Lerp: (a: number, b: number, t: number) => a + (b - a) * t,
    },
    PointLight: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
      this.diffuse = null
      this.intensity = 0
      this.range = 0
      return this
    }),
    Quaternion: {
      FromEulerAngles: vi.fn().mockReturnValue({ x: 0, y: 0, z: 0, w: 1 }),
    },
  }
})

vi.mock('../src/game-elements/visual-language', () => ({
  color: (_hex: string) => ({ r: 0, g: 1, b: 1, scale: () => ({ r: 0, g: 1, b: 1 }) }),
  emissive: () => ({ r: 0, g: 0.5, b: 1 }),
  FEEDER_STYLES: {
    MAG_SPIN: {
      base: '#00aaff',
      active: '#00ffff',
      locked: '#aa00ff',
      release: '#ff00aa',
    },
  },
  INTENSITY: { LOW: 0.3, FLASH: 1.0 },
}))

function createMockBall(pos: { x: number; y: number; z: number }) {
  let position = { ...pos }
  let bodyType = 'Dynamic'
  const linvel = { x: 0, y: 0, y2: 0, z: 0 }
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
    applyImpulse: vi.fn(),
    getBodyType: () => bodyType,
  }
}

function createMockWorld() {
  const colliders: unknown[] = []
  return {
    createRigidBody: vi.fn().mockReturnValue({}),
    createCollider: vi.fn((desc: unknown) => {
      colliders.push(desc)
    }),
    colliders,
  }
}

function createMockRapier() {
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
      cylinder: vi.fn().mockReturnValue({ setTranslation: vi.fn().mockReturnThis() }),
      cuboid: vi.fn().mockReturnValue({
        setTranslation: vi.fn().mockReturnThis(),
        setRotation: vi.fn().mockReturnThis(),
      }),
    },
  }
}

describe('MagSpinFeeder', () => {
  let feeder: MagSpinFeeder
  let world: ReturnType<typeof createMockWorld>
  let rapier: ReturnType<typeof createMockRapier>

  beforeEach(() => {
    world = createMockWorld()
    rapier = createMockRapier()
    feeder = new MagSpinFeeder({} as never, world as never, rapier as never, GameConfig.magSpin)
  })

  it('starts in IDLE state with configured catch radius', () => {
    expect(feeder.getState()).toBe(MagSpinState.IDLE)
    expect(feeder.getCatchRadius()).toBe(1.5)
  })

  it('captures ball within catch radius and transitions through CATCH → SPIN → RELEASE → COOLDOWN', () => {
    const states: MagSpinState[] = []
    feeder.onStateChange = (state) => states.push(state)

    const ball = createMockBall({ x: 9.5, y: 0.5, z: 12.2 })
    feeder.update(1 / 60, [ball as never])

    expect(feeder.getState()).toBe(MagSpinState.CATCH)
    expect(ball.setBodyType).toHaveBeenCalledWith('KinematicPositionBased', true)

    for (let i = 0; i < 120; i++) {
      feeder.update(1 / 60, [ball as never])
    }
    expect(states).toContain(MagSpinState.SPIN)

    for (let i = 0; i < Math.ceil(GameConfig.magSpin.spinDuration * 60) + 5; i++) {
      feeder.update(1 / 60, [ball as never])
    }

    expect(states).toContain(MagSpinState.RELEASE)
    expect(states).toContain(MagSpinState.COOLDOWN)
    expect(ball.applyImpulse).toHaveBeenCalled()
    expect(ball.setBodyType).toHaveBeenLastCalledWith('Dynamic', true)
  })

  it('does not capture ball outside catch radius during IDLE', () => {
    const ball = createMockBall({ x: 20, y: 0.5, z: 20 })
    feeder.update(1 / 60, [ball as never])
    expect(feeder.getState()).toBe(MagSpinState.IDLE)
    expect(ball.setBodyType).not.toHaveBeenCalled()
  })

  it('ignores balls during COOLDOWN', () => {
    feeder.onStateChange = null
    const ball = createMockBall({ x: 9.5, y: 0.5, z: 12.2 })

    feeder.update(1 / 60, [ball as never])
    for (let i = 0; i < 200; i++) feeder.update(1 / 60, [ball as never])

    expect(feeder.getState()).toBe(MagSpinState.COOLDOWN)

    const secondBall = createMockBall({ x: 9.4, y: 0.5, z: 12.1 })
    feeder.update(1 / 60, [secondBall as never])
    expect(secondBall.setBodyType).not.toHaveBeenCalled()
  })

  it('applies release impulse toward configured target with variance', () => {
    const impulses: Array<{ x: number; y: number; z: number }> = []
    for (let trial = 0; trial < 8; trial++) {
      const f = new MagSpinFeeder({} as never, createMockWorld() as never, rapier as never, GameConfig.magSpin)
      const ball = createMockBall({ x: 9.25, y: 0.5, z: 12 })
      f.update(1 / 60, [ball as never])
      for (let i = 0; i < 200; i++) f.update(1 / 60, [ball as never])
      const call = (ball.applyImpulse as ReturnType<typeof vi.fn>).mock.calls.at(-1)
      if (call) impulses.push(call[0])
    }

    expect(impulses.length).toBeGreaterThan(0)
    for (const imp of impulses) {
      expect(imp.x).toBeLessThan(0)
      expect(imp.z).toBeLessThan(0)
    }
    const xs = new Set(impulses.map((i) => i.x.toFixed(2)))
    expect(xs.size).toBeGreaterThan(1)
  })
})
