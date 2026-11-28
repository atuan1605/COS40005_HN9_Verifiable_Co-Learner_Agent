import { expect, test, type Page } from '@playwright/test'
import { demoAccounts } from '../server/auth/demo-accounts'
import { clearDemoCampus, deleteAccountByEmail, resetDemoAccounts } from './reset-demo-accounts'

// A student signs up with a code emailed to them, which proves the student email.
// The local mail catcher (Mailpit, from `supabase start`) holds the email, so the
// code is read from it. Sign-in itself is by password only.

const mailCatcher = process.env.MAIL_CATCHER_URL ?? 'http://127.0.0.1:54324'

const studentName = 'Sign Up Student'

const widths = [
  { name: 'desktop', viewport: { width: 1440, height: 900 } },
  { name: 'phone', viewport: { width: 390, height: 844 } },
] as const

for (const width of widths) {
  test.describe(`at ${width.name} width`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize(width.viewport)
    })

    test('offers no code option on sign-in', async ({ page }) => {
      await page.goto('/sign-in')
      await waitForApp(page)
      const main = page.getByRole('main')
      await expect(main.getByLabel('Password')).toBeVisible()
      await expect(main.getByRole('button')).toHaveCount(1)
      await expect(main.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
      await expect(main.getByText(/\bcode\b/i)).toHaveCount(0)
      await expectNoSidewaysScroll(page)
    })

    test('refuses an address outside the student domain and sends no code', async ({ page }) => {
      const outsider = `outsider-${Date.now()}@example.com`
      await askForSignUpCode(page, outsider)
      await expect(page.getByRole('alert')).toContainText('Use your Swinburne student email, which ends in @student.swin.edu.au.')
      await expect(page.getByLabel('6-digit code')).toHaveCount(0)
      await page.waitForTimeout(1500)
      expect(await messagesTo(outsider)).toHaveLength(0)
      await expectNoSidewaysScroll(page)
    })

    test('signs a new student up with a code and creates the account', async ({ page }) => {
      const email = `e2e-${width.name}-${Date.now()}@student.swin.edu.au`
      try {
        await askForSignUpCode(page, email)
        await expect(page.getByLabel('6-digit code')).toBeVisible()
        await expectNoSidewaysScroll(page)

        const code = await emailedCode(email)
        expect(code).toMatch(/^\d{6}$/)

        // Auth answers a wrong code and an expired code with the same refusal.
        const wrong = code === '000000' ? '111111' : '000000'
        await page.getByLabel('6-digit code').fill(wrong)
        await page.getByRole('button', { name: 'Create account' }).click()
        await expect(page.getByRole('alert')).toContainText('That code is wrong or has expired.')

        await page.getByLabel('6-digit code').fill(code)
        await page.getByRole('button', { name: 'Create account' }).click()
        await expect(page).toHaveURL(url => url.pathname === '/', { timeout: 60_000 })

        // The profile shows the chosen name and campus and the new student number.
        await page.goto('/profile')
        await expect(page.locator('[data-profile-campus]')).toHaveText('Da Nang')
        await expect(page.getByText(/SWB\d{4,}/)).toBeVisible()
        await expect(page.getByLabel('Campus')).toHaveCount(0)
        await expect(page.getByRole('textbox', { name: 'Display name' })).toHaveValue(studentName)
        await expectNoSidewaysScroll(page)
      }
      finally {
        await deleteAccountByEmail(email)
      }
    })

    test('can ask for a new code', async ({ page }) => {
      const email = `e2e-resend-${width.name}-${Date.now()}@student.swin.edu.au`
      try {
        await askForSignUpCode(page, email)
        await expect(page.getByLabel('6-digit code')).toBeVisible()
        await page.getByRole('button', { name: 'Send a new code' }).click()
        await expect(page.getByRole('status')).toContainText('A new code is on its way.')
        await expect.poll(async () => (await messagesTo(email)).length, { timeout: 30_000 }).toBeGreaterThanOrEqual(2)
      }
      finally {
        await deleteAccountByEmail(email)
      }
    })

    test('keeps the password sign-in and asks a seeded student with no campus to choose one', async ({ page }) => {
      await resetDemoAccounts()
      await clearDemoCampus(demoAccounts[0].email)
      await page.goto('/sign-in')
      await waitForApp(page)
      await page.getByLabel('Email').fill(demoAccounts[0].email)
      await page.getByLabel('Password').fill(demoAccounts[0].password)
      await page.getByRole('button', { name: 'Sign in', exact: true }).click()
      const step = page.getByRole('dialog', { name: 'Choose your campus' })
      await expect(step).toBeVisible({ timeout: 60_000 })
      await step.getByLabel('Hanoi').check()
      await step.getByRole('button', { name: 'Continue' }).click()
      await expect(step).toBeHidden()
      await resetDemoAccounts()
    })
  })
}

async function askForSignUpCode(page: Page, email: string) {
  await page.goto('/sign-up')
  await waitForApp(page)
  await page.getByLabel('Student email').fill(email)
  await page.getByLabel('Name').fill(studentName)
  await page.getByLabel('Campus').selectOption('Da Nang')
  await page.getByLabel('Password', { exact: true }).fill('long-enough-1')
  await page.getByLabel('Confirm password').fill('long-enough-1')
  await page.getByRole('button', { name: 'Send code' }).click()
}

interface MailSummary { ID: string }

async function messagesTo(address: string): Promise<MailSummary[]> {
  const response = await fetch(`${mailCatcher}/api/v1/search?query=${encodeURIComponent(`to:${address}`)}`)
  if (!response.ok) throw new Error(`The mail catcher answered ${response.status}.`)
  return ((await response.json()) as { messages?: MailSummary[] }).messages ?? []
}

async function emailedCode(address: string): Promise<string> {
  let code = ''
  await expect.poll(async () => {
    const [latest] = await messagesTo(address)
    if (!latest) return ''
    const message = await (await fetch(`${mailCatcher}/api/v1/message/${latest.ID}`)).json() as { Text?: string }
    code = /\b(\d{6})\b/.exec(message.Text ?? '')?.[1] ?? ''
    return code
  }, { timeout: 30_000 }).toMatch(/^\d{6}$/)
  return code
}

async function expectNoSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
}

async function waitForApp(page: Page) {
  await page.waitForFunction(() => {
    const root = document.querySelector('#__nuxt') as (HTMLElement & { __vue_app__?: object }) | null
    return Boolean(root?.__vue_app__)
  })
}
