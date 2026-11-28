import type { StaffConversation } from '../../shared/staff-review'
import type { StaffAccessLog } from '../storage/staff-access-log'
import type { CourseStore } from '../storage/course-store'
import { moduleName } from './conversation-summaries'
import { reviewAccess, StaffReviewError, type ReviewAccessRequest } from './review-access'

export interface StaffConversationRequest extends ReviewAccessRequest {
  moduleId: string
  accessLog: StaffAccessLog
  courses: CourseStore
}

// One module's conversation with a student for a member of staff, under the same rule as the review,
// every message oldest first. The opening is written to the staff access log, with the module, before
// any message is read.
export async function handleStaffConversation(request: StaffConversationRequest): Promise<StaffConversation> {
  const { email, student, actorRole, courseId } = await reviewAccess(request)
  const moduleId = request.moduleId.trim()
  const course = await request.courses.course(courseId)
  // A published spec may drop a module the student has already talked in; the review still lists it.
  if (!course.modules.some(module => module.id === moduleId)
    && !await request.store.hasConversation(student.id, courseId, moduleId)) {
    throw new StaffReviewError(404, 'Module not found')
  }

  await request.accessLog.record({ actorEmail: email, actorRole, studentId: student.id, courseId, opened: 'student_conversation', moduleId })

  const conversations = await request.store.conversations(student.id, courseId, moduleId)
  const messages = conversations.find(conversation => conversation.moduleId === moduleId)?.messages ?? []
  return {
    student: { displayName: student.displayName, studentNumber: student.studentNumber, campus: student.campus, email: student.email },
    moduleId,
    moduleName: moduleName(course, moduleId),
    messages: [...messages].sort((left, right) => left.sequence - right.sequence),
  }
}
