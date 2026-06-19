import { test, expect } from '@playwright/test';

test.describe('Basic Gameplay Physics Smoke', () => {
  test('direct input actions move flipper and launch plunger', async ({ page }) => {
    test.setTimeout(120_000);

    // Collect any console errors during the test
    const consoleErrors: string[] = [];
    page.on('pageerror', (err) => consoleErrors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    // 1. Navigate and wait for bootstrap
    await page.goto('/');
    await expect(page.locator('#start-btn')).toBeVisible({ timeout: 10_000 });

    // Wait for the game object to be fully initialized before clicking
    await expect.poll(async () => {
      return page.evaluate(() => !!(window as any).game?.stateManager);
    }, {
      intervals: [200],
      timeout: 15_000,
    }).toBe(true);

    // 2. Click START GAME and poll until state becomes PLAYING
    await page.evaluate(() => {
      document.getElementById('start-btn')?.click();
    });
    await page.waitForTimeout(500); // give click handler a moment to fire

    // Poll for PLAYING state (up to 10s) — WASM physics init can vary
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

    // 4. Verify ball exists and has been spawned
    const ballInfo = await page.evaluate(() => {
      const g = (window as any).game;
      const ballBody = g?.ballManager?.getBallBody?.();
      const pos = ballBody ? ballBody.translation() : null;
      const vel = ballBody ? ballBody.linvel() : null;
      return {
        hasBall: !!ballBody,
        pos: pos ? { x: pos.x, y: pos.y, z: pos.z } : null,
        vel: vel ? { x: vel.x, y: vel.y, z: vel.z } : null,
      };
    });

    expect(ballInfo.hasBall).toBe(true);
    expect(ballInfo.pos).not.toBeNull();

    // 5. Verify the flipper joint moves when driven by GameInputActions.
    const flipperBefore = await page.evaluate(() => {
      const g = (window as any).game;
      const left = g?.gameObjects?.getAllFlippers?.().get('left');
      return left ? { bodyY: left.body.rotation().y } : null;
    });
    expect(flipperBefore).not.toBeNull();

    // Direct-action smoke: intentionally bypasses InputHandler. Real keyboard
    // coverage lives in keyboard-input.spec.ts.
    // Trigger flipper via direct API call and wait for physics frames
    // using rAF so the render loop (which drives physics) has a chance to step.
    const flipperAfter = await page.evaluate(() => {
      const g = (window as any).game;
      g?.inputActions?.handleFlipperLeft?.(true);
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

    // Release flipper
    await page.evaluate(() => {
      const g = (window as any).game;
      g?.inputActions?.handleFlipperLeft?.(false);
    });

    // Flipper should have rotated (Y axis is the rotation axis for the revolute joint)
    const flipperDelta = Math.abs((flipperAfter?.bodyY ?? 0) - (flipperBefore?.bodyY ?? 0));
    expect(flipperDelta).toBeGreaterThan(0.05);

    // 6. Plunger launch — verify ball z-velocity increases (impulse is +z)
    const ballBeforePlunger = await page.evaluate(() => {
      const g = (window as any).game;
      const ballBody = g?.ballManager?.getBallBody?.();
      const vel = ballBody ? ballBody.linvel() : null;
      return vel ? { x: vel.x, y: vel.y, z: vel.z } : null;
    });

    // Direct-action smoke: same mechanical action, but bypasses InputHandler
    // and charge UI. Real keyboard plunger coverage lives in keyboard-input.spec.ts.
    await page.evaluate(() => {
      const g = (window as any).game;
      g?.inputActions?.handlePlunger?.();
    });
    await page.waitForTimeout(200); // let impulse take effect

    const ballAfterPlunger = await page.evaluate(() => {
      const g = (window as any).game;
      const ballBody = g?.ballManager?.getBallBody?.();
      const vel = ballBody ? ballBody.linvel() : null;
      return vel ? { x: vel.x, y: vel.y, z: vel.z } : null;
    });

    // Plunger impulse is along +z, so z velocity should increase
    expect(ballAfterPlunger!.z).toBeGreaterThan(ballBeforePlunger!.z + 1);

    // 7. No unexpected JS errors during the entire test. Local backend map
    // fetch failures are tolerated in the same way as keyboard-input.spec.ts.
    const unexpectedErrors = consoleErrors.filter(
      (text) => !text.includes('ERR_CONNECTION_REFUSED') && !text.includes('localhost:8000')
    );
    expect(unexpectedErrors).toHaveLength(0);

    // 8. Scoring coverage guard (PR #263 regression): after launch + flipper activity,
    // a ball should have hit at least one scoring element (bumper/target) producing >0 points or counter.
    // Poll for up to 12s while keeping some input activity to prevent instant drain.
    await page.evaluate(() => {
      const g = (window as any).game;
      if (g?.inputActions) {
        g.inputActions.handleFlipperLeft?.(true);
        g.inputActions.handleFlipperRight?.(true);
      }
    });
    const hasScore = await expect.poll(async () => {
      return page.evaluate(() => {
        const g = (window as any).game;
        const score = g?.score ?? 0;
        const bh = g?.physicsController?.getBumperHitsThisBall?.() ?? 0;
        const pb = g?.physicsController?.getPointsThisBall?.() ?? 0;
        const zh = g?.zoneTriggerSystem?.getZoneEntriesThisBall?.() ?? 0;
        return (score > 0 || bh > 0 || pb > 0 || zh > 0);
      });
    }, { intervals: [300], timeout: 12000 });
    expect(hasScore).toBe(true);

    // cleanup input
    await page.evaluate(() => {
      const g = (window as any).game;
      if (g?.inputActions) {
        g.inputActions.handleFlipperLeft?.(false);
        g.inputActions.handleFlipperRight?.(false);
      }
    });
  });
});
