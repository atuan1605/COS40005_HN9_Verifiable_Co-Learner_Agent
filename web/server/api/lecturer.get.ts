import { staffSessionEmail } from '../auth/staff-session-email'
import { handleLecturer } from '../lecturer/handle-lecturer'
import { createSupabaseCourseStore } from '../storage/supabase-course-store'
import { createSupabaseEvidenceStore } from '../storage/supabase-evidence-store'
import { createSupabaseLecturerStore } from '../storage/supabase-lecturer-store'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  const config = useRuntimeConfig(event)
  const connection = { url: config.public.supabaseUrl, secretKey: config.supabaseSecretKey }
  return handleLecturer({
    email: await staffSessionEmail(event),
    lecturerEmails: config.lecturerEmails,
    courses: createSupabaseCourseStore(connection),
    evidence: courseId => createSupabaseEvidenceStore({ ...connection, courseId }),
    campus: String(getQuery(event).campus ?? ''),
    store: {
      forLecturer(email) {
        return createSupabaseLecturerStore({
          url: config.public.supabaseUrl,
          secretKey: config.supabaseSecretKey,
        }).forLecturer(email)
      },
      async setThreshold() {
        throw new Error('Use POST to change the threshold')
      },
    },
  })
})
