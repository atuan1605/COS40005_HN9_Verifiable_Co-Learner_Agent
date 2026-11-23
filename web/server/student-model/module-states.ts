import type { ModuleState } from '../../shared/turn'
import { estimateCourse, type CourseEstimate, type StudiedCourse } from './course-standing'
import type { TimedObservation } from './evidence-store'
import { masteryFromEvidence, storedCourseEstimate, type StoredMastery } from './mastery-store'

// A course as module states need it: the course, and the earlier threshold whose unlocks were
// kept when the threshold rose (ADR 0005: an unlock is permanent).
export interface UnlockingCourse extends StudiedCourse {
  legacyUnlocks?: { before: string, threshold: number }
}

// The modules unlocked under the earlier threshold by evidence from before the change.
export function legacyUnlocksFor(course: UnlockingCourse, evidence: readonly TimedObservation[]): string[] {
  if (!course.legacyUnlocks) return []
  const { before, threshold } = course.legacyUnlocks
  const earlier = evidence.filter(row => Date.parse(row.time) < Date.parse(before))
  return [...estimateCourse({ ...course, masteryThreshold: threshold }, earlier).unlockedModuleIds]
}

// The one rule for a module's state on the roadmap: closed until unlocked, mastered at the
// threshold with a passed exercise, open otherwise.
export function moduleState(course: StudiedCourse, moduleId: string, estimate: CourseEstimate): ModuleState {
  if (!estimate.unlockedModuleIds.includes(moduleId)) return 'closed'
  const mastery = estimate.masteries.find(item => item.moduleId === moduleId)?.mastery ?? 0
  return mastery >= course.masteryThreshold && estimate.passedExerciseModuleIds.includes(moduleId) ? 'mastered' : 'open'
}

export interface ModuleStanding {
  moduleId: string
  mastery: number
  state: ModuleState
}

// Each module's mastery and state as the student's roadmap shows it, for a reader who only reads
// (the lecturer's screens). Incomplete stored rows are rebuilt from evidence, as readStoredMastery
// does, without writing; recorded and legacy unlocks open modules as they do for the student.
export function moduleStandings(course: UnlockingCourse, sources: {
  stored: readonly StoredMastery[]
  evidence: readonly TimedObservation[]
  recordedUnlocks: readonly string[]
}): ModuleStanding[] {
  const complete = course.modules.every(module => sources.stored.some(row => row.moduleId === module.id))
  const rows = complete ? sources.stored : masteryFromEvidence(course, sources.evidence)
  const estimate = storedCourseEstimate(course, rows, [...sources.recordedUnlocks, ...legacyUnlocksFor(course, sources.evidence)])
  return course.modules.map(module => ({
    moduleId: module.id,
    mastery: estimate.masteries.find(item => item.moduleId === module.id)?.mastery ?? 0,
    state: moduleState(course, module.id, estimate),
  }))
}

// Whether a reader needs the ledger at all: only to rebuild missing rows or replay legacy unlocks.
export function needsEvidence(course: UnlockingCourse, stored: readonly StoredMastery[]): boolean {
  return course.legacyUnlocks !== undefined
    || !course.modules.every(module => stored.some(row => row.moduleId === module.id))
}
