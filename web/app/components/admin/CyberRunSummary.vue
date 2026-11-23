<script setup lang="ts">
const props = defineProps<{
  score: number | null
  notScoredLabel: string
  passed: number
  leaked: number
  resolved: number
  total: number
  categoriesReached: number
  model: string
  shield: boolean | null
  startedAt: number
  durationMs: number
}>()

const scoreLabel = computed(() => props.score === null
  ? props.notScoredLabel
  : `${Math.round(props.score * 100)}%`)

const startedLabel = computed(() => props.startedAt === 0
  ? '—'
  : new Date(props.startedAt).toLocaleTimeString())

function formatDuration(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
  const seconds = Math.round(ms / 1000)
  return `${Math.floor(seconds / 60)} m ${String(seconds % 60).padStart(2, '0')} s`
}
</script>

<template>
  <dl class="grid grid-cols-2 gap-3 rounded-[6px] border border-ink-200 bg-paper px-3 py-3 sm:grid-cols-4 xl:grid-cols-9">
    <div class="col-span-2 rounded-[4px] bg-ink-50 px-2 py-1.5 sm:col-span-1">
      <dt class="text-[11px] text-ink-500">
        Security score
      </dt>
      <dd class="mt-0.5 font-mono text-lg leading-6 font-semibold text-ink-900">
        {{ scoreLabel }}
      </dd>
    </div>
    <div>
      <dt class="text-[11px] text-ink-500">
        Passed
      </dt>
      <dd class="mt-0.5 font-mono text-sm leading-5 font-semibold text-emerald-700">
        {{ passed }}
      </dd>
    </div>
    <div>
      <dt class="text-[11px] text-ink-500">
        Leaked
      </dt>
      <dd class="mt-0.5 font-mono text-sm leading-5 font-semibold text-rose-700">
        {{ leaked }}
      </dd>
    </div>
    <div>
      <dt class="text-[11px] text-ink-500">
        Cases finished
      </dt>
      <dd class="mt-0.5 font-mono text-sm leading-5 font-semibold text-ink-900">
        {{ resolved }} of {{ total }}
      </dd>
    </div>
    <div>
      <dt class="text-[11px] text-ink-500">
        Categories reached
      </dt>
      <dd class="mt-0.5 font-mono text-sm leading-5 font-semibold text-ink-900">
        {{ categoriesReached }}
      </dd>
    </div>
    <div>
      <dt class="text-[11px] text-ink-500">
        Model
      </dt>
      <dd class="mt-0.5 truncate font-mono text-sm leading-5 font-semibold text-ink-900" :title="model">
        {{ model }}
      </dd>
    </div>
    <div>
      <dt class="text-[11px] text-ink-500">
        VerifyShield
      </dt>
      <dd class="mt-0.5 font-mono text-sm leading-5 font-semibold" :class="shield === false ? 'text-rose-700' : 'text-ink-900'">
        {{ shield === null ? '—' : shield ? 'On' : 'Off' }}
      </dd>
    </div>
    <div>
      <dt class="text-[11px] text-ink-500">
        Started
      </dt>
      <dd class="mt-0.5 font-mono text-sm leading-5 font-semibold text-ink-900">
        {{ startedLabel }}
      </dd>
    </div>
    <div>
      <dt class="text-[11px] text-ink-500">
        Duration
      </dt>
      <dd class="mt-0.5 font-mono text-sm leading-5 font-semibold text-ink-900">
        {{ formatDuration(durationMs) }}
      </dd>
    </div>
  </dl>
</template>
