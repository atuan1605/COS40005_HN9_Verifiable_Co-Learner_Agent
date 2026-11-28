<script setup lang="ts">
import { campuses } from '#shared/campus'
import type { LecturerCourse } from '#shared/lecturer'
import { progressGroupRanges } from '~/lecturer/course-overview'
import { isFiltering, noFilters, noModuleOpen, type StudentFilterValues } from '~/lecturer/student-filters'

// The filter card at the top of the Overview and Insights tabs.
const props = defineProps<{ courses: LecturerCourse[] }>()
const filters = defineModel<StudentFilterValues>({ required: true })

const filtering = computed(() => isFiltering(filters.value))
// Every module any of the courses lists, once each.
const modules = computed(() => [...new Map(props.courses.flatMap(course => course.modules).map(module => [module.id, module])).values()])

function set(key: keyof StudentFilterValues, event: Event) {
  filters.value = { ...filters.value, [key]: (event.target as HTMLInputElement | HTMLSelectElement).value }
}
</script>

<template>
  <div class="grid grid-cols-[minmax(0,1fr)] items-end gap-3 rounded-xl border border-default bg-default p-4 shadow-xs sm:grid-cols-[repeat(2,minmax(0,1fr))] lg:grid-cols-[repeat(4,minmax(0,1fr))_auto]" role="search" aria-label="Filter students">
    <label class="flex flex-col gap-1.5 text-xs font-medium leading-4 text-default">
      <span>Search students</span>
      <input
        :value="filters.search"
        @input="set('search', $event)"
        type="search"
        autocomplete="off"
        placeholder="Name or student number"
        class="min-h-11 w-full min-w-0 rounded-sm border border-default bg-default px-3 text-base/6 font-normal text-default md:min-h-0 md:py-[9px] md:text-sm/5"
      >
    </label>
    <label class="flex flex-col gap-1.5 text-xs font-medium leading-4 text-default">
      <span>Campus</span>
      <select
        :value="filters.campus"
        aria-label="Campus"
        class="min-h-11 w-full min-w-0 rounded-sm border border-default bg-default px-3 text-base/6 font-normal text-default md:min-h-0 md:py-[9px] md:text-sm/5"
        @change="set('campus', $event)"
      >
        <option value="">All campuses</option>
        <option v-for="item in campuses" :key="item" :value="item">{{ item }}</option>
      </select>
    </label>
    <label class="flex flex-col gap-1.5 text-xs font-medium leading-4 text-default">
      <span>Course progress</span>
      <select
        :value="filters.group"
        aria-label="Course progress"
        class="min-h-11 w-full min-w-0 rounded-sm border border-default bg-default px-3 text-base/6 font-normal text-default md:min-h-0 md:py-[9px] md:text-sm/5"
        @change="set('group', $event)"
      >
        <option value="">Any progress</option>
        <option v-for="item in progressGroupRanges" :key="item.key" :value="item.key">{{ item.label }}</option>
      </select>
    </label>
    <label class="flex flex-col gap-1.5 text-xs font-medium leading-4 text-default">
      <span>Current module</span>
      <select
        :value="filters.moduleId"
        aria-label="Current module"
        class="min-h-11 w-full min-w-0 rounded-sm border border-default bg-default px-3 text-base/6 font-normal text-default md:min-h-0 md:py-[9px] md:text-sm/5"
        @change="set('moduleId', $event)"
      >
        <option value="">Any module</option>
        <option v-for="module in modules" :key="module.id" :value="module.id">{{ module.name }}</option>
        <option :value="noModuleOpen">No module open</option>
      </select>
    </label>
    <button
      type="button"
      class="min-h-11 rounded-sm border border-default px-4 text-sm font-medium text-highlighted hover:bg-ink-50 disabled:opacity-50 md:min-h-10"
      :disabled="!filtering"
      @click="filters = { ...noFilters }"
    >
      Clear filters
    </button>
  </div>
</template>
