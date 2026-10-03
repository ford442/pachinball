import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 800, height: 900 } });
const logs = [];
page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));
page.on('pageerror', err => logs.push(`[pageerror] ${err.message}`));

await page.goto('http://localhost:5173');
await page.waitForTimeout(5000);
await page.keyboard.press('Enter');
await page.waitForTimeout(2000);

await page.screenshot({ path: '/tmp/before.png' });

const before = await page.evaluate(() => {
  const g = window.game;
  const left = g.gameObjects?.getFlipper?.('left');
  const right = g.gameObjects?.getFlipper?.('right');
  const plunger = g.gameObjects?.getPlungerBody?.();
  return {
    leftMeshRot: left?.mesh?.rotationQuaternion ? {...left.mesh.rotationQuaternion} : null,
    rightMeshRot: right?.mesh?.rotationQuaternion ? {...right.mesh.rotationQuaternion} : null,
    leftBodyRot: left?.body?.rotation(),
    plungerPos: plunger ? plunger.translation() : null,
  };
});
console.log('BEFORE', JSON.stringify(before, null, 2));

// Hold shift for 1 second
await page.keyboard.down('ShiftLeft');
await page.keyboard.down('ShiftRight');
await page.waitForTimeout(800);

const during = await page.evaluate(() => {
  const g = window.game;
  const left = g.gameObjects?.getFlipper?.('left');
  const right = g.gameObjects?.getFlipper?.('right');
  return {
    leftMeshRot: left?.mesh?.rotationQuaternion ? {...left.mesh.rotationQuaternion} : null,
    rightMeshRot: right?.mesh?.rotationQuaternion ? {...right.mesh.rotationQuaternion} : null,
    leftBodyRot: left?.body?.rotation(),
    rightBodyRot: right?.body?.rotation(),
  };
});
console.log('DURING PRESS', JSON.stringify(during, null, 2));
await page.screenshot({ path: '/tmp/during-press.png' });

await page.keyboard.up('ShiftLeft');
await page.keyboard.up('ShiftRight');

// Now test plunger - hold space (or whatever key)
await page.waitForTimeout(500);
const beforePlunger = await page.evaluate(() => {
  const g = window.game;
  const plunger = g.gameObjects?.getPlungerBody?.();
  return { plungerPos: plunger ? plunger.translation() : null };
});
console.log('BEFORE PLUNGER', JSON.stringify(beforePlunger));

await page.keyboard.down('Space');
await page.waitForTimeout(400);
const duringPlunger = await page.evaluate(() => {
  const g = window.game;
  const plunger = g.gameObjects?.getPlungerBody?.();
  return { plungerPos: plunger ? plunger.translation() : null, chargeLevel: g.plungerChargeLevel };
});
console.log('DURING PLUNGER HOLD', JSON.stringify(duringPlunger));
await page.keyboard.up('Space');
await page.waitForTimeout(500);

console.log('--- Console logs (last 20) ---');
console.log(logs.slice(-20).join('\n'));

await browser.close();
