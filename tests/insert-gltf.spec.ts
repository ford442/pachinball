import { test, expect } from '@playwright/test'

// Mag-Spin insert glTF lands on its feeder anchor (root keeps the loader's
// handedness conversion), replaces the procedural well shell, and keeps the
// procedural spin rings.
test.setTimeout(180_000)

test('Mag-Spin insert sits on its anchor with the spin rings kept', async ({ page }) => {
  await page.goto('/?renderer=webgl2')
  const probe = () =>
    page.evaluate(() => {
      type M = {
        name: string
        parent: M | null
        isEnabled: () => boolean
        computeWorldMatrix: (f: boolean) => void
        getBoundingInfo: () => { boundingBox: { centerWorld: { x: number; y: number; z: number } } }
      }
      const scene = (window as unknown as { game?: { scene?: { meshes: M[] } } }).game?.scene
      if (!scene) return null
      const gltfWell = scene.meshes.find((m) => m.name === 'magSpinWell' && m.parent?.name === '__root__')
      if (!gltfWell) return null
      gltfWell.computeWorldMatrix(true)
      const c = gltfWell.getBoundingInfo().boundingBox.centerWorld
      const procWell = scene.meshes.find((m) => m.name === 'magSpinWell' && !m.parent)
      const rings = scene.meshes.filter((m) => /^magSpinRing\d$/.test(m.name))
      return {
        center: { x: c.x, y: c.y, z: c.z },
        proceduralWellEnabled: procWell?.isEnabled() ?? null,
        ringsEnabled: rings.map((r) => r.isEnabled()),
      }
    })
  await expect.poll(probe, { timeout: 120_000 }).not.toBeNull()
  const info = (await probe())!
  expect(info.center.x).toBeCloseTo(4.5, 1)
  expect(info.center.z).toBeCloseTo(15, 1)
  expect(info.center.y).toBeGreaterThan(0)
  expect(info.center.y).toBeLessThan(1)
  expect(info.proceduralWellEnabled).toBe(false)
  expect(info.ringsEnabled).toEqual([true, true, true])
})
