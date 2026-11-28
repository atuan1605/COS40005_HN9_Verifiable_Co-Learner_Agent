import { describe, expect, it } from 'vitest'
import { courseProgress } from '../shared/course-progress'
import { presentedRoadmap, pythonCourse } from '../server/course'
import { estimateCourse, standingFor } from '../server/student-model'

const mastered = { state: 'mastered' } as const
const open = { state: 'open' } as const
// A module listed without content stands as closed.
const closed = { state: 'closed' } as const

describe('course progress', () => {
  it('counts every listed module, those without content too', () => {
    expect(courseProgress([mastered, open, closed, closed])).toEqual({ mastered: 1, total: 4, percent: 25 })
  })

  it('rounds the percentage down', () => {
    expect(courseProgress([mastered, mastered, open])).toEqual({ mastered: 2, total: 3, percent: 66 })
  })

  it('reaches 100% only once every listed module is mastered', () => {
    expect(courseProgress([mastered, mastered, closed]).percent).toBe(66)
    expect(courseProgress([mastered, mastered, mastered]).percent).toBe(100)
  })

  it('is 0% for a course that lists no modules', () => {
    expect(courseProgress([])).toEqual({ mastered: 0, total: 0, percent: 0 })
  })

  it('counts all eleven modules of the Python course', () => {
    const standing = standingFor(estimateCourse(pythonCourse, []), 'getting_started')

    expect(courseProgress(presentedRoadmap(pythonCourse, standing))).toEqual({ mastered: 0, total: 11, percent: 0 })
  })
})
