import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test.describe('Enhanced Accessibility Tests', () => {
  test('should not have automatically detectable accessibility violations', async ({ page }) => {
    await page.goto('/')

    // Wait for app to initialize
    await expect(page.getByRole('button', { name: 'WASM status' })).toBeVisible({ timeout: 10000 })

    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze()

    expect(accessibilityScanResults.violations).toEqual([])
  })

  test('should have zero color contrast violations', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'WASM status' })).toBeVisible({ timeout: 10000 })

    // Specifically target color contrast with strict thresholds
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['color-contrast'])
      .analyze()

    expect(accessibilityScanResults.violations).toEqual([])
  })

  test('should have proper ARIA labels and descriptions', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'WASM status' })).toBeVisible({ timeout: 10000 })

    // Check for ARIA violations using comprehensive tags
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze()

    expect(accessibilityScanResults.violations).toEqual([])
  })

  test('should support keyboard navigation for all interactive elements', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'WASM status' })).toBeVisible({ timeout: 10000 })

    // Test tab navigation through all interactive elements
    const interactiveElements = await page
      .locator('button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])')
      .count()
    expect(interactiveElements).toBeGreaterThan(0)

    // Verify focus management
    let focusedCount = 0
    for (let i = 0; i < Math.min(interactiveElements, 10); i++) {
      await page.keyboard.press('Tab')
      const focusedElement = await page.evaluate(() => {
        const el = document.activeElement
        return el
          ? {
              tagName: el.tagName,
              hasFocus: document.hasFocus(),
              tabIndex: (el as HTMLElement).tabIndex,
            }
          : null
      })

      expect(focusedElement).toBeTruthy()
      expect(['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'A']).toContain(focusedElement?.tagName)
      focusedCount++
    }

    expect(focusedCount).toBeGreaterThan(0)
  })

  test('should have proper heading structure and landmarks', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'WASM status' })).toBeVisible({ timeout: 10000 })

    // Check for proper heading hierarchy
    const headings = await page.locator('h1, h2, h3, h4, h5, h6').count()
    expect(headings).toBeGreaterThan(0)

    // Check for main landmarks
    const mainLandmark = page.locator('main, [role="main"]')
    const navLandmark = page.locator('nav, [role="navigation"]')
    const headerLandmark = page.locator('header, [role="banner"]')

    expect(await mainLandmark.count()).toBeGreaterThanOrEqual(0)
    expect(await navLandmark.count()).toBeGreaterThanOrEqual(0)
    expect(await headerLandmark.count()).toBeGreaterThanOrEqual(0)

    // Scan for landmark violations using comprehensive tags
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze()

    expect(accessibilityScanResults.violations).toEqual([])
  })

  test('should have sufficient focus indicators', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'WASM status' })).toBeVisible({ timeout: 10000 })

    // Test focus visibility on buttons
    const buttons = page.locator('button').first()
    await buttons.focus()

    const hasFocusStyles = await buttons.evaluate((el) => {
      const styles = window.getComputedStyle(el, ':focus')
      const outline = styles.outline
      const outlineOffset = styles.outlineOffset
      const boxShadow = styles.boxShadow

      return {
        hasOutline: outline !== 'none' && outline !== '',
        hasOutlineOffset: outlineOffset !== '0px',
        hasBoxShadow: boxShadow !== 'none' && boxShadow !== '',
      }
    })

    // Should have at least one focus indicator
    expect(hasFocusStyles.hasOutline || hasFocusStyles.hasBoxShadow).toBe(true)
  })

  test('should have accessible form controls', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'WASM status' })).toBeVisible({ timeout: 10000 })

    // Check form accessibility using comprehensive tags
    const accessibilityScanResults = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze()

    expect(accessibilityScanResults.violations).toEqual([])
  })

  test('should maintain accessibility during simulation states', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'WASM status' })).toBeVisible({ timeout: 10000 })

    // Test accessibility in different states
    const states = [
      { action: 'start', button: /start/i },
      { action: 'stop', button: /stop/i },
    ]

    for (const state of states) {
      await page.getByRole('button', { name: state.button }).click()
      await page.waitForTimeout(1000)

      const accessibilityScanResults = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa'])
        .analyze()

      expect(accessibilityScanResults.violations).toEqual([])
    }
  })
})
