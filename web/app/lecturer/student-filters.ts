import type { Campus } from '#shared/campus'
import type { LecturerCourse, LecturerStudent } from '#shared/lecturer'
import { moduleStateOf, progressGroupOf, type ProgressGroupKey } from './course-overview'

// The filters the lecturer's Overview and Insights tabs share. They run on the page.

// The module a student stands on: the first one open to them, or null with none open.
export function currentModule(modules: LecturerCourse['modules'], student: LecturerStudent): string | null {
  return modules.find(module => moduleStateOf(student, module.id) === 'open')?.id ?? null
}

// The module filter's value for students with no module open.
export const noModuleOpen = 'none'

// A tab's filters; an empty value leaves that one off.
export interface StudentFilterValues {
  search: string
  campus: Campus | ''
  group: ProgressGroupKey | ''
  // A module id, or noModuleOpen.
  moduleId: string
}

export const noFilters: StudentFilterValues = { search: '', campus: '', group: '', moduleId: '' }

export function filterStudents(
  modules: LecturerCourse['modules'],
  students: readonly LecturerStudent[],
  { search, campus, group, moduleId }: StudentFilterValues,
): LecturerStudent[] {
  const term = search.trim().toLowerCase()
  return students.filter(student =>
    (campus === '' || student.campus === campus)
    && (term === '' || student.displayName.toLowerCase().includes(term) || student.studentNumber.toLowerCase().includes(term))
    && (group === '' || progressGroupOf(student.progress.percent) === group)
    && (moduleId === '' || (currentModule(modules, student) ?? noModuleOpen) === moduleId))
}

export function isFiltering(filters: StudentFilterValues): boolean {
  return Object.values(filters).some(value => value !== '')
}
