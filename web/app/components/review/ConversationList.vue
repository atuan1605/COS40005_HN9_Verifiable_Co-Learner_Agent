<script setup lang="ts">
import type { ReviewConversationSummary } from '#shared/staff-review'
import { timeText } from '~/staff/time-text'

// The student's conversations, one collapsed row per module; each row opens the conversation's own page.
defineProps<{
  studentNumber: string
  conversations: ReviewConversationSummary[]
}>()
</script>

<template>
  <section aria-labelledby="conversation-heading" class="flex flex-col gap-3" data-testid="review-conversations">
    <h2 id="conversation-heading" class="text-base font-semibold text-highlighted">
      Conversations
    </h2>
    <p v-if="!conversations.length" class="text-sm text-muted">
      No conversation yet.
    </p>
    <ul v-else class="flex flex-col divide-y divide-default overflow-hidden rounded-lg border border-default bg-default text-sm shadow-xs">
      <li v-for="conversation in conversations" :key="conversation.moduleId">
        <NuxtLink
          :to="`/review/${studentNumber}/conversations/${conversation.moduleId}`"
          class="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 hover:bg-brand-50"
        >
          <span class="min-w-0 flex-1 font-medium text-brand-700 [overflow-wrap:anywhere]">{{ conversation.moduleName }}</span>
          <span class="text-muted">{{ conversation.messageCount }} {{ conversation.messageCount === 1 ? 'message' : 'messages' }}</span>
          <time :datetime="conversation.latestAt ?? undefined" class="text-xs text-muted">{{ timeText(conversation.latestAt) }}</time>
        </NuxtLink>
      </li>
    </ul>
  </section>
</template>
