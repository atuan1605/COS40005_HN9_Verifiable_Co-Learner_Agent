import type { InjectionSuiteView } from '../../shared/injection-suite'
import { requireProductOwner } from '../admin/handle-admin'
import { parseInjectionSuite, suiteView } from './injection-suite'

export class InjectionSuiteInvalidError extends Error {
  readonly statusCode = 500
  readonly problems: string[]

  constructor(problems: string[]) {
    super(`The injection suite is invalid:\n- ${problems.join('\n- ')}`)
    this.name = 'InjectionSuiteInvalidError'
    this.problems = problems
  }
}

export interface InjectionSuiteRequest {
  email: string | null
  adminEmails: string
  // Set by tests. The route reads the committed asset.
  load: () => Promise<string>
}

export async function handleSuiteRequest(request: InjectionSuiteRequest): Promise<InjectionSuiteView> {
  requireProductOwner(request)
  const result = parseInjectionSuite(await request.load())
  if (!result.ok) throw new InjectionSuiteInvalidError(result.problems)
  return suiteView(result.suite)
}
