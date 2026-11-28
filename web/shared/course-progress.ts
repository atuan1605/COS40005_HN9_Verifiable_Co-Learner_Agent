import type { ModuleState } from './turn'

// How far a student is through a course: mastered modules out of every module
// the course lists, so 100% means the whole course. Derived from stored mastery
// and never stored; the student's roadmap and the lecturer's screens both use it.
export interface CourseProgress {
  mastered: number
  total: number
  // Whole percentage points, rounded down so it never reads 100% early.
  percent: number
}

export interface ProgressModule {
  state: ModuleState
}

export function courseProgress(modules: readonly ProgressModule[]): CourseProgress {
  const mastered = modules.filter(module => module.state === 'mastered').length
  const total = modules.length
  const percent = total === 0 ? 0 : Math.floor((mastered * 100) / total)
  return { mastered, total, percent }
}
