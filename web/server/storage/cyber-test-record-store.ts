import type {
  CyberTestRecordDetail,
  CyberTestRecordListItem,
  CyberTestStop,
  InjectionCaseEvent,
  InjectionRunProvider,
} from '../../shared/injection-suite'

// One immutable record per Cyber test run, for the administrator's history.
// Only the server writes and reads it; the record holds the case results in the
// same shape the run streamed. Deletion is the only change a stored row allows.

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

export type StoredCyberTestRecord = CyberTestRecord & { id: number }

// The stored row as the detail handler receives it: the per-family tally is
// derived from the cases, so the store does not hold it.
export type CyberTestRecordRow = Omit<CyberTestRecordDetail, 'categories'>

export interface CyberTestRecordStore {
  record: (entry: CyberTestRecord) => Promise<void>
  // Newest first, without the case results.
  list: () => Promise<CyberTestRecordListItem[]>
  read: (id: number) => Promise<CyberTestRecordRow | null>
  remove: (id: number) => Promise<boolean>
}

export function createMemoryCyberTestRecordStore(): CyberTestRecordStore & { rows: StoredCyberTestRecord[] } {
  const rows: StoredCyberTestRecord[] = []
  let nextId = 1
  return {
    rows,
    async record(entry) {
      rows.push({ ...entry, id: nextId })
      nextId += 1
    },
    async list() {
      return [...rows]
        .sort((left, right) => right.id - left.id)
        .map(row => ({
          id: row.id,
          startedAt: row.startedAt,
          durationMs: row.durationMs,
          provider: row.provider,
          model: row.model,
          verifyShieldOn: row.verifyShieldOn,
          stopped: row.stopped,
          suiteVersion: row.suiteVersion,
          totalCases: row.totalCases,
          finishedCases: row.finishedCases,
          passed: row.passed,
          leaked: row.leaked,
          score: row.score,
        }))
    },
    async read(id) {
      const row = rows.find(entry => entry.id === id)
      return row ? { ...row } : null
    },
    async remove(id) {
      const index = rows.findIndex(entry => entry.id === id)
      if (index === -1) return false
      rows.splice(index, 1)
      return true
    },
  }
}
