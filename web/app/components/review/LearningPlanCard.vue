<script setup lang="ts">
import type { ReviewPlan, ReviewPlanRevision } from '#shared/staff-review'
import { timeText } from '~/staff/time-text'

// One module's learning plan on the staff review: collapsed to the plan in
// force, expanding in place to every revision.
const props = defineProps<{ plan: ReviewPlan }>()

const open = ref(false)
const historyId = useId()
const latest = computed(() => props.plan.revisions.at(-1)!)
const planState = (revision: ReviewPlanRevision) => revision.agreedAt ? 'Agreed' : 'Proposed'
</script>

<template>
  <div class="rounded-lg border border-default bg-default text-sm shadow-xs">
    <h3>
      <button
        type="button"
        class="flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-lg p-3 text-left hover:bg-muted"
        :aria-expanded="open"
        :aria-controls="historyId"
        @click="open = !open"
      >
        <span class="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3">
          <span class="font-medium text-highlighted [overflow-wrap:anywhere]">{{ plan.moduleName }}</span>
          <span class="text-muted">Revision {{ latest.revision }}</span>
          <span class="text-muted">{{ planState(latest) }}</span>
        </span>
        <svg
          class="size-4 shrink-0 text-muted transition-transform motion-reduce:transition-none"
          :class="{ 'rotate-180': open }"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          aria-hidden="true"
        >
          <path d="m4 6 4 4 4-4" />
        </svg>
      </button>
    </h3>
    <ol v-show="open" :id="historyId" class="flex flex-col gap-3 border-t border-default p-3">
      <li v-for="revision in plan.revisions" :key="revision.revision">
        <p class="flex flex-wrap items-baseline gap-x-3">
          <strong class="text-highlighted">Revision {{ revision.revision }}</strong>
          <span class="text-muted">{{ planState(revision) }}</span>
          <span v-if="revision.trigger" class="text-xs text-muted [overflow-wrap:anywhere]">Because: {{ revision.trigger }}</span>
          <time :datetime="revision.time" class="ml-auto text-xs text-muted">{{ timeText(revision.time) }}</time>
        </p>
        <ol class="mt-1 list-decimal pl-5 text-default">
          <li
            v-for="(step, index) in revision.steps"
            :key="index"
            class="[overflow-wrap:anywhere]"
            :aria-current="index === revision.currentStep ? 'step' : undefined"
          >
            {{ step.title }}<span v-if="index === revision.currentStep" class="text-xs text-muted"> (current)</span>
          </li>
        </ol>
      </li>
    </ol>
  </div>
</template>
