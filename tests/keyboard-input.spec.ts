import { test, expect } from '@playwright/test';

// Real keyboard-path coverage for flippers and the plunger.
//
// Correct bindings (src/game-elements/input.ts):
//   - ShiftLeft  = left flipper
//   - ShiftRight = right flipper
//   - Enter      = plunger charge (hold) / launch (release)
//   - Space is NOT a flipper key (README/grok.md docs are stale on this point)
//
// Unlike tests/basic-gameplay.spec.ts (which calls `inputActions.handleFlipperLeft()`
// / `inputActions.handlePlunger()` directly, bypassing InputHandler), these tests drive
// the full pipeline via page.keyboard so they catch #241-class bugs where audio fires
// but the underlying joint motor / plunger impulse never runs:
//   InputHandler.handleKeyDown/Up -> queueInput -> processBufferedInputs
//     -> GamePhysicsController.stepPhysics -> GameInputActions -> Rapier joint motors / impulse

async function startGame(page: import('@playwright/test').Page) {
  const consoleErrors: string[] = [];
  page.on('pageerror', (err) => consoleErrors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  await page.goto('http://localhost:5173');
  await expect(page.locator('#start-btn')).toBeVisible({ timeout: 10_000 });

  await expect.poll(async () => {
    return page.evaluate(() => !!(window as any).game?.stateManager);
  }, {
    intervals: [200],
    timeout: 15_000,
  }).toBe(true);

  const startBtn = page.locator('#start-btn');
  await expect(startBtn).toBeVisible();
  await startBtn.click();
  await page.waitForTimeout(500);

  await expect.poll(async () => {
    const gs = await page.evaluate(() => {
      const g = (window as any).game;
      return {
        state: g?.stateManager?.getState?.() ?? g?.stateManager?.state,
        isPlaying: g?.stateManager?.isPlaying?.(),
        menuHidden: document.getElementById('menu-overlay')?.classList.contains('hidden') ?? false,
      };
    });
    return gs;
  }, {
    intervals: [200],
    timeout: 10_000,
  }).toEqual(expect.objectContaining({
    state: 2, // GameState.PLAYING = 2
    isPlaying: true,
    menuHidden: true,
  }));

  return consoleErrors;
}

test.describe('Keyboard Input Pipeline', () => {
  test('ShiftLeft rotates the left flipper joint via the real keyboard path', async ({ page }) => {
    test.setTimeout(60_000);

    const consoleErrors = await startGame(page);

    // Snapshot the flipper joint rotation, hold ShiftLeft via real keyboard
    // events, then wait a few rAF ticks (which drive the physics step) before
    // comparing — exactly as a player's keypress would.
    const flipperBefore = await page.evaluate(() => {
      const g = (window as any).game;
      const left = g?.gameObjects?.getAllFlippers?.().get('left');
      return left ? { bodyY: left.body.rotation().y } : null;
    });
    expect(flipperBefore).not.toBeNull();

    await page.keyboard.down('ShiftLeft');

    const flipperAfter = await page.evaluate(() => {
      const g = (window as any).game;
      return new Promise<{ bodyY: number }>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              const left = g?.gameObjects?.getAllFlippers?.().get('left');
              resolve({ bodyY: left ? left.body.rotation().y : 0 });
            });
          });
        });
      });
    });

    await page.keyboard.up('ShiftLeft');

    // Flipper should have rotated (Y axis is the rotation axis for the revolute joint)
    const flipperDelta = Math.abs((flipperAfter?.bodyY ?? 0) - (flipperBefore?.bodyY ?? 0));
    expect(flipperDelta).toBeGreaterThan(0.05);

    expect(consoleErrors).toHaveLength(0);
  });

  // FIXME(#241): Holding/releasing Enter via page.keyboard does not change the
  // ball's z-velocity, even though the same physics impulse (via
  // inputActions.handlePlunger() called directly, as in basic-gameplay.spec.ts)
  // does change it. This reproduces the #241 "Enter triggers plunger audio but
  // not the launch impulse" symptom through the real keyboard pipeline
  // (InputHandler.handleKeyDown/Up -> queueInput('plunger') -> processBufferedInputs
  // -> GameInputActions.handlePlunger). Unblock this test when #241 is fixed.
  test.fixme('Enter charges and launches the plunger via the real keyboard path', async ({ page }) => {
    test.setTimeout(60_000);

    const consoleErrors = await startGame(page);

    const ballBeforePlunger = await page.evaluate(() => {
      const g = (window as any).game;
      const ballBody = g?.ballManager?.getBallBody?.();
      const vel = ballBody ? ballBody.linvel() : null;
      return vel ? { x: vel.x, y: vel.y, z: vel.z } : null;
    });
    expect(ballBeforePlunger).not.toBeNull();

    await page.keyboard.down('Enter');
    await page.waitForTimeout(200); // build up plunger charge
    await page.keyboard.up('Enter');
    await page.waitForTimeout(200); // let the queued impulse take effect

    const ballAfterPlunger = await page.evaluate(() => {
      const g = (window as any).game;
      const ballBody = g?.ballManager?.getBallBody?.();
      const vel = ballBody ? ballBody.linvel() : null;
      return vel ? { x: vel.x, y: vel.y, z: vel.z } : null;
    });
    expect(ballAfterPlunger).not.toBeNull();

    // Plunger impulse is along +z, so z velocity should increase
    expect(ballAfterPlunger!.z).toBeGreaterThan(ballBeforePlunger!.z + 1);

    expect(consoleErrors).toHaveLength(0);
  });
});
