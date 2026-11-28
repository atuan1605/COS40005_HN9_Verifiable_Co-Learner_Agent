<script setup lang="ts">
import AdminHeader from '~/components/admin/AdminHeader.vue'
import type { AdminPayload } from '~/admin/decisions'
import type { StaffAccessEntry } from '#shared/staff-review'

definePageMeta({ middleware: 'signed-in' })
useHead({ title: 'Access log' })

const requestFetch = useRequestFetch()
const { data, error } = await useAsyncData(
  'product-owner-staff-access',
  () => requestFetch<AdminPayload>('/api/admin', { method: 'POST', body: { event: 'staffAccessLog' } }),
)

const refused = computed(() => error.value?.statusCode === 403)
const unavailable = computed(() => Boolean(error.value) && !refused.value)

const dateTime = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' })
function openedText(entry: StaffAccessEntry): string {
  return entry.opened === 'student_conversation' ? `Opened conversation: ${entry.moduleName}` : "A student's work"
}
const roleLabels: Record<string, string> = { administrator: 'Administrator', lecturer: 'Lecturer' }
</script>

<template>
  <div class="flex min-h-dvh flex-col bg-muted">
    <AdminHeader />
    <main class="phone-safe-bottom mx-auto flex w-full max-w-[90rem] flex-1 flex-col gap-6 p-4 md:p-8">
      <p v-if="refused" role="alert" class="max-w-sm text-sm text-default">
        This page is for the administrator.
      </p>
      <p v-else-if="unavailable" role="alert" class="max-w-sm text-sm text-default">
        This page is unavailable right now.
      </p>
      <section v-else-if="data" class="page-enter flex min-w-0 flex-col gap-4">
        <div class="flex flex-wrap items-baseline justify-between gap-3">
          <h1 class="text-xl font-semibold tracking-tight text-highlighted">
            Staff access log
          </h1>
          <p class="text-sm text-muted">
            Every time a lecturer or an administrator opened a student's records, newest first.
          </p>
        </div>
        <p v-if="!data.staffAccess.length" class="text-sm text-muted">
          Nobody has opened a student's records yet.
        </p>
        <div v-else class="overflow-x-auto rounded-lg border border-default bg-default shadow-xs">
          <table class="w-full border-collapse text-left text-sm text-default">
            <caption class="sr-only">
              Openings of student records by staff
            </caption>
            <thead class="border-y border-default bg-muted text-xs text-muted">
              <tr>
                <th scope="col" class="px-3 py-2 font-medium">
                  When (UTC)
                </th>
                <th scope="col" class="px-3 py-2 font-medium">
                  Who
                </th>
                <th scope="col" class="px-3 py-2 font-medium">
                  Student
                </th>
                <th scope="col" class="px-3 py-2 font-medium">
                  Opened
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="entry in data.staffAccess" :key="entry.id" class="border-t border-default align-top">
                <td class="px-3 py-3 whitespace-nowrap">
                  <time :datetime="entry.time">{{ dateTime.format(new Date(entry.time)) }}</time>
                </td>
                <td class="px-3 py-3 [overflow-wrap:anywhere]">
                  {{ entry.actorEmail }}
                  <span class="text-xs text-muted">({{ roleLabels[entry.actorRole] }})</span>
                </td>
                <td class="px-3 py-3 font-mono whitespace-nowrap">
                  {{ entry.studentNumber ?? 'Deleted student' }}
                </td>
                <td class="px-3 py-3">
                  {{ openedText(entry) }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </main>
  </div>
</template>
