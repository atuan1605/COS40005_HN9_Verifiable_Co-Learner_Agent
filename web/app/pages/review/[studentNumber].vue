<script setup lang="ts">
import type { StaffReview } from '#shared/staff-review'
import LearningPlanCard from '~/components/review/LearningPlanCard.vue'
import { isProductOwner } from '~/staff/landing'
import { timeText } from '~/staff/time-text'

definePageMeta({ middleware: 'signed-in' })

const route = useRoute()
const studentNumber = String(route.params.studentNumber)
useHead({ title: `Review ${studentNumber}` })

// Opening the page is what writes the staff access log, so it is read once on
// the server and not again from the browser.
const { data, error } = await useFetch<StaffReview>('/api/staff/review', {
  key: `staff-review-${studentNumber}`,
  query: { studentNumber },
  getCachedData: () => undefined,
})

const refused = computed(() => error.value?.statusCode === 403 || error.value?.statusCode === 401)
const missing = computed(() => error.value?.statusCode === 404)
const unavailable = computed(() => Boolean(error.value) && !refused.value && !missing.value)

const administrator = ref(false)
onMounted(async () => {
  const role = (url: string) => $fetch(url as '/api/staff-role')
  administrator.value = await isProductOwner(role)
})
const backTo = computed(() => administrator.value ? '/admin/students' : '/lecturer')

const eventLabels: Record<string, string> = {
  signed_in: 'Signed in',
  module_opened: 'Opened a module',
  mode_switched: 'Switched mode',
  layout_switched: 'Switched layout',
  code_run: 'Ran code',
  run_finished: 'A run finished',
  pasted: 'Pasted into the editor',
  went_idle: 'Went quiet',
  returned: 'Came back',
  submitted: 'Submitted',
  quiz_answered: 'Answered a quiz question',
  message_sent: 'Sent a message',
  note_created: 'Created a note',
  note_changed: 'Changed a note',
  note_linked: 'Linked a note',
  note_unlinked: 'Unlinked a note',
  note_deleted: 'Deleted a note',
  mindmap_moved: 'Moved on the progress map',
  profile_changed: 'Changed their profile',
  approach_written: 'Wrote their approach',
  plan_agreed: 'Agreed to a plan',
  idle_check_in: 'The Teacher checked in',
}
function eventText(type: string): string {
  return eventLabels[type] ?? type
}
function detail(payload: Record<string, unknown>): string {
  return Object.entries(payload).map(([key, value]) => `${key}: ${String(value)}`).join(', ')
}

function duration(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  return minutes === 0 ? `${seconds}s` : `${minutes}m ${seconds % 60}s`
}

const authors: Record<string, string> = { student: 'Student', teacher: 'Teacher', deskmate: 'Mai', event: 'System' }
const outcomes: Record<string, string> = { passed: 'Passed', failed: 'Failed', refused: 'Not checked' }
const signalTitles: Record<string, string> = {
  large_paste_then_pass: 'A large paste came before a pass',
  pass_without_run: 'A pass with no run before it',
}

// The prompts table shows a page at a time, so a long history stays short.
const signalsPerPage = 5
const signalPage = ref(1)
const signalPageCount = computed(() => Math.max(1, Math.ceil((data.value?.signals.length ?? 0) / signalsPerPage)))
const pagedSignals = computed(() => (data.value?.signals ?? []).slice((signalPage.value - 1) * signalsPerPage, signalPage.value * signalsPerPage))
</script>

<template>
  <div class="flex min-h-dvh flex-col bg-muted">
    <header class="phone-safe-top shrink-0 border-b border-default/80 bg-default px-4 py-3 md:px-8">
      <div class="mx-auto flex w-full max-w-[90rem] items-center justify-between gap-4">
        <NuxtLink :to="backTo" class="inline-flex min-h-11 items-center text-sm font-medium text-brand-700 underline underline-offset-4 md:min-h-0">
          Back to students
        </NuxtLink>
      </div>
    </header>
    <main class="phone-safe-bottom mx-auto flex w-full max-w-[90rem] flex-1 flex-col gap-6 p-4 md:p-8">
      <p v-if="refused" role="alert" class="max-w-sm text-sm text-default">
        You can only review students enrolled in a course you own.
      </p>
      <p v-else-if="missing" role="alert" class="max-w-sm text-sm text-default">
        There is no student with that number.
      </p>
      <p v-else-if="unavailable" role="alert" class="max-w-sm text-sm text-default">
        This page is unavailable right now.
      </p>
      <template v-else-if="data">
        <section class="page-enter flex flex-col gap-1">
          <h1 class="text-xl font-semibold tracking-tight text-highlighted [overflow-wrap:anywhere]">
            {{ data.student.displayName }}
          </h1>
          <p class="text-sm text-muted [overflow-wrap:anywhere]">
            <span class="font-mono">{{ data.student.studentNumber }}</span>
            · {{ data.student.campus ?? 'No campus yet' }}
            · {{ data.student.email }}
          </p>
        </section>

        <section aria-labelledby="signals-heading" class="flex flex-col gap-3" data-testid="review-signals">
          <h2 id="signals-heading" class="text-base font-semibold text-highlighted">
            Worth a look
          </h2>
          <p class="max-w-prose text-sm text-muted">
            These are prompts for a person to look at the work, not a finding about the student. They are worked out when this page opens and never change mastery.
          </p>
          <p v-if="!data.signals.length" class="text-sm text-muted">
            Nothing stands out.
          </p>
          <template v-else>
            <div class="overflow-x-auto rounded-lg border border-default bg-default shadow-xs">
              <table class="w-full text-left text-sm">
                <thead class="border-b border-default bg-muted text-xs font-semibold tracking-wide text-muted uppercase">
                  <tr>
                    <th scope="col" class="px-3 py-2">Prompt</th>
                    <th scope="col" class="px-3 py-2">Exercise</th>
                    <th scope="col" class="px-3 py-2">Details</th>
                    <th scope="col" class="px-3 py-2">Events</th>
                  </tr>
                </thead>
                <tbody>
                  <tr
                    v-for="(signal, index) in pagedSignals"
                    :key="index"
                    class="border-b border-default align-top last:border-b-0"
                  >
                    <td class="px-3 py-2 font-medium whitespace-nowrap text-highlighted">{{ signalTitles[signal.kind] }}</td>
                    <td class="px-3 py-2 font-mono text-xs text-muted">{{ signal.exerciseId }}</td>
                    <td class="px-3 py-2 text-default">{{ signal.summary }}</td>
                    <td class="px-3 py-2">
                      <span class="flex flex-wrap gap-x-2 text-xs">
                        <a
                          v-for="id in signal.eventIds"
                          :key="id"
                          :href="`#event-${id}`"
                          class="font-medium text-brand-700 underline underline-offset-4"
                        >#{{ id }}</a>
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <nav v-if="signalPageCount > 1" aria-label="Prompts pages" class="flex items-center justify-end gap-3 text-sm">
              <button type="button" class="min-h-11 font-medium text-brand-700 underline-offset-4 hover:underline disabled:text-muted disabled:no-underline md:min-h-0" :disabled="signalPage === 1" @click="signalPage--">
                Previous
              </button>
              <span class="text-muted">Page {{ signalPage }} of {{ signalPageCount }}</span>
              <button type="button" class="min-h-11 font-medium text-brand-700 underline-offset-4 hover:underline disabled:text-muted disabled:no-underline md:min-h-0" :disabled="signalPage === signalPageCount" @click="signalPage++">
                Next
              </button>
            </nav>
          </template>
        </section>

        <section v-if="data.mastery" aria-labelledby="mastery-heading" class="flex flex-col gap-3" data-testid="review-mastery">
          <h2 id="mastery-heading" class="text-base font-semibold text-highlighted">
            Mastery
          </h2>
          <ul class="flex flex-col divide-y divide-default rounded-lg border border-default bg-default text-sm shadow-xs">
            <li v-for="module in data.mastery" :key="module.moduleId" class="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
              <span class="min-w-0 flex-1 text-default">{{ module.name }}</span>
              <div
                class="h-1.5 w-24 overflow-hidden rounded-full bg-ink-100"
                role="progressbar"
                :aria-label="`${module.name} mastery`"
                :aria-valuenow="Math.round(module.mastery * 100)"
                aria-valuemin="0"
                aria-valuemax="100"
              >
                <div class="h-full rounded-full" :class="module.state === 'mastered' ? 'bg-emerald-500' : 'bg-brand-500'" :style="{ width: `${Math.round(module.mastery * 100)}%` }" />
              </div>
              <span class="w-10 text-right font-mono text-xs text-ink-700">{{ Math.round(module.mastery * 100) }}%</span>
              <span
                class="w-16 text-xs font-medium"
                :class="module.state === 'mastered' ? 'text-emerald-700' : module.state === 'open' ? 'text-brand-700' : 'text-muted'"
              >{{ module.state }}</span>
            </li>
          </ul>
        </section>

        <section aria-labelledby="plan-heading" class="flex flex-col gap-3" data-testid="review-plans">
          <h2 id="plan-heading" class="text-base font-semibold text-highlighted">
            Learning plan
          </h2>
          <p v-if="!data.plans.length" class="text-sm text-muted">
            No plan yet.
          </p>
          <LearningPlanCard v-for="plan in data.plans" :key="plan.moduleId" :plan="plan" />
        </section>

        <section aria-labelledby="pattern-heading" class="flex flex-col gap-3" data-testid="review-pattern">
          <h2 id="pattern-heading" class="text-base font-semibold text-highlighted">
            Learning pattern
          </h2>
          <div class="grid gap-3 md:grid-cols-2">
            <div class="rounded-lg border border-default bg-default p-3 text-sm shadow-xs">
              <h3 class="mb-2 border-b border-default pb-1.5 text-xs font-semibold tracking-wide text-highlighted uppercase">Weak spots</h3>
              <p v-if="!data.learningPattern.weakSpots.length" class="text-muted">None seen.</p>
              <ul v-else class="mt-1">
                <li v-for="spot in data.learningPattern.weakSpots" :key="spot.misconceptionId">
                  {{ spot.misconceptionId }} · {{ spot.count }}× · last {{ timeText(spot.lastSeen) }}
                </li>
              </ul>
            </div>
            <div class="rounded-lg border border-default bg-default p-3 text-sm shadow-xs">
              <h3 class="mb-2 border-b border-default pb-1.5 text-xs font-semibold tracking-wide text-highlighted uppercase">Recurring errors</h3>
              <p v-if="!data.learningPattern.recurringErrors.length" class="text-muted">None seen.</p>
              <ul v-else class="mt-1">
                <li v-for="error in data.learningPattern.recurringErrors" :key="error.kind">
                  {{ error.kind }} · {{ error.count }}×
                </li>
              </ul>
            </div>
            <div class="rounded-lg border border-default bg-default p-3 text-sm shadow-xs">
              <h3 class="mb-2 border-b border-default pb-1.5 text-xs font-semibold tracking-wide text-highlighted uppercase">Attempts to pass</h3>
              <p v-if="!data.learningPattern.exerciseAttempts.length" class="text-muted">No attempts yet.</p>
              <ul v-else class="mt-1">
                <li v-for="item in data.learningPattern.exerciseAttempts" :key="item.exerciseId">
                  {{ item.exerciseId }} · {{ item.attempts }} {{ item.attempts === 1 ? 'attempt' : 'attempts' }} · {{ item.passed ? 'passed' : 'not passed yet' }}
                </li>
              </ul>
            </div>
            <div class="rounded-lg border border-default bg-default p-3 text-sm shadow-xs">
              <h3 class="mb-2 border-b border-default pb-1.5 text-xs font-semibold tracking-wide text-highlighted uppercase">Hints and materials</h3>
              <p v-if="!data.learningPattern.hintRungs.length && !data.learningPattern.materialsSeconds.length" class="text-muted">Nothing yet.</p>
              <ul class="mt-1">
                <li v-for="item in data.learningPattern.hintRungs" :key="`hint-${item.moduleId}`">
                  {{ item.moduleId }} · hint rungs {{ item.rungs.join(', ') }}
                </li>
                <li v-for="item in data.learningPattern.materialsSeconds" :key="`time-${item.moduleId}`">
                  {{ item.moduleId }} · {{ duration(item.seconds) }} on materials
                </li>
              </ul>
            </div>
          </div>
        </section>

        <section aria-labelledby="submissions-heading" class="flex flex-col gap-3">
          <h2 id="submissions-heading" class="text-base font-semibold text-highlighted">
            Submissions
          </h2>
          <p v-if="!data.submissions.length" class="text-sm text-muted">
            No submissions yet.
          </p>
          <article
            v-for="submission in data.submissions"
            :key="submission.id"
            class="rounded-lg border border-default bg-default p-3 shadow-xs"
          >
            <p class="flex flex-wrap items-baseline gap-x-3 text-sm">
              <strong class="text-highlighted">{{ outcomes[submission.outcome] }}</strong>
              <span class="text-muted">{{ submission.moduleId }} · {{ submission.exerciseId }}</span>
              <time :datetime="submission.time" class="text-xs text-muted">{{ timeText(submission.time) }}</time>
            </p>
            <p v-if="submission.message" class="mt-1 text-sm text-default">
              {{ submission.message }}
            </p>
            <pre class="mt-2 overflow-x-auto rounded-sm bg-muted p-3 font-mono text-xs/5 text-default">{{ submission.code }}</pre>
            <ul v-if="submission.results.length" class="mt-2 flex flex-col gap-1 text-xs">
              <li v-for="(result, index) in submission.results" :key="index" class="[overflow-wrap:anywhere]">
                <span :class="result.passed ? 'text-emerald-700' : 'text-rose-700'">{{ result.passed ? 'Passed' : 'Failed' }}</span>
                · {{ result.name }}
                <span v-if="!result.passed" class="text-muted">(expected {{ result.expected }}, got {{ result.actual }})</span>
              </li>
            </ul>
          </article>
        </section>

        <section aria-labelledby="conversation-heading" class="flex flex-col gap-3">
          <h2 id="conversation-heading" class="text-base font-semibold text-highlighted">
            Conversation
          </h2>
          <p v-if="!data.conversations.length" class="text-sm text-muted">
            No conversation yet.
          </p>
          <div v-for="conversation in data.conversations" :key="conversation.moduleId" class="rounded-lg border border-default bg-default p-3 shadow-xs">
            <h3 class="text-sm font-medium text-highlighted">
              {{ conversation.moduleId }}
            </h3>
            <ol class="mt-2 flex flex-col gap-2">
              <li v-for="message in conversation.messages" :key="message.id" class="text-sm">
                <p class="text-xs text-muted">
                  {{ authors[message.author] }} · <time v-if="message.time" :datetime="message.time">{{ timeText(message.time) }}</time>
                </p>
                <p class="whitespace-pre-wrap text-default [overflow-wrap:anywhere]">
                  {{ message.text }}
                </p>
              </li>
            </ol>
          </div>
        </section>

        <section aria-labelledby="activity-heading" class="flex flex-col gap-3">
          <h2 id="activity-heading" class="text-base font-semibold text-highlighted">
            Latest activity
          </h2>
          <p v-if="!data.activity.length" class="text-sm text-muted">
            No activity yet.
          </p>
          <ol v-else class="flex flex-col divide-y divide-default rounded-lg border border-default bg-default text-sm shadow-xs">
            <li v-for="item in data.activity" :id="`event-${item.id}`" :key="item.id" class="flex flex-wrap gap-x-3 px-3 py-2 target:bg-brand-50">
              <span class="w-12 font-mono text-xs text-muted">#{{ item.id }}</span>
              <span class="font-medium text-highlighted">{{ eventText(item.type) }}</span>
              <span class="text-xs text-muted [overflow-wrap:anywhere]">{{ detail(item.payload) }}</span>
              <time :datetime="item.time" class="ml-auto text-xs text-muted">{{ timeText(item.time) }}</time>
            </li>
          </ol>
        </section>
      </template>
    </main>
  </div>
</template>
