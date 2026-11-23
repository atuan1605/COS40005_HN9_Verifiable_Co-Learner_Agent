import { describe, expect, it } from 'vitest'
import { presentedRoadmap, pythonCourse } from '../server/course'
import { estimateCourse, standingFor, type Observation } from '../server/student-model'

const moduleId = 'getting_started'

// Three correct answers that are not exercise submissions: they raise the first module to 0.876,
// the threshold of a course set at 0.85, but pass no exercise.
const quizPasses: Observation[] = ['print-text', 'comment-line', 'program-steps'].map(questionId => ({
  moduleId,
  kind: 'quiz_answer', questionId,
  allPassed: true,
}))

// A passing submission on each of the first module's three exercises.
const exercisePasses: Observation[] = ['say_hello', 'join_words', 'sign_the_program']
  .map(exerciseId => ({ moduleId, kind: 'submission', exerciseId, allPassed: true }))

function roadmapFor(evidence: readonly Observation[], course = pythonCourse) {
  const standing = standingFor(estimateCourse(course, evidence), moduleId)
  return presentedRoadmap(course, standing)
}

describe('presented roadmap', () => {
  it('shows a module at the threshold with no passed exercise as open with a reason', () => {
    const module = roadmapFor(quizPasses, { ...pythonCourse, masteryThreshold: 0.85 }).find(item => item.id === moduleId)

    expect(module?.state).toBe('open')
    expect(module && 'masteryReason' in module ? module.masteryReason : undefined)
      .toMatch(/pass an exercise/i)
  })

  it('shows a module mastered once an exercise is passed on top of the threshold', () => {
    const module = roadmapFor(exercisePasses).find(item => item.id === moduleId)

    expect(module?.state).toBe('mastered')
  })

  it('gives an ordinary open module no mastery reason', () => {
    const module = roadmapFor([{ moduleId, kind: 'submission', exerciseId: 'say_hello', allPassed: true }])
      .find(item => item.id === moduleId)

    expect(module?.state).toBe('open')
    expect(module && 'masteryReason' in module ? module.masteryReason : undefined)
      .toBeUndefined()
  })
})
