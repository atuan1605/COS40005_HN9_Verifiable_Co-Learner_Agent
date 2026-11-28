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
// The pointer's slice stands out while it is there, then the filter's again.
const active = computed(() => hovered.value ?? props.highlight ?? null)
const total = computed(() => props.slices.reduce((sum, slice) => sum + slice.count, 0))
const percent = (count: number) => total.value ? Math.round((count * 100) / total.value) : 0
const drawn = computed(() => {
  let turn = 0
  return props.slices.filter(slice => slice.count > 0).map((slice) => {
    const from = turn
    turn += slice.count / total.value
    // The filter's slice is pulled out from the centre, unless it is the whole pie.
    const middle = (from + turn) * Math.PI - Math.PI / 2
    const pulled = slice.label === props.highlight && slice.count < total.value
    const shift = pulled ? `translate(${Math.cos(middle) * 6} ${Math.sin(middle) * 6})` : undefined
    return { ...slice, shift, path: ringSegment(from, turn, 50, 0) }
  })
})
</script>

<template>
  <div class="flex flex-wrap items-center gap-5">
    <!-- The box has room around the pie for a pulled-out slice. -->
    <svg viewBox="-7 -7 114 114" class="size-40 shrink-0" role="img" :aria-label="label">
      <circle v-if="!total" cx="50" cy="50" r="50" class="fill-ink-100" />
      <path
        v-for="slice in drawn"
        :key="slice.label"
        :d="slice.path"
        :transform="slice.shift"
        :class="[
          slice.fill,
          highlight === slice.label ? 'stroke-ink-900' : 'stroke-paper',
          active && active !== slice.label ? 'opacity-25' : '',
        ]"
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
        :class="[
          active === slice.label ? 'bg-ink-100' : '',
          highlight === slice.label ? 'font-semibold ring-1 ring-brand-500' : '',
        ]"
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
