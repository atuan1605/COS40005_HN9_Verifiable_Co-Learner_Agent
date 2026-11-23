import { expect, test, type Page } from '@playwright/test'
import { demoAccounts } from '../server/auth/demo-accounts'
import { resetDemoAccounts } from './reset-demo-accounts'

// The study suggestion is a toast over a usable workspace. The server's redraw is the seam:
// the spec adds a suggestion to the `open` redraw and watches what the page posts back.

const anAccount = demoAccounts.find(account => account.displayName === 'An')
const suggestion = {
  key: 'e2e-step',
  sentence: 'Try the quiz on this module before the next exercise.',
  button: 'Open the quiz',
  action: { kind: 'learn', moduleId: 'placeholder' },
}

test.beforeAll(async () => {
  await resetDemoAccounts()
})

test.afterAll(async () => {
  await resetDemoAccounts()
})

test('shows the toast without blocking the workspace, and closes and dismisses after 10 seconds', async ({ page }) => {
  const dismissals = await openWithSuggestion(page)
  const toast = page.locator('[data-study-suggestion]')
  await expect(toast).toBeVisible()
  await expect(toast).toHaveAttribute('aria-live', 'polite')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(toast).not.toBeFocused()

  const composer = page.getByRole('textbox', { name: 'Message' })
  await composer.click()
  await composer.fill('still usable')
  await expect(composer).toHaveValue('still usable')

  await expect(toast).toBeHidden({ timeout: 13_000 })
  expect(dismissals).toEqual(['e2e-step'])
})

test('pauses the timer while the pointer is on the toast', async ({ page }) => {
  const dismissals = await openWithSuggestion(page)
  const toast = page.locator('[data-study-suggestion]')
  await toast.hover()
  await page.waitForTimeout(11_000)
  await expect(toast).toBeVisible()
  expect(dismissals).toEqual([])
  await page.mouse.move(0, 0)
  await expect(toast).toBeHidden({ timeout: 13_000 })
})

test('closes and dismisses with X and with Escape from inside the toast', async ({ page }) => {
  const dismissals = await openWithSuggestion(page)
  const toast = page.locator('[data-study-suggestion]')
  await toast.getByRole('button', { name: 'Close suggestion' }).click()
  await expect(toast).toBeHidden()
  expect(dismissals).toEqual(['e2e-step'])

  await page.reload()
  await expect(toast).toBeVisible({ timeout: 60_000 })
  // Escape elsewhere in the workspace belongs to whatever has focus there.
  await page.keyboard.press('Escape')
  await expect(toast).toBeVisible()
  expect(dismissals).toEqual(['e2e-step'])
  await toast.getByRole('button', { name: 'Close suggestion' }).focus()
  await page.keyboard.press('Escape')
  await expect(toast).toBeHidden()
  expect(dismissals).toEqual(['e2e-step', 'e2e-step'])
})

test('keeps the toast up with an error when the dismissal fails', async ({ page }) => {
  await openWithSuggestion(page, { failDismissal: true })
  const toast = page.locator('[data-study-suggestion]')
  await toast.getByRole('button', { name: 'Close suggestion' }).click()
  await expect(toast.getByRole('alert')).toHaveText('That could not be saved. Try again.')
  await page.waitForTimeout(11_000)
  await expect(toast).toBeVisible()
})

async function openWithSuggestion(page: Page, options: { failDismissal?: boolean } = {}) {
  if (!anAccount) throw new Error('Demo account An is missing.')
  const dismissals: string[] = []
  await page.route('**/turn', async (route) => {
    const body = route.request().postDataJSON() as { event?: string, key?: string } | null
    if (body?.event === 'dismiss_study_suggestion') {
      dismissals.push(body.key ?? '')
      if (options.failDismissal) return route.fulfill({ status: 500, body: '{}' })
      const response = await route.fetch({ postData: JSON.stringify({ event: 'open' }) })
      return route.fulfill({ response, json: { ...await response.json(), studySuggestion: null } })
    }
    if (body?.event !== 'open') return route.continue()
    const response = await route.fetch()
    const state = await response.json()
    const moduleId = state.workingArea.moduleId
    return route.fulfill({ response, json: { ...state, studySuggestion: { ...suggestion, action: { kind: 'learn', moduleId } } } })
  })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/sign-in')
  await page.getByLabel('Email').fill(anAccount.email)
  await page.getByLabel('Password').fill(anAccount.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.locator('[data-study-suggestion]')).toBeVisible({ timeout: 60_000 })
  return dismissals
}
