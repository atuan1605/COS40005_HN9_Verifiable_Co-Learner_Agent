import type { Campus } from './campus'
import type { CourseProgress } from './course-progress'
import type { ExerciseCheck, ModuleMaterials, ModuleState } from './turn'

export interface CourseHistoryEntry {
  action: string
  actorEmail: string
  time: string
  previousThreshold?: number
  masteryThreshold?: number
}

export interface LecturerStudent {
  displayName: string
  studentNumber: string
  campus: Campus | null
  email: string
  enrolledAt: string
  // Derived from the student's stored mastery for this course (ADR 0013); never stored.
  progress: CourseProgress
  // Each listed module's state by module id, from the same standings as progress (Course insights).
  moduleStates: Record<string, ModuleState>
}

export interface LecturerCourse {
  id: string
  title: string
  enrolledCount: number
  masteryThreshold: number
  history: CourseHistoryEntry[]
  // Every module the course lists, in course order.
  modules: { id: string, name: string }[]
  students: LecturerStudent[]
}

export interface LecturerResponse {
  courses: LecturerCourse[]
}

export interface CoursePreviewModule {
  id: string
  name: string
  part: string
  summary: string
  available: boolean
  materials: ModuleMaterials
  quiz: {
    id: string
    prompt: string
    choices: readonly [string, string, string, string]
    correctIndex: 0 | 1 | 2 | 3
    explanation: string
    teacherOnly: true
  }[]
  exercises: {
    id: string
    title: string
    statement: string
    starterCode: string
    tests: readonly [ExerciseCheck, ExerciseCheck, ExerciseCheck]
  }[]
  hintLadder: { rungs: readonly [string, string, string], teacherOnly: true } | null
  misconceptionResponses: { id: string, response: string, teacherOnly: true }[]
}

export interface CoursePreview {
  courseId: string
  title: string
  draft: boolean
  modules: CoursePreviewModule[]
}
