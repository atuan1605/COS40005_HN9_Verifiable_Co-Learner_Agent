import type { LecturerCourse, LecturerStudent } from '#shared/lecturer'
import { moduleStateOf } from './course-overview'
import { currentModule, noModuleOpen } from './student-filters'

// What the Insights tab shows, derived from the lecturer response. Nothing is stored or requested.

export function studentCountText(count: number): string {
  return `${count} ${count === 1 ? 'student' : 'students'}`
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

// Where students can be on the course path: every module in order, then having none open.
export function pathStops(path: ReturnType<typeof coursePath>): PathStop[] {
  return [
    ...path.modules,
    { id: noModuleOpen, name: 'No module open', number: null, mastered: null, here: path.noneOpen },
  ]
}

export interface PathStop {
  id: string
  name: string
  // Null, as is mastered, for the stop that is not a module.
  number: number | null
  mastered: number | null
  here: LecturerStudent[]
}

// The stop with the most students, the earlier one when equal.
export function busiestStop(stops: readonly PathStop[]): PathStop | undefined {
  return stops.reduce<PathStop | undefined>((most, stop) => !most || stop.here.length > most.here.length ? stop : most, undefined)
}

const studentsPerPage = 10

// A page, counted from 1, of the students at one stop, with the places it covers in the whole list.
export function studentPage(students: readonly LecturerStudent[], wanted: number) {
  const pageCount = Math.max(1, Math.ceil(students.length / studentsPerPage))
  const page = Math.min(Math.max(1, wanted), pageCount)
  const start = (page - 1) * studentsPerPage
  const shown = students.slice(start, start + studentsPerPage)
  return { page, pageCount, from: shown.length ? start + 1 : 0, to: start + shown.length, students: shown }
}

// Up to this many pages are all listed.
const allListed = 7

// The page numbers to offer; null stands for the ones left out.
export function pageNumbers(page: number, pageCount: number): (number | null)[] {
  const every = Array.from({ length: pageCount }, (_, index) => index + 1)
  if (pageCount <= allListed) return every
  const kept = every.filter(number => number === 1 || number === pageCount || Math.abs(number - page) <= 1)
  return kept.flatMap((number, index) => index && number - kept[index - 1]! > 1 ? [null, number] : [number])
}
