<script setup lang="ts">
import { campuses, type Campus } from '#shared/campus'
import type { LecturerCourse } from '#shared/lecturer'
import CourseProgressHistogram from '~/components/lecturer/CourseProgressHistogram.vue'
import ModuleStatusChart from '~/components/lecturer/ModuleStatusChart.vue'
import { studentsAtCampus } from '~/lecturer/course-insights'

// The Insights tab: Course insights for each owned course, worked out here from the lecturer
// response. One campus filter applies to the whole tab and sends no request.
const props = defineProps<{ courses: LecturerCourse[] }>()

const campus = ref<Campus | ''>('')
const views = computed(() => props.courses.map(course => ({
  course,
  students: studentsAtCampus(course.students, campus.value),
})))
</script>

<template>
  <section class="flex flex-col gap-6" aria-label="Insights">
    <label class="flex w-full flex-col gap-1.5 text-xs font-medium leading-4 text-default md:w-48">
      <span>Campus</span>
      <select
        v-model="campus"
        class="min-h-11 rounded-sm border border-default bg-default px-3 text-base/6 text-default md:min-h-0 md:py-[9px] md:text-sm/5"
      >
        <option value="">All campuses</option>
        <option v-for="item in campuses" :key="item" :value="item">{{ item }}</option>
      </select>
    </label>

    <article
      v-for="{ course, students } in views"
      :key="course.id"
      class="flex flex-col gap-4 rounded-lg border border-default bg-default p-4 shadow-xs md:p-8"
      :aria-label="`Course insights for ${course.title}`"
    >
      <div>
        <h2 class="text-lg font-semibold text-highlighted">{{ course.title }}</h2>
        <h3 class="text-sm text-muted">Course insights</h3>
      </div>
      <p v-if="!course.students.length" class="text-sm text-muted">No students enrolled yet.</p>
      <p v-else-if="!students.length" class="text-sm text-muted">No students at {{ campus }}.</p>
      <template v-else>
        <p class="text-sm text-muted" data-testid="insights-student-count">
          {{ students.length }} {{ students.length === 1 ? 'student' : 'students' }} shown
        </p>
        <ModuleStatusChart :modules="course.modules" :students="students" />
        <CourseProgressHistogram :students="students" />
      </template>
    </article>
  </section>
</template>
