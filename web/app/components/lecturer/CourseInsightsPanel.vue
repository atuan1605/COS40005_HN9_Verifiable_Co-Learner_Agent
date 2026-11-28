<script setup lang="ts">
import type { LecturerCourse } from '#shared/lecturer'
import CoursePath from '~/components/lecturer/CoursePath.vue'
import ProgressGroupsPie from '~/components/lecturer/ProgressGroupsPie.vue'
import StudentFilters from '~/components/lecturer/StudentFilters.vue'
import StudentPortrait from '~/components/lecturer/StudentPortrait.vue'
import { furthestBehind, studentCountText } from '~/lecturer/course-insights'
import { classSummary } from '~/lecturer/course-overview'
import { filterStudents, isFiltering, noFilters } from '~/lecturer/student-filters'

// The Insights tab: Course insights for each owned course, worked out here from the lecturer
// response. One set of filters applies to the whole tab and sends no request.
const props = defineProps<{ courses: LecturerCourse[] }>()

const filters = ref({ ...noFilters })
const filtering = computed(() => isFiltering(filters.value))
const views = computed(() => props.courses.map((course) => {
  const students = filterStudents(course.modules, course.students, filters.value)
  return { course, students, average: classSummary(students).averagePercent, behind: furthestBehind(students, 5) }
}))
</script>

<template>
  <section class="flex flex-col gap-6" aria-label="Insights">
    <StudentFilters v-model="filters" :courses="courses" />

    <article
      v-for="{ course, students, average, behind } in views"
      :key="course.id"
      class="flex flex-col gap-4"
      :aria-label="`Course insights for ${course.title}`"
    >
      <div>
        <h2 class="text-lg font-semibold text-highlighted">{{ course.title }}</h2>
        <h3 class="text-sm text-muted">Course insights</h3>
      </div>
      <p v-if="!course.students.length" class="text-sm text-muted">No students enrolled yet.</p>
      <p v-else-if="!students.length" class="text-sm text-muted" role="status">No students match these filters.</p>
      <template v-else>
        <p class="text-sm text-muted" data-testid="insights-student-count">
          {{ filtering ? `${students.length} of ${studentCountText(course.students.length)} shown` : `${studentCountText(students.length)} shown` }}
        </p>
        <div class="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <CoursePath :modules="course.modules" :students="students" />
          <div class="flex flex-col gap-4">
            <section class="rounded-xl border border-default bg-default p-4 shadow-xs md:p-5" data-testid="progress-pie">
              <h4 class="text-sm font-semibold text-highlighted">Course progress</h4>
              <p class="mb-3 text-sm text-muted">Average {{ average }}%</p>
              <ProgressGroupsPie :students="students" />
            </section>
            <section class="rounded-xl border border-default bg-default p-4 shadow-xs md:p-5" data-testid="furthest-behind">
              <h4 class="mb-2 text-sm font-semibold text-highlighted">Furthest behind</h4>
              <p v-if="!behind.length" class="text-sm text-muted">Everyone has finished the course.</p>
              <ul v-else class="divide-y divide-default">
                <li v-for="student in behind" :key="student.studentNumber">
                  <NuxtLink
                    :to="`/review/${student.studentNumber}`"
                    class="flex min-h-11 items-center gap-3 py-2 hover:bg-ink-50 focus-visible:outline-2 focus-visible:outline-brand-600"
                    :aria-label="`Review ${student.displayName}'s work, Course progress ${student.progress.percent}%`"
                  >
                    <StudentPortrait class="size-9" />
                    <span class="min-w-0 flex-1 truncate text-sm text-highlighted">{{ student.displayName }}</span>
                    <span class="text-sm tabular-nums text-muted">{{ student.progress.percent }}%</span>
                  </NuxtLink>
                </li>
              </ul>
            </section>
          </div>
        </div>
      </template>
    </article>
  </section>
</template>
