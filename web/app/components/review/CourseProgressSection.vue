<script setup lang="ts">
import type { ReviewMastery } from '#shared/staff-review'

// The student's Course progress on the staff review: the x/total figure, then
// each module with its mastery and whether the student can open it.
defineProps<{ mastery: ReviewMastery }>()

const percent = (share: number) => Math.round(share * 100)
</script>

<template>
  <section aria-labelledby="course-progress-heading" class="flex flex-col gap-3" data-testid="review-course-progress">
    <h2 id="course-progress-heading" class="text-base font-semibold text-highlighted">
      Course progress
    </h2>
    <div class="rounded-lg border border-default bg-default text-sm shadow-xs">
      <div class="border-b border-default p-3">
        <p class="font-mono text-xs text-ink-700">
          {{ mastery.progress.mastered }}/{{ mastery.progress.total }} · {{ mastery.progress.percent }}%
        </p>
        <div
          class="mt-1 h-2 overflow-hidden rounded-full bg-ink-100"
          role="progressbar"
          aria-label="Course progress"
          :aria-valuenow="mastery.progress.percent"
          :aria-valuetext="`${mastery.progress.mastered} of ${mastery.progress.total} modules mastered`"
          aria-valuemin="0"
          aria-valuemax="100"
        >
          <div class="h-full rounded-full bg-brand-500" :style="{ width: `${mastery.progress.percent}%` }" />
        </div>
      </div>
      <ul class="flex flex-col divide-y divide-default">
        <li v-for="module in mastery.modules" :key="module.moduleId" class="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
          <span class="min-w-0 flex-1 text-default [overflow-wrap:anywhere]">{{ module.name }}</span>
          <div
            class="h-1.5 w-24 overflow-hidden rounded-full bg-ink-100"
            role="progressbar"
            :aria-label="`${module.name} mastery`"
            :aria-valuenow="percent(module.mastery)"
            :aria-valuetext="module.state === 'mastered' ? `${percent(module.mastery)}%, mastered` : `${percent(module.mastery)}%`"
            aria-valuemin="0"
            aria-valuemax="100"
          >
            <div class="h-full rounded-full" :class="module.state === 'mastered' ? 'bg-emerald-500' : 'bg-brand-500'" :style="{ width: `${percent(module.mastery)}%` }" />
          </div>
          <span class="w-10 text-right font-mono text-xs text-ink-700">{{ percent(module.mastery) }}%</span>
          <span
            class="w-20 rounded-full py-0.5 text-center text-xs font-medium"
            :class="module.state === 'closed' ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'"
          >{{ module.state === 'closed' ? 'Closed' : 'Unlocked' }}</span>
        </li>
      </ul>
    </div>
  </section>
</template>
