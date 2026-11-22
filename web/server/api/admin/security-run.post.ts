import { createConfiguredAgents } from '../../agents'
import { modelAddressLocked, resolveModelChoice, type ModelSettings } from '../../language-model'
import { createSupabaseCyberTestRecordStore } from '../../storage/supabase-cyber-test-record-store'
import { createSupabaseModelSettingsStore } from '../../storage/supabase-model-settings-store'
import { createSupabaseVerifyShieldStore } from '../../storage/supabase-verify-shield-store'
import { verifyShieldForTurn } from '../../verify-shield'
import { staffSessionEmail } from '../../auth/staff-session-email'
import {
  handleRunRequest,
  injectionRunBudgetMs,
  InjectionRunInProgressError,
  InjectionSuiteInvalidError,
  runInjectionSuite,
  type InjectionSuite,
} from '../../cyber-security'
import { ProductOwnerRequiredError, SignInRequiredError } from '../../admin/handle-admin'
import type { InjectionRunEvent } from '../../../shared/injection-suite'

// One run streams at a time on this server instance. The page also disables
// Run while its stream is open; this refuses a second tab or client.
let activeRun = false

export default defineEventHandler(async (event) => {
  const config = useRuntimeConfig(event)
  const connection = {
    url: config.public.supabaseUrl,
    secretKey: config.supabaseSecretKey,
  }
  const env: ModelSettings = {
    provider: config.model,
    apiKey: config.modelApiKey,
    baseUrl: config.modelBaseUrl,
    modelName: config.modelName,
  }
  const controller = new AbortController()

  // The model is built on the first pull, after the caller and the suite are cleared.
  async function* startRun(suite: InjectionSuite): AsyncGenerator<InjectionRunEvent> {
    const settings = (await createSupabaseModelSettingsStore(connection).read()) ?? env
    const production = modelAddressLocked()
    const choice = resolveModelChoice(settings, { production })
    yield* runInjectionSuite(suite, {
      agents: createConfiguredAgents(settings, { production }),
      verifyShieldOn: await verifyShieldForTurn(createSupabaseVerifyShieldStore(connection), config.verifyShield),
      provider: choice.kind,
      model: choice.kind === 'fake' ? 'Fake model' : choice.model,
      budgetMs: injectionRunBudgetMs,
      signal: controller.signal,
    })
  }

  let events: AsyncGenerator<InjectionRunEvent>
  try {
    events = await handleRunRequest({
      email: await staffSessionEmail(event),
      adminEmails: config.adminEmails,
      load: async () => {
        const text = await useStorage('assets:server').getItem<string>('injection-suite.yaml')
        if (typeof text !== 'string' || text.trim() === '') {
          throw new Error('The injection suite asset is missing.')
        }
        return text
      },
      run: startRun,
      begin: () => {
        if (activeRun) return false
        activeRun = true
        return true
      },
      end: () => {
        activeRun = false
      },
      records: createSupabaseCyberTestRecordStore(connection),
    })
  }
  catch (error) {
    if (error instanceof SignInRequiredError || error instanceof ProductOwnerRequiredError) {
      throw createError({ statusCode: error.statusCode, statusMessage: error.message })
    }
    if (error instanceof InjectionRunInProgressError) {
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

  setResponseHeader(event, 'content-type', 'application/x-ndjson; charset=utf-8')
  setResponseHeader(event, 'cache-control', 'no-cache, no-transform')
  setResponseHeader(event, 'x-accel-buffering', 'no')
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async pull(streamController) {
      try {
        const next = await events.next()
        if (next.done) {
          streamController.close()
          return
        }
        streamController.enqueue(encoder.encode(`${JSON.stringify(next.value)}\n`))
      }
      catch (error) {
        streamController.error(error)
      }
    },
    // A cancelled run stops scheduling; the generator's finally releases the guard.
    cancel() {
      controller.abort()
      void events.return(undefined)
    },
  })
  return sendStream(event, stream)
})
