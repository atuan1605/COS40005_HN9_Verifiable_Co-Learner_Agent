import { staffSessionEmail } from '../auth/staff-session-email'
import { handleLecturer } from '../lecturer/handle-lecturer'
import { createSupabaseCourseStore } from '../storage/supabase-course-store'
import { createSupabaseEvidenceStore } from '../storage/supabase-evidence-store'
import { createSupabaseLecturerStore } from '../storage/supabase-lecturer-store'
import { createSupabaseMasteryRecalculator } from '../storage/supabase-mastery-recalculation'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  const config = useRuntimeConfig(event)
  const connection = { url: config.public.supabaseUrl, secretKey: config.supabaseSecretKey }
  return handleLecturer({
    email: await staffSessionEmail(event),
    lecturerEmails: config.lecturerEmails,
    courses: createSupabaseCourseStore(connection),
    evidence: courseId => createSupabaseEvidenceStore({ ...connection, courseId }),
    store: createSupabaseLecturerStore(connection),
    change: await readBody(event) ?? null,
    // A new threshold judges every student's stored mastery against a different mark (ADR 0008).
    recalculate: createSupabaseMasteryRecalculator(connection),
  })
})
