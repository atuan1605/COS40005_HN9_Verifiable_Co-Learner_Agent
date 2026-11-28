import { createClient } from '@supabase/supabase-js'
import type { PracticeTestResult } from '../../shared/turn'
import { learningPlanColumns, presentPlan } from './supabase-learning-plan-store'
import type { StaffReviewStore } from './staff-review-store'

// The most activity read for one student, so a very long history cannot make one opening unbounded.
const activityReadLimit = 5000
// One page of messages; PostgREST returns at most 1000 rows a request.
const messagePageSize = 500

export function createSupabaseStaffReviewStore({ url, secretKey }: { url: string, secretKey: string }): StaffReviewStore {
  const supabase = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  return {
    async studentByNumber(studentNumber) {
      const result = await supabase.from('student_directory')
        .select('id, display_name, student_number, email, campus')
        .eq('student_number', studentNumber)
        .maybeSingle()
      if (result.error) throw new Error(result.error.message)
      if (!result.data) return null
      return {
        id: result.data.id,
        displayName: result.data.display_name,
        studentNumber: result.data.student_number,
        email: result.data.email,
        campus: result.data.campus,
      }
    },
    async ownedCourseOf(lecturerEmail, studentId) {
      const owned = await supabase.from('courses').select('id').eq('owner_email', lecturerEmail)
      if (owned.error) throw new Error(owned.error.message)
      if (owned.data.length === 0) return null
      const enrolled = await supabase.from('enrollments').select('course_id')
        .eq('student_id', studentId)
        .in('course_id', owned.data.map(course => course.id))
        .order('course_id')
        .limit(1)
      if (enrolled.error) throw new Error(enrolled.error.message)
      return enrolled.data[0]?.course_id ?? null
    },
    async activity(studentId, courseId) {
      // A sign-in belongs to no course, so it is read with the course's own events.
      const result = await supabase.from('activity_log')
        .select('id, event_type, payload, created_at')
        .eq('student_id', studentId)
        .or(`course_id.eq.${courseId},course_id.is.null`)
        .order('id', { ascending: false })
        .limit(activityReadLimit)
      if (result.error) throw new Error(result.error.message)
      return result.data.reverse().map(row => ({
        id: row.id,
        type: row.event_type,
        time: row.created_at,
        payload: row.payload as Record<string, unknown>,
      }))
    },
    async submissions(studentId, courseId) {
      const result = await supabase.from('submissions')
        .select('id, module_id, exercise_id, code, results, outcome, message, created_at')
        .eq('student_id', studentId)
        .eq('course_id', courseId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
      if (result.error) throw new Error(result.error.message)
      return result.data.map(row => ({
        id: row.id,
        moduleId: row.module_id,
        exerciseId: row.exercise_id,
        code: row.code,
        results: row.results as PracticeTestResult[],
        outcome: row.outcome,
        message: row.message,
        time: row.created_at,
      }))
    },
    async learningPlans(studentId, courseId) {
      const result = await supabase.from('learning_plans')
        .select(learningPlanColumns)
        .eq('student_id', studentId)
        .eq('course_id', courseId)
        .order('module_id')
        .order('revision')
      if (result.error) throw new Error(result.error.message)
      return result.data.map(presentPlan)
    },
    async masteries(studentId, courseId) {
      const result = await supabase.from('module_masteries')
        .select('module_id, mastery, passed_exercise, ever_mastered')
        .eq('student_id', studentId).eq('course_id', courseId)
      if (result.error) throw new Error(result.error.message)
      return result.data.map(row => ({ moduleId: row.module_id, mastery: row.mastery, passedExercise: row.passed_exercise, everMastered: row.ever_mastered }))
    },
    async unlocks(studentId, courseId) {
      const result = await supabase.from('module_unlocks').select('module_id')
        .eq('student_id', studentId).eq('course_id', courseId)
      if (result.error) throw new Error(result.error.message)
      return result.data.map(row => row.module_id)
    },
    async hasConversation(studentId, courseId, moduleId) {
      const result = await supabase.from('conversations').select('id')
        .eq('student_id', studentId).eq('course_id', courseId).eq('module_id', moduleId).limit(1)
      if (result.error) throw new Error(result.error.message)
      return result.data.length > 0
    },
    async conversations(studentId, courseId, moduleId) {
      let query = supabase.from('conversations').select('id, module_id')
        .eq('student_id', studentId).eq('course_id', courseId)
      if (moduleId !== undefined) query = query.eq('module_id', moduleId)
      const conversations = await query.order('module_id')
      if (conversations.error) throw new Error(conversations.error.message)
      if (conversations.data.length === 0) return []
      const messages = await messagesOf(conversations.data.map(conversation => conversation.id))
      return conversations.data.map(conversation => ({
        moduleId: conversation.module_id,
        messages: messages
          .filter(message => message.conversation_id === conversation.id)
          .map(message => ({
            id: message.id,
            sequence: message.sequence,
            author: message.author,
            text: message.text,
            exerciseId: message.exercise_id,
            time: message.created_at,
          })),
      }))
    },
  }

  // Page by page, so a long history is neither cut short nor miscounted.
  async function messagesOf(conversationIds: string[]) {
    const read = []
    for (let offset = 0; ; offset += messagePageSize) {
      const result = await supabase.from('messages')
        .select('id, conversation_id, sequence, author, text, exercise_id, created_at')
        .in('conversation_id', conversationIds)
        .order('sequence', { ascending: true })
        .order('id', { ascending: true })
        .range(offset, offset + messagePageSize - 1)
      if (result.error) throw new Error(result.error.message)
      read.push(...result.data)
      if (result.data.length < messagePageSize) return read
    }
  }
}
