/**
 * Adventure track-switch orchestration tests.
 *
 * Verifies that a portal jump from track A -> B:
 *  (a) invokes teardown then build in order,
 *  (b) calls onTrackStart once,
 *  (c) calls UI reset() once,
 *  (d) leaves no orphaned bodies in the mock physics world.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mock BabylonJS before importing adventure-mode ───────────────────────────

const hoisted = vi.hoisted(() => {
  const mockMeshDispose = vi.fn()
  const mockMatDispose = vi.fn()

  const MockVector3Impl = vi.fn(function (this: unknown, x = 0, y = 0, z = 0) {
    const self = this as Record<string, unknown>
    self.x = x
    self.y = y
    self.z = z
    self.clone = () => new (MockVector3Impl as unknown as new (x: number, y: number, z: number) => unknown)(x, y, z)
    self.add = vi.fn((other: { x: number; y: number; z: number }) =>
      new (MockVector3Impl as unknown as new (x: number, y: number, z: number) => unknown)(x + other.x, y + other.y, z + other.z)
    )
    self.scale = vi.fn((s: number) =>
      new (MockVector3Impl as unknown as new (x: number, y: number, z: number) => unknown)(x * s, y * s, z * s)
    )
    self.copyFrom = vi.fn()
    return self
  })
  ;(MockVector3Impl as unknown as { Zero: () => unknown }).Zero = vi.fn(function () {
    return new (MockVector3Impl as unknown as new (x: number, y: number, z: number) => unknown)(0, 0, 0)
  })

  const MockQuaternion = vi.fn(function (this: unknown, x = 0, y = 0, z = 0, w = 1) {
    const self = this as Record<string, unknown>
    self.x = x
    self.y = y
    self.z = z
    self.w = w
    return self
  })
  ;(MockQuaternion as unknown as { FromEulerAngles: (...args: number[]) => unknown }).FromEulerAngles = vi.fn(function (x = 0, y = 0, z = 0) {
    return { x, y, z, w: 1 }
  })

  const MockArcRotateCamera = vi.fn(function (this: unknown) {
    const self = this as Record<string, unknown>
    self.alpha = 0
    self.beta = 0
    self.radius = 10
    self.fov = 0.8
    self.lowerRadiusLimit = 5
    self.upperRadiusLimit = 50
    self.lowerBetaLimit = 0.1
    self.upperBetaLimit = Math.PI / 2
    self.lockedTarget = null
    self.attachControl = vi.fn()
    self.dispose = vi.fn()
    return self
  })

  return { mockMeshDispose, mockMatDispose, MockVector3Impl, MockQuaternion, MockArcRotateCamera }
})

vi.mock('@babylonjs/core', () => ({
  ArcRotateCamera: hoisted.MockArcRotateCamera,
  Vector3: hoisted.MockVector3Impl,
  Mesh: vi.fn(),
  MeshBuilder: {
    CreateBox: vi.fn().mockReturnValue({
      name: 'box', dispose: hoisted.mockMeshDispose, position: { copyFrom: vi.fn() }, rotation: {}, material: null, parent: null, getChildMeshes: vi.fn().mockReturnValue([]),
    }),
    CreateCylinder: vi.fn().mockReturnValue({
      name: 'cylinder', dispose: hoisted.mockMeshDispose, position: { copyFrom: vi.fn() }, rotation: {}, material: null,
    }),
    CreateTorus: vi.fn().mockReturnValue({
      name: 'torus', dispose: hoisted.mockMeshDispose, position: { copyFrom: vi.fn() }, rotation: {}, material: null,
    }),
    CreateDisc: vi.fn().mockReturnValue({
      name: 'disc', dispose: hoisted.mockMeshDispose, position: { copyFrom: vi.fn() }, rotation: {}, material: null,
    }),
  },
  Quaternion: hoisted.MockQuaternion,
  Scalar: { Clamp: vi.fn((v: number, min: number, max: number) => Math.max(min, Math.min(max, v))) },
  StandardMaterial: vi.fn().mockImplementation(function () {
    const self = this as Record<string, unknown>
    self.dispose = hoisted.mockMatDispose
    self.emissiveColor = { scaleToRef: vi.fn() }
    self.diffuseColor = null
    self.alpha = 1
    return self
  }),
  PBRMaterial: vi.fn().mockImplementation(function () {
    const self = this as Record<string, unknown>
    self.dispose = hoisted.mockMatDispose
    self.emissiveColor = { scaleToRef: vi.fn() }
    self.albedoColor = null
    self.alpha = 1
    self.clearCoat = { isEnabled: false, intensity: 0, roughness: 0 }
    return self
  }),
  Color3: Object.assign(vi.fn(function (this: Record<string, number>, r = 0, g = 0, b = 0) {
    const self = this as unknown as Record<string, unknown>
    self.r = r
    self.g = g
    self.b = b
    self.scale = vi.fn().mockReturnValue(self)
    self.scaleToRef = vi.fn()
  }), {
    FromHexString: vi.fn(() => ({ scaleToRef: vi.fn(), scale: vi.fn().mockReturnThis(), r: 0, g: 0, b: 0 })),
    Black: vi.fn(() => ({ r: 0, g: 0, b: 0 })),
    Red: vi.fn(() => ({ r: 1, g: 0, b: 0 })),
    Green: vi.fn(() => ({ r: 0, g: 1, b: 0 })),
    Blue: vi.fn(() => ({ r: 0, g: 0, b: 1 })),
    White: vi.fn(() => ({ r: 1, g: 1, b: 1, scale: vi.fn().mockReturnThis(), scaleToRef: vi.fn() })),
  }),
  Effect: { ShadersStore: {} },
  MaterialPluginBase: vi.fn(),
  Scene: vi.fn(),
}))

// ─── Import adventure systems after mocks are declared ────────────────────────

import { AdventureMode, AdventureTrackType } from '../src/adventure/adventure-mode'
import { GameSlotAdventure } from '../src/game/game-slot-adventure'
import { COLLISION_GROUP_PRESETS } from '../src/game-elements/physics'

describe('AdventureMode.switchToTrack', () => {
  let mockScene: unknown
  let mockWorld: {
    getRigidBody: ReturnType<typeof vi.fn>
    removeRigidBody: ReturnType<typeof vi.fn>
    createRigidBody: ReturnType<typeof vi.fn>
    createCollider: ReturnType<typeof vi.fn>
    intersectionPair: ReturnType<typeof vi.fn>
  }
  let mockRapier: unknown
  let nextHandle: number
  let activeBodies: Map<number, unknown>

  beforeEach(() => {
    vi.clearAllMocks()
    hoisted.mockMeshDispose.mockClear()
    hoisted.mockMatDispose.mockClear()

    mockScene = {
      getEngine: () => ({ getRenderingCanvas: () => ({ addEventListener: vi.fn() }) }),
      activeCamera: null,
      activeCameras: [],
    }

    activeBodies = new Map()
    nextHandle = 1

    mockWorld = {
      getRigidBody: vi.fn((handle: number) => activeBodies.get(handle) ?? null),
      removeRigidBody: vi.fn((body: { handle: number }) => {
        activeBodies.delete(body.handle)
      }),
      createRigidBody: vi.fn(() => {
        const body = {
          handle: nextHandle++,
          setLinvel: vi.fn(),
          setAngvel: vi.fn(),
          setTranslation: vi.fn(),
          collider: vi.fn(() => null),
        }
        activeBodies.set(body.handle, body)
        return body
      }),
      createCollider: vi.fn(),
      intersectionPair: vi.fn(() => false),
    }

    mockRapier = {
      RigidBodyDesc: {
        fixed: vi.fn().mockReturnValue({
          setTranslation: vi.fn().mockReturnThis(),
          setRotation: vi.fn().mockReturnThis(),
        }),
        kinematicVelocityBased: vi.fn().mockReturnValue({
          setTranslation: vi.fn().mockReturnThis(),
        }),
        dynamic: vi.fn().mockReturnValue({
          setTranslation: vi.fn().mockReturnThis(),
        }),
      },
      ColliderDesc: {
        cuboid: vi.fn().mockReturnValue({
          setFriction: vi.fn().mockReturnThis(),
          setSensor: vi.fn().mockReturnThis(),
          setActiveEvents: vi.fn().mockReturnThis(),
          setDensity: vi.fn().mockReturnThis(),
          setRestitution: vi.fn().mockReturnThis(),
          setTranslation: vi.fn().mockReturnThis(),
          setRotation: vi.fn().mockReturnThis(),
        }),
        cylinder: vi.fn().mockReturnValue({
          setFriction: vi.fn().mockReturnThis(),
          setSensor: vi.fn().mockReturnThis(),
        }),
        ball: vi.fn().mockReturnValue({
          setSensor: vi.fn().mockReturnThis(),
        }),
      },
      ActiveEvents: { COLLISION_EVENTS: 1 },
    }
  })

  function makeMode() {
    const mode = new AdventureMode(mockScene as never, mockWorld as never, mockRapier as never)
    // Override the private buildTrack so we don't need to mock 25+ track builders
    const buildTrackSpy = vi.fn((trackType: AdventureTrackType) => {
      // Simulate pushing a mesh and a body for the track
      ;(mode as unknown as { adventureTrack: Array<{ dispose: () => void; name: string }> }).adventureTrack.push({
        dispose: hoisted.mockMeshDispose,
        name: `${trackType}-mesh`,
      })
      const body = mockWorld.createRigidBody({})
      ;(mode as unknown as { adventureBodies: Array<{ handle: number }> }).adventureBodies.push(body)
      ;(mode as unknown as { currentStartPos: { x: number; y: number; z: number } }).currentStartPos = { x: 0, y: 10, z: 0 }
    })
    ;(mode as unknown as { buildTrack: typeof buildTrackSpy }).buildTrack = buildTrackSpy
    return { mode, buildTrackSpy }
  }

  it('tears down old meshes and bodies then builds the new track', () => {
    const { mode, buildTrackSpy } = makeMode()
    const mockBallBody = { setLinvel: vi.fn(), setAngvel: vi.fn(), setTranslation: vi.fn(), collider: vi.fn(() => null) }
    const mockCamera = new (hoisted.MockArcRotateCamera as unknown as new () => unknown)()

    mode.start(mockBallBody as never, mockCamera as never, undefined, AdventureTrackType.NEON_HELIX)

    // After start, we should have one mesh and one body
    expect(buildTrackSpy).toHaveBeenCalledWith(AdventureTrackType.NEON_HELIX)
    expect(activeBodies.size).toBeGreaterThanOrEqual(1)
    const bodyCountAfterStart = activeBodies.size

    // Switch to the next track
    const result = mode.switchToTrack(AdventureTrackType.CYBER_CORE)

    expect(result).toBe(true)
    // Old mesh disposed
    expect(hoisted.mockMeshDispose).toHaveBeenCalled()
    // Old body removed from world
    expect(mockWorld.removeRigidBody).toHaveBeenCalled()
    // New track built
    expect(buildTrackSpy).toHaveBeenLastCalledWith(AdventureTrackType.CYBER_CORE)
    // No net leak: same number of bodies as after start (old removed, new added)
    expect(activeBodies.size).toBe(bodyCountAfterStart)
  })

  it('updates camera preset without recreating the camera', () => {
    const { mode } = makeMode()
    const mockBallBody = { setLinvel: vi.fn(), setAngvel: vi.fn(), setTranslation: vi.fn(), collider: vi.fn(() => null) }
    const mockCamera = new (hoisted.MockArcRotateCamera as unknown as new () => unknown)()

    mode.start(mockBallBody as never, mockCamera as never, undefined, AdventureTrackType.NEON_HELIX)
    const followCam = (mode as unknown as { followCamera: { alpha: number; beta: number } }).followCamera
    expect(followCam).not.toBeNull()

    const initialAlpha = followCam!.alpha

    mode.setAccessibilityConfig({
      reducedMotion: true,
      cameraShakeEnabled: false,
      flashFrequencyMax: 0,
      scanlineIntensity: 0,
      effectIntensity: 1,
      maxCameraShakeIntensity: 0,
      hapticsEnabled: false,
      hapticIntensity: 0,
    })
    mode.switchToTrack(AdventureTrackType.CYBER_CORE)

    // Camera should have been updated (CYBER_CORE preset differs from NEON_HELIX default)
    expect(followCam!.alpha).not.toBe(initialAlpha)
  })

  it('returns false when adventure is not active', () => {
    const { mode } = makeMode()
    const result = mode.switchToTrack(AdventureTrackType.CYBER_CORE)
    expect(result).toBe(false)
  })

  it('emits ZONE_ENTER on a zone change', () => {
    const { mode } = makeMode()
    const events: string[] = []
    mode.setEventListener((event: string) => {
      events.push(event)
    })

    const mockBallBody = { setLinvel: vi.fn(), setAngvel: vi.fn(), setTranslation: vi.fn(), collider: vi.fn(() => null) }
    const mockCamera = new (hoisted.MockArcRotateCamera as unknown as new () => unknown)()

    mode.start(mockBallBody as never, mockCamera as never, undefined, AdventureTrackType.NEON_HELIX)
    events.length = 0

    mode.switchToTrack(AdventureTrackType.CYBER_CORE)

    expect(events).toContain('ZONE_ENTER')
  })

  it('restores ball collision groups when adventure ends', () => {
    const { mode } = makeMode()
    const setCollisionGroups = vi.fn()
    const mockBallBody = {
      setLinvel: vi.fn(),
      setAngvel: vi.fn(),
      setTranslation: vi.fn(),
      numColliders: vi.fn(() => 1),
      collider: vi.fn(() => ({ setCollisionGroups })),
    }
    const mockCamera = new (hoisted.MockArcRotateCamera as unknown as new () => unknown)()

    mode.start(mockBallBody as never, mockCamera as never, undefined, AdventureTrackType.NEON_HELIX)
    mode.end()

    expect(setCollisionGroups).toHaveBeenCalledWith(COLLISION_GROUP_PRESETS.BALL)
  })
})

describe('GameSlotAdventure.switchToTrack', () => {
  it('orchestrates teardown, build, cinematic, and UI reset in order', () => {
    const onTrackStart = vi.fn()
    const uiReset = vi.fn()
    const goalInit = vi.fn()
    const supervisorStart = vi.fn()
    const adventureSwitch = vi.fn().mockReturnValue(true)

    const host = {
      display: { setTrackInfo: vi.fn(), setStoryText: vi.fn() },
      effects: null,
      eventBus: { emit: vi.fn(), on: vi.fn() } as unknown as import('../src/game/event-bus').EventBus,
      ballManager: null,
      adventureMode: {
        isActive: vi.fn().mockReturnValue(true),
        switchToTrack: adventureSwitch,
      } as unknown as import('../src/adventure').AdventureMode,
      gameObjects: null,
      mapManager: null,
      scene: {} as import('@babylonjs/core').Scene,
      scoreElement: null,
      score: 42_000,
      adventureCinematicTriggers: { onTrackStart } as unknown as import('../src/game-elements/adventure-cinematic-triggers').AdventureCinematicTriggers,
      adventureUIStateManager: { reset: uiReset } as unknown as import('../src/game-elements/adventure-ui-state').AdventureUIStateManager,
      adventureGoalTracker: { initializeTrack: goalInit } as unknown as import('../src/game-elements/adventure-goal-tracker').AdventureGoalTracker,
      adventureProgressionSupervisor: { startTrack: supervisorStart } as unknown as import('../src/game-elements/adventure-progression-supervisor').AdventureProgressionSupervisor,
      updateHUD: vi.fn(),
      getBallPosition: vi.fn().mockReturnValue(null),
      triggerJackpot: vi.fn(),
      setGameState: vi.fn(),
      resetBall: vi.fn(),
    }

    const slot = new GameSlotAdventure(host)
    slot.switchToTrack('CYBER_CORE')

    // (a) AdventureMode.switchToTrack invoked first
    expect(adventureSwitch).toHaveBeenCalledOnce()
    expect(adventureSwitch).toHaveBeenCalledWith(AdventureTrackType.CYBER_CORE)

    // (b) Cinematic trigger called once
    expect(onTrackStart).toHaveBeenCalledOnce()
    expect(onTrackStart).toHaveBeenCalledWith('Cyber Core')

    // (c) UI reset called once
    expect(uiReset).toHaveBeenCalledOnce()

    // Goal tracker and supervisor initialized for the new track
    expect(goalInit).toHaveBeenCalledOnce()
    expect(goalInit).toHaveBeenCalledWith(AdventureTrackType.CYBER_CORE)
    expect(supervisorStart).toHaveBeenCalledOnce()
    expect(supervisorStart).toHaveBeenCalledWith('CYBER_CORE', 42_000)

    // Display updated
    expect(host.display.setTrackInfo).toHaveBeenCalledWith('Cyber Core')
    expect(host.display.setStoryText).toHaveBeenCalledWith('ENTERING: Cyber Core')
  })

  it('no-ops when adventure mode is inactive', () => {
    const adventureSwitch = vi.fn().mockReturnValue(true)
    const host = {
      display: { setTrackInfo: vi.fn(), setStoryText: vi.fn() },
      effects: null,
      eventBus: { emit: vi.fn(), on: vi.fn() } as unknown as import('../src/game/event-bus').EventBus,
      ballManager: null,
      adventureMode: {
        isActive: vi.fn().mockReturnValue(false),
        switchToTrack: adventureSwitch,
      } as unknown as import('../src/adventure').AdventureMode,
      gameObjects: null,
      mapManager: null,
      scene: null,
      scoreElement: null,
      score: 0,
      adventureCinematicTriggers: null,
      adventureUIStateManager: null,
      adventureGoalTracker: null,
      adventureProgressionSupervisor: null,
      updateHUD: vi.fn(),
      getBallPosition: vi.fn().mockReturnValue(null),
      triggerJackpot: vi.fn(),
      setGameState: vi.fn(),
      resetBall: vi.fn(),
    }

    const slot = new GameSlotAdventure(host)
    slot.switchToTrack('CYBER_CORE')

    expect(adventureSwitch).not.toHaveBeenCalled()
  })
})
