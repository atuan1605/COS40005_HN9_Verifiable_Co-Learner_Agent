import { completeWindow, countEditorChanges, createObservation, WINDOW_BINS, WINDOW_SECONDS } from './collector.js'

const editor = document.querySelector('#activity-editor')
const start = document.querySelector('#start-observation')
const reset = document.querySelector('#reset-observation')
const sampleSelect = document.querySelector('#activity-sample')
const classify = document.querySelector('#classify-activity')
const progress = document.querySelector('#observation-progress')
const totals = document.querySelector('#observation-counts')
const result = document.querySelector('#activity-result')
const modelDetails = document.querySelector('#activity-model-details')
const markSubmitted = document.querySelector('#mark-submitted')
const forecastResult = document.querySelector('#forecast-result')
const forecastDetails = document.querySelector('#forecast-model-details')

const samples = {
  editing: { label: 'Sustained edits', bins: Array.from({ length: WINDOW_BINS }, () => [2, 1, 0]) },
  quiet: { label: 'Quiet window', bins: Array.from({ length: WINDOW_BINS }, () => [0, 0, 0]) },
}

let observation = null
let revision = 0
let pending = false
let alreadySubmitted = false
let awaitingForecast = true
let notice = 'Start an observation or choose a sample.'

const syncEditor = countEditorChanges(editor, (changes) => {
  if (observation && !document.hidden) {
    observation.record(performance.now(), changes)
    renderObservation()
  }
})

function activeWindow() {
  const sample = samples[sampleSelect.value]
  if (sample) return { source: 'sample', window: completeWindow(sample.bins) }
  const window = observation?.read(performance.now()).window
  return window ? { source: 'live', window } : null
}

function renderObservation() {
  const sample = samples[sampleSelect.value]
  const live = observation?.read(performance.now())
  if (sample) progress.textContent = `Synthetic sample: ${sample.label}. Ready to classify.`
  else if (live?.window) progress.textContent = 'Live observation: two minutes collected. Ready to classify.'
  else if (live) progress.textContent = `Live observation: ${Math.floor(live.observed)} of ${WINDOW_SECONDS} seconds.`
  else progress.textContent = notice

  const bins = sample?.bins ?? live?.bins
  if (bins) {
    const [edits, corrections, pastes] = bins.reduce(
      ([edits, corrections, pastes], [edit, correction, paste]) => [
        edits + edit, corrections + correction, pastes + paste,
      ],
      [0, 0, 0],
    )
    totals.textContent = `Edits: ${edits} · Corrections: ${corrections} · Pastes: ${pastes}`
  }
  else totals.textContent = ''
  classify.disabled = pending || !(sample || live?.window)
  editor.disabled = !observation
  reset.disabled = !(observation || sample || alreadySubmitted)
  markSubmitted.disabled = alreadySubmitted || !(observation || sample)
  if (awaitingForecast && !alreadySubmitted) {
    const message = forecastPrompt(sample || live?.window, live)
    if (forecastResult.textContent !== message) forecastResult.textContent = message
  }
}

function forecastPrompt(complete, live) {
  if (complete) return 'Classify activity to see the forecast for this window.'
  if (live) return 'Observe a full two minutes before forecasting.'
  return 'Start an observation or choose a sample.'
}

function clearResult() {
  revision++
  pending = false
  awaitingForecast = true
  result.hidden = true
  result.textContent = ''
  forecastResult.textContent = alreadySubmitted ? 'This demo exercise already has a submission.' : ''
}

function startObservation() {
  sampleSelect.value = ''
  editor.value = ''
  syncEditor()
  observation = createObservation(performance.now())
  clearResult()
  renderObservation()
  editor.focus()
}

start.addEventListener('click', startObservation)
reset.addEventListener('click', () => {
  alreadySubmitted = false
  startObservation()
})
markSubmitted.addEventListener('click', () => {
  alreadySubmitted = true
  forecastResult.textContent = 'This demo exercise already has a submission.'
  renderObservation()
})
sampleSelect.addEventListener('change', () => {
  observation = null
  editor.value = ''
  syncEditor()
  clearResult()
  notice = 'Start an observation or choose a sample.'
  renderObservation()
})
document.addEventListener('visibilitychange', () => {
  if (!document.hidden || !observation) return
  observation = null
  editor.value = ''
  syncEditor()
  clearResult()
  notice = 'Observation paused when the page was hidden. Start again for a complete window.'
  renderObservation()
})
setInterval(renderObservation, 250)

classify.addEventListener('click', async () => {
  const request = activeWindow()
  if (!request || pending) return
  const submittedRevision = revision
  const submittedState = alreadySubmitted
  pending = true
  awaitingForecast = false
  result.hidden = false
  result.textContent = 'Scoring editor activity…'
  if (!submittedState) forecastResult.textContent = 'Preparing forecast…'
  renderObservation()

  try {
    await Promise.all([
      showInference('/api/classify/activity', request, result, showActivityScore, () => submittedRevision === revision),
      showInference('/api/predict/submission', { ...request, alreadySubmitted: submittedState }, forecastResult,
        showForecastScore, () => submittedRevision === revision && submittedState === alreadySubmitted),
    ])
  }
  finally {
    if (submittedRevision === revision) {
      pending = false
      renderObservation()
    }
  }
})

async function showInference(path, request, target, showScore, isCurrent) {
  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })
    const data = await response.json()
    if (!isCurrent()) return
    if (!response.ok) target.textContent = data.error.message
    else if (data.status === 'unavailable') target.textContent = data.message
    else showScore(data)
  }
  catch {
    if (isCurrent()) target.textContent = 'Could not get a result from the local model. Try again.'
  }
}

function showActivityScore(data) {
  const label = data.label === 'editing' ? 'Editing pattern' : 'Other activity pattern'
  renderScore(result, label, data)
}

function showForecastScore(data) {
  const label = data.label === 'submission_within_10_minutes'
    ? 'Forecast: first submission within 10 minutes'
    : 'Forecast: below the 10-minute submission threshold'
  renderScore(forecastResult, label, data)
}

function renderScore(target, label, data) {
  const source = data.source === 'live' ? 'Live observation' : 'Synthetic sample'
  const heading = document.createElement('p')
  heading.className = 'result-label'
  heading.textContent = `${label} · ${source}`
  const info = document.createElement('p')
  info.textContent = `Model score ${data.score.toFixed(4)} · Threshold ${data.threshold.toFixed(4)}`
  const versions = document.createElement('p')
  versions.textContent = `${data.modelVersion} · ${data.featureVersion}`
  target.replaceChildren(heading, info, versions)
}

export function showActivityModel(model) {
  if (!model?.evaluation) {
    modelDetails.textContent = 'The editor model is currently unavailable.'
    return
  }
  const { evaluation } = model
  const availability = model.available ? '' : 'The editor model is currently unavailable. '
  modelDetails.textContent =
    `${availability}Tested on ${evaluation.holdoutCount} windows from ${evaluation.heldOutProfiles} held-out synthetic profiles. F1 was ${evaluation.f1}, compared with ${evaluation.threeActiveBinsF1} for a simple rule that looks for edits in at least three five-second bins. A quiet window can include reading or planning.`
}

export function showForecastModel(model) {
  if (!model?.evaluation) {
    forecastDetails.textContent = 'The submission model is currently unavailable.'
    return
  }
  const { evaluation } = model
  const availability = model.available ? '' : 'The submission model is currently unavailable. '
  forecastDetails.textContent =
    `${availability}Experimental. On the CS1 test set, average precision was ${evaluation.averagePrecision.toFixed(4)}. Ranking windows by the number of five-second bins with edits scored ${evaluation.activeEditBinsAveragePrecision.toFixed(4)}.`
}

renderObservation()
