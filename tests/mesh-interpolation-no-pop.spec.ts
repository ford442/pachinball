import { test, expect } from '@playwright/test'

/**
 * Mesh interpolation across render frames that run no physics step.
 *
 * With a 60 Hz step on a 144 Hz display, most frames take no tick. The ball mesh must keep
 * moving through those frames (`lerp(pose before the last tick, live pose, alpha)` with alpha
 * rising), and no frame may draw it behind the pre-step snapshot (the "pop backward" the old
 * "refresh the stored pose on every sync" scheme produced).
 *
 * Deterministic: the render loop is stopped, `getDeltaTime` is scripted, and the frames are driven
 * by hand through `stepFixed`, so the page cannot step on its own.
 */

type Vec = { x: number; y: number; z: number }

type Frame = {
  stepped: boolean
  pre: Vec
  live: Vec
  drawn: Vec
  /** `getBallPosition(out)` — the camera / ghost / follow position. */
  followed: Vec
  followedIsOut: boolean
}

type HookedGame = {
  startGame: () => Promise<void>
  stateManager: { isPlaying: () => boolean }
  engine: { getDeltaTime: () => number; stopRenderLoop: () => void }
  physics: { step: (...args: unknown[]) => unknown }
  inputManager: unknown
  inputActions: unknown
  ballManager: {
    getBallBody: () => {
      translation: () => Vec
      setTranslation: (v: Vec, wake: boolean) => void
      setLinvel: (v: Vec, wake: boolean) => void
    } | null
  }
  physicsController: {
    rebuildHandleCaches?: () => void
    getBallMeshForBody: (body: unknown) => {
      computeWorldMatrix: (force: boolean) => unknown
      getAbsolutePosition: () => Vec
    } | null
    getBallPosition: (out: { x: number; y: number; z: number; set: (x: number, y: number, z: number) => unknown }) => Vec | null
    stepFixed: (input: unknown, actions: unknown, runner: null, recorder: null) => void
  }
}

test('ball mesh moves on frames without a step and never draws behind the pre-step pose (webgl2, 144 Hz over 60 Hz)', async ({ page }) => {
  test.setTimeout(120_000)
  await page.goto('/?renderer=webgl2')
  await expect(page.locator('#start-btn')).toBeVisible({ timeout: 30_000 })
  await expect.poll(async () => page.evaluate(() => !!(window as unknown as { game?: { stateManager?: unknown } }).game?.stateManager), {
    timeout: 60_000,
  }).toBe(true)

  const run = await page.evaluate(async () => {
    const g = (window as unknown as { game: HookedGame }).game
    const empty = { ok: false, reason: '', frames: [] as Frame[] }

    g.engine.stopRenderLoop()
    g.engine.getDeltaTime = () => 1000 / 144
    await g.startGame()
    if (!g.stateManager.isPlaying()) return { ...empty, reason: 'not playing' }

    const ball = g.ballManager.getBallBody()
    if (!ball) return { ...empty, reason: 'no ball' }
    const mesh = g.physicsController.getBallMeshForBody(ball)
    if (!mesh) return { ...empty, reason: 'no ball mesh' }

    // A moving, awake ball. Collisions are fine: every check is against the two physics poses.
    ball.setLinvel({ x: 0.4, y: 0, z: -3 }, true)
    g.physicsController.rebuildHandleCaches?.()

    let steps = 0
    const realStep = g.physics.step.bind(g.physics)
    g.physics.step = (...args: unknown[]) => {
      steps++
      return realStep(...args)
    }

    const copy = (v: Vec): Vec => ({ x: v.x, y: v.y, z: v.z })
    const out = { x: 0, y: 0, z: 0, set(x: number, y: number, z: number) { this.x = x; this.y = y; this.z = z; return this } }
    const frames: Frame[] = []
    for (let i = 0; i < 180; i++) {
      const pre = copy(ball.translation())
      const before = steps
      g.physicsController.stepFixed(g.inputManager, g.inputActions, null, null)
      mesh.computeWorldMatrix(true)
      const followed = g.physicsController.getBallPosition(out)
      frames.push({
        stepped: steps > before,
        pre,
        live: copy(ball.translation()),
        drawn: copy(mesh.getAbsolutePosition()),
        followed: followed ? copy(followed) : { x: NaN, y: NaN, z: NaN },
        followedIsOut: followed === out,
      })
    }
    return { ok: true, reason: '', frames }
  })

  expect(run.ok, run.reason).toBe(true)
  const frames = run.frames

  const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
  const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y + a.z * b.z
  const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)

  // 144 Hz over a 60 Hz step: roughly 60% of the frames take no tick.
  const stepped = frames.filter((f) => f.stepped).length
  expect(stepped).toBeGreaterThan(40)
  expect(frames.length - stepped).toBeGreaterThan(60)

  const EPS = 2e-3
  let movedWithoutStep = 0
  let checkedWithoutStep = 0
  // The segment the mesh blends along: the pose before the last tick -> the live pose after it.
  // A frame without a tick keeps it; the first frames are skipped (the first tick has nothing to blend from).
  let segPre: Vec | null = null
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]!
    if (f.stepped) segPre = f.pre
    if (i < 3 || !segPre) continue
    const prev = frames[i - 1]!

    const seg = sub(f.live, segPre)
    const len2 = dot(seg, seg)
    if (len2 > 1e-10) {
      // Never behind the pre-step snapshot, never past the live pose.
      const t = dot(sub(f.drawn, segPre), seg) / len2
      expect(t, `frame ${i} drawn behind the pre-step pose`).toBeGreaterThanOrEqual(-EPS)
      expect(t, `frame ${i} drawn past the live pose`).toBeLessThanOrEqual(1 + EPS)
    }
    if (!f.stepped) {
      // No tick: the live pose is unchanged and alpha advanced, so the mesh moves on.
      checkedWithoutStep++
      expect(dist(f.live, prev.live), `frame ${i}: no step, so the live pose is unchanged`).toBeLessThan(1e-9)
      if (dist(f.drawn, prev.drawn) > 1e-6) movedWithoutStep++
    }
    // The follow position (camera target, ghost, adventure) is the drawn position, in the caller's vector.
    expect(f.followedIsOut).toBe(true)
    expect(dist(f.followed, f.drawn), `frame ${i} follow position differs from the mesh`).toBeLessThan(5e-3)
  }

  expect(checkedWithoutStep).toBeGreaterThan(60)
  // The ball is moving, so (nearly) every step-free frame advances the mesh; allow for a stall (a rest or a wall).
  expect(movedWithoutStep).toBeGreaterThan(checkedWithoutStep * 0.8)
})
