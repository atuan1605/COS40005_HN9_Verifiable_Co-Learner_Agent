<script setup lang="ts">
import type { LecturerCourse, LecturerStudent } from '#shared/lecturer'
import PieChart from '~/components/lecturer/PieChart.vue'
import ProgressGroupsPie from '~/components/lecturer/ProgressGroupsPie.vue'
import { classSummary, moduleStateTotals } from '~/lecturer/course-overview'

// The top of a course's Overview: the totals and two pies of the students shown. The enrollment
// count is always of the whole class.
const props = defineProps<{ course: LecturerCourse, students: LecturerStudent[] }>()

const stateColours = {
  mastered: { label: 'Mastered', fill: 'fill-emerald-700', swatch: 'bg-emerald-700' },
  open: { label: 'Open', fill: 'fill-brand-500', swatch: 'bg-brand-500' },
  closed: { label: 'Closed', fill: 'fill-ink-300', swatch: 'bg-ink-300' },
}

const summary = computed(() => classSummary(props.students))
const stateSlices = computed(() => moduleStateTotals(props.course.modules, props.students)
  .map(({ state, count }) => ({ count, ...stateColours[state] })))
</script>

<template>
  <div class="grid gap-4 lg:grid-cols-[minmax(12rem,1fr)_2fr_2fr]">
    <section class="grid content-between gap-4 rounded-xl border border-default bg-default p-5 shadow-xs sm:grid-cols-3 lg:grid-cols-1" aria-label="Class totals">
      <p class="text-sm text-muted" data-testid="enrollment-count">
        <strong class="block text-3xl font-semibold text-highlighted">{{ course.enrolledCount }}</strong>
        {{ course.enrolledCount === 1 ? 'student enrolled' : 'students enrolled' }}
      </p>
      <p class="text-sm text-muted">
        <strong class="block text-3xl font-semibold text-highlighted">{{ summary.averagePercent }}%</strong>
        average Course progress
      </p>
      <p class="text-sm text-muted">
        <strong class="block text-3xl font-semibold text-highlighted">{{ summary.finished }}</strong>
        finished the course
      </p>
    </section>
    <section class="rounded-xl border border-default bg-default p-5 shadow-xs">
      <h3 class="mb-3 text-sm font-semibold text-highlighted">Where students are</h3>
      <ProgressGroupsPie :students="students" />
    </section>
    <section class="rounded-xl border border-default bg-default p-5 shadow-xs">
      <h3 class="mb-3 text-sm font-semibold text-highlighted">Modules across the class</h3>
      <PieChart :slices="stateSlices" label="Module states across all students" unit="student modules" />
    </section>
  </div>
</template>
