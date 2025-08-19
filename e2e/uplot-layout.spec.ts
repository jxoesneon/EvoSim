import { test, expect } from '@playwright/test'

// Layout test for minimal uPlot stacked area chart
// Renders Summary modal via query param and verifies chart DOM and sizing

test.describe('uPlot stacked area layout', () => {
  test('renders and keeps stable size', async ({ page }) => {
    await page.goto('/?uplot=1')

    const root = page.locator('[data-testid="uplot-root"]')
    await expect(root).toBeVisible()

    // Wait for uPlot to mount a canvas inside the root
    const canvas = root.locator('canvas')
    await expect(canvas).toBeVisible()

    // Initial size assertions
    const box1 = await canvas.boundingBox()
    expect(box1).not.toBeNull()
    if (!box1) return

    // Width should be reasonable and height positive (fixed to wrapper height)
    expect.soft(box1.width).toBeGreaterThan(150)
    expect.soft(box1.height).toBeGreaterThan(100)
    expect.soft(box1.height).toBeLessThan(800)

    // Resize viewport to trigger ResizeObserver width update (height stays fixed)
    await page.setViewportSize({ width: 900, height: 720 })
    await page.waitForTimeout(100)
    const box2 = await canvas.boundingBox()
    expect(box2).not.toBeNull()
    if (!box2) return

    // Height should remain stable (allow small variance), width should likely change
    const hDelta = Math.abs((box2.height ?? 0) - box1.height)
    expect.soft(hDelta).toBeLessThanOrEqual(5)

    // Try another width to verify reactive width behavior
    await page.setViewportSize({ width: 1100, height: 720 })
    await page.waitForTimeout(100)
    const box3 = await canvas.boundingBox()
    expect(box3).not.toBeNull()
    if (!box3) return

    // Height stable again
    const hDelta2 = Math.abs((box3.height ?? 0) - (box2.height ?? 0))
    expect.soft(hDelta2).toBeLessThanOrEqual(5)
  })
})
