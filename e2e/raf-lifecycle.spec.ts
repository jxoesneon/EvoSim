import { test, expect } from '@playwright/test'

test.describe('RAF lifecycle and WebGL disposal', () => {
  test.setTimeout(60000)

  test('renderer can unmount and remount without RAF or WebGL issues', async ({ page, baseURL }) => {
    // Capture console logs
    const logs: Array<{ type: string; text: string }> = []
    page.on('console', (msg) => logs.push({ type: msg.type(), text: msg.text() }))

    await page.goto(baseURL || '/')
    await page.waitForSelector('#app', { state: 'attached' })
    await page.waitForSelector('#ecosystemCanvas', { state: 'attached' })

    // Unmount renderer via exposed test hook
    await page.evaluate(() => {
      // @ts-ignore
      if (typeof (window as any).__toggleRenderer === 'function') (window as any).__toggleRenderer()
    })
    // Canvas should be gone
    await page.waitForSelector('#ecosystemCanvas', { state: 'detached' })

    // Short pause allowing cleanup to run
    await page.waitForTimeout(200)

    // Remount
    await page.evaluate(() => {
      // @ts-ignore
      if (typeof (window as any).__toggleRenderer === 'function') (window as any).__toggleRenderer()
    })
    await page.waitForSelector('#ecosystemCanvas', { state: 'attached' })

    // Toggle once more to ensure multiple mount cycles are clean
    await page.evaluate(() => {
      // @ts-ignore
      if (typeof (window as any).__toggleRenderer === 'function') (window as any).__toggleRenderer()
    })
    await page.waitForSelector('#ecosystemCanvas', { state: 'detached' })
    await page.waitForTimeout(200)
    await page.evaluate(() => {
      // @ts-ignore
      if (typeof (window as any).__toggleRenderer === 'function') (window as any).__toggleRenderer()
    })
    await page.waitForSelector('#ecosystemCanvas', { state: 'attached' })

    // Assert no known problematic warnings/errors
    const all = logs.map((l) => `${l.type}:${l.text}`).join('\n')
    expect(all).not.toMatch(/Step is still running/i)
    expect(all).not.toMatch(/existing context of a different type/i)
    expect(all).not.toMatch(/context.*lost/i)
    expect(all).not.toMatch(/readonly proxy/i)
  })
})
