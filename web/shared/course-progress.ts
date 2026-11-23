import type { ModuleState } from './turn'

// How far a student is through a course: mastered modules out of the modules
// that have content, so 100% is reachable. Derived from stored mastery and never
// stored; the student's roadmap and the lecturer's screens both use it.
export interface CourseProgress {
  mastered: number
  total: number
  // Whole percentage points, rounded down so it never reads 100% early.
  percent: number
}

export interface ProgressModule {
  // False for a module the course spec lists without content.
  available: boolean
  state: ModuleState
}

export function courseProgress(modules: readonly ProgressModule[]): CourseProgress {
  const withContent = modules.filter(module => module.available)
  const mastered = withContent.filter(module => module.state === 'mastered').length
  const total = withContent.length
  const percent = total === 0 ? 0 : Math.floor((mastered * 100) / total)
  return { mastered, total, percent }
}
