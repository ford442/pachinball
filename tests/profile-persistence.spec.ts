/**
 * The player profile in a real browser (#506 slice 1): the IndexedDB copy is written, a cleared
 * localStorage mirror is restored from it before the game reads its settings, and Settings →
 * Profile exports and imports it as a file.
 */
import { test, expect, type Page } from '@playwright/test'

async function boot(page: Page): Promise<void> {
  await page.goto('/')
  await page.waitForFunction(() => !!window.game?.ready, undefined, { timeout: 90_000 })
}

/** What the IndexedDB copy holds, read straight from the database (not through the store). */
function readCore(page: Page): Promise<unknown> {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open('pachinball')
        open.onerror = () => reject(open.error)
        open.onsuccess = () => {
          const get = open.result.transaction('profile').objectStore('profile').get('profile')
          get.onerror = () => reject(get.error)
          get.onsuccess = () => resolve(get.result)
        }
      }),
  )
}

test.describe('profile persistence', () => {
  test('a cleared localStorage mirror is restored from IndexedDB before boot reads it', async ({ page }) => {
    test.setTimeout(180_000)
    await boot(page)

    await page.evaluate(async () => {
      const { profileStore } = await import('/src/profile/profile-store.ts' as string) as typeof import('../src/profile/profile-store')
      profileStore.set('settings', { muted: true, masterVolume: 0.35 })
      profileStore.setBest('vanilla', 31_337)
      await profileStore.flush()
    })
    expect(await readCore(page)).toMatchObject({ version: 2, settings: { muted: true, masterVolume: 0.35 }, bests: { vanilla: 31_337 } })

    // The browser drops localStorage; IndexedDB survives.
    await page.evaluate(() => localStorage.clear())
    await page.reload()
    await page.waitForFunction(() => !!window.game?.ready, undefined, { timeout: 90_000 })

    const restored = await page.evaluate(() => ({
      settings: JSON.parse(localStorage.getItem('pachinball.settings') ?? 'null') as unknown,
      bests: JSON.parse(localStorage.getItem('pachinball.bests') ?? 'null') as unknown,
    }))
    expect(restored.settings).toMatchObject({ muted: true, masterVolume: 0.35 })
    expect(restored.bests).toEqual({ vanilla: 31_337 })
  })

  test('Settings → Profile exports the profile and imports it back', async ({ page }) => {
    test.setTimeout(180_000)
    await boot(page)
    await page.evaluate(async () => {
      const { profileStore } = await import('/src/profile/profile-store.ts' as string) as typeof import('../src/profile/profile-store')
      profileStore.set('settings', { muted: true, masterVolume: 0.5 })
      profileStore.setBest('vanilla', 777)
      await profileStore.flush()
    })

    await page.locator('#settings-btn').click()
    const download = page.waitForEvent('download')
    await page.locator('#profile-export-btn').click()
    const file = await download
    expect(file.suggestedFilename()).toBe('pachinball-profile.json')
    const exported = JSON.parse(await (await import('node:fs/promises')).readFile(await file.path(), 'utf8')) as Record<string, unknown>
    expect(exported).toMatchObject({ version: 2, settings: { muted: true, masterVolume: 0.5 }, bests: { vanilla: 777 } })

    // Import a profile with other values; the page confirms, applies it and reloads.
    page.once('dialog', (dialog) => void dialog.accept())
    const reloaded = page.waitForEvent('load')
    await page.locator('#profile-import-file').setInputFiles({
      name: 'profile.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ version: 2, settings: { muted: false, masterVolume: 0.9 }, bests: { vanilla: 42 } })),
    })
    await reloaded
    await page.waitForFunction(() => !!window.game?.ready, undefined, { timeout: 90_000 })
    const after = await page.evaluate(() => ({
      settings: JSON.parse(localStorage.getItem('pachinball.settings') ?? 'null') as unknown,
      bests: JSON.parse(localStorage.getItem('pachinball.bests') ?? 'null') as unknown,
    }))
    expect(after.settings).toEqual({ muted: false, masterVolume: 0.9 })
    expect(after.bests).toEqual({ vanilla: 42 })
    expect(await readCore(page)).toMatchObject({ settings: { masterVolume: 0.9 }, bests: { vanilla: 42 } })
  })
})
