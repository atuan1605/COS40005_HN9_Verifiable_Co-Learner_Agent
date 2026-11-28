<script setup lang="ts">
import type { LecturerStudent } from '#shared/lecturer'
import StudentPortrait from '~/components/lecturer/StudentPortrait.vue'

// Students as chips with their portrait and name, each a link to the staff review.
const props = defineProps<{ students: LecturerStudent[] }>()

// How many show before the rest are behind a button.
const most = 10
const all = ref(false)
const shown = computed(() => all.value ? props.students : props.students.slice(0, most))
</script>

<template>
  <ul class="flex flex-wrap content-start items-center gap-1.5">
    <li v-for="student in shown" :key="student.studentNumber">
      <NuxtLink
        :to="`/review/${student.studentNumber}`"
        class="flex min-h-11 items-center gap-1.5 rounded-full border border-default bg-default py-0.5 pr-3 pl-1 text-xs text-default hover:border-brand-500 focus-visible:outline-2 focus-visible:outline-brand-600 md:min-h-9"
        :aria-label="`Review ${student.displayName}'s work`"
        :title="`Course progress ${student.progress.percent}%`"
      >
        <StudentPortrait class="size-7" />
        {{ student.displayName }}
      </NuxtLink>
    </li>
    <li v-if="students.length > most">
      <button type="button" class="min-h-11 rounded-full bg-ink-100 px-3 text-xs font-semibold text-default md:min-h-9" :aria-expanded="all" @click="all = !all">
        {{ all ? 'Show fewer' : `${students.length - most} more` }}
      </button>
    </li>
  </ul>
</template>
