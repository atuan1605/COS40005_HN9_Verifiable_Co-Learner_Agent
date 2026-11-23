import { evidenceTheCourseHas, type CourseEstimate, type StudiedCourse } from './course-standing'
import { estimateMastery, unlockedModuleIds, type ModuleMastery, type Observation } from './estimate'
import { masteryParametersFor } from './mastery-parameters'

// The stored copy of the estimate (ADR 0008): one row per student, course and module, written only
// by the server and read by everything that shows or judges mastery. It stays derived from evidence;
// nothing outside a recompute from the ledger writes it.
export type StoredMastery = ModuleMastery

export interface MasteryStore {
  forStudent: (studentId: string) => Promise<StoredMastery[]>
  // Replaces the student's whole picture with these rows, so a module the course no longer
  // has leaves no row behind.
  save: (studentId: string, masteries: readonly StoredMastery[]) => Promise<StoredMastery[]>
}

export function createMemoryMasteryStore(): MasteryStore {
  const byStudent = new Map<string, StoredMastery[]>()
  const copy = (rows: readonly StoredMastery[]) => rows.map(row => ({ ...row }))

  return {
    async forStudent(studentId) {
      return copy(byStudent.get(studentId) ?? [])
    },
    async save(studentId, masteries) {
      const rows = copy(masteries)
      byStudent.set(studentId, rows)
      return copy(rows)
    },
  }
}

// What the stored rows say about the course. Rows for modules the course no longer has are left out,
// and a module opens because its stored row says it was ever mastered, or because it was recorded.
export function storedCourseEstimate(
  course: StudiedCourse,
  stored: readonly StoredMastery[],
  recordedUnlocks: readonly string[] = [],
): CourseEstimate {
  const estimates = course.modules
    .map(module => stored.find(item => item.moduleId === module.id))
    .filter((item): item is StoredMastery => item !== undefined)
  const unlocked = new Set([...recordedUnlocks, ...unlockedModuleIds(course.modules, estimates)])

  return {
    masteries: estimates.map(item => ({ moduleId: item.moduleId, mastery: item.mastery })),
    unlockedModuleIds: course.modules
      .filter(module => module.available && unlocked.has(module.id))
      .map(module => module.id),
    passedExerciseModuleIds: estimates.filter(item => item.passedExercise).map(item => item.moduleId),
  }
}

// The one way the stored picture changes: run the estimate over the ledger and save what it gives.
export async function saveMasteryFromEvidence(
  course: StudiedCourse,
  evidence: readonly Observation[],
  studentId: string,
  store: MasteryStore,
): Promise<StoredMastery[]> {
  return store.save(studentId, masteryFromEvidence(course, evidence))
}

// The rows the estimate gives over the ledger, before anything stores them.
export function masteryFromEvidence(course: StudiedCourse, evidence: readonly Observation[]): StoredMastery[] {
  return estimateMastery(
    evidenceTheCourseHas(course, evidence),
    course.modules.map(module => module.id),
    masteryParametersFor(course.masteryThreshold),
  )
}

// The stored rows for this student, rebuilt from evidence and saved first when a module of the
// course has no row yet. A complete picture is read as it stands, however it came to be.
export async function readStoredMastery(
  course: StudiedCourse,
  evidence: readonly Observation[],
  studentId: string,
  store: MasteryStore,
): Promise<StoredMastery[]> {
  const stored = await store.forStudent(studentId)
  const everyModuleStored = course.modules.every(module => stored.some(item => item.moduleId === module.id))
  if (everyModuleStored) return stored
  return saveMasteryFromEvidence(course, evidence, studentId, store)
}
