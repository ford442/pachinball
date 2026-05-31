import { test, expect } from '@playwright/test';

test('Verify Prism Core Visuals', async ({ page }, testInfo) => {
  test.setTimeout(120_000);

  // 1. Go to the game
  await page.goto('http://localhost:5173');

  // 2. Wait for Start Game button and click it
  const startBtn = page.locator('#start-btn');
  await expect(startBtn).toBeVisible();
  await startBtn.click();

  // 3. Wait for game to load (canvas active)
  await page.waitForTimeout(2000); // Give it time to initialize 3D scene

  // 4. Debug HUD should mount hidden, then toggle with backquote
  const debugHud = page.locator('#debug-hud');
  await expect(debugHud).toBeHidden();

  await page.keyboard.press('`');
  await expect(debugHud).toBeVisible();
  await page.waitForTimeout(300);

  await page.keyboard.press('`');
  await expect(debugHud).toBeHidden();

  // 5. Synth impact API should be callable without runtime errors
  const audioResult = await page.evaluate(() => {
    type AudioGame = {
      soundSystem?: {
        playImpact?: (category: 'peg' | 'bumper' | 'flipper' | 'jackpot' | 'fever' | 'launch' | 'drain', velocity: number) => void
      }
    }
    const g = (window as unknown as { game?: AudioGame }).game
    if (!g?.soundSystem?.playImpact) return 'missing'
    g.soundSystem.playImpact('bumper', 12)
    g.soundSystem.playImpact('flipper', 6)
    return 'ok'
  });
  expect(audioResult).toBe('ok');

  // 6. Track theming should visibly change bumper emissive colors across tracks
  const themeResult = await page.evaluate(async () => {
    type DisplayWithTheme = {
      trackThemePrimary?: string
    }
    type CabinetLight = {
      diffuse?: { toHexString?: () => string }
    }
    type ThemeGame = {
      freeMapTestMode?: { loadById?: (id: string) => boolean }
      toggleFreeMapTestMode?: () => void
      display?: DisplayWithTheme
      cabinetNeonLights?: CabinetLight[]
    }

    const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
    const game = (window as unknown as { game?: ThemeGame }).game
    if (!game?.toggleFreeMapTestMode) return { ok: false, reason: 'missing-game-api' }

    game.toggleFreeMapTestMode()
    await wait(200)

    const load = (id: string) => game.freeMapTestMode?.loadById?.(id) ?? false
    const readThemeHex = () => {
      const displayHex = game.display?.trackThemePrimary
      if (displayHex) return displayHex
      const neon = game.cabinetNeonLights?.[0]
      return neon?.diffuse?.toHexString?.() ?? null
    }

    if (!load('NEON_HELIX')) return { ok: false, reason: 'load-neon-failed' }
    await wait(400)
    const neonHex = readThemeHex()

    if (!load('CYBER_CORE')) return { ok: false, reason: 'load-cyber-failed' }
    await wait(400)
    const cyberHex = readThemeHex()

    return {
      ok: Boolean(neonHex && cyberHex && neonHex !== cyberHex),
      neonHex,
      cyberHex,
    }
  });
  expect(themeResult.ok, JSON.stringify(themeResult)).toBe(true);

  // 7. Take a screenshot of the entire game view
  await page.screenshot({ path: testInfo.outputPath('prism-core.png') });
});
