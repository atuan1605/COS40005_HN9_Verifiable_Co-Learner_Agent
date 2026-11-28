<script setup lang="ts">
import { campuses } from '#shared/campus'
import type { LecturerCourse, LecturerStudent } from '#shared/lecturer'
import ModuleRing from '~/components/lecturer/ModuleRing.vue'
import StudentPortrait from '~/components/lecturer/StudentPortrait.vue'

// A course's enrolled students: searchable, filtered by campus and sorted on the page.
const props = defineProps<{ course: LecturerCourse }>()

const enrolledDate = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
  timeZone: 'UTC',
})

type StudentSortKey = 'displayName' | 'studentNumber' | 'enrolledAt'
const search = ref('')
const campusChoice = ref('')
const sort = ref<{ key: StudentSortKey, asc: boolean }>({ key: 'displayName', asc: true })

function toggleSort(key: StudentSortKey) {
  sort.value = { key, asc: sort.value.key === key ? !sort.value.asc : true }
}

function ariaSort(key: StudentSortKey): 'none' | 'ascending' | 'descending' {
  if (sort.value.key !== key) return 'none'
  return sort.value.asc ? 'ascending' : 'descending'
}

const students = computed<LecturerStudent[]>(() => {
  const term = (search.value ?? '').trim().toLowerCase()
  const { key, asc } = sort.value
  return props.course.students
    .filter(student => campusChoice.value === '' || student.campus === campusChoice.value)
    .filter(student => !term
      || student.displayName.toLowerCase().includes(term)
      || student.studentNumber.toLowerCase().includes(term))
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
    <div class="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
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
      <div class="flex flex-col gap-3 md:flex-row">
        <label class="flex w-full flex-col gap-1.5 text-xs font-medium leading-4 text-default md:w-64">
          <span>Search students</span>
          <UInput
            v-model="search"
            type="search"
            autocomplete="off"
            color="neutral"
            fixed
            placeholder="Name or student number"
            class="w-full"
            :ui="{ base: 'min-h-11 rounded-sm px-[13px] py-[9px] text-base/6 md:min-h-0 md:text-sm/5' }"
          />
        </label>
        <label class="flex w-full flex-col gap-1.5 text-xs font-medium leading-4 text-default md:w-48">
          <span>Campus</span>
          <select
            v-model="campusChoice"
            aria-label="Campus"
            class="min-h-11 rounded-sm border border-default bg-default px-3 text-base/6 text-default md:min-h-0 md:py-[9px] md:text-sm/5"
          >
            <option value="">All campuses</option>
            <option v-for="campus in campuses" :key="campus" :value="campus">{{ campus }}</option>
          </select>
        </label>
      </div>
    </div>
    <p v-if="!course.students.length" class="mt-3 text-sm text-muted">
      No students enrolled yet.
    </p>
    <p v-else-if="!students.length" class="mt-3 text-sm text-muted">
      No students match.
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
            v-for="student in students"
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
