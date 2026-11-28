<script setup lang="ts">
import { ringSegment } from '~/lecturer/course-overview'

// A part-to-whole pie with its legend. The legend carries every count and share as text.
const props = defineProps<{
  // For screen readers: what the whole pie is.
  label: string
  // What one count counts, for the slice tooltip.
  unit: string
  slices: { label: string, count: number, fill: string, swatch: string }[]
  // The label of the slice a filter has chosen; the others are dimmed.
  highlight?: string
}>()

const hovered = ref<string | null>(null)
// A filter's slice looks as a hovered one does; the pointer's takes over while it is there.
const active = computed(() => hovered.value ?? props.highlight ?? null)
const total = computed(() => props.slices.reduce((sum, slice) => sum + slice.count, 0))
const percent = (count: number) => total.value ? Math.round((count * 100) / total.value) : 0
const drawn = computed(() => {
  let turn = 0
  return props.slices.filter(slice => slice.count > 0).map((slice) => {
    const from = turn
    turn += slice.count / total.value
    return { ...slice, path: ringSegment(from, turn, 50, 0) }
  })
})
</script>

<template>
  <div class="flex flex-wrap items-center gap-5">
    <svg viewBox="0 0 100 100" class="size-36 shrink-0" role="img" :aria-label="label">
      <circle v-if="!total" cx="50" cy="50" r="50" class="fill-ink-100" />
      <path
        v-for="slice in drawn"
        :key="slice.label"
        :d="slice.path"
        class="stroke-paper"
        :class="[slice.fill, active && active !== slice.label ? 'opacity-35' : '']"
        stroke-width="1.2"
        @pointerenter="hovered = slice.label"
        @pointerleave="hovered = null"
      >
        <title>{{ slice.label }}: {{ slice.count }} {{ unit }} ({{ percent(slice.count) }}%)</title>
      </path>
    </svg>
    <ul class="min-w-48 flex-1 text-sm">
      <li
        v-for="slice in slices"
        :key="slice.label"
        class="flex items-center gap-2 rounded-sm px-1.5 py-1"
        :class="active === slice.label ? 'bg-ink-100' : ''"
        :aria-current="highlight === slice.label ? 'true' : undefined"
        @pointerenter="hovered = slice.label"
        @pointerleave="hovered = null"
      >
        <span class="size-2.5 shrink-0 rounded-xs" :class="slice.swatch" aria-hidden="true" />
        <span class="flex-1 text-default">{{ slice.label }}</span>
        <span class="font-semibold tabular-nums text-highlighted">{{ slice.count }}</span>
        <span class="w-10 text-right tabular-nums text-muted">{{ percent(slice.count) }}%</span>
      </li>
    </ul>
  </div>
</template>
