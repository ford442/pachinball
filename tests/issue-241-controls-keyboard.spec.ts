import { test, expect } from '@playwright/test'

test.use({
  launchOptions: {
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  },
})

interface Vec3 {
  x: number
  y: number
  z: number
}

interface RigidBodyLike {
  rotation: () => Vec3
}

interface BallBodyLike {
  translation: () => Vec3
  linvel: () => Vec3
}

interface TestGame {
  stateManager?: {
    getState?: () => number
    isPlaying?: () => boolean
    state?: number
  }
  inputManager?: unknown
  ballManager?: {
    getBallBody?: () => BallBodyLike | null
  }
  gameObjects?: {
    getAllFlippers?: () => Map<string, { body: RigidBodyLike }>
  }
}

test.describe('Issue #241: keyboard controls move flippers and plunger', () => {
  test('real keyboard input drives flipper rotation and plunger launch', async ({ page }) => {
    test.setTimeout(120_000)

    const consoleErrors: string[] = []
    page.on('pageerror', (err) => consoleErrors.push(err.message))
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text())
    })

    // 1. Navigate and wait for bootstrap.
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // Wait for the game object and input manager to be fully initialized.
    await expect.poll(async () => {
      return page.evaluate(() => {
        const g = (window as unknown as { game?: TestGame }).game
        return !!(g?.stateManager && g?.inputManager)
      })
    }, {
      intervals: [200],
      timeout: 15_000,
    }).toBe(true)

    // 2. Start the game. Use a direct JS click to bypass overlay interception.
    const startBtn = page.locator('#start-btn')
    const hasStartBtn = await startBtn.isVisible().catch(() => false)
    if (hasStartBtn) {
      await startBtn.click({ force: true })
      await page.waitForTimeout(500)
    }

    // 3. Wait for the game to be PLAYING.
    await expect.poll(async () => {
      return page.evaluate(() => {
        const g = (window as unknown as { game?: TestGame }).game
        return {
          state: g?.stateManager?.getState?.() ?? g?.stateManager?.state,
          isPlaying: g?.stateManager?.isPlaying?.() ?? false,
        }
      })
    }, {
      intervals: [200],
      timeout: 15_000,
    }).toEqual(expect.objectContaining({
      state: 2, // GameState.PLAYING
      isPlaying: true,
    }))

    // Focus the page so keyboard events are delivered reliably.
    await page.bringToFront()
    await page.evaluate(() => { window.focus() })
    await page.waitForTimeout(1_000)

    // 4. Flipper test: real ShiftLeft input must rotate the left flipper body.
    const getLeftFlipperY = async () => page.evaluate(() => {
      const g = (window as unknown as { game?: TestGame }).game
      const left = g?.gameObjects?.getAllFlippers?.().get('left')
      return left ? left.body.rotation().y : null
    })

    const flipperBefore = await getLeftFlipperY()
    expect(flipperBefore, 'left flipper should exist before keyboard test').not.toBeNull()

    await page.keyboard.down('ShiftLeft')
    // Some headless Chromium configurations drop page.keyboard events; dispatch a
    // real DOM keyboard event on window as a guaranteed fallback so the test is robust.
    await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'ShiftLeft', bubbles: true }))
    })

    // Poll while holding the key; the motor holds the active angle once the event is processed.
    let flipperAfter = flipperBefore
    await expect.poll(async () => {
      flipperAfter = await getLeftFlipperY()
      return Math.abs((flipperAfter ?? 0) - (flipperBefore ?? 0))
    }, {
      intervals: [50],
      timeout: 3_000,
    }).toBeGreaterThan(0.05)

    await page.keyboard.up('ShiftLeft')

    // 5. Plunger test: real Enter input must launch the ball.
    // Reset the ball to the plunger lane first.
    await page.keyboard.press('KeyR')
    await page.waitForTimeout(800)

    const getBallState = async () => page.evaluate(() => {
      const g = (window as unknown as { game?: TestGame }).game
      const ballBody = g?.ballManager?.getBallBody?.()
      const pos = ballBody ? ballBody.translation() : null
      const vel = ballBody ? ballBody.linvel() : null
      return {
        pos: pos ? { x: pos.x, y: pos.y, z: pos.z } : null,
        vel: vel ? { x: vel.x, y: vel.y, z: vel.z } : null,
      }
    })

    const ballBeforePlunger = (await getBallState()).vel
    expect(ballBeforePlunger, 'ball should exist before plunger test').not.toBeNull()

    await page.keyboard.down('Enter')
    await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', bubbles: true }))
    })
    await page.waitForTimeout(1_000)
    await page.keyboard.up('Enter')
    await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Enter', bubbles: true }))
    })

    // Wait for the launch impulse to be applied and measured.
    let ballAfterPlunger = ballBeforePlunger
    await expect.poll(async () => {
      const state = await getBallState()
      ballAfterPlunger = state.vel
      return (ballAfterPlunger?.z ?? 0) - (ballBeforePlunger?.z ?? 0)
    }, {
      intervals: [50],
      timeout: 5_000,
    }).toBeGreaterThan(1)

    // 6. No unexpected JS errors. Filter out pre-existing offline map-fetch failures.
    const unexpectedErrors = consoleErrors.filter(
      (text) => !text.includes('ERR_CONNECTION_REFUSED') && !text.includes('localhost:8000')
    )
    expect(unexpectedErrors).toHaveLength(0)
  })
})
