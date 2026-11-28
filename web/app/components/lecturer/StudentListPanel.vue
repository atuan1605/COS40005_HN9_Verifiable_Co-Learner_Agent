<script setup lang="ts">
import type { LecturerStudent } from '#shared/lecturer'

// The students behind one mark of an Insights chart, each linking to their staff review.
defineProps<{
  title: string
  students: LecturerStudent[]
}>()
defineEmits<{ close: [] }>()

const titleId = useId()
const list = useTemplateRef<HTMLUListElement>('list')

// For a chart that moves the keyboard into the list.
defineExpose({ focusFirst: () => list.value?.querySelector('a')?.focus() })
</script>

<template>
  <div class="rounded-sm border border-default bg-muted p-3">
    <div class="flex items-start justify-between gap-3">
      <p :id="titleId" class="text-sm font-medium text-highlighted" aria-live="polite">{{ title }}</p>
      <button type="button" class="min-h-11 text-sm text-muted underline underline-offset-4 md:min-h-0" @click="$emit('close')">
        Close
      </button>
    </div>
    <ul ref="list" class="flex max-h-72 flex-col overflow-y-auto md:gap-1" :aria-labelledby="titleId">
      <li v-for="student in students" :key="student.studentNumber">
        <NuxtLink
          :to="`/review/${student.studentNumber}`"
          class="inline-flex min-h-11 items-center gap-2 text-sm text-brand-700 underline underline-offset-4 [overflow-wrap:anywhere] md:min-h-0"
        >
          {{ student.displayName }} ({{ student.studentNumber }})
        </NuxtLink>
      </li>
    </ul>
  </div>
</template>
