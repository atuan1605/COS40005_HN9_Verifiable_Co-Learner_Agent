import { expect, test, type Page } from '@playwright/test'
import { lecturerAccount } from '../server/auth/demo-accounts'
import { resetDemoAccounts } from './reset-demo-accounts'

// The lecturer's Insights tab: the Module status chart, the campus filter and the way through to a
// staff review, at desktop and phone width. The demo students start at the Hanoi campus.

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

    // The demo students have no evidence, so both have the first module open.
    const segment = chart.getByRole('button', { name: /, Open: 2 students$/ }).first()
    await segment.focus()
    await expect(chart.getByRole('tooltip')).toContainText('Open')
    await chart.getByText('Module status counts as a table').click()
    await expect(chart.getByRole('table', { name: /Module status/ }).locator('tbody tr').first().locator('td')).toHaveText(['0', '2', '0'])

    // The filter works on what the page already has.
    const requests: string[] = []
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/api/lecturer')) requests.push(request.url())
    })
    await page.getByLabel('Campus').selectOption('Da Nang')
    await expect(insights.getByText('No students at Da Nang.')).toBeVisible()
    await expect(insights.getByTestId('module-status')).toHaveCount(0)
    await page.getByLabel('Campus').selectOption('Hanoi')
    await expect(segment).toBeVisible()
    expect(requests).toEqual([])

    await segment.focus()
    await page.keyboard.press('Enter')
    const list = chart.getByTestId('module-status-students')
    await expect(list.getByRole('link')).toHaveCount(2)
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
