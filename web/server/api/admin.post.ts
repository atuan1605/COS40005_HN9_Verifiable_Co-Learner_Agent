import { staffSessionEmail } from '../auth/staff-session-email'
import {
  AdminNotFoundError,
  AdminRequestError,
  checkAdminRole,
  handleAdmin,
  handleConnectionTest,
  isConnectionTest,
  isRoleCheck,
  ModelSettingsError,
  ProductOwnerRequiredError,
  SignInRequiredError,
} from '../admin/handle-admin'
import { defaultCourseId } from '../course'
import { createSupabaseCourseStore } from '../storage/supabase-course-store'
import { createSupabaseDecisionLogStore } from '../storage/supabase-decision-log'
import { createSupabaseStaffAccessLog } from '../storage/supabase-staff-access-log'
import { createSupabaseModelSettingsStore } from '../storage/supabase-model-settings-store'
import { createSupabaseStudentDirectoryStore } from '../storage/supabase-student-directory'
import { createSupabaseVerifyShieldStore } from '../storage/supabase-verify-shield-store'

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig()
  const connection = {
    url: config.public.supabaseUrl,
    secretKey: config.supabaseSecretKey,
  }
  try {
    const body = await readBody(event)
    const email = await staffSessionEmail(event)
    if (isRoleCheck(body)) return checkAdminRole({ email, adminEmails: config.adminEmails })
    const request = {
      email,
      adminEmails: config.adminEmails,
      env: {
        provider: config.model,
        apiKey: config.modelApiKey,
        baseUrl: config.modelBaseUrl,
        modelName: config.modelName,
      },
      store: createSupabaseModelSettingsStore(connection),
      // The decision log of the one course there is in sprint 1.
      decisions: createSupabaseDecisionLogStore({ ...connection, courseId: defaultCourseId }),
      verifyShield: createSupabaseVerifyShieldStore(connection),
      verifyShieldEnv: config.verifyShield,
      students: createSupabaseStudentDirectoryStore(connection),
      accessLog: createSupabaseStaffAccessLog(connection),
      courses: createSupabaseCourseStore(connection),
      body,
    }
    if (isConnectionTest(body)) return await handleConnectionTest(request)
    return await handleAdmin(request)
  }
  catch (error) {
    if (
      error instanceof SignInRequiredError
      || error instanceof ProductOwnerRequiredError
      || error instanceof ModelSettingsError
      || error instanceof AdminRequestError
      || error instanceof AdminNotFoundError
    ) {
      throw createError({ statusCode: error.statusCode, statusMessage: error.message })
    }
    throw error
  }
})
