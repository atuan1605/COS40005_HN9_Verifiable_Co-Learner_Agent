import type { Campus } from '#shared/campus'
import type { LecturerCourse, LecturerStudent } from '#shared/lecturer'
import { moduleStateOf, progressGroupOf, type ProgressGroupKey } from './course-overview'

// What the Insights tab shows, derived from the lecturer response. Nothing is stored or requested.

export function studentCountText(count: number): string {
  return `${count} ${count === 1 ? 'student' : 'students'}`
}

// The module a student stands on: the first one open to them, or null with none open.
function currentModule(modules: LecturerCourse['modules'], student: LecturerStudent): string | null {
  return modules.find(module => moduleStateOf(student, module.id) === 'open')?.id ?? null
}

// The module filter's value for students with no module open.
export const noModuleOpen = 'none'

// The tab's filters; an empty value leaves that one off.
export interface InsightsFilters {
  search: string
  campus: Campus | ''
  group: ProgressGroupKey | ''
  // A module id, or noModuleOpen.
  moduleId: string
}

export const noFilters: InsightsFilters = { search: '', campus: '', group: '', moduleId: '' }

export function filterStudents(
  modules: LecturerCourse['modules'],
  students: readonly LecturerStudent[],
  { search, campus, group, moduleId }: InsightsFilters,
): LecturerStudent[] {
  const term = search.trim().toLowerCase()
  return students.filter(student =>
    (campus === '' || student.campus === campus)
    && (term === '' || student.displayName.toLowerCase().includes(term) || student.studentNumber.toLowerCase().includes(term))
    && (group === '' || progressGroupOf(student.progress.percent) === group)
    && (moduleId === '' || (currentModule(modules, student) ?? noModuleOpen) === moduleId))
}

// The course as a path: each student stands on the first module that is open to them. A student
// with none open, having mastered everything they can open, is listed apart.
export function coursePath(modules: LecturerCourse['modules'], students: readonly LecturerStudent[]) {
  const standing = students.map(student => ({ student, moduleId: currentModule(modules, student) }))
  const on = (moduleId: string | null) => standing.filter(item => item.moduleId === moduleId).map(item => item.student)
  return {
    modules: modules.map(({ id, name }, index) => ({
      id,
      name,
      number: index + 1,
      here: on(id),
      mastered: students.filter(student => moduleStateOf(student, id) === 'mastered').length,
    })),
    noneOpen: on(null),
  }
}

// The students with the least Course progress, leaving out those who have finished the course.
export function furthestBehind(students: readonly LecturerStudent[], most: number): LecturerStudent[] {
  return students
    .filter(student => student.progress.percent < 100)
    .sort((left, right) => left.progress.percent - right.progress.percent || left.displayName.localeCompare(right.displayName, 'en'))
    .slice(0, most)
}
