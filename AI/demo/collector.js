export const BIN_SECONDS = 5
export const WINDOW_BINS = 24
export const WINDOW_SECONDS = BIN_SECONDS * WINDOW_BINS
export const FEATURE_VERSION = 'editor-window-v1'
const binMillis = BIN_SECONDS * 1000

export function createObservation(startedAt) {
  // One slot for the current interval and one for each completed interval.
  const ring = new Array(WINDOW_BINS + 1)

  function binAt(time) {
    return Math.floor((time - startedAt) / binMillis)
  }

  function countsAt(index) {
    const entry = ring[index % ring.length]
    return entry?.index === index ? entry.counts : [0, 0, 0]
  }

  return {
    record(time, changes) {
      const index = binAt(time)
      const counts = countsAt(index).map((count, column) => count + changes[column])
      ring[index % ring.length] = { index, counts }
    },
    read(time) {
      const current = binAt(time)
      const complete = current >= WINDOW_BINS
      const first = complete ? current - WINDOW_BINS : 0
      const last = complete ? current : current + 1
      const bins = Array.from({ length: last - first }, (_, offset) => countsAt(first + offset))
      return {
        observed: Math.min((time - startedAt) / 1000, WINDOW_SECONDS),
        bins,
        window: complete ? completeWindow(bins) : null,
      }
    },
  }
}

export function completeWindow(bins) {
  return { featureVersion: FEATURE_VERSION, binSeconds: BIN_SECONDS, observedSeconds: WINDOW_SECONDS, bins }
}

export function countEditorChanges(editor, onCounts) {
  let committed = editor.value
  let composing = false

  function commit(inputType) {
    const next = editor.value
    if (inputType === 'insertFromPaste') {
      committed = next
      onCounts([0, 0, 1])
      return
    }
    if (next === committed) return
    const changes = countChange(committed, next)
    committed = next
    onCounts(changes)
  }

  editor.addEventListener('compositionstart', () => { composing = true })
  editor.addEventListener('compositionend', () => {
    composing = false
    commit('composition')
  })
  editor.addEventListener('input', (event) => {
    if (!event.isComposing && !composing) commit(event.inputType)
  })
  return () => {
    committed = editor.value
    composing = false
  }
}

function countChange(before, after) {
  // Strip the unchanged prefix and suffix. The remaining span gives one
  // removal and/or one insertion, independent of its character count.
  let start = 0
  while (start < before.length && start < after.length && before[start] === after[start]) {
    start++
  }
  let oldEnd = before.length
  let newEnd = after.length
  while (oldEnd > start && newEnd > start && before[oldEnd - 1] === after[newEnd - 1]) {
    oldEnd--
    newEnd--
  }
  const removed = Number(oldEnd > start)
  const inserted = Number(newEnd > start)
  return [removed + inserted, removed, 0]
}
