<script setup lang="ts">
import BusySpinner from '../BusySpinner.vue'
import type { ProgressView, RoadmapModule } from '#shared/turn'
import { courseProgress } from '#shared/course-progress'
import ProgressPanel from './ProgressPanel.vue'

const props = defineProps<{
  modules: RoadmapModule[]
  masteryThreshold: number
  progress: ProgressView
  weakSpots: readonly string[]
  pendingModuleId?: string
  // The module a select turn is opening, shown with a spinner.
  selectingModuleId?: string
}>()

const emit = defineEmits<{
  selectModule: [moduleId: string]
  prefetchModule: [moduleId: string]
}>()

function onHover(event: PointerEvent, module: RoadmapModule) {
  if (event.pointerType !== 'mouse' || module.state === 'closed') return
  emit('prefetchModule', module.id)
}

// Modules listed without content stay out of the total, so 100% is reachable.
const progressSummary = computed(() => courseProgress(props.modules))
const thresholdPercent = computed(() => Math.round(props.masteryThreshold * 100))

// A closed module shows no mastery, so only an unlocked one reaches the bar.
function masteryPercent(module: RoadmapModule): number {
  return module.state === 'closed' ? 0 : Math.round(module.mastery * 100)
}

const groups = computed(() => {
  const grouped: { part: string, label: string, modules: RoadmapModule[] }[] = []
  for (const module of props.modules) {
    const last = grouped.at(-1)
    if (!last || last.part !== module.part) {
      grouped.push({
        part: module.part,
        label: `Part ${grouped.length + 1}: ${module.part}`,
        modules: [module],
      })
    }
    else {
      last.modules.push(module)
    }
  }
  return grouped
})

function cardClass(module: RoadmapModule): string {
  const cursor = module.state === 'closed' ? 'cursor-default' : 'cursor-pointer'
  if (module.state === 'closed') {
    return `${cursor} bg-ink-100/70 opacity-80 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-ink-200)_60%,transparent)] active:!translate-y-0`
  }
  if (module.current) {
    return `${cursor} bg-brand-50/60 shadow-[inset_0_0_0_1px_var(--color-brand-300),0px_0px_0px_1px_color-mix(in_oklab,var(--color-brand-200)_60%,transparent)]`
  }
  return `${cursor} bg-paper shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-ink-200)_90%,transparent),0px_1px_1px_rgba(0,0,0,0.02)] hover:-translate-y-px hover:shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--color-brand-300)_90%,transparent),0px_2px_6px_rgba(15,23,42,0.06)]`
}
</script>

<template>
  <aside class="h-full min-h-0 min-w-0 flex-col border-r border-ink-200 bg-ink-50/80 md:max-lg:block md:max-lg:h-auto md:max-lg:overflow-x-auto md:max-lg:overflow-y-hidden md:max-lg:border-r-0 md:max-lg:border-b lg:flex">
    <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 md:max-lg:w-max md:max-lg:min-w-full md:max-lg:flex-none md:max-lg:flex-row md:max-lg:items-center md:max-lg:overflow-visible lg:gap-3 lg:px-3 lg:pt-0">
      <div class="flex items-center justify-between gap-2 md:max-lg:w-36 md:max-lg:shrink-0 md:max-lg:flex-col md:max-lg:items-start lg:sticky lg:top-0 lg:z-10 lg:-mx-3 lg:h-[4.5rem] lg:shrink-0 lg:flex-col lg:items-start lg:justify-center lg:gap-0.5 lg:border-b lg:border-ink-200 lg:bg-paper lg:px-6">
        <h2 class="text-xs leading-4 font-semibold tracking-[-0.2px] text-ink-800">
          Course roadmap
        </h2>
        <div class="flex min-w-0 shrink-0 flex-col gap-1 md:max-lg:w-full lg:w-full">
          <p class="font-mono text-[10px] leading-[15px] text-ink-400">
            {{ progressSummary.mastered }}/{{ progressSummary.total }} modules mastered
          </p>
          <div class="flex items-center gap-2">
            <div
              class="h-1.5 min-w-12 flex-1 overflow-hidden rounded-full bg-ink-100"
              role="progressbar"
              aria-label="Course progress"
              :aria-valuenow="progressSummary.percent"
              aria-valuemin="0"
              aria-valuemax="100"
            >
              <div
                class="h-full rounded-full bg-brand-500 transition-[width]"
                :style="{ width: `${progressSummary.percent}%` }"
              />
            </div>
            <span class="font-mono text-[10px] leading-[15px] text-ink-500">{{ progressSummary.percent }}%</span>
          </div>
        </div>
      </div>
      <ul class="flex flex-col gap-1.5 md:max-lg:flex-row md:max-lg:flex-nowrap">
        <template
          v-for="group in groups"
          :key="group.label"
        >
          <li
            role="presentation"
            class="px-1 pt-2 md:max-lg:flex md:max-lg:w-40 md:max-lg:shrink-0 md:max-lg:items-center md:max-lg:pt-0 lg:px-3 lg:pt-3 lg:pb-0.5 first:lg:pt-1"
          >
            <h3 class="text-[10px] font-semibold tracking-[0.4px] text-ink-400 uppercase">
              {{ group.label }}
            </h3>
          </li>
          <li
            v-for="module in group.modules"
            :key="module.id"
            class="md:max-lg:w-52 md:max-lg:shrink-0"
            :aria-current="module.current ? 'true' : undefined"
          >
            <button
              type="button"
              class="w-full rounded-[6px] px-3 py-2.5 text-left"
              :class="cardClass(module)"
              :aria-busy="pendingModuleId === module.id || selectingModuleId === module.id ? true : undefined"
              @pointerenter="onHover($event, module)"
              @click="emit('selectModule', module.id)"
            >
              <template v-if="module.state === 'closed'">
                <p class="flex min-w-0 items-start gap-1.5 text-xs leading-4 font-medium text-ink-600">
                  <img
                    src="/course-roadmap-lock.svg"
                    alt=""
                    width="12"
                    height="12"
                    class="mt-0.5 shrink-0"
                  >
                  {{ module.name }}
                </p>
                <p class="mt-1.5 flex items-center gap-1.5 text-[11px] leading-4 text-ink-400">
                  <span class="font-mono text-[10px]">Closed</span>
                  <span aria-hidden="true">·</span>
                  {{ module.closedReason }}
                </p>
              </template>
              <div
                v-else
                class="flex flex-col items-start gap-1.5"
              >
                <p
                  class="min-w-0 text-xs leading-4 text-pretty"
                  :class="module.current ? 'font-semibold text-brand-950' : 'font-medium text-ink-800'"
                >
                  {{ module.name }}
                  <BusySpinner
                    v-if="selectingModuleId === module.id"
                    class="ml-1 inline text-brand-600"
                  />
                </p>
                <p
                  v-if="module.state === 'mastered'"
                  class="flex h-[21px] shrink-0 items-center gap-1 rounded-[4px] border border-emerald-200/60 bg-emerald-50 px-[7px] text-[10px] font-medium leading-[15px] text-emerald-700"
                >
                  <img
                    src="/course-roadmap-tick.svg"
                    alt=""
                    width="10"
                    height="10"
                  >
                  Mastered
                </p>
                <p
                  v-else
                  class="flex h-[21px] shrink-0 items-center gap-1 rounded-[4px] border border-brand-200 bg-brand-100/70 px-[7px] text-[10px] font-medium leading-[15px] text-brand-700"
                >
                  <span
                    v-if="module.current"
                    class="size-1.5 shrink-0 rounded-full bg-brand-600"
                    aria-hidden="true"
                  />
                  {{ module.current ? 'Open · Current' : 'Open' }}
                </p>
              </div>
              <div
                v-if="module.state !== 'closed'"
                class="mt-2 flex items-center gap-2"
              >
                <span
                  class="relative h-1.5 min-w-0 flex-1 rounded-full bg-ink-200/80"
                  aria-hidden="true"
                >
                  <span
                    class="absolute inset-y-0 left-0 rounded-full"
                    :class="module.state === 'mastered' ? 'bg-emerald-500' : 'bg-brand-500'"
                    :style="{ width: `${masteryPercent(module)}%` }"
                  />
                  <span
                    class="absolute -top-0.5 -bottom-0.5 w-px bg-ink-400"
                    :style="{ left: `${thresholdPercent}%` }"
                  />
                </span>
                <p class="shrink-0 font-mono text-[10px] leading-[15px] text-ink-500 tabular-nums">
                  {{ masteryPercent(module) }}%
                </p>
              </div>
              <p
                v-if="module.state !== 'closed' && module.masteryReason"
                class="mt-1.5 text-[11px] leading-4 text-ink-500 text-pretty"
              >
                {{ module.masteryReason }}
              </p>
            </button>
          </li>
        </template>
      </ul>
      <ProgressPanel
        :progress="progress"
        :weak-spots="weakSpots"
      />
    </div>
  </aside>
</template>
