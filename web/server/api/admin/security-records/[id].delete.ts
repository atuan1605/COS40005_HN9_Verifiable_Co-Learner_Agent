import { ProductOwnerRequiredError, SignInRequiredError } from '../../../admin/handle-admin'
import { staffSessionEmail } from '../../../auth/staff-session-email'
import { CyberTestRecordNotFoundError, handleDeleteRecordRequest, parseRecordId } from '../../../cyber-security'
import { createSupabaseCyberTestRecordStore } from '../../../storage/supabase-cyber-test-record-store'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  const config = useRuntimeConfig(event)
  try {
    return await handleDeleteRecordRequest({
      email: await staffSessionEmail(event),
      adminEmails: config.adminEmails,
      store: createSupabaseCyberTestRecordStore({
        url: config.public.supabaseUrl,
        secretKey: config.supabaseSecretKey,
      }),
    }, parseRecordId(getRouterParam(event, 'id')))
  }
  catch (error) {
    if (error instanceof SignInRequiredError || error instanceof ProductOwnerRequiredError) {
      throw createError({ statusCode: error.statusCode, statusMessage: error.message })
    }
    if (error instanceof CyberTestRecordNotFoundError) {
      throw createError({ statusCode: error.statusCode, statusMessage: error.message })
    }
    throw error
  }
})
