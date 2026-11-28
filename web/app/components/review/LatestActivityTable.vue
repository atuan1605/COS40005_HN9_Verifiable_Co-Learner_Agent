<script setup lang="ts">
import type { ReviewEvent } from '#shared/staff-review'
import { activityPage, pageOfEvent } from '~/review/activity-pages'
import { timeText } from '~/staff/time-text'

// The staff review's Latest activity, newest first, a page at a time. The page
// calls show() when a review signal's event link is followed.
const props = defineProps<{ activity: readonly ReviewEvent[] }>()

const page = ref(1)
const current = computed(() => activityPage(props.activity, page.value))
const highlighted = ref<number | null>(null)
const body = useTemplateRef<HTMLElement>('body')

async function show(id: number) {
  const holding = pageOfEvent(props.activity, id)
  if (holding === null) return
  page.value = holding
  highlighted.value = id
  await nextTick()
  const row = body.value?.querySelector<HTMLElement>(`#event-${id}`)
  row?.focus({ preventScroll: true })
  row?.scrollIntoView({ block: 'center' })
}
defineExpose({ show })

// An event link opened in a new tab arrives with the event in the address.
onMounted(() => {
  const linked = /^#event-(\d+)$/.exec(window.location.hash)
  if (linked) show(Number(linked[1]))
})

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
</script>

<template>
  <section aria-labelledby="activity-heading" class="flex flex-col gap-3" data-testid="review-activity">
    <h2 id="activity-heading" class="text-base font-semibold text-highlighted">
      Latest activity
    </h2>
    <p v-if="!activity.length" class="text-sm text-muted">
      No activity yet.
    </p>
    <template v-else>
      <div class="overflow-x-auto rounded-lg border border-default bg-default shadow-xs">
        <table class="w-full text-left text-sm" aria-labelledby="activity-heading">
          <thead class="border-b border-default bg-muted text-xs font-semibold tracking-wide text-muted uppercase">
            <tr>
              <th scope="col" class="px-3 py-2">#</th>
              <th scope="col" class="px-3 py-2">Event</th>
              <th scope="col" class="px-3 py-2">Details</th>
              <th scope="col" class="px-3 py-2">Time</th>
            </tr>
          </thead>
          <tbody ref="body">
            <tr
              v-for="item in current.rows"
              :id="`event-${item.id}`"
              :key="item.id"
              tabindex="-1"
              class="border-b border-default align-top last:border-b-0"
              :class="{ 'bg-brand-50': item.id === highlighted }"
              :aria-current="item.id === highlighted ? 'true' : undefined"
            >
              <td class="px-3 py-2 font-mono text-xs text-muted">{{ item.id }}</td>
              <td class="px-3 py-2 font-medium whitespace-nowrap text-highlighted">{{ eventText(item.type) }}</td>
              <td class="min-w-48 px-3 py-2 text-xs text-muted [overflow-wrap:anywhere]">{{ detail(item.payload) }}</td>
              <td class="px-3 py-2 text-xs whitespace-nowrap text-muted">
                <time :datetime="item.time">{{ timeText(item.time) }}</time>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <nav aria-label="Activity pages" class="flex items-center justify-end gap-3 text-sm">
        <button type="button" class="min-h-11 font-medium text-brand-700 underline-offset-4 hover:underline disabled:text-muted disabled:no-underline md:min-h-0" :disabled="page === 1" @click="page--">
          Previous
        </button>
        <span class="text-muted">Page {{ page }} of {{ current.pageCount }}</span>
        <button type="button" class="min-h-11 font-medium text-brand-700 underline-offset-4 hover:underline disabled:text-muted disabled:no-underline md:min-h-0" :disabled="page === current.pageCount" @click="page++">
          Next
        </button>
      </nav>
    </template>
  </section>
</template>
