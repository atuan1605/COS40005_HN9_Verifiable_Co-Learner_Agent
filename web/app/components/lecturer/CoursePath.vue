<script setup lang="ts">
import type { LecturerCourse, LecturerStudent } from '#shared/lecturer'
import StudentChips from '~/components/lecturer/StudentChips.vue'
import { coursePath, studentCountText } from '~/lecturer/course-insights'

// Every listed module in course order, with the students now working on it.
const props = defineProps<{ modules: LecturerCourse['modules'], students: LecturerStudent[] }>()

const path = computed(() => coursePath(props.modules, props.students))
const share = (count: number) => props.students.length ? (count * 100) / props.students.length : 0
</script>

<template>
  <section class="rounded-xl border border-default bg-default p-4 shadow-xs md:p-5" data-testid="course-path">
    <h4 class="text-sm font-semibold text-highlighted">Where each student is now</h4>
    <p class="mb-4 text-sm text-muted">A student stands on the first module open to them.</p>
    <ol>
      <li
        v-for="module in path.modules"
        :key="module.id"
        class="relative grid gap-x-4 gap-y-2 border-l-2 pb-4 pl-6 md:grid-cols-[16rem_1fr]"
        :class="module.here.length ? 'border-brand-500' : 'border-default'"
        :aria-label="`${module.name}: ${studentCountText(module.here.length)} working here, ${module.mastered} mastered it`"
      >
        <span class="absolute top-0 -left-[13px] grid size-6 place-items-center rounded-full text-xs font-semibold" :class="module.here.length ? 'bg-accent text-on-accent' : 'bg-ink-200 text-default'" aria-hidden="true">
          {{ module.number }}
        </span>
        <div>
          <p class="text-sm font-medium text-highlighted">{{ module.name }}</p>
          <div class="mt-1.5 h-2 rounded-full bg-ink-100" aria-hidden="true">
            <div class="h-full rounded-full bg-brand-500" :style="{ width: `${share(module.here.length)}%` }" />
          </div>
          <p class="mt-1 text-xs text-muted">{{ module.here.length }} working here, {{ module.mastered }} mastered it</p>
        </div>
        <StudentChips :students="module.here" />
      </li>
      <li class="relative grid gap-x-4 gap-y-2 pl-6 md:grid-cols-[16rem_1fr]" :aria-label="`No module open: ${studentCountText(path.noneOpen.length)}`">
        <span class="absolute top-0 -left-[11px] size-6 rounded-full bg-emerald-700" aria-hidden="true" />
        <p class="text-sm font-medium text-highlighted">No module open: {{ path.noneOpen.length }}</p>
        <StudentChips :students="path.noneOpen" />
      </li>
    </ol>
  </section>
</template>
