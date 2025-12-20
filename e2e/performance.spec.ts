import { test, expect } from '@playwright/test'

// Performance smoke and soak tests with comprehensive monitoring
test.describe('Performance Tests', () => {
  test('should run for 5 seconds without critical errors', async ({ page }) => {
    const errors: string[] = []
    const warnings: string[] = []

    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
      if (msg.type() === 'warning') warnings.push(msg.text())
    })

    await page.goto('/')
    await expect(page.getByRole('button', { name: 'WASM status' })).toBeVisible({ timeout: 10000 })

    // Start simulation
    await page.getByRole('button', { name: /start/i }).click()

    // Let simulation run for 5 seconds
    await page.waitForTimeout(5000)

    // Stop simulation
    await page.getByRole('button', { name: /stop/i }).click()

    const criticalErrors = errors.filter((e) => !e.includes('DevTools') && !e.includes('favicon'))

    expect(criticalErrors).toHaveLength(0)
    expect(warnings.length).toBeLessThan(5)
  })

  test('should maintain performance during 30-second soak test', async ({ page }) => {
    const errors: string[] = []
    const warnings: string[] = []
    const memorySnapshots: number[] = []
    const fpsReadings: number[] = []

    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
      if (msg.type() === 'warning') warnings.push(msg.text())
    })

    await page.goto('/')
    await expect(page.getByRole('button', { name: 'WASM status' })).toBeVisible({ timeout: 10000 })

    // Start simulation
    await page.getByRole('button', { name: /start/i }).click()

    // Monitor performance for 30 seconds with periodic checks
    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(5000)

      // Collect memory metrics using evaluate
      const memoryInfo = await page.evaluate(() => {
        if ('memory' in performance) {
          const memory = (performance as any).memory
          return memory.usedJSHeapSize
        }
        return 0
      })

      if (memoryInfo > 0) {
        memorySnapshots.push(memoryInfo)
      }

      // Check for memory leaks (should not grow indefinitely)
      if (memorySnapshots.length > 1) {
        const recentGrowth = memorySnapshots.slice(-3)
        const avgGrowth = (recentGrowth[2] - recentGrowth[0]) / 2
        expect(avgGrowth).toBeLessThan(10 * 1024 * 1024) // Less than 10MB growth per 10s
      }

      // Verify simulation is still responsive
      const isRunning = await page.getByRole('button', { name: /stop/i }).isVisible()
      expect(isRunning).toBe(true)
    }

    // Stop simulation
    await page.getByRole('button', { name: /stop/i }).click()

    const criticalErrors = errors.filter((e) => !e.includes('DevTools') && !e.includes('favicon'))

    expect(criticalErrors).toHaveLength(0)
    expect(warnings.length).toBeLessThan(10) // Allow more warnings for longer test
    expect(memorySnapshots.length).toBeGreaterThan(0)
  })

  test('should handle rapid start/stop cycles without memory leaks', async ({ page }) => {
    const errors: string[] = []
    const memoryBefore: number[] = []
    const memoryAfter: number[] = []

    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text())
    })

    await page.goto('/')
    await expect(page.getByRole('button', { name: 'WASM status' })).toBeVisible({ timeout: 10000 })

    // Collect initial memory reading
    const initialMemory = await page.evaluate(() => {
      if ('memory' in performance) {
        const memory = (performance as any).memory
        return memory.usedJSHeapSize
      }
      return 0
    })

    if (initialMemory > 0) {
      memoryBefore.push(initialMemory)
    }

    // Perform 10 rapid start/stop cycles
    for (let i = 0; i < 10; i++) {
      await page.getByRole('button', { name: /start/i }).click()
      await page.waitForTimeout(1000) // Run for 1 second
      await page.getByRole('button', { name: /stop/i }).click()
      await page.waitForTimeout(500) // Brief pause

      if (i >= 7) {
        // Capture last few memory readings
        const memoryInfo = await page.evaluate(() => {
          if ('memory' in performance) {
            const memory = (performance as any).memory
            return memory.usedJSHeapSize
          }
          return 0
        })

        if (memoryInfo > 0) {
          memoryAfter.push(memoryInfo)
        }
      }
    }

    const criticalErrors = errors.filter((e) => !e.includes('DevTools') && !e.includes('favicon'))

    expect(criticalErrors).toHaveLength(0)

    // Check memory didn't grow significantly during cycles
    if (memoryBefore.length > 0 && memoryAfter.length > 0) {
      const avgBefore = memoryBefore.slice(-3).reduce((a, b) => a + b, 0) / 3
      const avgAfter = memoryAfter.slice(-3).reduce((a, b) => a + b, 0) / 3
      const growth = avgAfter - avgBefore
      expect(growth).toBeLessThan(5 * 1024 * 1024) // Less than 5MB growth
    }
  })

  test('should maintain responsive UI under load', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: 'WASM status' })).toBeVisible({ timeout: 10000 })

    // Start simulation with high creature count if possible
    await page.getByRole('button', { name: /start/i }).click()
    await page.waitForTimeout(3000)

    // Test UI responsiveness by clicking buttons quickly
    const buttons = [
      page.getByRole('button', { name: /fps/i }),
      page.getByRole('button', { name: /vision/i }),
    ]

    for (const button of buttons) {
      if (await button.isVisible()) {
        const startTime = Date.now()
        await button.click()
        const responseTime = Date.now() - startTime
        expect(responseTime).toBeLessThan(1000) // Should respond within 1 second
      }
    }

    await page.getByRole('button', { name: /stop/i }).click()
  })
})
