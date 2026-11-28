import type { Campus } from './campus'
import type { CourseProgress } from './course-progress'
import type { ModuleState, PracticeTestResult } from './turn'

// What the staff review page shows about one student. Staff read it; a student
// never does. Review signals are worked out when the page opens and are never
// stored (ADR 0009).

export interface ReviewedStudent {
  displayName: string
  studentNumber: string
  campus: Campus | null
  email: string
}

export interface ReviewEvent {
  id: number
  type: string
  time: string
  payload: Record<string, unknown>
}

export interface ReviewSubmission {
  id: string
  moduleId: string
  exerciseId: string
  code: string
  results: PracticeTestResult[]
  outcome: 'passed' | 'failed' | 'refused'
  message: string | null
  time: string
}

export interface ReviewMessage {
  id: string
  sequence: number
  author: 'student' | 'teacher' | 'deskmate' | 'event'
  text: string
  exerciseId: string
  time: string | null
}

// One module's conversation as the review lists it; its messages are read on a page of their own.
export interface ReviewConversationSummary {
  moduleId: string
  moduleName: string
  messageCount: number
  // When the latest message was sent; null when no message kept a time.
  latestAt: string | null
}

// One module's conversation with a student, every message oldest first.
export interface StaffConversation {
  student: ReviewedStudent
  moduleId: string
  moduleName: string
  messages: ReviewMessage[]
}

export type ReviewSignalKind = 'large_paste_then_pass' | 'pass_without_run'

// Something for a person to look at. It never says what the student meant.
export interface ReviewSignal {
  kind: ReviewSignalKind
  moduleId: string | null
  exerciseId: string
  summary: string
  // The activity events behind it, oldest first, so the page can link to each.
  eventIds: number[]
}

export interface ReviewPlanStep {
  kind: string
  // The step in words, read from the module content; the step's ref when the
  // module no longer has it.
  title: string
}

// One revision of a plan. Revisions are append-only, so the list is the plan's history.
export interface ReviewPlanRevision {
  revision: number
  steps: ReviewPlanStep[]
  currentStep: number
  agreedAt: string | null
  time: string
  // What brought this revision about; null for a first proposal.
  trigger: string | null
}

export interface ReviewPlan {
  moduleId: string
  // The module's name; its id when the course no longer has it.
  moduleName: string
  // Oldest first; the last is the plan in force.
  revisions: ReviewPlanRevision[]
}

// The whole learning pattern, including the habits the student never sees: the
// student sees only the weak spots, in plain words.
export interface ReviewLearningPattern {
  weakSpots: readonly { misconceptionId: string, count: number, lastSeen: string }[]
  recurringErrors: readonly { kind: string, count: number }[]
  exerciseAttempts: readonly { exerciseId: string, attempts: number, passed: boolean }[]
  hintRungs: readonly { moduleId: string, rungs: readonly number[] }[]
  materialsSeconds: readonly { moduleId: string, seconds: number }[]
}

// One module's stored mastery (ADR 0008) as the owning lecturer sees it (ADR 0013).
export interface ReviewModuleMastery {
  moduleId: string
  name: string
  mastery: number
  state: ModuleState
}

// The Course progress section: the student's progress over every module the course lists, and each module's mastery.
export interface ReviewMastery {
  progress: CourseProgress
  // In course order.
  modules: ReviewModuleMastery[]
}

export interface StaffReview {
  student: ReviewedStudent
  courseId: string
  // The most recent activity, newest first.
  activity: ReviewEvent[]
  submissions: ReviewSubmission[]
  // Newest first.
  conversations: ReviewConversationSummary[]
  signals: ReviewSignal[]
  plans: ReviewPlan[]
  learningPattern: ReviewLearningPattern
  // For the owning lecturer only; an administrator's review has none (ADR 0013).
  mastery?: ReviewMastery
}

export interface StaffAccessEntry {
  id: number
  time: string
  actorEmail: string
  actorRole: 'administrator' | 'lecturer'
  studentId: string
  studentNumber: string | null
  opened: 'student_review' | 'student_conversation'
  courseId: string | null
  // The module whose conversation was opened; null for a review.
  moduleId: string | null
  // That module's name, filled in for the administrator's page.
  moduleName: string | null
}
