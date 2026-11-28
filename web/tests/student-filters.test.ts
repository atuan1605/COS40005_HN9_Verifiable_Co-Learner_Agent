import { describe, expect, it } from 'vitest'
import { filterStudents, noFilters, noModuleOpen, progressPieStudents, type StudentFilterValues } from '../app/lecturer/student-filters'
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
  const names = (filters: Partial<StudentFilterValues>) =>
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

describe('the students the progress pie counts', () => {
  const all = [an, binh, chi]

  it('ignores the Course progress filter, so the chosen group keeps the others to stand against', () => {
    const shown = progressPieStudents(modules, all, { ...noFilters, group: 'not-started' })
    expect(shown.map(one => one.displayName)).toEqual(['An', 'Binh', 'Chi'])
  })

  it('still applies every other filter', () => {
    const shown = progressPieStudents(modules, all, { ...noFilters, group: 'not-started', campus: 'Can Tho' })
    expect(shown.map(one => one.displayName)).toEqual(['Binh'])
  })
})
