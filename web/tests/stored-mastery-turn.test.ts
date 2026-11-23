import { describe, expect, it } from 'vitest'
import { createFakeAgents } from '../server/agents'
import { pythonCourse } from '../server/course'
import { createMemoryConversationStore } from '../server/storage/conversation-store'
import { createMemoryDecisionLogStore } from '../server/storage/decision-log'
import { createMemoryQuizAnswerStore } from '../server/storage/quiz-answer-store'
import {
  createMemoryEvidenceStore,
  createMemoryMasteryStore,
  createMemoryUnlockStore,
  learningParameters,
} from '../server/student-model'
import { createFakeSandbox } from '../server/sandbox'
import { handleTurn, type TurnOptions } from '../server/turn/handle-turn'

// The turn handler is where a student's mastery is read and, once they record evidence, stored
// again (ADR 0008). These tests keep the stored copy as the one number every reader shows.
const student = '6f1b0c1e-1111-4111-8111-111111111111'
const firstModule = 'getting_started'
const moduleIds = pythonCourse.modules.map(module => module.id)

function teacher() {
  return createFakeAgents({
    proposal: { type: 'explain_concept', scope: firstModule },
    text: 'A loop keeps a running total.',
  })
}

// The roadmap shows mastery in whole percentage points and rounds down, so a stored number
// reaches the student as that many hundredths.
function shown(mastery: number): number {
  return Math.floor(mastery * 100) / 100
}

function setup() {
  const store = createMemoryConversationStore({ [student]: 'An' })
  const mastery = createMemoryMasteryStore()
  const quizAnswers = createMemoryQuizAnswerStore()
  const evidence = createMemoryEvidenceStore(quizAnswers.observationsForStudent)
  const options: TurnOptions = {
    evidence,
    quizAnswers,
    unlocks: createMemoryUnlockStore(),
    mastery,
    decisions: createMemoryDecisionLogStore(),
  }
  const open = () => handleTurn({ sessionStudentId: student, body: { event: 'open' } }, store, undefined, options)
  const storedOf = async (moduleId: string) => (await mastery.forStudent(student)).find(item => item.moduleId === moduleId)
  return { store, mastery, evidence, options, open, storedOf }
}

describe('stored mastery in a turn', () => {
  it('saves the mastery a submission earns and shows it in the roadmap of the same response', async () => {
    const { store, options, open, storedOf } = setup()
    await open()
    const before = (await storedOf(firstModule))!.mastery
    expect(before).toBe(learningParameters.prior)

    const submitted = await handleTurn({
      sessionStudentId: student,
      body: {
        event: 'submission',
        code: 'print("hi")',
        results: [{ name: 'hello', passed: true, expected: 'hi', actual: 'hi' }],
      },
    }, store, teacher(), {
      ...options,
      sandbox: createFakeSandbox({
        outcome: 'checked',
        results: [{ name: 'hello', passed: true, expected: 'hi', actual: 'hi' }],
      }),
    })

    const stored = await storedOf(firstModule)
    expect(stored!.passedExercise).toBe(true)
    expect(stored!.mastery).toBeGreaterThan(before)
    expect(submitted.courseRoadmap.find(module => module.id === firstModule)!.mastery).toBe(shown(stored!.mastery))
  })

  it('saves the mastery a quiz answer earns and shows it in the roadmap of the same response', async () => {
    const { store, options, open, storedOf } = setup()
    await open()

    const answered = await handleTurn({
      sessionStudentId: student,
      body: { event: 'quiz_answer', moduleId: firstModule, questionId: 'print-text', choice: 1 },
    }, store, undefined, options)

    // One correct answer on a module nothing else has touched: the posterior for a
    // pass with guess 0.25 and slip 0.1 is 2/7, and the quiz learning step of 0.05
    // adds 1/28, so 9/28.
    const stored = await storedOf(firstModule)
    expect(stored!.mastery).toBeCloseTo(9 / 28, 12)
    expect(answered.courseRoadmap.find(module => module.id === firstModule)!.mastery).toBe(shown(stored!.mastery))
  })

  it('computes and saves mastery for a student whose stored picture is missing', async () => {
    const { open, mastery } = setup()

    const opened = await open()

    const stored = await mastery.forStudent(student)
    expect(stored.map(item => item.moduleId)).toEqual(moduleIds)
    expect(stored.every(item => item.mastery === learningParameters.prior)).toBe(true)
    // A closed module shows no number, so the picture is checked where it is shown:
    // the one module the student starts on.
    expect(opened.courseRoadmap.find(module => module.id === firstModule)!.mastery)
      .toBe(shown(learningParameters.prior))
  })

  it('shows and records the stored number, not one recomputed from the ledger', async () => {
    const { store, mastery, evidence, options, open } = setup()
    const planted = moduleIds.map(moduleId => ({ moduleId, mastery: 0.42, passedExercise: false, everMastered: false }))
    await mastery.save(student, planted)
    // A passing submission would raise the estimate on its own, so a number that stays 0.42
    // says the reader took the stored copy.
    await evidence.append({ studentId: student, moduleId: firstModule, exerciseId: 'say_hello', testsPassed: 1, testsTotal: 1 })

    const opened = await open()
    expect(opened.courseRoadmap.find(module => module.id === firstModule)!.mastery).toBe(0.42)

    await handleTurn({ sessionStudentId: student, body: { event: 'message', text: 'What is a program?' } }, store, teacher(), options)

    const decision = (await options.decisions!.list({ studentId: student }))[0]!
    expect(decision.masteries).toEqual(planted.map(item => ({ moduleId: item.moduleId, mastery: 0.42 })))
  })
})

