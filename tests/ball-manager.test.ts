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
import { BallType, BALL_TIERS, GAME_TUNING, GameConfig } from '../src/config'

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
  Vector3: vi.fn().mockImplementation(function (this: Record<string, unknown>, x = 0, y = 0, z = 0) {
    this.x = x
    this.y = y
    this.z = z
    this.clone = () => ({ x, y, z })
    return this
  }),
  TrailMesh: vi.fn().mockImplementation(function (this: { material: unknown; dispose: () => void }) {
    this.material = null
    this.dispose = vi.fn()
    return this
  }),
  StandardMaterial: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.emissiveColor = null
    this.alpha = 1
    this.disableLighting = false
    this.dispose = vi.fn()
    return this
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
  Color4: vi.fn().mockImplementation(function (this: Record<string, unknown>, r = 0, g = 0, b = 0, a = 1) {
    this.r = r
    this.g = g
    this.b = b
    this.a = a
    return this
  }),
  PointLight: vi.fn().mockReturnValue({ parent: null, diffuse: null, intensity: 0, range: 0 }),
  ParticleSystem: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.particleTexture = null
    this.emitter = null
    this.color1 = null
    this.color2 = null
    this.colorDead = null
    this.minSize = 0
    this.maxSize = 0.2
    this.minLifeTime = 0
    this.maxLifeTime = 1
    this.emitRate = 50
    this.targetStopDuration = 0.2
    this.direction1 = null
    this.direction2 = null
    this.minEmitPower = 1
    this.maxEmitPower = 3
    this.updateSpeed = 0.02
    this.gravity = null
    this.start = vi.fn()
    this.stop = vi.fn()
    this.dispose = vi.fn()
    return this
  }),
  Texture: vi.fn().mockImplementation(function (this: Record<string, unknown>) {
    this.dispose = vi.fn()
    return this
  }),
  Mesh: class {},
}))

// Minimal `document.createElement('canvas')` stub so playSpawnEffect's
// createParticleTexture() can run in the Node test environment.
const fakeCanvasContext = {
  beginPath: vi.fn(),
  arc: vi.fn(),
  fill: vi.fn(),
  createRadialGradient: vi.fn().mockReturnValue({ addColorStop: vi.fn() }),
  fillStyle: '',
}
vi.stubGlobal('document', {
  createElement: vi.fn().mockReturnValue({
    width: 0,
    height: 0,
    getContext: vi.fn().mockReturnValue(fakeCanvasContext),
    toDataURL: vi.fn().mockReturnValue('data:image/png;base64,'),
  }),
})

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
    createRigidBody: vi.fn().mockImplementation(() => ({ ...makeFakeBody(), handle: handleCounter++ })),
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

  // -------------------------------------------------------------------------
  // 7. Small gold ball swarm spawning + quick-collect bonus
  // -------------------------------------------------------------------------
  describe('small gold ball swarm', () => {
    it('spawns swarmSize small balls when enabled', () => {
      const manager = makeManager()
      const bodies = manager.spawnSmallGoldBallSwarm(undefined, BallType.GOLD_PLATED)
      expect(bodies.length).toBe(GameConfig.smallGoldBalls.swarmSize)
    })

    it('respects maxConcurrentBalls when swarm would exceed the cap', () => {
      const manager = makeManager()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const lifetimes = (manager as any).smallGoldBallLifetimes as Map<unknown, number>

      // Fill up to one below the cap
      const cap = GameConfig.smallGoldBalls.maxConcurrentBalls
      for (let i = 0; i < cap - 1; i++) {
        lifetimes.set({ handle: `pre_${i}` }, GameConfig.smallGoldBalls.lifetime)
      }

      const bodies = manager.spawnSmallGoldBallSwarm(undefined, BallType.GOLD_PLATED)
      expect(bodies.length).toBe(1)
    })

    it('returns an empty array once the concurrent cap is already reached', () => {
      const manager = makeManager()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const lifetimes = (manager as any).smallGoldBallLifetimes as Map<unknown, number>

      const cap = GameConfig.smallGoldBalls.maxConcurrentBalls
      for (let i = 0; i < cap; i++) {
        lifetimes.set({ handle: `pre_${i}` }, GameConfig.smallGoldBalls.lifetime)
      }

      const bodies = manager.spawnSmallGoldBallSwarm(undefined, BallType.GOLD_PLATED)
      expect(bodies.length).toBe(0)
    })

    it('spawnRandomBall spawns a swarm for non-standard tiers when smallGoldBalls is enabled', () => {
      const manager = makeManager()
      const spy = vi.spyOn(manager, 'spawnSmallGoldBallSwarm')

      // Force selection of GOLD_PLATED (cumulative weight just above STANDARD's 0.75)
      vi.spyOn(Math, 'random').mockReturnValue(BALL_TIERS[BallType.STANDARD].spawnWeight + 0.01)

      const body = manager.spawnRandomBall()

      expect(spy).toHaveBeenCalledWith(undefined, BallType.GOLD_PLATED)
      // The returned body should be the first member of the spawned swarm
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const swarmBodies = (manager as any).ballBodies as unknown[]
      expect(swarmBodies).toContain(body)
      expect(swarmBodies.length).toBe(GameConfig.smallGoldBalls.swarmSize)

      vi.spyOn(Math, 'random').mockRestore()
    })

    it('awards a quick-collect bonus when all swarm members are collected within the window', () => {
      const manager = makeManager()
      const bodies = manager.spawnSmallGoldBallSwarm(undefined, BallType.GOLD_PLATED)
      expect(bodies.length).toBeGreaterThan(1)

      // Collect all but the last ball — none should report a bonus yet
      for (let i = 0; i < bodies.length - 1; i++) {
        const result = manager.collectBall(bodies[i])
        expect(result?.quickCollectBonus).toBeUndefined()
      }

      // Collecting the final ball completes the swarm within the window
      const last = manager.collectBall(bodies[bodies.length - 1])
      expect(last?.quickCollectBonus).toBeDefined()
      expect(last?.quickCollectBonus?.multiplier).toBe(GameConfig.smallGoldBalls.quickCollectMultiplier)
      expect(last?.quickCollectBonus?.totalPoints).toBe(
        Math.round(GameConfig.smallGoldBalls.basePoints * bodies.length * GameConfig.smallGoldBalls.quickCollectMultiplier),
      )
    })

    it('does not award a quick-collect bonus once the window has elapsed', () => {
      const manager = makeManager()
      const bodies = manager.spawnSmallGoldBallSwarm(undefined, BallType.GOLD_PLATED)

      // Push the swarm's spawnTime far enough into the past to exceed the window
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const swarmGroups = (manager as any).swarmGroups as Map<number, { spawnTime: number }>
      for (const group of swarmGroups.values()) {
        group.spawnTime = performance.now() - (GameConfig.smallGoldBalls.quickCollectBonusWindow + 1) * 1000
      }

      let last: ReturnType<typeof manager.collectBall> = null
      for (const body of bodies) {
        last = manager.collectBall(body)
      }

      expect(last?.quickCollectBonus).toBeUndefined()
    })

    it('marks only the final solid-gold swarm member as jackpot eligible', () => {
      const manager = makeManager()
      const bodies = manager.spawnSmallGoldBallSwarm(undefined, BallType.SOLID_GOLD)
      expect(bodies.length).toBe(GameConfig.smallGoldBalls.swarmSize)

      for (let i = 0; i < bodies.length - 1; i++) {
        const result = manager.collectBall(bodies[i])
        expect(result?.type).toBe(BallType.SOLID_GOLD)
        expect(result?.points).toBe(GameConfig.smallGoldBalls.basePoints)
        expect(result?.jackpotEligible).toBe(false)
      }

      const final = manager.collectBall(bodies[bodies.length - 1])
      expect(final?.type).toBe(BallType.SOLID_GOLD)
      expect(final?.jackpotEligible).toBe(true)
    })

    it('keeps non-swarm solid-gold balls jackpot eligible on collect', () => {
      const manager = makeManager()
      const body = {}
      setBallData(manager, body, BallType.SOLID_GOLD, BALL_TIERS[BallType.SOLID_GOLD].basePoints)

      const result = manager.collectBall(body as never)

      expect(result?.type).toBe(BallType.SOLID_GOLD)
      expect(result?.jackpotEligible).toBe(true)
    })

    it('removeBall cleans up swarm tracking so an incomplete swarm never awards a bonus', () => {
      const manager = makeManager()
      const bodies = manager.spawnSmallGoldBallSwarm(undefined, BallType.GOLD_PLATED)

      // Simulate one ball expiring/draining before the rest are collected
      manager.removeBall(bodies[0])

      let last: ReturnType<typeof manager.collectBall> = null
      for (let i = 1; i < bodies.length; i++) {
        last = manager.collectBall(bodies[i])
      }

      expect(last?.quickCollectBonus).toBeUndefined()
    })
  })

  describe('shared bindings array identity', () => {
    it('removeExtraBalls mutates bindings in place (does not split from GameObjects)', () => {
      const shared: Array<{ mesh: { name: string; dispose: () => void }; rigidBody: object }> = [
        { mesh: { name: 'wall', dispose: vi.fn() }, rigidBody: {} },
        { mesh: { name: 'ball', dispose: vi.fn() }, rigidBody: {} },
        { mesh: { name: 'ball_extra', dispose: vi.fn() }, rigidBody: {} },
      ]
      const manager = new BallManager(
        {} as never,
        makeFakeWorld() as never,
        makeFakeRapier() as never,
        shared as never,
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(manager as any).ballBody = shared[1].rigidBody
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(manager as any).ballBodies = [shared[1].rigidBody, shared[2].rigidBody]

      const extraMesh = shared[2].mesh
      manager.removeExtraBalls()

      expect(manager.getBindings()).toBe(shared)
      expect(shared.map((b) => b.mesh.name)).toEqual(['wall', 'ball'])
      expect(extraMesh.dispose).toHaveBeenCalled()
    })

    it('removeBall clears primary ballBody so getBallBody() is not a dead Rapier handle', () => {
      const body = {
        isValid: vi.fn(() => false),
      }
      const manager = makeManager()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(manager as any).ballBody = body
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(manager as any).ballBodies = [body]
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(manager as any).world = {
        removeRigidBody: vi.fn(),
      }

      manager.removeBall(body as never)

      expect(manager.getBallBody()).toBeNull()
      expect(manager.getBallBodies()).toEqual([])
    })
  })
})
