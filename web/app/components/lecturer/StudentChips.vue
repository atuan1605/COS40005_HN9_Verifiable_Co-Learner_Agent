<script setup lang="ts">
import type { LecturerStudent } from '#shared/lecturer'
import StudentPortrait from '~/components/lecturer/StudentPortrait.vue'
import { studentPage } from '~/lecturer/course-insights'

// Students as chips with their portrait and name, each a link to the staff review, a page at a time.
const props = defineProps<{
  students: LecturerStudent[]
  // What the row is, to tell its pager from the other rows'.
  label: string
}>()

const page = ref(1)
const current = computed(() => studentPage(props.students, page.value))
// A change of filters gives a new list, which starts from its first page.
watch(() => props.students, () => {
  page.value = 1
})
</script>

<template>
  <div class="flex flex-col content-start gap-2">
    <ul class="flex flex-wrap content-start items-center gap-1.5">
      <li v-for="student in current.students" :key="student.studentNumber">
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
    </ul>
    <nav v-if="current.pageCount > 1" :aria-label="`Pages of ${label}`" class="flex items-center gap-3 text-xs">
      <button type="button" class="min-h-11 font-medium text-brand-700 underline-offset-4 hover:underline disabled:text-muted disabled:no-underline md:min-h-0" :disabled="page === 1" @click="page--">
        Previous
      </button>
      <span class="text-muted" aria-live="polite">Page {{ page }} of {{ current.pageCount }}</span>
      <button type="button" class="min-h-11 font-medium text-brand-700 underline-offset-4 hover:underline disabled:text-muted disabled:no-underline md:min-h-0" :disabled="page === current.pageCount" @click="page++">
        Next
      </button>
    </nav>
  </div>
</template>
