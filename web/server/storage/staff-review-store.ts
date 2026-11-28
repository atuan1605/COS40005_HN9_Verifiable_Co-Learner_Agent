import type { LearningPlan } from '../learning-plan'
import type { StoredMastery } from '../student-model'
import type {
  ReviewedStudent,
  ReviewEvent,
  ReviewMessage,
  ReviewSubmission,
} from '../../shared/staff-review'

// What the review page reads about one student. Every read here runs with the
// server's secret key, so who may call it is decided before it, in the
// staff-review component, never by this store.

export interface StaffReviewStudent extends ReviewedStudent {
  id: string
}

export interface ReviewConversation {
  moduleId: string
  messages: ReviewMessage[]
}

export interface StaffReviewStore {
  studentByNumber: (studentNumber: string) => Promise<StaffReviewStudent | null>
  // The course this lecturer owns that the student is enrolled in, or null.
  ownedCourseOf: (lecturerEmail: string, studentId: string) => Promise<string | null>
  // The student's activity in the course, oldest first.
  activity: (studentId: string, courseId: string) => Promise<ReviewEvent[]>
  submissions: (studentId: string, courseId: string) => Promise<ReviewSubmission[]>
  // Every message of the student's conversations in the course, or of one module's alone.
  conversations: (studentId: string, courseId: string, moduleId?: string) => Promise<ReviewConversation[]>
  // Whether the student has a conversation in the module. It reads no message.
  hasConversation: (studentId: string, courseId: string, moduleId: string) => Promise<boolean>
  // Every revision of every plan, oldest first.
  learningPlans: (studentId: string, courseId: string) => Promise<LearningPlan[]>
  // The student's stored mastery rows in the course (ADR 0008). Read only for the owning lecturer (ADR 0013).
  masteries: (studentId: string, courseId: string) => Promise<StoredMastery[]>
  // The modules recorded as unlocked for the student in the course (ADR 0005), read with mastery.
  unlocks: (studentId: string, courseId: string) => Promise<string[]>
}

export interface MemoryStaffReviewData {
  students: readonly StaffReviewStudent[]
  // Lecturer email -> course -> enrolled student ids.
  courses: readonly { id: string, ownerEmail: string, enrolled: readonly string[] }[]
  activity?: Readonly<Record<string, readonly ReviewEvent[]>>
  submissions?: Readonly<Record<string, readonly ReviewSubmission[]>>
  learningPlans?: Readonly<Record<string, readonly LearningPlan[]>>
  conversations?: Readonly<Record<string, readonly ReviewConversation[]>>
  masteries?: Readonly<Record<string, readonly StoredMastery[]>>
  unlocks?: Readonly<Record<string, readonly string[]>>
}

export function createMemoryStaffReviewStore(data: MemoryStaffReviewData): StaffReviewStore {
  return {
    async studentByNumber(studentNumber) {
      const student = data.students.find(candidate => candidate.studentNumber === studentNumber)
      return student ? { ...student } : null
    },
    async ownedCourseOf(lecturerEmail, studentId) {
      const course = data.courses.find(candidate => candidate.ownerEmail === lecturerEmail && candidate.enrolled.includes(studentId))
      return course?.id ?? null
    },
    async activity(studentId) {
      return (data.activity?.[studentId] ?? []).map(event => ({ ...event, payload: { ...event.payload } }))
    },
    async submissions(studentId) {
      return (data.submissions?.[studentId] ?? []).map(submission => ({ ...submission }))
    },
    async learningPlans(studentId) {
      return (data.learningPlans?.[studentId] ?? []).map(plan => ({ ...plan, steps: plan.steps.map(step => ({ ...step })) }))
    },
    async masteries(studentId) {
      return (data.masteries?.[studentId] ?? []).map(row => ({ ...row }))
    },
    async unlocks(studentId) {
      return [...(data.unlocks?.[studentId] ?? [])]
    },
    async hasConversation(studentId, _courseId, moduleId) {
      return (data.conversations?.[studentId] ?? []).some(conversation => conversation.moduleId === moduleId)
    },
    async conversations(studentId, _courseId, moduleId) {
      return (data.conversations?.[studentId] ?? []).filter(conversation => moduleId === undefined || conversation.moduleId === moduleId).map(conversation => ({
        moduleId: conversation.moduleId,
        messages: conversation.messages.map(message => ({ ...message })),
      }))
    },
  }
}
