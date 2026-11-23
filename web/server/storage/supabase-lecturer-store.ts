import { createClient } from '@supabase/supabase-js'
import type { Campus } from '../../shared/campus'
import type { CourseSpec } from '../course'
import type { StoredMastery } from '../student-model'
import type { LecturerStore } from './lecturer-store'

export function createSupabaseLecturerStore({ url, secretKey }: {
  url: string
  secretKey: string
}): LecturerStore {
  const supabase = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  return {
    async readDraft(email, courseId) {
      const result = await supabase.from('courses').select('draft')
        .eq('id', courseId).eq('owner_email', email).maybeSingle()
      if (result.error) throw new Error(result.error.message)
      return result.data?.draft ?? null
    },
    async saveDraft(email, courseId, spec) {
      const result = await supabase.from('courses').update({ draft: spec })
        .eq('id', courseId).eq('owner_email', email).select('id')
      if (result.error) throw new Error(result.error.message)
      return result.data.length > 0
    },
    async discardDraft(email, courseId) {
      const result = await supabase.from('courses').update({ draft: null })
        .eq('id', courseId).eq('owner_email', email).select('id')
      if (result.error) throw new Error(result.error.message)
      return result.data.length > 0
    },
    async exportSpec(email, courseId) {
      const result = await supabase.from('courses').select('spec')
        .eq('id', courseId).eq('owner_email', email).maybeSingle()
      if (result.error) throw new Error(result.error.message)
      return result.data?.spec ?? null
    },
    async importSpec(email, spec) {
      const result = await supabase.rpc('import_course_spec', { lecturer_email: email, new_spec: spec })
      if (result.error) throw new Error(result.error.message)
      return result.data === true
    },
    async setThreshold(email, courseId, threshold) {
      const result = await supabase.rpc('set_course_mastery_threshold', {
        course_key: courseId,
        lecturer_email: email,
        new_threshold: threshold,
      })
      if (result.error) throw new Error(result.error.message)
      return result.data === true
    },
    async forLecturer(email) {
      const courses = await supabase.from('courses').select('id, title, spec, masteryThreshold:spec->masteryThreshold')
        .eq('owner_email', email).order('title').order('id')
      if (courses.error) throw new Error(courses.error.message)

      return Promise.all(courses.data.map(async ({ id, title, spec, masteryThreshold }) => {
        if (typeof masteryThreshold !== 'number') throw new Error('The course has no mastery threshold.')
        const [enrollments, history] = await Promise.all([
          supabase.from('enrollments').select('student_id, enrolled_at').eq('course_id', id),
          supabase.from('course_history').select('action, actor_email, recorded_at, previous_threshold, mastery_threshold')
            .eq('course_id', id).order('recorded_at', { ascending: false }).order('id', { ascending: false }),
        ])
        if (enrollments.error) throw new Error(enrollments.error.message)
        if (history.error) throw new Error(history.error.message)
        const studentIds = enrollments.data.map(row => row.student_id)
        const [students, masteries] = await Promise.all([studentsIn(studentIds), masteriesIn(id, studentIds)])
        return {
          id,
          title,
          masteryThreshold,
          // A module has content exactly when its spec gives it content (Course progress counts only those).
          modules: ((spec as CourseSpec | null)?.modules ?? []).map(module => ({ id: module.id, available: module.content !== undefined })),
          enrolledCount: enrollments.data.length,
          history: history.data.map(row => ({
            action: row.action,
            actorEmail: row.actor_email,
            time: row.recorded_at,
            ...(row.previous_threshold === null ? {} : { previousThreshold: row.previous_threshold }),
            ...(row.mastery_threshold === null ? {} : { masteryThreshold: row.mastery_threshold }),
          })),
          students: students.map(student => ({
            displayName: student.displayName,
            studentNumber: student.studentNumber,
            email: student.email,
            campus: student.campus,
            enrolledAt: enrollments.data.find(row => row.student_id === student.id)?.enrolled_at ?? '',
            masteries: masteries.get(student.id) ?? [],
          })),
        }
      }))
    },
  }

  // The stored mastery rows (ADR 0008) of the course's enrolled students, read only for an owned course.
  async function masteriesIn(courseId: string, ids: string[]): Promise<Map<string, StoredMastery[]>> {
    const byStudent = new Map<string, StoredMastery[]>()
    if (ids.length === 0) return byStudent
    const result = await supabase.from('module_masteries')
      .select('student_id, module_id, mastery, passed_exercise, ever_mastered')
      .eq('course_id', courseId).in('student_id', ids)
    if (result.error) throw new Error(result.error.message)
    for (const row of result.data) {
      const rows = byStudent.get(row.student_id) ?? []
      rows.push({ moduleId: row.module_id, mastery: row.mastery, passedExercise: row.passed_exercise, everMastered: row.ever_mastered })
      byStudent.set(row.student_id, rows)
    }
    return byStudent
  }

  async function studentsIn(ids: string[]): Promise<{ id: string, displayName: string, studentNumber: string, email: string, campus: Campus | null }[]> {
    if (ids.length === 0) return []
    const result = await supabase.from('student_directory')
      .select('id, display_name, student_number, email, campus')
      .in('id', ids)
      .order('display_name')
    if (result.error) throw new Error(result.error.message)
    return result.data.map(row => ({
      id: row.id,
      displayName: row.display_name,
      studentNumber: row.student_number,
      email: row.email,
      campus: row.campus,
    }))
  }
}
