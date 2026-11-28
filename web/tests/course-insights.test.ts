import { describe, expect, it } from 'vitest'
import { coursePath, furthestBehind } from '../app/lecturer/course-insights'
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
