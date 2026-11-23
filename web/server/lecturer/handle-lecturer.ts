import { courseProgress } from '../../shared/course-progress'
import type { CoursePreview, LecturerCourse, LecturerResponse } from '../../shared/lecturer'
import { campusRule, isCampus } from '../../shared/campus'
import { defaultCourseId, parseCourseSpec, type CourseSpec } from '../course'
import type { CourseImageStore } from '../storage/course-image-store'
import { moduleStandings, needsEvidence, type EvidenceStore, type MasteryRecalculator } from '../student-model'
import { createMemoryCourseStore, type CourseStore } from '../storage/course-store'
import type { LecturerCourseRecord, LecturerStore } from '../storage/lecturer-store'
import { coursePreview } from './preview-course'

interface LecturerIdentity {
  email: string | null
  lecturerEmails: string
}

export function isLecturer(email: string, lecturerEmails: string): boolean {
  const wanted = email.trim().toLowerCase()
  return lecturerEmails.split(',').some(allowed => allowed.trim().toLowerCase() === wanted)
}

function requireLecturer(request: LecturerIdentity): string {
  const email = request.email?.trim().toLowerCase()
  if (!email) {
    throw Object.assign(new Error('Sign in required'), { statusCode: 401 })
  }
  if (!isLecturer(email, request.lecturerEmails)) {
    throw Object.assign(new Error('Lecturer access required'), { statusCode: 403 })
  }
  return email
}

export async function handleLecturer(request: LecturerIdentity & {
  store: Pick<LecturerStore, 'forLecturer' | 'setThreshold'>
  change?: unknown
  // Narrows each course's enrolled students to one campus; empty means all.
  campus?: string
  // Stored mastery is recomputed for every enrolled student, because whether a module is
  // mastered is judged against the current threshold (ADR 0008). Absent in tests of the answer alone.
  recalculate?: MasteryRecalculator
  // The course as the student's roadmap reads it, and the ledger a student's missing mastery rows
  // and legacy unlocks are rebuilt from, so Course progress matches the roadmap.
  courses?: CourseStore
  evidence?: (courseId: string) => EvidenceStore
}): Promise<LecturerResponse> {
  const email = requireLecturer(request)
  const campus = request.campus ?? ''
  if (campus !== '' && !isCampus(campus)) {
    throw Object.assign(new Error(campusRule), { statusCode: 400 })
  }
  if (request.change !== undefined) {
    const change = request.change
    if (typeof change !== 'object' || change === null
      || !('courseId' in change) || typeof change.courseId !== 'string' || !change.courseId.trim()
      || !('threshold' in change) || typeof change.threshold !== 'number'
      || !Number.isFinite(change.threshold) || change.threshold < 0.5 || change.threshold > 0.99) {
      throw Object.assign(new Error('Mastery threshold must be between 0.5 and 0.99 for an owned course'), { statusCode: 400 })
    }
    if (!(await request.store.setThreshold(email, change.courseId, change.threshold))) {
      throw Object.assign(new Error('Course not found'), { statusCode: 404 })
    }
    await request.recalculate?.forCourse(change.courseId)
  }
  const courses = await Promise.all((await request.store.forLecturer(email))
    .map(record => withProgress(record, request.courses ?? createMemoryCourseStore(), request.evidence)))
  if (campus === '') return { courses }
  return { courses: courses.map(course => ({ ...course, students: course.students.filter(student => student.campus === campus) })) }
}

// Course progress for each enrolled student of an owned course, from the same stored mastery the
// student and the agents read (ADR 0013), judged by the roadmap's own module states: recorded and
// legacy unlocks count, and missing rows are rebuilt from evidence. The stored rows are not sent.
async function withProgress(
  { students, ...course }: LecturerCourseRecord,
  courses: CourseStore,
  evidence: ((courseId: string) => EvidenceStore) | undefined,
): Promise<LecturerCourse> {
  const studied = await courses.course(course.id)
  const ledger = evidence?.(course.id)
  return {
    ...course,
    students: await Promise.all(students.map(async ({ id, masteries, unlocks, ...student }) => {
      const observations = ledger && needsEvidence(studied, masteries) ? await ledger.forStudent(id) : []
      const standings = moduleStandings(studied, { stored: masteries, evidence: observations, recordedUnlocks: unlocks })
      return {
        ...student,
        progress: courseProgress(studied.modules.map((module, index) => ({ available: module.available, state: standings[index]!.state }))),
      }
    })),
  }
}

interface CourseSpecRequest extends LecturerIdentity {
  store: Pick<LecturerStore, 'exportSpec' | 'importSpec' | 'readDraft' | 'saveDraft' | 'discardDraft'>
  // A published spec may add, drop or move modules and questions, so every enrolled student's
  // stored mastery is recomputed from the evidence the new course still has (ADR 0008).
  recalculate?: MasteryRecalculator
}

type CourseSpecAction =
  | { action: 'export' | 'draft' | 'preview' | 'publish' | 'discard', courseId: unknown }
  | { action: 'import' | 'save', json: unknown }

export function handleCourseSpec(request: CourseSpecRequest & { action: 'export', courseId: unknown }): Promise<CourseSpec>
export function handleCourseSpec(request: CourseSpecRequest & { action: 'draft', courseId: unknown }): Promise<CourseSpec | null>
export function handleCourseSpec(request: CourseSpecRequest & { action: 'preview', courseId: unknown }): Promise<CoursePreview>
export function handleCourseSpec(request: CourseSpecRequest & { action: 'import' | 'save', json: unknown }): Promise<void>
export function handleCourseSpec(request: CourseSpecRequest & { action: 'publish' | 'discard', courseId: unknown }): Promise<void>
export async function handleCourseSpec(request: CourseSpecRequest & CourseSpecAction): Promise<CourseSpec | CoursePreview | null | void> {
  const email = requireLecturer(request)
  if (request.action === 'export' || request.action === 'draft' || request.action === 'preview' || request.action === 'publish' || request.action === 'discard') {
    if (request.courseId !== defaultCourseId) throw notFound()
    if (request.action === 'export') {
      const spec = await request.store.exportSpec(email, defaultCourseId)
      if (spec) return spec
      throw notFound()
    }
    if (request.action === 'draft') return request.store.readDraft(email, defaultCourseId)
    if (request.action === 'discard') {
      if (await request.store.discardDraft(email, defaultCourseId)) return
      throw notFound()
    }
    if (request.action === 'preview') {
      const draft = await request.store.readDraft(email, defaultCourseId)
      const spec = draft ?? await request.store.exportSpec(email, defaultCourseId)
      if (!spec) throw notFound()
      return coursePreview(spec, draft !== null)
    }
    const draft = await request.store.readDraft(email, defaultCourseId)
    if (!draft) throw Object.assign(new Error('There is no draft to publish.'), { statusCode: 400 })
    if (await request.store.importSpec(email, draft) && await request.store.discardDraft(email, defaultCourseId)) {
      await request.recalculate?.forCourse(defaultCourseId)
      return
    }
    throw notFound()
  }

  if (request.action !== 'import' && request.action !== 'save') throw notFound()
  const spec = readSpec(request.json)
  if (spec.courseId !== defaultCourseId) {
    throw Object.assign(new Error('The course spec must be for the Python course.'), { statusCode: 400 })
  }
  if (await request.store.saveDraft(email, defaultCourseId, spec)) return
  throw notFound()
}

const imageExtensions: Record<string, string> = { 'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg' }
const imageLimit = 2 * 1024 * 1024

// Stores an image the lecturer picked for a materials block and returns the
// address the block keeps. Only the course's lecturer may add to its folder.
export async function handleCourseImage(request: LecturerIdentity & {
  store: Pick<LecturerStore, 'exportSpec'>
  images: CourseImageStore
  courseId: unknown
  image: unknown
}): Promise<{ url: string }> {
  const email = requireLecturer(request)
  if (request.courseId !== defaultCourseId || !(await request.store.exportSpec(email, defaultCourseId))) throw notFound()
  const image = request.image
  const contentType = typeof image === 'object' && image !== null && 'contentType' in image && typeof image.contentType === 'string' ? image.contentType : ''
  const base64 = typeof image === 'object' && image !== null && 'base64' in image && typeof image.base64 === 'string' ? image.base64 : ''
  const extension = imageExtensions[contentType]
  if (!extension) throw Object.assign(new Error('Use a JPEG, PNG or WebP image.'), { statusCode: 400 })
  const bytes = new Uint8Array(Buffer.from(base64, 'base64'))
  if (bytes.length === 0) throw Object.assign(new Error('The image is empty.'), { statusCode: 400 })
  if (bytes.length > imageLimit) throw Object.assign(new Error('The image must be 2 MB or smaller.'), { statusCode: 400 })
  return { url: await request.images.put(defaultCourseId, `${crypto.randomUUID()}.${extension}`, { bytes, contentType }) }
}

function readSpec(json: unknown): CourseSpec {
  try {
    if (typeof json !== 'string') throw new SyntaxError('Expected JSON')
    return parseCourseSpec(json)
  }
  catch (error) {
    const message = error instanceof SyntaxError || !(error instanceof Error)
      ? 'Invalid course spec JSON.'
      : error.message
    throw Object.assign(new Error(message), { statusCode: 400 })
  }
}

function notFound(): Error {
  return Object.assign(new Error('Course not found.'), { statusCode: 404 })
}
