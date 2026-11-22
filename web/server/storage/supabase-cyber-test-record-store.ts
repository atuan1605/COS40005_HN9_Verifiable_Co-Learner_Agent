import { createClient } from '@supabase/supabase-js'
import type { CyberTestRecordStore } from './cyber-test-record-store'

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
  }
}
