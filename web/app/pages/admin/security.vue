<script setup lang="ts">
import AdminHeader from '~/components/admin/AdminHeader.vue'
import type { InjectionAgent, InjectionSuiteView } from '#shared/injection-suite'

definePageMeta({ middleware: 'signed-in' })
useHead({ title: 'Cyber Security' })

const requestFetch = useRequestFetch()
const { data, error } = await useAsyncData(
  'product-owner-injection-suite',
  () => requestFetch<InjectionSuiteView>('/api/admin/security-suite'),
)

const refused = computed(() => error.value?.statusCode === 403)
const unavailable = computed(() => Boolean(error.value) && !refused.value)
const problems = computed(() => {
  const details = error.value?.data as { problems?: string[] } | undefined
  return details?.problems ?? []
})

const agentLabels: Record<InjectionAgent, string> = { teacher: 'Teacher', deskmate: 'Mai' }

function agentClass(agent: InjectionAgent): string {
  return agent === 'teacher' ? 'bg-brand-50 text-brand-700' : 'bg-amber-50 text-amber-800'
}
</script>

<template>
  <div class="flex min-h-dvh flex-col bg-muted">
    <AdminHeader />
    <main class="phone-safe-bottom mx-auto flex w-full max-w-[90rem] flex-1 flex-col gap-6 p-4 md:p-8">
      <p v-if="refused" role="alert" class="max-w-sm text-sm text-default">
        This page is for the administrator.
      </p>
      <p v-else-if="unavailable && !problems.length" role="alert" class="max-w-sm text-sm text-default">
        This page is unavailable right now.
      </p>
      <section v-else-if="problems.length" role="alert" class="flex max-w-2xl flex-col gap-2">
        <h1 class="text-xl font-semibold tracking-tight text-highlighted">
          Cyber Security
        </h1>
        <p class="text-sm text-default">
          The injection suite is invalid, so no case can run. Every problem in the file is listed below.
        </p>
        <ul class="list-disc rounded-[8px] border border-red-200 bg-red-50 py-3 pr-3 pl-7 text-sm text-red-800">
          <li v-for="problem in problems" :key="problem">
            {{ problem }}
          </li>
        </ul>
      </section>
      <section v-else-if="data" class="page-enter flex min-w-0 flex-col gap-5">
        <div class="flex flex-wrap items-baseline justify-between gap-3">
          <h1 class="text-xl font-semibold tracking-tight text-highlighted">
            Cyber Security
          </h1>
          <p class="max-w-xl text-sm text-muted">
            The committed injection suite, grouped by attack family. Every category holds at least fifteen cases.
          </p>
        </div>

        <dl class="grid grid-cols-2 gap-3 md:grid-cols-4">
          <div class="rounded-[8px] border border-default bg-default px-4 py-3">
            <dt class="text-xs text-muted">
              Cases
            </dt>
            <dd class="mt-1 font-mono text-lg leading-6 font-semibold text-highlighted">
              {{ data.totalCases }}
            </dd>
          </div>
          <div class="rounded-[8px] border border-default bg-default px-4 py-3">
            <dt class="text-xs text-muted">
              Categories
            </dt>
            <dd class="mt-1 font-mono text-lg leading-6 font-semibold text-highlighted">
              {{ data.categories.length }}
            </dd>
          </div>
          <div class="rounded-[8px] border border-default bg-default px-4 py-3">
            <dt class="text-xs text-muted">
              Against the Teacher
            </dt>
            <dd class="mt-1 font-mono text-lg leading-6 font-semibold text-highlighted">
              {{ data.teacherCases }}
            </dd>
          </div>
          <div class="rounded-[8px] border border-default bg-default px-4 py-3">
            <dt class="text-xs text-muted">
              Against Mai
            </dt>
            <dd class="mt-1 font-mono text-lg leading-6 font-semibold text-highlighted">
              {{ data.deskmateCases }}
            </dd>
          </div>
        </dl>

        <section
          v-for="category in data.categories"
          :key="category.id"
          class="flex min-w-0 flex-col gap-2 rounded-[8px] border border-ink-200 bg-ink-50/70 px-4 py-4 md:px-5"
          :aria-label="category.label"
        >
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <h2 class="text-sm leading-5 font-semibold text-ink-900">
              {{ category.label }}
            </h2>
            <p class="font-mono text-[11px] text-ink-500">
              {{ category.cases.length }} cases
            </p>
          </div>
          <ol class="flex flex-col gap-1.5">
            <li
              v-for="(entry, index) in category.cases"
              :key="entry.id"
              class="flex flex-wrap items-start gap-x-3 gap-y-1.5 rounded-[6px] border border-ink-200 bg-paper px-3 py-2"
            >
              <span class="mt-0.5 font-mono text-[11px] leading-5 text-ink-400">{{ index + 1 }}</span>
              <span class="min-w-0 flex-1 text-[13px] leading-5 text-ink-800">{{ entry.prompt }}</span>
              <span
                class="shrink-0 rounded-[4px] px-1.5 py-0.5 text-[10px] leading-[15px] font-medium"
                :class="agentClass(entry.agent)"
              >{{ agentLabels[entry.agent] }}</span>
              <span
                v-if="entry.priorTurns > 0"
                class="shrink-0 rounded-[4px] bg-ink-100 px-1.5 py-0.5 text-[10px] leading-[15px] font-medium text-ink-600"
              >{{ entry.priorTurns }} earlier turns</span>
              <span v-if="entry.note" class="basis-full text-[11px] leading-5 text-ink-500">
                {{ entry.note }}
              </span>
            </li>
          </ol>
        </section>
      </section>
    </main>
  </div>
</template>
