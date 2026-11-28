import { staffSessionEmail } from '../../auth/staff-session-email'
import { handleStaffConversation, StaffReviewError } from '../../staff-review'
import { createSupabaseCourseStore } from '../../storage/supabase-course-store'
import { createSupabaseStaffAccessLog } from '../../storage/supabase-staff-access-log'
import { createSupabaseStaffReviewStore } from '../../storage/supabase-staff-review-store'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  const config = useRuntimeConfig(event)
  const connection = { url: config.public.supabaseUrl, secretKey: config.supabaseSecretKey }
  try {
    return await handleStaffConversation({
      email: await staffSessionEmail(event),
      adminEmails: config.adminEmails,
      lecturerEmails: config.lecturerEmails,
      studentNumber: String(getQuery(event).studentNumber ?? ''),
      moduleId: String(getQuery(event).moduleId ?? ''),
      store: createSupabaseStaffReviewStore(connection),
      accessLog: createSupabaseStaffAccessLog(connection),
      courses: createSupabaseCourseStore(connection),
    })
  }
  catch (error) {
    if (error instanceof StaffReviewError) {
      throw createError({ statusCode: error.statusCode, statusMessage: error.message })
    }
    throw error
  }
})
