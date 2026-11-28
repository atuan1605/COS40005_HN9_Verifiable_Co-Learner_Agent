import { describe, expect, it, vi } from 'vitest'
import { handleCourseImage, handleCourseSpec, handleLecturer } from '../server/lecturer/handle-lecturer'
import { pythonCourse, pythonCourseSpec, type Course, type CourseSpec } from '../server/course'
import { createMemoryCourseImageStore } from '../server/storage/course-image-store'
import { createMemoryCourseStore } from '../server/storage/course-store'
import { createMemoryLecturerStore } from '../server/storage/lecturer-store'
import { createMemoryEvidenceStore, type EvidenceStore, type TimedObservation } from '../server/student-model'

const lecturerEmails = 'other@example.com, LECTURER@example.com'
const title = 'Introduction to Programming with Python'
const seeded = { action: 'seeded' as const, actorEmail: 'lecturer@example.com', time: '2026-11-14T08:00:00Z' }
const students = [
  { displayName: 'An', studentNumber: 'SWB0001', campus: 'Hanoi' as const, email: 'an@example.com', enrolledAt: '2026-11-14T08:00:00Z' },
  { displayName: 'Bình', studentNumber: 'SWB0002', campus: 'Can Tho' as const, email: 'binh@example.com', enrolledAt: '2026-11-14T08:05:00Z' },
]
const python = {
  ownerEmail: 'lecturer@example.com',
  id: 'intro_python',
  title,
  enrolledCount: 2,
  masteryThreshold: 0.9,
  history: [seeded],
  students,
}

describe('lecturer handler', () => {
  it.each([
    { email: null, statusCode: 401 },
    { email: 'an@example.com', statusCode: 403 },
    { email: 'owner@example.com', statusCode: 403 },
  ])('returns $statusCode for $email before reading courses', async ({ email, statusCode }) => {
    const store = { forLecturer: vi.fn(), setThreshold: vi.fn() }
    await expect(handleLecturer({ email, lecturerEmails, store })).rejects.toMatchObject({ statusCode })
    expect(store.forLecturer).not.toHaveBeenCalled()
  })

  it('shows the demo lecturer two enrollments, their students and the seeded history for their course only', async () => {
    const store = createMemoryLecturerStore([
      python,
      {
        ownerEmail: 'other@example.com',
        id: 'other',
        title: 'Other course',
        enrolledCount: 1,
        masteryThreshold: 0.9,
        history: [],
        students: [{ displayName: 'Elsewhere', studentNumber: 'SWB0009', campus: null, email: 'else@example.com', enrolledAt: '2026-11-14T09:00:00Z' }],
      },
    ])

    await expect(handleLecturer({ email: 'Lecturer@example.com', lecturerEmails, store })).resolves.toEqual({
      courses: [{
        id: 'intro_python',
        title,
        enrolledCount: 2,
        masteryThreshold: 0.9,
        history: [seeded],
        modules: pythonCourse.modules.map(({ id, name }) => ({ id, name })),
        students: students.map(student => ({
          ...student,
          progress: { mastered: 0, total: pythonCourse.modules.filter(module => module.available).length, percent: 0 },
          // A student with no evidence yet has only the first module open.
          moduleStates: Object.fromEntries(pythonCourse.modules.map((module, index) => [module.id, index === 0 ? 'open' : 'closed'])),
        })),
      }],
    })
  })

  it('shows the campus beside each student number and filters the enrolled students by it', async () => {
    const store = createMemoryLecturerStore([python])
    const request = { email: 'lecturer@example.com', lecturerEmails, store }

    const all = await handleLecturer(request)
    expect(all.courses[0]!.students.map(student => [student.studentNumber, student.campus])).toEqual([['SWB0001', 'Hanoi'], ['SWB0002', 'Can Tho']])

    const canTho = await handleLecturer({ ...request, campus: 'Can Tho' })
    expect(canTho.courses[0]!.students.map(student => student.studentNumber)).toEqual(['SWB0002'])
    // The count is of the whole class, not of the filtered view.
    expect(canTho.courses[0]!.enrolledCount).toBe(2)

    const danang = await handleLecturer({ ...request, campus: 'Da Nang' })
    expect(danang.courses[0]!.students).toEqual([])

    expect((await handleLecturer({ ...request, campus: '' })).courses[0]!.students).toHaveLength(2)
    await expect(handleLecturer({ ...request, campus: 'Mars' })).rejects.toMatchObject({ statusCode: 400 })
  })

  // Each passed exercise is one observation, so a module gets enough distinct exercises to be mastered.
  const exercisesOf = (moduleId: string) => Array.from({ length: 12 }, (_, index) => `${moduleId}_ex${index}`)
  // Three modules have content; the fourth is listed without content and never counts.
  const small = (extra: Partial<Course> = {}): Course => ({
    ...pythonCourse,
    modules: ['m1', 'm2', 'm3', 'm4'].map((id, index) => ({
      id, number: index + 1, name: id, part: '', summary: '', available: id !== 'm4', keywords: [], exerciseIds: exercisesOf(id), questionIds: [],
    })),
    ...extra,
  })
  const row = (moduleId: string, mastery: number, passedExercise: boolean) => ({ moduleId, mastery, passedExercise, everMastered: passedExercise && mastery >= 0.9 })
  const passes = (moduleId: string, count: number, time = '2026-11-20T08:00:00Z'): TimedObservation[] =>
    exercisesOf(moduleId).slice(0, count).map(exerciseId => ({ moduleId, kind: 'submission' as const, exerciseId, allPassed: true, time }))
  const ledger = (byStudent: Record<string, TimedObservation[]>) => (): EvidenceStore => ({
    ...createMemoryEvidenceStore(),
    async forStudent(id) { return byStudent[id] ?? [] },
  })

  it('counts a module mastered only once it is unlocked, as the roadmap does, and counts recorded unlocks', async () => {
    // m1 was never mastered, so m2 at the threshold is closed on the roadmap unless its unlock was recorded.
    const masteries = [row('m1', 0.5, true), { ...row('m2', 0.95, true), everMastered: false }, row('m3', 0, false), row('m4', 0, false)]
    const store = createMemoryLecturerStore([{
      ...python,
      students: [{ ...students[0]!, masteries }, { ...students[1]!, masteries, unlocks: ['m2'] }],
    }])

    const response = await handleLecturer({ email: 'lecturer@example.com', lecturerEmails, store, courses: createMemoryCourseStore([small()]) })

    expect(response.courses[0]!.students.map(student => student.progress.mastered)).toEqual([0, 1])
  })

  it('rebuilds a student\'s missing mastery rows from evidence instead of reading them as zero', async () => {
    const store = createMemoryLecturerStore([{ ...python, students: [{ ...students[0]!, id: 'an-id', masteries: [] }] }])

    const response = await handleLecturer({
      email: 'lecturer@example.com',
      lecturerEmails,
      store,
      courses: createMemoryCourseStore([small()]),
      evidence: ledger({ 'an-id': passes('m1', 12) }),
    })

    expect(response.courses[0]!.students[0]!.progress).toEqual({ mastered: 1, total: 3, percent: 33 })
  })

  it('keeps the unlocks the earlier threshold gave, as the roadmap does', async () => {
    const course = small({ masteryThreshold: 0.99, legacyUnlocks: { before: '2026-11-21T00:00:00Z', threshold: 0.5 } })
    // m1 never reaches 0.99, so only the legacy unlock under 0.5 opens m2, which is mastered.
    const store = createMemoryLecturerStore([{
      ...python,
      students: [{ ...students[0]!, id: 'an-id', masteries: [row('m1', 0.6, true), { ...row('m2', 0.995, true), everMastered: true }, row('m3', 0, false), row('m4', 0, false)] }],
    }])

    const response = await handleLecturer({
      email: 'lecturer@example.com',
      lecturerEmails,
      store,
      courses: createMemoryCourseStore([course]),
      evidence: ledger({ 'an-id': passes('m1', 3) }),
    })

    expect(response.courses[0]!.students[0]!.progress.mastered).toBe(1)
  })

  it('shows each enrolled student\'s Course progress for an owned course, from stored mastery', async () => {
    const store = createMemoryLecturerStore([
      {
        ...python,
        students: [
          // Two mastered; m3 is at the threshold but has no passed exercise, so it is not mastered.
          { ...students[0]!, masteries: [row('m1', 0.95, true), row('m2', 0.91, true), row('m3', 0.92, false), row('m4', 0, false)] },
          { ...students[1]!, masteries: [row('m1', 0.4, true), row('m2', 0, false), row('m3', 0, false), row('m4', 0, false)] },
        ],
      },
      {
        ownerEmail: 'other@example.com',
        id: 'other',
        title: 'Other course',
        enrolledCount: 1,
        masteryThreshold: 0.9,
        history: [],
        students: [{ displayName: 'Elsewhere', studentNumber: 'SWB0009', campus: null, email: 'else@example.com', enrolledAt: '2026-11-14T09:00:00Z', masteries: [row('m1', 0.99, true)] }],
      },
    ])

    const response = await handleLecturer({ email: 'lecturer@example.com', lecturerEmails, store, courses: createMemoryCourseStore([small()]) })

    expect(response.courses.map(course => course.id)).toEqual(['intro_python'])
    expect(response.courses[0]!.students.map(student => [student.email, student.progress])).toEqual([
      ['an@example.com', { mastered: 2, total: 3, percent: 66 }],
      ['binh@example.com', { mastered: 0, total: 3, percent: 0 }],
    ])
    expect(JSON.stringify(response)).not.toContain('masteries')
    expect(JSON.stringify(response)).not.toContain('else@example.com')
  })

  it('gives every module\'s state for each enrolled student of an owned course only, agreeing with Course progress', async () => {
    const store = createMemoryLecturerStore([
      {
        ...python,
        students: [
          { ...students[0]!, masteries: [row('m1', 0.95, true), row('m2', 0.4, true), row('m3', 0, false), row('m4', 0, false)] },
          { ...students[1]!, masteries: [row('m1', 0.4, true), row('m2', 0, false), row('m3', 0, false), row('m4', 0, false)] },
        ],
      },
      { ...python, ownerEmail: 'other@example.com', id: 'other', students: [{ ...students[0]!, email: 'else@example.com' }] },
    ])

    const response = await handleLecturer({ email: 'lecturer@example.com', lecturerEmails, store, courses: createMemoryCourseStore([small()]) })

    expect(response.courses.map(course => course.id)).toEqual(['intro_python'])
    const course = response.courses[0]!
    expect(course.modules).toEqual(['m1', 'm2', 'm3', 'm4'].map(id => ({ id, name: id })))
    expect(course.students.map(student => student.moduleStates)).toEqual([
      { m1: 'mastered', m2: 'open', m3: 'closed', m4: 'closed' },
      { m1: 'open', m2: 'closed', m3: 'closed', m4: 'closed' },
    ])
    expect(course.students.map(student => student.progress.mastered)).toEqual([1, 0])
    expect(JSON.stringify(response)).not.toContain('else@example.com')
  })

  it('gives an administrator who owns no course no Course insights', async () => {
    const store = createMemoryLecturerStore([python])
    // Not on the lecturer allowlist: refused outright.
    await expect(handleLecturer({ email: 'owner@example.com', lecturerEmails, store })).rejects.toMatchObject({ statusCode: 403 })
    // Also a lecturer, but of no course here: nothing about another lecturer's students.
    await expect(handleLecturer({ email: 'owner@example.com', lecturerEmails: 'owner@example.com', store })).resolves.toEqual({ courses: [] })
  })

  it.each([0.49, 1, NaN, '0.8'])('rejects invalid threshold %s before writing', async (threshold) => {
    const store = { forLecturer: vi.fn(), setThreshold: vi.fn() }
    await expect(handleLecturer({ email: 'lecturer@example.com', lecturerEmails, store, change: { courseId: python.id, threshold } }))
      .rejects.toMatchObject({ statusCode: 400 })
    expect(store.setThreshold).not.toHaveBeenCalled()
  })

  it('records one history entry for a change and rejects another lecturer changing it', async () => {
    const store = createMemoryLecturerStore([python])
    const request = { email: 'lecturer@example.com', lecturerEmails, store, change: { courseId: python.id, threshold: 0.99 } }
    await expect(handleLecturer({ ...request, email: 'other@example.com' })).rejects.toMatchObject({ statusCode: 404 })
    await handleLecturer(request)
    const { courses } = await handleLecturer(request)
    expect(courses[0]?.masteryThreshold).toBe(0.99)
    expect(courses[0]?.history).toEqual([
      { action: 'mastery_threshold_changed', actorEmail: request.email, previousThreshold: 0.9, masteryThreshold: 0.99, time: expect.any(String) },
      seeded,
    ])
  })
})

describe('lecturer course spec', () => {
  function setup() {
    const store = createMemoryLecturerStore([{ ...python, spec: pythonCourseSpec }])
    const request = { email: 'lecturer@example.com', lecturerEmails, store }
    const download = () => handleCourseSpec({ ...request, action: 'export', courseId: python.id })
    const upload = (spec: unknown) => handleCourseSpec({ ...request, action: 'import', json: JSON.stringify(spec) })
    return { request, download, upload }
  }

  it('keeps an import in the draft until publish writes course history', async () => {
    const { download, upload, request } = setup()
    const exported = await download()
    expect(exported).toEqual(pythonCourseSpec)
    const updated = { ...pythonCourseSpec, title: 'Python Foundations' }
    await upload(updated)
    expect(await download()).toEqual(pythonCourseSpec)
    expect(await handleCourseSpec({ ...request, action: 'draft', courseId: python.id })).toEqual(updated)
    expect((await handleLecturer(request)).courses[0]?.history).toEqual([seeded])

    await handleCourseSpec({ ...request, action: 'publish', courseId: python.id })
    expect(await download()).toEqual(updated)
    expect(await handleCourseSpec({ ...request, action: 'draft', courseId: python.id })).toBeNull()
    const { courses } = await handleLecturer(request)
    expect(courses[0]?.history[0]).toMatchObject({ action: 'course_spec_imported', actorEmail: request.email })
    expect(JSON.stringify(courses)).not.toContain('referenceSolution')
  })

  it.each(['export', 'draft', 'preview', 'publish', 'discard', 'import', 'save'] as const)(
    'refuses %s to a non-lecturer with 403 and touches no draft',
    async (action) => {
      const store = {
        exportSpec: vi.fn(), importSpec: vi.fn(), readDraft: vi.fn(), saveDraft: vi.fn(), discardDraft: vi.fn(),
      }
      const request = { email: 'an@example.com', lecturerEmails, store }
      const call = action === 'import' || action === 'save'
        ? handleCourseSpec({ ...request, action, json: JSON.stringify(pythonCourseSpec) })
        : handleCourseSpec({ ...request, action, courseId: python.id } as Parameters<typeof handleCourseSpec>[0] & { action: 'export' })
      await expect(call).rejects.toMatchObject({ statusCode: 403 })
      for (const method of Object.values(store)) expect(method).not.toHaveBeenCalled()
    },
  )

  it('saves an edited hint to the draft, survives a reload, and students see it only after publish', async () => {
    const { download, request } = setup()
    const edited = structuredClone(pythonCourseSpec)
    edited.modules[0]!.content!.hintLadder[0] = 'Look at the first line again.'
    await handleCourseSpec({ ...request, action: 'save', json: JSON.stringify(edited) })
    const reloaded = await handleCourseSpec({ ...request, action: 'draft', courseId: python.id })
    expect(reloaded?.modules[0]?.content?.hintLadder[0]).toBe('Look at the first line again.')
    expect((await download()).modules[0]?.content?.hintLadder[0]).not.toBe('Look at the first line again.')
    await handleCourseSpec({ ...request, action: 'publish', courseId: python.id })
    expect((await download()).modules[0]?.content?.hintLadder[0]).toBe('Look at the first line again.')
  })

  it('refuses to publish when there is no draft and writes no history', async () => {
    const { request } = setup()
    await expect(handleCourseSpec({ ...request, action: 'publish', courseId: python.id })).rejects.toMatchObject({ statusCode: 400 })
    expect((await handleLecturer(request)).courses[0]?.history).toEqual([seeded])
  })

  it('discards a draft and leaves the published spec', async () => {
    const { download, upload, request } = setup()
    await upload({ ...pythonCourseSpec, title: 'Python Foundations' })
    await handleCourseSpec({ ...request, action: 'discard', courseId: python.id })
    expect(await download()).toEqual(pythonCourseSpec)
    expect(await handleCourseSpec({ ...request, action: 'draft', courseId: python.id })).toBeNull()
    expect((await handleLecturer(request)).courses[0]?.history).toEqual([seeded])
  })

  it('names the module and block when the draft is invalid', async () => {
    const { upload, download } = setup()
    const spec = structuredClone(pythonCourseSpec)
    spec.modules[0]!.content!.materials = [{ type: 'image', url: '/a.png', alt: '' }]
    await expect(upload(spec)).rejects.toThrow('Module getting_started, block 1: alt is missing.')
    expect(await download()).toEqual(pythonCourseSpec)
  })

  it('previews the draft, marks teacher-only fields, and writes nothing', async () => {
    const { upload, download, request } = setup()
    await upload({ ...pythonCourseSpec, title: 'Python Foundations' })
    const preview = await handleCourseSpec({ ...request, action: 'preview', courseId: python.id })
    expect(preview.draft).toBe(true)
    expect(preview.title).toBe('Python Foundations')
    expect(preview.modules[0]?.quiz[0]).toMatchObject({ teacherOnly: true, correctIndex: expect.any(Number) })
    expect(preview.modules[0]?.hintLadder).toMatchObject({ teacherOnly: true })
    expect(preview.modules[0]?.misconceptionResponses[0]).toMatchObject({ teacherOnly: true })
    expect(JSON.stringify(preview)).not.toContain('referenceSolution')
    // A course preview records no activity, so it advises nothing.
    expect(JSON.stringify(preview)).not.toContain('studySuggestion')
    expect(await download()).toEqual(pythonCourseSpec)
    expect((await handleLecturer(request)).courses[0]?.history).toEqual([seeded])
  })

  it('reads only when previewing, so no student row and no agent answer is involved', async () => {
    const store = {
      exportSpec: vi.fn(async (): Promise<CourseSpec | null> => pythonCourseSpec),
      readDraft: vi.fn(async (): Promise<CourseSpec | null> => null),
      importSpec: vi.fn(),
      saveDraft: vi.fn(),
      discardDraft: vi.fn(),
    }
    const request = { email: 'lecturer@example.com', lecturerEmails, store }

    const preview = await handleCourseSpec({ ...request, action: 'preview', courseId: python.id })

    // The preview is the student's own view, so it holds what a student is
    // shown: the statement, the starter code and the tests that check them.
    expect(preview.draft).toBe(false)
    expect(preview.modules[0]?.exercises[0]).toMatchObject({
      id: 'say_hello',
      statement: pythonCourseSpec.modules[0]!.content!.exercises[0]!.statement,
      starterCode: pythonCourseSpec.modules[0]!.content!.exercises[0]!.starterCode,
      tests: pythonCourseSpec.modules[0]!.content!.exercises[0]!.tests,
    })
    expect(store.readDraft).toHaveBeenCalledWith('lecturer@example.com', 'intro_python')
    expect(store.exportSpec).toHaveBeenCalledWith('lecturer@example.com', 'intro_python')
    expect(store.importSpec).not.toHaveBeenCalled()
    expect(store.saveDraft).not.toHaveBeenCalled()
    expect(store.discardDraft).not.toHaveBeenCalled()
  })

  it.each([
    { ...pythonCourseSpec, courseId: 'other' },
    { ...pythonCourseSpec, modules: [{ ...pythonCourseSpec.modules[0], content: { materials: {} } }] },
  ])('refuses incompatible files without editing the course', async (invalid) => {
    const { download, upload, request } = setup()
    await expect(upload(invalid)).rejects.toMatchObject({ statusCode: 400 })
    expect(await download()).toEqual(pythonCourseSpec)
    expect((await handleLecturer(request)).courses[0]?.history).toEqual([seeded])
  })

  it.each([
    { email: null, statusCode: 401 },
    { email: 'an@example.com', statusCode: 403 },
    { email: 'other@example.com', statusCode: 404 },
  ])('refuses export and import for $email', async ({ email, statusCode }) => {
    const { request } = setup()
    await expect(handleCourseSpec({ ...request, email, action: 'export', courseId: python.id }))
      .rejects.toMatchObject({ statusCode })
    await expect(handleCourseSpec({ ...request, email, action: 'import', json: JSON.stringify(pythonCourseSpec) }))
      .rejects.toMatchObject({ statusCode })
  })
})

describe('course image upload', () => {
  const store = () => createMemoryLecturerStore([{ ...python, spec: pythonCourseSpec }])
  const png = { contentType: 'image/png', base64: Buffer.from([1, 2, 3]).toString('base64') }

  it('stores the lecturer\'s image in the course folder and returns its address', async () => {
    const images = createMemoryCourseImageStore()
    const { url } = await handleCourseImage({ email: 'lecturer@example.com', lecturerEmails, store: store(), images, courseId: 'intro_python', image: png })
    expect(url).toMatch(/^memory:intro_python\/[0-9a-f-]+\.png$/)
    expect([...images.files.values()]).toEqual([{ bytes: new Uint8Array([1, 2, 3]), contentType: 'image/png' }])
  })

  it.each([
    { email: null, statusCode: 401 },
    { email: 'an@example.com', statusCode: 403 },
    { email: 'other@example.com', statusCode: 404 },
  ])('refuses $email with $statusCode and stores nothing', async ({ email, statusCode }) => {
    const images = createMemoryCourseImageStore()
    await expect(handleCourseImage({ email, lecturerEmails, store: store(), images, courseId: 'intro_python', image: png }))
      .rejects.toMatchObject({ statusCode })
    expect(images.files.size).toBe(0)
  })

  it.each([
    { image: { contentType: 'image/gif', base64: 'AQID' }, message: 'Use a JPEG, PNG or WebP image.' },
    { image: { contentType: 'image/png', base64: '' }, message: 'The image is empty.' },
    { image: { contentType: 'image/png', base64: Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64') }, message: 'The image must be 2 MB or smaller.' },
    { image: null, message: 'Use a JPEG, PNG or WebP image.' },
  ])('refuses a bad image: $message', async ({ image, message }) => {
    const images = createMemoryCourseImageStore()
    await expect(handleCourseImage({ email: 'lecturer@example.com', lecturerEmails, store: store(), images, courseId: 'intro_python', image }))
      .rejects.toMatchObject({ statusCode: 400, message })
    expect(images.files.size).toBe(0)
  })
})
