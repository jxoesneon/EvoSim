import { test, expect } from '@playwright/test'

test('visits the app root url', async ({ page }) => {
  await page.goto('/')
  // Basic smoke: main content area renders
  await expect(page.locator('main')).toBeVisible()
})
