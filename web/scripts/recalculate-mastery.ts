// One-off: recomputes every enrolled student's stored mastery in every course with the existing
// course-wide recalculator (ADR 0008). Run once when the mastery parameters change, such as the
// per-kind learning rates of #308. Unlocks are a union with the recorded ones, so no module closes
// (ADR 0005). Running it twice gives the same rows: the estimate is a pure function of evidence.
//
// Run locally against the deployed database, after the new build is live:
//   NUXT_PUBLIC_SUPABASE_URL=… NUXT_SUPABASE_SECRET_KEY=… pnpm dlx tsx scripts/recalculate-mastery.ts
import { createClient } from '@supabase/supabase-js'
import { createSupabaseMasteryRecalculator } from '../server/storage/supabase-mastery-recalculation'

const url = process.env.NUXT_PUBLIC_SUPABASE_URL
const secretKey = process.env.NUXT_SUPABASE_SECRET_KEY
if (!url || !secretKey) throw new Error('Set NUXT_PUBLIC_SUPABASE_URL and NUXT_SUPABASE_SECRET_KEY.')

const supabase = createClient(url, secretKey, { auth: { persistSession: false } })
const courses = await supabase.from('courses').select('id')
if (courses.error) throw new Error(courses.error.message)

const recalculate = createSupabaseMasteryRecalculator({ url, secretKey })
for (const { id } of courses.data as { id: string }[]) {
  await recalculate.forCourse(id)
  console.log(`Recalculated stored mastery for course ${id}.`)
}
