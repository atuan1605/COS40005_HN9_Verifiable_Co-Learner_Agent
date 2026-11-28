import { expect, test, type Page } from '@playwright/test'
import { demoAccounts, lecturerAccount, productOwnerAccount } from '../server/auth/demo-accounts'
import { resetDemoAccounts, studentNumberOf } from './reset-demo-accounts'

// The Course progress section on the staff review, at desktop and phone width:
// the heading, the x/total figure and the Unlocked and Closed capsules.

const widths = [
  { name: 'desktop', viewport: { width: 1440, height: 900 } },
  { name: 'phone', viewport: { width: 390, height: 844 } },
] as const

test.beforeAll(async () => {
  await resetDemoAccounts()
})

for (const width of widths) {
  test(`shows Course progress with a capsule for each module at ${width.name} width`, async ({ page }) => {
    await page.setViewportSize(width.viewport)
    // An has no evidence, so only the first module is open.
    const studentNumber = await studentNumberOf(demoAccounts[0].email)
    await signIn(page, lecturerAccount)
    await expect(page).toHaveURL(/\/lecturer$/)
    await page.goto(`/review/${studentNumber}`)
    await waitForApp(page)

    const section = page.getByTestId('review-course-progress')
    await expect(section.getByRole('heading', { name: 'Course progress' })).toBeVisible()
    await expect(section.getByText('0/11 · 0%')).toBeVisible()
    await expect(section.getByRole('progressbar', { name: 'Course progress' })).toHaveAttribute('aria-valuenow', '0')
    await expect(section.getByRole('listitem')).toHaveCount(11)
    await expect(section.getByText('Unlocked', { exact: true })).toHaveCount(1)
    await expect(section.getByText('Closed', { exact: true })).toHaveCount(10)
    await expect(section.getByRole('listitem').first()).toContainText('Unlocked')

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  })
}

test('shows an administrator no Course progress', async ({ page }) => {
  const studentNumber = await studentNumberOf(demoAccounts[0].email)
  await signIn(page, productOwnerAccount)
  await page.goto(`/review/${studentNumber}`)
  await waitForApp(page)

  await expect(page.getByTestId('review-plans')).toBeVisible()
  await expect(page.getByTestId('review-course-progress')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Course progress' })).toHaveCount(0)
})

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
