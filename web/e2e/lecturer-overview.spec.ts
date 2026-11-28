import { expect, test, type Page } from '@playwright/test'
import { lecturerAccount } from '../server/auth/demo-accounts'
import { resetDemoAccounts } from './reset-demo-accounts'

// The lecturer's Overview: the class totals, the two pies, the students table and the filters over
// them, at desktop
// and phone width. From supabase/seed.sql, Bình is at 36% (part way) and, once reset, An is at 0%.
const widths = [
  { name: 'desktop', viewport: { width: 1440, height: 900 } },
  { name: 'phone', viewport: { width: 390, height: 844 } },
] as const

test.beforeAll(async () => {
  await resetDemoAccounts()
})

for (const width of widths) {
  test(`summarises the class above the enrolled students at ${width.name} width`, async ({ page }) => {
    await page.setViewportSize(width.viewport)
    await signInAsLecturer(page)

    await expect(page.getByTestId('enrollment-count')).toContainText('2')
    const progress = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Where students are' }) }).last()
    await expect(progress.getByRole('listitem').filter({ hasText: 'Not started' })).toContainText('1')
    await expect(progress.getByRole('listitem').filter({ hasText: 'Part way' })).toContainText('1')
    await expect(page.getByRole('heading', { name: 'Modules across the class' })).toBeVisible()

    const rows = page.getByTestId('course-students').locator('tbody tr')
    await expect(rows).toHaveCount(2)
    await expect(rows.filter({ hasText: 'binh@example.com' }).getByTestId('student-progress')).toContainText('4/11 · 36%')

    // The filters narrow the totals, the module pie and the table together.
    await page.getByLabel('Course progress', { exact: true }).selectOption('part-way')
    await expect(page.getByTestId('overview-student-count')).toHaveText('1 of 2 students shown')
    await expect(rows).toHaveCount(1)
    // The progress pie keeps the other groups and marks the chosen one.
    await expect(progress.getByRole('listitem').filter({ hasText: 'Not started' })).toContainText('1')
    await expect(progress.locator('[aria-current="true"]')).toContainText('Part way')
    await expect(page.getByTestId('enrollment-count')).toContainText('2')
    await page.getByLabel('Search students').fill('nobody')
    await expect(page.getByText('No students match these filters.')).toBeVisible()
    await page.getByRole('button', { name: 'Clear filters' }).click()
    await expect(rows).toHaveCount(2)
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false)
  })
}

async function signInAsLecturer(page: Page) {
  await page.goto('/sign-in')
  await waitForApp(page)
  await page.getByLabel('Email').fill(lecturerAccount.email)
  await page.getByLabel('Password').fill(lecturerAccount.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).toHaveURL(/\/lecturer$/)
  await waitForApp(page)
}

async function waitForApp(page: Page) {
  await page.waitForFunction(() => {
    const root = document.querySelector('#__nuxt') as (HTMLElement & { __vue_app__?: object }) | null
    return Boolean(root?.__vue_app__)
  })
}
