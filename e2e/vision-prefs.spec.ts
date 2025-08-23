import { test, expect, type Page } from '@playwright/test'

// Helpers to open drawer and expand Settings
async function openSettings(page: Page) {
  // Ensure app initialized
  await page.waitForSelector('#app', { state: 'attached' })
  // Try to find Settings without opening drawer
  let settingsCollapse = page.locator('.collapse', { has: page.locator('.collapse-title', { hasText: 'Settings' }) }).first()
  if (await settingsCollapse.count() === 0) {
    // Open drawer via Menu label (drawer toggle) if not visible yet
    const menuToggle = page.locator('label.drawer-button', { hasText: 'Menu' }).first()
    if (await menuToggle.count()) {
      await menuToggle.click()
    }
    settingsCollapse = page.locator('.collapse', { has: page.locator('.collapse-title', { hasText: 'Settings' }) }).first()
  }
  // Expand Settings collapse by setting its checkbox programmatically and dispatching events
  const settingsEl = await settingsCollapse.elementHandle()
  if (!settingsEl) throw new Error('Settings collapse not found')
  const settingsOpened = await page.evaluate((el: Element) => {
    const input = el.querySelector(':scope > input[type="checkbox"]') as HTMLInputElement | null
    if (!input) return false
    if (!input.checked) {
      input.checked = true
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }
    return input.checked
  }, settingsEl)
  if (!settingsOpened) throw new Error('Failed to open Settings collapse')
  await expect(settingsCollapse.locator(':scope > .collapse-content')).toBeVisible()
}

async function openSettingsSection(page: Page, sectionName: string) {
  // Ensure Settings is open first
  await openSettings(page)
  const settingsCollapse = page.locator('.collapse', { has: page.locator('.collapse-title', { hasText: 'Settings' }) }).first()
  const section = settingsCollapse.locator('.collapse', { has: page.locator('.collapse-title', { hasText: sectionName }) }).first()
  const sectionEl = await section.elementHandle()
  if (!sectionEl) throw new Error(`${sectionName} collapse not found`)
  const opened = await page.evaluate((el: Element) => {
    const input = el.querySelector(':scope > input[type="checkbox"]') as HTMLInputElement | null
    if (!input) return false
    if (!input.checked) {
      input.checked = true
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    }
    return input.checked
  }, sectionEl)
  if (!opened) throw new Error(`Failed to open ${sectionName} collapse`)
  await expect(section.locator(':scope > .collapse-content')).toBeVisible()
  return section
}

test.describe('Vision preferences persistence', () => {
  test.setTimeout(60000)
  test.beforeEach(async ({ page, context, baseURL }) => {
    // Ensure a clean prefs state and spy on localStorage.setItem before loading the app
    await context.addInitScript(() => {
      // Use sessionStorage so the marker survives reloads in the same tab
      try {
        const cleared = sessionStorage.getItem('__evo_prefs_cleared_once')
        if (!cleared) {
          try { localStorage.clear() } catch {}
          sessionStorage.setItem('__evo_prefs_cleared_once', '1')
        }
      } catch {}
      // Install spy (reset the calls array each navigation for simplicity)
      try {
        const orig = localStorage.setItem.bind(localStorage)
        // @ts-ignore
        const w: any = window
        w.__lsSetItemCalls = []
        localStorage.setItem = (key: string, value: string) => {
          try { w.__lsSetItemCalls.push({ key, len: value?.length ?? 0, ts: Date.now() }) } catch {}
          return orig(key, value)
        }
      } catch {}
    })
    // Capture console logs for assertions
    const logs: Array<{ type: string; text: string }> = []
    page.on('console', (msg) => {
      logs.push({ type: msg.type(), text: msg.text() })
    })
    // expose logs array getter for later evaluation if needed
    await page.exposeFunction('__getLogs', () => logs)
    // Ensure desktop viewport so inline controls (hidden md:flex) are visible
    await page.setViewportSize({ width: 1200, height: 900 })
    await page.goto(baseURL || '/')
  })

  test('show/fov/range persist to localStorage and survive reload', async ({ page }) => {
    // Open the right drawer (Menu)
    const menuBtn = page.locator('label.drawer-button', { hasText: 'Menu' })
    await menuBtn.click()

    // Expand Settings collapse (check the internal checkbox to avoid overlay intercepts)
    const settingsCollapse = page.locator('.drawer-side .collapse:has(.collapse-title:has-text("Settings"))')
    await settingsCollapse.waitFor({ state: 'visible' })
    const settingsToggle = settingsCollapse.locator('input[type="checkbox"]').first()
    const settingsContent = settingsCollapse.locator('.collapse-content')
    if (!(await settingsContent.isVisible())) {
      await settingsToggle.check({ force: true })
      await expect(settingsContent).toBeVisible()
    }

    // Use data-testid selectors for Vision controls inside Settings
    const visionCheckbox = page.getByTestId('settings-vision-toggle')
    await visionCheckbox.waitFor({ state: 'visible', timeout: 10000 })
    if (!(await visionCheckbox.isChecked())) {
      await visionCheckbox.check({ force: true })
    }

    const fovInput = page.getByTestId('settings-vision-fov')
    const rangeInput = page.getByTestId('settings-vision-range')

    // Set values and blur to trigger @change handlers
    await fovInput.fill('123')
    await fovInput.press('Tab')
    await rangeInput.fill('77')
    await rangeInput.press('Tab')

    // Click Apply to persist via App.vue applyVisionParams
    await page.locator('.drawer-side .collapse:has(.collapse-title:has-text("Settings"))').locator('button:has-text("Apply Vision")').click()

    // Wait for localStorage to reflect new values (in case of debounce or async)
    await page.waitForFunction(() => {
      try {
        const raw = localStorage.getItem('evo:ui-prefs')
        if (!raw) return false
        const prefs = JSON.parse(raw)
        return prefs?.vision?.fovDeg === 123 && prefs?.vision?.range === 77 && prefs?.vision?.show === true
      } catch { return false }
    }, { timeout: 2000 })
    const prefsRaw = await page.evaluate(() => localStorage.getItem('evo:ui-prefs'))
    expect(prefsRaw).toBeTruthy()
    const prefs = JSON.parse(prefsRaw!)
    expect(prefs.vision).toMatchObject({ show: true, fovDeg: 123, range: 77 })

    // Assert limited saves (debounced). Accept 1-2 writes total to evo:ui-prefs during this flow.
    const saveCalls: Array<{ key: string; len: number; ts: number }> = await page.evaluate(
      // @ts-ignore
      () => (window as any).__lsSetItemCalls || [],
    )
    const uiSaves = saveCalls.filter((c) => c.key === 'evo:ui-prefs')
    expect(uiSaves.length).toBeGreaterThanOrEqual(1)
    expect(uiSaves.length).toBeLessThanOrEqual(3)

    // Reload and re-assert
    await page.reload()
    await page.waitForTimeout(300)
    // First, confirm localStorage still has expected values after reload
    const afterRaw = await page.evaluate(() => localStorage.getItem('evo:ui-prefs'))
    expect(afterRaw).toBeTruthy()
    const afterPrefs = JSON.parse(afterRaw!)
    console.log('After reload ui-prefs:', afterPrefs)
    expect(afterPrefs.vision).toMatchObject({ show: true, fovDeg: 123, range: 77 })

    // Re-open drawer and Settings to read UI values
    await page.locator('label.drawer-button', { hasText: 'Menu' }).click()
    const settingsCollapse2 = page.locator('.drawer-side .collapse:has(.collapse-title:has-text("Settings"))')
    const settingsToggle2 = settingsCollapse2.locator('input[type="checkbox"]').first()
    const settingsContent2 = settingsCollapse2.locator('.collapse-content')
    if (!(await settingsContent2.isVisible())) {
      await settingsToggle2.check({ force: true })
      await expect(settingsContent2).toBeVisible()
    }
    // Wait for hydration to apply saved values
    await page.waitForFunction(() => {
      const fovEl = document.querySelector('[data-testid="settings-vision-fov"]') as HTMLInputElement | null
      const rngEl = document.querySelector('[data-testid="settings-vision-range"]') as HTMLInputElement | null
      const togEl = document.querySelector('[data-testid="settings-vision-toggle"]') as HTMLInputElement | null
      return !!fovEl && !!rngEl && !!togEl && Number(fovEl.value) === 123 && Number(rngEl.value) === 77 && togEl.checked === true
    }, { timeout: 4000 })
    const fovVal = await page.getByTestId('settings-vision-fov').inputValue()
    const rangeVal = await page.getByTestId('settings-vision-range').inputValue()
    const showChecked = await page.getByTestId('settings-vision-toggle').isChecked()
    expect(Number(fovVal)).toBe(123)
    expect(Number(rangeVal)).toBe(77)
    expect(showChecked).toBe(true)

    // Assert no known error/warning logs appeared
    const logs: Array<{ type: string; text: string }> = await page.evaluate(() => {
      // @ts-ignore
      return (window as any).__getLogs ? (window as any).__getLogs() : []
    })
    const allText = logs.map((l) => `${l.type}:${l.text}`).join('\n')
    // Negative assertions
    expect(allText).not.toMatch(/readonly proxy/i)
    expect(allText).not.toMatch(/existing context of a different type/i)
    expect(allText).not.toMatch(/Step is still running/i)
  })
})
