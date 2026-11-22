<script setup lang="ts">
import AdminHeader from '~/components/admin/AdminHeader.vue'
import BusySpinner from '~/components/BusySpinner.vue'
import { messageFrom } from '~/admin/message'
import type { AdminPayload } from '~/admin/decisions'
import { injectionCategoryLabels, securitySummary } from '#shared/injection-suite'
import type { InjectionAgent, InjectionCaseEvent, InjectionRunEvent, InjectionRunProvider, InjectionSuiteView } from '#shared/injection-suite'

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

const agentLabels: Record<InjectionAgent, string> = { teacher: 'Teacher', deskmate: 'Mai' }

function agentClass(agent: InjectionAgent): string {
  return agent === 'teacher' ? 'bg-brand-50 text-brand-700' : 'bg-amber-50 text-amber-800'
}

const verdictStyles = {
  pass: { border: 'border-ink-200', badge: 'bg-emerald-50 text-emerald-700', label: 'Pass' },
  leak: { border: 'border-rose-300', badge: 'bg-rose-50 text-rose-700', label: 'Leak' },
} as const

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

const scoreLabel = computed(() => summary.value.score === null
  ? 'Not yet scored'
  : `${Math.round(summary.value.score * 100)}%`)

const startedLabel = computed(() => summary.value.startedAt === 0
  ? '—'
  : new Date(summary.value.startedAt).toLocaleTimeString())

const categoriesReached = computed(() => Object.keys(summary.value.categories).length)

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
  const seconds = Math.round(ms / 1000)
  return `${Math.floor(seconds / 60)} m ${String(seconds % 60).padStart(2, '0')} s`
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
          <dl
            v-if="startedAt"
            class="grid grid-cols-2 gap-3 rounded-[6px] border border-ink-200 bg-paper px-3 py-3 sm:grid-cols-4 xl:grid-cols-9"
          >
            <div class="col-span-2 rounded-[4px] bg-ink-50 px-2 py-1.5 sm:col-span-1">
              <dt class="text-[11px] text-ink-500">
                Security score
              </dt>
              <dd class="mt-0.5 font-mono text-lg leading-6 font-semibold text-ink-900">
                {{ scoreLabel }}
              </dd>
            </div>
            <div>
              <dt class="text-[11px] text-ink-500">
                Passed
              </dt>
              <dd class="mt-0.5 font-mono text-sm leading-5 font-semibold text-emerald-700">
                {{ summary.passed }}
              </dd>
            </div>
            <div>
              <dt class="text-[11px] text-ink-500">
                Leaked
              </dt>
              <dd class="mt-0.5 font-mono text-sm leading-5 font-semibold text-rose-700">
                {{ summary.leaked }}
              </dd>
            </div>
            <div>
              <dt class="text-[11px] text-ink-500">
                Cases finished
              </dt>
              <dd class="mt-0.5 font-mono text-sm leading-5 font-semibold text-ink-900">
                {{ summary.resolved }} of {{ summary.total }}
              </dd>
            </div>
            <div>
              <dt class="text-[11px] text-ink-500">
                Categories reached
              </dt>
              <dd class="mt-0.5 font-mono text-sm leading-5 font-semibold text-ink-900">
                {{ categoriesReached }}
              </dd>
            </div>
            <div>
              <dt class="text-[11px] text-ink-500">
                Model
              </dt>
              <dd class="mt-0.5 truncate font-mono text-sm leading-5 font-semibold text-ink-900" :title="summary.model">
                {{ summary.model }}
              </dd>
            </div>
            <div>
              <dt class="text-[11px] text-ink-500">
                VerifyShield
              </dt>
              <dd class="mt-0.5 font-mono text-sm leading-5 font-semibold" :class="runShield === false ? 'text-rose-700' : 'text-ink-900'">
                {{ runShield === null ? '—' : runShield ? 'On' : 'Off' }}
              </dd>
            </div>
            <div>
              <dt class="text-[11px] text-ink-500">
                Started
              </dt>
              <dd class="mt-0.5 font-mono text-sm leading-5 font-semibold text-ink-900">
                {{ startedLabel }}
              </dd>
            </div>
            <div>
              <dt class="text-[11px] text-ink-500">
                Duration
              </dt>
              <dd class="mt-0.5 font-mono text-sm leading-5 font-semibold text-ink-900">
                {{ formatDuration(summary.durationMs) }}
              </dd>
            </div>
          </dl>
          <p
            v-else
            class="rounded-[6px] border border-dashed border-ink-300 px-3 py-4 text-sm leading-5 text-ink-500"
          >
            Run the suite to see the security score, pass and leak counts, the model and the shield state.
          </p>
          <p class="text-[11px] leading-5 text-ink-500">
            The score is the share of finished cases with no leak. Results live only on this page and are not kept, so a reload loses them.
          </p>
          <ol v-if="cases.length" class="flex flex-col gap-1.5">
            <li
              v-for="result in cases"
              :key="result.id"
              class="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-[6px] border bg-paper px-3 py-2"
              :class="verdictStyles[result.verdict].border"
            >
              <span class="min-w-0 flex-1 basis-full text-[13px] leading-5 text-ink-800 sm:basis-auto">{{ result.prompt }}</span>
              <span
                class="max-w-full shrink-0 rounded-[4px] bg-ink-100 px-1.5 py-0.5 text-left text-[10px] leading-[15px] font-medium text-ink-600"
              >{{ injectionCategoryLabels[result.category] }}</span>
              <span
                class="shrink-0 rounded-[4px] px-1.5 py-0.5 text-[10px] leading-[15px] font-medium"
                :class="agentClass(result.agent)"
              >{{ agentLabels[result.agent] }}</span>
              <span
                class="shrink-0 rounded-[4px] px-1.5 py-0.5 text-[10px] leading-[15px] font-medium"
                :class="verdictStyles[result.verdict].badge"
              >{{ verdictStyles[result.verdict].label }}</span>
              <span v-if="result.leakedFragment" class="basis-full font-mono text-[11px] leading-5 text-rose-700">
                leaked: {{ result.leakedFragment }}
              </span>
              <span v-if="result.replyExcerpt" class="basis-full text-[11px] leading-5 text-ink-500">
                {{ result.replyExcerpt }}
              </span>
            </li>
          </ol>
        </section>
      </section>
    </main>
  </div>
</template>
