import type { LecturerCourse, LecturerStudent } from '../../shared/lecturer'
import type { CourseSpec } from '../course'
import type { StoredMastery } from '../student-model'

// What the store reads for an owned course: the enrolled students with their stored mastery rows and
// recorded unlocks, so the handler can derive each student's Course progress (ADR 0013). The id is
// for reading the student's evidence and is not sent.
export interface LecturerCourseRecord extends Omit<LecturerCourse, 'students'> {
  students: (Omit<LecturerStudent, 'progress'> & { id: string, masteries: StoredMastery[], unlocks: string[] })[]
}

type SeededCourse = Omit<LecturerCourse, 'students'> & {
  ownerEmail: string
  spec?: CourseSpec
  draft?: CourseSpec | null
  students: (Omit<LecturerStudent, 'progress'> & { id?: string, masteries?: StoredMastery[], unlocks?: string[] })[]
}

export interface LecturerStore {
  forLecturer: (email: string) => Promise<LecturerCourseRecord[]>
  setThreshold: (email: string, courseId: string, threshold: number) => Promise<boolean>
  exportSpec: (email: string, courseId: string) => Promise<CourseSpec | null>
  importSpec: (email: string, spec: CourseSpec) => Promise<boolean>
  readDraft: (email: string, courseId: string) => Promise<CourseSpec | null>
  saveDraft: (email: string, courseId: string, spec: CourseSpec) => Promise<boolean>
  discardDraft: (email: string, courseId: string) => Promise<boolean>
}

export function createMemoryLecturerStore(
  courses: readonly SeededCourse[],
): LecturerStore {
  const stored = courses.map(course => ({
    ...course,
    history: [...course.history],
    students: course.students.map(student => ({
      ...student,
      id: student.id ?? student.studentNumber,
      masteries: (student.masteries ?? []).map(row => ({ ...row })),
      unlocks: [...(student.unlocks ?? [])],
    })),
    draft: course.draft ? structuredClone(course.draft) : null,
  }))
  function owned(email: string, courseId: string) {
    return stored.find(item => item.ownerEmail === email && item.id === courseId)
  }
  return {
    async readDraft(email, courseId) {
      const draft = owned(email, courseId)?.draft
      return draft ? structuredClone(draft) : null
    },
    async saveDraft(email, courseId, spec) {
      const course = owned(email, courseId)
      if (!course || spec.courseId !== courseId) return false
      course.draft = structuredClone(spec)
      return true
    },
    async discardDraft(email, courseId) {
      const course = owned(email, courseId)
      if (!course) return false
      course.draft = null
      return true
    },
    async exportSpec(email, courseId) {
      const course = owned(email, courseId)
      return course?.spec ? structuredClone({ ...course.spec, masteryThreshold: course.masteryThreshold }) : null
    },
    async importSpec(email, spec) {
      const course = stored.find(item => item.ownerEmail === email && item.id === spec.courseId)
      if (!course) return false
      course.spec = structuredClone(spec)
      course.title = spec.title
      course.masteryThreshold = spec.masteryThreshold
      course.history.unshift({ action: 'course_spec_imported', actorEmail: email, time: new Date().toISOString() })
      return true
    },
    async forLecturer(email) {
      return stored.filter(course => course.ownerEmail === email)
        .map(({ id, title, enrolledCount, masteryThreshold, history, students }) => ({
          id,
          title,
          enrolledCount,
          masteryThreshold,
          history: history.map(entry => ({ ...entry })),
          students: students.map(student => ({ ...student, masteries: student.masteries.map(row => ({ ...row })), unlocks: [...student.unlocks] })),
        }))
    },
    async setThreshold(email, courseId, threshold) {
      const course = stored.find(item => item.ownerEmail === email && item.id === courseId)
      if (!course) return false
      if (course.masteryThreshold !== threshold) {
        course.history.unshift({
          action: 'mastery_threshold_changed',
          actorEmail: email,
          time: new Date().toISOString(),
          previousThreshold: course.masteryThreshold,
          masteryThreshold: threshold,
        })
        course.masteryThreshold = threshold
      }
      return true
    },
  }
}
