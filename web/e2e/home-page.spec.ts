import { expect, test } from '@playwright/test'

// The About page is public: what the co-learner is, how a turn works, the course, and the team.

const widths = [320, 390, 768, 1024, 1440] as const

test('the About page says what the co-learner is and leads to sign-in', async ({ page }) => {
  await page.goto('/home')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('co-learner for your course')
  await expect(page.getByText('Open your module').first()).toBeVisible()

  await page.getByRole('main').getByRole('link', { name: 'Sign in to start' }).first().click()
  await expect(page).toHaveURL(/\/sign-in$/)
})

test('sign-in links to the About page', async ({ page }) => {
  await page.goto('/sign-in')
  await page.getByRole('link', { name: 'About the co-learner' }).click()
  await expect(page).toHaveURL(/\/home$/)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
})

// The notice a student reads before studying, and again on Home. The old Home
// sentence said no screen shows the activity; this notice replaces it.
const recordingNotice = 'Your activity, submitted code and conversations are recorded. Your lecturers and administrators can review them. DeepSeek processes your conversations.'

test('Home says what is recorded and who can see it; sign-in does not', async ({ page }) => {
  await page.goto('/home')
  await expect(page.getByText(recordingNotice)).toBeVisible()
  await expect(page.getByText('no screen shows it')).toHaveCount(0)

  await page.goto('/sign-in')
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
  await expect(page.getByText(recordingNotice)).toHaveCount(0)
})

test('the About page fits every width and its controls are big enough to tap', async ({ page }) => {
  for (const width of widths) {
    await page.setViewportSize({ width, height: width < 768 ? 844 : 900 })
    await page.goto('/home')
    await page.evaluate(() => Promise.allSettled(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished)))

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow, `sideways scroll at ${width}`).toBeLessThanOrEqual(0)

    const small = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('a[href], button')]
      .filter(element => element.offsetParent && !element.matches('.sr-only'))
      .map(element => ({ text: element.textContent?.trim(), height: element.getBoundingClientRect().height }))
      .filter(target => target.height < 44 && window.innerWidth < 768))
    expect(small, `tap targets under 44px at ${width}`).toEqual([])
  }
})

// Sign-up takes the student's details first and refuses a non-student address
// before any code is sent.
test('sign-up asks for name, campus and password, and only takes a student email', async ({ page }) => {
  await page.goto('/sign-in')
  await page.getByRole('link', { name: 'New student? Sign up' }).click()
  await expect(page.getByRole('heading', { name: 'Sign up' })).toBeVisible()
  await page.getByLabel('Student email').fill('someone@gmail.com')
  await page.getByLabel('Name').fill('Test Student')
  await page.getByLabel('Campus').selectOption('Hanoi')
  await page.getByLabel('Password', { exact: true }).fill('long-enough-1')
  await page.getByLabel('Confirm password').fill('long-enough-1')
  await page.getByRole('button', { name: 'Send code' }).click()
  await expect(page.getByRole('alert')).toContainText('@student.swin.edu.au')

  await page.getByLabel('Student email').fill('104123456@student.swin.edu.au')
  await page.getByLabel('Confirm password').fill('different-1')
  await page.getByRole('button', { name: 'Send code' }).click()
  await expect(page.getByRole('alert')).toHaveText('The two passwords do not match.')
})
