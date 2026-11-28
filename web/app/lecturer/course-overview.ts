import type { LecturerCourse, LecturerStudent } from '#shared/lecturer'
import type { ModuleState } from '#shared/turn'
import { moduleStatusOrder } from './course-insights'

// The figures and shapes the lecturer's Overview draws, derived from the lecturer response.

export function classSummary(students: readonly LecturerStudent[]) {
  const total = students.reduce((sum, student) => sum + student.progress.percent, 0)
  return {
    students: students.length,
    averagePercent: students.length ? Math.floor(total / students.length) : 0,
    finished: students.filter(student => student.progress.percent === 100).length,
  }
}

const groups = [
  { key: 'not-started', label: 'Not started (0%)', from: 0, to: 0 },
  { key: 'starting', label: 'Starting (1–29%)', from: 1, to: 29 },
  { key: 'part-way', label: 'Part way (30–69%)', from: 30, to: 69 },
  { key: 'nearly-there', label: 'Nearly there (70–100%)', from: 70, to: 100 },
] as const

export type ProgressGroupKey = typeof groups[number]['key']

export function progressGroups(students: readonly LecturerStudent[]) {
  return groups.map(({ key, label, from, to }) => ({
    key,
    label,
    count: students.filter(({ progress }) => progress.percent >= from && progress.percent <= to).length,
  }))
}

export function moduleStateOf(student: LecturerStudent, moduleId: string): ModuleState {
  return student.moduleStates[moduleId] ?? 'closed'
}

// Every listed module of every student, counted by state.
export function moduleStateTotals(modules: LecturerCourse['modules'], students: readonly LecturerStudent[]) {
  return moduleStatusOrder.map(state => ({
    state,
    count: students.reduce((sum, student) =>
      sum + modules.filter(module => moduleStateOf(student, module.id) === state).length, 0),
  }))
}

// An SVG path in a 100 by 100 box, between two turns of the circle: 0 is twelve o'clock and 1 is
// all the way round. An inner radius of 0 gives a pie slice, otherwise a ring segment.
export function ringSegment(from: number, to: number, outer: number, inner: number): string {
  // An arc that ends where it starts draws nothing, so a whole turn stops just short.
  const end = Math.min(to, from + 0.9999)
  const point = (turn: number, radius: number) => {
    const angle = turn * 2 * Math.PI - Math.PI / 2
    return `${round(50 + radius * Math.cos(angle))} ${round(50 + radius * Math.sin(angle))}`
  }
  const large = end - from > 0.5 ? 1 : 0
  const edge = `${point(from, outer)} A ${outer} ${outer} 0 ${large} 1 ${point(end, outer)}`
  if (inner === 0) return `M 50 50 L ${edge} Z`
  return `M ${edge} L ${point(end, inner)} A ${inner} ${inner} 0 ${large} 0 ${point(from, inner)} Z`
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}
