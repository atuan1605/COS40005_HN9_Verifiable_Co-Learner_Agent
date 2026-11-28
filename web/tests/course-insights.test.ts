import { describe, expect, it } from 'vitest'
import { moduleStatus, studentsAtCampus } from '../app/lecturer/course-insights'
import type { LecturerStudent } from '../shared/lecturer'
import type { ModuleState } from '../shared/turn'

const student = (studentNumber: string, campus: LecturerStudent['campus'], moduleStates: Record<string, ModuleState>): LecturerStudent => ({
  displayName: studentNumber,
  studentNumber,
  campus,
  email: `${studentNumber}@example.com`,
  enrolledAt: '2026-11-14T08:00:00Z',
  progress: { mastered: 0, total: 2, percent: 0 },
  moduleStates,
})
const an = student('SWB0001', 'Hanoi', { m1: 'mastered', m2: 'open' })
const binh = student('SWB0002', 'Can Tho', { m1: 'open', m2: 'closed' })
const chi = student('SWB0003', null, { m1: 'mastered', m2: 'closed' })
const modules = [{ id: 'm1', name: 'Variables' }, { id: 'm2', name: 'Loops' }]

describe('studentsAtCampus', () => {
  it('keeps everyone for All campuses and only that campus otherwise', () => {
    expect(studentsAtCampus([an, binh, chi], '')).toEqual([an, binh, chi])
    expect(studentsAtCampus([an, binh, chi], 'Can Tho')).toEqual([binh])
    expect(studentsAtCampus([an, binh, chi], 'Da Nang')).toEqual([])
  })
})

describe('moduleStatus', () => {
  it('lists each module\'s mastered, open and closed students in course order', () => {
    const rows = moduleStatus(modules, [an, binh, chi])

    expect(rows.map(row => [row.moduleId, row.name])).toEqual([['m1', 'Variables'], ['m2', 'Loops']])
    expect(rows.map(row => row.segments.map(segment => [segment.state, segment.students.map(item => item.studentNumber)]))).toEqual([
      [['mastered', ['SWB0001', 'SWB0003']], ['open', ['SWB0002']], ['closed', []]],
      [['mastered', []], ['open', ['SWB0001']], ['closed', ['SWB0002', 'SWB0003']]],
    ])
  })

  it('places the segments along the bar by share, with no width for a state nobody is in', () => {
    const [variables] = moduleStatus(modules, [an, binh, chi, student('SWB0004', null, { m1: 'mastered', m2: 'open' })])

    expect(variables!.segments.map(({ start, width }) => [start, width])).toEqual([[0, 75], [75, 25], [100, 0]])
  })

  it('keeps a very small segment wide enough to point at, and the bar exactly full', () => {
    const crowd = Array.from({ length: 99 }, (_, index) => student(`SWB1${index}`, null, { m1: 'closed' }))
    const [variables] = moduleStatus([modules[0]!], [an, ...crowd])

    expect(variables!.segments.map(segment => segment.width)).toEqual([4, 0, 96])
  })

  it('reads a module a student has no state for as closed, and draws nothing with no students', () => {
    expect(moduleStatus([{ id: 'new', name: 'New' }], [an])[0]!.segments[2]!.students).toEqual([an])
    expect(moduleStatus(modules, [])[0]!.segments.map(segment => segment.width)).toEqual([0, 0, 0])
  })
})
