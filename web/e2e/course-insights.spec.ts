import { expect, test, type Page } from '@playwright/test'
import { lecturerAccount } from '../server/auth/demo-accounts'
import { resetDemoAccounts } from './reset-demo-accounts'

// The lecturer's Insights tab: the Module status chart, the Course progress distribution, the campus
// filter they share and the way through to a staff review, at desktop and phone width. The demo
// students start at the Hanoi campus.
//
// The expected figures come from supabase/seed.sql. Bình's seeded evidence masters Modules 1 to 4
// and opens Module 5: 4 of the 11 listed modules, 36%. The reset leaves An no evidence and no
// stored mastery: Module 1 open, nothing mastered, 0%. Unlocks an earlier run recorded for An may
// open more of Modules 2 to 5, so nothing here counts on those being closed to An.
const firstModule = 'Getting Started with Programming and Python'

const widths = [
  { name: 'desktop', viewport: { width: 1440, height: 900 } },
  { name: 'phone', viewport: { width: 390, height: 844 } },
] as const

test.beforeAll(async () => {
  await resetDemoAccounts()
})

for (const width of widths) {
  test(`charts Module status, filters it by campus and opens a review at ${width.name} width`, async ({ page }) => {
    await page.setViewportSize(width.viewport)
    await signInAsLecturer(page)
    await page.getByRole('button', { name: 'Insights', exact: true }).click()

    const insights = page.getByRole('article', { name: /^Course insights for / }).first()
    await expect(insights.getByRole('heading', { name: 'Course insights' })).toBeVisible()
    await expect(page.getByLabel('Campus')).toHaveValue('')
    const chart = insights.getByTestId('module-status')
    await expect(chart.getByRole('heading', { name: 'Module status' })).toBeVisible()

    // Bình has mastered the first module and An has it open.
    await expect(chart.getByRole('button', { name: `${firstModule}, Mastered: 1 student`, exact: true })).toBeVisible()
    const segment = chart.getByRole('button', { name: `${firstModule}, Open: 1 student`, exact: true })
    await segment.focus()
    await expect(chart.getByRole('tooltip')).toContainText('Open')
    await chart.getByText('Module status counts as a table').click()
    const counts = chart.getByRole('table', { name: /Module status/ }).locator('tbody tr')
    await expect(counts).toHaveCount(11)
    // Mastered, open, closed.
    await expect(counts.first().locator('td')).toHaveText(['1', '1', '0'])
    await expect(counts.locator('td:nth-of-type(1)')).toHaveText(['1', '1', '1', '1', '0', '0', '0', '0', '0', '0', '0'])
    // The last module has no content, so it is closed to both.
    await expect(counts.last().locator('td')).toHaveText(['0', '0', '2'])

    // The filter works on what the page already has.
    const requests: string[] = []
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/api/lecturer')) requests.push(request.url())
    })
    await page.getByLabel('Campus').selectOption('Da Nang')
    await expect(insights.getByText('No students at Da Nang.')).toBeVisible()
    await expect(insights.getByTestId('module-status')).toHaveCount(0)
    await expect(insights.getByTestId('progress-distribution')).toHaveCount(0)
    await page.getByLabel('Campus').selectOption('Hanoi')
    await expect(segment).toBeVisible()
    expect(requests).toEqual([])

    await segment.focus()
    await page.keyboard.press('Enter')
    const list = chart.getByTestId('module-status-students')
    await expect(list.getByRole('link')).toHaveCount(1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false)

    await list.getByRole('link', { name: /^An / }).click()
    await expect(page).toHaveURL(/\/review\/SWB\d{4,}$/)
  })
}

for (const width of widths) {
  test(`charts the Course progress distribution and opens a review at ${width.name} width`, async ({ page }) => {
    await page.setViewportSize(width.viewport)
    await signInAsLecturer(page)
    await page.getByRole('button', { name: 'Insights', exact: true }).click()

    const insights = page.getByRole('article', { name: /^Course insights for / }).first()
    const histogram = insights.getByTestId('progress-distribution')
    await expect(histogram.getByRole('heading', { name: 'Course progress distribution' })).toBeVisible()

    // An, at 0%, is in the lowest band and Bình, at 36%, in the next.
    const band = histogram.getByRole('button', { name: 'Course progress 0–19%: 1 student', exact: true })
    await expect(band).toBeVisible()
    await expect(histogram.getByRole('button', { name: 'Course progress 20–39%: 1 student', exact: true })).toBeVisible()
    await expect(histogram.locator('svg').getByRole('button')).toHaveCount(2)
    await histogram.getByText('Course progress counts as a table').click()
    const table = histogram.getByRole('table', { name: /Course progress distribution/ })
    await expect(table.locator('tbody th')).toHaveText(['0–19%', '20–39%', '40–59%', '60–79%', '80–100%'])
    await expect(table.locator('tbody td')).toHaveText(['1', '1', '0', '0', '0'])

    // The one campus filter changes both charts.
    await page.getByLabel('Campus').selectOption('Da Nang')
    await expect(insights.getByTestId('module-status')).toHaveCount(0)
    await expect(histogram).toHaveCount(0)
    await page.getByLabel('Campus').selectOption('Hanoi')
    await expect(insights.getByTestId('module-status')).toBeVisible()
    await expect(band).toBeVisible()

    const list = histogram.getByTestId('progress-distribution-students')
    await expect(list).toHaveCount(0)
    await band.hover()
    await expect(list.getByRole('link')).toHaveCount(1)
    await list.getByRole('button', { name: 'Close' }).click()
    await expect(list).toHaveCount(0)

    // From the keyboard: focus shows the band's students, Enter moves into them.
    await band.focus()
    await expect(list.getByRole('link')).toHaveCount(1)
    await page.keyboard.press('Enter')
    await expect(list.getByRole('link').first()).toBeFocused()
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false)

    await list.getByRole('link', { name: /^An / }).click()
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
