import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage();
const logs = [];
page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', err => logs.push(`[pageerror] ${err.message}`));

await page.goto('http://localhost:5173');
await page.waitForTimeout(5000);

// Start the game - usually press Enter or click
await page.keyboard.press('Enter');
await page.waitForTimeout(2000);

const state = await page.evaluate(() => {
  const g = window.game;
  if (!g) return { error: 'no window.game' };
  const left = g.gameObjects?.getFlipper?.('left');
  const right = g.gameObjects?.getFlipper?.('right');
  const joints = g.gameObjects?.getFlipperJoints?.();
  const getRot = (b) => b ? b.rotation() : null;
  return {
    gameState: g.stateManager?.getState?.(),
    leftRot: getRot(left?.body),
    rightRot: getRot(right?.body),
    hasLeftJoint: !!joints?.left,
    hasRightJoint: !!joints?.right,
  };
});
console.log('Before press:', JSON.stringify(state, null, 2));

// Press Shift (left flipper)
await page.keyboard.down('ShiftLeft');
await page.waitForTimeout(500);

const stateAfter = await page.evaluate(() => {
  const g = window.game;
  const left = g.gameObjects?.getFlipper?.('left');
  const joint = g.gameObjects?.getFlipperJoints?.()?.left;
  return {
    leftRot: left?.body?.rotation(),
    leftSleeping: left?.body?.isSleeping(),
    leftAngVel: left?.body?.angvel?.(),
    jointInfo: joint ? 'exists' : 'null',
  };
});
console.log('After ShiftLeft down:', JSON.stringify(stateAfter, null, 2));

await page.keyboard.up('ShiftLeft');

console.log('--- Console logs ---');
console.log(logs.slice(-50).join('\n'));

await browser.close();
