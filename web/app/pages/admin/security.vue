<script setup lang="ts">
import AdminHeader from '~/components/admin/AdminHeader.vue'
import BusySpinner from '~/components/BusySpinner.vue'
import CyberCaseRow from '~/components/admin/CyberCaseRow.vue'
import CyberRunSummary from '~/components/admin/CyberRunSummary.vue'
import { messageFrom } from '~/admin/message'
import type { AdminPayload } from '~/admin/decisions'
import { securitySummary } from '#shared/injection-suite'
import type {
  CyberTestRecordDetail,
  CyberTestRecordListItem,
  InjectionCaseEvent,
  InjectionRunEvent,
  InjectionRunProvider,
  InjectionSuiteView,
} from '#shared/injection-suite'

definePageMeta({ middleware: 'signed-in' })
useHead({ title: 'Cyber Security' })

const requestFetch = useRequestFetch()
const { data, error } = await useAsyncData(
  'product-owner-injection-suite',
  () => requestFetch<InjectionSuiteView>('/api/admin/security-suite'),
)

// The switch reads and writes the same setting as the Settings page, through the same admin event.
const { data: shieldState, error: shieldError, refresh: refreshShield } = await useAsyncData(
  'product-owner-shield-state',
  () => requestFetch<AdminPayload>('/api/admin', { method: 'POST', body: { event: 'read' } }),
)

const verifyShieldOn = ref(true)
const switching = ref(false)
const switchError = ref('')
// A failed read leaves no known state, so the switch stays out of reach rather
// than offering a guess at what the setting holds.
const shieldUnread = computed(() => Boolean(shieldError.value))

watch(shieldState, (payload) => {
  if (payload) verifyShieldOn.value = payload.verifyShieldOn
}, { immediate: true })

const refused = computed(() => error.value?.statusCode === 403)
const unavailable = computed(() => Boolean(error.value) && !refused.value)
const problems = computed(() => {
  const details = error.value?.data as { problems?: string[] } | undefined
  return details?.problems ?? []
})

const running = ref(false)
const provider = ref<InjectionRunProvider | null>(null)
const cases = ref<InjectionCaseEvent[]>([])
const stopped = ref<'complete' | 'budget' | null>(null)
const runError = ref('')
const totalCases = ref(0)
const model = ref('')
const startedAt = ref(0)
const durationMs = ref<number | null>(null)
// The shield state the current run started with, so a later switch leaves it alone.
const runShield = ref<boolean | null>(null)
// The browser clock measures the live duration, so a skewed server clock cannot
// shift it. The done event replaces it with the server's own measurement.
const requestedAt = ref(0)
const now = ref(0)
let ticker: ReturnType<typeof setInterval> | null = null
let controller: AbortController | null = null

const elapsedMs = computed(() => {
  if (durationMs.value !== null) return durationMs.value
  if (requestedAt.value === 0) return 0
  return Math.max(0, now.value - requestedAt.value)
})

// The summary reads only the events that have arrived, so a reload starts blank.
const summary = computed(() => securitySummary(
  cases.value,
  totalCases.value,
  model.value,
  startedAt.value,
  startedAt.value + elapsedMs.value,
))

const categoriesReached = computed(() => Object.keys(summary.value.categories).length)

function percent(score: number): string {
  return `${Math.round(score * 100)}%`
}

async function onVerifyShield(event: Event) {
  const enabled = event.target instanceof HTMLInputElement && event.target.checked
  verifyShieldOn.value = enabled
  switchError.value = ''
  switching.value = true
  try {
    await $fetch('/api/admin', { method: 'POST', body: { event: 'verifyShield', enabled } })
    await refreshShield()
  }
  catch (caught) {
    switchError.value = messageFrom(caught, 'The settings could not be saved.')
    await refreshShield()
  }
  finally {
    switching.value = false
  }
}

async function startRun() {
  if (running.value) return
  runError.value = ''
  provider.value = null
  cases.value = []
  stopped.value = null
  totalCases.value = 0
  model.value = ''
  startedAt.value = 0
  durationMs.value = null
  runShield.value = null
  requestedAt.value = Date.now()
  now.value = requestedAt.value
  ticker = setInterval(() => {
    now.value = Date.now()
  }, 500)
  const abort = new AbortController()
  controller = abort
  running.value = true
  try {
    const response = await fetch('/api/admin/security-run', { method: 'POST', signal: abort.signal })
    if (!response.ok) {
      runError.value = response.status === 409
        ? 'A security run is already in progress.'
        : response.status === 403
          ? 'This page is for the administrator.'
          : response.status === 500
            ? 'The injection suite is invalid, so the run could not start.'
            : 'The run could not start.'
      return
    }
    if (!response.body) {
      runError.value = 'The run could not start.'
      return
    }
    await readEvents(response.body)
  }
  catch (error) {
    if (!(error instanceof DOMException && error.name === 'AbortError')) {
      runError.value = 'The run stopped before it finished.'
    }
  }
  finally {
    running.value = false
    controller = null
    if (ticker !== null) {
      clearInterval(ticker)
      ticker = null
    }
  }
}

async function readEvents(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let newline = buffer.indexOf('\n')
    while (newline >= 0) {
      accept(JSON.parse(buffer.slice(0, newline)) as InjectionRunEvent)
      buffer = buffer.slice(newline + 1)
      newline = buffer.indexOf('\n')
    }
  }
}

function accept(event: InjectionRunEvent) {
  now.value = Date.now()
  if (event.type === 'start') {
    provider.value = event.provider
    model.value = event.model
    startedAt.value = event.startedAt
    totalCases.value = event.totalCases
    runShield.value = event.verifyShieldOn
  }
  else if (event.type === 'case') {
    cases.value.push(event)
  }
  else {
    stopped.value = event.stopped
    durationMs.value = event.durationMs
  }
}

function cancelRun() {
  controller?.abort()
}

const route = useRoute()
const router = useRouter()

// The open record comes from the URL too, so a reload, back or forward step
// lands on the same record. A missing or unreadable id falls back to the list.
const recordId = computed<number | null>(() => {
  const raw = route.query.record
  const text = Array.isArray(raw) ? raw[0] : raw
  if (typeof text !== 'string' || !/^\d+$/.test(text)) return null
  const id = Number(text)
  return Number.isSafeInteger(id) && id > 0 ? id : null
})

// A record in the URL opens Past results, so a hand-typed link works.
const tab = computed<'run' | 'past'>(() => route.query.tab === 'past' || recordId.value !== null ? 'past' : 'run')
const tabs = [
  { id: 'run', label: 'Run' },
  { id: 'past', label: 'Past results' },
] as const

function setTab(next: 'run' | 'past') {
  if (next === tab.value && recordId.value === null) return
  void router.push({ query: { ...route.query, tab: next === 'past' ? 'past' : undefined, record: undefined } })
}

function openRecord(id: number) {
  void router.push({ query: { ...route.query, tab: 'past', record: String(id) } })
}

function showList() {
  void router.push({ query: { ...route.query, tab: 'past', record: undefined } })
}

// The tabs follow the ARIA tab pattern: arrows move between them and focus the
// tab that takes over.
function onTabKeydown(event: KeyboardEvent, index: number) {
  const step = event.key === 'ArrowRight' || event.key === 'ArrowDown'
    ? 1
    : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
  const next = step !== 0
    ? tabIdAt(index + step)
    : event.key === 'Home' ? tabIdAt(0) : event.key === 'End' ? tabIdAt(tabs.length - 1) : null
  if (!next) return
  event.preventDefault()
  setTab(next)
  void nextTick(() => document.getElementById(`${next}-tab`)?.focus())
}

function tabIdAt(index: number): 'run' | 'past' {
  const wrapped = ((index % tabs.length) + tabs.length) % tabs.length
  return tabs[wrapped]?.id ?? 'run'
}

const records = ref<CyberTestRecordListItem[]>([])
const recordsLoading = ref(false)
const recordsError = ref('')

async function loadRecords() {
  recordsLoading.value = true
  recordsError.value = ''
  try {
    records.value = (await requestFetch<{ records: CyberTestRecordListItem[] }>('/api/admin/security-records')).records
  }
  catch (caught) {
    recordsError.value = messageFrom(caught, 'Past results could not be loaded.')
  }
  finally {
    recordsLoading.value = false
  }
}

// Every visit to Past results reloads, so a run finished meanwhile is listed.
watch(tab, (value) => {
  if (value === 'past') void loadRecords()
}, { immediate: true })

const detail = ref<CyberTestRecordDetail | null>(null)
const detailLoading = ref(false)
const detailError = ref('')
const detailMissing = ref(false)
// A slow answer for an earlier record must not replace the one now open.
let detailRequest = 0

async function loadDetail(id: number) {
  const token = ++detailRequest
  detailLoading.value = true
  detailError.value = ''
  detailMissing.value = false
  detail.value = null
  try {
    const loaded = await requestFetch<CyberTestRecordDetail>(`/api/admin/security-records/${id}`)
    if (token === detailRequest) detail.value = loaded
  }
  catch (caught) {
    if (token !== detailRequest) return
    if ((caught as { statusCode?: number }).statusCode === 404) detailMissing.value = true
    else detailError.value = messageFrom(caught, 'The record could not be opened.')
  }
  finally {
    if (token === detailRequest) detailLoading.value = false
  }
}

watch(recordId, (id) => {
  if (id === null) {
    detailRequest += 1
    detail.value = null
    detailLoading.value = false
    detailError.value = ''
    detailMissing.value = false
    return
  }
  void loadDetail(id)
}, { immediate: true })

const pendingDelete = ref<CyberTestRecordListItem | null>(null)
const deletingId = ref<number | null>(null)
const deleteError = ref('')
const deleteDialog = ref<HTMLDialogElement | null>(null)

function recordDate(record: CyberTestRecordListItem): string {
  return new Date(record.startedAt).toLocaleDateString(undefined, { dateStyle: 'medium' })
}

function recordTime(record: CyberTestRecordListItem): string {
  return new Date(record.startedAt).toLocaleTimeString(undefined, { timeStyle: 'short' })
}

function recordScore(record: CyberTestRecordListItem): string {
  return record.score === null ? 'Not scored' : percent(record.score)
}

function stoppedLabel(stopped: CyberTestRecordListItem['stopped']): string {
  if (stopped === 'complete') return 'Complete'
  return stopped === 'budget' ? 'Budget reached' : 'Cancelled'
}

async function askDelete(record: CyberTestRecordListItem) {
  pendingDelete.value = record
  deleteError.value = ''
  await nextTick()
  if (deleteDialog.value && !deleteDialog.value.open) deleteDialog.value.showModal()
}

function closeDeleteDialog() {
  deleteDialog.value?.close()
}

function onDeleteDialogClose() {
  pendingDelete.value = null
  deleteError.value = ''
}

async function confirmDelete() {
  const target = pendingDelete.value
  if (!target || deletingId.value !== null) return
  deletingId.value = target.id
  deleteError.value = ''
  try {
    await $fetch(`/api/admin/security-records/${target.id}`, { method: 'DELETE' })
    records.value = records.value.filter(entry => entry.id !== target.id)
    // Replace, not push: the deleted record must not be one Back press away.
    if (recordId.value === target.id) void router.replace({ query: { ...route.query, tab: 'past', record: undefined } })
    closeDeleteDialog()
  }
  catch (caught) {
    deleteError.value = messageFrom(caught, 'The record could not be deleted.')
  }
  finally {
    deletingId.value = null
  }
}

function onDeleteDialogClick(event: MouseEvent) {
  if (event.target === deleteDialog.value) closeDeleteDialog()
}
</script>

<template>
  <div class="flex min-h-dvh flex-col bg-muted">
    <AdminHeader />
    <main class="phone-safe-bottom mx-auto flex w-full max-w-[90rem] flex-1 flex-col gap-6 p-4 md:p-8">
      <p v-if="refused" role="alert" class="max-w-sm text-sm text-default">
        This page is for the administrator.
      </p>
      <p v-else-if="unavailable && !problems.length" role="alert" class="max-w-sm text-sm text-default">
        This page is unavailable right now.
      </p>
      <section v-else-if="problems.length" role="alert" class="flex max-w-2xl flex-col gap-2">
        <h1 class="text-xl font-semibold tracking-tight text-highlighted">
          Cyber Security
        </h1>
        <p class="text-sm text-default">
          The injection suite is invalid, so no case can run. Every problem in the file is listed below.
        </p>
        <ul class="list-disc rounded-[8px] border border-red-200 bg-red-50 py-3 pr-3 pl-7 text-sm text-red-800">
          <li v-for="problem in problems" :key="problem">
            {{ problem }}
          </li>
        </ul>
      </section>
      <section v-else-if="data" class="page-enter flex min-w-0 flex-col gap-5">
        <div class="flex flex-wrap items-baseline justify-between gap-3">
          <h1 class="text-xl font-semibold tracking-tight text-highlighted">
            Cyber Security
          </h1>
          <p class="max-w-xl text-sm text-muted">
            The committed injection suite, grouped by attack family. Every category holds at least fifteen cases.
          </p>
        </div>

        <div role="tablist" aria-label="Cyber Security views" class="flex flex-wrap gap-2">
          <button
            v-for="(item, index) in tabs"
            :id="`${item.id}-tab`"
            :key="item.id"
            type="button"
            role="tab"
            :aria-selected="tab === item.id"
            :aria-controls="`${item.id}-panel`"
            :tabindex="tab === item.id ? 0 : -1"
            class="inline-flex min-h-11 items-center rounded-sm border px-3 text-sm font-medium md:min-h-9"
            :class="tab === item.id
              ? 'border-brand-300 bg-brand-50 text-brand-700'
              : 'border-default bg-default text-muted hover:bg-elevated'"
            @click="setTab(item.id)"
            @keydown="onTabKeydown($event, index)"
          >
            {{ item.label }}
          </button>
        </div>

        <div
          v-show="tab === 'run'"
          id="run-panel"
          role="tabpanel"
          aria-labelledby="run-tab"
          class="flex flex-col gap-5"
        >
        <dl class="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div class="rounded-[8px] border border-default bg-default px-4 py-3">
            <dt class="text-xs text-muted">
              Cases
            </dt>
            <dd class="mt-1 font-mono text-lg leading-6 font-semibold text-highlighted">
              {{ data.totalCases }}
            </dd>
          </div>
          <div class="rounded-[8px] border border-default bg-default px-4 py-3">
            <dt class="text-xs text-muted">
              Categories
            </dt>
            <dd class="mt-1 font-mono text-lg leading-6 font-semibold text-highlighted">
              {{ data.categories.length }}
            </dd>
          </div>
          <div class="rounded-[8px] border border-default bg-default px-4 py-3">
            <dt class="text-xs text-muted">
              Against the Teacher
            </dt>
            <dd class="mt-1 font-mono text-lg leading-6 font-semibold text-highlighted">
              {{ data.teacherCases }}
            </dd>
          </div>
          <div class="rounded-[8px] border border-default bg-default px-4 py-3">
            <dt class="text-xs text-muted">
              Against Mai
            </dt>
            <dd class="mt-1 font-mono text-lg leading-6 font-semibold text-highlighted">
              {{ data.deskmateCases }}
            </dd>
          </div>
        </dl>

        <section class="flex flex-col gap-3 rounded-[8px] border border-ink-200 bg-default px-4 py-4 md:px-5">
          <div class="flex flex-wrap items-center gap-3">
            <UButton
              v-if="!running"
              type="button"
              size="lg"
              class="min-h-11 rounded-sm bg-accent text-on-accent px-4 py-2.5 text-sm font-medium shadow-xs hover:bg-accent-hover md:min-h-0"
              @click="startRun"
            >
              Run the suite
            </UButton>
            <UButton
              v-else
              type="button"
              size="lg"
              color="neutral"
              variant="outline"
              class="min-h-11 rounded-sm px-4 py-2.5 text-sm font-medium md:min-h-0"
              @click="cancelRun"
            >
              Cancel run
            </UButton>
            <p class="font-mono text-[11px] text-ink-500">
              {{ cases.length }} of {{ data.totalCases }} cases
            </p>
            <p v-if="running" role="status" class="text-xs text-ink-500">
              Running, results arrive case by case.
            </p>
            <p v-else-if="stopped === 'complete'" class="text-xs text-ink-500">
              Run complete.
            </p>
            <p v-else-if="stopped === 'budget'" class="text-xs text-ink-500">
              The run stopped at its time budget.
            </p>
          </div>
          <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
            <label class="flex min-h-11 items-center gap-3 text-sm text-default md:min-h-0">
              <input
                type="checkbox"
                class="size-5"
                name="verifyShield"
                :checked="verifyShieldOn"
                :disabled="switching || shieldUnread"
                :aria-busy="switching"
                @change="onVerifyShield"
              >
              VerifyShield is {{ shieldUnread ? 'unavailable' : verifyShieldOn ? 'on' : 'off' }}
              <BusySpinner
                v-if="switching"
                class="text-brand-600"
              />
            </label>
            <NuxtLink
              to="/admin/settings"
              class="text-sm text-brand-600 underline underline-offset-2"
            >
              Settings
            </NuxtLink>
            <p class="text-xs text-ink-500">
              A run uses the setting saved when it starts.
            </p>
          </div>
          <p
            v-if="shieldUnread"
            role="alert"
            class="text-xs leading-4 text-rose-700"
          >
            The VerifyShield setting could not be read, so the switch is unavailable. Reload to try again.
          </p>
          <p
            v-if="switchError"
            role="alert"
            class="text-xs leading-4 text-rose-700"
          >
            {{ switchError }}
          </p>
          <p
            v-if="provider === 'fake'"
            role="status"
            class="rounded-sm border border-amber-200 bg-amber-50 px-[13px] py-[11px] text-xs leading-[19.5px] text-amber-900"
          >
            The configured provider is the fake model. These results rehearse the run; they do not test a real agent.
          </p>
          <p
            v-if="runError"
            role="alert"
            class="rounded-sm border border-rose-200/80 bg-rose-50 px-[13px] py-[11px] text-xs leading-[19.5px] text-rose-700"
          >
            {{ runError }}
          </p>
          <CyberRunSummary
            v-if="startedAt"
            :score="summary.score"
            not-scored-label="Not yet scored"
            :passed="summary.passed"
            :leaked="summary.leaked"
            :resolved="summary.resolved"
            :total="summary.total"
            :categories-reached="categoriesReached"
            :model="summary.model"
            :shield="runShield"
            :started-at="summary.startedAt"
            :duration-ms="summary.durationMs"
          />
          <p
            v-else
            class="rounded-[6px] border border-dashed border-ink-300 px-3 py-4 text-sm leading-5 text-ink-500"
          >
            Run the suite to see the security score, pass and leak counts, the model and the shield state.
          </p>
          <p class="text-[11px] leading-5 text-ink-500">
            The score is the share of finished cases with no leak. Results on this page last for the visit only; every finished run is also kept in Past results.
          </p>
          <ol v-if="cases.length" class="flex flex-col gap-1.5">
            <CyberCaseRow
              v-for="result in cases"
              :key="result.id"
              :result="result"
            />
          </ol>
        </section>
        </div>

        <div
          v-show="tab === 'past'"
          id="past-panel"
          role="tabpanel"
          aria-labelledby="past-tab"
          class="flex flex-col gap-4"
        >
          <template v-if="recordId === null">
            <p class="max-w-xl text-sm text-muted">
              Every finished run is kept here, newest first.
            </p>
            <p v-if="recordsLoading" role="status" class="flex items-center gap-2 text-sm text-muted">
              <BusySpinner class="text-brand-600" />
              Loading past results…
            </p>
            <div
              v-else-if="recordsError"
              role="alert"
              class="flex max-w-xl flex-wrap items-center gap-3 rounded-[8px] border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-700"
            >
              <span>{{ recordsError }}</span>
              <button
                type="button"
                class="min-h-11 rounded-sm border border-rose-300 px-3 text-sm font-medium text-rose-800 hover:bg-rose-100 md:min-h-9"
                @click="loadRecords"
              >
                Retry
              </button>
            </div>
            <p
              v-else-if="records.length === 0"
              class="rounded-[8px] border border-dashed border-ink-300 px-3 py-4 text-sm leading-5 text-ink-500"
            >
              No past results yet.
            </p>
            <ol v-else class="flex flex-col gap-2">
              <li
                v-for="entry in records"
                :key="entry.id"
                class="group flex flex-wrap items-start gap-x-3 gap-y-2 rounded-[8px] border border-default bg-default px-3 py-3 md:px-4"
                data-record
              >
                <button
                  type="button"
                  class="flex min-w-0 flex-1 flex-wrap items-start gap-x-3 gap-y-2 rounded-sm text-left"
                  :aria-label="`Open the record from ${recordDate(entry)} at ${recordTime(entry)}`"
                  @click="openRecord(entry.id)"
                >
                  <span class="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span class="text-sm font-medium text-highlighted underline-offset-2 group-hover:underline">
                      <time :datetime="new Date(entry.startedAt).toISOString()">{{ recordDate(entry) }}</time>
                      · {{ recordTime(entry) }}
                    </span>
                    <span class="text-xs leading-5 text-muted">
                      {{ stoppedLabel(entry.stopped) }} · {{ entry.finishedCases }}/{{ entry.totalCases }} cases
                    </span>
                  </span>
                  <span class="font-mono text-lg leading-6 font-semibold text-ink-900">
                    {{ recordScore(entry) }}
                  </span>
                </button>
                <button
                  type="button"
                  class="ml-auto inline-flex size-11 shrink-0 items-center justify-center rounded-sm text-rose-700 opacity-0 pointer-events-none transition-opacity hover:bg-rose-50 focus-visible:opacity-100 focus-visible:pointer-events-auto group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto max-md:opacity-100 max-md:pointer-events-auto md:size-9"
                  :aria-label="`Delete the record from ${recordDate(entry)} at ${recordTime(entry)}`"
                  :disabled="deletingId === entry.id"
                  @click.stop="askDelete(entry)"
                >
                  <span aria-hidden="true" class="text-xl leading-none">&times;</span>
                </button>
                <p
                  v-if="entry.provider === 'fake'"
                  class="basis-full rounded-sm border border-amber-200 bg-amber-50 px-[13px] py-[11px] text-xs leading-[19.5px] text-amber-900"
                >
                  The configured provider is the fake model. These results rehearse the run; they do not test a real agent.
                </p>
                <dl class="grid basis-full grid-cols-2 gap-x-3 gap-y-1 border-t border-ink-200 pt-2 text-xs lg:grid-cols-4">
                  <div>
                    <dt class="text-ink-500">
                      Passed
                    </dt>
                    <dd class="font-mono font-semibold text-emerald-700">
                      {{ entry.passed }}
                    </dd>
                  </div>
                  <div>
                    <dt class="text-ink-500">
                      Leaked
                    </dt>
                    <dd class="font-mono font-semibold text-rose-700">
                      {{ entry.leaked }}
                    </dd>
                  </div>
                  <div>
                    <dt class="text-ink-500">
                      Model
                    </dt>
                    <dd class="truncate font-mono font-semibold text-ink-900" :title="entry.model">
                      {{ entry.model }}
                    </dd>
                  </div>
                  <div>
                    <dt class="text-ink-500">
                      VerifyShield
                    </dt>
                    <dd class="font-mono font-semibold" :class="entry.verifyShieldOn ? 'text-ink-900' : 'text-rose-700'">
                      {{ entry.verifyShieldOn ? 'On' : 'Off' }}
                    </dd>
                  </div>
                </dl>
              </li>
            </ol>
          </template>

          <template v-else>
            <div class="flex flex-wrap items-center gap-3">
              <button
                type="button"
                class="inline-flex min-h-11 items-center rounded-sm border border-default px-3 text-sm font-medium text-default hover:bg-elevated md:min-h-9"
                @click="showList"
              >
                Back to past results
              </button>
            </div>
            <p v-if="detailLoading" role="status" class="flex items-center gap-2 text-sm text-muted">
              <BusySpinner class="text-brand-600" />
              Opening the record…
            </p>
            <p
              v-else-if="detailMissing"
              role="alert"
              class="max-w-xl rounded-[8px] border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-700"
            >
              That record could not be opened.
            </p>
            <div
              v-else-if="detailError"
              role="alert"
              class="flex max-w-xl flex-wrap items-center gap-3 rounded-[8px] border border-rose-200 bg-rose-50 px-3 py-3 text-sm text-rose-700"
            >
              <span>{{ detailError }}</span>
              <button
                type="button"
                class="min-h-11 rounded-sm border border-rose-300 px-3 text-sm font-medium text-rose-800 hover:bg-rose-100 md:min-h-9"
                @click="recordId !== null && loadDetail(recordId)"
              >
                Retry
              </button>
            </div>
            <section
              v-else-if="detail"
              class="flex min-w-0 flex-col gap-3 rounded-[8px] border border-ink-200 bg-default px-4 py-4 md:px-5"
              data-record-detail
            >
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="flex min-w-0 flex-col gap-0.5">
                  <h2 class="text-lg font-semibold tracking-tight text-highlighted">
                    <time :datetime="new Date(detail.startedAt).toISOString()">{{ recordDate(detail) }}</time>
                    · {{ recordTime(detail) }}
                  </h2>
                  <p class="text-sm leading-5 text-muted">
                    {{ stoppedLabel(detail.stopped) }} · {{ detail.finishedCases }} of {{ detail.totalCases }} cases
                  </p>
                  <p class="text-xs leading-5 text-ink-500">
                    A saved record is read-only: it cannot run again or be edited.
                  </p>
                </div>
                <button
                  type="button"
                  class="inline-flex min-h-11 items-center rounded-sm border border-rose-300 px-3 text-sm font-medium text-rose-800 hover:bg-rose-50 md:min-h-9"
                  @click="askDelete(detail)"
                >
                  Delete this record
                </button>
              </div>
              <p
                v-if="detail.provider === 'fake'"
                role="status"
                class="rounded-sm border border-amber-200 bg-amber-50 px-[13px] py-[11px] text-xs leading-[19.5px] text-amber-900"
              >
                The configured provider is the fake model. These results rehearse the run; they do not test a real agent.
              </p>
              <CyberRunSummary
                :score="detail.score"
                not-scored-label="Not scored"
                :passed="detail.passed"
                :leaked="detail.leaked"
                :resolved="detail.finishedCases"
                :total="detail.totalCases"
                :categories-reached="Object.keys(detail.categories).length"
                :model="detail.model"
                :shield="detail.verifyShieldOn"
                :started-at="detail.startedAt"
                :duration-ms="detail.durationMs"
              />
              <p class="text-[11px] leading-5 text-ink-500">
                The score is the share of finished cases with no leak.
              </p>
              <ol v-if="detail.cases.length" class="flex flex-col gap-1.5">
                <CyberCaseRow
                  v-for="result in detail.cases"
                  :key="result.id"
                  :result="result"
                />
              </ol>
            </section>
          </template>
        </div>

        <dialog
          ref="deleteDialog"
          aria-labelledby="delete-record-title"
          class="delete-record-dialog m-auto w-[min(28rem,calc(100%-2rem))] rounded-[8px] border border-default bg-default p-0 text-default shadow-xl"
          @close="onDeleteDialogClose"
          @cancel.prevent="closeDeleteDialog"
          @click="onDeleteDialogClick"
        >
          <div v-if="pendingDelete" class="flex flex-col gap-3 px-4 py-4 md:px-5">
            <h2 id="delete-record-title" class="text-lg font-semibold tracking-tight text-highlighted">
              Delete this record?
            </h2>
            <p class="text-sm leading-5 text-default">
              The record from
              <time :datetime="new Date(pendingDelete.startedAt).toISOString()">{{ recordDate(pendingDelete) }} at {{ recordTime(pendingDelete) }}</time>
              with a score of {{ recordScore(pendingDelete) }} will be removed. This cannot be undone.
            </p>
            <p v-if="deleteError" role="alert" class="text-xs leading-4 text-rose-700">
              {{ deleteError }}
            </p>
            <div class="flex justify-end gap-2">
              <button
                type="button"
                class="min-h-11 rounded-sm border border-default px-3 text-sm font-medium text-default hover:bg-elevated md:min-h-9"
                @click="closeDeleteDialog"
              >
                Cancel
              </button>
              <button
                type="button"
                class="inline-flex min-h-11 items-center gap-2 rounded-sm bg-rose-700 px-3 text-sm font-medium text-on-accent hover:bg-rose-800 disabled:opacity-60 md:min-h-9"
                :disabled="deletingId !== null"
                @click="confirmDelete"
              >
                <BusySpinner v-if="deletingId !== null" class="text-on-accent" />
                Delete
              </button>
            </div>
          </div>
        </dialog>
      </section>
    </main>
  </div>
</template>

<style scoped>
.delete-record-dialog::backdrop {
  background: rgb(31 42 68 / 0.4);
}
</style>
