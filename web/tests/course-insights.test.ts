import { describe, expect, it } from 'vitest'
import { coursePath, filterStudents, furthestBehind, noFilters, noModuleOpen, type InsightsFilters } from '../app/lecturer/course-insights'
import type { LecturerStudent } from '../shared/lecturer'
import type { ModuleState } from '../shared/turn'

const student = (displayName: string, campus: LecturerStudent['campus'], moduleStates: Record<string, ModuleState>, percent = 0): LecturerStudent => ({
  displayName,
  studentNumber: displayName,
  campus,
  email: `${displayName}@example.com`,
  enrolledAt: '2026-11-14T08:00:00Z',
  progress: { mastered: 0, total: 3, percent },
  moduleStates,
})
const modules = [{ id: 'm1', name: 'Variables' }, { id: 'm2', name: 'Loops' }, { id: 'm3', name: 'Files' }]
const an = student('An', 'Hanoi', { m1: 'open' }, 0)
const binh = student('Binh', 'Can Tho', { m1: 'mastered', m2: 'open', m3: 'open' }, 33)
const chi = student('Chi', null, { m1: 'mastered', m2: 'mastered', m3: 'closed' }, 66)

describe('filterStudents', () => {
  const all = [an, binh, chi]
  const names = (filters: Partial<InsightsFilters>) =>
    filterStudents(modules, all, { ...noFilters, ...filters }).map(one => one.displayName)

  it('keeps everyone with no filter set', () => {
    expect(names({})).toEqual(['An', 'Binh', 'Chi'])
  })

  it('narrows by campus, and by part of a name or student number whatever the case', () => {
    expect(names({ campus: 'Can Tho' })).toEqual(['Binh'])
    expect(names({ campus: 'Da Nang' })).toEqual([])
    expect(names({ search: '  cH ' })).toEqual(['Chi'])
    expect(filterStudents(modules, [{ ...an, studentNumber: 'SWB0042' }], { ...noFilters, search: 'b0042' })).toHaveLength(1)
  })

  it('narrows by Course progress group', () => {
    expect(names({ group: 'not-started' })).toEqual(['An'])
    expect(names({ group: 'part-way' })).toEqual(['Binh', 'Chi'])
  })

  it('narrows to the students working on one module, or with none open', () => {
    // Binh has Files open too, but stands on Loops.
    expect(names({ moduleId: 'm2' })).toEqual(['Binh'])
    expect(names({ moduleId: 'm3' })).toEqual([])
    expect(names({ moduleId: noModuleOpen })).toEqual(['Chi'])
  })

  it('applies every filter that is set together', () => {
    expect(names({ group: 'part-way', moduleId: noModuleOpen })).toEqual(['Chi'])
    expect(names({ group: 'not-started', campus: 'Can Tho' })).toEqual([])
  })
})

describe('coursePath', () => {
  it('puts each student on the first module open to them, and counts who has mastered each', () => {
    const path = coursePath(modules, [an, binh, chi])

    expect(path.modules.map(item => [item.number, item.name, item.here.map(one => one.displayName), item.mastered])).toEqual([
      [1, 'Variables', ['An'], 2],
      [2, 'Loops', ['Binh'], 1],
      [3, 'Files', [], 0],
    ])
  })

  it('lists a student with no module open apart from the path', () => {
    expect(coursePath(modules, [an, chi]).noneOpen).toEqual([chi])
  })
})

describe('furthestBehind', () => {
  it('lists the least Course progress first, by name when equal, leaving out who finished', () => {
    const done = student('Dung', null, {}, 100)
    const em = student('Em', null, {}, 0)

    expect(furthestBehind([chi, done, em, binh, an], 3).map(one => one.displayName)).toEqual(['An', 'Em', 'Binh'])
    expect(furthestBehind([done], 3)).toEqual([])
  })
})
