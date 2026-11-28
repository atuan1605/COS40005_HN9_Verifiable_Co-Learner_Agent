<script setup lang="ts">
import type { ReviewMessage, StaffConversation } from '#shared/staff-review'
import ChatMarkdown from '~/components/workspace/ChatMarkdown.vue'
import { bubbleClass, eventClass, nameClass, portraitClass, portraitSrc } from '~/workspace/chat-style'
import { dateMessages } from '~/workspace/conversation-dates'

// The path is set here, not by the file name: a `[studentNumber]/` folder beside
// `[studentNumber].vue` would nest this page inside the review page.
definePageMeta({ path: '/review/:studentNumber/conversations/:moduleId', middleware: 'signed-in' })

const route = useRoute()
const studentNumber = String(route.params.studentNumber)
const moduleId = String(route.params.moduleId)
useHead({ title: `Conversation ${studentNumber}` })

// Opening the page is what writes the staff access log, so it is read once on
// the server and not again from the browser.
const { data, error } = await useFetch<StaffConversation>('/api/staff/conversation', {
  key: `staff-conversation-${studentNumber}-${moduleId}`,
  query: { studentNumber, moduleId },
  getCachedData: () => undefined,
})

const refused = computed(() => error.value?.statusCode === 403 || error.value?.statusCode === 401)
const missing = computed(() => error.value?.statusCode === 404)
const unavailable = computed(() => Boolean(error.value) && !refused.value && !missing.value)

const speakers: Record<Exclude<ReviewMessage['author'], 'student' | 'event'>, string> = { teacher: 'Teacher', deskmate: 'Mai' }

// Days and times are in UTC, as on the review page, so the server and the browser draw the same text.
const rows = computed(() => {
  const messages = data.value?.messages ?? []
  const dates = dateMessages(messages.map(message => ({ createdAt: message.time ?? undefined })), new Date(), 'UTC')
  return messages.map((message, index) => ({ ...message, ...dates[index]!, sentAt: message.time }))
})
</script>

<template>
  <div class="flex min-h-dvh flex-col bg-muted">
    <header class="phone-safe-top shrink-0 border-b border-default/80 bg-default px-4 py-3 md:px-8">
      <div class="mx-auto flex w-full max-w-3xl items-center justify-between gap-4">
        <NuxtLink :to="`/review/${studentNumber}`" class="inline-flex min-h-11 items-center text-sm font-medium text-brand-700 underline underline-offset-4 md:min-h-0">
          Back to the review
        </NuxtLink>
      </div>
    </header>
    <main class="phone-safe-bottom mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 p-4 md:p-8">
      <p v-if="refused" role="alert" class="max-w-sm text-sm text-default">
        You can only review students enrolled in a course you own.
      </p>
      <p v-else-if="missing" role="alert" class="max-w-sm text-sm text-default">
        There is no such conversation.
      </p>
      <p v-else-if="unavailable" role="alert" class="max-w-sm text-sm text-default">
        This page is unavailable right now.
      </p>
      <template v-else-if="data">
        <section class="page-enter flex flex-col gap-1">
          <h1 class="text-xl font-semibold tracking-tight text-highlighted [overflow-wrap:anywhere]">
            {{ data.moduleName }}
          </h1>
          <p class="text-sm text-muted [overflow-wrap:anywhere]">
            {{ data.student.displayName }} · <span class="font-mono">{{ data.student.studentNumber }}</span> · times in UTC
          </p>
        </section>

        <p v-if="!rows.length" class="text-sm text-muted">
          No messages yet.
        </p>
        <ol v-else class="flex flex-col gap-4 rounded-lg border border-default bg-default p-3 shadow-xs md:p-4" data-testid="review-conversation">
          <template v-for="row in rows" :key="row.id">
            <li v-if="row.day" class="flex w-full items-center gap-3" data-day-separator>
              <span class="h-px flex-1 bg-ink-200" aria-hidden="true" />
              <span class="text-[11px] leading-4 font-medium text-ink-500">{{ row.day }}</span>
              <span class="h-px flex-1 bg-ink-200" aria-hidden="true" />
            </li>
            <li
              class="flex w-full"
              :class="row.author === 'event' ? 'justify-center' : row.author === 'student' ? 'justify-end' : 'justify-start'"
              :data-author="row.author"
            >
              <p v-if="row.author === 'event'" :class="eventClass" class="whitespace-pre-wrap [overflow-wrap:anywhere]">
                System · {{ row.text }}<template v-if="row.sentAt">
                  · <time :datetime="row.sentAt">{{ row.time }}</time></template>
              </p>
              <div v-else class="flex max-w-[96%] items-start gap-3" :class="row.author === 'student' ? 'flex-row-reverse' : 'flex-row'">
                <span class="mt-0.5 size-11 shrink-0 overflow-hidden rounded-[4px] border" :class="portraitClass[row.author]" aria-hidden="true">
                  <img :src="portraitSrc[row.author]" alt="" class="size-full object-cover [image-rendering:pixelated]">
                </span>
                <article class="w-fit max-w-full min-w-0 text-[13px] leading-5 break-words" :class="bubbleClass[row.author]">
                  <p class="mb-0.5 flex items-baseline gap-1.5">
                    <span class="text-[12px] leading-4 font-semibold" :class="nameClass[row.author]">
                      {{ row.author === 'student' ? data.student.displayName : speakers[row.author] }}
                    </span>
                    <time v-if="row.sentAt" :datetime="row.sentAt" class="ml-auto pl-2 font-mono text-[10px] leading-4 opacity-60">{{ row.time }}</time>
                  </p>
                  <p v-if="row.author === 'student'" class="whitespace-pre-wrap">
                    {{ row.text }}
                  </p>
                  <ChatMarkdown v-else :text="row.text" :writing="false" />
                </article>
              </div>
            </li>
          </template>
        </ol>
      </template>
    </main>
  </div>
</template>
