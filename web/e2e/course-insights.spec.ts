import { expect, test, type Page } from '@playwright/test'
import { lecturerAccount } from '../server/auth/demo-accounts'
import { resetDemoAccounts } from './reset-demo-accounts'

// The lecturer's Insights tab: the course path, the Course progress pie, the students furthest
// behind, the filters they share and the way through to a staff review, at desktop and phone
// width. The demo students start at the Hanoi campus.
//
// The expected figures come from supabase/seed.sql. Bình's seeded evidence masters Modules 1 to 4
// and opens Module 5: 36%. The reset leaves An no evidence and no stored mastery: Module 1 open,
// 0%. Unlocks an earlier run recorded may open more modules to An, but An still stands on the
// first one.
const firstModule = 'Getting Started with Programming and Python'

const widths = [
  { name: 'desktop', viewport: { width: 1440, height: 900 } },
  { name: 'phone', viewport: { width: 390, height: 844 } },
] as const

test.beforeAll(async () => {
  await resetDemoAccounts()
})

for (const width of widths) {
  test(`shows where each student is, filters by campus and opens a review at ${width.name} width`, async ({ page }) => {
    await page.setViewportSize(width.viewport)
    await signInAsLecturer(page)
    await page.getByRole('button', { name: 'Insights', exact: true }).click()

    const insights = page.getByRole('article', { name: /^Course insights for / }).first()
    await expect(insights.getByRole('heading', { name: 'Course insights' })).toBeVisible()
    await expect(page.getByLabel('Campus')).toHaveValue('')

    const path = insights.getByTestId('course-path')
    const first = path.getByRole('listitem', { name: `${firstModule}: 1 student working here, 1 mastered it`, exact: true })
    await expect(first.getByRole('link', { name: /^Review An's work/ })).toBeVisible()
    await expect(path.getByRole('listitem', { name: /: 1 student working here, 0 mastered it$/ }).getByRole('link', { name: /^Review Bình's work/ })).toBeVisible()
    await expect(path.getByRole('listitem', { name: 'No module open: 0 students', exact: true })).toBeVisible()

    const pie = insights.getByTestId('progress-pie')
    await expect(pie.getByRole('listitem').filter({ hasText: 'Not started' })).toContainText('1')
    await expect(pie.getByRole('listitem').filter({ hasText: 'Part way' })).toContainText('1')

    const behind = insights.getByTestId('furthest-behind').getByRole('link')
    await expect(behind).toHaveCount(2)
    await expect(behind.first()).toHaveAccessibleName("Review An's work, Course progress 0%")

    // The filter works on what the page already has.
    const requests: string[] = []
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/api/lecturer')) requests.push(request.url())
    })
    await page.getByLabel('Campus').selectOption('Da Nang')
    await expect(insights.getByText('No students match these filters.')).toBeVisible()
    await expect(path).toHaveCount(0)
    await expect(pie).toHaveCount(0)
    await page.getByLabel('Campus').selectOption('Hanoi')
    await expect(first).toBeVisible()

    // The other filters narrow the same three panels, and combine.
    await page.getByRole('button', { name: 'Clear filters' }).click()
    await page.getByLabel('Search students').fill('bình')
    await expect(behind).toHaveCount(1)
    await expect(insights.getByTestId('insights-student-count')).toHaveText('1 of 2 students shown')
    await page.getByLabel('Search students').fill('')
    await page.getByLabel('Course progress', { exact: true }).selectOption('not-started')
    await expect(behind).toHaveAccessibleName("Review An's work, Course progress 0%")
    await page.getByLabel('Current module').selectOption({ label: firstModule })
    await expect(behind).toHaveCount(1)
    await page.getByLabel('Course progress', { exact: true }).selectOption('part-way')
    await expect(insights.getByText('No students match these filters.')).toBeVisible()
    await page.getByRole('button', { name: 'Clear filters' }).click()
    await expect(behind).toHaveCount(2)
    expect(requests).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false)

    await behind.first().click()
    await expect(page).toHaveURL(/\/review\/SWB\d{4,}$/)
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
