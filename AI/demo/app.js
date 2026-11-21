import { showActivityModel } from './activity.js'

const form = document.querySelector('#prompt-form')
const promptInput = document.querySelector('#prompt')
const submit = form.querySelector('button')
const result = document.querySelector('#prompt-result')
const modelStatus = document.querySelector('#model-status')
const modelDetails = document.querySelector('#model-details')

const contentLabels = {
  sh_content: 'Self-harm content signal',
  other_content: 'Other content',
}

function dataList(fields) {
  const list = document.createElement('dl')
  for (const [label, value] of fields) {
    const field = document.createElement('div')
    const term = document.createElement('dt')
    const description = document.createElement('dd')
    term.textContent = label
    description.textContent = value
    field.append(term, description)
    list.append(field)
  }
  return list
}

function showMessage(message, kind) {
  result.hidden = false
  result.dataset.kind = kind
  result.textContent = message
}

function showScore(scored) {
  const label = document.createElement('p')
  label.className = 'result-label'
  label.textContent = contentLabels[scored.label]
  result.hidden = false
  result.dataset.kind = 'scored'
  result.replaceChildren(label, dataList([
    ['Model score', scored.score.toFixed(4)],
    ['Threshold', scored.threshold.toFixed(4)],
    ['Model version', scored.modelVersion],
  ]))
}

form.addEventListener('submit', async (event) => {
  event.preventDefault()
  const prompt = promptInput.value
  if (!prompt.trim()) {
    showMessage('Enter a prompt to classify.', 'error')
    promptInput.focus()
    return
  }
  submit.disabled = true
  showMessage('Scoring prompt…', 'pending')
  try {
    const response = await fetch('/api/classify/prompt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt, language: 'en' }),
    })
    const data = await response.json()
    if (response.ok) showScore(data)
    else showMessage(data.error.message, 'error')
  }
  catch {
    showMessage('Could not reach the local model. Check that the ML demo is running and try again.', 'error')
  }
  finally {
    submit.disabled = false
  }
})

async function showModelDetails() {
  try {
    const response = await fetch('/api/models')
    if (!response.ok) throw new Error('Could not load model metadata.')
    const { models } = await response.json()
    const model = models.find(item => item.task === 'prompt_content')
    showActivityModel(models.find(item => item.task === 'editor_activity'))
    const { evaluation } = model
    modelStatus.textContent = model.available ? model.meaning : 'The prompt model is currently unavailable.'
    if (!evaluation) return
    const languages = new Intl.DisplayNames(['en'], { type: 'language' })
    modelDetails.replaceChildren(...dataList([
      ['Language', languages.of(model.language)],
      ['Evaluation status', model.evaluationStatus],
      ['Model version', model.modelVersion],
      ['Features', model.featureDescription],
      ['Evaluation data', evaluation.dataset],
      ['Holdout', `${evaluation.holdoutCount} prompts (${evaluation.positiveCount} positive)`],
      ['Average precision', `${evaluation.averagePrecision} (constant score baseline ${evaluation.constantScoreAveragePrecision})`],
      ['Artifact SHA-256', model.sha256],
    ]).children)
  }
  catch {
    modelStatus.textContent = 'Could not load model details. Refresh to try again.'
    showActivityModel()
  }
}

void showModelDetails()
