export type ModuleState = 'mastered' | 'open' | 'closed'

interface RoadmapModuleBase {
  id: string
  name: string
  part: string
  summary: string
  current: boolean
  // False for a module the course spec lists without content; it counts
  // towards no Course progress.
  available: boolean
}

// An unlocked module carries the mastery the student is shown, from 0 to 1,
// rounded to whole percentage points. A closed module carries the reason it is
// closed and no mastery. An open module that has reached the threshold on
// understanding alone carries the reason it is not yet mastered: a passed
// exercise is still needed.
export type RoadmapModule =
  | (RoadmapModuleBase & { state: 'mastered' | 'open'; mastery: number; masteryReason?: string })
  | (RoadmapModuleBase & { state: 'closed'; closedReason: string })

export type MaterialBlock =
  | { type: 'text', markdown: string }
  | { type: 'code', code: string }
  | { type: 'image', url: string, alt: string }
  | { type: 'video', url: string, title: string }

export type ModuleMaterials = readonly MaterialBlock[]

export interface ExerciseCheck {
  name: string
  expression: string
  expected: string
}

export interface ExerciseChoice {
  id: string
  title: string
}

export interface CurrentExercise {
  id: string
  title: string
  statement: string
  starterCode: string
  tests: readonly [ExerciseCheck, ExerciseCheck, ExerciseCheck]
}

// The marking of a quiz question the student has answered: their choice, the
// correct choice and the explanation. An unanswered question never carries any
// of this, so the correct choice does not reach the client before the answer.
export interface QuizResult {
  choice: number
  correctIndex: 0 | 1 | 2 | 3
  correct: boolean
  explanation: string
}

export interface QuizQuestionView {
  id: string
  prompt: string
  choices: readonly [string, string, string, string]
  // null until the student answers this question.
  result: QuizResult | null
}

export interface WorkingAreaView {
  mode: 'learn' | null
  moduleId: string
  moduleName: string
  materials: ModuleMaterials
  exercise: CurrentExercise
  exercises: readonly ExerciseChoice[]
  // The module's quiz, shown in Learn mode after the materials. Each question
  // carries its marking only once answered.
  quiz: readonly QuizQuestionView[]
}

// The two agents a student can address with an `@` tag, and that make proposals.
export type AddressedAgent = 'teacher' | 'deskmate'

// What the student and the administrator see each agent called.
export const agentNames: Readonly<Record<AddressedAgent, string>> = {
  teacher: 'Teacher',
  deskmate: 'Mai',
}

// One rule the VerifyShield applied to a proposal, in the order it applied them.
export interface RuleCheck {
  ruleId: string
  passed: boolean
  reasonCode: string
}

export interface Quote {
  text: string
  source: 'agent' | 'materials'
  moduleId: string
}

export interface ConversationMessage {
  id: string
  author: 'student' | 'teacher' | 'deskmate' | 'event'
  name: string
  role: string
  text: string
  exerciseId: string
  approvedMove: string | null
  openInLearn: boolean
  // Text the student placed in the message from an agent reply or the materials.
  quote?: Quote
  // ISO time the message was written; absent for messages stored before
  // times were recorded.
  createdAt?: string
  // The agent a student message was addressed to; absent when none was.
  addressedAgent?: AddressedAgent
}

export interface RunOutput {
  stdout: string
  stderr: string
  error: { message: string, line: number } | null
}

export interface PracticeTestResult {
  name: string
  passed: boolean
  expected: string
  actual: string
}

export type TurnEvent =
  | { type: 'text', author: 'teacher' | 'deskmate', delta: string }
  | { type: 'state', state: RedrawState }

export interface TraceVerdict {
  decision: 'allow' | 'block' | 'downgrade'
  ruleId: string
  reasonCode: string
}

export interface AgentTrace {
  agent: AddressedAgent
  proposal: string | null
  scope: string | null
  verdict: TraceVerdict | null
}

export interface TraceMastery {
  moduleId: string
  mastery: number
}

export interface TurnTrace {
  active: boolean
  verifyShieldOn: boolean
  masteries: readonly TraceMastery[]
  unlockedModuleIds: readonly string[]
  agents: readonly [AgentTrace, AgentTrace]
}

// One step of the Teacher's plan for a module, as the student sees it.
export interface LearningPlanStepView {
  id: string
  title: string
  // The step the student is on.
  current: boolean
  // Verified by the student's records, never by an agent.
  done: boolean
}

// The Teacher's plan for the module the student opened: proposed until the
// student presses Start, then agreed. Null for a module with no plan.
export interface LearningPlanView {
  moduleId: string
  revision: number
  agreed: boolean
  steps: readonly LearningPlanStepView[]
  // The index of the step the student is on, from 0.
  currentStep: number
}

// What the student has finished in the course, for the progress panel: each passed
// exercise and the verified attempts it took. Mastery per module is the roadmap's.
export interface ProgressView {
  completedExercises: readonly {
    moduleId: string
    moduleName: string
    exerciseId: string
    title: string
    attempts: number
  }[]
}

// Where the study suggestion's button takes the student. The page performs it
// with the controls the student already has; it never submits code.
export type StudySuggestionAction =
  | { kind: 'learn', moduleId: string }
  | { kind: 'practice', moduleId: string, exerciseId: string }
  | { kind: 'study', moduleId: string, exerciseId: string }

// The one next step the rules chose from the student's activity log, shown in a
// dialog until it is dismissed. `key` names this episode of the step, and goes
// back with the dismissal.
export interface StudySuggestionView {
  key: string
  sentence: string
  button: string
  action: StudySuggestionAction
}

export interface RedrawState {
  displayName: string
  course: string
  courseRoadmap: RoadmapModule[]
  // Where the mark on every mastery bar sits, from the course spec.
  masteryThreshold: number
  workingArea: WorkingAreaView
  conversation: ConversationMessage[]
  // The learning pattern's weak spots in plain words, so the student knows what to work on.
  weakSpots: readonly string[]
  progress: ProgressView
  // The plan the Teacher proposed for the current module, or null when there is none.
  learningPlan: LearningPlanView | null
  // The study suggestion to show, or null when there is none or it was dismissed.
  studySuggestion: StudySuggestionView | null
  trace?: TurnTrace
  // Whether the student's deskmate switch is on: Mai takes part in their turns.
  deskmateOn: boolean
  // A short note about the turn, e.g. that a message to Mai went to the Teacher.
  notice?: string
}

// One tool an agent called while it worked out its move: the tool name, what the model asked for,
// and a short summary of what came back. The full result is not kept.
export interface ToolCallRecord {
  name: string
  input: unknown
  summary: string
}

// The Teacher's tool that reads the student's stored mastery, named once for the server, its prompt
// and the decision review.
export const studentMasteryTool = 'get_student_mastery'

// The most steps an agent may take in one tool loop; reaching it means no move that turn.
export const maxToolSteps = 3
