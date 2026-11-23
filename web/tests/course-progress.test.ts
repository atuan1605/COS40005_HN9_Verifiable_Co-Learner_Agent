import { describe, expect, it } from 'vitest'
import { courseProgress } from '../shared/course-progress'
import { presentedRoadmap, pythonCourse } from '../server/course'
import { estimateCourse, standingFor } from '../server/student-model'

const mastered = { available: true, state: 'mastered' } as const
const open = { available: true, state: 'open' } as const
const empty = { available: false, state: 'closed' } as const

describe('course progress', () => {
  it('counts only the modules that have content', () => {
    expect(courseProgress([mastered, open, empty, empty])).toEqual({ mastered: 1, total: 2, percent: 50 })
  })

  it('rounds the percentage down', () => {
    expect(courseProgress([mastered, mastered, open])).toEqual({ mastered: 2, total: 3, percent: 66 })
  })

  it('reaches 100% once every module with content is mastered', () => {
    expect(courseProgress([mastered, mastered, empty]).percent).toBe(100)
  })

  it('is 0% for a course with no content', () => {
    expect(courseProgress([empty])).toEqual({ mastered: 0, total: 0, percent: 0 })
  })

  it('leaves the Python course modules listed without content out of the total', () => {
    const standing = standingFor(estimateCourse(pythonCourse, []), 'getting_started')
    const progress = courseProgress(presentedRoadmap(pythonCourse, standing))

    expect(progress.total).toBe(pythonCourse.modules.filter(module => module.available).length)
    expect(progress.total).toBeLessThan(pythonCourse.modules.length)
    expect(progress.mastered).toBe(0)
  })
})
