import { createClient } from '@supabase/supabase-js'
import type { CyberTestRecordDetail, CyberTestRecordListItem } from '../../shared/injection-suite'
import type { CyberTestRecordStore } from './cyber-test-record-store'

interface StoredRow {
  id: number
  started_at: string
  duration_ms: number
  provider: CyberTestRecordListItem['provider']
  model: string
  verify_shield_on: boolean
  stopped: CyberTestRecordListItem['stopped']
  suite_version: number
  total_cases: number
  finished_cases: number
  passed: number
  leaked: number
  score: number | null
  cases?: CyberTestRecordDetail['cases']
}

const listColumns = 'id, started_at, duration_ms, provider, model, verify_shield_on, stopped, suite_version, total_cases, finished_cases, passed, leaked, score'

function toListItem(row: StoredRow): CyberTestRecordListItem {
  return {
    id: row.id,
    startedAt: Date.parse(row.started_at),
    durationMs: row.duration_ms,
    provider: row.provider,
    model: row.model,
    verifyShieldOn: row.verify_shield_on,
    stopped: row.stopped,
    suiteVersion: row.suite_version,
    totalCases: row.total_cases,
    finishedCases: row.finished_cases,
    passed: row.passed,
    leaked: row.leaked,
    score: row.score,
  }
}

export function createSupabaseCyberTestRecordStore({ url, secretKey }: { url: string, secretKey: string }): CyberTestRecordStore {
  const supabase = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return {
    async record(entry) {
      const result = await supabase.from('cyber_test_records').insert({
        started_at: new Date(entry.startedAt).toISOString(),
        duration_ms: entry.durationMs,
        provider: entry.provider,
        model: entry.model,
        verify_shield_on: entry.verifyShieldOn,
        stopped: entry.stopped,
        suite_version: entry.suiteVersion,
        total_cases: entry.totalCases,
        finished_cases: entry.finishedCases,
        passed: entry.passed,
        leaked: entry.leaked,
        score: entry.score,
        cases: entry.cases,
      })
      if (result.error) throw new Error(result.error.message)
    },
    async list() {
      const result = await supabase
        .from('cyber_test_records')
        .select(listColumns)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
      if (result.error) throw new Error(result.error.message)
      return (result.data as StoredRow[]).map(toListItem)
    },
    async read(id) {
      const result = await supabase
        .from('cyber_test_records')
        .select('*')
        .eq('id', id)
        .maybeSingle()
      if (result.error) throw new Error(result.error.message)
      if (!result.data) return null
      const row = result.data as StoredRow
      return { ...toListItem(row), cases: row.cases ?? [] }
    },
    async remove(id) {
      const result = await supabase
        .from('cyber_test_records')
        .delete()
        .eq('id', id)
        .select('id')
      if (result.error) throw new Error(result.error.message)
      return result.data.length > 0
    },
  }
}
