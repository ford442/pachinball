import { test, expect } from '@playwright/test';

test('verify pachinko spire', async ({ page }) => {
  // 1. Go to the game
  await page.goto('http://localhost:5173');

  // 2. Click Start Game
  const startBtn = page.locator('#start-btn');
  await startBtn.click();

  // 3. Wait for game to be ready
  await page.waitForTimeout(2000);

  // 4. Trigger Adventure Mode
  await page.keyboard.press('a');
  await page.waitForTimeout(1000);

  // Cycle through tracks until Pachinko Spire
  // Current Order: NEON_HELIX -> CYBER_CORE -> QUANTUM_GRID -> SINGULARITY_WELL -> GLITCH_SPIRE -> RETRO_WAVE_HILLS -> CHRONO_CORE -> HYPER_DRIFT -> PACHINKO_SPIRE

  // 1. Toggle OFF (End Helix)
  await page.keyboard.press('a');
  await page.waitForTimeout(500);

  // 2. Toggle ON (Cyber Core)
  await page.keyboard.press('a');
  await page.waitForTimeout(500);
  await page.keyboard.press('a'); // OFF

  // 3. Toggle ON (Quantum Grid)
  await page.keyboard.press('a');
  await page.waitForTimeout(500);
  await page.keyboard.press('a'); // OFF

  // 4. Toggle ON (Singularity Well)
  await page.keyboard.press('a');
  await page.waitForTimeout(500);
  await page.keyboard.press('a'); // OFF

  // 5. Toggle ON (Glitch Spire)
  await page.keyboard.press('a');
  await page.waitForTimeout(500);
  await page.keyboard.press('a'); // OFF

  // 6. Toggle ON (Retro Wave Hills)
  await page.keyboard.press('a');
  await page.waitForTimeout(500);
  await page.keyboard.press('a'); // OFF

  // 7. Toggle ON (Chrono Core)
  await page.keyboard.press('a');
  await page.waitForTimeout(500);
  await page.keyboard.press('a'); // OFF

  // 8. Toggle ON (Hyper Drift)
  await page.keyboard.press('a');
  await page.waitForTimeout(500);
  await page.keyboard.press('a'); // OFF

  // 9. Toggle ON (PACHINKO SPIRE)
  await page.keyboard.press('a');
  await page.waitForTimeout(2000); // Wait for camera to settle

  // 5. Screenshot
  await page.screenshot({ path: 'verification/pachinko_spire.png' });
});
