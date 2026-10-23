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

    // 1. Navigate and wait for bootstrap (WebGL2 for reliable headless physics)
    await page.goto('/?renderer=webgl2');
    await expect(page.locator('#start-btn')).toBeVisible({ timeout: 10_000 });

    // Wait for the game object to be fully initialized before clicking
    await expect.poll(async () => {
      return page.evaluate(() => !!(window as any).game?.stateManager);
    }, {
      intervals: [200],
      timeout: 15_000,
    }).toBe(true);

    // 2. Click START GAME and poll until state becomes PLAYING
    // Real pointer click: fails if anything (selectors, touch controls) covers the button.
    await page.locator('#start-btn').click();

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

    // 5. Verify the flipper joint moves when driven by a held-flipper input.
    const flipperBefore = await page.evaluate(() => {
      const g = (window as any).game;
      const left = g?.gameObjects?.getAllFlippers?.().get('left');
      return left ? { bodyY: left.body.rotation().y } : null;
    });
    expect(flipperBefore).not.toBeNull();

    // Direct-action smoke: intentionally bypasses the DOM keyboard handler. Real keyboard coverage
    // lives in keyboard-input.spec.ts. The flipper is held the way a held key holds it, through the
    // input manager's queue: under wasm-owner / wasm-worker the C++ hinge is driven only by input
    // frames (WasmOwner.driveFlippers), so `inputActions.handleFlipperLeft()` alone plays the sound
    // and never moves it (this check used to pass there only when the flipper was already moving).
    //
    // First release it and let it settle, so the press starts from rest: if the flipper is already
    // up (or on its way), a press cannot move it further. Then press and wait, frame by frame, for
    // the physics to move it. Both waits are bounded by wall time, not a frame count: a CI runner on
    // software GL can take seconds per frame, and under `wasm-worker` the pose arrives with the
    // worker's next snapshot. The samples (ms since the press, rotation delta) go into the failure
    // message.
    const flipperRun = await page.evaluate(() => {
      const g = (window as any).game;
      const keys = g?.inputManager?.getInputHandler?.()?.keyboardHost;
      if (!keys?.setFlipperLeftHeld || !keys?.queueInput) throw new Error('InputHandler keyboardHost hooks missing');
      const readY = () => g?.gameObjects?.getAllFlippers?.().get('left')?.body.rotation().y ?? 0;
      const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
      return (async () => {
        keys.setFlipperLeftHeld(false);
        keys.queueInput('flipperLeft', false);
        const settle0 = performance.now();
        let last = readY();
        let still = 0;
        while (still < 5 && performance.now() - settle0 < 10_000) {
          await frame();
          const y = readY();
          still = Math.abs(y - last) < 1e-4 ? still + 1 : 0;
          last = y;
        }
        const restY = readY();
        const settleMs = Math.round(performance.now() - settle0);

        const t0 = performance.now();
        keys.setFlipperLeftHeld(true);
        keys.queueInput('flipperLeft', true);
        const samples: Array<[number, number]> = [];
        for (;;) {
          await frame();
          const y = readY();
          const ms = Math.round(performance.now() - t0);
          samples.push([ms, Number((y - restY).toFixed(4))]);
          if (Math.abs(y - restY) > 0.05 || ms > 20_000) break;
        }
        return { samples, restY, settleMs };
      })();
    });

    // Release flipper
    await page.evaluate(() => {
      const keys = (window as any).game?.inputManager?.getInputHandler?.()?.keyboardHost;
      keys?.setFlipperLeftHeld?.(false);
      keys?.queueInput?.('flipperLeft', false);
    });

    // Flipper should have rotated (Y axis is the rotation axis for the revolute joint). Measured from
    // the settled pose: `flipperBefore` is a separate round trip, and the flipper can move in between.
    const flipperDelta = Math.abs(flipperRun.samples[flipperRun.samples.length - 1]?.[1] ?? 0);
    expect(
      flipperDelta,
      `rest y ${flipperRun.restY} after ${flipperRun.settleMs} ms; flipper samples [ms, Δy]: ${JSON.stringify(flipperRun.samples)}`,
    ).toBeGreaterThan(0.05);

    // Visual hierarchy must stay intact: SceneOptimizer must NOT merge flipper
    // child meshes off their physics-driven root (that made flippers look frozen).
    const hierarchy = await page.evaluate(() => {
      const g = (window as any).game;
      const left = g?.gameObjects?.getAllFlippers?.().get('left');
      const root = left?.mesh;
      const childCount = root?.getChildren?.()?.length ?? 0;
      const merged = (g?.scene?.meshes ?? [])
        .filter((m: { name?: string }) => /flipper.*_merged/i.test(m.name ?? ''))
        .map((m: { name: string }) => m.name);
      return { childCount, merged };
    });
    expect(hierarchy.childCount).toBeGreaterThan(0);
    expect(hierarchy.merged).toEqual([]);

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
    // fetch failures and optional asset 404s (WASM physics bundle, sample SFX)
    // are tolerated — they are non-blocking fallbacks.
    const unexpectedErrors = consoleErrors.filter(
      (text) =>
        !text.includes('ERR_CONNECTION_REFUSED') &&
        !text.includes('localhost:8000') &&
        !text.includes('404') &&
        !text.includes('Failed to load resource')
    );
    expect(unexpectedErrors).toHaveLength(0);
  });
});
