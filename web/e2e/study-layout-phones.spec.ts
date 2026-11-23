import { expect, test, type Locator, type Page } from '@playwright/test'
import { demoAccounts } from '../server/auth/demo-accounts'
import { resetDemoAccounts } from './reset-demo-accounts'

// The live IDE layout is the seam. Widths, scroll, and what a Student can reach
// are observed in the browser. Desktop numbers are the IDE as it is at 1440 × 900.

const anAccount = demoAccounts.find(account => account.displayName === 'An')
const phoneWidths = [320, 375, 390, 430] as const
const maiReply = 'wait, does the total live outside the loop? i\'m lost too.'

test.beforeAll(async () => {
  await resetDemoAccounts()
})

test.afterAll(async () => {
  await resetDemoAccounts()
})

test('keeps the desktop IDE unchanged at 1440 × 900', async ({ page }) => {
  await openWorkspace(page, { width: 1440, height: 900 })

  await expect(page.getByRole('tab')).toHaveCount(0)
  await expect(page.locator('header').getByText('Verifiable Co-Learner', { exact: true })).toBeVisible()
  await expect(page.locator('header').getByText('Student', { exact: true })).toBeVisible()
  await expect(page.locator('header span:not([aria-hidden="true"])').filter({ hasText: /^An$/ })).toBeVisible()
  await expect(page.getByText('These materials belong to this module alone.', { exact: true })).toBeVisible()
  await expect(page.getByText('Teacher + Deskmate', { exact: true })).toHaveCount(0)
  await expectNoDocumentScroll(page)

  const header = page.locator('main > header')
  await expect(header).toHaveCSS('height', '48px')
  await expect(header).toHaveCSS('padding-left', '24px')
  await expect(header).toHaveCSS('padding-right', '24px')

  const panels = await panelBoxes(page)
  expect(panels).not.toBeNull()
  expect(Math.abs(panels!.map.width - 220)).toBeLessThanOrEqual(1)
  expect(Math.abs(panels!.conversation.width - 360)).toBeLessThanOrEqual(1)
  expect(panels!.working.x).toBeGreaterThan(panels!.map.x + panels!.map.width - 2)
  expect(panels!.conversation.x).toBeGreaterThan(panels!.working.x + panels!.working.width - 2)
  expect(Math.abs(panels!.map.y - panels!.working.y)).toBeLessThanOrEqual(2)
  expect(Math.abs(panels!.map.y - panels!.conversation.y)).toBeLessThanOrEqual(2)
  expect(panels!.map.scrollWidth).toBeLessThanOrEqual(panels!.map.clientWidth + 1)

  const learn = await page.getByRole('button', { name: 'Learn', exact: true }).boundingBox()
  expect(learn).not.toBeNull()
  expect(learn!.height).toBeGreaterThan(20)
  expect(learn!.height).toBeLessThan(40)

  const composer = page.getByRole('textbox', { name: 'Message' })
  await expect(composer).toHaveCSS('font-size', '12px')
  await expect(composer).toHaveCSS('height', '34px')

  const traceSwitch = await page.getByRole('switch', { name: 'Deskmate' }).boundingBox()
  expect(traceSwitch).not.toBeNull()
  expect(traceSwitch!.height).toBeCloseTo(16, 0)
  expect(traceSwitch!.width).toBeCloseTo(28, 0)

  const ideLink = await page.getByRole('link', { name: 'Study', exact: true }).boundingBox()
  expect(ideLink).not.toBeNull()
  expect(ideLink!.height).toBeLessThan(32)

  await expect(conversation(page).locator('header')).toHaveCSS('height', '56px')

  await page.getByRole('button', { name: 'Practice', exact: true }).click()
  const editor = page.getByRole('textbox', { name: 'Python editor' })
  await expect(editor).toBeVisible()
  expect(await fontSize(editor)).toBe(14)
})

test('places the course roadmap in a strip above two columns on a tablet', async ({ page }) => {
  await openWorkspace(page, { width: 768, height: 1024 })

  await expect(page.getByRole('tab')).toHaveCount(0)
  await expectNoDocumentScroll(page)

  const viewport = page.viewportSize()
  expect(viewport).not.toBeNull()
  const panels = await panelBoxes(page)
  expect(panels).not.toBeNull()

  expect(panels!.map.x).toBeLessThanOrEqual(1)
  expect(panels!.map.width).toBeGreaterThanOrEqual(viewport!.width - 2)
  expect(panels!.map.y + panels!.map.height).toBeLessThanOrEqual(panels!.working.y + 1)
  expect(panels!.map.y + panels!.map.height).toBeLessThanOrEqual(panels!.conversation.y + 1)
  expect(Math.abs(panels!.working.y - panels!.conversation.y)).toBeLessThanOrEqual(2)
  expect(panels!.working.x).toBeLessThanOrEqual(1)
  expect(panels!.conversation.x).toBeGreaterThanOrEqual(panels!.working.x + panels!.working.width - 2)
  expect(panels!.conversation.x + panels!.conversation.width).toBeGreaterThanOrEqual(viewport!.width - 2)
  expect(panels!.working.y + panels!.working.height).toBeGreaterThanOrEqual(viewport!.height - 2)
  expect(panels!.conversation.y + panels!.conversation.height).toBeGreaterThanOrEqual(viewport!.height - 2)
  expect(panels!.map.scrollWidth).toBeGreaterThan(panels!.map.clientWidth)

  await expect(page.getByRole('heading', { name: 'Course roadmap', exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Working area', exact: true })).toBeVisible()
  await expect(conversation(page)).toBeVisible()
})

test('uses one full-height panel on a phone and reaches every control', async ({ page }) => {
  await openWorkspace(page, { width: 390, height: 800 })

  for (const width of phoneWidths) {
    await page.setViewportSize({ width, height: 800 })
    await expectPhoneTopBar(page)
    await expectNoDocumentScroll(page)

    const workingTab = page.getByRole('tab', { name: 'Working area', exact: true })
    await expect(workingTab).toHaveAttribute('aria-selected', 'true')
    await expectOnlyPanel(page, 'working')
    await expect(page.getByText('These materials belong to this module alone.', { exact: true })).toBeVisible()
    await expectTapTarget(page.getByRole('button', { name: 'Learn', exact: true }))
    await expectTapTarget(page.getByRole('button', { name: 'Practice', exact: true }))
    await expect(page.getByRole('tab')).toHaveCount(3)
    for (const tab of [
      page.getByRole('tab', { name: 'Roadmap', exact: true }),
      workingTab,
      page.getByRole('tab', { name: 'Conversation', exact: true }),
    ]) {
      await expectTapTarget(tab)
    }

    await page.getByRole('tab', { name: 'Roadmap', exact: true }).click()
    await expect(page.getByRole('tab', { name: 'Roadmap', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expectOnlyPanel(page, 'roadmap')
    await expectNoDocumentScroll(page)

    await page.getByRole('tab', { name: 'Conversation', exact: true }).click()
    await expectOnlyPanel(page, 'conversation')
    await expect(conversation(page).getByRole('heading', { name: 'Conversation', exact: true })).toBeVisible()
    const composer = page.getByRole('textbox', { name: 'Message' })
    const send = page.getByRole('button', { name: 'Send', exact: true })
    await expectReachable(page, composer)
    await expectReachable(page, send)
    expect(await fontSize(composer)).toBeGreaterThanOrEqual(16)
    await expectTapTarget(send)
    await expectTapTarget(page.getByRole('switch', { name: 'Deskmate' }))
    await expectNoDocumentScroll(page)

    await composer.fill('still typing')
    await page.getByRole('tab', { name: 'Roadmap', exact: true }).click()
    await expectOnlyPanel(page, 'roadmap')
    await page.getByRole('tab', { name: 'Conversation', exact: true }).click()
    await expect(composer).toHaveValue('still typing')
    await composer.fill('')

    await workingTab.click()
    await expectOnlyPanel(page, 'working')
    await page.getByRole('button', { name: 'Practice', exact: true }).click()
    const editor = page.getByRole('textbox', { name: 'Python editor' })
    const run = page.getByRole('button', { name: 'Run', exact: true })
    const submit = page.getByRole('button', { name: 'Submit', exact: true })
    const chip = page.getByRole('button', { name: 'Say hello', exact: true })
    await expectReachable(page, editor)
    await expectReachable(page, run)
    await expectReachable(page, submit)
    await expectReachable(page, chip)
    expect(await fontSize(editor)).toBeGreaterThanOrEqual(16)
    await expectTapTarget(run)
    await expectTapTarget(submit)
    await expectTapTarget(chip)
    await expectNoDocumentScroll(page)
    await page.getByRole('button', { name: 'Learn', exact: true }).click()
  }

  await page.setViewportSize({ width: 390, height: 420 })
  await page.getByRole('tab', { name: 'Conversation', exact: true }).click()
  await expectOnlyPanel(page, 'conversation')
  await expectReachable(page, page.getByRole('textbox', { name: 'Message' }))
  await expectReachable(page, page.getByRole('button', { name: 'Send', exact: true }))
  await expectNoDocumentScroll(page)
})

test('shows a reply that arrives on another tab and Open in Learn returns to the working area', async ({ page }) => {
  test.setTimeout(120_000)
  await openWorkspace(page, { width: 390, height: 800 })
  await page.getByRole('button', { name: 'Practice', exact: true }).click()
  await page.getByRole('tab', { name: 'Conversation', exact: true }).click()

  let release = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/turn', async (route) => {
    const body = route.request().postData() ?? ''
    if (route.request().method() === 'POST' && body.includes('"event":"message"')) await gate
    await route.continue()
  })

  try {
    const sent = page.waitForRequest(request => request.method() === 'POST' && (request.postData() ?? '').includes('"event":"message"'))
    await page.getByRole('textbox', { name: 'Message' }).fill('Where does the total live?')
    await page.getByRole('button', { name: 'Send', exact: true }).click()
    await sent
    await page.getByRole('tab', { name: 'Roadmap', exact: true }).click()
    await expectOnlyPanel(page, 'roadmap')
    release()

    const dot = page.getByRole('img', { name: 'New reply', exact: true })
    await expect(dot).toBeVisible({ timeout: 60_000 })

    await page.setViewportSize({ width: 390, height: 520 })
    await page.getByRole('tab', { name: /^Conversation/ }).click()
    await expect(dot).toHaveCount(0)
    await expect(conversation(page).getByText(maiReply, { exact: true })).toBeInViewport()
    const region = await conversation(page).boundingBox()
    for (const who of ['student', 'teacher', 'deskmate']) {
      const portrait = conversation(page).locator(`[data-portrait="${who}"]`).last()
      await expect(portrait).toBeVisible()
      const portraitBox = await portrait.boundingBox()
      expect(portraitBox!.x).toBeGreaterThanOrEqual(region!.x)
      expect(portraitBox!.x + portraitBox!.width).toBeLessThanOrEqual(region!.x + region!.width)
    }

    await conversation(page).getByRole('button', { name: 'Open in Learn', exact: true }).last().click()
    await expect(page.getByRole('tab', { name: 'Working area', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expectOnlyPanel(page, 'working')
    await expect(page.getByRole('button', { name: 'Learn', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('button', { name: 'Practice', exact: true })).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByRole('heading', { name: 'A first program', exact: true })).toBeVisible()
    await expect(page.getByRole('textbox', { name: 'Python editor' })).toBeHidden()

    await page.getByRole('tab', { name: 'Conversation', exact: true }).click()
    await page.getByRole('link', { name: 'Progress map', exact: true }).click()
    await page.getByRole('link', { name: 'Study', exact: true }).click()
    await expect(page.getByRole('tab', { name: 'Conversation', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expectOnlyPanel(page, 'conversation')
    await expect(conversation(page).getByText(maiReply, { exact: true })).toBeVisible()
  }
  finally {
    release()
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  }
})

async function expectPhoneTopBar(page: Page) {
  await expectNotOnScreen(page.locator('header').getByText('Verifiable Co-Learner', { exact: true }))
  await expect(page.locator('header').getByText('Student', { exact: true })).toBeHidden()
  await expectNotOnScreen(page.locator('header span:not([aria-hidden="true"])').filter({ hasText: /^An$/ }))
  await expect(page.locator('header span[aria-hidden="true"]').filter({ hasText: /^An$/ })).toBeVisible()
  const ide = page.getByRole('link', { name: 'Study', exact: true })
  const mindmapLink = page.getByRole('link', { name: 'Progress map', exact: true })
  const signOut = page.getByRole('button', { name: 'Sign out', exact: true })
  await expect(ide).toBeVisible()
  await expect(mindmapLink).toBeVisible()
  await expect(signOut).toBeVisible()
  await expectTapTarget(ide)
  await expectTapTarget(mindmapLink)
  await expectTapTarget(signOut)
  const header = await page.locator('main > header').boundingBox()
  const viewport = page.viewportSize()
  expect(header).not.toBeNull()
  expect(viewport).not.toBeNull()
  expect(header!.x).toBeGreaterThanOrEqual(-1)
  expect(header!.x + header!.width).toBeLessThanOrEqual(viewport!.width + 1)
}

async function expectOnlyPanel(page: Page, panel: 'roadmap' | 'working' | 'conversation') {
  const map = page.getByRole('heading', { name: 'Course roadmap', exact: true })
  const working = page.getByRole('region', { name: 'Working area', exact: true })
  const talk = conversation(page)
  if (panel === 'roadmap') await expect(map).toBeVisible()
  else await expect(map).toBeHidden()
  if (panel === 'working') await expect(working).toBeVisible()
  else await expect(working).toBeHidden()
  if (panel === 'conversation') await expect(talk).toBeVisible()
  else await expect(talk).toBeHidden()

  const shown = panel === 'roadmap' ? map : panel === 'working' ? working : talk
  const box = panel === 'roadmap' ? await courseRoadmapBox(page) : await shown.boundingBox()
  const viewport = page.viewportSize()
  expect(box).not.toBeNull()
  expect(viewport).not.toBeNull()
  expect(box!.height).toBeGreaterThan(viewport!.height * 0.45)
  expect(box!.y + box!.height).toBeGreaterThanOrEqual(viewport!.height - 2)
  expect(box!.width).toBeGreaterThanOrEqual(viewport!.width - 2)
}

async function courseRoadmapBox(page: Page) {
  return page.getByRole('heading', { name: 'Course roadmap', exact: true }).evaluate((element) => {
    const aside = element.closest('aside')
    if (!aside) return null
    const box = aside.getBoundingClientRect()
    return { x: box.x, y: box.y, width: box.width, height: box.height }
  })
}

function conversation(page: Page): Locator {
  return page.getByRole('region', { name: 'Conversation', exact: true })
}

async function expectNotOnScreen(locator: Locator) {
  const box = await locator.boundingBox()
  if (!box) return
  expect(box.width <= 1 || box.height <= 1).toBe(true)
}

async function expectNoDocumentScroll(page: Page) {
  const measured = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    scrollHeight: document.documentElement.scrollHeight,
    clientHeight: document.documentElement.clientHeight,
  }))
  expect(measured.scrollWidth).toBe(measured.clientWidth)
  expect(measured.scrollHeight).toBe(measured.clientHeight)
}

async function expectReachable(page: Page, locator: Locator) {
  await expect(async () => {
    await locator.scrollIntoViewIfNeeded()
    const box = await locator.boundingBox()
    const viewport = page.viewportSize()
    if (!box || !viewport) throw new Error('Element is not on screen.')
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height)
    expect(box.x).toBeGreaterThanOrEqual(-1)
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 1)
  }).toPass()
}

async function expectTapTarget(locator: Locator) {
  const box = await locator.boundingBox()
  expect(box, await locator.evaluate(element => element.tagName)).not.toBeNull()
  expect(box!.height).toBeGreaterThanOrEqual(44)
  expect(box!.width).toBeGreaterThanOrEqual(44)
}

async function fontSize(locator: Locator): Promise<number> {
  const size = await locator.evaluate(element => getComputedStyle(element).fontSize)
  return Number.parseFloat(size)
}

interface PanelBox {
  x: number
  y: number
  width: number
  height: number
  scrollWidth: number
  clientWidth: number
}

async function panelBoxes(page: Page) {
  const map = await page.getByRole('heading', { name: 'Course roadmap', exact: true }).evaluate((element) => {
    const aside = element.closest('aside')
    if (!aside) return null
    const box = aside.getBoundingClientRect()
    return {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      scrollWidth: aside.scrollWidth,
      clientWidth: aside.clientWidth,
    }
  })
  const working = await boxOf(page.getByRole('region', { name: 'Working area', exact: true }))
  const conversationBox = await boxOf(conversation(page))
  if (!map || !working || !conversationBox) return null
  return { map, working, conversation: conversationBox }
}

async function boxOf(locator: Locator): Promise<PanelBox | null> {
  return locator.evaluate((element) => {
    const box = element.getBoundingClientRect()
    if (box.width === 0 && box.height === 0) return null
    return {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    }
  })
}

test('locks an answered quiz question and shows Submit busy at phone width', async ({ page }) => {
  test.setTimeout(240_000)
  await openWorkspace(page, { width: 390, height: 800 })

  const quiz = page.getByRole('region', { name: 'Module quiz' })
  const questions = quiz.locator('ol > li')
  await expect(questions).toHaveCount(0)
  await quiz.getByRole('button', { name: 'Show quiz' }).click()
  await expect(questions.first()).toContainText(/^1\. \S/)
  const first = questions.nth(0).getByRole('button')
  const second = questions.nth(1).getByRole('button')
  await expect(first.first()).toBeEnabled()

  await first.first().click()
  await expect(questions.nth(0)).toContainText(/Correct|Not quite/)
  for (const choice of await first.all()) await expect(choice).toBeDisabled()
  await expect(first.first()).toHaveCSS('cursor', 'not-allowed')
  await expect(first.first()).toHaveAttribute('aria-pressed', 'true')
  for (const choice of await second.all()) await expect(choice).toBeEnabled()

  let release = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route('**/turn', async (route) => {
    const body = route.request().postData() ?? ''
    if (route.request().method() === 'POST' && body.includes('"event":"submission"')) await gate
    await route.continue()
  })

  try {
    await page.getByRole('button', { name: 'Practice', exact: true }).click()
    const submit = page.getByRole('button', { name: 'Submit', exact: true })
    const sent = page.waitForRequest(request => request.method() === 'POST' && (request.postData() ?? '').includes('"event":"submission"'), { timeout: 180_000 })
    await submit.click()
    await expect(submit).toHaveAttribute('aria-busy', 'true')
    await expect(submit).toBeDisabled()
    await sent
    await expect(submit).toHaveAttribute('aria-busy', 'true')
    await expect(submit).toBeDisabled()
    release()
    await expect(submit).toBeEnabled({ timeout: 60_000 })
    await expect(submit).toHaveAttribute('aria-busy', 'false')
  }
  finally {
    release()
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  }
})

async function openWorkspace(page: Page, size: { width: number, height: number }) {
  if (!anAccount) throw new Error('Demo account An is missing.')
  await page.setViewportSize(size)
  await page.goto('/sign-in')
  await waitForApp(page)
  await page.getByLabel('Email').fill(anAccount.email)
  await page.getByLabel('Password').fill(anAccount.password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Getting Started with Programming and Python' })).toBeVisible({ timeout: 60_000 })
  await waitForApp(page)
}

async function waitForApp(page: Page) {
  await page.waitForFunction(() => {
    const root = document.querySelector('#__nuxt') as (HTMLElement & { __vue_app__?: object }) | null
    return Boolean(root?.__vue_app__)
  })
}
