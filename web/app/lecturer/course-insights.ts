import type { Campus } from '#shared/campus'
import type { LecturerCourse, LecturerStudent } from '#shared/lecturer'
import type { ModuleState } from '#shared/turn'

// What the Insights tab draws, derived from the lecturer response. Nothing is stored or requested.

export const moduleStatusOrder: readonly ModuleState[] = ['mastered', 'open', 'closed']

// The percentage of the bar the smallest occupied segment keeps, so it can still be pointed at.
const smallestWidth = 4

export interface ModuleStatusSegment {
  state: ModuleState
  students: LecturerStudent[]
  // Percentages of the bar.
  start: number
  width: number
}

export interface ModuleStatusRow {
  moduleId: string
  name: string
  // Always mastered, open, closed.
  segments: ModuleStatusSegment[]
}

export function studentCountText(count: number): string {
  return `${count} ${count === 1 ? 'student' : 'students'}`
}

// The tab's campus filter; empty is All campuses.
export function studentsAtCampus(students: readonly LecturerStudent[], campus: Campus | ''): LecturerStudent[] {
  return students.filter(student => campus === '' || student.campus === campus)
}

export function moduleStatus(modules: LecturerCourse['modules'], students: readonly LecturerStudent[]): ModuleStatusRow[] {
  return modules.map(({ id, name }) => {
    const groups = moduleStatusOrder.map(state => ({
      state,
      students: students.filter(student => (student.moduleStates[id] ?? 'closed') === state),
    }))
    const widths = segmentWidths(groups.map(group => group.students.length))
    let start = 0
    return {
      moduleId: id,
      name,
      segments: groups.map((group, index) => {
        const segment = { ...group, start, width: widths[index]! }
        start += segment.width
        return segment
      }),
    }
  })
}

// Bands of whole percentage points, as Course progress is, so each student falls in exactly one.
const progressRanges = [[0, 19], [20, 39], [40, 59], [60, 79], [80, 100]] as const

export interface ProgressBand {
  label: string
  students: LecturerStudent[]
}

// The Course progress distribution: always every band, lowest first.
export function progressBands(students: readonly LecturerStudent[]): ProgressBand[] {
  return progressRanges.map(([from, to]) => ({
    label: `${from}–${to}%`,
    students: students.filter(({ progress }) => progress.percent >= from && progress.percent <= to),
  }))
}

// Widths by share, except that an occupied segment never drops below the smallest width: what it
// gains is taken from the others in proportion.
function segmentWidths(counts: readonly number[]): number[] {
  const total = counts.reduce((sum, count) => sum + count, 0)
  if (total === 0) return counts.map(() => 0)
  const shares = counts.map(count => (count * 100) / total)
  const small = shares.map(share => share > 0 && share < smallestWidth)
  const reserved = small.filter(Boolean).length * smallestWidth
  const rest = shares.reduce((sum, share, index) => small[index] ? sum : sum + share, 0)
  return shares.map((share, index) => small[index] ? smallestWidth : (share * (100 - reserved)) / rest)
}
