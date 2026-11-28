<script setup lang="ts">
import type { LecturerStudent } from '#shared/lecturer'
import { progressBands, type ProgressBand } from '~/lecturer/course-insights'

// A histogram of the students shown by Course progress, one column per percentage band.
const props = defineProps<{
  // The enrolled students the tab's campus filter leaves.
  students: LecturerStudent[]
}>()

// Pixels; the columns are placed across the width in percentages.
const baseline = 140
const tallest = 120

const bands = computed(() => progressBands(props.students))
const slot = computed(() => 100 / bands.value.length)

const columns = computed(() => {
  const most = Math.max(...bands.value.map(band => band.students.length), 1)
  return bands.value.map((band, index) => {
    const count = band.students.length
    // An occupied band never gets too short to see.
    const height = count ? Math.max(4, (count * tallest) / most) : 0
    return { ...band, start: index * slot.value, middle: (index + 0.5) * slot.value, height }
  })
})

// The band whose students are listed. It stays after the pointer or focus leaves, so that its
// links can be reached.
const shown = ref<string | null>(null)
const listed = computed(() => bands.value.find(band => band.label === shown.value && band.students.length > 0))
const list = useTemplateRef<HTMLUListElement>('list')
const id = useId()

async function enter(label: string) {
  shown.value = label
  await nextTick()
  list.value?.querySelector('a')?.focus()
}

function countText(count: number) {
  return `${count} ${count === 1 ? 'student' : 'students'}`
}

function bandLabel(band: ProgressBand) {
  return `Course progress ${band.label}: ${countText(band.students.length)}`
}
</script>

<template>
  <section class="flex flex-col gap-3" data-testid="progress-distribution" @keydown.esc="shown = null">
    <div>
      <h4 class="text-sm font-semibold text-highlighted">Course progress distribution</h4>
      <p class="text-xs text-muted">Students by the share of the course's modules they have mastered.</p>
    </div>

    <svg width="100%" height="160" class="block max-w-2xl overflow-visible" role="group" aria-label="Students per Course progress band">
      <line x1="0" :y1="baseline + 0.5" x2="100%" :y2="baseline + 0.5" class="stroke-ink-300" />
      <template v-for="column in columns" :key="column.label">
        <text :x="`${column.middle}%`" y="156" text-anchor="middle" class="fill-ink-500 text-xs tabular-nums" aria-hidden="true">
          {{ column.label }}
        </text>
        <g
          v-if="column.students.length"
          role="button"
          tabindex="0"
          class="group cursor-pointer outline-none"
          :aria-label="bandLabel(column)"
          :aria-expanded="shown === column.label"
          @pointerenter="shown = column.label"
          @focus="shown = column.label"
          @click="shown = column.label"
          @keydown.enter.prevent="enter(column.label)"
          @keydown.space.prevent="enter(column.label)"
        >
          <!-- The whole slot is the target, not only the column. -->
          <rect :x="`${column.start}%`" y="0" :width="`${slot}%`" :height="baseline" fill="transparent" />
          <!-- Rounded at the top, square on the baseline: the second rect fills the lower corners. -->
          <g class="fill-brand-500 group-hover:opacity-80">
            <rect :x="`${column.middle}%`" :y="baseline - column.height" width="24" :height="column.height" rx="4" transform="translate(-12 0)" />
            <rect :x="`${column.middle}%`" :y="baseline - Math.min(4, column.height / 2)" width="24" :height="Math.min(4, column.height / 2)" transform="translate(-12 0)" />
          </g>
          <rect
            :x="`${column.middle}%`"
            :y="baseline - column.height"
            width="24"
            :height="column.height"
            rx="4"
            transform="translate(-12 0)"
            fill="none"
            stroke-width="2"
            class="group-focus-visible:stroke-ink-900"
          />
          <text :x="`${column.middle}%`" :y="baseline - column.height - 6" text-anchor="middle" class="fill-ink-900 text-xs font-semibold" aria-hidden="true">
            {{ column.students.length }}
          </text>
        </g>
      </template>
    </svg>

    <div v-if="listed" class="rounded-sm border border-default bg-muted p-3" data-testid="progress-distribution-students">
      <div class="flex items-start justify-between gap-3">
        <p :id="`${id}-students`" class="text-sm font-medium text-highlighted" aria-live="polite">{{ bandLabel(listed) }}</p>
        <button type="button" class="min-h-11 text-sm text-muted underline underline-offset-4 md:min-h-0" @click="shown = null">
          Close
        </button>
      </div>
      <ul ref="list" class="flex max-h-72 flex-col overflow-y-auto md:gap-1" :aria-labelledby="`${id}-students`">
        <li v-for="student in listed.students" :key="student.studentNumber">
          <NuxtLink
            :to="`/review/${student.studentNumber}`"
            class="inline-flex min-h-11 items-center gap-2 text-sm text-brand-700 underline underline-offset-4 [overflow-wrap:anywhere] md:min-h-0"
          >
            {{ student.displayName }} ({{ student.studentNumber }})
          </NuxtLink>
        </li>
      </ul>
    </div>

    <details class="text-sm text-default">
      <summary class="min-h-11 cursor-pointer content-center text-brand-700 md:min-h-0">Course progress counts as a table</summary>
      <table class="mt-2 border-collapse text-left">
        <caption class="sr-only">Course progress distribution: students per band</caption>
        <thead class="border-b border-default text-xs text-muted">
          <tr>
            <th scope="col" class="py-2 pr-3 font-medium">Course progress</th>
            <th scope="col" class="px-2 py-2 text-right font-medium">Students</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="band in bands" :key="band.label" class="border-t border-default">
            <th scope="row" class="py-1.5 pr-3 font-normal">{{ band.label }}</th>
            <td class="px-2 py-1.5 text-right tabular-nums">{{ band.students.length }}</td>
          </tr>
        </tbody>
      </table>
    </details>
  </section>
</template>
