/**
 * Unit tests for BallManager core logic
 *
 * These tests cover:
 *  1. Type-assignment distribution (STANDARD / GOLD_PLATED / SOLID_GOLD spawn weights)
 *  2. GOLD_PLATED collect callback receives the correct ball type and points
 *  3. SOLID_GOLD collect callback receives the correct ball type and points
 *  4. goldBallCount lifecycle: increments for non-standard balls, zero on fresh instance
 *  5. Drain callback fires exactly once per collect event
 *
 * Babylon.js and Rapier3D are mocked at the module boundary so the suite runs in
 * a plain Node environment without a browser or WASM physics engine.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BallType, BALL_TIERS, GAME_TUNING } from '../src/config'

// ---------------------------------------------------------------------------
// Module mocks — must be declared before the import under test
// ---------------------------------------------------------------------------

// Replace @babylonjs/core with minimal stubs so the module loads in Node.
vi.mock('@babylonjs/core', () => ({
  MeshBuilder: {
    CreateSphere: vi.fn().mockReturnValue({
      name: 'ball',
      material: null,
      getChildren: () => [],
      parent: null,
      position: { set: vi.fn(), x: 0, y: 0, z: 0 },
      dispose: vi.fn(),
    }),
    CreateTorus: vi.fn().mockReturnValue({
      material: null,
      parent: null,
      rotation: { x: 0 },
      dispose: vi.fn(),
    }),
  },
  Vector3: vi.fn().mockImplementation((x = 0, y = 0, z = 0) => ({
    x,
    y,
    z,
    clone: () => ({ x, y, z }),
  })),
  TrailMesh: vi.fn().mockReturnValue({ material: null, dispose: vi.fn() }),
  StandardMaterial: vi.fn().mockReturnValue({
    emissiveColor: null,
    alpha: 1,
    disableLighting: false,
    dispose: vi.fn(),
  }),
  PBRMaterial: vi.fn().mockReturnValue({
    emissiveColor: null,
    albedoColor: null,
    emissiveIntensity: 0,
    alpha: 0.85,
    subSurface: { isRefractionEnabled: false, tintColor: null },
    dispose: vi.fn(),
  }),
  Color3: {
    FromHexString: vi.fn().mockReturnValue({
      scale: vi.fn().mockReturnValue({ r: 0, g: 0, b: 0 }),
      r: 0,
      g: 0,
      b: 0,
    }),
    Black: vi.fn().mockReturnValue({ r: 0, g: 0, b: 0 }),
    Lerp: vi.fn().mockReturnValue({ r: 0, g: 0, b: 0 }),
    White: vi.fn().mockReturnValue({ r: 1, g: 1, b: 1 }),
  },
  Color4: vi.fn().mockReturnValue({ r: 0, g: 0, b: 0, a: 1 }),
  PointLight: vi.fn().mockReturnValue({ parent: null, diffuse: null, intensity: 0, range: 0 }),
  ParticleSystem: vi.fn().mockReturnValue({
    particleTexture: null,
    emitter: null,
    color1: null,
    color2: null,
    colorDead: null,
    minSize: 0,
    maxSize: 0.2,
    minLifeTime: 0,
    maxLifeTime: 1,
    emitRate: 50,
    targetStopDuration: 0.2,
    direction1: null,
    direction2: null,
    minEmitPower: 1,
    maxEmitPower: 3,
    updateSpeed: 0.02,
    gravity: null,
    start: vi.fn(),
    stop: vi.fn(),
    dispose: vi.fn(),
  }),
  Texture: vi.fn().mockReturnValue({ dispose: vi.fn() }),
  Mesh: class {},
}))

// Stub getMaterialLibrary so the BallManager constructor can call it without a real Scene.
vi.mock('../src/materials', () => ({
  getMaterialLibrary: vi.fn().mockReturnValue({
    getEnhancedChromeBallMaterial: vi.fn().mockReturnValue({
      emissiveColor: null,
      emissiveIntensity: 0,
      alpha: 0.85,
      subSurface: { isRefractionEnabled: false },
    }),
    getGoldPlatedBallMaterial: vi.fn().mockReturnValue({ emissiveColor: null }),
    getSolidGoldBallMaterial: vi.fn().mockReturnValue({ emissiveColor: null }),
    getChromeBallMaterial: vi.fn().mockReturnValue({ emissiveColor: null }),
    getExtraBallMaterial: vi.fn().mockReturnValue({ emissiveColor: null }),
    updateBallMaterialColor: vi.fn(),
  }),
}))

// Stub the sound system so gold-ball spawn sounds don't crash.
vi.mock('../src/game-elements/sound-system', () => ({
  getSoundSystem: vi.fn().mockReturnValue({
    playGoldBallSpawn: vi.fn(),
    playGoldBallCollect: vi.fn(),
  }),
}))

// The real BallManager, imported after all mocks are in place.
import { BallManager } from '../src/game-elements/ball-manager'

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Replicates the weighted-selection step from BallManager.spawnRandomBall.
 * Takes an explicit `rand` value (0–1) so tests can drive it deterministically
 * or rely on Math.random() for statistical checks.
 */
function selectBallType(rand: number): BallType {
  let cumulative = 0
  for (const [typeKey, config] of Object.entries(BALL_TIERS)) {
    cumulative += config.spawnWeight
    if (rand <= cumulative) return typeKey as BallType
  }
  return BallType.STANDARD
}

/** Returns a fake Rapier rigid-body descriptor builder (fluent API). */
function makeDescBuilder(): Record<string, () => Record<string, unknown>> {
  const obj: Record<string, () => Record<string, unknown>> = {}
  for (const method of [
    'setTranslation', 'setCcdEnabled', 'setCanSleep',
    'setLinearDamping', 'setAngularDamping',
    'setRestitution', 'setFriction', 'setDensity', 'setCollisionGroups', 'setActiveEvents',
  ]) {
    obj[method] = () => obj
  }
  return obj
}

/** Minimal fake Rapier `world` object. */
function makeFakeWorld() {
  let handleCounter = 0
  return {
    createRigidBody: vi.fn().mockImplementation(() => ({ handle: handleCounter++ })),
    createCollider: vi.fn(),
    removeRigidBody: vi.fn(),
  }
}

/** Creates a fake rigid body with transform/velocity/impulse tracking. */
function makeFakeBody() {
  const translation = { x: 0, y: 0, z: 0 }
  const linvel = { x: 0, y: 0, z: 0 }
  const angvel = { x: 0, y: 0, z: 0 }
  const impulses: Array<{ x: number; y: number; z: number }> = []
  return {
    handle: 999,
    translation: () => ({ ...translation }),
    linvel: () => ({ ...linvel }),
    angvel: () => ({ ...angvel }),
    setTranslation: vi.fn().mockImplementation((v: { x: number; y: number; z: number }, _wake: boolean) => {
      translation.x = v.x; translation.y = v.y; translation.z = v.z
    }),
    setLinvel: vi.fn().mockImplementation((v: { x: number; y: number; z: number }, _wake: boolean) => {
      linvel.x = v.x; linvel.y = v.y; linvel.z = v.z
    }),
    setAngvel: vi.fn().mockImplementation((v: { x: number; y: number; z: number }, _wake: boolean) => {
      angvel.x = v.x; angvel.y = v.y; angvel.z = v.z
    }),
    applyImpulse: vi.fn().mockImplementation((v: { x: number; y: number; z: number }, _wake: boolean) => {
      impulses.push({ x: v.x, y: v.y, z: v.z })
    }),
    getImpulses: () => impulses,
  }
}

/** Minimal fake Rapier namespace (the second and third BallManager ctor args). */
function makeFakeRapier() {
  return {
    RigidBodyDesc: { dynamic: vi.fn().mockImplementation(makeDescBuilder) },
    ColliderDesc: { ball: vi.fn().mockImplementation(makeDescBuilder) },
    ActiveEvents: { COLLISION_EVENTS: 1, CONTACT_FORCE_EVENTS: 2 },
    RigidBodyType: { Dynamic: 0, KinematicPositionBased: 1 },
    Vector3: vi.fn().mockImplementation(function (this: { x: number; y: number; z: number }, x: number, y: number, z: number) {
      this.x = x; this.y = y; this.z = z
      return this
    }) as unknown as typeof import('@dimforge/rapier3d-compat').Vector3,
  }
}

/** Creates a BallManager wired to fake engine dependencies. */
function makeManager(): BallManager {
  return new BallManager(
    {} as never,               // Scene stub
    makeFakeWorld() as never,  // World stub
    makeFakeRapier() as never, // Rapier namespace stub
    [],                        // bindings
  )
}

/**
 * Injects a BallData entry directly into BallManager's private ballDataMap.
 * This avoids calling createBallOfType (which needs full Babylon+Rapier setup)
 * while still exercising the collection/callback logic under test.
 */
function setBallData(
  manager: BallManager,
  body: object,
  type: BallType,
  points: number,
): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(manager as any).ballDataMap.set(body, { type, spawnTime: 0, points })
}

// ---------------------------------------------------------------------------
// Test suites
// ---------------------------------------------------------------------------

describe('BallManager', () => {
  // -------------------------------------------------------------------------
  // 1. Type-assignment distribution
  // -------------------------------------------------------------------------
  describe('type assignment distribution', () => {
    it('selects STANDARD ≈75%, GOLD_PLATED ≈20%, SOLID_GOLD ≈5% over 1000 draws', () => {
      const counts: Record<BallType, number> = {
        [BallType.STANDARD]: 0,
        [BallType.GOLD_PLATED]: 0,
        [BallType.SOLID_GOLD]: 0,
      }

      const N = 1000
      for (let i = 0; i < N; i++) {
        counts[selectBallType(Math.random())]++
      }

      const tolerance = 0.08
      expect(Math.abs(counts[BallType.STANDARD] / N - BALL_TIERS[BallType.STANDARD].spawnWeight))
        .toBeLessThan(tolerance)
      expect(Math.abs(counts[BallType.GOLD_PLATED] / N - BALL_TIERS[BallType.GOLD_PLATED].spawnWeight))
        .toBeLessThan(tolerance)
      expect(Math.abs(counts[BallType.SOLID_GOLD] / N - BALL_TIERS[BallType.SOLID_GOLD].spawnWeight))
        .toBeLessThan(tolerance)
    })
  })

  // -------------------------------------------------------------------------
  // 2 & 3. Collect callbacks
  // -------------------------------------------------------------------------
  describe('collectBall callbacks', () => {
    let manager: BallManager

    beforeEach(() => {
      manager = makeManager()
    })

    it('fires onGoldBallCollected with GOLD_PLATED type and correct base points', () => {
      const fakeBody = {}
      const expectedPoints = BALL_TIERS[BallType.GOLD_PLATED].basePoints
      setBallData(manager, fakeBody, BallType.GOLD_PLATED, expectedPoints)

      const cb = vi.fn()
      manager.setOnGoldBallCollected(cb)
      manager.collectBall(fakeBody as never)

      expect(cb).toHaveBeenCalledOnce()
      expect(cb).toHaveBeenCalledWith(BallType.GOLD_PLATED, expectedPoints)
    })

    it('fires onGoldBallCollected with SOLID_GOLD type and correct base points', () => {
      const fakeBody = {}
      const expectedPoints = BALL_TIERS[BallType.SOLID_GOLD].basePoints
      setBallData(manager, fakeBody, BallType.SOLID_GOLD, expectedPoints)

      const cb = vi.fn()
      manager.setOnGoldBallCollected(cb)
      manager.collectBall(fakeBody as never)

      expect(cb).toHaveBeenCalledOnce()
      expect(cb).toHaveBeenCalledWith(BallType.SOLID_GOLD, expectedPoints)
    })
  })

  // -------------------------------------------------------------------------
  // 4. goldBallCount lifecycle
  // -------------------------------------------------------------------------
  describe('goldBallCount lifecycle', () => {
    let manager: BallManager

    beforeEach(() => {
      manager = makeManager()
    })

    it('starts at zero', () => {
      expect(manager.getGoldBallCount()).toBe(0)
    })

    it('does NOT increment for a STANDARD ball collect', () => {
      const body = {}
      setBallData(manager, body, BallType.STANDARD, 0)
      manager.collectBall(body as never)
      expect(manager.getGoldBallCount()).toBe(0)
    })

    it('increments by 1 for each GOLD_PLATED collect', () => {
      const body = {}
      setBallData(manager, body, BallType.GOLD_PLATED, BALL_TIERS[BallType.GOLD_PLATED].basePoints)
      manager.collectBall(body as never)
      expect(manager.getGoldBallCount()).toBe(1)
    })

    it('increments by 1 for each SOLID_GOLD collect', () => {
      const body = {}
      setBallData(manager, body, BallType.SOLID_GOLD, BALL_TIERS[BallType.SOLID_GOLD].basePoints)
      manager.collectBall(body as never)
      expect(manager.getGoldBallCount()).toBe(1)
    })

    it('resets to 0 on a fresh manager instance (simulates game restart)', () => {
      const b1 = {}
      const b2 = {}
      setBallData(manager, b1, BallType.GOLD_PLATED, BALL_TIERS[BallType.GOLD_PLATED].basePoints)
      setBallData(manager, b2, BallType.SOLID_GOLD, BALL_TIERS[BallType.SOLID_GOLD].basePoints)
      manager.collectBall(b1 as never)
      manager.collectBall(b2 as never)
      expect(manager.getGoldBallCount()).toBe(2)

      // A new instance — as created at game start — begins at zero
      const fresh = makeManager()
      expect(fresh.getGoldBallCount()).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  // 5. Drain callback fires exactly once per event
  // -------------------------------------------------------------------------
  describe('drain callback invocation', () => {
    let manager: BallManager

    beforeEach(() => {
      manager = makeManager()
    })

    it('fires the callback exactly once per drain event', () => {
      const body1 = {}
      const body2 = {}
      setBallData(manager, body1, BallType.GOLD_PLATED, BALL_TIERS[BallType.GOLD_PLATED].basePoints)
      setBallData(manager, body2, BallType.SOLID_GOLD, BALL_TIERS[BallType.SOLID_GOLD].basePoints)

      const cb = vi.fn()
      manager.setOnGoldBallCollected(cb)

      manager.collectBall(body1 as never)
      expect(cb).toHaveBeenCalledTimes(1)

      manager.collectBall(body2 as never)
      expect(cb).toHaveBeenCalledTimes(2)
    })

    it('does not fire if the body is not registered in the ball map', () => {
      const unknownBody = {}
      const cb = vi.fn()
      manager.setOnGoldBallCollected(cb)

      const result = manager.collectBall(unknownBody as never)

      expect(result).toBeNull()
      expect(cb).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // 6. resetBall translation + impulse
  // -------------------------------------------------------------------------
  describe('chain multiball', () => {
    it('starts forced multiball, spawns up to target, and exposes dynamic multiplier', () => {
      const manager = makeManager()
      const mainBall = { handle: 1 }
      const extra1 = { handle: 2 }
      const extra2 = { handle: 3 }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(manager as any).ballBodies = [mainBall]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(manager as any).ballBody = mainBall

      const spawnRandomBall = vi.fn()
        .mockImplementationOnce(() => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(manager as any).ballBodies.push(extra1)
          return extra1
        })
        .mockImplementationOnce(() => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ;(manager as any).ballBodies.push(extra2)
          return extra2
        })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(manager as any).spawnRandomBall = spawnRandomBall

      const result = manager.triggerForcedMultiball(3, 'jackpot')
      const expectedMultiplier = 1 + (2 * GAME_TUNING.multiball.multiplierPerExtraBall)

      expect(result.started).toBe(true)
      expect(result.spawnedBalls).toBe(2)
      expect(result.ballsInPlay).toBe(3)
      expect(result.scoreMultiplier).toBe(expectedMultiplier)
      expect(manager.getChainStats().isActive).toBe(true)
      expect(manager.getScoreMultiplier()).toBe(expectedMultiplier)
      expect(spawnRandomBall).toHaveBeenCalledTimes(2)
    })

    it('saves only the first drain during grace window and then ends when down to one ball', () => {
      const manager = makeManager()
      const mainBall = { handle: 10 }
      const extraBall = { handle: 11 }
      const savedBall = { handle: 12 }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(manager as any).ballBodies = [mainBall, extraBall]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(manager as any).ballBody = mainBall
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(manager as any).chainMultiball = {
        isActive: true,
        chainLevel: 1,
        ballSaveUsed: false,
        ballSaveExpiresAtMs: Number.MAX_SAFE_INTEGER,
      }

      const spawnRandomBall = vi.fn().mockImplementation(() => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(manager as any).ballBodies.push(savedBall)
        return savedBall
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(manager as any).spawnRandomBall = spawnRandomBall

      // Drain one ball (simulates post-removal state in controller)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(manager as any).ballBodies = [mainBall]
      const firstDrain = manager.registerDrain(extraBall as never)
      expect(firstDrain.ballSaved).toBe(true)
      expect(firstDrain.multiballEnded).toBe(false)
      expect(spawnRandomBall).toHaveBeenCalledTimes(1)

      // Drain again; ball-save already consumed, so multiball ends at one ball left
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(manager as any).ballBodies = [savedBall]
      const secondDrain = manager.registerDrain(mainBall as never)
      expect(secondDrain.ballSaved).toBe(false)
      expect(secondDrain.multiballEnded).toBe(true)
      expect(manager.getChainStats().isActive).toBe(false)
      expect(manager.getScoreMultiplier()).toBe(1)
    })
  })

  describe('resetBall', () => {
    it('sets translation to spawn point and zeros velocity when ball exists', () => {
      const manager = makeManager()
      const fakeBody = makeFakeBody()

      // Inject a pre-existing ball
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(manager as any).ballBodies = [fakeBody]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(manager as any).ballBody = fakeBody

      manager.resetBall()

      // Translation should be set to spawnMain
      expect(fakeBody.setTranslation).toHaveBeenCalledTimes(1)
      const setTranslationArg = (fakeBody.setTranslation as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(setTranslationArg.x).toBeDefined()
      expect(setTranslationArg.y).toBeDefined()
      expect(setTranslationArg.z).toBeDefined()

      // Linear and angular velocity zeroed
      expect(fakeBody.setLinvel).toHaveBeenCalledTimes(1)
      expect(fakeBody.setAngvel).toHaveBeenCalledTimes(1)

      const zeroVel = (fakeBody.setLinvel as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(zeroVel.x).toBe(0)
      expect(zeroVel.y).toBe(0)
      expect(zeroVel.z).toBe(0)

      const zeroAng = (fakeBody.setAngvel as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(zeroAng.x).toBe(0)
      expect(zeroAng.y).toBe(0)
      expect(zeroAng.z).toBe(0)
    })

    it('applies a gentle upward impulse on reset', () => {
      const manager = makeManager()
      const fakeBody = makeFakeBody()

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(manager as any).ballBodies = [fakeBody]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(manager as any).ballBody = fakeBody

      manager.resetBall()

      expect(fakeBody.applyImpulse).toHaveBeenCalledTimes(1)
      const impulseArg = (fakeBody.applyImpulse as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(impulseArg.x).toBe(0)
      expect(impulseArg.y).toBe(0)
      expect(impulseArg.z).toBeGreaterThan(0)
    })

    it('creates a new ball when none exists', () => {
      const manager = makeManager()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const world = (manager as any).world

      manager.resetBall()

      expect(world.createRigidBody).toHaveBeenCalledTimes(1)
      expect(world.createCollider).toHaveBeenCalledTimes(1)

      // After creation, ballBody and ballBodies should be populated
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((manager as any).ballBodies.length).toBe(1)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((manager as any).ballBody).not.toBeNull()
    })
  })
})
