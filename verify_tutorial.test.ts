import { test, expect } from '@playwright/test';

test('Tutorial triggers automatically on first local match', async ({ page }) => {
  await page.goto('http://localhost:5173');

  // Ensure localStorage is empty for the tutorial flag
  await page.evaluate(() => localStorage.removeItem('floorball:tutorialDone'));

  // Click Local Match
  // Based on previous knowledge, coordinates for Local Match on 1280x720 are approx (640, 585)
  // Let's use a more robust way if possible, but coordinates worked before.
  await page.mouse.click(640, 585);

  // Wait for TutorialScene to be launched.
  // We can check for the "Movement" text which is the first step title.
  await expect(page.locator('text=Movement')).toBeVisible({ timeout: 5000 });

  // Verify it says "Virtual Joystick" in the description
  await expect(page.locator('text=Virtual Joystick')).toBeVisible();

  // Click NEXT
  await page.mouse.click(640, 685);
  await expect(page.locator('text=Slap Hit')).toBeVisible();

  // Click NEXT
  await page.mouse.click(640, 685);
  await expect(page.locator('text=Quick Dash')).toBeVisible();

  // Click NEXT
  await page.mouse.click(640, 685);
  await expect(page.locator('text=Scoring Goals')).toBeVisible();

  // Click START
  await page.mouse.click(640, 685);

  // Tutorial should be gone, game should be resumed (e.g. Back button should be visible)
  await expect(page.locator('text=Movement')).not.toBeVisible();
  await expect(page.locator('text=BACK')).toBeVisible();

  // Check localStorage
  const tutorialDone = await page.evaluate(() => localStorage.getItem('floorball:tutorialDone'));
  expect(tutorialDone).toBe('true');
});
