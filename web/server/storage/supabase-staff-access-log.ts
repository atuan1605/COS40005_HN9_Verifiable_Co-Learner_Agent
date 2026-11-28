import { createClient } from '@supabase/supabase-js'
import type { StaffAccessLog } from './staff-access-log'

export function createSupabaseStaffAccessLog({ url, secretKey }: { url: string, secretKey: string }): StaffAccessLog {
  const supabase = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return {
    async record(access) {
      const result = await supabase.from('staff_access_log').insert({
        actor_email: access.actorEmail,
        actor_role: access.actorRole,
        student_id: access.studentId,
        course_id: access.courseId,
        opened: access.opened,
        module_id: access.moduleId ?? null,
      })
      if (result.error) throw new Error(result.error.message)
    },
    async list(limit) {
      const rows = await supabase.from('staff_access_log')
        .select('id, created_at, actor_email, actor_role, student_id, course_id, opened, module_id')
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(limit)
      if (rows.error) throw new Error(rows.error.message)
      const ids = [...new Set(rows.data.map(row => row.student_id))]
      const numbers = new Map<string, string>()
      if (ids.length > 0) {
        const students = await supabase.from('student_directory').select('id, student_number').in('id', ids)
        if (students.error) throw new Error(students.error.message)
        for (const student of students.data) numbers.set(student.id, student.student_number)
      }
      return rows.data.map(row => ({
        id: row.id,
        time: row.created_at,
        actorEmail: row.actor_email,
        actorRole: row.actor_role,
        studentId: row.student_id,
        studentNumber: numbers.get(row.student_id) ?? null,
        opened: row.opened,
        courseId: row.course_id,
        moduleId: row.module_id,
      }))
    },
  }
}
