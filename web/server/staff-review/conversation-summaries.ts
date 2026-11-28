import type { ReviewConversationSummary } from '../../shared/staff-review'
import type { ReviewConversation } from '../storage/staff-review-store'
import { moduleName, type Course } from '../course'

// One row per conversation, without its messages, the latest talked in first.
export function conversationSummaries(conversations: readonly ReviewConversation[], course: Course): ReviewConversationSummary[] {
  return conversations
    .map(({ moduleId, messages }) => ({
      moduleId,
      moduleName: moduleName(course, moduleId),
      messageCount: messages.length,
      latestAt: latestTime(messages),
    }))
    .sort((left, right) => sortTime(right.latestAt) - sortTime(left.latestAt))
}

// A conversation with no kept time sorts last.
function sortTime(time: string | null): number {
  return time === null ? 0 : Date.parse(time)
}

function latestTime(messages: ReviewConversation['messages']): string | null {
  return messages.reduce<string | null>((latest, { time }) =>
    time !== null && sortTime(time) > sortTime(latest) ? time : latest, null)
}
