import { test, expect } from '@playwright/test';

/**
 * E2E regression for #266: collision events must resolve collider handles to
 * parent body handles before bumper/flipper dispatch. Vitest covers the
 * dispatcher in isolation; this spec runs real Rapier in the browser.
 *
 * Headless play rarely routes the ball from the plunger lane (x≈10.5) onto the
 * main field in time, so after one launch we place the ball on a bumper and
 * assert the collision pipeline awards score via the HUD.
 */
test.describe('Scoring collision dispatch (#266)', () => {
  test('bumper hit awards score after on-table play', async ({ page }) => {
    test.setTimeout(120_000);

    await page.goto('/?renderer=webgl2');
    await expect(page.locator('#start-btn')).toBeVisible({ timeout: 10_000 });

    await expect.poll(async () => {
      return page.evaluate(() => !!(window as any).game?.stateManager);
    }, { intervals: [200], timeout: 15_000 }).toBe(true);

    await page.evaluate(() => document.getElementById('start-btn')?.click());
    await page.waitForTimeout(500);

    await expect.poll(async () => {
      return page.evaluate(() => (window as any).game?.stateManager?.isPlaying?.() ?? false);
    }, { intervals: [200], timeout: 30_000 }).toBe(true);

    // One launch from the plunger lane (smoke that launch path still works)
    await page.evaluate(() => (window as any).game?.inputActions?.handlePlunger?.());
    await page.waitForTimeout(300);

    // Place ball on the center bumper (y ≤ 1.5 so handleBumperCollision awards points).
    await page.evaluate(() => {
      const g = (window as any).game;
      const ball = g?.ballManager?.getBallBody?.();
      const vis = g?.gameObjects?.getBumperVisuals?.()?.[0];
      if (!ball || !vis) return;
      const p = vis.mesh.position;
      ball.setTranslation({ x: p.x, y: p.y + 0.3, z: p.z }, true);
      ball.setLinvel({ x: 0, y: 1, z: -4 }, true);
      g.physicsController?.rebuildHandleCaches?.();
    });

    // Let Rapier resolve contacts for a few physics steps
    await page.waitForTimeout(2000);

    const scoreText = await page.locator('#score').textContent();
    const scoreNum = Number.parseInt(scoreText ?? '0', 10);

    const pipeline = await page.evaluate(() => {
      const g = (window as any).game;
      return {
        score: g?.score ?? 0,
        bumperMatches: g?.physicsController?.getBumperMatches?.() ?? 0,
        awardCalls: g?.physicsController?.getAwardScoreCalls?.() ?? 0,
        rawCollisions: g?.physicsController?.getRawCollisionEvents?.() ?? 0,
      };
    });

    expect(scoreNum, `HUD score should reflect bumper award; pipeline=${JSON.stringify(pipeline)}`).toBeGreaterThan(0);
    expect(pipeline.bumperMatches).toBeGreaterThan(0);
    expect(pipeline.awardCalls).toBeGreaterThan(0);
  });

  test('plunger launch accrues lane rollover points without bumper contact', async ({ page }) => {
    test.setTimeout(120_000);

    await page.goto('/?renderer=webgl2');
    await expect(page.locator('#start-btn')).toBeVisible({ timeout: 10_000 });

    await expect.poll(async () => {
      return page.evaluate(() => !!(window as any).game?.stateManager);
    }, { intervals: [200], timeout: 15_000 }).toBe(true);

    await page.evaluate(() => document.getElementById('start-btn')?.click());
    await page.waitForTimeout(500);

    await expect.poll(async () => {
      return page.evaluate(() => (window as any).game?.stateManager?.isPlaying?.() ?? false);
    }, { intervals: [200], timeout: 30_000 }).toBe(true);

    await page.evaluate(() => (window as any).game?.inputActions?.handlePlunger?.());
    await page.waitForTimeout(3000);

    const pipeline = await page.evaluate(() => {
      const g = (window as any).game;
      return {
        score: g?.score ?? 0,
        awardCalls: g?.physicsController?.getAwardScoreCalls?.() ?? 0,
        lastLaneHit: g?.physicsController?.getLastLaneHit?.() ?? null,
        bumperMatches: g?.physicsController?.getBumperMatches?.() ?? 0,
      };
    });

    const scoreText = await page.locator('#score').textContent();
    const scoreNum = Number.parseInt(scoreText ?? '0', 10);

    expect(scoreNum, `HUD score should reflect lane rollover; pipeline=${JSON.stringify(pipeline)}`).toBeGreaterThan(0);
    expect(pipeline.awardCalls).toBeGreaterThan(0);
    expect(pipeline.lastLaneHit).toMatch(/^launch-/);
    expect(pipeline.bumperMatches).toBe(0);
  });
});
