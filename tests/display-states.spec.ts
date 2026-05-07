import { test, expect } from '@playwright/test';

test.setTimeout(180_000);

test.beforeEach(async ({ page }) => {
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

test('IDLE is default', async ({ page }) => {
  const state = await page.evaluate(() => {
    const g = (window as unknown as Record<string, unknown>).game as {
      display: { getDisplayState: () => string };
    };
    return g.display.getDisplayState();
  });
  expect(state).toBe('idle');
});

test('IDLE -> FEVER', async ({ page }) => {
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

test('FEVER -> IDLE', async ({ page }) => {
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

test('IDLE -> REACH', async ({ page }) => {
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

test('REACH -> IDLE', async ({ page }) => {
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

test('IDLE -> JACKPOT', async ({ page }) => {
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

test('JACKPOT -> IDLE', async ({ page }) => {
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

test('IDLE -> ADVENTURE', async ({ page }) => {
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

test('ADVENTURE -> IDLE', async ({ page }) => {
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

test('Semantic event: fever:start does not change display state', async ({ page }) => {
  const before = await page.evaluate(() => {
    const g = (window as unknown as Record<string, unknown>).game as {
      display: { getDisplayState: () => string };
      eventBus: { emit: (event: string, payload?: string) => void };
    };
    // Ensure we start from idle
    g.eventBus.emit('display:set', 'idle');
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
