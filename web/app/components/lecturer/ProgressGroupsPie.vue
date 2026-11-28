<script setup lang="ts">
import type { LecturerStudent } from '#shared/lecturer'
import PieChart from '~/components/lecturer/PieChart.vue'
import { progressGroups, type ProgressGroupKey } from '~/lecturer/course-overview'

// The students given, as a pie of how far through the course they are.
const props = defineProps<{
  students: LecturerStudent[]
  // The Course progress group the tab is filtered to, or empty.
  highlight?: ProgressGroupKey | ''
}>()

const colours: Record<ProgressGroupKey, { fill: string, swatch: string }> = {
  'not-started': { fill: 'fill-ink-300', swatch: 'bg-ink-300' },
  'starting': { fill: 'fill-brand-300', swatch: 'bg-brand-300' },
  'part-way': { fill: 'fill-brand-500', swatch: 'bg-brand-500' },
  'nearly-there': { fill: 'fill-brand-800', swatch: 'bg-brand-800' },
}
const highlighted = computed(() => progressGroups(props.students).find(group => group.key === props.highlight)?.label)
const slices = computed(() => progressGroups(props.students).map(({ key, label, count }) => ({ label, count, ...colours[key] })))
</script>

<template>
  <PieChart :slices="slices" :highlight="highlighted" label="Students by Course progress" unit="students" />
</template>
