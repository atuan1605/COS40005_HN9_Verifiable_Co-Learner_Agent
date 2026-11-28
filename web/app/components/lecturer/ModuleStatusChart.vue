<script setup lang="ts">
import type { LecturerCourse, LecturerStudent } from '#shared/lecturer'
import type { ModuleState } from '#shared/turn'
import { moduleStatus, moduleStatusOrder, type ModuleStatusRow, type ModuleStatusSegment } from '~/lecturer/course-insights'

// A stacked bar per module of how many of the students shown have it mastered, open or closed.
const props = defineProps<{
  modules: LecturerCourse['modules']
  // The enrolled students the tab's campus filter leaves.
  students: LecturerStudent[]
}>()

const rows = computed(() => moduleStatus(props.modules, props.students))

// Fixed colour per state: the validated emerald and blue pair, and a neutral for not yet reachable.
const states: Record<ModuleState, { label: string, fill: string, swatch: string }> = {
  mastered: { label: 'Mastered', fill: 'fill-emerald-700', swatch: 'bg-emerald-700' },
  open: { label: 'Open', fill: 'fill-brand-500', swatch: 'bg-brand-500' },
  closed: { label: 'Closed', fill: 'fill-ink-300', swatch: 'bg-ink-300' },
}

interface Mark { moduleId: string, state: ModuleState }
const pointed = ref<Mark | null>(null)
const selected = ref<Mark | null>(null)
const id = useId()

function is(mark: Mark | null, moduleId: string, state: ModuleState) {
  return mark?.moduleId === moduleId && mark.state === state
}

function toggle(moduleId: string, state: ModuleState) {
  selected.value = is(selected.value, moduleId, state) ? null : { moduleId, state }
}

// The segment under the pointer or focus, or the one whose students are listed, if the module
// has it and the filter leaves anyone in it.
function segmentOf(row: ModuleStatusRow, mark: Mark | null): ModuleStatusSegment | undefined {
  if (mark?.moduleId !== row.moduleId) return
  return row.segments.find(segment => segment.state === mark.state && segment.students.length > 0)
}

function middle(segment: ModuleStatusSegment) {
  return segment.start + segment.width / 2
}

function countText(count: number) {
  return `${count} ${count === 1 ? 'student' : 'students'}`
}

function markLabel(row: ModuleStatusRow, segment: ModuleStatusSegment) {
  return `${row.name}, ${states[segment.state].label}: ${countText(segment.students.length)}`
}
</script>

<template>
  <section class="flex flex-col gap-3" data-testid="module-status">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <h4 class="text-sm font-semibold text-highlighted">Module status</h4>
      <ul class="flex flex-wrap gap-4 text-xs text-default" aria-label="Legend">
        <li v-for="state in moduleStatusOrder" :key="state" class="flex items-center gap-1.5">
          <span class="size-3 rounded-sm" :class="states[state].swatch" aria-hidden="true" />
          {{ states[state].label }}
        </li>
      </ul>
    </div>

    <ul class="flex flex-col gap-3">
      <li v-for="row in rows" :key="row.moduleId" class="flex flex-col gap-1 md:grid md:grid-cols-[16rem_1fr] md:items-center md:gap-x-4">
        <p class="text-sm text-default [overflow-wrap:anywhere]">{{ row.name }}</p>
        <div class="relative" @keydown.esc="pointed = null">
          <svg width="100%" height="24" class="block overflow-visible" role="group" :aria-label="`${row.name} module status`">
            <template v-for="segment in row.segments" :key="segment.state">
              <g
                v-if="segment.students.length"
                role="button"
                tabindex="0"
                class="group cursor-pointer outline-none"
                :aria-label="markLabel(row, segment)"
                :aria-expanded="is(selected, row.moduleId, segment.state)"
                @pointerenter="pointed = { moduleId: row.moduleId, state: segment.state }"
                @pointerleave="pointed = null"
                @focus="pointed = { moduleId: row.moduleId, state: segment.state }"
                @blur="pointed = null"
                @click="toggle(row.moduleId, segment.state)"
                @keydown.enter.prevent="toggle(row.moduleId, segment.state)"
                @keydown.space.prevent="toggle(row.moduleId, segment.state)"
              >
                <!-- The whole 24px band is the target; the paper stroke is the gap between parts. -->
                <rect :x="`${segment.start}%`" y="0" :width="`${segment.width}%`" height="24" fill="transparent" />
                <rect
                  :x="`${segment.start}%`"
                  y="2"
                  :width="`${segment.width}%`"
                  height="20"
                  rx="4"
                  stroke-width="2"
                  class="stroke-paper group-hover:opacity-80 group-focus-visible:stroke-ink-900"
                  :class="states[segment.state].fill"
                />
              </g>
            </template>
          </svg>
          <!-- Shifted by its own width in step with its position, so it never leaves the bar's row. -->
          <div
            v-if="segmentOf(row, pointed)"
            role="tooltip"
            class="pointer-events-none absolute bottom-full z-10 mb-1 w-max max-w-full rounded-sm border border-default bg-default px-3 py-2 text-xs shadow-md"
            :style="{ left: `${middle(segmentOf(row, pointed)!)}%`, transform: `translateX(-${middle(segmentOf(row, pointed)!)}%)` }"
          >
            <p class="font-medium text-highlighted">{{ row.name }}</p>
            <p v-for="segment in row.segments" :key="segment.state" class="flex items-center gap-1.5" :class="segment.state === pointed?.state ? 'text-highlighted' : 'text-muted'">
              <span class="h-0.5 w-3" :class="states[segment.state].swatch" aria-hidden="true" />
              <strong class="font-semibold">{{ segment.students.length }}</strong>
              {{ states[segment.state].label }}
            </p>
          </div>
        </div>

        <div
          v-if="segmentOf(row, selected)"
          class="rounded-sm border border-default bg-muted p-3 md:col-start-2"
          data-testid="module-status-students"
        >
          <div class="flex items-start justify-between gap-3">
            <p :id="`${id}-${row.moduleId}`" class="text-sm font-medium text-highlighted">
              {{ markLabel(row, segmentOf(row, selected)!) }}
            </p>
            <button type="button" class="min-h-11 text-sm text-muted underline underline-offset-4 md:min-h-0" @click="selected = null">
              Close
            </button>
          </div>
          <ul class="flex max-h-72 flex-col overflow-y-auto md:gap-1" :aria-labelledby="`${id}-${row.moduleId}`">
            <li v-for="student in segmentOf(row, selected)!.students" :key="student.studentNumber">
              <NuxtLink
                :to="`/review/${student.studentNumber}`"
                class="inline-flex min-h-11 items-center gap-2 text-sm text-brand-700 underline underline-offset-4 [overflow-wrap:anywhere] md:min-h-0"
              >
                {{ student.displayName }} ({{ student.studentNumber }})
              </NuxtLink>
            </li>
          </ul>
        </div>
      </li>
    </ul>

    <details class="text-sm text-default">
      <summary class="min-h-11 cursor-pointer content-center text-brand-700 md:min-h-0">Module status counts as a table</summary>
      <table class="mt-2 w-full border-collapse text-left">
        <caption class="sr-only">Module status: students per module and state</caption>
        <thead class="border-b border-default text-xs text-muted">
          <tr>
            <th scope="col" class="py-2 pr-3 font-medium">Module</th>
            <th v-for="state in moduleStatusOrder" :key="state" scope="col" class="px-2 py-2 text-right font-medium">{{ states[state].label }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.moduleId" class="border-t border-default">
            <th scope="row" class="py-1.5 pr-3 font-normal [overflow-wrap:anywhere]">{{ row.name }}</th>
            <td v-for="segment in row.segments" :key="segment.state" class="px-2 py-1.5 text-right tabular-nums">{{ segment.students.length }}</td>
          </tr>
        </tbody>
      </table>
    </details>
  </section>
</template>
