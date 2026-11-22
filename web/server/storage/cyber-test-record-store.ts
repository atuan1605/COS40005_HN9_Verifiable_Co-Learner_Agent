import type { InjectionCaseEvent, InjectionRunProvider } from '../../shared/injection-suite'

// One immutable record per Cyber test run, for the administrator's history.
// Only the server writes and reads it; the record holds the case results in the
// same shape the run streamed.

export type CyberTestStop = 'complete' | 'budget' | 'cancelled'

export interface CyberTestRecord {
  startedAt: number
  durationMs: number
  provider: InjectionRunProvider
  model: string
  verifyShieldOn: boolean
  stopped: CyberTestStop
  suiteVersion: number
  totalCases: number
  finishedCases: number
  passed: number
  leaked: number
  // Null when no case finished, never zero.
  score: number | null
  cases: InjectionCaseEvent[]
}

export interface CyberTestRecordStore {
  record: (entry: CyberTestRecord) => Promise<void>
}

export function createMemoryCyberTestRecordStore(): CyberTestRecordStore & { rows: CyberTestRecord[] } {
  const rows: CyberTestRecord[] = []
  return {
    rows,
    async record(entry) {
      rows.push(entry)
    },
  }
}
