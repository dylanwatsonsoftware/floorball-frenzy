import { test, expect } from '@playwright/test';

test('capture menu and game screenshots', async ({ page }) => {
  // Portrait
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('http://localhost:5173');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshot_menu_portrait.png' });

  // Click Local Match to go to GameScene
  // New startY = h * 0.60 = 506.4
  // New spacing = 115
  // y = 506.4 + 115 = 621
  await page.mouse.click(195, 621);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshot_game_portrait.png' });

  // Landscape
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto('http://localhost:5173');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshot_menu_landscape.png' });

  // Local Match in Landscape
  // startY = h * 0.65 = 390 * 0.65 = 253.5
  // spacing = min(h * 0.18, 95) = min(70.2, 95) = 70.2
  // y = 253.5 + 70.2 = 323.7
  await page.mouse.click(422, 324);
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'screenshot_game_landscape.png' });
});
