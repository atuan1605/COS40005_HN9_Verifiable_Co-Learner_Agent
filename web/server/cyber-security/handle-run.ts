import type { InjectionCaseEvent, InjectionRunEvent } from '../../shared/injection-suite'
import { requireProductOwner } from '../admin/handle-admin'
import type { CyberTestRecordStore } from '../storage/cyber-test-record-store'
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
  // The route's record store. A write that fails is logged and ignored.
  records?: CyberTestRecordStore
}

export async function handleRunRequest(request: InjectionRunRequest): Promise<AsyncGenerator<InjectionRunEvent>> {
  requireProductOwner(request)
  if (request.begin && !request.begin()) throw new InjectionRunInProgressError()
  try {
    const result = parseInjectionSuite(await request.load())
    if (!result.ok) throw new InjectionSuiteInvalidError(result.problems)
    return archiving(request.run(result.suite), result.suite.version, request.records, request.end)
  }
  catch (error) {
    request.end?.()
    throw error
  }
}

// Reads the events as they stream and writes one Cyber test record when the
// stream closes, however it closes: exhausted, stopped at the budget, or
// cancelled by the client. A failed write never reaches the stream.
async function* archiving(
  events: AsyncGenerator<InjectionRunEvent>,
  suiteVersion: number,
  records: CyberTestRecordStore | undefined,
  end: (() => void) | undefined,
): AsyncGenerator<InjectionRunEvent> {
  const cases: InjectionCaseEvent[] = []
  let start: Extract<InjectionRunEvent, { type: 'start' }> | null = null
  let done: Extract<InjectionRunEvent, { type: 'done' }> | null = null
  try {
    for await (const event of events) {
      if (event.type === 'start') start = event
      else if (event.type === 'case') cases.push(event)
      else done = event
      yield event
    }
  }
  finally {
    end?.()
    if (start && records) {
      // Counted from the delivered events, so the row satisfies its checks even
      // if a done count ever disagreed with what the browser received.
      const passed = cases.filter(entry => entry.verdict === 'pass').length
      const leaked = cases.filter(entry => entry.verdict === 'leak').length
      try {
        await records.record({
          startedAt: start.startedAt,
          durationMs: done?.durationMs ?? Math.max(0, Date.now() - start.startedAt),
          provider: start.provider,
          model: start.model,
          verifyShieldOn: start.verifyShieldOn,
          stopped: done?.stopped ?? 'cancelled',
          suiteVersion,
          totalCases: start.totalCases,
          finishedCases: cases.length,
          passed,
          leaked,
          score: cases.length === 0 ? null : passed / cases.length,
          cases,
        })
      }
      catch (error) {
        console.error('The Cyber test record was not saved.', error)
      }
    }
  }
}
