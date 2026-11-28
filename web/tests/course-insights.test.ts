import { describe, expect, it } from 'vitest'
import { busiestStop, coursePath, furthestBehind, pageNumbers, pathStops, studentPage } from '../app/lecturer/course-insights'
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

describe('pathStops', () => {
  it('is every module in course order, then the students with none open', () => {
    expect(pathStops(coursePath(modules, [an, binh, chi])).map(stop => [stop.number, stop.name, stop.here.length, stop.mastered])).toEqual([
      [1, 'Variables', 1, 2],
      [2, 'Loops', 1, 1],
      [3, 'Files', 0, 0],
      [null, 'No module open', 1, null],
    ])
  })
})

describe('studentPage', () => {
  const crowd = Array.from({ length: 23 }, (_, index) => student(`S${index + 1}`, null, {}))

  it('holds 10 students in the order given, and says which of how many they are', () => {
    expect(studentPage(crowd, 1)).toMatchObject({ page: 1, pageCount: 3, from: 1, to: 10 })
    expect(studentPage(crowd, 3)).toMatchObject({ page: 3, from: 21, to: 23 })
    expect(studentPage(crowd, 3).students.map(one => one.displayName)).toEqual(['S21', 'S22', 'S23'])
  })

  it('stays within the pages there are', () => {
    expect(studentPage(crowd, 9).page).toBe(3)
    expect(studentPage([], 4)).toEqual({ page: 1, pageCount: 1, from: 0, to: 0, students: [] })
  })
})

describe('pageNumbers', () => {
  it('lists every page when there are few', () => {
    expect(pageNumbers(2, 5)).toEqual([1, 2, 3, 4, 5])
  })

  it('keeps the ends and the neighbours of the current page when there are many', () => {
    expect(pageNumbers(1, 30)).toEqual([1, 2, null, 30])
    expect(pageNumbers(15, 30)).toEqual([1, null, 14, 15, 16, null, 30])
    expect(pageNumbers(30, 30)).toEqual([1, null, 29, 30])
  })
})

describe('busiestStop', () => {
  it('is the stop with the most students, the earlier one when equal', () => {
    const dung = student('Dung', null, { m1: 'mastered', m2: 'open' })
    expect(busiestStop(pathStops(coursePath(modules, [an, binh, dung])))?.name).toBe('Loops')
    expect(busiestStop(pathStops(coursePath(modules, [an, binh])))?.name).toBe('Variables')
  })
})
