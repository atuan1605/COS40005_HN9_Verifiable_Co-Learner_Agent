import { expect, test, type Page } from '@playwright/test'
import { demoAccounts, lecturerAccount } from '../server/auth/demo-accounts'
import type { ReviewEvent, ReviewSignal, StaffReview } from '../shared/staff-review'
import { studentNumberOf } from './reset-demo-accounts'

// The Latest activity table on the staff review, at desktop and phone width: its
// pages, and a review signal's link into them. The review is read for real and
// its activity and signals are replaced on the way to the browser, so the log has
// a known length and nothing is written to it. That only reaches a fetch made by
// the browser, so the review is opened by its link.

// 45 events, newest first. The oldest id is far below the rest, as an older event
// a signal links to is.
const activity: ReviewEvent[] = [...Array.from({ length: 44 }, (_, index) => event(144 - index)), event(7)]
const signals: ReviewSignal[] = [
  { kind: 'pass_without_run', moduleId: 'loops', exerciseId: 'loops-1', summary: 'Passed without a run.', eventIds: [7] },
]

const widths = [
  { name: 'desktop', viewport: { width: 1440, height: 900 } },
  { name: 'phone', viewport: { width: 390, height: 844 } },
] as const

for (const width of widths) {
  test(`pages the latest activity and follows a signal to a later page at ${width.name} width`, async ({ page }) => {
    await page.setViewportSize(width.viewport)
    await openReview(page, { activity, signals })

    const section = page.getByTestId('review-activity')
    const table = section.getByRole('table', { name: 'Latest activity' })
    const rows = table.locator('tbody tr')
    const pages = section.getByRole('navigation', { name: 'Activity pages' })
    const previous = pages.getByRole('button', { name: 'Previous' })
    const next = pages.getByRole('button', { name: 'Next' })

    await expect(table.getByRole('columnheader')).toHaveText(['#', 'Event', 'Details', 'Time'])
    await expect(rows).toHaveCount(20)
    await expect(rows.first().locator('td').first()).toHaveText('144')
    await expect(pages).toContainText('Page 1 of 3')
    await expect(previous).toBeDisabled()

    await next.click()
    await expect(pages).toContainText('Page 2 of 3')
    await expect(rows.first().locator('td').first()).toHaveText('124')
    await previous.click()
    await expect(pages).toContainText('Page 1 of 3')

    const link = page.getByTestId('review-signals').getByRole('link', { name: '#7' })
    await link.click()
    await expect(pages).toContainText('Page 3 of 3')
    await expect(rows).toHaveCount(5)
    await expect(next).toBeDisabled()
    const linked = table.locator('#event-7')
    await expect(linked).toHaveAttribute('aria-current', 'true')
    await expect(linked).toBeInViewport()

    // The same link works again after paging away.
    await previous.click()
    await link.click()
    await expect(pages).toContainText('Page 3 of 3')
    await expect(linked).toBeInViewport()

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  })
}

test('says there is no activity when the log is empty', async ({ page }) => {
  await openReview(page, { activity: [], signals: [] })
  const section = page.getByTestId('review-activity')
  await expect(section.getByText('No activity yet.')).toBeVisible()
  await expect(section.getByRole('table')).toHaveCount(0)
})

function event(id: number): ReviewEvent {
  return { id, type: 'code_run', time: '2026-11-19T07:00:00Z', payload: { exerciseId: 'loops-1' } }
}

async function openReview(page: Page, replaced: Pick<StaffReview, 'activity' | 'signals'>) {
  const studentNumber = await studentNumberOf(demoAccounts[0].email)
  await signIn(page, lecturerAccount)
  await expect(page).toHaveURL(/\/lecturer$/)
  await page.route('**/api/staff/review?*', async (route) => {
    const response = await route.fetch()
    await route.fulfill({ response, json: { ...await response.json(), ...replaced } })
  })
  await page.locator(`a[href="/review/${studentNumber}"]`).click()
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
