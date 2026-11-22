import type { InjectionRunEvent } from '../../shared/injection-suite'
import { requireProductOwner } from '../admin/handle-admin'
import { InjectionSuiteInvalidError } from './handle-suite'
import { parseInjectionSuite, type InjectionSuite } from './injection-suite'

export class InjectionRunInProgressError extends Error {
  readonly statusCode = 409

  constructor() {
    super('A security run is already in progress.')
    this.name = 'InjectionRunInProgressError'
  }
}

export interface InjectionRunRequest {
  email: string | null
  adminEmails: string
  // Set by tests. The route reads the committed asset.
  load: () => Promise<string>
  // Called only once the caller is cleared and the suite parses, so a refusal
  // or a malformed file costs no model call.
  run: (suite: InjectionSuite) => AsyncGenerator<InjectionRunEvent>
  // Set by the route so one run streams at a time; releasing happens when the
  // stream ends, is cancelled, or fails before it starts.
  begin?: () => boolean
  end?: () => void
}

export async function handleRunRequest(request: InjectionRunRequest): Promise<AsyncGenerator<InjectionRunEvent>> {
  requireProductOwner(request)
  if (request.begin && !request.begin()) throw new InjectionRunInProgressError()
  try {
    const result = parseInjectionSuite(await request.load())
    if (!result.ok) throw new InjectionSuiteInvalidError(result.problems)
    return releasing(request.run(result.suite), request.end)
  }
  catch (error) {
    request.end?.()
    throw error
  }
}

async function* releasing(
  events: AsyncGenerator<InjectionRunEvent>,
  end?: () => void,
): AsyncGenerator<InjectionRunEvent> {
  try {
    yield* events
  }
  finally {
    end?.()
  }
}
