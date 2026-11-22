import { expect, test, type Page } from '@playwright/test'

function editorPanel(page: Page) {
  return page.getByRole('region', { name: 'Editor activity classification' })
}

async function readActivityRequest(page: Page) {
  const sent = page.waitForRequest(request => request.url().endsWith('/api/classify/activity'))
  await page.getByRole('button', { name: 'Classify activity' }).click()
  return (await sent).postDataJSON()
}

test('labels synthetic samples and scores a complete quiet window', async ({ page }) => {
  await page.goto('/')
  const panel = editorPanel(page)
  const select = panel.getByLabel('Load a synthetic sample')
  await select.selectOption('editing')
  await expect(panel.getByText('Synthetic sample: Sustained edits. Ready to classify.')).toBeVisible()
  const request = await readActivityRequest(page)
  expect(request.source).toBe('sample')
  expect(request.window.bins).toEqual(Array.from({ length: 24 }, () => [2, 1, 0]))
  await expect(panel.getByRole('status')).toContainText('Editing pattern · Synthetic sample')
  await expect(panel.getByRole('status')).toContainText('editor-activity-v1 · editor-window-v1')
  await select.selectOption('quiet')
  await expect(panel.getByRole('status')).toBeHidden()
  await readActivityRequest(page)
  await expect(panel.getByRole('status')).toContainText('Other activity pattern · Synthetic sample')
  await panel.getByText('Editor model evaluation').click()
  await expect(panel.getByText(/24 held-out synthetic profiles/)).toBeVisible()

  await panel.getByRole('button', { name: 'Start live observation' }).click()
  await expect(panel.getByText('Edits: 0 · Corrections: 0 · Pastes: 0')).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Classify activity' })).toBeDisabled()
})

test('sends aggregate live edits, replacement, paste and one IME commit after two minutes', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') })
  await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'))
  await page.goto('/')
  const panel = editorPanel(page)
  const classify = panel.getByRole('button', { name: 'Classify activity' })
  const editor = panel.getByRole('textbox', { name: 'Demo editor' })
  await panel.getByRole('button', { name: 'Start live observation' }).click()
  await editor.press('a')
  await editor.press('b')
  await editor.press('Backspace')
  await editor.press('Control+a')
  await editor.press('x')
  await editor.press('ArrowLeft')
  await page.evaluate(() => navigator.clipboard.writeText('local paste text'))
  await editor.press('Control+v')
  await expect(panel.getByText('Edits: 5 · Corrections: 2 · Pastes: 1')).toBeVisible()

  await page.clock.runFor(5000)
  // Exercise the DOM composition sequence without relying on a system IME.
  await editor.evaluate((textarea: HTMLTextAreaElement) => {
    const before = textarea.value
    textarea.dispatchEvent(new CompositionEvent('compositionstart'))
    textarea.value = before + 'h'
    textarea.dispatchEvent(new InputEvent('input', { inputType: 'insertCompositionText', isComposing: true }))
    textarea.value = before + '日'
    textarea.dispatchEvent(new InputEvent('input', { inputType: 'insertCompositionText', isComposing: true }))
    textarea.dispatchEvent(new CompositionEvent('compositionend', { data: '日' }))
    textarea.dispatchEvent(new InputEvent('input', { inputType: 'insertText' }))
  })
  await expect(panel.getByText('Edits: 6 · Corrections: 2 · Pastes: 1')).toBeVisible()
  await page.clock.runFor(114750)
  await expect(classify).toBeDisabled()
  await expect(page.getByText('Observe a full two minutes before forecasting.')).toBeVisible()
  await page.clock.runFor(250)
  await expect(page.getByText('Classify activity to see the forecast for this window.')).toBeVisible()
  const sent = await readActivityRequest(page)
  expect(sent).toEqual({
    source: 'live',
    window: {
      featureVersion: 'editor-window-v1',
      binSeconds: 5,
      observedSeconds: 120,
      bins: [[5, 2, 1], [1, 0, 0], ...Array.from({ length: 22 }, () => [0, 0, 0])],
    },
  })
  await expect(panel.getByRole('status')).toContainText('Live observation')

  // The just-started interval is excluded until it is complete.
  await editor.press('y')
  expect((await readActivityRequest(page)).window.bins).toEqual(sent.window.bins)
  await expect(classify).toBeEnabled()
  await page.clock.runFor(5000)
  const rolled = await readActivityRequest(page)
  expect(rolled.window.bins).toEqual([...sent.window.bins.slice(1), [1, 0, 0]])

  await panel.getByRole('button', { name: 'Reset observation' }).click()
  await expect(editor).toHaveValue('')
  await expect(panel.getByText('Edits: 0 · Corrections: 0 · Pastes: 0')).toBeVisible()
  await expect(classify).toBeDisabled()
  await expect(panel.getByRole('status')).toBeHidden()
})

test('hides an obsolete classification when the observation changes', async ({ page }) => {
  let releaseResponse: () => void = () => {}
  const delayedResponse = new Promise<void>((resolve) => { releaseResponse = resolve })
  await page.route('**/api/classify/activity', async (route) => {
    const response = await route.fetch()
    await delayedResponse
    await route.fulfill({ response })
  })
  await page.goto('/')
  const panel = editorPanel(page)
  await panel.getByLabel('Load a synthetic sample').selectOption('editing')
  await readActivityRequest(page)
  await expect(panel.getByRole('status')).toContainText('Scoring editor activity')
  await panel.getByRole('button', { name: 'Start live observation' }).click()
  const received = page.waitForResponse('**/api/classify/activity')
  releaseResponse()
  await received
  await expect(panel.getByRole('status')).toBeHidden()
  await expect(panel.getByRole('button', { name: 'Classify activity' })).toBeDisabled()
})

test('starts a fresh observation after a visibility gap', async ({ page }) => {
  await page.goto('/')
  const panel = editorPanel(page)
  const editor = panel.getByRole('textbox', { name: 'Demo editor' })
  const start = panel.getByRole('button', { name: 'Start live observation' })
  await start.click()
  await editor.press('a')
  await editor.press('Control+z')
  await expect(editor).toHaveValue('')
  await expect(panel.getByText('Edits: 2 · Corrections: 1 · Pastes: 0')).toBeVisible()
  await editor.press('a')
  await editor.press('Control+a')
  await page.keyboard.insertText('ab')
  await expect(panel.getByText('Edits: 5 · Corrections: 2 · Pastes: 0')).toBeVisible()
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))
    Reflect.deleteProperty(document, 'hidden')
  })
  await expect(panel.getByText(/Observation paused when the page was hidden/)).toBeVisible()
  await expect(editor).toBeDisabled()
  await start.click()
  await expect(panel.getByText('Edits: 0 · Corrections: 0 · Pastes: 0')).toBeVisible()
})
