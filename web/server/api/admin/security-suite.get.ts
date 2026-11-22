import { ProductOwnerRequiredError, SignInRequiredError } from '../../admin/handle-admin'
import { staffSessionEmail } from '../../auth/staff-session-email'
import { handleSuiteRequest, InjectionSuiteInvalidError } from '../../cyber-security'

export default defineEventHandler(async (event) => {
  setResponseHeader(event, 'Cache-Control', 'private, no-store')
  const config = useRuntimeConfig(event)
  try {
    return await handleSuiteRequest({
      email: await staffSessionEmail(event),
      adminEmails: config.adminEmails,
      load: async () => {
        const text = await useStorage('assets:server').getItem<string>('injection-suite.yaml')
        if (typeof text !== 'string' || text.trim() === '') {
          throw new Error('The injection suite asset is missing.')
        }
        return text
      },
    })
  }
  catch (error) {
    if (error instanceof SignInRequiredError || error instanceof ProductOwnerRequiredError) {
      throw createError({ statusCode: error.statusCode, statusMessage: error.message })
    }
    if (error instanceof InjectionSuiteInvalidError) {
      throw createError({
        statusCode: error.statusCode,
        statusMessage: 'The injection suite is invalid',
        data: { problems: error.problems },
      })
    }
    throw error
  }
})
