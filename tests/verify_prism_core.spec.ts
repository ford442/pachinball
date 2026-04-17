import { test, expect } from '@playwright/test';

test('Verify Prism Core Visuals', async ({ page }) => {
  test.setTimeout(60_000);

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

  // 5. Take a screenshot of the entire game view
  await page.screenshot({ path: 'test-results/prism-core.png' });
});
