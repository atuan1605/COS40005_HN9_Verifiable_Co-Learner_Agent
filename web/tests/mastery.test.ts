import { describe, expect, it } from 'vitest'
import { pythonCourse } from '../server/course'
import { estimateCourse, estimateMastery, masteryParametersFor, unlockedModuleIds, type ModuleMastery, type Observation } from '../server/student-model'

const courseModules = pythonCourse.modules
const masteryParameters = masteryParametersFor(pythonCourse.masteryThreshold)
const moduleIds = courseModules.map(module => module.id)

describe('mastery estimator', () => {
  it('uses per-kind slip, guess and learning when replaying interleaved observations', () => {
    const ledger: Observation[] = [
      { kind: 'submission', moduleId: 'getting_started', exerciseId: 'say_hello', allPassed: true },
      { kind: 'quiz_answer', moduleId: 'getting_started', questionId: 'print-text', allPassed: false },
      { kind: 'submission', moduleId: 'getting_started', exerciseId: 'say_hello', allPassed: false },
      { kind: 'quiz_answer', moduleId: 'getting_started', questionId: 'comment-line', allPassed: true },
    ]
    const estimated = estimateMastery(ledger, moduleIds, masteryParameters)
    expect(masteryOf(estimated, 'getting_started')).toBeCloseTo(0.397151, 6)
    expect(estimated[0]?.passedExercise).toBe(true)
  })

  it('gives every module the prior when there is no evidence', () => {
    const estimated = estimateMastery([], moduleIds, masteryParameters)

    expect(estimated).toEqual(moduleIds.map(moduleId => ({
      moduleId,
      mastery: 0.1,
      passedExercise: false,
      everMastered: false,
    })))
  })

  it('raises the mastery of the module a first-time pass belongs to, and no other', () => {
    const estimated = estimateMastery(
      [{ moduleId: 'getting_started', kind: 'submission', exerciseId: 'say_hello', allPassed: true }],
      moduleIds,
      masteryParameters,
    )

    expect(masteryOf(estimated, 'getting_started')).toBeCloseTo(0.433333, 6)
    expect(masteryOf(estimated, 'variables')).toBe(0.1)
  })

  it('raises mastery less for one correct quiz answer than for one passed exercise', () => {
    const quiz = estimateMastery(quizPasses(1), moduleIds, masteryParameters)
    const exercise = estimateMastery(passes(1), moduleIds, masteryParameters)

    expect(masteryOf(quiz, 'getting_started')).toBeCloseTo(0.321429, 6)
    expect(masteryOf(exercise, 'getting_started')).toBeGreaterThan(masteryOf(quiz, 'getting_started'))
  })

  it('ignores a pass of an exercise the student has already passed', () => {
    const once = estimateMastery(
      [{ moduleId: 'getting_started', kind: 'submission', exerciseId: 'say_hello', allPassed: true }],
      moduleIds,
      masteryParameters,
    )
    const again = estimateMastery(
      [
        { moduleId: 'getting_started', kind: 'submission', exerciseId: 'say_hello', allPassed: true },
        { moduleId: 'getting_started', kind: 'submission', exerciseId: 'say_hello', allPassed: true },
      ],
      moduleIds,
      masteryParameters,
    )

    expect(masteryOf(again, 'getting_started')).toBe(masteryOf(once, 'getting_started'))
  })

  it('leaves mastery where a pass put it when the same exercise is later failed', () => {
    const passed = estimateMastery(
      [{ moduleId: 'getting_started', kind: 'submission', exerciseId: 'say_hello', allPassed: true }],
      moduleIds,
      masteryParameters,
    )
    const passedThenFailed = estimateMastery(
      [
        { moduleId: 'getting_started', kind: 'submission', exerciseId: 'say_hello', allPassed: true },
        { moduleId: 'getting_started', kind: 'submission', exerciseId: 'say_hello', allPassed: false },
      ],
      moduleIds,
      masteryParameters,
    )

    expect(masteryOf(passedThenFailed, 'getting_started'))
      .toBe(masteryOf(passed, 'getting_started'))
  })

  it('counts a first-time pass of a second exercise in the same module', () => {
    const estimated = estimateMastery(
      [
        { moduleId: 'getting_started', kind: 'submission', exerciseId: 'say_hello', allPassed: true },
        { moduleId: 'getting_started', kind: 'submission', exerciseId: 'join_words', allPassed: true },
      ],
      moduleIds,
      masteryParameters,
    )

    expect(masteryOf(estimated, 'getting_started')).toBeCloseTo(0.808609, 6)
  })

  it('crosses the threshold on the third first-time pass', () => {
    const twice = estimateMastery(passes(2), moduleIds, masteryParameters)
    const thrice = estimateMastery(passes(3), moduleIds, masteryParameters)

    expect(masteryOf(twice, 'getting_started')).toBeLessThan(masteryParameters.threshold)
    expect(masteryOf(thrice, 'getting_started')).toBeCloseTo(0.957526, 6)
    expect(thrice).toContainEqual({
      moduleId: 'getting_started',
      mastery: masteryOf(thrice, 'getting_started'),
      passedExercise: true,
      everMastered: true,
    })
  })

  it('does not master a module that reaches the threshold with no passed exercise', () => {
    const quizOnly = estimateMastery(quizPasses(4), moduleIds, masteryParameters)
    const module = quizOnly.find(item => item.moduleId === 'getting_started')

    expect(masteryOf(quizOnly, 'getting_started')).toBeGreaterThanOrEqual(masteryParameters.threshold)
    expect(module?.passedExercise).toBe(false)
    expect(module?.everMastered).toBe(false)
  })

  it('masters a module once an exercise is passed on top of the threshold', () => {
    const withExercise = estimateMastery(
      [...quizPasses(3), { moduleId: 'getting_started', kind: 'submission', exerciseId: 'say_hello', allPassed: true }],
      moduleIds,
      masteryParameters,
    )
    const module = withExercise.find(item => item.moduleId === 'getting_started')

    expect(module?.passedExercise).toBe(true)
    expect(module?.everMastered).toBe(true)
  })

  it('lowers a mastered module when a later non-exercise answer is wrong', () => {
    const mastered = estimateMastery(passes(3), moduleIds, masteryParameters)
    const failed = estimateMastery(
      [...passes(3), { moduleId: 'getting_started', kind: 'quiz_answer', questionId: 'quiz', allPassed: false }],
      moduleIds,
      masteryParameters,
    )

    expect(masteryOf(failed, 'getting_started')).toBeCloseTo(0.762845, 6)
    expect(masteryOf(failed, 'getting_started')).toBeLessThan(masteryOf(mastered, 'getting_started'))
  })

  it('remembers that a module was mastered after its mastery falls back', () => {
    const failed = estimateMastery(
      [...passes(3), { moduleId: 'getting_started', kind: 'quiz_answer', questionId: 'quiz', allPassed: false }],
      moduleIds,
      masteryParameters,
    )

    expect(masteryOf(failed, 'getting_started')).toBeLessThan(masteryParameters.threshold)
    expect(failed.find(item => item.moduleId === 'getting_started')?.everMastered).toBe(true)
  })

  it('gives the same numbers every time it reads the same ledger', () => {
    const ledger = [
      ...passes(3),
      { moduleId: 'getting_started', kind: 'submission', exerciseId: 'say_hello', allPassed: false },
      { moduleId: 'variables', kind: 'submission', exerciseId: 'total_cost', allPassed: true },
    ]

    expect(estimateMastery(ledger, moduleIds, masteryParameters))
      .toEqual(estimateMastery(ledger, moduleIds, masteryParameters))
  })

  it('leaves evidence for a module the course no longer lists out of the estimate', () => {
    const estimated = estimateMastery(
      [{ moduleId: 'for_loop', kind: 'submission', exerciseId: 'sum_of_a_list', allPassed: true }],
      moduleIds,
      masteryParameters,
    )

    expect(estimated.map(item => item.moduleId)).toEqual(moduleIds)
    expect(estimated.every(item => item.mastery === masteryParameters.prior)).toBe(true)
  })
})

describe('unlocking', () => {
  it('opens Module 1 alone when there is no evidence', () => {
    expect(unlocked([])).toEqual(['getting_started'])
  })

  it('opens the next module once the module before it is mastered', () => {
    expect(unlocked(passes(3))).toEqual(['getting_started', 'variables'])
  })

  it('keeps a module unlocked after the mastery that opened it falls back', () => {
    const ledger = [
      ...passes(3),
      { moduleId: 'getting_started', kind: 'quiz_answer', questionId: 'quiz', allPassed: false },
      { moduleId: 'getting_started', kind: 'quiz_answer', questionId: 'quiz', allPassed: false },
    ]

    expect(masteryOf(estimateMastery(ledger, moduleIds, masteryParameters), 'getting_started'))
      .toBeLessThan(masteryParameters.threshold)
    expect(unlocked(ledger)).toEqual(['getting_started', 'variables'])
  })

  it('does not unlock the next module from the threshold without a passed exercise', () => {
    expect(unlocked(quizPasses(3))).toEqual(['getting_started'])
  })

  it('leaves a module with no content closed even when the module before it is mastered', () => {
    const ledger = [
      ...passes(3),
      ...masters('variables', ['total_cost', 'whole_number', 'old_enough']),
      ...masters('strings', ['first_character', 'shout', 'greeting']),
      ...masters('conditionals', ['sign_of', 'ticket', 'marked_result']),
      ...masters('loops', ['sum_of_a_list', 'count_the_even_numbers', 'count_the_items']),
    ]

    expect(unlocked(ledger)).toEqual([
      'getting_started',
      'variables',
      'strings',
      'conditionals',
      'loops',
    ])
  })
})

describe('course estimate on evidence the course no longer has', () => {
  // Evidence recorded before a lecturer removed a module, an exercise or a quiz question.
  const removed: Observation[] = [
    { kind: 'submission', moduleId: 'lambdas', exerciseId: 'square_it', allPassed: true },
    { kind: 'submission', moduleId: 'getting_started', exerciseId: 'retired_exercise', allPassed: true },
    { kind: 'quiz_answer', moduleId: 'getting_started', questionId: 'retired_question', allPassed: false },
  ]

  it('leaves every module at the prior when all the evidence is for removed ids', () => {
    const estimate = estimateCourse(pythonCourse, [...removed, ...removed, ...removed])

    expect(estimate.masteries.every(item => item.mastery === 0.1)).toBe(true)
    expect(estimate.passedExerciseModuleIds).toEqual([])
    expect(estimate.unlockedModuleIds).toEqual(['getting_started'])
  })

  it('estimates the course as if the evidence for removed ids were not there', () => {
    const kept = [...passes(2), ...quizPasses(1)]
    const mixed = [removed[0]!, ...passes(1), removed[1]!, removed[2]!, ...passes(2).slice(1), ...quizPasses(1)]

    expect(estimateCourse(pythonCourse, mixed)).toEqual(estimateCourse(pythonCourse, kept))
  })
})

function unlocked(ledger: readonly Observation[]): string[] {
  return unlockedModuleIds(courseModules, estimateMastery(ledger, moduleIds, masteryParameters))
}

// Three first-time passes, which is what mastering a module takes.
function masters(moduleId: string, exerciseIds: readonly string[]): Observation[] {
  return exerciseIds.map(exerciseId => ({ kind: 'submission', moduleId, exerciseId, allPassed: true }))
}

// Passing submissions on the first `count` exercises of Module 1.
function passes(count: number): Observation[] {
  return ['say_hello', 'join_words', 'sign_the_program'].slice(0, count).map(exerciseId => ({
    moduleId: 'getting_started',
    kind: 'submission',
    exerciseId,
    allPassed: true,
  }))
}

// `count` correct answers on Module 1 that are not exercise submissions, which
// raise mastery but never count as a passed exercise.
function quizPasses(count: number): Observation[] {
  const questionIds = ['print-text', 'comment-line', 'program-steps']
  return Array.from({ length: count }, (_, index) => ({
    moduleId: 'getting_started',
    kind: 'quiz_answer', questionId: questionIds[index % questionIds.length]!,
    allPassed: true,
  }))
}

function masteryOf(estimated: readonly ModuleMastery[], moduleId: string): number {
  const found = estimated.find(item => item.moduleId === moduleId)
  if (!found) throw new Error(`The estimate has no module ${moduleId}.`)
  return found.mastery
}
