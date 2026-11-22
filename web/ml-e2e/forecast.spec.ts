import { expect, test, type Page } from '@playwright/test'

const forecastPath = '**/api/predict/submission'

function forecastPanel(page: Page) {
  return page.getByRole('region', { name: 'First-submission forecast' })
}

async function scoreWindow(page: Page) {
  const response = page.waitForResponse(forecastPath)
  await page.getByRole('button', { name: 'Classify activity' }).click()
  return await response
}

test('scores the same editor window with both models, then withholds the forecast after demo submission', async ({ page }) => {
  await page.goto('/')
  const panel = forecastPanel(page)
  const samples = page.getByLabel('Load a synthetic sample')
  await samples.selectOption('editing')
  const activity = page.waitForRequest('**/api/classify/activity')
  const forecast = await scoreWindow(page)
  expect(forecast.request().postDataJSON()).toEqual({
    ...(await activity).postDataJSON(),
    alreadySubmitted: false,
  })
  await expect(panel.getByText(/first submission within 10 minutes · Synthetic sample/)).toBeVisible()
  await expect(panel.getByText('first-submission-v1 · editor-window-v1')).toBeVisible()
  await expect(panel.getByText('Model score 0.4289 · Threshold 0.2318')).toBeVisible()

  await panel.getByText('Submission model evaluation').click()
  await expect(panel.getByText(/Experimental.*average precision was 0.4910.*higher, at 0.5206/)).toBeVisible()

  await panel.getByRole('button', { name: 'Mark demo exercise submitted' }).click()
  await expect(panel.getByText('This demo exercise already has a submission.')).toBeVisible()
  await samples.selectOption('quiet')
  const submitted = await scoreWindow(page)
  expect(submitted.request().postDataJSON().alreadySubmitted).toBe(true)
  expect(await submitted.json()).toMatchObject({ status: 'unavailable', reason: 'already_submitted' })
  await expect(panel.getByText(/Model score/)).toHaveCount(0)

  await page.getByRole('button', { name: 'Reset observation' }).click()
  await expect(panel.getByText('Observe a full two minutes before forecasting.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Classify activity' })).toBeDisabled()
  await samples.selectOption('quiet')
  expect(await (await scoreWindow(page)).json()).toMatchObject({ reason: 'no_editor_change' })
  await expect(panel.getByText('No edits or pastes were observed in this window.')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Editor activity classification' }).getByRole('status'))
    .toContainText('Other activity pattern')
  await samples.selectOption('editing')
  await scoreWindow(page)
  await expect(panel.getByText(/first submission within 10 minutes/)).toBeVisible()
})

test('a late forecast does not replace the already-submitted status', async ({ page }) => {
  let releaseResponse: () => void = () => {}
  const waitForClick = new Promise<void>(resolve => { releaseResponse = resolve })
  await page.route(forecastPath, async (route) => {
    const response = await route.fetch()
    await waitForClick
    await route.fulfill({ response })
  })
  await page.goto('/')
  const panel = forecastPanel(page)
  await page.getByLabel('Load a synthetic sample').selectOption('editing')
  await page.getByRole('button', { name: 'Classify activity' }).click()
  await expect(panel.getByText('Preparing forecast…')).toBeVisible()
  await panel.getByRole('button', { name: 'Mark demo exercise submitted' }).click()
  const received = page.waitForResponse(forecastPath)
  releaseResponse()
  await received
  await expect(page.getByRole('button', { name: 'Classify activity' })).toBeEnabled()
  await expect(panel.getByText('This demo exercise already has a submission.')).toBeVisible()
  await expect(panel.getByText(/Model score/)).toHaveCount(0)
})
