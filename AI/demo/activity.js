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

const samples = {
  editing: { label: 'Sustained edits', bins: Array.from({ length: WINDOW_BINS }, () => [2, 1, 0]) },
  quiet: { label: 'Quiet window', bins: Array.from({ length: WINDOW_BINS }, () => [0, 0, 0]) },
}

let observation = null
let revision = 0
let pending = false
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
  reset.disabled = !observation
}

function clearResult() {
  revision++
  pending = false
  result.hidden = true
  result.textContent = ''
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
reset.addEventListener('click', startObservation)
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
  pending = true
  result.hidden = false
  result.textContent = 'Scoring editor activity…'
  renderObservation()
  try {
    const response = await fetch('/api/classify/activity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })
    const data = await response.json()
    if (submittedRevision !== revision) return
    if (!response.ok) result.textContent = data.error.message
    else if (data.status === 'unavailable') result.textContent = data.message
    else showActivityScore(data)
  }
  catch {
    if (submittedRevision === revision) result.textContent = 'Could not reach the local editor model. Try again.'
  }
  finally {
    if (submittedRevision === revision) {
      pending = false
      renderObservation()
    }
  }
})

function showActivityScore(data) {
  const label = data.label === 'editing' ? 'Editing pattern' : 'Other activity pattern'
  const source = data.source === 'live' ? 'Live observation' : 'Synthetic sample'
  const heading = document.createElement('p')
  heading.className = 'result-label'
  heading.textContent = `${label} · ${source}`
  const info = document.createElement('p')
  info.textContent = `Model score ${data.score.toFixed(4)} · Threshold ${data.threshold.toFixed(4)}`
  const versions = document.createElement('p')
  versions.textContent = `${data.modelVersion} · ${data.featureVersion}`
  result.replaceChildren(heading, info, versions)
}

export function showActivityModel(model) {
  if (!model?.evaluation) {
    modelDetails.textContent = 'The editor model is currently unavailable.'
    return
  }
  const { evaluation } = model
  const availability = model.available ? '' : 'The editor model is currently unavailable. '
  modelDetails.textContent =
    `${availability}${model.meaning} Features: ${model.featureDescription}. Evaluation used ${evaluation.holdoutCount} windows from ${evaluation.heldOutProfiles} held-out synthetic profiles. F1 ${evaluation.f1} (three-active-bin baseline ${evaluation.threeActiveBinsF1}).`
}

renderObservation()
