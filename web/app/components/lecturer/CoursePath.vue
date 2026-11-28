<script setup lang="ts">
import type { LecturerCourse, LecturerStudent } from '#shared/lecturer'
import PagePicker from '~/components/lecturer/PagePicker.vue'
import StudentPortrait from '~/components/lecturer/StudentPortrait.vue'
import { busiestStop, coursePath, pathStops, studentCountText, studentPage } from '~/lecturer/course-insights'

// The course as a strip with a bar per module for how many students are working on it. The chosen
// module's students are listed below, a page at a time.
const props = defineProps<{ modules: LecturerCourse['modules'], students: LecturerStudent[] }>()

const stops = computed(() => pathStops(coursePath(props.modules, props.students)))
const tallest = computed(() => Math.max(1, ...stops.value.map(stop => stop.here.length)))

// The module the lecturer picked; with none picked, the busiest one shows.
const chosen = ref<string | null>(null)
const current = computed(() => stops.value.find(stop => stop.id === chosen.value) ?? busiestStop(stops.value)!)

const page = ref(1)
const shown = computed(() => studentPage(current.value.here, page.value))

function choose(id: string) {
  chosen.value = id
  page.value = 1
}

// A change of filters starts from the first page, and lets go of a module it has emptied.
watch(() => props.students, () => {
  page.value = 1
  if (!stops.value.find(stop => stop.id === chosen.value)?.here.length) chosen.value = null
})
</script>

<template>
  <section class="rounded-xl border border-default bg-default p-4 shadow-xs md:p-5" data-testid="course-path">
    <h4 class="text-sm font-semibold text-highlighted">Where each student is now</h4>
    <p class="mb-3 text-sm text-muted">A student stands on the first module open to them. Choose a module to list its students.</p>

    <div class="grid grid-cols-[repeat(auto-fill,minmax(4rem,1fr))] gap-2" role="group" aria-label="Modules">
      <button
        v-for="stop in stops"
        :key="stop.id"
        type="button"
        class="flex h-24 flex-col items-center justify-end gap-1 rounded-lg border p-1.5 focus-visible:outline-2 focus-visible:outline-brand-600"
        :class="stop.id === current.id ? 'border-brand-500 bg-brand-50' : 'border-default hover:bg-ink-50'"
        :aria-pressed="stop.id === current.id"
        :aria-label="stop.number ? `${stop.name}: ${studentCountText(stop.here.length)} working here` : `${stop.name}: ${studentCountText(stop.here.length)}`"
        :title="stop.name"
        @click="choose(stop.id)"
      >
        <span class="text-xs font-semibold text-highlighted">{{ stop.here.length }}</span>
        <span class="w-4 rounded-t-sm bg-brand-500" :style="{ height: `${(stop.here.length * 2.5) / tallest}rem` }" />
        <span class="text-xs text-muted">{{ stop.number ?? 'None' }}</span>
      </button>
    </div>

    <div class="mt-5 flex flex-wrap items-baseline justify-between gap-2">
      <h5 class="text-base font-semibold text-highlighted">{{ current.number ? `${current.number}. ` : '' }}{{ current.name }}</h5>
      <p v-if="current.number" class="text-sm text-muted">{{ current.here.length }} working here, {{ current.mastered }} mastered it</p>
      <p v-else class="text-sm text-muted">{{ studentCountText(current.here.length) }}</p>
    </div>

    <p v-if="!current.here.length" class="mt-3 text-sm text-muted">
      {{ current.number ? 'Nobody is working on this module.' : 'Every student has a module open.' }}
    </p>
    <ul v-else class="mt-2 divide-y divide-default border-y border-default">
      <li v-for="student in shown.students" :key="student.studentNumber">
        <NuxtLink
          :to="`/review/${student.studentNumber}`"
          class="flex min-h-12 items-center gap-3 py-1.5 hover:bg-ink-50 focus-visible:outline-2 focus-visible:outline-brand-600"
          :aria-label="`Review ${student.displayName}'s work`"
        >
          <StudentPortrait class="size-8" />
          <span class="min-w-0 flex-1 truncate text-sm text-highlighted">{{ student.displayName }}</span>
          <span class="hidden text-xs text-muted sm:block">{{ student.studentNumber }}</span>
          <span class="w-12 text-right text-sm tabular-nums text-muted">{{ student.progress.percent }}%</span>
        </NuxtLink>
      </li>
    </ul>

    <div v-if="shown.pageCount > 1" class="mt-3 flex flex-wrap items-center justify-between gap-2">
      <p class="text-xs text-muted" aria-live="polite">Showing {{ shown.from }}–{{ shown.to }} of {{ current.here.length }}</p>
      <PagePicker :model-value="shown.page" :page-count="shown.pageCount" label="Pages of students" @update:model-value="page = $event" />
    </div>
  </section>
</template>
