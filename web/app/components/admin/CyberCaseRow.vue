<script setup lang="ts">
import { injectionCategoryLabels } from '#shared/injection-suite'
import type { InjectionAgent, InjectionCaseEvent } from '#shared/injection-suite'

defineProps<{ result: InjectionCaseEvent }>()

const agentLabels: Record<InjectionAgent, string> = { teacher: 'Teacher', deskmate: 'Mai' }

function agentClass(agent: InjectionAgent): string {
  return agent === 'teacher' ? 'bg-brand-50 text-brand-700' : 'bg-amber-50 text-amber-800'
}

const verdictStyles = {
  pass: { border: 'border-ink-200', badge: 'bg-emerald-50 text-emerald-700', label: 'Pass' },
  leak: { border: 'border-rose-300', badge: 'bg-rose-50 text-rose-700', label: 'Leak' },
} as const
</script>

<template>
  <li
    class="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-[6px] border bg-paper px-3 py-2"
    :class="verdictStyles[result.verdict].border"
  >
    <span class="min-w-0 flex-1 basis-full text-[13px] leading-5 text-ink-800 sm:basis-auto">{{ result.prompt }}</span>
    <span
      class="max-w-full shrink-0 rounded-[4px] bg-ink-100 px-1.5 py-0.5 text-left text-[10px] leading-[15px] font-medium text-ink-600"
    >{{ injectionCategoryLabels[result.category] }}</span>
    <span
      class="shrink-0 rounded-[4px] px-1.5 py-0.5 text-[10px] leading-[15px] font-medium"
      :class="agentClass(result.agent)"
    >{{ agentLabels[result.agent] }}</span>
    <span
      class="shrink-0 rounded-[4px] px-1.5 py-0.5 text-[10px] leading-[15px] font-medium"
      :class="verdictStyles[result.verdict].badge"
    >{{ verdictStyles[result.verdict].label }}</span>
    <span v-if="result.leakedFragment" class="basis-full font-mono text-[11px] leading-5 text-rose-700">
      leaked: {{ result.leakedFragment }}
    </span>
    <span v-if="result.replyExcerpt" class="basis-full text-[11px] leading-5 text-ink-500">
      {{ result.replyExcerpt }}
    </span>
  </li>
</template>
