import { expect, test } from '@playwright/test'
import type { Game } from '../src/game'

test.use({ serviceWorkers: 'allow' })

const TRANSLATOR_REQUEST = /cdn\.babylonjs\.com|glslang|twgsl/i
const ARCADE_URL = process.env.ARCADE_SMOKE_URL
// Only local preview runs may explicitly exercise the documented Rapier fallback.
const EXPECTED_ENGINE = process.env.CI
  ? 'wasm-owner'
  : process.env.SMOKE_EXPECT_ENGINE ?? 'wasm-owner'

function isDocumentedLocalWasmFallback(url: string): boolean {
  const requestUrl = url.match(/https?:\/\/\S+/)?.[0]
  // A local preview without Emscripten intentionally lacks the optional owner bundle.
  return !process.env.CI &&
    EXPECTED_ENGINE === 'rapier' &&
    requestUrl !== undefined &&
    new URL(requestUrl).pathname.endsWith('/wasm/PhysicsModule.wasm')
}

test('production runtime, gameplay, machine, adventure, lifecycle, and offline smoke', async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  test.setTimeout(360_000)

  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  const failedRequests: string[] = []
  const badResponses: string[] = []
  const requests: string[] = []
  const runtimeUnhandled: string[] = []
  const runtimeReports: string[] = []

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('request', (request) => requests.push(request.url()))
  page.on('requestfailed', (request) => {
    failedRequests.push(`${request.url()} (${request.failure()?.errorText ?? 'failed'})`)
  })
  page.on('response', (response) => {
    if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`)
  })
  await page.addInitScript(() => {
    const target = window as Window & { __smokeUnhandled?: string[] }
    target.__smokeUnhandled = []
    window.addEventListener('unhandledrejection', (event) => {
      target.__smokeUnhandled?.push(String(event.reason))
    })
  })
  const collectRuntimeDiagnostics = async () => {
    const snapshot = await page.evaluate(() => ({
      unhandled: (window as Window & { __smokeUnhandled?: string[] }).__smokeUnhandled ?? [],
      reported: (window.pachinballErrors?.reports ?? []).map((report) => `${report.kind}: ${report.message}`),
    }))
    runtimeUnhandled.push(...snapshot.unhandled)
    runtimeReports.push(...snapshot.reported)
  }

  const entry = new URL('?machine=neo&renderer=webgl2', baseURL ?? 'http://localhost:4174/')
  await page.goto(entry.href)
  await expect(page.locator('#start-btn')).toBeEnabled({ timeout: 90_000 })
  await expect.poll(() => page.evaluate(() => window.game?.ready === true), { timeout: 90_000 }).toBe(true)

  const boot = await page.evaluate(() => ({
    isolated: window.crossOriginIsolated,
    mode: window.currentPhysicsEngine ?? window.game?.physics?.getWasmMode?.() ?? null,
    renderer: document.getElementById('pachinball-canvas')?.dataset.renderer ?? null,
    machine: window.game?.machine?.id ?? null,
  }))
  expect(boot).toEqual({ isolated: true, mode: EXPECTED_ENGINE, renderer: 'webgl2', machine: 'neo' })
  await testInfo.attach('menu.png', { body: await page.screenshot(), contentType: 'image/png' })

  await page.locator('#start-btn').click()
  await expect.poll(() => page.evaluate(() => window.game?.stateManager?.isPlaying() ?? false), {
    timeout: 60_000,
  }).toBe(true)
  await testInfo.attach('playing.png', { body: await page.screenshot(), contentType: 'image/png' })

  const initialBall = await page.evaluate(() => {
    const ball = window.game?.ballManager?.getBallBody()
    return ball ? { z: ball.translation().z, vz: ball.linvel().z } : null
  })
  expect(initialBall).not.toBeNull()
  await page.evaluate(() => window.game?.inputActions?.handlePlunger())
  await expect.poll(() => page.evaluate(() => window.game?.ballManager?.getBallBody()?.linvel().z ?? 0), {
    timeout: 30_000,
  }).toBeGreaterThan((initialBall?.vz ?? 0) + 5)

  if (testInfo.project.name === 'mobile-chrome') {
    const flipper = page.locator('#touch-left')
    await expect(flipper).toBeVisible()
    const before = await page.evaluate(() => window.game?.gameObjects?.getAllFlippers().get('left')?.body.rotation().y ?? 0)
    await flipper.dispatchEvent('touchstart', { bubbles: true, cancelable: true })
    await expect.poll(
      () => page.evaluate((poseBefore) =>
        Math.abs((window.game?.gameObjects?.getAllFlippers().get('left')?.body.rotation().y ?? 0) - poseBefore), before),
      { timeout: 30_000 },
    ).toBeGreaterThan(0.05)
    await flipper.dispatchEvent('touchend', { bubbles: true, cancelable: true })
  } else {
    const before = await page.evaluate(() => window.game?.gameObjects?.getAllFlippers().get('left')?.body.rotation().y ?? 0)
    await page.keyboard.down('Digit1')
    await expect.poll(
      () => page.evaluate((poseBefore) =>
        Math.abs((window.game?.gameObjects?.getAllFlippers().get('left')?.body.rotation().y ?? 0) - poseBefore), before),
      { timeout: 30_000 },
    ).toBeGreaterThan(0.05)
    await page.keyboard.up('Digit1')
  }

  const scoreBefore = await page.evaluate(() => window.game?.score ?? 0)
  await page.evaluate(() => {
    window.game?.eventBus.emit('points:awarded', {
      amount: 125,
      source: 'production-smoke',
      position: { x: 0, y: 1, z: 0 },
      multiplier: 1,
    })
  })
  await expect.poll(() => page.evaluate(() => window.game?.score ?? 0)).toBeGreaterThan(scoreBefore)

  if (ARCADE_URL) {
    const arcadeOrigin = new URL(ARCADE_URL).origin
    const leaderboardResponse = page.waitForResponse((response) => {
      const url = new URL(response.url())
      return url.origin === arcadeOrigin && url.pathname.endsWith('/rest/v1/leaderboard')
    }, { timeout: 30_000 })
    await page.evaluate(async () => {
      const overlays = window.game?.overlays
      if (!overlays) throw new Error('arcade overlays are unavailable')
      await overlays.ensure()
      await overlays.leaderboard.refresh(true)
    })
    expect((await leaderboardResponse).status()).toBe(200)
  }

  await page.keyboard.press('Escape')
  await expect.poll(() => page.evaluate(() => window.game?.stateManager?.isPaused() ?? false)).toBe(true)
  await expect(page.locator('[data-testid="pause-menu-panel"]')).toBeVisible()
  const resume = page.locator('[data-testid="pause-resume-btn"]')
  if (testInfo.project.name === 'mobile-chrome') {
    await resume.evaluate((button: HTMLButtonElement) => button.click())
  } else {
    await resume.click()
  }
  await expect.poll(() => page.evaluate(() => window.game?.stateManager?.isPlaying() ?? false)).toBe(true)

  await page.evaluate(() => {
    const game = window.game
    const ball = game?.ballManager?.getBallBody()
    const drain = game?.physicsController?.scoringBridge
    if (!game || !ball || !drain || !game.ballManager) throw new Error('drain simulation hook is unavailable')
    game.lives = 1
    game.ballManager.ballSaveSystem.expire()
    drain.handleBallLoss(ball)
  })
  await expect.poll(() => page.evaluate(() => window.game?.stateManager?.getState() ?? -1)).toBe(3)
  await expect(page.locator('#game-over-screen')).toBeVisible()
  await testInfo.attach('game-over.png', { body: await page.screenshot(), contentType: 'image/png' })

  await page.locator('#restart-btn').click()
  await expect.poll(() => page.evaluate(() => window.game?.stateManager?.isPlaying() ?? false), {
    timeout: 30_000,
  }).toBe(true)

  await page.evaluate(() => window.game?.startAdventureMode())
  await expect.poll(() => page.evaluate(() => window.game?.adventureMode?.isActive() ?? false), {
    timeout: 30_000,
  }).toBe(true)
  await page.evaluate(() => window.game?.endAdventureMode())
  await expect.poll(() => page.evaluate(() => window.game?.adventureMode?.isActive() ?? false)).toBe(false)

  await collectRuntimeDiagnostics()
  await page.evaluate(async () => {
    const current = window.game
    if (!current) throw new Error('first Game instance is missing')
    const GameConstructor = current.constructor as new (engine: Game['engine']) => Game
    const engine = current.engine
    current.dispose()
    const second = new GameConstructor(engine)
    await second.init()
    window.game = second
  })
  await expect.poll(() => page.evaluate(() => window.game?.ready === true)).toBe(true)
  expect(await page.evaluate(() => window.game?.stateManager?.getState())).toBe(0)
  expect(await page.evaluate(() => window.game?.machine ?? null)).toBeNull()
  expect(await page.evaluate(() => window.game?.physics?.getWasmMode())).toBe(EXPECTED_ENGINE)
  await collectRuntimeDiagnostics()

  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined))
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, undefined, { timeout: 30_000 })
  await context.setOffline(true)
  await page.reload()
  await expect.poll(() => page.evaluate(() => window.game?.ready === true), { timeout: 90_000 }).toBe(true)
  expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true)
  await context.setOffline(false)

  await collectRuntimeDiagnostics()
  expect(consoleErrors, `console.error messages: ${consoleErrors.join('\n')}`).toEqual([])
  expect(pageErrors, `page errors: ${pageErrors.join('\n')}`).toEqual([])
  expect(runtimeUnhandled).toEqual([])
  expect(runtimeReports).toEqual([])
  const unexpectedFailedRequests = failedRequests.filter((failure) => !isDocumentedLocalWasmFallback(failure))
  const unexpectedBadResponses = badResponses.filter((response) => !isDocumentedLocalWasmFallback(response))
  expect(unexpectedFailedRequests, `failed requests: ${unexpectedFailedRequests.join('\n')}`).toEqual([])
  expect(unexpectedBadResponses, `HTTP errors: ${unexpectedBadResponses.join('\n')}`).toEqual([])
  expect(requests.filter((url) => TRANSLATOR_REQUEST.test(url))).toEqual([])
  if (!ARCADE_URL) expect(requests.filter((url) => /\.supabase\.co\/rest\/v1\//i.test(url))).toEqual([])
})
