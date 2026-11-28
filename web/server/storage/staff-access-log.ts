import type { StaffAccessEntry } from '../../shared/staff-review'

// The staff access log: every time a lecturer or an administrator opens a
// student's records, it keeps who, which student, what and when. Rows are only
// ever added. Only an administrator can read it (ADR 0009).

export type StaffAccessRole = StaffAccessEntry['actorRole']
export type StaffAccessOpened = StaffAccessEntry['opened']

export interface NewStaffAccess {
  actorEmail: string
  actorRole: StaffAccessRole
  studentId: string
  courseId: string | null
  opened: StaffAccessOpened
  // Set only for 'student_conversation'.
  moduleId?: string
}

// A row as it is kept: the module's name is looked up by whoever shows it.
export type StaffAccessRow = Omit<StaffAccessEntry, 'moduleName'>

export interface StaffAccessLog {
  record: (access: NewStaffAccess) => Promise<void>
  // Newest first.
  list: (limit: number) => Promise<StaffAccessRow[]>
}

export function createMemoryStaffAccessLog(
  studentNumbers: Readonly<Record<string, string>> = {},
): StaffAccessLog & { rows: (NewStaffAccess & { time: string })[] } {
  const rows: (NewStaffAccess & { time: string })[] = []
  return {
    rows,
    async record(access) {
      rows.push({ ...access, time: new Date().toISOString() })
    },
    async list(limit) {
      return rows.map((row, index) => ({
        id: index + 1,
        time: row.time,
        actorEmail: row.actorEmail,
        actorRole: row.actorRole,
        studentId: row.studentId,
        studentNumber: studentNumbers[row.studentId] ?? null,
        opened: row.opened,
        courseId: row.courseId,
        moduleId: row.moduleId ?? null,
      })).reverse().slice(0, limit)
    },
  }
}
