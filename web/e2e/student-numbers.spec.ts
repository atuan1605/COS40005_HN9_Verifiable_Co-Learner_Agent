import { expect, test, type Page } from '@playwright/test'
import { demoAccounts, lecturerAccount, productOwnerAccount } from '../server/auth/demo-accounts'
import { resetDemoAccounts } from './reset-demo-accounts'

// The student number is the seam: the lecturer's enrolled list and the
// administrator's directory, at desktop and phone width.

const widths = [
  { name: 'desktop', viewport: { width: 1440, height: 900 } },
  { name: 'phone', viewport: { width: 390, height: 844 } },
] as const

for (const width of widths) {
  test(`shows the lecturer the enrolled students, searchable and sortable at ${width.name} width`, async ({ page }) => {
    await page.setViewportSize(width.viewport)
    await signIn(page, lecturerAccount)
    await expect(page).toHaveURL(/\/lecturer$/)

    const list = page.getByTestId('course-students')
    await expect(list).toBeVisible()
    const rows = list.locator('tbody tr')
    await expect(rows).toHaveCount(2)
    const anRow = rows.filter({ hasText: 'an@example.com' })
    await expect(anRow).toHaveCount(1)
    await expect(anRow).toContainText(/SWB\d{4,}/)
    await expect(anRow.getByTestId('student-campus')).toBeVisible()
    await expect(rows.filter({ hasText: 'binh@example.com' })).toHaveCount(1)

    const numbers = async () => (await rows.locator('td:nth-child(2) p:first-child').allInnerTexts()).map(text => text.trim())
    const numberHeader = list.getByRole('columnheader', { name: /Student number/ })
    await numberHeader.getByRole('button').click()
    await expect(numberHeader).toHaveAttribute('aria-sort', 'ascending')
    const ascending = await numbers()
    expect(ascending).toEqual([...ascending].sort())
    await numberHeader.getByRole('button').click()
    await expect(numberHeader).toHaveAttribute('aria-sort', 'descending')
    const descending = await numbers()
    expect(descending).toEqual([...descending].sort().reverse())

    const search = page.getByLabel('Search students')
    const anNumber = (await anRow.locator('td').nth(1).locator('p').first().innerText()).trim()
    await search.fill(anNumber)
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText('An')
    await search.fill('Bình')
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText('Bình')
    await search.fill('')
    await expect(rows).toHaveCount(2)

    await expectNoSidewaysScroll(page)
  })

  test(`lets the administrator read and change student numbers at ${width.name} width`, async ({ page }) => {
    await page.setViewportSize(width.viewport)
    await signIn(page, productOwnerAccount)
    await page.getByRole('navigation', { name: 'Administrator' }).getByRole('link', { name: 'Students' }).click()
    await expect(page).toHaveURL(/\/admin\/students$/)
    await expect(page.getByRole('heading', { name: 'Students', exact: true })).toBeVisible()

    const table = page.getByRole('table', { name: 'Every student' })
    const rows = table.locator('tbody tr')
    const anRow = rows.filter({ hasText: 'an@example.com' })
    const binhRow = rows.filter({ hasText: 'binh@example.com' })
    await expect(anRow).toHaveCount(1)
    await expect(binhRow).toHaveCount(1)
    const original = (await anRow.locator('td').nth(1).innerText()).trim()
    const binhNumber = (await binhRow.locator('td').nth(1).innerText()).trim()
    expect(original).toMatch(/^SWB\d{4,}$/)

    const input = page.getByLabel('New student number for An')
    const change = page.getByLabel('Change student number for An')

    await input.fill('SWB12')
    await change.click()
    await expect(page.getByText('A student number is SWB followed by at least four digits, like SWB0001.')).toBeVisible()

    await input.fill(binhNumber)
    await change.click()
    await expect(page.getByText('Another student already has that student number.')).toBeVisible()

    const scratch = `SWB9${Date.now()}`
    await input.fill(scratch)
    await change.click()
    await expect(page.getByText('Student number changed.')).toBeVisible()
    await expect(anRow.locator('td').nth(1)).toContainText(scratch)

    await page.getByLabel('New student number for An').fill(original)
    await page.getByLabel('Change student number for An').click()
    await expect(page.getByText('Student number changed.')).toBeVisible()
    await expect(anRow.locator('td').nth(1)).toContainText(original)

    await expectNoSidewaysScroll(page)
  })
}

for (const width of widths) {
  test(`lets the administrator change a campus and the lecturer filter by it at ${width.name} width`, async ({ page }) => {
    await resetDemoAccounts()
    await page.setViewportSize(width.viewport)
    await signIn(page, productOwnerAccount)
    await page.goto('/admin/students')
    const anCampus = page.getByLabel('Campus for An')
    await expect(anCampus).toHaveValue('Hanoi')
    await anCampus.selectOption('Can Tho')
    await expect(page.getByText('Campus changed.')).toBeVisible()
    await expect(anCampus).toHaveValue('Can Tho')
    await expectNoSidewaysScroll(page)

    await page.context().clearCookies()
    await page.evaluate(() => localStorage.clear())
    await signIn(page, lecturerAccount)
    const list = page.getByTestId('course-students')
    const rows = list.locator('tbody tr')
    await expect(rows).toHaveCount(2)
    await page.getByLabel('Campus', { exact: true }).selectOption('Can Tho')
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText('An')
    await expect(rows.first().getByTestId('student-campus')).toHaveText('Can Tho')
    await expectNoSidewaysScroll(page)
    await resetDemoAccounts()
  })
}

test('tells a student the Students page is for the administrator', async ({ page }) => {
  await signIn(page, demoAccounts[0])
  await page.goto('/admin/students')
  await expect(page.getByText('This page is for the administrator.')).toBeVisible()
})

async function expectNoSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
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
