import { expect, test, type Page } from '@playwright/test'
import { demoAccounts, lecturerAccount, productOwnerAccount } from '../server/auth/demo-accounts'
import { resetDemoAccounts, studentNumberOf } from './reset-demo-accounts'

// A student's conversation as staff read it: one collapsed row on the review, a
// read-only page of its own, the way back, and the entry in the access log.

const an = demoAccounts[0]
const moduleName = 'Getting Started with Programming and Python'
const question = 'How do I print a greeting?'

test.beforeAll(async () => {
  await resetDemoAccounts()
})

test.afterAll(async () => {
  await resetDemoAccounts()
})

test('opens a conversation from the review, returns, and shows in the access log', async ({ page, browser, baseURL }) => {
  await signIn(page, an)
  await expect(page.getByRole('heading', { name: moduleName })).toBeVisible({ timeout: 60_000 })
  const turn = await page.request.post('/turn', { data: { event: 'message', text: question } })
  expect(turn.ok()).toBe(true)
  await turn.text()

  const studentNumber = await studentNumberOf(an.email)
  const lecturer = await (await browser.newContext({ baseURL })).newPage()
  await signIn(lecturer, lecturerAccount)
  await lecturer.goto(`/review/${studentNumber}`)
  await waitForApp(lecturer)

  const list = lecturer.getByTestId('review-conversations')
  const row = list.getByRole('link', { name: moduleName })
  await expect(row).toContainText('messages')
  await expect(list).not.toContainText(question)
  await row.click()

  await expect(lecturer).toHaveURL(new RegExp(`/review/${studentNumber}/conversations/getting_started$`))
  await expect(lecturer.getByRole('heading', { name: moduleName })).toBeVisible()
  const thread = lecturer.getByTestId('review-conversation')
  await expect(thread.locator('[data-author="student"]')).toContainText(question)
  await expect(thread.locator('[data-author="teacher"]').first()).toContainText('Teacher')
  await expect(lecturer.getByRole('textbox')).toHaveCount(0)

  await lecturer.setViewportSize({ width: 390, height: 844 })
  await lecturer.getByRole('link', { name: 'Back to the review' }).click()
  await expect(lecturer).toHaveURL(new RegExp(`/review/${studentNumber}$`))
  await expect(lecturer.getByTestId('review-conversations')).toBeVisible()
  await lecturer.context().close()

  const administrator = await (await browser.newContext({ baseURL })).newPage()
  await signIn(administrator, productOwnerAccount)
  await administrator.goto('/admin/access-log')
  await expect(administrator.getByRole('cell', { name: `Opened conversation: ${moduleName}` }).first()).toBeVisible()
  await administrator.context().close()
})

async function signIn(page: Page, account: { email: string, password: string }) {
  await page.goto('/sign-in')
  await waitForApp(page)
  await page.getByLabel('Email').fill(account.email)
  await page.getByLabel('Password').fill(account.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page).not.toHaveURL(/\/sign-in$/)
  await waitForApp(page)
}

async function waitForApp(page: Page) {
  await page.waitForFunction(() => {
    const root = document.querySelector('#__nuxt') as (HTMLElement & { __vue_app__?: object }) | null
    return Boolean(root?.__vue_app__)
  })
}
