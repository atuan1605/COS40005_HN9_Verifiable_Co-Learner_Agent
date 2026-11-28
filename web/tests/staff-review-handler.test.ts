import { describe, expect, it } from 'vitest'
import { handleAdmin } from '../server/admin/handle-admin'
import { createMemoryModelSettingsStore } from '../server/storage/model-settings-store'
import { createMemoryCourseStore } from '../server/storage/course-store'
import { createMemorySubmissionStore } from '../server/storage/submission-store'
import { createMemoryStaffAccessLog } from '../server/storage/staff-access-log'
import { createMemoryStaffReviewStore, type MemoryStaffReviewData, type StaffReviewStudent } from '../server/storage/staff-review-store'
import { pythonCourse } from '../server/course'
import { createMemoryEvidenceStore, learningParameters } from '../server/student-model'
import { handleStaffConversation, handleStaffReview } from '../server/staff-review'
import type { LearningPlan } from '../server/learning-plan'
import type { ReviewEvent, ReviewMessage } from '../shared/staff-review'

const adminEmails = 'owner@example.com'
const lecturerEmails = 'lecturer@example.com, other@example.com'
const an: StaffReviewStudent = { id: 'an-id', displayName: 'An', studentNumber: 'SWB0001', campus: 'Hanoi', email: 'an@example.com' }
const binh: StaffReviewStudent = { id: 'binh-id', displayName: 'Bình', studentNumber: 'SWB0002', campus: null, email: 'binh@example.com' }

const plans: LearningPlan[] = [
  { moduleId: 'loops', revision: 1, steps: [{ kind: 'materials', ref: '' }, { kind: 'quiz', ref: 'gone' }], currentStep: 0, agreedAt: null, createdAt: '2026-11-19T07:00:00Z', trigger: null, decisionTurnId: null },
  { moduleId: 'loops', revision: 2, steps: [{ kind: 'materials', ref: '' }, { kind: 'quiz', ref: 'gone' }], currentStep: 1, agreedAt: '2026-11-19T07:05:00Z', createdAt: '2026-11-19T07:05:00Z', trigger: null, decisionTurnId: null },
]

const events: ReviewEvent[] = [
  { id: 1, type: 'pasted', time: '2026-11-19T08:00:00Z', payload: { exerciseId: 'sum', characters: 400 } },
  { id: 2, type: 'submitted', time: '2026-11-19T08:01:00Z', payload: { moduleId: 'loops', exerciseId: 'sum', testsPassed: 3, testsTotal: 3 } },
]

function setup(extra: Partial<MemoryStaffReviewData> = {}) {
  const store = createMemoryStaffReviewStore({
    students: [an, binh],
    courses: [
      { id: 'intro_python', ownerEmail: 'lecturer@example.com', enrolled: ['an-id'] },
      { id: 'other_course', ownerEmail: 'other@example.com', enrolled: ['binh-id'] },
    ],
    activity: { 'an-id': events },
    // A complete picture: every module of the course has a stored row.
    masteries: {
      'an-id': pythonCourse.modules.map(module => module.id === 'getting_started'
        ? { moduleId: module.id, mastery: 0.97, passedExercise: true, everMastered: true }
        : { moduleId: module.id, mastery: module.id === 'variables' ? 0.4 : 0, passedExercise: false, everMastered: false }),
    },
    learningPlans: { 'an-id': plans },
    conversations: {
      'an-id': [{ moduleId: 'loops', messages: [{ id: 'm1', sequence: 1, author: 'student', text: 'hi', exerciseId: 'sum', time: null }] }],
    },
    ...extra,
    submissions: {
      'an-id': [{
        id: 's1',
        moduleId: 'loops',
        exerciseId: 'sum',
        code: 'print(1)',
        results: [{ name: 't', passed: true, expected: '1', actual: '1' }],
        outcome: 'passed',
        message: null,
        time: '2026-11-19T08:01:00Z',
      }],
    },
  })
  const accessLog = createMemoryStaffAccessLog({ 'an-id': 'SWB0001', 'binh-id': 'SWB0002' })
  const submissions = createMemorySubmissionStore()
  return { store, accessLog, submissions }
}

function reading(submissions: ReturnType<typeof createMemorySubmissionStore>) {
  return { courses: createMemoryCourseStore(), patternSources: () => ({ submissions }) }
}

function open(email: string | null, studentNumber: string, parts = setup()) {
  return {
    parts,
    result: handleStaffReview({ email, adminEmails, lecturerEmails, studentNumber, store: parts.store, accessLog: parts.accessLog, ...reading(parts.submissions) }),
  }
}

describe('staff review handler', () => {
  it('lets a lecturer open a student enrolled in their course, with the work, the conversation and the signals', async () => {
    const { result, parts } = open('lecturer@example.com', 'SWB0001')

    const review = await result

    expect(review.student).toEqual({ displayName: 'An', studentNumber: 'SWB0001', campus: 'Hanoi', email: 'an@example.com' })
    expect(review.courseId).toBe('intro_python')
    expect(review.activity.map(event => event.id)).toEqual([2, 1])
    expect(review.submissions.map(submission => submission.code)).toEqual(['print(1)'])
    expect(review.conversations.map(conversation => conversation.moduleId)).toEqual(['loops'])
    expect(review.signals.map(signal => signal.kind)).toEqual(['large_paste_then_pass', 'pass_without_run'])
    expect(parts.accessLog.rows).toHaveLength(1)
  })

  it('refuses a lecturer for a student outside their courses, and reads and logs nothing', async () => {
    const { result, parts } = open('lecturer@example.com', 'SWB0002')

    await expect(result).rejects.toMatchObject({ statusCode: 403 })
    expect(parts.accessLog.rows).toEqual([])
  })

  it('refuses a lecturer who asks for a student number that does not exist the same way', async () => {
    const { result } = open('lecturer@example.com', 'SWB9999')

    await expect(result).rejects.toMatchObject({ statusCode: 403 })
  })

  it('lets an administrator open any student', async () => {
    const { result, parts } = open('owner@example.com', 'SWB0002')

    const review = await result

    expect(review.student.studentNumber).toBe('SWB0002')
    expect(parts.accessLog.rows).toHaveLength(1)
  })

  it('tells an administrator a student number does not exist', async () => {
    const { result } = open('owner@example.com', 'SWB9999')

    await expect(result).rejects.toMatchObject({ statusCode: 404 })
  })

  it.each([
    { email: null, statusCode: 401 },
    { email: 'an@example.com', statusCode: 403 },
  ])('refuses $email with $statusCode and logs nothing', async ({ email, statusCode }) => {
    const { result, parts } = open(email, 'SWB0001')

    await expect(result).rejects.toMatchObject({ statusCode })
    expect(parts.accessLog.rows).toEqual([])
  })

  it('writes who, which student, what and when on every opening', async () => {
    const parts = setup()

    await open('lecturer@example.com', 'SWB0001', parts).result
    await open('owner@example.com', 'SWB0001', parts).result

    expect(parts.accessLog.rows).toMatchObject([
      { actorEmail: 'lecturer@example.com', actorRole: 'lecturer', studentId: 'an-id', courseId: 'intro_python', opened: 'student_review' },
      { actorEmail: 'owner@example.com', actorRole: 'administrator', studentId: 'an-id', opened: 'student_review' },
    ])
    expect(parts.accessLog.rows.every(row => !Number.isNaN(Date.parse(row.time)))).toBe(true)
  })

  it('does not hand over the records when the log cannot be written', async () => {
    const parts = setup()
    const failing = { ...parts.accessLog, record: async () => { throw new Error('log down') } }

    await expect(handleStaffReview({
      email: 'owner@example.com',
      adminEmails,
      lecturerEmails,
      studentNumber: 'SWB0001',
      store: parts.store,
      accessLog: failing,
      ...reading(parts.submissions),
    })).rejects.toThrow('log down')
  })

  it('works the signals out on each opening and stores nothing of them', async () => {
    const parts = setup()

    const first = await open('lecturer@example.com', 'SWB0001', parts).result
    const second = await open('lecturer@example.com', 'SWB0001', parts).result

    expect(second.signals).toEqual(first.signals)
    expect(await parts.store.activity('an-id', 'intro_python')).toEqual(events)
  })
})

const said = (sequence: number, author: ReviewMessage['author'], text: string, time: string | null): ReviewMessage =>
  ({ id: `m${sequence}-${text}`, sequence, author, text, exerciseId: 'sum', time })

// Stored out of order, so the handlers have to do the ordering.
const talked: MemoryStaffReviewData['conversations'] = {
  'an-id': [
    { moduleId: 'variables', messages: [said(1, 'student', 'what is a name', '2026-11-18T09:00:00Z')] },
    { moduleId: 'loops', messages: [
      said(3, 'deskmate', 'try a for loop', '2026-11-19T09:02:00Z'),
      said(1, 'student', 'I am stuck', '2026-11-19T09:00:00Z'),
      said(2, 'teacher', 'Where?', '2026-11-19T09:01:00Z'),
      said(4, 'event', '3 of 3 tests passed', null),
    ] },
  ],
}

describe('the conversations a review lists', () => {
  it('summarises each module\'s conversation, newest first, with no message bodies', async () => {
    const review = await open('lecturer@example.com', 'SWB0001', setup({ conversations: talked })).result

    expect(review.conversations).toEqual([
      { moduleId: 'loops', moduleName: 'Loops', messageCount: 4, latestAt: '2026-11-19T09:02:00Z' },
      { moduleId: 'variables', moduleName: 'Variables, Data Types, and Operators',messageCount: 1, latestAt: '2026-11-18T09:00:00Z' },
    ])
    expect(JSON.stringify(review)).not.toContain('I am stuck')
  })
})

function openConversation(email: string | null, studentNumber: string, moduleId: string, parts = setup({ conversations: talked })) {
  return {
    parts,
    result: handleStaffConversation({
      email, adminEmails, lecturerEmails, studentNumber, moduleId, store: parts.store, accessLog: parts.accessLog, courses: createMemoryCourseStore(),
    }),
  }
}

describe('one conversation of a student', () => {
  it('gives the owning lecturer every message, the student\'s own included, oldest first', async () => {
    const conversation = await openConversation('lecturer@example.com', 'SWB0001', 'loops').result

    expect(conversation.student.displayName).toBe('An')
    expect(conversation).toMatchObject({ moduleId: 'loops', moduleName: 'Loops' })
    expect(conversation.messages.map(message => [message.author, message.text])).toEqual([
      ['student', 'I am stuck'],
      ['teacher', 'Where?'],
      ['deskmate', 'try a for loop'],
      ['event', '3 of 3 tests passed'],
    ])
  })

  it.each([
    { email: 'lecturer@example.com', actorRole: 'lecturer' },
    { email: 'owner@example.com', actorRole: 'administrator' },
  ])('logs the opening by the $actorRole with the module', async ({ email, actorRole }) => {
    const { result, parts } = openConversation(email, 'SWB0001', 'loops')
    await result

    expect(parts.accessLog.rows).toMatchObject([
      { actorEmail: email, actorRole, studentId: 'an-id', courseId: 'intro_python', opened: 'student_conversation', moduleId: 'loops' },
    ])
  })

  it('lets an administrator open any student, with no messages where there are none', async () => {
    const conversation = await openConversation('owner@example.com', 'SWB0002', 'loops', setup({ conversations: {} })).result

    expect(conversation.messages).toEqual([])
  })

  it('writes the log before it reads a message', async () => {
    const parts = setup({ conversations: talked })
    const seen: number[] = []
    const store = { ...parts.store, conversations: async (studentId: string, courseId: string) => {
      seen.push(parts.accessLog.rows.length)
      return parts.store.conversations(studentId, courseId)
    } }

    await openConversation('lecturer@example.com', 'SWB0001', 'loops', { ...parts, store }).result

    expect(seen).toEqual([1])
  })

  it('hands over nothing when the log cannot be written', async () => {
    const parts = setup({ conversations: talked })
    const accessLog = { ...parts.accessLog, record: async () => { throw new Error('log down') } }

    await expect(openConversation('lecturer@example.com', 'SWB0001', 'loops', { ...parts, accessLog }).result).rejects.toThrow('log down')
  })

  it.each([
    { email: null, studentNumber: 'SWB0001', statusCode: 401 },
    { email: 'an@example.com', studentNumber: 'SWB0001', statusCode: 403 },
    { email: 'other@example.com', studentNumber: 'SWB0001', statusCode: 403 },
    // Refused like a student who is not theirs, so a number cannot be probed.
    { email: 'lecturer@example.com', studentNumber: 'SWB9999', statusCode: 403 },
    { email: 'owner@example.com', studentNumber: 'SWB9999', statusCode: 404 },
  ])('refuses $email for $studentNumber with $statusCode and logs nothing', async ({ email, studentNumber, statusCode }) => {
    const { result, parts } = openConversation(email, studentNumber, 'loops')

    await expect(result).rejects.toMatchObject({ statusCode })
    expect(parts.accessLog.rows).toEqual([])
  })

  it('answers 404 for a module that does not exist, and logs nothing', async () => {
    const { result, parts } = openConversation('lecturer@example.com', 'SWB0001', 'no_such_module')

    await expect(result).rejects.toMatchObject({ statusCode: 404 })
    expect(parts.accessLog.rows).toEqual([])
  })

  it('still opens a conversation in a module the course no longer lists', async () => {
    const parts = setup({ conversations: { 'an-id': [{ moduleId: 'dropped', messages: [said(1, 'student', 'old talk', null)] }] } })

    const conversation = await openConversation('lecturer@example.com', 'SWB0001', 'dropped', parts).result

    expect(conversation).toMatchObject({ moduleName: 'dropped', messages: [{ text: 'old talk' }] })
  })
})

describe('the mastery a review shows', () => {
  it('shows the owning lecturer the stored mastery and state of each module', async () => {
    const review = await open('lecturer@example.com', 'SWB0001').result

    expect(review.mastery?.modules.slice(0, 3)).toEqual([
      { moduleId: 'getting_started', name: expect.any(String), mastery: 0.97, state: 'mastered' },
      { moduleId: 'variables', name: expect.any(String), mastery: 0.4, state: 'open' },
      { moduleId: 'strings', name: expect.any(String), mastery: 0, state: 'closed' },
    ])
  })

  it('gives the owning lecturer Course progress over every module the course lists', async () => {
    const review = await open('lecturer@example.com', 'SWB0001').result

    // One module mastered of the eleven the Python course lists, the ones without content included.
    expect(review.mastery?.progress).toEqual({ mastered: 1, total: 11, percent: 9 })
    expect(review.mastery?.modules).toHaveLength(11)
  })

  it('shows a module listed without content as closed', async () => {
    const review = await open('lecturer@example.com', 'SWB0001').result
    const without = pythonCourse.modules.filter(module => !pythonCourse.studyModules.some(study => study.id === module.id))

    expect(without.length).toBeGreaterThan(0)
    expect(review.mastery?.modules.filter(module => without.some(other => other.id === module.moduleId)).map(module => module.state))
      .toEqual(without.map(() => 'closed'))
  })

  it('still writes the staff access log when the lecturer reads mastery', async () => {
    const { result, parts } = open('lecturer@example.com', 'SWB0001')
    await result
    expect(parts.accessLog.rows).toMatchObject([{ actorRole: 'lecturer', studentId: 'an-id', opened: 'student_review' }])
  })

  it('refuses another lecturer the mastery of a student outside their courses', async () => {
    await expect(open('other@example.com', 'SWB0001').result).rejects.toMatchObject({ statusCode: 403 })
  })

  it('opens a module whose unlock was recorded, as the student\'s roadmap does', async () => {
    const review = await open('lecturer@example.com', 'SWB0001', setup({ unlocks: { 'an-id': ['strings'] } })).result
    expect(review.mastery?.modules.find(module => module.moduleId === 'strings')?.state).toBe('open')
  })

  it('rebuilds missing mastery rows from evidence instead of reading them as zero', async () => {
    const parts = setup({ masteries: {} })
    const evidence = { ...createMemoryEvidenceStore(), forStudent: async () => [
      { moduleId: 'getting_started', kind: 'submission' as const, exerciseId: pythonCourse.modules[0]!.exerciseIds[0]!, allPassed: true, time: '2026-11-19T08:00:00Z' },
    ] }
    const review = await handleStaffReview({
      email: 'lecturer@example.com', adminEmails, lecturerEmails, studentNumber: 'SWB0001', store: parts.store, accessLog: parts.accessLog,
      courses: createMemoryCourseStore(), patternSources: () => ({ submissions: parts.submissions, evidence }),
    })
    // Rebuilt from the passing submission: above the prior, and the exercise counts as passed.
    expect(review.mastery?.modules[0]?.mastery).toBeGreaterThan(learningParameters.prior)
    expect(review.mastery?.modules[1]?.mastery).toBe(learningParameters.prior)
  })

  it('shows mastery to an administrator who also owns the student\'s course', async () => {
    const parts = setup()
    const review = await handleStaffReview({
      email: 'lecturer@example.com', adminEmails: 'lecturer@example.com', lecturerEmails, studentNumber: 'SWB0001', store: parts.store, accessLog: parts.accessLog, ...reading(parts.submissions),
    })
    expect(review.mastery?.modules[0]).toMatchObject({ moduleId: 'getting_started', state: 'mastered' })
  })

  it('hands the administrator no mastery and no Course progress', async () => {
    const review = await open('owner@example.com', 'SWB0001').result
    expect(review).not.toHaveProperty('mastery')
  })
})

describe('the plan and the pattern a review shows', () => {
  it('lists each revision of the plan, oldest first, with the steps in words', async () => {
    const review = await open('lecturer@example.com', 'SWB0001').result

    expect(review.plans).toHaveLength(1)
    const [plan] = review.plans
    expect(plan!.moduleId).toBe('loops')
    expect(plan!.revisions.map(revision => [revision.revision, revision.agreedAt !== null])).toEqual([[1, false], [2, true]])
    expect(plan!.revisions[0]!.steps.map(step => step.title)).toEqual(['Read the module materials', 'quiz gone'])
  })

  it('names each plan\'s module, and falls back to the id of a module the course no longer has', async () => {
    const dropped: LearningPlan = { ...plans[0]!, moduleId: 'turtle_graphics' }

    const review = await open('lecturer@example.com', 'SWB0001', setup({ learningPlans: { 'an-id': [...plans, dropped] } })).result

    expect(review.plans.map(plan => [plan.moduleId, plan.moduleName])).toEqual([
      ['loops', 'Loops'],
      ['turtle_graphics', 'turtle_graphics'],
    ])
  })

  it('shows the whole learning pattern, not only the weak spots the student sees', async () => {
    const parts = setup()
    await parts.submissions.record({ studentId: 'an-id', moduleId: 'loops', exerciseId: 'sum', code: 'x', results: [], outcome: 'failed', message: null, findings: ['off_by_one'] })

    const review = await open('lecturer@example.com', 'SWB0001', parts).result

    expect(review.learningPattern.weakSpots.map(spot => spot.misconceptionId)).toEqual(['off_by_one'])
    expect(review.learningPattern.recurringErrors).toEqual([{ kind: 'failed', count: 1 }])
  })

  it('hands a student none of it: they are refused, and the plan and pattern are never read', async () => {
    const { result } = open('an@example.com', 'SWB0001')

    await expect(result).rejects.toMatchObject({ statusCode: 403 })
  })

  it('refuses a lecturer the plan and pattern of a student outside their courses', async () => {
    const { result } = open('other@example.com', 'SWB0001')

    await expect(result).rejects.toMatchObject({ statusCode: 403 })
  })
})

describe('the activity a review lists', () => {
  it('keeps the events behind a signal even when they are older than the latest ones', async () => {
    const parts = setup()
    const quiet = Array.from({ length: 150 }, (_, index): ReviewEvent => ({
      id: 10 + index,
      type: 'module_opened',
      time: '2026-11-19T09:00:00Z',
      payload: { moduleId: 'loops' },
    }))
    const store = createMemoryStaffReviewStore({
      students: [an],
      courses: [{ id: 'intro_python', ownerEmail: 'lecturer@example.com', enrolled: ['an-id'] }],
      activity: { 'an-id': [...events, ...quiet] },
    })

    const review = await handleStaffReview({
      email: 'lecturer@example.com',
      adminEmails,
      lecturerEmails,
      studentNumber: 'SWB0001',
      store,
      accessLog: parts.accessLog,
      ...reading(parts.submissions),
    })

    const listed = review.activity.map(event => event.id)
    for (const signal of review.signals) for (const id of signal.eventIds) expect(listed).toContain(id)
    expect(listed).toEqual([...listed].sort((left, right) => right - left))
    expect(review.activity.length).toBeLessThan(quiet.length + events.length)
  })
})

describe('reading the staff access log', () => {
  async function read(email: string | null, accessLog = setup().accessLog) {
    return handleAdmin({
      email,
      adminEmails,
      env: { provider: 'fake', apiKey: '', baseUrl: '', modelName: '' },
      store: createMemoryModelSettingsStore(),
      accessLog,
      courses: createMemoryCourseStore(),
      body: { event: 'staffAccessLog' },
    })
  }

  it('shows an administrator who opened which student, newest first', async () => {
    const parts = setup()
    await open('lecturer@example.com', 'SWB0001', parts).result
    await open('owner@example.com', 'SWB0001', parts).result

    const answer = await read('owner@example.com', parts.accessLog)

    expect(answer.staffAccess.map(entry => [entry.actorEmail, entry.studentNumber, entry.opened])).toEqual([
      ['owner@example.com', 'SWB0001', 'student_review'],
      ['lecturer@example.com', 'SWB0001', 'student_review'],
    ])
  })

  it('names the module of a conversation that was opened', async () => {
    const parts = setup({ conversations: talked })
    await open('lecturer@example.com', 'SWB0001', parts).result
    await openConversation('lecturer@example.com', 'SWB0001', 'loops', parts).result

    const answer = await read('owner@example.com', parts.accessLog)

    expect(answer.staffAccess.map(entry => [entry.opened, entry.moduleName])).toEqual([
      ['student_conversation', 'Loops'],
      ['student_review', null],
    ])
  })

  it.each(['lecturer@example.com', 'an@example.com'])('refuses %s', async (email) => {
    await expect(read(email)).rejects.toMatchObject({ statusCode: 403 })
  })

  it('reads nothing of it for any other administrator call', async () => {
    const parts = setup()
    await open('owner@example.com', 'SWB0001', parts).result

    const answer = await handleAdmin({
      email: 'owner@example.com',
      adminEmails,
      env: { provider: 'fake', apiKey: '', baseUrl: '', modelName: '' },
      store: createMemoryModelSettingsStore(),
      accessLog: parts.accessLog,
      body: { event: 'read' },
    })

    expect(answer.staffAccess).toEqual([])
  })
})
