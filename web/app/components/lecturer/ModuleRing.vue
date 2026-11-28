<script setup lang="ts">
import type { LecturerCourse, LecturerStudent } from '#shared/lecturer'
import { moduleStateOf, ringSegment } from '~/lecturer/course-overview'

// One student's modules as a ring with an equal segment each, in course order. It sits beside the
// Course progress figure, which says the same in text.
const props = defineProps<{ student: LecturerStudent, modules: LecturerCourse['modules'] }>()

const fills = { mastered: 'fill-emerald-700', open: 'fill-brand-500', closed: 'fill-ink-300' }
const labels = { mastered: 'Mastered', open: 'Open', closed: 'Closed' }
// A turn's worth of space left between neighbouring segments.
const gap = 0.012

const segments = computed(() => props.modules.map((module, index) => {
  const state = moduleStateOf(props.student, module.id)
  return {
    id: module.id,
    title: `${module.name}: ${labels[state]}`,
    fill: fills[state],
    path: ringSegment((index + gap / 2) / props.modules.length, (index + 1 - gap / 2) / props.modules.length, 50, 34),
  }
}))
</script>

<template>
  <svg viewBox="0 0 100 100" class="size-11 shrink-0 stroke-paper" stroke-width="3" aria-hidden="true">
    <path v-for="segment in segments" :key="segment.id" :d="segment.path" :class="segment.fill">
      <title>{{ segment.title }}</title>
    </path>
  </svg>
</template>
