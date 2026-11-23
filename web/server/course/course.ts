import type { ModuleState, RoadmapModule as StudentRoadmapModule } from '../../shared/turn'
import { moduleState, type CourseStanding } from '../student-model'
import type { CourseScope } from '../verify-shield'
import { defaultFailureLimit } from '../learning-plan'
import type { CourseSpec } from './course-spec'
import { normaliseCourseSpec } from './materials'
import { pythonCourseSpec } from './python-course'
import type { StudyModule } from './study-module'

export interface CourseModule {
  id: string
  number: number
  name: string
  part: string
  summary: string
  // Derived from the spec: a module is available exactly when the spec gives it content.
  available: boolean
  keywords: readonly string[]
  // The ids of the module's exercises and quiz questions; empty for a module with no content.
  exerciseIds: readonly string[]
  questionIds: readonly string[]
}

// A course as the rest of the server reads it, built from its course spec. It is passed to the
// student model and the VerifyShield; neither imports course content.
export interface Course {
  id: string
  title: string
  masteryThreshold: number
  // Failed submissions of one exercise after which the learning plan may be revised.
  failuresBeforeRevision: number
  legacyUnlocks?: { before: string, threshold: number }
  modules: readonly CourseModule[]
  studyModules: readonly StudyModule[]
  scope: CourseScope
}

// Refuses a spec the rest of the server could not run: every turn needs a first module to study,
// and the student model, roadmap and VerifyShield all key on module ids.
function checkSpec(spec: CourseSpec): void {
  if (!(spec.masteryThreshold > 0 && spec.masteryThreshold <= 1)) {
    throw new Error(`The mastery threshold ${spec.masteryThreshold} is not a fraction above 0 and at most 1.`)
  }
  const [first] = spec.modules
  if (!first) throw new Error('The course spec lists no modules.')
  if (!first.content) throw new Error(`The first module, ${first.id}, has no content to study.`)
  const ids = new Set<string>()
  let partIndex = 0
  for (const module of spec.modules) {
    if (ids.has(module.id)) throw new Error(`Two modules have the same id, ${module.id}.`)
    ids.add(module.id)
    const index = spec.parts.indexOf(module.part)
    if (index === -1) {
      throw new Error(`Module ${module.id} is in part "${module.part}", which the course spec does not list.`)
    }
    // Modules run through the parts in the order the spec lists them, so a part is never split.
    if (index < partIndex) {
      throw new Error(`Module ${module.id} is in part "${module.part}", out of the order the course spec lists its parts.`)
    }
    partIndex = index
    const declared = module.content?.codeMisconception
    if (declared && !module.content?.misconceptionResponses.some(response => response.id === declared.id)) {
      throw new Error(`Module ${module.id} reads its code for the misconception ${declared.id}, which it does not name.`)
    }
  }
}

export function courseFromSpec(input: CourseSpec): Course {
  const spec = normaliseCourseSpec(input)
  checkSpec(spec)
  const modules = spec.modules.map((module, index) => ({
    id: module.id,
    number: index + 1,
    name: module.name,
    part: module.part,
    summary: module.summary,
    available: module.content !== undefined,
    keywords: module.keywords,
    exerciseIds: module.content?.exercises.map(exercise => exercise.id) ?? [],
    questionIds: module.content?.quiz.map(question => question.id) ?? [],
  }))
  const studyModules = spec.modules.flatMap(module =>
    module.content ? [{ id: module.id, ...module.content }] : [],
  )
  return {
    id: spec.courseId,
    title: spec.title,
    masteryThreshold: spec.masteryThreshold,
    failuresBeforeRevision: spec.failuresBeforeRevision ?? defaultFailureLimit,
    modules,
    studyModules,
    scope: { modules, outOfCourseKeywords: spec.outOfCourseKeywords },
  }
}

// The course every student studies until enrollment exists: in sprint 1 every student is
// enrolled in Introduction to Programming with Python.
export const defaultCourseId = 'intro_python'

// The Python course built from the spec in code. The server reads the course from the database;
// this is the copy the in-memory course store holds for tests.
export const pythonCourse: Course = courseFromSpec(pythonCourseSpec)

export function studyModule(course: Course, id: string): StudyModule | undefined {
  return course.studyModules.find(module => module.id === id)
}

export interface RoadmapModule {
  id: string
  number: number
  name: string
  part: string
  state: ModuleState
  mastery: number
  current: boolean
}

export function roadmapForStanding(course: Course, standing: CourseStanding): RoadmapModule[] {
  return course.modules.map((module) => {
    const placed = placeOnRoadmap(course, module, standing)
    return {
      id: module.id,
      number: module.number,
      name: module.name,
      part: module.part,
      state: placed.state,
      mastery: placed.mastery,
      current: placed.current,
    }
  })
}

interface RoadmapPlace {
  state: ModuleState
  mastery: number
  current: boolean
  // Set only when the module is at the threshold but has no passed exercise, so
  // its open card can say what is left to do.
  masteryReason?: string
}

// Shown on an open module that has reached the threshold on understanding alone.
const passExerciseReason = 'Pass an exercise to master this module.'

function placeOnRoadmap(course: Course, module: CourseModule, standing: CourseStanding): RoadmapPlace {
  const mastery = standing.masteries.find(item => item.moduleId === module.id)?.mastery ?? 0
  const passedExercise = standing.passedExerciseModuleIds.includes(module.id)
  const atThreshold = mastery >= course.masteryThreshold
  // A module is only mastered with a passed exercise; at the threshold without
  // one it stays open and says so. The lecturer's screens read the same rule.
  const state = moduleState(course, module.id, standing)
  const current = module.id === standing.currentModuleId
  if (state === 'open' && atThreshold && !passedExercise) {
    return { state, mastery, current, masteryReason: passExerciseReason }
  }
  return { state, mastery, current }
}

// The mastery a student is shown, in whole percentage points because that is
// how it is read off the bar. It rounds down, so a module below the threshold
// never rounds up to look mastered. A module can still sit at or past the mark
// while open when it has reached the threshold on understanding alone with no
// passed exercise: there the bar meets the mark and the mastery reason says why
// it is not yet mastered. The unrounded estimate stays in the VerifyShield trace
// and the decision log, where the exact number counts.
function shownMastery(mastery: number): number {
  return Math.floor(mastery * 100) / 100
}

function closedReasonFor(course: Course, module: CourseModule): string {
  if (!module.available) return 'Not available yet'
  const previous = course.modules.find(item => item.number === module.number - 1)
  if (!previous) return 'Not available yet'
  return `Needs Module ${previous.number}: ${previous.name} mastered`
}

export function presentedRoadmap(course: Course, standing: CourseStanding): StudentRoadmapModule[] {
  return course.modules.map((module) => {
    const placed = placeOnRoadmap(course, module, standing)
    const named = {
      id: module.id,
      name: module.name,
      part: module.part,
      summary: module.summary,
      current: placed.current,
      available: module.available,
    }
    // A closed module shows the lock and the reason, and no mastery: a number
    // is only shown where it means something.
    if (placed.state === 'closed') {
      return { ...named, state: 'closed', closedReason: closedReasonFor(course, module) }
    }
    if (placed.masteryReason) {
      return { ...named, state: placed.state, mastery: shownMastery(placed.mastery), masteryReason: placed.masteryReason }
    }
    return { ...named, state: placed.state, mastery: shownMastery(placed.mastery) }
  })
}

export function redirectText(course: Course, scope: string, currentModuleId: string): string {
  const current = course.modules.find(module => module.id === currentModuleId)
  const currentName = current?.name ?? 'this module'
  if (scope === 'out_of_course') {
    return `That's outside this course. Let's stay with ${currentName}.`
  }

  const target = course.modules.find(module => module.id === scope)
  if (!target) return `That's outside this course. Let's stay with ${currentName}.`

  const previous = course.modules.find(module => module.number === target.number - 1)
  const where = target.available
    ? `which opens after you master ${previous?.name ?? 'the previous module'}`
    : 'which is not available yet'
  return `That's part of Module ${target.number}: ${target.name}, ${where}. Let's stay with ${currentName}.`
}
