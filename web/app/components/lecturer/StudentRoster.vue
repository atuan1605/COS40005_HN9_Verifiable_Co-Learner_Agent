<script setup lang="ts">
import type { LecturerCourse, LecturerStudent } from '#shared/lecturer'
import ModuleRing from '~/components/lecturer/ModuleRing.vue'
import StudentPortrait from '~/components/lecturer/StudentPortrait.vue'

// A course's enrolled students, sorted on the page.
const props = defineProps<{
  course: LecturerCourse
  // The enrolled students the tab's filters leave.
  students: LecturerStudent[]
}>()

const enrolledDate = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
  timeZone: 'UTC',
})

type StudentSortKey = 'displayName' | 'studentNumber' | 'enrolledAt'
const sort = ref<{ key: StudentSortKey, asc: boolean }>({ key: 'displayName', asc: true })

function toggleSort(key: StudentSortKey) {
  sort.value = { key, asc: sort.value.key === key ? !sort.value.asc : true }
}

function ariaSort(key: StudentSortKey): 'none' | 'ascending' | 'descending' {
  if (sort.value.key !== key) return 'none'
  return sort.value.asc ? 'ascending' : 'descending'
}

const sorted = computed(() => {
  const { key, asc } = sort.value
  return [...props.students]
    .sort((left, right) => left[key].localeCompare(right[key], 'en', { numeric: true }) * (asc ? 1 : -1))
})

function enrolledText(value: string): string {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return enrolledDate.format(parsed)
}
</script>

<template>
  <section
    class="rounded-xl border border-default bg-default p-4 shadow-xs md:p-5"
    data-testid="course-students"
  >
    <div>
      <h3 class="text-sm font-semibold text-highlighted">
        Enrolled students
      </h3>
      <ul class="mt-1 flex gap-3 text-xs text-muted" aria-label="Progress ring colours">
        <li class="flex items-center gap-1.5"><span class="size-2.5 rounded-xs bg-emerald-700" aria-hidden="true" />Mastered</li>
        <li class="flex items-center gap-1.5"><span class="size-2.5 rounded-xs bg-brand-500" aria-hidden="true" />Open</li>
        <li class="flex items-center gap-1.5"><span class="size-2.5 rounded-xs bg-ink-300" aria-hidden="true" />Closed</li>
      </ul>
    </div>
    <p v-if="!course.students.length" class="mt-3 text-sm text-muted">
      No students enrolled yet.
    </p>
    <p v-else-if="!students.length" class="mt-3 text-sm text-muted">
      No students match these filters.
    </p>
    <div
      v-else
      class="mt-3 overflow-hidden rounded-lg border border-default"
    >
      <!-- Below md each row stacks into a block, so nothing is squeezed or cut off on a phone. -->
      <table class="w-full border-collapse text-left text-sm text-default max-md:block">
        <thead class="border-b border-default bg-muted text-xs text-muted max-md:block">
          <tr class="max-md:flex">
            <th scope="col" class="px-3 py-2 font-medium" :aria-sort="ariaSort('displayName')">
              <button type="button" class="inline-flex min-h-11 items-center gap-1 hover:text-highlighted md:min-h-0" @click="toggleSort('displayName')">
                Name<span v-if="sort.key === 'displayName'" aria-hidden="true">{{ sort.asc ? '↑' : '↓' }}</span>
              </button>
            </th>
            <th scope="col" class="px-3 py-2 font-medium" :aria-sort="ariaSort('studentNumber')">
              <button type="button" class="inline-flex min-h-11 items-center gap-1 hover:text-highlighted md:min-h-0" @click="toggleSort('studentNumber')">
                Student number<span v-if="sort.key === 'studentNumber'" aria-hidden="true">{{ sort.asc ? '↑' : '↓' }}</span>
              </button>
            </th>
            <th scope="col" class="px-3 py-2 font-medium max-md:hidden">
              Progress
            </th>
            <th scope="col" class="hidden px-3 py-2 font-medium md:table-cell">
              Email
            </th>
            <th scope="col" class="px-3 py-2 font-medium max-md:hidden">
              <span class="sr-only">Review</span>
            </th>
            <th scope="col" class="hidden px-3 py-2 font-medium md:table-cell" :aria-sort="ariaSort('enrolledAt')">
              <button type="button" class="inline-flex min-h-11 items-center gap-1 hover:text-highlighted md:min-h-0" @click="toggleSort('enrolledAt')">
                Enrolled<span v-if="sort.key === 'enrolledAt'" aria-hidden="true">{{ sort.asc ? '↑' : '↓' }}</span>
              </button>
            </th>
          </tr>
        </thead>
        <tbody class="max-md:block">
          <tr
            v-for="student in sorted"
            :key="student.studentNumber"
            class="border-t border-default align-top max-md:grid max-md:grid-cols-[1fr_auto] max-md:py-2"
          >
            <td class="px-3 py-3 max-md:col-span-2 max-md:py-1">
              <div class="flex items-center gap-3">
                <StudentPortrait class="size-10" />
                <div class="min-w-0">
                  <p class="font-medium text-highlighted [overflow-wrap:anywhere]">
                    {{ student.displayName }}
                  </p>
                  <p class="text-xs text-muted [overflow-wrap:anywhere] md:hidden">
                    {{ student.email }}
                  </p>
                </div>
              </div>
            </td>
            <td class="px-3 py-3 max-md:py-1">
              <p class="font-mono whitespace-nowrap">
                {{ student.studentNumber }}
              </p>
              <p class="text-xs text-muted whitespace-nowrap" data-testid="student-campus">
                {{ student.campus ?? 'No campus yet' }}
              </p>
              <p class="text-xs text-muted whitespace-nowrap md:hidden">
                Enrolled {{ enrolledText(student.enrolledAt) }}
              </p>
            </td>
            <td class="px-3 py-3 max-md:py-1" data-testid="student-progress">
              <div class="flex items-center gap-2">
                <ModuleRing :student="student" :modules="course.modules" />
                <p class="text-xs whitespace-nowrap tabular-nums text-ink-700">
                  {{ student.progress.mastered }}/{{ student.progress.total }} · {{ student.progress.percent }}%
                </p>
              </div>
            </td>
            <td class="hidden px-3 py-3 [overflow-wrap:anywhere] md:table-cell">
              {{ student.email }}
            </td>
            <td class="px-3 py-3 whitespace-nowrap max-md:col-span-2 max-md:py-1">
              <NuxtLink
                :to="`/review/${student.studentNumber}`"
                class="inline-flex min-h-11 items-center text-sm font-medium text-brand-700 underline underline-offset-4 md:min-h-0"
                :aria-label="`Review ${student.displayName}'s work`"
              >
                Review work
              </NuxtLink>
            </td>
            <td class="hidden px-3 py-3 whitespace-nowrap md:table-cell">
              <time :datetime="student.enrolledAt">{{ enrolledText(student.enrolledAt) }}</time>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
