import { test, expect, type Request } from '@playwright/test'

/**
 * The built bundle mounted under /pachinball/, as production serves it (#464 item 5).
 *
 * Runs only under playwright.preview.config.ts, whose second webServer is
 * `vite preview --base /pachinball/` over the same plain `vite build` output
 * (base './'): the shipped artefact, not a build baked for the prefix. The
 * voice worklet used to be requested at /audio/… on the origin root, 404, and
 * leave every player on the oscillator fallback without a visible error.
 */

const ORIGIN = 'http://localhost:4175'
const WORKLET_PATH = '/pachinball/audio/pachinko-voice-processor.js'

type WorkletStatus = { url: string | null; ready: boolean; error: string | null }

test('under /pachinball/ every same-origin request stays in the subdirectory and the voice worklet runs', async ({ page }) => {
  test.setTimeout(120_000)

  const requests: Request[] = []
  page.on('request', (request) => requests.push(request))

  await page.goto(`${ORIGIN}/pachinball/?renderer=webgl2`)
  await expect(page.locator('#start-btn')).toBeEnabled({ timeout: 60_000 })

  // `addModule` fetches are not page requests Playwright reports, so the engine
  // says where it loaded from, and whether the processor registered.
  await expect.poll(
    () => page.evaluate(() => {
      const g = (window as { game?: { effects?: { getVoiceWorkletStatus?: () => WorkletStatus | null } } }).game
      return g?.effects?.getVoiceWorkletStatus?.() ?? null
    }),
    { timeout: 30_000 },
  ).toEqual({ url: `${ORIGIN}${WORKLET_PATH}`, ready: true, error: null })

  // The script itself, as the host serves it under COEP: a JavaScript type and the processor.
  const script = await page.evaluate(async (path) => {
    const response = await fetch(path)
    return { status: response.status, type: response.headers.get('content-type'), body: await response.text() }
  }, WORKLET_PATH)
  expect(script.status).toBe(200)
  expect(script.type).toMatch(/javascript/)
  expect(script.body).toContain('registerProcessor')

  // Start a game too: the sample bank, maps and textures load from here on.
  await page.locator('#start-btn').click()
  await expect.poll(
    () => page.evaluate(() => (window as { game?: { stateManager?: { isPlaying?: () => boolean } } }).game?.stateManager?.isPlaying?.() ?? false),
    { timeout: 30_000 },
  ).toBe(true)
  await expect.poll(() => requests.some((r) => /\/pachinball\/audio\/.+\.ogg$/.test(new URL(r.url()).pathname)), { timeout: 30_000 }).toBe(true)

  // blob: URLs (Babylon's texture uploads) carry the page origin but are not requests to it.
  const outside = requests
    .map((request) => new URL(request.url()))
    .filter((url) => url.protocol.startsWith('http') && url.origin === ORIGIN && !url.pathname.startsWith('/pachinball/'))
    .map((url) => url.pathname)
  expect(outside, 'same-origin requests outside /pachinball/').toEqual([])
})
