import { describe, expect, it } from 'vitest'
import { classSummary, moduleStateTotals, progressGroups, ringSegment } from '../app/lecturer/course-overview'
import type { LecturerStudent } from '../shared/lecturer'
import type { ModuleState } from '../shared/turn'

function student(percent: number, moduleStates: Record<string, ModuleState> = {}): LecturerStudent {
  return {
    displayName: `At ${percent}`,
    studentNumber: `SWB${percent}`,
    campus: null,
    email: 'student@example.com',
    enrolledAt: '2026-11-14T08:00:00Z',
    progress: { mastered: 0, total: 11, percent },
    moduleStates,
  }
}

describe('the lecturer course overview', () => {
  it('counts the class, rounds its average Course progress down and counts who finished', () => {
    expect(classSummary([student(100), student(36), student(0)])).toEqual({ students: 3, averagePercent: 45, finished: 1 })
    expect(classSummary([])).toEqual({ students: 0, averagePercent: 0, finished: 0 })
  })

  it('puts each student in exactly one Course progress group', () => {
    const percents = [0, 1, 29, 30, 69, 70, 100]
    expect(progressGroups(percents.map(percent => student(percent))).map(group => [group.key, group.count]))
      .toEqual([['not-started', 1], ['starting', 2], ['part-way', 2], ['nearly-there', 2]])
  })

  it('totals every listed module of every student by state, a missing one as closed', () => {
    const modules = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }]
    expect(moduleStateTotals(modules, [student(50, { a: 'mastered', b: 'open' }), student(0, { a: 'open' })]))
      .toEqual([{ state: 'mastered', count: 1 }, { state: 'open', count: 2 }, { state: 'closed', count: 1 }])
  })

  it('draws a whole turn without collapsing to nothing', () => {
    const whole = ringSegment(0, 1, 50, 0)
    expect(whole).toContain('A 50 50 0 1 1')
    expect(whole).not.toContain('A 50 50 0 1 1 50 0 Z')
  })
})
