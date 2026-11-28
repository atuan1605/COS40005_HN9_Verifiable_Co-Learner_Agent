<script setup lang="ts">
import { pageNumbers } from '~/lecturer/course-insights'

// Previous, the page numbers and Next. Nothing shows for a single page.
const props = defineProps<{ pageCount: number, label: string }>()
const page = defineModel<number>({ required: true })

const numbers = computed(() => pageNumbers(page.value, props.pageCount))
const button = 'min-h-11 min-w-11 rounded-md px-2 text-sm font-medium disabled:opacity-40 md:min-h-9 md:min-w-9'
</script>

<template>
  <nav v-if="pageCount > 1" :aria-label="label" class="flex flex-wrap items-center gap-1">
    <button type="button" class="text-brand-700 hover:bg-ink-100" :class="button" :disabled="page === 1" @click="page--">
      Previous
    </button>
    <template v-for="(number, index) in numbers" :key="number ?? `gap-${index}`">
      <span v-if="number === null" class="px-1 text-sm text-muted" aria-hidden="true">…</span>
      <button
        v-else
        type="button"
        :class="[button, number === page ? 'bg-accent text-on-accent' : 'text-default hover:bg-ink-100']"
        :aria-label="`Page ${number}`"
        :aria-current="number === page ? 'page' : undefined"
        @click="page = number"
      >
        {{ number }}
      </button>
    </template>
    <button type="button" class="text-brand-700 hover:bg-ink-100" :class="button" :disabled="page === pageCount" @click="page++">
      Next
    </button>
  </nav>
</template>
