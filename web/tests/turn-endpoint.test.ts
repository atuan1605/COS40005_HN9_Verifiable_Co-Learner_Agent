import { describe, expect, it, vi } from 'vitest'
import { createAgents, createConfiguredAgents, createFakeAgents, proposalSchema, type Move } from '../server/agents'
import { pythonCourse, studyModule } from '../server/course'
import { gettingStartedModule } from '../server/course/modules/getting-started'
import type { LanguageModel } from '../server/language-model'
import { createMemoryConversationStore } from '../server/storage/conversation-store'
import { createMemoryQuizAnswerStore } from '../server/storage/quiz-answer-store'
import { createMemoryDecisionLogStore, type DecisionRecord } from '../server/storage/decision-log'
import { createMemoryEvidenceStore, createMemoryUnlockStore } from '../server/student-model'
import { createMemoryActivityLog } from '../server/activity-recorder'
import { createFakeSandbox } from '../server/sandbox'
import { handleTurn, streamTurn, studentIdForTurn } from '../server/turn/handle-turn'

const signedInStudent = '6f1b0c1e-1111-4111-8111-111111111111'
const otherStudent = '6f1b0c1e-2222-4222-8222-222222222222'
const teacherReply = 'The total has to exist before the loop starts.'

function memoryStore() {
  return createMemoryConversationStore({
    [signedInStudent]: 'An',
    [otherStudent]: 'Bình',
  })
}

function speakingTeacher() {
  return createFakeAgents({
    proposal: { type: 'explain_concept', scope: 'getting_started' },
    text: teacherReply,
  })
}

describe('turn endpoint', () => {
  it('records unlocks earned before the first threshold change when the student returns', async () => {
    const evidence = createMemoryEvidenceStore()
    const unlocks = createMemoryUnlockStore()
    for (const exerciseId of ['say_hello', 'join_words', 'sign_the_program']) {
      await evidence.append({ studentId: signedInStudent, moduleId: 'getting_started', exerciseId, testsPassed: 3, testsTotal: 3 })
    }
    const course = {
      ...pythonCourse,
      masteryThreshold: 0.99,
      legacyUnlocks: { before: new Date(Date.now() + 1000).toISOString(), threshold: 0.9 },
    }
    const state = await handleTurn({ sessionStudentId: signedInStudent, body: { event: 'open' } }, memoryStore(), undefined, {
      evidence, unlocks, courses: { async course() { return course } },
    })
    expect(state.courseRoadmap[0]?.state).toBe('open')
    expect(state.courseRoadmap[1]?.state).toBe('open')
    expect(await unlocks.forStudent(signedInStudent)).toContain('variables')
  })

  it('uses the saved threshold on the next turn and keeps a previously opened module unlocked', async () => {
    const store = memoryStore()
    const evidence = createMemoryEvidenceStore()
    const unlocks = createMemoryUnlockStore()
    const decisions = createMemoryDecisionLogStore()
    let masteryThreshold = 0.99
    const courses = { async course() { return { ...pythonCourse, masteryThreshold } } }
    const options = { evidence, unlocks, decisions, courses }
    const moduleId = 'getting_started'
    for (const exerciseId of ['say_hello', 'join_words', 'sign_the_program']) {
      await evidence.append({ studentId: signedInStudent, moduleId, exerciseId, testsPassed: 3, testsTotal: 3 })
    }
    async function open() {
      return handleTurn({ sessionStudentId: signedInStudent, body: { event: 'open' } }, store, undefined, options)
    }

    expect((await open()).courseRoadmap[1]?.state).toBe('closed')
    masteryThreshold = 0.9
    const lowered = await open()
    expect(lowered.courseRoadmap[0]?.state).toBe('mastered')
    expect(lowered.courseRoadmap[1]?.state).toBe('open')
    expect(await unlocks.forStudent(signedInStudent)).toContain('variables')

    masteryThreshold = 0.99
    const raised = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'message', text: 'What should I study next?' },
    }, store, createFakeAgents({ proposal: { type: 'advance_to_module', moduleId: 'variables' }, text: 'You could study Variables next.' }), options)
    expect(raised.masteryThreshold).toBe(0.99)
    expect(raised.courseRoadmap[0]?.state).toBe('open')
    expect(raised.courseRoadmap[1]?.state).toBe('open')
    expect(await decisions.list()).toEqual([
      expect.objectContaining({ masteryThreshold: 0.99, verdict: 'allow', ruledMove: 'advance_to_module:variables' }),
    ])
  })

  it('rejects a request when there is no session', () => {
    expect(() => handleTurn({
      sessionStudentId: null,
      body: { event: 'open' },
    })).toThrow(expect.objectContaining({
      name: 'SignInRequiredError',
      statusCode: 401,
    }))
  })

  it('ignores a student id in the request body', async () => {
    expect(studentIdForTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'open', studentId: otherStudent },
    })).toBe(signedInStudent)

    const state = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'open', studentId: otherStudent },
    }, memoryStore())

    expect(JSON.stringify(state)).not.toContain(otherStudent)
  })

  it('open returns the course roadmap, Learn mode, and Module 1', async () => {
    const store = createMemoryConversationStore({
      [signedInStudent]: 'An',
    })
    const state = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'open' },
    }, store)

    expect(state.course).toBe('Introduction to Programming with Python')
    expect(state.courseRoadmap).toEqual([
      {
        id: 'getting_started',
        name: 'Getting Started with Programming and Python',
        part: 'Foundations',
        summary: 'What programming is, algorithms as steps, and a first program with print() and comments',
        state: 'open',
        current: true,
        available: true,
        mastery: 0.1,
      },
      {
        id: 'variables',
        name: 'Variables, Data Types, and Operators',
        part: 'Foundations',
        summary: 'Variables, data types, operators, input(), and type casting',
        state: 'closed',
        current: false,
        available: true,
        closedReason: 'Needs Module 1: Getting Started with Programming and Python mastered',
      },
      {
        id: 'strings',
        name: 'Working with Strings',
        part: 'Foundations',
        summary: 'Indexing, slicing, string methods, and f-strings',
        state: 'closed',
        current: false,
        available: true,
        closedReason: 'Needs Module 2: Variables, Data Types, and Operators mastered',
      },
      {
        id: 'conditionals',
        name: 'Conditional Statements',
        part: 'Control Flow',
        summary: 'if, elif, else, nested conditions, and logical operators',
        state: 'closed',
        current: false,
        available: true,
        closedReason: 'Needs Module 3: Working with Strings mastered',
      },
      {
        id: 'loops',
        name: 'Loops',
        part: 'Control Flow',
        summary: 'for, range(), while, break, continue, and nested loops',
        state: 'closed',
        current: false,
        available: true,
        closedReason: 'Needs Module 4: Conditional Statements mastered',
      },
      {
        id: 'lists_and_tuples',
        name: 'Lists and Tuples',
        part: 'Built-in Data Structures',
        summary: 'Creating, changing, and looping over lists and tuples',
        state: 'closed',
        current: false,
        available: false,
        closedReason: 'Not available yet',
      },
      {
        id: 'dictionaries_and_sets',
        name: 'Dictionaries and Sets',
        part: 'Built-in Data Structures',
        summary: 'Dictionaries, sets, and basic list comprehensions',
        state: 'closed',
        current: false,
        available: false,
        closedReason: 'Not available yet',
      },
      {
        id: 'functions',
        name: 'Functions',
        part: 'Organizing Code',
        summary: 'Defining functions, parameters, return values, and scope',
        state: 'closed',
        current: false,
        available: false,
        closedReason: 'Not available yet',
      },
      {
        id: 'modules_and_library',
        name: 'Modules and the Standard Library',
        part: 'Organizing Code',
        summary: 'import, the standard library, pip, and virtual environments',
        state: 'closed',
        current: false,
        available: false,
        closedReason: 'Not available yet',
      },
      {
        id: 'file_handling',
        name: 'File Handling',
        part: 'Working with the Real World',
        summary: 'Reading and writing text, CSV, and JSON files',
        state: 'closed',
        current: false,
        available: false,
        closedReason: 'Not available yet',
      },
      {
        id: 'error_handling',
        name: 'Error Handling and Debugging',
        part: 'Working with the Real World',
        summary: 'Errors, try / except / finally, tracebacks, and simple tests',
        state: 'closed',
        current: false,
        available: false,
        closedReason: 'Not available yet',
      },
    ])
    expect(state.workingArea).toEqual({
      mode: 'learn',
      moduleId: 'getting_started',
      moduleName: 'Getting Started with Programming and Python',
      materials: gettingStartedModule.materials,
      exercise: {
        id: 'say_hello',
        title: 'Say hello',
        statement: 'Write hello(name) so it returns a greeting: Hello, then a space, then the name. Put a comment above the return that says what the function does.',
        starterCode: 'def hello(name):\n    pass\n',
        tests: [
          { name: 'greeting for An', expression: 'hello("An")', expected: 'Hello, An' },
          { name: 'greeting for Mai', expression: 'hello("Mai")', expected: 'Hello, Mai' },
          { name: 'greeting for world', expression: 'hello("world")', expected: 'Hello, world' },
        ],
      },
      exercises: [
        { id: 'say_hello', title: 'Say hello' },
        { id: 'join_words', title: 'Join two words' },
        { id: 'sign_the_program', title: 'Sign the program' },
      ],
      quiz: studyModule(pythonCourse, 'getting_started')!.quiz.map(({ id, prompt, choices }) => ({ id, prompt, choices, result: null })),
    })
    expect(state.masteryThreshold).toBe(0.9)
    expect(state.conversation).toEqual([])
    expect(state.displayName).toBe('An')
    expect(JSON.stringify(state)).not.toContain('return "Hello, " + name')
    expect(await store.resumePoint(signedInStudent)).toEqual({
      moduleId: 'getting_started',
      exerciseId: 'say_hello',
    })
  })

  it('stays on the open module when the student chooses a closed one', async () => {
    const store = memoryStore()
    await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'message', text: 'What is a program?' },
    }, store, speakingTeacher())
    const before = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'open' },
    }, store)

    const state = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'select_module', moduleId: 'lists_and_tuples' },
    }, store)

    expect(state.workingArea.moduleId).toBe('getting_started')
    expect(state.workingArea.exercise.id).toBe(before.workingArea.exercise.id)
    expect(state.conversation.map(message => message.text)).toEqual(before.conversation.map(message => message.text))
    expect(state.courseRoadmap.find(module => module.id === 'lists_and_tuples')).toMatchObject({
      state: 'closed',
      current: false,
      closedReason: 'Not available yet',
    })
    expect(state.courseRoadmap.find(module => module.id === 'getting_started')).toMatchObject({
      state: 'open',
      current: true,
    })
    expect(await store.resumePoint(signedInStudent)).toEqual({
      moduleId: 'getting_started',
      exerciseId: 'say_hello',
    })
  })

  it('previews an unlocked module without moving the resume point', async () => {
    const store = memoryStore()
    await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'open' },
    }, store)
    await store.saveResumePoint(signedInStudent, {
      moduleId: 'getting_started',
      exerciseId: 'join_words',
    })

    const state = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'preview_module', moduleId: 'getting_started' },
    }, store)

    expect(state.workingArea.moduleId).toBe('getting_started')
    expect(state.workingArea.exercise.id).toBe('join_words')
    expect(await store.resumePoint(signedInStudent)).toEqual({
      moduleId: 'getting_started',
      exerciseId: 'join_words',
    })
  })

  it('opens the unlocked module on its conversation and resume-point exercise', async () => {
    const store = memoryStore()
    await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'message', text: 'What is a program?' },
    }, store, speakingTeacher())
    await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'select_exercise', exerciseId: 'join_words' },
    }, store)

    const state = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'select_module', moduleId: 'getting_started' },
    }, store)

    expect(state.workingArea.moduleId).toBe('getting_started')
    expect(state.workingArea.moduleName).toBe('Getting Started with Programming and Python')
    expect(state.workingArea.exercise.id).toBe('join_words')
    expect(state.conversation.some(message => message.text === 'What is a program?')).toBe(true)
    expect(state.courseRoadmap.filter(module => module.current).map(module => module.id)).toEqual(['getting_started'])
  })

  it('keeps a stored for_loop conversation when Module 5 is closed', async () => {
    const store = memoryStore()
    await store.saveResumePoint(signedInStudent, {
      moduleId: 'for_loop',
      exerciseId: 'sum_of_a_list',
    })
    await store.appendMessage(signedInStudent, 'for_loop', {
      author: 'student',
      approvedMove: null,
      text: 'OLD_LOOP_CONVERSATION',
      exerciseId: 'sum_of_a_list',
    })

    const state = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'open' },
    }, store)

    expect(state.workingArea.moduleId).toBe('getting_started')
    expect(JSON.stringify(state)).not.toContain('OLD_LOOP_CONVERSATION')
    expect(await store.resumePoint(signedInStudent)).toEqual({
      moduleId: 'for_loop',
      exerciseId: 'sum_of_a_list',
    })
    expect((await store.messages(signedInStudent, 'for_loop')).map(message => message.text)).toEqual([
      'OLD_LOOP_CONVERSATION',
    ])
  })

  it('select_exercise redraws the chosen exercise and does not keep a draft', async () => {
    const store = memoryStore()
    const opened = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'open' },
    }, store)

    const state = await handleTurn({
      sessionStudentId: signedInStudent,
      body: {
        event: 'select_exercise',
        exerciseId: 'join_words',
        draft: 'def count_even(ds):\n    return 999\n',
      },
    }, store)

    expect(state.displayName).toBe('An')
    expect(state.courseRoadmap).toEqual(opened.courseRoadmap)
    expect(state.workingArea.mode).toBeNull()
    expect(state.workingArea.moduleId).toBe('getting_started')
    expect(state.workingArea.exercises).toEqual([
      { id: 'say_hello', title: 'Say hello' },
      { id: 'join_words', title: 'Join two words' },
      { id: 'sign_the_program', title: 'Sign the program' },
    ])
    expect(state.workingArea.exercise).toEqual({
      id: 'join_words',
      title: 'Join two words',
      statement: 'Write join_words(first, second) so it returns the two words with a space between them.',
      starterCode: 'def join_words(first, second):\n    pass\n',
      tests: [
        { name: 'hello and a name', expression: 'join_words("Hello", "An")', expected: 'Hello An' },
        { name: 'two words', expression: 'join_words("Python", "program")', expected: 'Python program' },
        { name: 'a short start', expression: 'join_words("Good", "start")', expected: 'Good start' },
      ],
    })
    expect(state.conversation.map(message => ({
      author: message.author,
      text: message.text,
      exerciseId: message.exerciseId,
    }))).toEqual([
      {
        author: 'event',
        text: 'Join two words',
        exerciseId: 'join_words',
      },
    ])
    expect(JSON.stringify(state)).not.toContain('return 999')
  })

  it('open returns the conversation in the order it was written', async () => {
    const store = memoryStore()
    const model = speakingTeacher()

    await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'message', text: 'Where does the total live?' },
    }, store, model)
    const sent = await handleTurn({
      sessionStudentId: signedInStudent,
      body: {
        event: 'message',
        text: 'Inside the loop, I think.',
        draft: 'def total(ds):\n    return 999\n',
      },
    }, store, model)

    const state = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'open' },
    }, store)

    expect(state.conversation.map(message => ({
      author: message.author,
      text: message.text,
      exerciseId: message.exerciseId,
      approvedMove: message.approvedMove,
    }))).toEqual([
      {
        author: 'student',
        text: 'Where does the total live?',
        exerciseId: 'say_hello',
        approvedMove: null,
      },
      {
        author: 'teacher',
        text: teacherReply,
        exerciseId: 'say_hello',
        approvedMove: 'explain_concept',
      },
      {
        author: 'student',
        text: 'Inside the loop, I think.',
        exerciseId: 'say_hello',
        approvedMove: null,
      },
      {
        author: 'teacher',
        text: teacherReply,
        exerciseId: 'say_hello',
        approvedMove: 'explain_concept',
      },
    ])
    expect(state.conversation.some(message => message.author === 'deskmate')).toBe(false)
    expect(JSON.stringify(state)).not.toContain('return 999')
    expect(state.workingArea.exercise.id).toBe('say_hello')
    expect(sent.conversation.map(message => message.text)).toEqual([
      'Where does the total live?',
      teacherReply,
      'Inside the loop, I think.',
      teacherReply,
    ])
    expect(sent.courseRoadmap).toEqual(state.courseRoadmap)
    expect(sent.workingArea).toEqual(state.workingArea)
  })

  it('returns the time each message was written', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2026-11-17T09:30:00.000Z'))
      const sent = await handleTurn({
        sessionStudentId: signedInStudent,
        body: { event: 'message', text: 'Where does the total live?' },
      }, memoryStore(), speakingTeacher())

      expect(sent.conversation.map(message => message.createdAt)).toEqual([
        '2026-11-17T09:30:00.000Z',
        '2026-11-17T09:30:00.000Z',
      ])
    }
    finally {
      vi.useRealTimers()
    }
  })

  it('keeps each student\'s conversation separate', async () => {
    const store = memoryStore()

    const an = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'message', text: 'An speaking' },
    }, store, speakingTeacher())

    expect(an.displayName).toBe('An')
    expect(an.conversation.find(message => message.author === 'student')).toMatchObject({
      name: 'An',
    })

    const other = await handleTurn({
      sessionStudentId: otherStudent,
      body: { event: 'open' },
    }, store)

    expect(other.displayName).toBe('Bình')
    expect(other.conversation).toEqual([])
    expect(other.workingArea.moduleId).toBe('getting_started')
    expect(other.workingArea.exercise.id).toBe('say_hello')
  })

  it('select_exercise moves the resume point and leaves an exercise marker', async () => {
    const store = memoryStore()

    await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'message', text: 'Where does the total live?' },
    }, store, speakingTeacher())

    const selected = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'select_exercise', exerciseId: 'join_words' },
    }, store)

    expect(selected.workingArea.exercise.id).toBe('join_words')
    expect(selected.conversation.map(message => ({
      author: message.author,
      text: message.text,
      exerciseId: message.exerciseId,
      approvedMove: message.approvedMove,
    }))).toEqual([
      {
        author: 'student',
        text: 'Where does the total live?',
        exerciseId: 'say_hello',
        approvedMove: null,
      },
      {
        author: 'teacher',
        text: teacherReply,
        exerciseId: 'say_hello',
        approvedMove: 'explain_concept',
      },
      {
        author: 'event',
        text: 'Join two words',
        exerciseId: 'join_words',
        approvedMove: null,
      },
    ])
    expect(selected.conversation.some(message => message.author === 'deskmate')).toBe(false)

    const reopened = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'open' },
    }, store)

    expect(reopened.displayName).toBe('An')
    expect(reopened.workingArea.moduleId).toBe('getting_started')
    expect(reopened.workingArea.exercise.id).toBe('join_words')
    expect(reopened.conversation).toEqual(selected.conversation)
    expect(reopened.conversation.find(message => message.author === 'student')).toMatchObject({
      name: 'An',
    })

    const followed = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'message', text: 'Are evens the ones that divide by two?' },
    }, store, speakingTeacher())

    expect(followed.conversation.at(-2)).toMatchObject({
      author: 'student',
      text: 'Are evens the ones that divide by two?',
      exerciseId: 'join_words',
      approvedMove: null,
    })
    expect(followed.conversation.at(-1)).toMatchObject({
      author: 'teacher',
      text: teacherReply,
      exerciseId: 'join_words',
      approvedMove: 'explain_concept',
    })
  })

  it('answers a message with one streamed Teacher message carrying its move', async () => {
    const store = memoryStore()
    const model = createFakeAgents({
      proposal: { type: 'explain_concept', scope: 'getting_started' },
      text: 'The total has to exist before the loop starts.',
    })

    const events = []
    for await (const event of streamTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'message', text: 'Where does the total live?' },
    }, store, model)) {
      events.push(event)
    }

    const spoken = events
      .filter(event => event.type === 'text')
      .map(event => event.delta)
      .join('')
    const finished = events.at(-1)

    expect(spoken).toBe('The total has to exist before the loop starts.')
    expect(events.findIndex(event => event.type === 'text')).toBeLessThan(events.length - 1)
    expect(finished?.type).toBe('state')
    if (finished?.type !== 'state') return

    expect(finished.state.displayName).toBe('An')
    expect(finished.state.conversation.map(message => ({
      author: message.author,
      name: message.name,
      role: message.role,
      text: message.text,
      approvedMove: message.approvedMove,
    }))).toEqual([
      {
        author: 'student',
        name: 'An',
        role: 'Student',
        text: 'Where does the total live?',
        approvedMove: null,
      },
      {
        author: 'teacher',
        name: 'Teacher',
        role: 'Explanation',
        text: 'The total has to exist before the loop starts.',
        approvedMove: 'explain_concept',
      },
    ])
    expect(finished.state.workingArea.moduleId).toBe('getting_started')
    expect(finished.state.courseRoadmap.find(module => module.id === 'lists_and_tuples')).toMatchObject({
      state: 'closed',
      closedReason: 'Not available yet',
    })
  })

  it('answers with the Teacher first and then Mai', async () => {
    const store = memoryStore()
    const model = createFakeAgents(
      {
        proposal: { type: 'explain_concept', scope: 'getting_started' },
        text: 'The total has to exist before the loop starts.',
      },
      {
        proposal: { type: 'peer_question' },
        text: 'wait, does the total live outside the loop?',
      },
    )

    const events = []
    for await (const event of streamTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'message', text: 'Where does the total live?' },
    }, store, model)) {
      events.push(event)
    }

    const textEvents = events.filter(event => event.type === 'text')
    const teacherSpoken = textEvents
      .filter(event => event.author === 'teacher')
      .map(event => event.delta)
      .join('')
    const maiSpoken = textEvents
      .filter(event => event.author === 'deskmate')
      .map(event => event.delta)
      .join('')
    const lastTeacher = textEvents.findLastIndex(event => event.author === 'teacher')
    const firstMai = textEvents.findIndex(event => event.author === 'deskmate')
    const finished = events.at(-1)

    expect(teacherSpoken).toBe('The total has to exist before the loop starts.')
    expect(maiSpoken).toBe('wait, does the total live outside the loop?')
    expect(firstMai).toBeGreaterThan(lastTeacher)
    expect(finished?.type).toBe('state')
    if (finished?.type !== 'state') return

    expect(finished.state.conversation.map(message => ({
      author: message.author,
      name: message.name,
      role: message.role,
      text: message.text,
      approvedMove: message.approvedMove,
    }))).toEqual([
      {
        author: 'student',
        name: 'An',
        role: 'Student',
        text: 'Where does the total live?',
        approvedMove: null,
      },
      {
        author: 'teacher',
        name: 'Teacher',
        role: 'Explanation',
        text: 'The total has to exist before the loop starts.',
        approvedMove: 'explain_concept',
      },
      {
        author: 'deskmate',
        name: 'Mai',
        role: 'Deskmate',
        text: 'wait, does the total live outside the loop?',
        approvedMove: 'peer_question',
      },
    ])
  })

  it('gives the Teacher the draft and latest Run output without storing either', async () => {
    const store = memoryStore()
    const model = createFakeAgents({
      proposal: { type: 'answer_question', scope: 'getting_started' },
      text: 'Look at the variable that survives the loop.',
    })
    const draft = 'def total(ds):\n    DRAFT_SENTINEL_42 = 0\n'
    const run = { stdout: 'RUN_OUTPUT_SENTINEL_42\n', stderr: '', error: null }

    const state = await handleTurn({
      sessionStudentId: signedInStudent,
      body: {
        event: 'message',
        text: 'Why is this zero?',
        draft,
        run,
      },
    }, store, model)

    const teacherExchanges = model.exchanges.filter(exchange => exchange.agent === 'teacher')
    expect(teacherExchanges.map(exchange => exchange.phase)).toEqual(['propose', 'render'])
    for (const exchange of teacherExchanges) {
      expect(exchange.context.draft).toBe(draft)
      expect(exchange.context.runOutput).toEqual(run)
      expect(JSON.stringify(exchange.context.materials)).toContain('A first program')
      expect(JSON.stringify(exchange.context.materials)).toContain('# Show a greeting\\nprint(\\"Hello, world\\")')
      expect(JSON.stringify(exchange.context.materials)).toContain('These materials belong to this module alone.')
      expect(exchange.context.hintLadder).toEqual([
        'Text you want to show or return sits between quotes, like "Hello".',
        'Join two pieces of text with +. A space is text as well: " ".',
        'Return the text you built. A comment starts with # and does not change what is returned.',
      ])
      expect(exchange.context.misconceptionResponses).toEqual([
        {
          id: 'missing_quotes',
          response: 'The words are missing their quotes, so Python looks for a variable instead of using the text. Put the text between quotes.',
        },
      ])
      expect(exchange.context.exercise).toEqual({
        id: 'say_hello',
        title: 'Say hello',
        statement: 'Write hello(name) so it returns a greeting: Hello, then a space, then the name. Put a comment above the return that says what the function does.',
        starterCode: 'def hello(name):\n    pass\n',
      })
      expect(exchange.context.conversation.map(message => message.text)).toContain('Why is this zero?')
    }

    expect(state.conversation.filter(message => message.author === 'teacher')).toEqual([
      expect.objectContaining({
        text: 'Look at the variable that survives the loop.',
        approvedMove: 'answer_question',
      }),
    ])
    expect(JSON.stringify(state)).not.toContain('DRAFT_SENTINEL_42')
    expect(JSON.stringify(state)).not.toContain('RUN_OUTPUT_SENTINEL_42')

    const reopened = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'open' },
    }, store)
    expect(JSON.stringify(reopened)).not.toContain('DRAFT_SENTINEL_42')
    expect(JSON.stringify(reopened)).not.toContain('RUN_OUTPUT_SENTINEL_42')
  })

  describe('hint ladder memory', () => {
    const rungs = [
      'Text you want to show or return sits between quotes, like "Hello".',
      'Join two pieces of text with +. A space is text as well: " ".',
      'Return the text you built. A comment starts with # and does not change what is returned.',
    ]

    // A language model whose Teacher proposes the given hint rungs in turn, Mai stays quiet, and
    // every prompt is kept.
    function hintingModel(levels: number[]) {
      const proposePrompts: string[] = []
      const renderPrompts: string[] = []
      const languageModel: LanguageModel = {
        async proposeMove(instructions, prompt, schema) {
          if (!instructions.includes('You are the Teacher')) return null
          proposePrompts.push(prompt)
          const level = levels[proposePrompts.length - 1]
          return schema.parse({ proposal: level ? { type: 'hint_level_N', level, scope: 'getting_started' } : null }).proposal
        },
        async proposeWithTools(instructions, prompt, schema) {
          return { proposal: await this.proposeMove(instructions, prompt, schema), ended: 'proposed' }
        },
        async* streamReply(_instructions, prompt) {
          renderPrompts.push(prompt)
          yield `Rung ${renderPrompts.length} given.`
        },
      }
      return { agents: createAgents(languageModel), proposePrompts, renderPrompts }
    }

    it('shows an earlier Teacher hint in the next prompt with the move that approved it', async () => {
      const store = memoryStore()
      const { agents, proposePrompts, renderPrompts } = hintingModel([1, 2])

      for (const text of ['I am stuck.', 'Still stuck.']) {
        await handleTurn({
          sessionStudentId: signedInStudent,
          body: { event: 'message', text },
        }, store, agents)
      }

      expect(proposePrompts[1]).toContain('teacher [hint_level_1]: Rung 1 given.')
      expect(proposePrompts[1]).toContain('student: <student_data>\nStill stuck.\n</student_data>')
      expect(renderPrompts[1]).toContain('teacher [hint_level_1]: Rung 1 given.')
    })

    // Rung 1 is given first, because the VerifyShield's hint ladder rule (#133) downgrades a rung
    // above the next one, so hint_level_2 is only ever approved once rung 1 has been given.
    it('renders hint_level_2 from rung 2 alone', async () => {
      const store = memoryStore()
      const { agents, renderPrompts } = hintingModel([1, 2])

      for (const text of ['I am stuck.', 'Still stuck.']) {
        await handleTurn({
          sessionStudentId: signedInStudent,
          body: { event: 'message', text },
        }, store, agents)
      }

      expect(renderPrompts).toHaveLength(2)
      expect(renderPrompts[1]).toContain(rungs[1])
      expect(renderPrompts[1]).not.toContain(rungs[0])
      expect(renderPrompts[1]).not.toContain(rungs[2])
      expect(renderPrompts[1]).toContain('Approved move: hint_level_2')
    })

    it('lets the Teacher choose a rung from the whole ladder when proposing', async () => {
      const { agents, proposePrompts } = hintingModel([2])

      await handleTurn({
        sessionStudentId: signedInStudent,
        body: { event: 'message', text: 'I am stuck.' },
      }, memoryStore(), agents)

      for (const rung of rungs) expect(proposePrompts[0]).toContain(rung)
    })
  })

  it('blocks a Deskmate hint and does not render it', async () => {
    const store = memoryStore()
    const model = createFakeAgents(
      {
        proposal: { type: 'explain_concept', scope: 'getting_started' },
        text: teacherReply,
      },
      {
        proposal: { type: 'hint_level_N', level: 2, scope: 'getting_started' },
        text: 'HINT_SHOULD_NOT_RENDER',
      },
    )

    const state = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'message', text: 'Just tell me the next step.' },
    }, store, model)

    expect(model.exchanges.filter(exchange => exchange.agent === 'deskmate').map(exchange => exchange.phase)).toEqual(['propose'])
    expect(state.conversation.map(message => ({
      author: message.author,
      text: message.text,
      approvedMove: message.approvedMove,
    }))).toEqual([
      {
        author: 'student',
        text: 'Just tell me the next step.',
        approvedMove: null,
      },
      {
        author: 'teacher',
        text: teacherReply,
        approvedMove: 'explain_concept',
      },
    ])
    expect(JSON.stringify(state)).not.toContain('HINT_SHOULD_NOT_RENDER')
  })

  it('reports both proposals and a blocked Deskmate move, and does not keep them', async () => {
    const store = memoryStore()
    const model = createFakeAgents(
      {
        proposal: { type: 'explain_concept', scope: 'getting_started' },
        text: teacherReply,
      },
      {
        proposal: { type: 'hint_level_N', level: 2, scope: 'getting_started' },
        text: 'HINT_SHOULD_NOT_RENDER',
      },
    )

    const state = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'message', text: 'Just tell me the next step.' },
    }, store, model)

    expect(state.trace).toMatchObject({
      active: false,
      agents: [
        {
          agent: 'teacher',
          proposal: 'explain_concept',
          verdict: {
            decision: 'allow',
            ruleId: 'role_table',
            reasonCode: 'ROLE_PERMITTED',
          },
        },
        {
          agent: 'deskmate',
          proposal: 'hint_level_2',
          verdict: {
            decision: 'block',
            ruleId: 'role_table',
            reasonCode: 'ROLE_FORBIDDEN',
          },
        },
      ],
    })

    const reopened = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'open' },
    }, store)
    expect(reopened.trace).toBeUndefined()
    expect(JSON.stringify(reopened)).not.toContain('hint_level_2')
    expect(JSON.stringify(reopened)).not.toContain('ROLE_FORBIDDEN')
    expect(JSON.stringify(reopened)).not.toContain('role_table')
  })

  it('downgrades a skipped hint to the next rung above the highest stored one', async () => {
    const store = memoryStore()
    // The teacher already climbed to rung 1 in this module's conversation.
    await store.appendMessage(signedInStudent, 'getting_started', {
      author: 'teacher',
      approvedMove: 'hint_level_1',
      text: 'A running total has to exist before the loop.',
      exerciseId: 'say_hello',
    })
    const model = createFakeAgents({
      proposal: { type: 'hint_level_N', level: 3, scope: 'getting_started' },
      text: 'The downgraded rung two hint.',
    })

    const state = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'message', text: 'Give me a hint.' },
    }, store, model)

    expect(state.trace).toMatchObject({
      agents: [
        {
          agent: 'teacher',
          proposal: 'hint_level_3',
          verdict: {
            decision: 'downgrade',
            ruleId: 'hint_ladder',
            reasonCode: 'HINT_SKIPPED',
          },
        },
        {
          agent: 'deskmate',
          proposal: null,
          verdict: null,
        },
      ],
    })
    expect(state.conversation.map(message => ({
      author: message.author,
      approvedMove: message.approvedMove,
    }))).toEqual([
      { author: 'teacher', approvedMove: 'hint_level_1' },
      { author: 'student', approvedMove: null },
      { author: 'teacher', approvedMove: 'hint_level_2' },
    ])
  })

  it('lets the Teacher address a misconception the quiz answers show', async () => {
    const store = memoryStore()
    const quizAnswers = createMemoryQuizAnswerStore()
    await quizAnswers.record({
      studentId: signedInStudent,
      moduleId: 'getting_started',
      questionId: 'print-text',
      choice: 0,
      correct: false,
    })
    const model = createFakeAgents({
      proposal: { type: 'address_misconception', misconceptionId: 'missing_quotes', scope: 'getting_started' },
      text: 'The words need quotes around them.',
    })

    const state = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'message', text: 'Why does print(Hello) fail?' },
    }, store, model, { quizAnswers })

    expect(state.trace?.agents[0]).toMatchObject({
      agent: 'teacher',
      proposal: 'address_misconception:missing_quotes',
      verdict: { decision: 'allow', reasonCode: 'ROLE_PERMITTED' },
    })
    expect(state.conversation.at(-1)).toMatchObject({
      author: 'teacher',
      approvedMove: 'address_misconception:missing_quotes',
    })
  })

  it('answers the question instead when nothing the student did shows the misconception', async () => {
    const store = memoryStore()
    const model = createFakeAgents({
      proposal: { type: 'address_misconception', misconceptionId: 'accumulator_reset_inside_loop', scope: 'getting_started' },
      text: 'Python reads a bare word as a variable name.',
    })

    const state = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'message', text: 'Why does print(Hello) fail?' },
    }, store, model)

    expect(state.trace?.agents[0]).toMatchObject({
      agent: 'teacher',
      proposal: 'address_misconception:accumulator_reset_inside_loop',
      verdict: {
        decision: 'downgrade',
        ruleId: 'misconception_shown',
        reasonCode: 'MISCONCEPTION_NOT_SHOWN',
      },
    })
    expect(state.conversation.at(-1)).toMatchObject({
      author: 'teacher',
      approvedMove: 'answer_question',
      text: 'Python reads a bare word as a variable name.',
    })
  })

  it('reports an agent that made no proposal', async () => {
    const store = memoryStore()
    const state = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'message', text: 'Where does the total live?' },
    }, store, createFakeAgents(
      {
        proposal: { type: 'explain_concept', scope: 'getting_started' },
        text: teacherReply,
      },
      {
        proposal: null,
        text: 'QUIET_MAI_TEXT',
      },
    ))

    expect(state.trace).toMatchObject({
      active: false,
      agents: [
        {
          agent: 'teacher',
          proposal: 'explain_concept',
          verdict: {
            decision: 'allow',
            ruleId: 'role_table',
            reasonCode: 'ROLE_PERMITTED',
          },
        },
        {
          agent: 'deskmate',
          proposal: null,
          verdict: null,
        },
      ],
    })
    expect(JSON.stringify(state.conversation)).not.toContain('QUIET_MAI_TEXT')
  })

  it('reports the opening turn as the Teacher proposal and no Deskmate proposal', async () => {
    const store = memoryStore()
    const state = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'open' },
    }, store, speakingTeacher())

    expect(state.trace).toMatchObject({
      active: false,
      agents: [
        {
          agent: 'teacher',
          proposal: 'explain_concept',
          verdict: {
            decision: 'allow',
            ruleId: 'role_table',
            reasonCode: 'ROLE_PERMITTED',
          },
        },
        {
          agent: 'deskmate',
          proposal: null,
          verdict: null,
        },
      ],
    })
  })

  it('gives Mai only the exercise statement, student work, and conversation', async () => {
    const store = memoryStore()
    const draft = 'def total(ds):\n    MAI_DRAFT_SENTINEL = 0\n'
    const run = { stdout: 'MAI_RUN_SENTINEL\n', stderr: '', error: null }
    const model = createFakeAgents(
      {
        proposal: { type: 'hint_level_N', level: 1, scope: 'getting_started' },
        text: teacherReply,
      },
      {
        proposal: { type: 'share_confusion' },
        text: 'i keep getting zero too.',
      },
    )

    await handleTurn({
      sessionStudentId: signedInStudent,
      body: {
        event: 'message',
        text: 'Why is this zero?',
        draft,
        run,
      },
    }, store, model)

    const given = model.exchanges.filter(exchange => exchange.agent === 'deskmate')
    expect(given.map(exchange => exchange.phase)).toEqual(['propose', 'render'])
    const [propose, render] = given
    const allowed = {
      exerciseStatement: 'Write hello(name) so it returns a greeting: Hello, then a space, then the name. Put a comment above the return that says what the function does.',
      draft,
      runOutput: run,
      submission: null,
      answeredQuiz: [],
    }
    expect(propose?.context).toEqual({
      ...allowed,
      conversation: [
        {
          author: 'student',
          text: 'Why is this zero?',
          approvedMove: null,
        },
      ],
    })
    expect(render?.context).toEqual({
      ...allowed,
      conversation: [
        {
          author: 'student',
          text: 'Why is this zero?',
          approvedMove: null,
        },
        {
          author: 'teacher',
          text: teacherReply,
          approvedMove: 'hint_level_1',
        },
      ],
    })
    for (const exchange of given) {
      const rendered = JSON.stringify(exchange.context)
      expect(rendered).not.toContain('Accumulating a total')
      expect(rendered).not.toContain('A running total has to be created before the loop. A variable created inside the loop starts again on every pass.')
      expect(rendered).not.toContain('starterCode')
      expect(rendered).not.toContain('solution')
    }
  })

  it('introduces Mai as a peer learning alongside the student in both model calls', async () => {
    const languageModel: LanguageModel = {
      async proposeMove(_instructions, _prompt, schema) {
        return schema.parse({ proposal: { type: 'share_confusion' } }).proposal
      },
      async* streamReply() {
        yield 'I am figuring that out too.'
      },
    }
    const proposeMove = vi.spyOn(languageModel, 'proposeMove')
    const streamReply = vi.spyOn(languageModel, 'streamReply')
    const { deskmate } = createAgents(languageModel)
    const context = {
      exerciseStatement: 'Write a greeting.',
      draft: null,
      runOutput: null,
      submission: null,
      conversation: [],
      answeredQuiz: [],
    }

    const move = await deskmate.propose(context)
    expect(move).toEqual({ type: 'share_confusion' })
    if (move) deskmate.render(context, move)

    const asMai = [
      expect.stringMatching(/Mai.*at the student's level.*learning alongside them/i),
      expect.stringContaining(context.exerciseStatement),
    ]
    expect(proposeMove).toHaveBeenCalledWith(...asMai, proposalSchema)
    expect(streamReply).toHaveBeenCalledWith(...asMai)
  })

  it('produces no message for an agent that makes no proposal', async () => {
    const store = memoryStore()
    const quietMai = createFakeAgents(
      {
        proposal: { type: 'explain_concept', scope: 'getting_started' },
        text: teacherReply,
      },
      {
        proposal: null,
        text: 'QUIET_MAI_TEXT',
      },
    )

    const teacherOnly = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'message', text: 'Where does the total live?' },
    }, store, quietMai)

    expect(quietMai.exchanges.filter(exchange => exchange.agent === 'deskmate').map(exchange => exchange.phase)).toEqual(['propose'])
    expect(teacherOnly.conversation.map(message => message.author)).toEqual(['student', 'teacher'])
    expect(JSON.stringify(teacherOnly)).not.toContain('QUIET_MAI_TEXT')

    const quietTeacher = createFakeAgents(
      {
        proposal: null,
        text: 'QUIET_TEACHER_AGAIN',
      },
      {
        proposal: { type: 'share_confusion' },
        text: 'i keep getting zero too.',
      },
    )
    const maiOnly = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'message', text: 'Mine is zero as well.' },
    }, store, quietTeacher)

    expect(quietTeacher.exchanges.filter(exchange => exchange.agent === 'teacher').map(exchange => exchange.phase)).toEqual(['propose'])
    expect(maiOnly.conversation.slice(-2).map(message => ({
      author: message.author,
      name: message.name,
      role: message.role,
      text: message.text,
      approvedMove: message.approvedMove,
    }))).toEqual([
      {
        author: 'student',
        name: 'An',
        role: 'Student',
        text: 'Mine is zero as well.',
        approvedMove: null,
      },
      {
        author: 'deskmate',
        name: 'Mai',
        role: 'Deskmate',
        text: 'i keep getting zero too.',
        approvedMove: 'share_confusion',
      },
    ])
    expect(JSON.stringify(maiOnly)).not.toContain('QUIET_TEACHER_AGAIN')
  })

  it('stays quiet when the Teacher proposes no move', async () => {
    const store = memoryStore()
    const model = createFakeAgents({
      proposal: null,
      text: 'QUIET_TEACHER_TEXT',
    })

    const state = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'message', text: 'Hello' },
    }, store, model)

    expect(model.exchanges.filter(exchange => exchange.agent === 'teacher').map(exchange => exchange.phase)).toEqual(['propose'])
    expect(state.conversation.map(message => message.author)).toEqual(['student'])
    expect(JSON.stringify(state)).not.toContain('QUIET_TEACHER_TEXT')
  })

  it('does not render a Teacher move the role table forbids', async () => {
    const store = memoryStore()
    const model = createFakeAgents({
      proposal: { type: 'peer_question' },
      text: 'FORBIDDEN_TEACHER_TEXT',
    })

    const state = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'message', text: 'Hello' },
    }, store, model)

    expect(model.exchanges.filter(exchange => exchange.agent === 'teacher').map(exchange => exchange.phase)).toEqual(['propose'])
    expect(state.conversation.map(message => message.author)).toEqual(['student'])
    expect(JSON.stringify(state)).not.toContain('FORBIDDEN_TEACHER_TEXT')
  })

  it('lets Mai speak when the Teacher cannot answer', async () => {
    const store = memoryStore()
    const events = []
    for await (const event of streamTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'message', text: 'Where does the total live?' },
    }, store, createFakeAgents(
      {
        proposal: { type: 'explain_concept', scope: 'getting_started' },
        fail: 'propose',
      },
      {
        proposal: { type: 'peer_question' },
        text: 'i\'m stuck on that too.',
      },
    ))) {
      events.push(event)
    }

    const teacherShown = events.findIndex(event =>
      event.type === 'state'
      && event.state.conversation.some(message => message.author === 'teacher'),
    )
    const firstMai = events.findIndex(event => event.type === 'text' && event.author === 'deskmate')
    expect(teacherShown).toBeGreaterThanOrEqual(0)
    expect(teacherShown).toBeLessThan(firstMai)

    const finished = events.at(-1)
    expect(finished?.type).toBe('state')
    if (finished?.type !== 'state') return
    const state = finished.state

    expect(state.conversation.map(message => ({
      author: message.author,
      name: message.name,
      role: message.role,
      text: message.text,
      approvedMove: message.approvedMove,
    }))).toEqual([
      {
        author: 'student',
        name: 'An',
        role: 'Student',
        text: 'Where does the total live?',
        approvedMove: null,
      },
      {
        author: 'teacher',
        name: 'Teacher',
        role: '',
        text: 'The Teacher could not answer just now. Please try again.',
        approvedMove: null,
      },
      {
        author: 'deskmate',
        name: 'Mai',
        role: 'Deskmate',
        text: 'i\'m stuck on that too.',
        approvedMove: 'peer_question',
      },
    ])
    expect(state.courseRoadmap.length).toBeGreaterThan(0)
    expect(state.workingArea.moduleId).toBe('getting_started')
  })

  it('stores a friendly Mai line, with no move, when she cannot answer', async () => {
    const store = memoryStore()
    const state = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'message', text: 'Where does the total live?' },
    }, store, createFakeAgents(
      {
        proposal: { type: 'explain_concept', scope: 'getting_started' },
        text: teacherReply,
      },
      {
        proposal: { type: 'peer_question' },
        text: 'PARTIAL_MAI_TEXT',
        fail: 'render',
      },
    ))

    expect(state.conversation.map(message => ({
      author: message.author,
      text: message.text,
      approvedMove: message.approvedMove,
    }))).toEqual([
      {
        author: 'student',
        text: 'Where does the total live?',
        approvedMove: null,
      },
      {
        author: 'teacher',
        text: teacherReply,
        approvedMove: 'explain_concept',
      },
      {
        author: 'deskmate',
        text: 'Mai could not answer just now. Please try again.',
        approvedMove: null,
      },
    ])
    expect(JSON.stringify(state)).not.toContain('PARTIAL_MAI_TEXT')
  })

  it('returns a full redraw with a friendly fallback when the model fails', async () => {
    const store = memoryStore()
    const opened = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'open' },
    }, store)

    const state = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'message', text: 'Where does the total live?' },
    }, store, createFakeAgents({
      proposal: { type: 'explain_concept', scope: 'getting_started' },
      fail: 'propose',
    }))

    expect(state.courseRoadmap).toEqual(opened.courseRoadmap)
    expect(state.workingArea).toEqual({ ...opened.workingArea, mode: null })
    expect(state.conversation.map(message => ({
      author: message.author,
      name: message.name,
      role: message.role,
      text: message.text,
      approvedMove: message.approvedMove,
    }))).toEqual([
      {
        author: 'student',
        name: 'An',
        role: 'Student',
        text: 'Where does the total live?',
        approvedMove: null,
      },
      {
        author: 'teacher',
        name: 'Teacher',
        role: '',
        text: 'The Teacher could not answer just now. Please try again.',
        approvedMove: null,
      },
    ])

    const rendered = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'message', text: 'And if it is inside?' },
    }, store, createFakeAgents({
      proposal: { type: 'explain_concept', scope: 'getting_started' },
      text: 'PARTIAL_SHOULD_NOT_STICK',
      fail: 'render',
    }))
    expect(rendered.workingArea).toEqual({ ...opened.workingArea, mode: null })
    expect(rendered.conversation.at(-1)).toMatchObject({
      author: 'teacher',
      text: 'The Teacher could not answer just now. Please try again.',
      approvedMove: null,
    })
    expect(JSON.stringify(rendered)).not.toContain('PARTIAL_SHOULD_NOT_STICK')
  })

  it('uses the scripted Teacher when the fake model is named', async () => {
    const state = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'message', text: 'Where does the total live?' },
    }, memoryStore(), createConfiguredAgents({
      provider: 'fake',
      apiKey: '',
      baseUrl: '',
      modelName: '',
    }))

    expect(state.conversation.map(message => ({
      author: message.author,
      name: message.name,
      role: message.role,
      approvedMove: message.approvedMove,
      text: message.text,
    }))).toEqual([
      {
        author: 'student',
        name: 'An',
        role: 'Student',
        approvedMove: null,
        text: 'Where does the total live?',
      },
      {
        author: 'teacher',
        name: 'Teacher',
        role: 'Explanation',
        approvedMove: 'explain_concept',
        text: 'A running total has to be created before the loop, so each pass can add to the same number.',
      },
      {
        author: 'deskmate',
        name: 'Mai',
        role: 'Deskmate',
        approvedMove: 'peer_question',
        text: 'wait, does the total live outside the loop? i\'m lost too.',
      },
    ])
  })

  it('introduces a module the first time it is opened and starts in Learn', async () => {
    const store = memoryStore()
    const model = createFakeAgents(
      {
        proposal: { type: 'explain_concept', scope: 'getting_started' },
        text: 'A running total survives every pass of the loop.',
      },
      {
        proposal: { type: 'peer_question' },
        text: 'MAI_SHOULD_NOT_SPEAK_ON_OPEN',
      },
    )

    const events = []
    for await (const event of streamTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'open' },
    }, store, model)) {
      events.push(event)
    }

    const spoken = events
      .filter(event => event.type === 'text')
      .map(event => event.author === 'teacher' ? event.delta : `UNEXPECTED_${event.author}`)
      .join('')
    const finished = events.at(-1)

    expect(spoken).toBe('A running total survives every pass of the loop.')
    expect(finished?.type).toBe('state')
    if (finished?.type !== 'state') return

    expect(finished.state.workingArea.mode).toBe('learn')
    expect(finished.state.conversation.map(message => ({
      author: message.author,
      name: message.name,
      role: message.role,
      text: message.text,
      approvedMove: message.approvedMove,
      openInLearn: message.openInLearn,
    }))).toEqual([
      {
        author: 'teacher',
        name: 'Teacher',
        role: 'Explanation',
        text: 'A running total survives every pass of the loop.',
        approvedMove: 'explain_concept',
        openInLearn: true,
      },
    ])
    expect(JSON.stringify(finished.state)).not.toContain('MAI_SHOULD_NOT_SPEAK_ON_OPEN')
    expect(model.exchanges.filter(exchange => exchange.agent === 'teacher').map(exchange => exchange.phase)).toEqual(['propose', 'render'])
    for (const exchange of model.exchanges) {
      expect(exchange.agent).toBe('teacher')
      if (exchange.agent !== 'teacher') continue
      expect(exchange.context.conversation).toEqual([])
      expect(JSON.stringify(exchange.context.materials)).toContain('A first program')
    }
  })

  it('introduces the module with a teaching move when the model proposes another move', async () => {
    const store = memoryStore()
    const model = createFakeAgents({
      proposal: { type: 'stay_and_practise' },
      text: 'A running total survives every pass of the loop.',
    })

    const state = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'open' },
    }, store, model)

    expect(state.workingArea.mode).toBe('learn')
    expect(state.conversation.map(message => ({
      author: message.author,
      text: message.text,
      approvedMove: message.approvedMove,
      openInLearn: message.openInLearn,
    }))).toEqual([
      {
        author: 'teacher',
        text: 'A running total survives every pass of the loop.',
        approvedMove: 'explain_concept',
        openInLearn: true,
      },
    ])
    expect(model.exchanges.map(exchange => exchange.phase)).toEqual(['propose', 'render'])
    expect(model.exchanges.at(-1)?.move).toEqual({ type: 'explain_concept', scope: 'getting_started' })
    expect(state.trace).toMatchObject({
      active: false,
      agents: [
        {
          agent: 'teacher',
          proposal: 'stay_and_practise',
          verdict: {
            decision: 'allow',
            ruleId: 'role_table',
            reasonCode: 'ROLE_PERMITTED',
          },
        },
        {
          agent: 'deskmate',
          proposal: null,
          verdict: null,
        },
      ],
    })
  })

  it('reports that the Teacher made no proposal when opening stays quiet', async () => {
    const store = memoryStore()
    const state = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'open' },
    }, store, createFakeAgents({
      proposal: null,
      text: 'A running total survives every pass of the loop.',
    }))

    expect(state.conversation.map(message => message.approvedMove)).toEqual(['explain_concept'])
    expect(state.trace).toMatchObject({
      active: false,
      agents: [
        {
          agent: 'teacher',
          proposal: null,
          verdict: null,
        },
        {
          agent: 'deskmate',
          proposal: null,
          verdict: null,
        },
      ],
    })
  })

  it('reports that nobody proposed when the opening proposal fails', async () => {
    const store = memoryStore()
    const state = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'open' },
    }, store, createFakeAgents({
      proposal: { type: 'explain_concept', scope: 'getting_started' },
      fail: 'propose',
    }))

    expect(state.conversation).toEqual([])
    expect(state.trace).toMatchObject({
      active: false,
      agents: [
        {
          agent: 'teacher',
          proposal: null,
          verdict: null,
        },
        {
          agent: 'deskmate',
          proposal: null,
          verdict: null,
        },
      ],
    })
  })

  it('leaves the module unintroduced when the opening reply fails, so the next open can introduce it', async () => {
    const store = memoryStore()
    const failed = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'open' },
    }, store, createFakeAgents({
      proposal: { type: 'explain_concept', scope: 'getting_started' },
      text: 'PARTIAL_OPENING_SHOULD_NOT_STICK',
      fail: 'render',
    }))

    expect(failed.workingArea.mode).toBe('learn')
    expect(failed.conversation).toEqual([])
    expect(JSON.stringify(failed)).not.toContain('could not answer')
    expect(JSON.stringify(failed)).not.toContain('PARTIAL_OPENING_SHOULD_NOT_STICK')
    expect(failed.trace).toMatchObject({
      active: false,
      agents: [
        {
          agent: 'teacher',
          proposal: 'explain_concept',
          verdict: {
            decision: 'allow',
            ruleId: 'role_table',
            reasonCode: 'ROLE_PERMITTED',
          },
        },
        {
          agent: 'deskmate',
          proposal: null,
          verdict: null,
        },
      ],
    })

    const introduced = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'open' },
    }, store, speakingTeacher())

    expect(introduced.workingArea.mode).toBe('learn')
    expect(introduced.conversation.map(message => ({
      author: message.author,
      approvedMove: message.approvedMove,
      openInLearn: message.openInLearn,
    }))).toEqual([
      {
        author: 'teacher',
        approvedMove: 'explain_concept',
        openInLearn: true,
      },
    ])
  })

  it('does not take an agent turn when the module already has a conversation', async () => {
    const store = memoryStore()
    const earlier = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'message', text: 'Where does the total live?' },
    }, store, speakingTeacher())

    const model = createFakeAgents({
      proposal: { type: 'explain_concept', scope: 'getting_started' },
      text: 'SHOULD_NOT_INTRODUCE_AGAIN',
    })
    const reopened = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'open' },
    }, store, model)

    expect(model.exchanges).toEqual([])
    expect(reopened.workingArea.mode).toBeNull()
    expect(reopened.conversation.map(message => ({
      author: message.author,
      text: message.text,
      approvedMove: message.approvedMove,
    }))).toEqual(earlier.conversation.map(message => ({
      author: message.author,
      text: message.text,
      approvedMove: message.approvedMove,
    })))
    expect(JSON.stringify(reopened)).not.toContain('SHOULD_NOT_INTRODUCE_AGAIN')
  })

  it('offers to open Learn from a teaching reply without changing the working area mode', async () => {
    const store = memoryStore()
    await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'open' },
    }, store, speakingTeacher())

    const explained = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'message', text: 'Where does the total live?' },
    }, store, createFakeAgents({
      proposal: { type: 'explain_concept', scope: 'getting_started' },
      text: 'The total has to exist before the loop starts.',
    }))

    expect(explained.workingArea.mode).toBeNull()
    expect(explained.conversation.at(-1)).toMatchObject({
      author: 'teacher',
      approvedMove: 'explain_concept',
      openInLearn: true,
    })

    const answered = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'message', text: 'Is the total a variable?' },
    }, store, createFakeAgents({
      proposal: { type: 'answer_question', scope: 'getting_started' },
      text: 'Yes. It is a variable that lives outside the loop.',
    }))

    expect(answered.workingArea.mode).toBeNull()
    expect(answered.conversation.at(-1)).toMatchObject({
      author: 'teacher',
      approvedMove: 'answer_question',
      openInLearn: true,
    })
  })

  it('does not offer Learn from a hint, and that turn does not set the working area mode', async () => {
    const store = memoryStore()
    const state = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'message', text: 'I am stuck.' },
    }, store, createFakeAgents({
      proposal: { type: 'hint_level_N', level: 1, scope: 'getting_started' },
      text: 'Create the total before the loop.',
    }))

    expect(state.workingArea.mode).toBeNull()
    expect(state.conversation.at(-1)).toMatchObject({
      author: 'teacher',
      approvedMove: 'hint_level_1',
      openInLearn: false,
    })
  })

  it('records a submission summary and lets the agents answer with no student text', async () => {
    const store = memoryStore()
    const model = createFakeAgents(
      {
        proposal: { type: 'explain_concept', scope: 'getting_started' },
        text: 'The total is still created inside the loop.',
      },
      {
        proposal: { type: 'share_confusion' },
        text: 'mine failed that one too.',
      },
    )
    const code = 'def total(ds):\n    SUBMISSION_CODE_SENTINEL = 0\n'
    const results = [
      { name: 'three numbers', passed: false, expected: '6', actual: '0' },
      { name: 'one number', passed: true, expected: '10', actual: '10' },
      { name: 'empty list', passed: false, expected: 'EXPECTED_SENTINEL', actual: 'ACTUAL_SENTINEL' },
    ]

    const events = []
    for await (const event of streamTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'submission', code, results },
    }, store, model, { sandbox: createFakeSandbox({ outcome: 'checked', results }) })) {
      events.push(event)
    }

    const textEvents = events.filter(event => event.type === 'text')
    const teacherSpoken = textEvents
      .filter(event => event.author === 'teacher')
      .map(event => event.delta)
      .join('')
    const maiSpoken = textEvents
      .filter(event => event.author === 'deskmate')
      .map(event => event.delta)
      .join('')
    const finished = events.at(-1)
    expect(finished?.type).toBe('state')
    if (finished?.type !== 'state') return
    const state = finished.state

    expect(teacherSpoken).toBe('The total is still created inside the loop.')
    expect(maiSpoken).toBe('mine failed that one too.')
    expect(textEvents.findIndex(event => event.author === 'deskmate'))
      .toBeGreaterThan(textEvents.findLastIndex(event => event.author === 'teacher'))
    expect(state.displayName).toBe('An')
    expect(state.workingArea.mode).toBeNull()
    expect(state.conversation.map(message => ({
      author: message.author,
      name: message.name,
      role: message.role,
      text: message.text,
      approvedMove: message.approvedMove,
      openInLearn: message.openInLearn,
    }))).toEqual([
      {
        author: 'event',
        name: 'Practice check',
        role: 'Result',
        text: '1/3 tests passed',
        approvedMove: null,
        openInLearn: false,
      },
      {
        author: 'teacher',
        name: 'Teacher',
        role: 'Explanation',
        text: 'The total is still created inside the loop.',
        approvedMove: 'explain_concept',
        openInLearn: true,
      },
      {
        author: 'deskmate',
        name: 'Mai',
        role: 'Deskmate',
        text: 'mine failed that one too.',
        approvedMove: 'share_confusion',
        openInLearn: false,
      },
    ])
    expect(state.conversation.some(message => message.author === 'student')).toBe(false)
    expect(JSON.stringify(state)).not.toContain('SUBMISSION_CODE_SENTINEL')
    expect(JSON.stringify(state)).not.toContain('EXPECTED_SENTINEL')
    expect(JSON.stringify(state)).not.toContain('ACTUAL_SENTINEL')

    const teacherPropose = model.exchanges.find(exchange => exchange.agent === 'teacher' && exchange.phase === 'propose')
    const deskmatePropose = model.exchanges.find(exchange => exchange.agent === 'deskmate' && exchange.phase === 'propose')
    expect(teacherPropose?.agent).toBe('teacher')
    expect(deskmatePropose?.agent).toBe('deskmate')
    if (teacherPropose?.agent !== 'teacher' || deskmatePropose?.agent !== 'deskmate') return

    expect(teacherPropose.context.submission).toEqual({ code, results })
    expect(teacherPropose.context.draft).toBeNull()
    expect(teacherPropose.context.conversation).toEqual([
      { author: 'event', text: '1/3 tests passed', approvedMove: null },
    ])
    expect(deskmatePropose.context.submission).toEqual({ code, results })
    expect(deskmatePropose.context.conversation).toEqual([
      { author: 'event', text: '1/3 tests passed', approvedMove: null },
    ])
    expect(JSON.stringify(deskmatePropose.context)).not.toContain('Accumulating a total')
    expect(JSON.stringify(deskmatePropose.context)).not.toContain('starterCode')
  })

  it('still names a stored Teacher message approved as reveal_answer, though no agent can propose it now', async () => {
    const store = memoryStore()
    const opened = await handleTurn({ sessionStudentId: signedInStudent, body: { event: 'open' } }, store)
    await store.appendMessage(signedInStudent, 'getting_started', {
      author: 'teacher',
      approvedMove: 'reveal_answer',
      text: 'The total starts at zero before the loop.',
      exerciseId: opened.workingArea.exercise.id,
    })

    const state = await handleTurn({ sessionStudentId: signedInStudent, body: { event: 'open' } }, store)

    expect(state.conversation.find(message => message.text === 'The total starts at zero before the loop.')).toMatchObject({
      author: 'teacher',
      role: 'Answer revealed',
      approvedMove: 'reveal_answer',
    })
  })

  it('presents each Teacher message with the plain-word name of its approved move', async () => {
    const store = memoryStore()
    // Getting Started is passed, so Variables is open: the VerifyShield allows an
    // advance only towards a module the course has and the student is not in.
    // The resume point keeps the student on Getting Started all the same.
    const evidence = createMemoryEvidenceStore()
    // The misconception reply below names one the quiz answers show, so the
    // VerifyShield approves it as asked.
    const quizAnswers = createMemoryQuizAnswerStore()
    await quizAnswers.record({
      studentId: signedInStudent,
      moduleId: 'getting_started',
      questionId: 'print-text',
      choice: 0,
      correct: false,
    })
    await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'select_exercise', exerciseId: 'say_hello' },
    }, store, undefined, { evidence, quizAnswers })
    for (const exerciseId of ['say_hello', 'join_words', 'sign_the_program']) {
      await evidence.append({ studentId: signedInStudent, moduleId: 'getting_started', exerciseId, testsPassed: 3, testsTotal: 3 })
    }
    const replies = [
      {
        proposal: { type: 'explain_concept' as const, scope: 'getting_started' },
        text: 'The total is created before the loop.',
        role: 'Explanation',
        approvedMove: 'explain_concept',
      },
      {
        proposal: { type: 'answer_question' as const, scope: 'getting_started' },
        text: 'Yes. The total is a variable.',
        role: 'Answer',
        approvedMove: 'answer_question',
      },
      {
        proposal: { type: 'hint_level_N' as const, level: 1, scope: 'getting_started' },
        text: 'Look at the line before the loop.',
        role: 'Hint',
        approvedMove: 'hint_level_1',
      },
      {
        // Rung 2 follows the rung 1 given just above: a valid climb the hint
        // ladder leaves alone.
        proposal: { type: 'hint_level_N' as const, level: 2, scope: 'getting_started' },
        text: 'Create the total once, before the loop.',
        role: 'Hint',
        approvedMove: 'hint_level_2',
      },
      {
        proposal: { type: 'address_misconception' as const, misconceptionId: 'missing_quotes', scope: 'getting_started' },
        text: 'The words are missing their quotes.',
        role: 'Misconception',
        approvedMove: 'address_misconception:missing_quotes',
      },
      {
        proposal: { type: 'advance_to_module' as const, moduleId: 'variables' },
        text: 'Variables is the next module.',
        role: 'Next module',
        approvedMove: 'advance_to_module:variables',
      },
      {
        proposal: { type: 'stay_and_practise' as const },
        text: 'Stay with this exercise a little longer.',
        role: 'Keep practising',
        approvedMove: 'stay_and_practise',
      },
    ]

    for (const [index, reply] of replies.entries()) {
      const state = await handleTurn({
        sessionStudentId: signedInStudent,
        body: { event: 'message', text: `Question ${index}` },
      }, store, createFakeAgents({
        proposal: reply.proposal,
        text: reply.text,
      }), { evidence, quizAnswers })

      expect(state.conversation.find(message => message.text === reply.text)).toMatchObject({
        author: 'teacher',
        name: 'Teacher',
        role: reply.role,
        approvedMove: reply.approvedMove,
      })
      expect(JSON.stringify(state)).not.toContain('Instructor')
    }

    const unanswered = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'message', text: 'And if the model fails?' },
    }, store, createFakeAgents({
      proposal: { type: 'explain_concept', scope: 'getting_started' },
      fail: 'propose',
    }))

    expect(unanswered.conversation.at(-1)).toMatchObject({
      author: 'teacher',
      name: 'Teacher',
      role: '',
      text: 'The Teacher could not answer just now. Please try again.',
      approvedMove: null,
    })

    const withMai = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'message', text: 'Mine is zero as well.' },
    }, store, createFakeAgents(
      { proposal: null },
      {
        proposal: { type: 'share_confusion' },
        text: 'i keep getting zero too.',
      },
    ))

    expect(withMai.conversation.at(-1)).toMatchObject({
      author: 'deskmate',
      name: 'Mai',
      role: 'Deskmate',
      approvedMove: 'share_confusion',
    })

    const quietMai = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'message', text: 'Say that again?' },
    }, store, createFakeAgents(
      { proposal: null },
      {
        proposal: { type: 'peer_question' },
        text: 'PARTIAL_MAI_LABEL',
        fail: 'render',
      },
    ))

    expect(quietMai.conversation.at(-1)).toMatchObject({
      author: 'deskmate',
      name: 'Mai',
      role: 'Deskmate',
      approvedMove: null,
    })

    const selected = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'select_exercise', exerciseId: 'join_words' },
    }, store)

    expect(selected.conversation.at(-1)).toMatchObject({
      author: 'event',
      name: 'Exercise',
      role: 'Marker',
      text: 'Join two words',
    })
    expect(JSON.stringify(selected)).not.toContain('Instructor')
  })

  it('does not accept a run as a turn', async () => {
    const store = memoryStore()
    const model = speakingTeacher()

    await expect(handleTurn({
      sessionStudentId: signedInStudent,
      body: {
        event: 'run',
        code: 'print(1)\n',
        stdout: 'RUN_SHOULD_NOT_BE_A_TURN',
      },
    }, store, model)).rejects.toThrow('The turn endpoint does not accept that event.')

    expect(model.exchanges).toEqual([])
    const opened = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'open' },
    }, store)
    expect(opened.conversation).toEqual([])
    expect(JSON.stringify(opened)).not.toContain('RUN_SHOULD_NOT_BE_A_TURN')
  })

  it('labels a question about lists as Not yet and stays on the current module', async () => {
    const store = memoryStore()
    const model = createFakeAgents(
      {
        proposal: { type: 'explain_concept', scope: 'lists_and_tuples' },
        text: 'LISTS_LESSON_SHOULD_NOT_RENDER',
      },
      {
        proposal: { type: 'peer_question' },
        text: 'wait, are we still on loops?',
      },
    )

    const state = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'message', text: 'What are lists?' },
    }, store, model)

    expect(state.conversation.find(message => message.author === 'teacher')).toMatchObject({
      name: 'Teacher',
      role: 'Not yet',
      text: "That's part of Module 6: Lists and Tuples, which is not available yet. Let's stay with Getting Started with Programming and Python.",
      approvedMove: 'redirect_to_module',
    })
    expect(state.conversation.find(message => message.author === 'deskmate')).toMatchObject({
      name: 'Mai',
      role: 'Deskmate',
      text: 'wait, are we still on loops?',
      approvedMove: 'peer_question',
    })
    expect(state.workingArea.moduleId).toBe('getting_started')
    expect(state.workingArea.moduleName).toBe('Getting Started with Programming and Python')
    expect(JSON.stringify(state)).not.toContain('LISTS_LESSON_SHOULD_NOT_RENDER')
    expect(model.exchanges.filter(exchange => exchange.phase === 'render').map(exchange => exchange.agent)).toEqual(['deskmate'])
    expect(state.trace).toMatchObject({
      verifyShieldOn: true,
      unlockedModuleIds: ['getting_started'],
      agents: [
        {
          agent: 'teacher',
          proposal: 'explain_concept',
          scope: 'lists_and_tuples',
          verdict: {
            decision: 'downgrade',
            ruleId: 'scope_requires_unlocked_module',
            reasonCode: 'MODULE_CLOSED',
          },
        },
        {
          agent: 'deskmate',
          proposal: 'peer_question',
          scope: null,
          verdict: {
            decision: 'allow',
            ruleId: 'role_table',
            reasonCode: 'ROLE_PERMITTED',
          },
        },
      ],
    })
    expect(state.trace?.masteries).toEqual([
      { moduleId: 'getting_started', mastery: 0.1 },
      { moduleId: 'variables', mastery: 0.1 },
      { moduleId: 'strings', mastery: 0.1 },
      { moduleId: 'conditionals', mastery: 0.1 },
      { moduleId: 'loops', mastery: 0.1 },
      { moduleId: 'lists_and_tuples', mastery: 0.1 },
      { moduleId: 'dictionaries_and_sets', mastery: 0.1 },
      { moduleId: 'functions', mastery: 0.1 },
      { moduleId: 'modules_and_library', mastery: 0.1 },
      { moduleId: 'file_handling', mastery: 0.1 },
      { moduleId: 'error_handling', mastery: 0.1 },
    ])
    const proposed = model.exchanges.find(exchange => exchange.agent === 'teacher' && exchange.phase === 'propose')
    expect(proposed && proposed.agent === 'teacher' ? proposed.context.roadmap : []).toEqual([
      { id: 'getting_started', number: 1, name: 'Getting Started with Programming and Python', part: 'Foundations', state: 'open', current: true },
      { id: 'variables', number: 2, name: 'Variables, Data Types, and Operators', part: 'Foundations', state: 'closed', current: false },
      { id: 'strings', number: 3, name: 'Working with Strings', part: 'Foundations', state: 'closed', current: false },
      { id: 'conditionals', number: 4, name: 'Conditional Statements', part: 'Control Flow', state: 'closed', current: false },
      { id: 'loops', number: 5, name: 'Loops', part: 'Control Flow', state: 'closed', current: false },
      { id: 'lists_and_tuples', number: 6, name: 'Lists and Tuples', part: 'Built-in Data Structures', state: 'closed', current: false },
      { id: 'dictionaries_and_sets', number: 7, name: 'Dictionaries and Sets', part: 'Built-in Data Structures', state: 'closed', current: false },
      { id: 'functions', number: 8, name: 'Functions', part: 'Organizing Code', state: 'closed', current: false },
      { id: 'modules_and_library', number: 9, name: 'Modules and the Standard Library', part: 'Organizing Code', state: 'closed', current: false },
      { id: 'file_handling', number: 10, name: 'File Handling', part: 'Working with the Real World', state: 'closed', current: false },
      { id: 'error_handling', number: 11, name: 'Error Handling and Debugging', part: 'Working with the Real World', state: 'closed', current: false },
    ])
  })

  it('labels an out-of-course question as Not yet', async () => {
    const store = memoryStore()
    const state = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'message', text: 'hey how are you' },
    }, store, createFakeAgents({
      proposal: { type: 'explain_concept', scope: 'out_of_course' },
      text: 'SMALL_TALK_SHOULD_NOT_RENDER',
    }))

    expect(state.conversation.find(message => message.author === 'teacher')).toMatchObject({
      role: 'Not yet',
      text: "That's outside this course. Let's stay with Getting Started with Programming and Python.",
      approvedMove: 'redirect_to_module',
    })
    expect(JSON.stringify(state)).not.toContain('SMALL_TALK_SHOULD_NOT_RENDER')
    expect(state.workingArea.moduleId).toBe('getting_started')
  })

  it('redirects a mislabelled question when the message names pandas', async () => {
    const store = memoryStore()
    const state = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'message', text: 'Can you show me Pandas?' },
    }, store, createFakeAgents({
      proposal: { type: 'explain_concept', scope: 'getting_started' },
      text: 'PANDAS_SHOULD_NOT_RENDER',
    }))

    expect(state.conversation.find(message => message.author === 'teacher')).toMatchObject({
      role: 'Not yet',
      text: "That's outside this course. Let's stay with Getting Started with Programming and Python.",
      approvedMove: 'redirect_to_module',
    })
    expect(state.trace).toMatchObject({
      verifyShieldOn: true,
      agents: [
        {
          agent: 'teacher',
          proposal: 'explain_concept',
          scope: 'getting_started',
          verdict: {
            decision: 'downgrade',
            ruleId: 'scope_keyword',
            reasonCode: 'OUT_OF_COURSE_KEYWORD',
          },
        },
        {
          agent: 'deskmate',
          proposal: null,
          scope: null,
          verdict: null,
        },
      ],
    })
    expect(JSON.stringify(state)).not.toContain('PANDAS_SHOULD_NOT_RENDER')
  })

  it('answers a closed-module question when the VerifyShield is off', async () => {
    const store = memoryStore()
    const state = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'message', text: 'What are lists?' },
    }, store, createFakeAgents({
      proposal: { type: 'explain_concept', scope: 'lists_and_tuples' },
      text: 'A list keeps items in order.',
    }), { verifyShieldOn: false })

    expect(state.conversation.find(message => message.author === 'teacher')).toMatchObject({
      role: 'Explanation',
      text: 'A list keeps items in order.',
      approvedMove: 'explain_concept',
    })
    expect(state.trace).toMatchObject({
      verifyShieldOn: false,
      agents: [
        {
          agent: 'teacher',
          proposal: 'explain_concept',
          scope: 'lists_and_tuples',
          verdict: {
            decision: 'allow',
            ruleId: 'verify_shield',
            reasonCode: 'VERIFYSHIELD_OFF',
          },
        },
        {
          agent: 'deskmate',
          proposal: null,
          scope: null,
          verdict: null,
        },
      ],
    })
  })

  it.each([
    { move: { type: 'advance_to_module', moduleId: 'variables' }, key: 'advance_to_module:variables' },
    { move: { type: 'stay_and_practise' }, key: 'stay_and_practise' },
  ] satisfies { move: Move, key: string }[])('renders $key as a suggestion without changing placement or mode', async ({ move, key }) => {
    const store = memoryStore()
    const evidence = createMemoryEvidenceStore()
    const before = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'select_exercise', exerciseId: 'join_words' },
    }, store, undefined, { evidence })
    for (const exerciseId of ['say_hello', 'join_words', 'sign_the_program']) {
      await evidence.append({ studentId: signedInStudent, moduleId: 'getting_started', exerciseId, testsPassed: 3, testsTotal: 3 })
    }

    const streamReply = vi.fn(async function* () {
      yield 'You could try that when you are ready.'
    })
    const agents = createAgents({
      async proposeMove(instructions, _prompt, schema) {
        return schema.parse({ proposal: instructions.includes('You are the Teacher') ? move : null }).proposal
      },
      async proposeWithTools(instructions, prompt, schema) {
        return { proposal: await this.proposeMove(instructions, prompt, schema), ended: 'proposed' }
      },
      streamReply,
    })
    const after = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'message', text: 'What should I try next?' },
    }, store, agents, { evidence })

    expect(after.workingArea).toEqual(before.workingArea)
    expect(after.courseRoadmap.find(module => module.id === 'variables')?.state).toBe('open')
    expect(after.conversation.at(-1)).toMatchObject({ author: 'teacher', approvedMove: key, openInLearn: false })
    expect(await store.resumePoint(signedInStudent)).toEqual({ moduleId: 'getting_started', exerciseId: 'join_words' })
    expect(streamReply).toHaveBeenCalledWith(
      expect.stringMatching(/advance_to_module and stay_and_practise as suggestions the student can act on/i),
      expect.stringContaining(`Approved move: ${key}`),
    )
  })

  it('does not move the student when the teacher advances to a closed module', async () => {
    const store = memoryStore()
    const state = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'message', text: 'Can we start lists?' },
    }, store, createFakeAgents({
      proposal: { type: 'advance_to_module', moduleId: 'lists_and_tuples' },
      text: 'LISTS_ADVANCE_SHOULD_NOT_RENDER',
    }))

    expect(state.conversation.find(message => message.author === 'teacher')).toMatchObject({
      role: 'Not yet',
      text: "That's part of Module 6: Lists and Tuples, which is not available yet. Let's stay with Getting Started with Programming and Python.",
      approvedMove: 'redirect_to_module',
    })
    expect(state.workingArea.moduleId).toBe('getting_started')
    expect(JSON.stringify(state)).not.toContain('LISTS_ADVANCE_SHOULD_NOT_RENDER')
  })

  it('says nothing when the teacher advances to a module the course does not have', async () => {
    const store = memoryStore()
    const state = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'message', text: 'What comes after this?' },
    }, store, createFakeAgents({
      proposal: { type: 'advance_to_module', moduleId: 'nested_loops' },
      text: 'UNKNOWN_ADVANCE_SHOULD_NOT_RENDER',
    }))

    expect(state.conversation.filter(message => message.author === 'teacher')).toEqual([])
    expect(state.workingArea.moduleId).toBe('getting_started')
    expect(JSON.stringify(state)).not.toContain('UNKNOWN_ADVANCE_SHOULD_NOT_RENDER')
    // The proposal is still in the trace, so the log shows what was blocked.
    expect(state.trace.agents[0]).toMatchObject({
      proposal: 'advance_to_module:nested_loops',
      verdict: { decision: 'block', ruleId: 'advance_known_module', reasonCode: 'ADVANCE_UNKNOWN_MODULE' },
    })
  })

  it('turns an advance to the module the student is in into a suggestion to keep practising', async () => {
    const store = memoryStore()
    const state = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'message', text: 'Should I move on?' },
    }, store, createFakeAgents({
      proposal: { type: 'advance_to_module', moduleId: 'getting_started' },
      text: 'Stay with this one a little longer.',
    }))

    expect(state.conversation.at(-1)).toMatchObject({
      author: 'teacher',
      role: 'Keep practising',
      text: 'Stay with this one a little longer.',
      approvedMove: 'stay_and_practise',
    })
    expect(state.workingArea.moduleId).toBe('getting_started')
  })

  it.each([
    {
      text: 'How do I print?',
      teacher: { type: 'explain_concept', scope: 'getting_started' },
      deskmate: { type: 'hint_level_N', level: 1, scope: 'getting_started' },
      logged: [
        { agent: 'teacher', verdict: 'allow', ruledMove: 'explain_concept', ruleId: 'role_table', reasonCode: 'ROLE_PERMITTED' },
        { agent: 'deskmate', verdict: 'block', ruledMove: null, ruleId: 'role_table', reasonCode: 'ROLE_FORBIDDEN' },
      ],
    },
    {
      text: 'What are lists?',
      teacher: { type: 'explain_concept', scope: 'lists_and_tuples' },
      logged: [{ agent: 'teacher', verdict: 'downgrade', ruledMove: 'redirect_to_module', ruleId: 'scope_requires_unlocked_module', reasonCode: 'MODULE_CLOSED' }],
    },
    {
      text: 'hey how are you',
      teacher: { type: 'explain_concept', scope: 'out_of_course' },
      logged: [{ agent: 'teacher', verdict: 'downgrade', ruledMove: 'redirect_to_module', ruleId: 'scope_in_course', reasonCode: 'OUT_OF_COURSE' }],
    },
    {
      text: 'Can you show me Pandas?',
      teacher: { type: 'explain_concept', scope: 'getting_started' },
      logged: [{ agent: 'teacher', verdict: 'downgrade', ruledMove: 'redirect_to_module', ruleId: 'scope_keyword', reasonCode: 'OUT_OF_COURSE_KEYWORD' }],
    },
    {
      text: 'Can we talk about Lists and Tuples?',
      teacher: { type: 'answer_question', scope: 'getting_started' },
      logged: [{ agent: 'teacher', verdict: 'downgrade', ruledMove: 'redirect_to_module', ruleId: 'scope_keyword', reasonCode: 'MODULE_CLOSED_KEYWORD' }],
    },
    {
      text: 'Can we start lists?',
      teacher: { type: 'advance_to_module', moduleId: 'lists_and_tuples' },
      logged: [{ agent: 'teacher', verdict: 'downgrade', ruledMove: 'redirect_to_module', ruleId: 'scope_requires_unlocked_module', reasonCode: 'MODULE_CLOSED' }],
    },
    {
      text: 'How does recursion work?',
      teacher: { type: 'explain_concept', scope: 'recursion' },
      logged: [{ agent: 'teacher', verdict: 'downgrade', ruledMove: 'redirect_to_module', ruledScope: 'out_of_course', ruleId: 'scope_in_course', reasonCode: 'SCOPE_UNKNOWN' }],
    },
    {
      text: 'What comes after this?',
      teacher: { type: 'advance_to_module', moduleId: 'nested_loops' },
      logged: [{ agent: 'teacher', verdict: 'block', ruledMove: null, ruleId: 'advance_known_module', reasonCode: 'ADVANCE_UNKNOWN_MODULE' }],
    },
    {
      text: 'Should I move on?',
      teacher: { type: 'advance_to_module', moduleId: 'getting_started' },
      logged: [{ agent: 'teacher', verdict: 'downgrade', ruledMove: 'stay_and_practise', ruleId: 'advance_not_current_module', reasonCode: 'ADVANCE_TO_CURRENT' }],
    },
  ] satisfies { text: string, teacher: Move, deskmate?: Move, logged: Partial<DecisionRecord>[] }[])('logs the $logged.0.reasonCode verdict for "$text"', async ({ text, teacher, deskmate, logged }) => {
    const decisions = createMemoryDecisionLogStore()
    await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'message', text },
    }, memoryStore(), createFakeAgents(
      { proposal: teacher, text: 'Teacher words.' },
      ...(deskmate ? [{ proposal: deskmate, text: 'Mai words.' }] : []),
    ), { decisions })

    const rows = (await decisions.list()).reverse()
    expect(rows).toHaveLength(logged.length)
    rows.forEach((row, index) => expect(row).toMatchObject({
      ...logged[index],
      studentId: signedInStudent,
      unlockedModuleIds: ['getting_started'],
      verifyShieldOn: true,
    }))
  })

  it('logs every proposal as allowed when the VerifyShield is off', async () => {
    const decisions = createMemoryDecisionLogStore()
    await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'message', text: 'What are lists?' },
    }, memoryStore(), createFakeAgents(
      { proposal: { type: 'explain_concept', scope: 'lists_and_tuples' }, text: 'A list keeps items in order.' },
      { proposal: { type: 'hint_level_N', level: 1, scope: 'getting_started' }, text: 'Mai words.' },
    ), { decisions, verifyShieldOn: false })

    expect((await decisions.list()).reverse()).toMatchObject([
      { agent: 'teacher', verdict: 'allow', ruledMove: 'explain_concept', ruleId: 'verify_shield', reasonCode: 'VERIFYSHIELD_OFF', verifyShieldOn: false },
      { agent: 'deskmate', verdict: 'allow', ruledMove: 'hint_level_1', ruleId: 'verify_shield', reasonCode: 'VERIFYSHIELD_OFF', verifyShieldOn: false },
    ])
  })

  it('logs the opening turn\'s proposal and the introduction put in its place', async () => {
    const decisions = createMemoryDecisionLogStore()
    await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'open' },
    }, memoryStore(), createFakeAgents({ proposal: { type: 'stay_and_practise' }, text: 'Welcome.' }), { decisions })

    expect((await decisions.list()).reverse()).toMatchObject([
      { agent: 'teacher', proposedMove: 'stay_and_practise', verdict: 'allow', ruleId: 'role_table', reasonCode: 'ROLE_PERMITTED' },
      { agent: 'teacher', proposedMove: 'explain_concept', proposedScope: 'getting_started', verdict: 'allow', ruleId: 'role_table', reasonCode: 'ROLE_PERMITTED' },
    ])
  })

  it('rejects an exercise that is not on the module', async () => {
    await expect(handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'select_exercise', exerciseId: 'while_loop' },
    }, memoryStore())).rejects.toEqual(expect.objectContaining({
      name: 'UnknownExerciseError',
      statusCode: 400,
    }))
  })

  it('rules a quote like the same words typed out, and records that the message had one', async () => {
    const quote = { text: 'Can you show me Pandas?', source: 'materials' as const, moduleId: 'getting_started' }
    const question = 'What does this line do?'
    const agents = () => createFakeAgents({
      proposal: { type: 'explain_concept', scope: 'getting_started' },
      text: 'PANDAS_SHOULD_NOT_RENDER',
    })
    const typed = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'message', text: `${quote.text}\n${question}`, addressedAgent: 'teacher' },
    }, memoryStore(), agents())
    const activity = createMemoryActivityLog()
    const evidence = createMemoryEvidenceStore()
    const model = agents()
    const quoted = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'message', text: question, addressedAgent: 'teacher', quote },
    }, memoryStore(), model, { activity, evidence })

    const teacherMove = (state: Awaited<ReturnType<typeof handleTurn>>) =>
      state.conversation.find(message => message.author === 'teacher')
    expect(teacherMove(quoted)).toMatchObject({
      approvedMove: teacherMove(typed)?.approvedMove,
      role: 'Not yet',
    })
    expect(quoted.conversation.find(message => message.author === 'student')).toMatchObject({
      text: question,
      quote,
      addressedAgent: 'teacher',
    })
    expect(quoted.conversation.filter(message => message.author === 'deskmate')).toEqual([])
    expect(activity.events).toEqual([{
      studentId: signedInStudent,
      courseId: 'intro_python',
      type: 'message_sent',
      payload: { moduleId: 'getting_started', hasQuote: true },
    }])
    expect(await evidence.forStudent(signedInStudent)).toEqual([])
    expect(JSON.stringify(model.exchanges)).not.toContain('notes')
    expect(model.exchanges.some(exchange => exchange.agent === 'deskmate')).toBe(false)
  })

  it('lets the deskmate see quoted materials and never a note', async () => {
    const model = createFakeAgents(
      { proposal: { type: 'explain_concept', scope: 'getting_started' }, text: 'print shows text.' },
      { proposal: { type: 'share_confusion' }, text: 'I was looking at that line too.' },
    )
    await handleTurn({
      sessionStudentId: signedInStudent,
      body: {
        event: 'message',
        text: 'What does this mean?',
        quote: { text: 'print() shows text', source: 'materials', moduleId: 'getting_started' },
      },
    }, memoryStore(), model)

    const deskmate = model.exchanges.find(exchange => exchange.agent === 'deskmate')
    expect(JSON.stringify(deskmate?.context)).toContain('print() shows text')
    expect(JSON.stringify(model.exchanges)).not.toContain('ONLY_AN_PRIVATE_NOTE')
    for (const exchange of model.exchanges) {
      expect(exchange.context).not.toHaveProperty('notes')
    }
  })

  it('records a submission without its code', async () => {
    const activity = createMemoryActivityLog()
    const code = 'def total(ds):\n    SUBMISSION_CODE_SENTINEL = 0\n'
    await handleTurn({
      sessionStudentId: signedInStudent,
      body: {
        event: 'submission',
        code,
        results: [
          { name: 'three numbers', passed: false, expected: '6', actual: '0' },
          { name: 'one number', passed: true, expected: '10', actual: '10' },
          { name: 'empty list', passed: false, expected: '0', actual: '0' },
        ],
      },
    }, memoryStore(), speakingTeacher(), {
      activity,
      sandbox: createFakeSandbox({
        outcome: 'checked',
        results: [
          { name: 'three numbers', passed: false, expected: '6', actual: '0' },
          { name: 'one number', passed: true, expected: '10', actual: '10' },
          { name: 'empty list', passed: false, expected: '0', actual: '0' },
        ],
      }),
    })

    expect(activity.events).toEqual([{
      studentId: signedInStudent,
      courseId: 'intro_python',
      type: 'submitted',
      payload: { moduleId: 'getting_started', exerciseId: 'say_hello', testsPassed: 1, testsTotal: 3 },
    }])
    expect(JSON.stringify(activity.events)).not.toContain('SUBMISSION_CODE_SENTINEL')
  })

  it('records a quiz answer without changing the mastery that answer produces', async () => {
    const activity = createMemoryActivityLog()
    const body = { event: 'quiz_answer', moduleId: 'getting_started', questionId: 'print-text', choice: 1 }
    const logged = await handleTurn({ sessionStudentId: signedInStudent, body }, memoryStore(), undefined, {
      quizAnswers: createMemoryQuizAnswerStore(),
      activity,
    })
    const plain = await handleTurn({ sessionStudentId: signedInStudent, body }, memoryStore(), undefined, {
      quizAnswers: createMemoryQuizAnswerStore(),
    })

    expect(logged.courseRoadmap[0]?.mastery).toBe(plain.courseRoadmap[0]?.mastery)
    expect(activity.events).toEqual([{
      studentId: signedInStudent,
      courseId: 'intro_python',
      type: 'quiz_answered',
      payload: { moduleId: 'getting_started', questionId: 'print-text', correct: true },
    }])
  })

  it('appends nothing when a turn opens or selects a module', async () => {
    const activity = createMemoryActivityLog()
    await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'open' },
    }, memoryStore(), undefined, { activity })
    await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'select_module', moduleId: 'getting_started' },
    }, memoryStore(), undefined, { activity })

    expect(activity.events).toEqual([])
  })

  it('records one message and leaves mastery where that message left it', async () => {
    const draft = 'def total(ds):\n    DRAFT_SHOULD_NOT_BE_LOGGED = 0\n'
    const body = {
      event: 'message',
      text: 'What does print do?',
      draft,
      code: 'print("NO_CODE_IN_THE_LOG")',
      addressedAgent: 'teacher',
    }
    const activity = createMemoryActivityLog()
    const evidence = createMemoryEvidenceStore()
    const logged = await handleTurn({
      sessionStudentId: signedInStudent,
      body,
    }, memoryStore(), speakingTeacher(), { activity, evidence })
    const plain = await handleTurn({
      sessionStudentId: signedInStudent,
      body,
    }, memoryStore(), speakingTeacher())

    expect(activity.events).toEqual([{
      studentId: signedInStudent,
      courseId: 'intro_python',
      type: 'message_sent',
      payload: { moduleId: 'getting_started', hasQuote: false },
    }])
    expect(JSON.stringify(activity.events)).not.toContain('DRAFT_SHOULD_NOT_BE_LOGGED')
    expect(JSON.stringify(activity.events)).not.toContain('NO_CODE_IN_THE_LOG')
    expect(logged.courseRoadmap.map(module => [module.id, module.mastery])).toEqual(
      plain.courseRoadmap.map(module => [module.id, module.mastery]),
    )
    expect(await evidence.forStudent(signedInStudent)).toEqual([])
  })

  it('records one submission and leaves mastery where that submission left it', async () => {
    const body = {
      event: 'submission',
      code: 'SUBMISSION_CODE_SHOULD_NOT_MOVE_MASTERY',
      results: [
        { name: 'three numbers', passed: true, expected: '6', actual: '6' },
        { name: 'one number', passed: true, expected: '10', actual: '10' },
        { name: 'empty list', passed: false, expected: '0', actual: '1' },
      ],
    }
    const activity = createMemoryActivityLog()
    const sandbox = createFakeSandbox({
      outcome: 'checked',
      results: [
        { name: 'three numbers', passed: true, expected: '6', actual: '6' },
        { name: 'one number', passed: true, expected: '10', actual: '10' },
        { name: 'empty list', passed: false, expected: '0', actual: '1' },
      ],
    })
    const logged = await handleTurn({
      sessionStudentId: signedInStudent,
      body,
    }, memoryStore(), speakingTeacher(), { activity, sandbox })
    const plain = await handleTurn({
      sessionStudentId: signedInStudent,
      body,
    }, memoryStore(), speakingTeacher(), { sandbox })

    expect(activity.events).toEqual([{
      studentId: signedInStudent,
      courseId: 'intro_python',
      type: 'submitted',
      payload: { moduleId: 'getting_started', exerciseId: 'say_hello', testsPassed: 2, testsTotal: 3 },
    }])
    expect(JSON.stringify(activity.events)).not.toContain('SUBMISSION_CODE_SHOULD_NOT_MOVE_MASTERY')
    expect(logged.courseRoadmap.map(module => [module.id, module.mastery])).toEqual(
      plain.courseRoadmap.map(module => [module.id, module.mastery]),
    )
  })

  it('records a quiz answer once, and a repeat leaves the log and mastery alone', async () => {
    const activity = createMemoryActivityLog()
    const quizAnswers = createMemoryQuizAnswerStore()
    const body = { event: 'quiz_answer', moduleId: 'getting_started', questionId: 'print-text', choice: 1 }
    const first = await handleTurn({
      sessionStudentId: signedInStudent,
      body,
    }, memoryStore(), undefined, { quizAnswers, activity })
    const second = await handleTurn({
      sessionStudentId: signedInStudent,
      body,
    }, memoryStore(), undefined, { quizAnswers, activity })

    expect(first.courseRoadmap[0]?.mastery).toBe(0.39)
    expect(second.courseRoadmap[0]?.mastery).toBe(0.39)
    expect(activity.events).toEqual([{
      studentId: signedInStudent,
      courseId: 'intro_python',
      type: 'quiz_answered',
      payload: { moduleId: 'getting_started', questionId: 'print-text', correct: true },
    }])
  })
})
