import { expect, test, type Page } from '@playwright/test'
import { waitForSceneSettle } from './helpers/perf'

/**
 * #524, in the real engine (the Vitest suite mocks Babylon): things that spawn during play do not
 * create materials. A fever trail, a shard burst, impact / ripple rings and a multiball respawn all
 * draw through materials that exist since boot; the only thing allowed to grow is the bounded
 * floating-number pool, which this spec does not touch.
 */

interface FieldProbe {
  name: string
  isEnabled: (checkAncestors?: boolean) => boolean
  thinInstanceCount: number
  material: { name: string } | null
}

interface EffectsProbe {
  spawnShardBurst: (pos: unknown, color?: string) => void
  spawnImpactRing: (pos: unknown, normal: unknown, color: string) => void
  spawnEnhancedBumperImpact: (pos: unknown, intensity: 'light' | 'medium' | 'heavy') => void
  setLightingMode: (mode: 'normal' | 'fever', duration?: number) => void
  updateShards: (dt: number) => void
  /** Private in TS, plain properties at runtime. */
  ripplesEffects: { updateRippleRings: (dt: number) => void }
  trailEffects: { updateFeverTrails: (bodies: unknown[], isFever: boolean, dt: number) => void }
}

interface GameProbe {
  ready?: boolean
  scene: {
    materials: Array<{ name: string }>
    meshes: Array<{ name: string }>
    getMeshByName: (name: string) => FieldProbe | null
    activeCamera: { position: { clone: () => { set: (x: number, y: number, z: number) => unknown } } }
    onAfterRenderObservable: {
      add: (cb: () => void) => unknown
      remove: (observer: unknown) => void
    }
  }
  effects: EffectsProbe
  ballManager: {
    spawnExtraBalls: (n: number) => void
    removeExtraBalls: () => void
    getBallBodies: () => Array<{ translation: () => { x: number; y: number; z: number } }>
    trailMaterialPool: { size: number }
  }
  renderer: { applyQualityTier: (tier: string) => void }
  performanceMonitor: { setOnSustainedJank: (cb: (() => void) | null) => void }
  startGame: () => Promise<void>
}

type ProbeWindow = Window & { game?: GameProbe }

const FIELDS = ['shardField', 'impactRingField', 'rippleRingField', 'feverTrailField'] as const

async function bootTable(page: Page): Promise<void> {
  await page.setViewportSize({ width: 640, height: 360 })
  // `noopt=1`: the SceneOptimizer would degrade a software-GL run within seconds (docs/RENDER_BUDGET.md).
  await page.goto('/?renderer=webgl2&debug=1&noopt=1')
  await expect(page.locator('#start-btn')).toBeVisible({ timeout: 60_000 })
  await page.waitForFunction(() => !!(window as ProbeWindow).game?.ready, undefined, { timeout: 90_000 })
  await page.evaluate(() => (window as ProbeWindow).game?.performanceMonitor.setOnSustainedJank(null))
  await waitForSceneSettle(page)
  await page.evaluate(async () => {
    const g = (window as ProbeWindow).game!
    await g.startGame()
    g.renderer.applyQualityTier('medium')
  })
  await waitForSceneSettle(page)
}

async function renderFrames(page: Page, n: number): Promise<void> {
  await page.evaluate(
    (count) =>
      new Promise<void>((resolve) => {
        const scene = (window as ProbeWindow).game!.scene
        let left = count
        const observer = scene.onAfterRenderObservable.add(() => {
          if (--left > 0) return
          scene.onAfterRenderObservable.remove(observer)
          resolve()
        })
      }),
    n,
  )
}

test.describe('transient effects build no materials after boot (#524)', () => {
  test('a fever trail, shard burst, impact ring and ripples build no material, and no mesh after the first burst', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (err) => errors.push(err.message))

    await bootTable(page)

    const counts = () =>
      page.evaluate(() => {
        const g = (window as ProbeWindow).game!
        return { materials: g.scene.materials.length, meshes: g.scene.meshes.length }
      })
    const fieldsOf = () =>
      page.evaluate((names) => {
        const g = (window as ProbeWindow).game!
        return Object.fromEntries(
          names.map((n) => {
            const m = g.scene.getMeshByName(n)
            return [n, m ? { enabled: m.isEnabled(false), instances: m.thinInstanceCount, material: m.material?.name ?? null } : null]
          }),
        )
      }, FIELDS as unknown as string[])

    // Burst everything at once, with fever on so the trail quads spawn too.
    const burst = () =>
      page.evaluate(() => {
        const g = (window as ProbeWindow).game!
        const e = g.effects
        const pos = g.scene.activeCamera.position.clone().set(0, 0.6, 2)
        const up = g.scene.activeCamera.position.clone().set(0, 1, 0)
        e.spawnShardBurst(pos, '#ff00ff')
        e.spawnImpactRing(pos, up, '#00ffaa')
        e.spawnEnhancedBumperImpact(pos, 'heavy')
        e.setLightingMode('fever', 0)
      })
    // Let everything expire (large dt: the SwiftShader frame rate makes wall-clock lifetimes meaningless).
    const expire = async () => {
      await page.evaluate(() => {
        const e = (window as ProbeWindow).game!.effects
        e.setLightingMode('normal', 0)
        e.updateShards(5)
        e.ripplesEffects.updateRippleRings(5)
        e.trailEffects.updateFeverTrails([], false, 5)
      })
      await renderFrames(page, 3)
    }

    const boot = await counts()
    // An idle table carries none of the field meshes: each is built the first time it is shown.
    for (const [name, field] of Object.entries(await fieldsOf())) expect(field, `${name} not built at boot`).toBeNull()

    // First burst: each field builds its mesh once, but not one material.
    await burst()
    await renderFrames(page, 6)
    const first = await counts()
    const during = await fieldsOf()
    expect(first.materials, 'a burst builds no material').toBe(boot.materials)
    // One mesh per field, plus the transition-flash quad that entering FEVER shows (its material exists since boot).
    expect(first.meshes - boot.meshes, 'at most one mesh per field and the flash quad').toBeLessThanOrEqual(FIELDS.length + 1)

    for (const name of FIELDS) {
      const field = during[name]
      expect(field, `${name} exists`).not.toBeNull()
      expect(field!.material, `${name} draws with the shared transient material`).toBe('transientUnlitMat')
    }
    expect(during.shardField!.instances).toBeGreaterThanOrEqual(8)
    expect(during.rippleRingField!.instances).toBeGreaterThan(0)
    expect(during.feverTrailField!.instances).toBeGreaterThan(0)
    for (const name of ['shardField', 'rippleRingField', 'feverTrailField'] as const) {
      expect(during[name]!.enabled, `${name} is shown while it has instances`).toBe(true)
    }

    await expire()
    const idle = await fieldsOf()
    for (const name of FIELDS) {
      // An empty thin-instanced mesh would draw ONE ordinary mesh: it must be hidden, not just empty.
      expect(idle[name], `${name} is hidden once empty`).toMatchObject({ enabled: false, instances: 0 })
    }

    // Second burst: no material and no mesh, however many bursts follow.
    const settled = await counts()
    await burst()
    await renderFrames(page, 6)
    expect(await counts(), 'a later burst builds nothing').toEqual(settled)
    await expire()
    expect(await counts()).toEqual(settled)
    expect(errors).toEqual([])
  })

  test('ball trail materials are recycled across a multiball respawn', async ({ page }) => {
    await bootTable(page)

    await page.evaluate(() => (window as ProbeWindow).game!.ballManager.spawnExtraBalls(2))
    await waitForSceneSettle(page)
    const first = await page.evaluate(() => {
      const g = (window as ProbeWindow).game!
      return { materials: g.scene.materials.length, pool: g.ballManager.trailMaterialPool.size }
    })

    await page.evaluate(() => (window as ProbeWindow).game!.ballManager.removeExtraBalls())
    await page.evaluate(() => (window as ProbeWindow).game!.ballManager.spawnExtraBalls(2))
    await waitForSceneSettle(page)
    const second = await page.evaluate(() => {
      const g = (window as ProbeWindow).game!
      return { materials: g.scene.materials.length, pool: g.ballManager.trailMaterialPool.size }
    })

    expect(second.pool).toBe(first.pool)
    expect(second.materials).toBe(first.materials)
  })
})
