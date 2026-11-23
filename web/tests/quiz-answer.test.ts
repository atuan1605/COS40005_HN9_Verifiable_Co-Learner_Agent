import { describe, expect, it } from 'vitest'
import { createMemoryConversationStore } from '../server/storage/conversation-store'
import { createMemoryQuizAnswerStore, type QuizAnswerStore } from '../server/storage/quiz-answer-store'
import { handleTurn } from '../server/turn/handle-turn'

const signedInStudent = '6f1b0c1e-1111-4111-8111-111111111111'

function memoryStore() {
  return createMemoryConversationStore({ [signedInStudent]: 'An' })
}

function answer(body: { moduleId?: string, questionId: string, choice: number }) {
  return {
    sessionStudentId: signedInStudent,
    body: { event: 'quiz_answer', moduleId: body.moduleId ?? 'getting_started', questionId: body.questionId, choice: body.choice },
  }
}

function questionOf(state: Awaited<ReturnType<typeof handleTurn>>, id: string) {
  const question = state.workingArea.quiz.find(item => item.id === id)
  if (!question) throw new Error(`The quiz has no question ${id}.`)
  return question
}

describe('quiz answer in Learn mode', () => {
  it('raises roadmap mastery immediately without unlocking the next module on quiz answers alone', async () => {
    const store = memoryStore()
    const options = { quizAnswers: createMemoryQuizAnswerStore() }
    const first = await handleTurn(answer({ questionId: 'print-text', choice: 1 }), store, undefined, options)
    expect(first.courseRoadmap[0]?.mastery).toBe(0.32)

    await handleTurn(answer({ questionId: 'comment-line', choice: 3 }), store, undefined, options)
    const third = await handleTurn(answer({ questionId: 'program-steps', choice: 0 }), store, undefined, options)
    expect(third.courseRoadmap[0]).toMatchObject({ mastery: 0.87, state: 'open' })
    expect(third.courseRoadmap[1]?.state).toBe('closed')
  })

  it('marks a wrong answer and shows the correct choice and explanation', async () => {
    const store = memoryStore()
    const quiz: QuizAnswerStore = createMemoryQuizAnswerStore()

    const state = await handleTurn(answer({ questionId: 'print-text', choice: 0 }), store, undefined, { quizAnswers: quiz })

    expect(questionOf(state, 'print-text').result).toEqual({
      choice: 0,
      correctIndex: 1,
      correct: false,
      explanation: 'Quotes make Hello literal text. print() displays that text.',
    })
  })

  it('marks a right answer as correct', async () => {
    const state = await handleTurn(answer({ questionId: 'print-text', choice: 1 }), memoryStore(), undefined, { quizAnswers: createMemoryQuizAnswerStore() })

    expect(questionOf(state, 'print-text').result?.correct).toBe(true)
  })

  it('never sends an unanswered question correct choice', async () => {
    const state = await handleTurn(answer({ questionId: 'print-text', choice: 1 }), memoryStore(), undefined, { quizAnswers: createMemoryQuizAnswerStore() })

    const unanswered = questionOf(state, 'comment-line')
    expect(unanswered.result).toBeNull()
    expect(JSON.stringify(unanswered)).not.toContain('correctIndex')
  })

  it('adds an event message naming the question, the choice and the result', async () => {
    const store = memoryStore()
    const state = await handleTurn(answer({ questionId: 'comment-line', choice: 2 }), store, undefined, { quizAnswers: createMemoryQuizAnswerStore() })

    const events = state.conversation.filter(message => message.author === 'event')
    const last = events.at(-1)
    expect(last?.text).toBe('Quiz 2: chose C, wrong')
    expect(last?.name).toBe('Quiz')
  })

  it('leaks no unanswered explanation after one question is answered', async () => {
    const state = await handleTurn(answer({ questionId: 'print-text', choice: 1 }), memoryStore(), undefined, { quizAnswers: createMemoryQuizAnswerStore() })

    const unanswered = state.workingArea.quiz.filter(question => question.result === null)
    expect(unanswered).toHaveLength(2)
    expect(unanswered.every(question => !('explanation' in question))).toBe(true)
  })

  it('does nothing when the question is not in the current module', async () => {
    const store = memoryStore()
    const quiz = createMemoryQuizAnswerStore()
    const state = await handleTurn(answer({ questionId: 'not_a_question', choice: 0 }), store, undefined, { quizAnswers: quiz })

    expect(state.workingArea.quiz.every(question => question.result === null)).toBe(true)
    expect(state.conversation.filter(message => message.author === 'event')).toHaveLength(0)
    expect(await quiz.forStudentModule(signedInStudent, 'getting_started')).toHaveLength(0)
  })

  it('stores only the first answer and leaves the result and conversation unchanged on a second', async () => {
    const store = memoryStore()
    const quiz = createMemoryQuizAnswerStore()

    const first = await handleTurn(answer({ questionId: 'print-text', choice: 1 }), store, undefined, { quizAnswers: quiz })
    const second = await handleTurn(answer({ questionId: 'print-text', choice: 0 }), store, undefined, { quizAnswers: quiz })

    // The ledger keeps the first answer; the second does not overwrite it.
    expect((await quiz.forStudentModule(signedInStudent, 'getting_started')).map(row => row.choice)).toEqual([1])
    expect(questionOf(second, 'print-text').result?.choice).toBe(1)
    // No second event message for the same question.
    expect(second.conversation.filter(message => message.author === 'event')).toHaveLength(
      first.conversation.filter(message => message.author === 'event').length,
    )
  })
})
