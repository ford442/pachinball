import { test, expect } from '@playwright/test';

// Real keyboard-path coverage for flippers and the plunger.
//
// Correct bindings (src/game-elements/input.ts):
//   - ShiftLeft  = left flipper
//   - ShiftRight = right flipper
//   - Enter      = plunger charge (hold) / launch (release)
//   - Space      = plunger charge (same action as Enter), not a flipper key
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

  await page.goto('/');
  await expect(page.locator('#start-btn')).toBeVisible({ timeout: 10_000 });

  await expect.poll(async () => {
    return page.evaluate(() => !!(window as any).game?.stateManager);
  }, {
    intervals: [200],
    timeout: 15_000,
  }).toBe(true);

  const startBtn = page.locator('#start-btn');
  await expect(startBtn).toBeVisible();
  await startBtn.click({ force: true });
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
    timeout: 30_000,
  }).toEqual(expect.objectContaining({
    state: 2, // GameState.PLAYING = 2
    isPlaying: true,
    menuHidden: true,
  }));

  await page.bringToFront();
  await page.evaluate(() => {
    window.focus();
    document.getElementById('pachinball-canvas')?.focus();
  });

  return consoleErrors;
}

test.describe('Keyboard Input Pipeline', () => {
  test('ShiftLeft rotates the left flipper joint via the real keyboard path', async ({ page }) => {
    test.setTimeout(120_000);

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

    expectUnexpectedConsoleErrors(consoleErrors);
  });

  test('Enter charges and launches the plunger via the real keyboard path', async ({ page }) => {
    test.setTimeout(120_000);

    const consoleErrors = await startGame(page);

    // Reset the ball into the shooter lane before testing the plunger.
    await page.keyboard.press('KeyR');
    await page.waitForTimeout(800);

    const getBallState = async () => page.evaluate(() => {
      const g = (window as any).game;
      const ballBody = g?.ballManager?.getBallBody?.();
      const pos = ballBody ? ballBody.translation() : null;
      const vel = ballBody ? ballBody.linvel() : null;
      return {
        pos: pos ? { x: pos.x, y: pos.y, z: pos.z } : null,
        vel: vel ? { x: vel.x, y: vel.y, z: vel.z } : null,
      };
    });

    const getPlungerKnobZ = async () => page.evaluate(() => {
      return document.querySelector('canvas')
        ? ((window as any).game?.scene?.getMeshByName?.('plungerKnob')?.position?.z ?? null)
        : null;
    });

    const initialState = await getBallState();
    expect(initialState.pos).not.toBeNull();
    expect(initialState.vel).not.toBeNull();
    expect(initialState.pos!.x).toBeGreaterThan(8);
    expect(initialState.pos!.z).toBeLessThan(-4);

    const knobBefore = await getPlungerKnobZ();
    expect(knobBefore).not.toBeNull();

    await page.keyboard.down('Enter');
    await page.evaluate(() => new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        });
      });
    }));

    await expect.poll(async () => {
      const knobDuringCharge = await getPlungerKnobZ();
      return (knobBefore ?? 0) - (knobDuringCharge ?? knobBefore ?? 0);
    }, {
      intervals: [50],
      timeout: 2_000,
    }).toBeGreaterThan(0.05);

    await page.waitForTimeout(800); // build up plunger charge
    const ballBeforePlunger = (await getBallState()).vel;
    expect(ballBeforePlunger).not.toBeNull();

    await page.keyboard.up('Enter');

    // Plunger impulse is along +z, so z velocity should increase.
    await expect.poll(async () => {
      const state = await getBallState();
      return (state.vel?.z ?? 0) - (ballBeforePlunger?.z ?? 0);
    }, {
      intervals: [50],
      timeout: 5_000,
    }).toBeGreaterThan(1);

    expectUnexpectedConsoleErrors(consoleErrors);
  });
});

function expectUnexpectedConsoleErrors(consoleErrors: string[]) {
  const unexpectedErrors = consoleErrors.filter(
    (text) => !text.includes('ERR_CONNECTION_REFUSED') && !text.includes('localhost:8000')
  );
  expect(unexpectedErrors).toHaveLength(0);
}
