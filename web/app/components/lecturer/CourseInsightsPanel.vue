<script setup lang="ts">
import { campuses } from '#shared/campus'
import type { LecturerCourse } from '#shared/lecturer'
import CoursePath from '~/components/lecturer/CoursePath.vue'
import ProgressGroupsPie from '~/components/lecturer/ProgressGroupsPie.vue'
import StudentPortrait from '~/components/lecturer/StudentPortrait.vue'
import { filterStudents, furthestBehind, noFilters, noModuleOpen, studentCountText } from '~/lecturer/course-insights'
import { classSummary, progressGroupRanges } from '~/lecturer/course-overview'

// The Insights tab: Course insights for each owned course, worked out here from the lecturer
// response. One set of filters applies to the whole tab and sends no request.
const props = defineProps<{ courses: LecturerCourse[] }>()

const filters = reactive({ ...noFilters })
const filtering = computed(() => Object.values(filters).some(value => value !== ''))
// Every module any owned course lists, once each.
const modules = computed(() => [...new Map(props.courses.flatMap(course => course.modules).map(module => [module.id, module])).values()])
function clear() {
  Object.assign(filters, noFilters)
}
const views = computed(() => props.courses.map((course) => {
  const students = filterStudents(course.modules, course.students, filters)
  return { course, students, average: classSummary(students).averagePercent, behind: furthestBehind(students, 5) }
}))
</script>

<template>
  <section class="flex flex-col gap-6" aria-label="Insights">
    <div class="grid items-end gap-3 rounded-xl border border-default bg-default p-4 shadow-xs sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto]" role="search" aria-label="Filter students">
      <label class="flex flex-col gap-1.5 text-xs font-medium leading-4 text-default">
        <span>Search students</span>
        <input
          v-model="filters.search"
          type="search"
          autocomplete="off"
          placeholder="Name or student number"
          class="min-h-11 rounded-sm border border-default bg-default px-3 text-base/6 font-normal text-default md:min-h-0 md:py-[9px] md:text-sm/5"
        >
      </label>
      <label class="flex flex-col gap-1.5 text-xs font-medium leading-4 text-default">
        <span>Campus</span>
        <select v-model="filters.campus" aria-label="Campus" class="min-h-11 rounded-sm border border-default bg-default px-3 text-base/6 font-normal text-default md:min-h-0 md:py-[9px] md:text-sm/5">
          <option value="">All campuses</option>
          <option v-for="item in campuses" :key="item" :value="item">{{ item }}</option>
        </select>
      </label>
      <label class="flex flex-col gap-1.5 text-xs font-medium leading-4 text-default">
        <span>Course progress</span>
        <select v-model="filters.group" aria-label="Course progress" class="min-h-11 rounded-sm border border-default bg-default px-3 text-base/6 font-normal text-default md:min-h-0 md:py-[9px] md:text-sm/5">
          <option value="">Any progress</option>
          <option v-for="item in progressGroupRanges" :key="item.key" :value="item.key">{{ item.label }}</option>
        </select>
      </label>
      <label class="flex flex-col gap-1.5 text-xs font-medium leading-4 text-default">
        <span>Current module</span>
        <select v-model="filters.moduleId" aria-label="Current module" class="min-h-11 rounded-sm border border-default bg-default px-3 text-base/6 font-normal text-default md:min-h-0 md:py-[9px] md:text-sm/5">
          <option value="">Any module</option>
          <option v-for="module in modules" :key="module.id" :value="module.id">{{ module.name }}</option>
          <option :value="noModuleOpen">No module open</option>
        </select>
      </label>
      <button
        type="button"
        class="min-h-11 rounded-sm border border-default px-4 text-sm font-medium text-highlighted hover:bg-ink-50 disabled:opacity-50 md:min-h-10"
        :disabled="!filtering"
        @click="clear"
      >
        Clear filters
      </button>
    </div>

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
