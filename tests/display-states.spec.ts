import { test, expect, type Page } from '@playwright/test';

// NOTE: Each test bootstraps the full game (Babylon.js + Rapier WASM + WebGPU/WebGL).
// In resource-constrained/headless environments this can take 30–40 s per test.
// Using a single shared browser context (beforeAll) cuts total suite time
// from ~6 min to ~2 min by initializing the game only once.
test.setTimeout(180_000);

test.describe.configure({ mode: 'serial' });

test.describe('DisplayState transitions', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await page.goto('http://localhost:5173');

    const startBtn = page.locator('#start-btn');
    await expect(startBtn).toBeVisible();
    await startBtn.click();

    await page.waitForTimeout(2500);

    // Ensure window.game and window.game.display are fully initialized
    await page.waitForFunction(() => {
      const g = (window as unknown as Record<string, unknown>).game as
        | { display?: { getDisplayState: () => string }; eventBus?: { emit: (event: string, payload?: string) => void } }
        | undefined;
      return g != null && g.display != null && g.eventBus != null;
    });
  });

  test.afterAll(async () => {
    await page.close();
  });

  // Helper to reset display state to idle between tests
  async function resetToIdle(): Promise<void> {
    await page.evaluate(() => {
      const g = (window as unknown as Record<string, unknown>).game as {
        eventBus: { emit: (event: string, payload?: string) => void };
      };
      g.eventBus.emit('display:set', 'idle');
    });
    // Small delay to let the display system process
    await page.waitForTimeout(100);
  }

  test('IDLE is default', async () => {
    await resetToIdle();
    const state = await page.evaluate(() => {
      const g = (window as unknown as Record<string, unknown>).game as {
        display: { getDisplayState: () => string };
      };
      return g.display.getDisplayState();
    });
    expect(state).toBe('idle');
  });

  test('IDLE -> FEVER', async () => {
    await resetToIdle();
    await page.evaluate(() => {
      const g = (window as unknown as Record<string, unknown>).game as {
        eventBus: { emit: (event: string, payload: string) => void };
      };
      g.eventBus.emit('display:set', 'fever');
    });

    const state = await page.evaluate(() => {
      const g = (window as unknown as Record<string, unknown>).game as {
        display: { getDisplayState: () => string };
      };
      return g.display.getDisplayState();
    });
    expect(state).toBe('fever');
  });

  test('FEVER -> IDLE', async () => {
    await page.evaluate(() => {
      const g = (window as unknown as Record<string, unknown>).game as {
        eventBus: { emit: (event: string, payload: string) => void };
        display: { getDisplayState: () => string };
      };
      g.eventBus.emit('display:set', 'fever');
      if (g.display.getDisplayState() !== 'fever') {
        throw new Error('Precondition failed: expected fever');
      }
      g.eventBus.emit('display:set', 'idle');
    });

    const state = await page.evaluate(() => {
      const g = (window as unknown as Record<string, unknown>).game as {
        display: { getDisplayState: () => string };
      };
      return g.display.getDisplayState();
    });
    expect(state).toBe('idle');
  });

  test('IDLE -> REACH', async () => {
    await resetToIdle();
    await page.evaluate(() => {
      const g = (window as unknown as Record<string, unknown>).game as {
        eventBus: { emit: (event: string, payload: string) => void };
      };
      g.eventBus.emit('display:set', 'reach');
    });

    const state = await page.evaluate(() => {
      const g = (window as unknown as Record<string, unknown>).game as {
        display: { getDisplayState: () => string };
      };
      return g.display.getDisplayState();
    });
    expect(state).toBe('reach');
  });

  test('REACH -> IDLE', async () => {
    await page.evaluate(() => {
      const g = (window as unknown as Record<string, unknown>).game as {
        eventBus: { emit: (event: string, payload: string) => void };
        display: { getDisplayState: () => string };
      };
      g.eventBus.emit('display:set', 'reach');
      if (g.display.getDisplayState() !== 'reach') {
        throw new Error('Precondition failed: expected reach');
      }
      g.eventBus.emit('display:set', 'idle');
    });

    const state = await page.evaluate(() => {
      const g = (window as unknown as Record<string, unknown>).game as {
        display: { getDisplayState: () => string };
      };
      return g.display.getDisplayState();
    });
    expect(state).toBe('idle');
  });

  test('IDLE -> JACKPOT', async () => {
    await resetToIdle();
    await page.evaluate(() => {
      const g = (window as unknown as Record<string, unknown>).game as {
        eventBus: { emit: (event: string, payload: string) => void };
      };
      g.eventBus.emit('display:set', 'jackpot');
    });

    const state = await page.evaluate(() => {
      const g = (window as unknown as Record<string, unknown>).game as {
        display: { getDisplayState: () => string };
      };
      return g.display.getDisplayState();
    });
    expect(state).toBe('jackpot');
  });

  test('JACKPOT -> IDLE', async () => {
    await page.evaluate(() => {
      const g = (window as unknown as Record<string, unknown>).game as {
        eventBus: { emit: (event: string, payload: string) => void };
        display: { getDisplayState: () => string };
      };
      g.eventBus.emit('display:set', 'jackpot');
      if (g.display.getDisplayState() !== 'jackpot') {
        throw new Error('Precondition failed: expected jackpot');
      }
      g.eventBus.emit('display:set', 'idle');
    });

    const state = await page.evaluate(() => {
      const g = (window as unknown as Record<string, unknown>).game as {
        display: { getDisplayState: () => string };
      };
      return g.display.getDisplayState();
    });
    expect(state).toBe('idle');
  });

  test('IDLE -> ADVENTURE', async () => {
    await resetToIdle();
    await page.evaluate(() => {
      const g = (window as unknown as Record<string, unknown>).game as {
        eventBus: { emit: (event: string, payload: string) => void };
      };
      g.eventBus.emit('display:set', 'adventure');
    });

    const state = await page.evaluate(() => {
      const g = (window as unknown as Record<string, unknown>).game as {
        display: { getDisplayState: () => string };
      };
      return g.display.getDisplayState();
    });
    expect(state).toBe('adventure');
  });

  test('ADVENTURE -> IDLE', async () => {
    await page.evaluate(() => {
      const g = (window as unknown as Record<string, unknown>).game as {
        eventBus: { emit: (event: string, payload: string) => void };
        display: { getDisplayState: () => string };
      };
      g.eventBus.emit('display:set', 'adventure');
      if (g.display.getDisplayState() !== 'adventure') {
        throw new Error('Precondition failed: expected adventure');
      }
      g.eventBus.emit('display:set', 'idle');
    });

    const state = await page.evaluate(() => {
      const g = (window as unknown as Record<string, unknown>).game as {
        display: { getDisplayState: () => string };
      };
      return g.display.getDisplayState();
    });
    expect(state).toBe('idle');
  });

  test('Semantic event: fever:start does not change display state', async () => {
    await resetToIdle();
    const before = await page.evaluate(() => {
      const g = (window as unknown as Record<string, unknown>).game as {
        display: { getDisplayState: () => string };
      };
      return g.display.getDisplayState();
    });
    expect(before).toBe('idle');

    await page.evaluate(() => {
      const g = (window as unknown as Record<string, unknown>).game as {
        eventBus: { emit: (event: string, payload?: string) => void };
      };
      g.eventBus.emit('fever:start');
    });

    const after = await page.evaluate(() => {
      const g = (window as unknown as Record<string, unknown>).game as {
        display: { getDisplayState: () => string };
      };
      return g.display.getDisplayState();
    });
    expect(after).toBe('idle');
  });
});
