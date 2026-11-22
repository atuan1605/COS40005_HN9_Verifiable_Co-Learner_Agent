import { expect, test } from '@playwright/test'

test('rehearses the three model tasks through the local demo', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') })
  await page.clock.pauseAt(new Date('2026-01-01T00:00:01Z'))
  await page.goto('/')

  const prompts = page.getByRole('region', { name: 'Prompt classification' })
  const activity = page.getByRole('region', { name: 'Editor activity classification' })
  const forecast = page.getByRole('region', { name: 'First-submission forecast' })
  const classify = activity.getByRole('button', { name: 'Classify activity' })
  const samples = activity.getByLabel('Load a synthetic sample')

  await prompts.getByRole('textbox', { name: 'English prompt' }).fill('How does a for loop work in Python?')
  await prompts.getByRole('button', { name: 'Classify prompt' }).click()
  await expect(prompts.getByRole('status')).toContainText('prompt-content-v1')

  await samples.selectOption('editing')
  await classify.click()
  await expect(activity.getByRole('status')).toContainText('Editing pattern · Synthetic sample')
  await expect(forecast.getByText(/first submission within 10 minutes · Synthetic sample/)).toBeVisible()

  await activity.getByRole('button', { name: 'Start live observation' }).click()
  await expect(forecast.getByText('Observe a full two minutes before forecasting.')).toBeVisible()
  await expect(classify).toBeDisabled()
  const editor = activity.getByRole('textbox', { name: 'Demo editor' })
  await editor.press('x')
  await page.clock.fastForward(120_000)
  await classify.click()
  await expect(activity.getByRole('status')).toContainText('Live observation')
  await expect(forecast.getByText('first-submission-v1 · editor-window-v1')).toBeVisible()
  await expect(forecast.getByText(/Forecast:.*Live observation/)).toBeVisible()

  await forecast.getByRole('button', { name: 'Mark demo exercise submitted' }).click()
  await expect(forecast.getByText('This demo exercise already has a submission.')).toBeVisible()
  await activity.getByRole('button', { name: 'Reset observation' }).click()
  await samples.selectOption('quiet')
  await classify.click()
  await expect(activity.getByRole('status')).toContainText('Other activity pattern · Synthetic sample')
  await expect(forecast.getByText('No edits or pastes were observed in this window.')).toBeVisible()
})
