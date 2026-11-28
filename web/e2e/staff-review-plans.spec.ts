import { expect, test, type Page } from '@playwright/test'
import { demoAccounts, lecturerAccount } from '../server/auth/demo-accounts'
import type { ReviewPlan } from '../shared/staff-review'
import { studentNumberOf } from './reset-demo-accounts'

// The learning plan cards on the staff review, at desktop and phone width.
// Learning plans are append-only, so none is written to the database: the review
// is read for real and its plans are replaced on the way to the browser. That
// only reaches a fetch made by the browser, so the review is opened by its link.

const plans: ReviewPlan[] = [{
  moduleId: 'loops',
  moduleName: 'Loops',
  revisions: [
    { revision: 1, steps: [{ kind: 'materials', title: 'Read the module materials' }], currentStep: 0, agreedAt: null, time: '2026-11-19T07:00:00Z', trigger: null },
    {
      revision: 2,
      steps: [{ kind: 'materials', title: 'Read the module materials' }, { kind: 'quiz', title: 'Take the module quiz' }],
      currentStep: 1,
      agreedAt: '2026-11-19T07:05:00Z',
      time: '2026-11-19T07:05:00Z',
      trigger: 'step_done',
    },
  ],
}]

const widths = [
  { name: 'desktop', viewport: { width: 1440, height: 900 } },
  { name: 'phone', viewport: { width: 390, height: 844 } },
] as const

for (const width of widths) {
  test(`expands a learning plan card to its revisions at ${width.name} width`, async ({ page }) => {
    await page.setViewportSize(width.viewport)
    const studentNumber = await studentNumberOf(demoAccounts[0].email)
    await signIn(page, lecturerAccount)
    await expect(page).toHaveURL(/\/lecturer$/)
    await page.route('**/api/staff/review?*', async (route) => {
      const response = await route.fetch()
      await route.fulfill({ response, json: { ...await response.json(), plans } })
    })
    await page.locator(`a[href="/review/${studentNumber}"]`).click()

    const section = page.getByTestId('review-plans')
    const card = section.getByRole('button', { name: /Loops/ })
    await expect(card).toHaveAccessibleName(/Loops\s*Revision 2\s*Agreed/)
    await expect(card).toHaveAttribute('aria-expanded', 'false')
    await expect(section.getByText('Take the module quiz')).toBeHidden()

    await card.focus()
    await page.keyboard.press('Enter')
    await expect(card).toHaveAttribute('aria-expanded', 'true')
    await expect(section.locator('strong')).toHaveText(['Revision 1', 'Revision 2'])
    await expect(section.getByText('Because: step_done')).toBeVisible()
    await expect(section.locator('[aria-current="step"]').last()).toContainText('Take the module quiz (current)')

    await page.keyboard.press('Space')
    await expect(card).toHaveAttribute('aria-expanded', 'false')
    await expect(section.getByText('Take the module quiz')).toBeHidden()

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  })
}

async function signIn(page: Page, account: { email: string, password: string }) {
  await page.goto('/sign-in')
  await waitForApp(page)
  await page.getByLabel('Email').fill(account.email)
  await page.getByLabel('Password').fill(account.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).not.toHaveURL(/\/sign-in$/, { timeout: 60_000 })
  await waitForApp(page)
}

async function waitForApp(page: Page) {
  await page.waitForFunction(() => {
    const root = document.querySelector('#__nuxt') as (HTMLElement & { __vue_app__?: object }) | null
    return Boolean(root?.__vue_app__)
  })
}
