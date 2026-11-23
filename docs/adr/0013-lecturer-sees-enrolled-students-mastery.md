---
status: accepted
---

# The owning lecturer sees each enrolled student's mastery and Course progress

Supersedes the part of ADR 0009 that kept mastery from staff, for the lecturer only.

ADR 0009 let staff review a student's code, conversations and activity, but no member of staff saw a student's mastery. A lecturer sets the mastery threshold yet could not see how any student stood against it, or who was behind. Now the lecturer of a course sees, for each student enrolled in that course, the student's **Course progress** (mastered modules out of the modules with content, as "n/total · %" with a bar) in the enrolled students table, and the per-module mastery on the student's review page.

The lecturer sees the same stored mastery (ADR 0008) the student and the agents read, so they discuss one figure. Course progress is derived from it on each read with the same `courseProgress` the student's roadmap uses, and is never stored. The server reads it only for courses the lecturer owns; the handler sends Course progress, never the stored rows. Opening a review page still writes the staff access log. The administrator still sees no mastery: the privacy rule of ADR 0009 holds for them. Students are told on Home and the profile that their lecturers can see their mastery.

## Considered Options

- **Keep mastery from all staff** (ADR 0009): rejected. A lecturer cannot spot who is behind or judge whether the threshold is set well.
- **Show the lecturer class-wide aggregates only**: rejected. An average hides which student needs help, which is what the lecturer asked for.
- **Let the administrator see mastery too**: rejected. The administrator runs the system, not the teaching, and has no need for it.

## Consequences

The lecturer store reads `module_masteries` for the enrolled students of owned courses with the server key. The **Lecturer** entry in `CONTEXT.md` and the recording notice changed. The administrator's handlers and pages carry no mastery, and a test pins that.
