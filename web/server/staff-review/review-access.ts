import type { StaffAccessRole } from '../storage/staff-access-log'
import type { StaffReviewStore, StaffReviewStudent } from '../storage/staff-review-store'
import { defaultCourseId } from '../course'
import { staffRole } from '../staff/staff-role'

export class StaffReviewError extends Error {
  constructor(readonly statusCode: 401 | 403 | 404, message: string) {
    super(message)
    this.name = 'StaffReviewError'
  }
}

// Who is asking for which student's records.
export interface ReviewAccessRequest {
  email: string | null
  adminEmails: string
  lecturerEmails: string
  studentNumber: string
  store: StaffReviewStore
}

export interface ReviewAccess {
  email: string
  student: StaffReviewStudent
  actorRole: StaffAccessRole
  courseId: string
  ownsCourse: boolean
}

// The access rule of every reading of a student's records. An administrator may open any
// student; a lecturer only a student enrolled in a course they own; a student or a caller
// with no session none. It reads no record and writes nothing.
export async function reviewAccess(request: ReviewAccessRequest): Promise<ReviewAccess> {
  const email = request.email?.trim().toLowerCase() ?? ''
  if (email === '') throw new StaffReviewError(401, 'Sign in required')
  const role = staffRole({ email, adminEmails: request.adminEmails, lecturerEmails: request.lecturerEmails })
  if (!role.productOwner && !role.lecturer) throw new StaffReviewError(403, 'Staff access required')

  const student = await request.store.studentByNumber(request.studentNumber.trim())
  if (role.productOwner) {
    if (!student) throw new StaffReviewError(404, 'Student not found')
    // The Python course is the only course in sprint 2.
    const courseId = defaultCourseId
    // Owning the student's course grants the mastery view, whatever other role the person has (ADR 0013).
    const ownsCourse = role.lecturer && await request.store.ownedCourseOf(email, student.id) === courseId
    return { email, student, actorRole: 'administrator', courseId, ownsCourse }
  }
  // A student who does not exist and one who is not theirs are refused alike.
  const owned = student ? await request.store.ownedCourseOf(email, student.id) : null
  if (!student || owned === null) throw new StaffReviewError(403, 'That student is not enrolled in a course you own')
  return { email, student, actorRole: 'lecturer', courseId: owned, ownsCourse: true }
}
