import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { demoAccounts } from '../server/auth/demo-accounts'

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function envValue(name: string): string {
  const fromProcess = process.env[name]
  if (fromProcess) return fromProcess

  const envFile = resolve(webRoot, '.env')
  if (!existsSync(envFile)) return ''

  const line = readFileSync(envFile, 'utf8')
    .split('\n')
    .find(entry => entry.startsWith(`${name}=`))
  if (!line) return ''

  return line.slice(name.length + 1).trim().replace(/^["']|["']$/g, '')
}

function requiredEnv(name: string): string {
  const value = envValue(name)
  if (!value) throw new Error(`Missing ${name}. The rehearsal reads web/.env.`)
  return value
}

export function adminClient(): SupabaseClient {
  return createClient(requiredEnv('NUXT_PUBLIC_SUPABASE_URL'), requiredEnv('NUXT_SUPABASE_SECRET_KEY'), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })
}

interface DemoStudent {
  id: string
  seededEvidence: boolean
}

async function demoStudents(admin: SupabaseClient): Promise<DemoStudent[]> {
  const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
  if (listed.error) throw new Error(listed.error.message)

  return demoAccounts.map((account) => {
    const user = listed.data.users.find(candidate => candidate.email === account.email)
    if (!user) throw new Error(`Demo account ${account.email} is not seeded.`)
    return { id: user.id, seededEvidence: account.seededEvidence }
  })
}

export async function resetDemoAccounts() {
  const admin = adminClient()
  const students = await demoStudents(admin)
  const ids = students.map(student => student.id)
  const conversations = await admin.from('conversations').delete().in('student_id', ids)
  if (conversations.error) throw new Error(conversations.error.message)
  const resumePoints = await admin.from('resume_points').delete().in('student_id', ids)
  if (resumePoints.error) throw new Error(resumePoints.error.message)
  // Submissions a rehearsal makes are evidence, so they would change the
  // mastery the next run starts from. The seeded ledger is left as it is.
  const evidence = await admin.from('evidence').delete().in('student_id', clearableIds(students))
  if (evidence.error) throw new Error(evidence.error.message)
  // Stored mastery would outlive the evidence it came from. Without it, mastery is estimated
  // again from what is left of the ledger. Recorded unlocks are permanent (ADR 0005) and stay.
  const masteries = await admin.from('module_masteries').delete().in('student_id', ids)
  if (masteries.error) throw new Error(masteries.error.message)
  // Each rehearsal starts with Mai switched on, and with the day's 60 turns unused.
  const deskmate = await admin.from('deskmate_settings').delete().in('student_id', ids)
  if (deskmate.error) throw new Error(deskmate.error.message)
  const allowance = await admin.from('daily_turn_allowances').delete().in('student_id', ids)
  // The same suite can run against the shared database before the migration lands.
  if (allowance.error && allowance.error.code !== 'PGRST205') throw new Error(allowance.error.message)
  // A picture and a new name are the student's, so the next run starts without
  // them: the portrait file is removed and the name returns to the seeded one.
  // The demo students start with a campus so the campus step stays out of the
  // way; the campus specs clear it themselves.
  const portraits = await admin.storage.from('student-files').remove(ids.map(id => `${id}/portrait`))
  if (portraits.error) throw new Error(portraits.error.message)
  for (const [index, account] of demoAccounts.entries()) {
    const restored = await admin
      .from('students')
      .update({ display_name: account.displayName, picture_path: null, campus: 'Hanoi' })
      .eq('id', students[index].id)
    if (restored.error) throw new Error(restored.error.message)
  }
}

export async function studentNumberOf(email: string): Promise<string> {
  const admin = adminClient()
  const found = await admin.from('students').select('student_number').eq('id', await demoStudentIdByEmail(admin, email)).single()
  if (found.error) throw new Error(found.error.message)
  const number = found.data.student_number as string | null
  if (!number) throw new Error(`Demo account ${email} has no student number.`)
  return number
}

// The modules recorded as unlocked for a demo student, which an earlier run may have added to.
export async function recordedUnlocksOf(email: string): Promise<string[]> {
  const admin = adminClient()
  const found = await admin.from('module_unlocks').select('module_id')
    .eq('student_id', await demoStudentIdByEmail(admin, email)).eq('course_id', 'intro_python')
  if (found.error) throw new Error(found.error.message)
  return found.data.map(row => row.module_id as string)
}

export async function clearDemoCampus(email: string) {
  const admin = adminClient()
  const cleared = await admin.from('students').update({ campus: null }).eq('id', (await demoStudentIdByEmail(admin, email)))
  if (cleared.error) throw new Error(cleared.error.message)
}

async function demoStudentIdByEmail(admin: SupabaseClient, email: string): Promise<string> {
  const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
  if (listed.error) throw new Error(listed.error.message)
  const user = listed.data.users.find(candidate => candidate.email === email)
  if (!user) throw new Error(`Demo account ${email} is not seeded.`)
  return user.id
}

export async function deleteAccountByEmail(email: string) {
  const admin = adminClient()
  const listed = await admin.auth.admin.listUsers({ page: 1, perPage: 200 })
  if (listed.error) throw new Error(listed.error.message)
  const user = listed.data.users.find(candidate => candidate.email === email)
  if (user) {
    const removed = await admin.auth.admin.deleteUser(user.id)
    if (removed.error) throw new Error(removed.error.message)
  }
}

export async function resetDemoMindmapPositions() {
  const admin = adminClient()
  const ids = (await demoStudents(admin)).map(student => student.id)
  const positions = await admin.from('mindmap_positions').delete().in('student_id', ids)
  if (positions.error) throw new Error(positions.error.message)
  const resets = await admin.from('mindmap_arrangement_resets').delete().in('student_id', ids)
  // The same suite can run against the shared database before the migration lands.
  if (resets.error && resets.error.code !== 'PGRST205') throw new Error(resets.error.message)
}

export async function resetDemoMindmapNotes() {
  const admin = adminClient()
  const ids = (await demoStudents(admin)).map(student => student.id)
  const notes = await admin.from('mindmap_notes').delete().in('student_id', ids)
  if (notes.error) throw new Error(notes.error.message)
  const links = await admin.from('mindmap_links').delete().in('student_id', ids)
  if (links.error) throw new Error(links.error.message)
}

function clearableIds(students: readonly DemoStudent[]): string[] {
  return students.filter(student => !student.seededEvidence).map(student => student.id)
}

export async function demoAccountsAreClear(): Promise<boolean> {
  const admin = adminClient()
  const students = await demoStudents(admin)
  const ids = students.map(student => student.id)
  const conversations = await admin.from('conversations').select('id').in('student_id', ids)
  if (conversations.error) throw new Error(conversations.error.message)
  const resumePoints = await admin.from('resume_points').select('student_id').in('student_id', ids)
  if (resumePoints.error) throw new Error(resumePoints.error.message)
  const evidence = await admin.from('evidence').select('id').in('student_id', clearableIds(students))
  if (evidence.error) throw new Error(evidence.error.message)
  return (conversations.data ?? []).length === 0
    && (resumePoints.data ?? []).length === 0
    && (evidence.data ?? []).length === 0
}
