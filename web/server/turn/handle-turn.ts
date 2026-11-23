import type { ActivityRecorder } from '../activity-recorder'
import type { AgentTrace, StudySuggestionView, ConversationMessage, CurrentExercise, LearningPlanView, PracticeTestResult, ProgressView, QuizQuestionView, Quote, RedrawState, RunOutput, TurnEvent, TurnTrace } from '../../shared/turn'
import { createAgentTools, type TurnTools } from '../agent-tools'
import { moveKey, roleTable, type Agents, type AnsweredQuizResult, type DeskmateContext, type Move, type SubmissionCheck, type TeacherContext } from '../agents'
import { canonicalModuleId, defaultCourseId, presentedRoadmap, redirectText, roadmapForStanding, studyModule, type Course, type Exercise, type StudyModule } from '../course'
import { createMemoryCourseStore, type CourseStore } from '../storage/course-store'
import type { AddressedAgent, ConversationStore, ResumePoint, StoredMessage } from '../storage/conversation-store'
import type { DeskmateSettingStore } from '../storage/deskmate-setting-store'
import { createMemoryQuizAnswerStore, type QuizAnswerRow, type QuizAnswerStore } from '../storage/quiz-answer-store'
import {
  createMemoryEvidenceStore,
  estimateCourse,
  furthestUnlockedModuleId,
  legacyUnlocksFor,
  readStoredMastery,
  saveMasteryFromEvidence,
  standingFor,
  storedCourseEstimate,
  type CourseEstimate,
  type CourseStanding,
  type EvidenceStore,
  type MasteryStore,
  type StoredMastery,
  type UnlockStore,
} from '../student-model'
import { dailyProposingTurnLimit, type DailyTurnAllowance } from '../storage/daily-turn-allowance'
import type { DecisionLogStore, DecisionRecord } from '../storage/decision-log'
import type { LearningPlanStore, NewLearningPlan } from '../storage/learning-plan-store'
import type { NewSubmission, SubmissionStore } from '../storage/submission-store'
import { couldNotCheck, type Sandbox, type SandboxReport } from '../sandbox'
import { decide, type Proposal, type TurnSnapshot, type Verdict } from '../verify-shield'
import { planProgress, planStepTitle, planView, type LearningPlan, type PlanProgress, type PlanRecords, type PlanStepKind } from '../learning-plan'
import { gatherLearningPattern } from '../learning-pattern/gather'
import type { LearningPattern } from '../learning-pattern'
import { showsCodeMisconception } from './code-findings'
import { chooseStudyStep, studySuggestionKey, visibleStudySuggestion, type StudyStep } from '../study-suggestion'
import type { StudySuggestionStore } from '../storage/study-suggestion-store'

const teacherFallback = 'The Teacher could not answer just now. Please try again.'
const deskmateFallback = 'Mai could not answer just now. Please try again.'
const deskmateOffNotice = 'Mai is switched off.'
const dailyTurnLimitNotice = `You have used your ${dailyProposingTurnLimit} turns for today. The agents will answer again tomorrow.`

// A turn's state before the student's deskmate switch and the turn's notice are added.
type TurnState = Omit<RedrawState, 'deskmateOn' | 'notice'>
type InnerEvent = Exclude<TurnEvent, { type: 'state' }> | { type: 'state', state: TurnState }

// Who takes part in an agent turn, and the agent the student addressed (for the decision log).
interface Participants {
  teacher: boolean
  deskmate: boolean
  addressedAgent: AddressedAgent | null
}

interface TurnFlags {
  deskmateOn: boolean
  notice: string | null
}

// A failed call to the provider used to be swallowed whole, so a wrong model
// name or an unsupported request shape reached the student as "could not
// answer" and left no trace anywhere. The student still sees only the
// fallback; the server log says why.
function logModelFailure(what: string, cause: unknown): void {
  const message = cause instanceof Error ? cause.message : String(cause)
  console.error(`Language model failed (${what}): ${message}`)
}

export class SignInRequiredError extends Error {
  readonly statusCode = 401

  constructor() {
    super('Sign in required')
    this.name = 'SignInRequiredError'
  }
}

export class UnknownExerciseError extends Error {
  readonly statusCode = 400

  constructor() {
    super('That exercise is not part of this module.')
    this.name = 'UnknownExerciseError'
  }
}

// Where the student is: a module and an exercise in one course. The course is the one read for
// this turn, so every helper that has the placement reads the same course.
interface Placement {
  course: Course
  module: StudyModule
  exercise: Exercise
}

export interface TurnRequest {
  sessionStudentId: string | null
  body: unknown
}

export interface TurnOptions {
  verifyShieldOn?: boolean
  decisions?: DecisionLogStore
  evidence?: EvidenceStore
  quizAnswers?: QuizAnswerStore
  unlocks?: UnlockStore
  // The stored copy of mastery (ADR 0008). Without it the turn estimates from the ledger
  // on every request, as before the table existed.
  mastery?: MasteryStore
  // Where the course is read from, once a turn, and which course. Without them the turn is about
  // the Python course held in memory.
  courses?: CourseStore
  courseId?: string
  // The students' deskmate switches. Without it Mai is always switched on.
  deskmateSettings?: DeskmateSettingStore
  // Append-only activity. Absent in tests that are not about the log.
  activity?: ActivityRecorder
  // One proposing turn per student per calendar day. Absent in tests that are not about the limit,
  // which then does not apply. The day is the Hanoi calendar day of `now`.
  dailyTurns?: DailyTurnAllowance
  now?: () => Date
  // The commit this server is running, and the course history entry in force.
  // Absent in tests that are not about the decision log's versions.
  codeVersion?: string
  courseHistoryId?: number | null
  // Re-runs the submission. Absent only where a test is not submitting; a submission
  // with no sandbox is refused and records no pass.
  sandbox?: Sandbox
  // Keeps the code, the per-test results and the outcome. Absent in tests that do not read it.
  submissions?: SubmissionStore
  // The Teacher's plans, append-only. Absent in tests that are not about plans,
  // which then never ask the Teacher for one and show none.
  plans?: LearningPlanStore
  // The study suggestions the student has dismissed. Without it none is remembered, so a
  // dismissed suggestion would show again; the suggestion itself is read from `activity`.
  studySuggestions?: StudySuggestionStore
}

export function studentIdForTurn(request: TurnRequest): string {
  if (typeof request.sessionStudentId !== 'string' || request.sessionStudentId.length === 0) {
    throw new SignInRequiredError()
  }

  return request.sessionStudentId
}

export function handleTurn(
  request: TurnRequest,
  store: ConversationStore,
  agents?: Agents,
  options?: TurnOptions,
): Promise<RedrawState> {
  studentIdForTurn(request)
  return collectTurn(request, store, agents, options)
}

export function streamTurn(
  request: TurnRequest,
  store: ConversationStore,
  agents?: Agents,
  options?: TurnOptions,
): AsyncGenerator<TurnEvent> {
  studentIdForTurn(request)
  return streamTurnBody(request, store, agents, options)
}

async function collectTurn(
  request: TurnRequest,
  store: ConversationStore,
  agents?: Agents,
  options?: TurnOptions,
): Promise<RedrawState> {
  let state: RedrawState | undefined
  for await (const event of streamTurnBody(request, store, agents, options)) {
    if (event.type === 'state') state = event.state
  }
  if (!state) throw new Error('The turn did not finish.')
  return state
}

async function* streamTurnBody(
  request: TurnRequest,
  store: ConversationStore,
  agents?: Agents,
  options?: TurnOptions,
): AsyncGenerator<TurnEvent> {
  const studentId = studentIdForTurn(request)
  const flags = {
    deskmateOn: await options?.deskmateSettings?.read(studentId) ?? true,
    notice: null as string | null,
  }
  for await (const event of turnBody(studentId, request.body, store, flags, agents, options)) {
    if (event.type !== 'state') {
      yield event
      continue
    }
    yield {
      type: 'state',
      state: { ...event.state, deskmateOn: flags.deskmateOn, ...(flags.notice ? { notice: flags.notice } : {}) },
    }
  }
}

async function* turnBody(
  studentId: string,
  body: unknown,
  store: ConversationStore,
  flags: TurnFlags,
  agents?: Agents,
  options?: TurnOptions,
): AsyncGenerator<InnerEvent> {
  // A turn with no addressed agent: the Teacher, then Mai if she is switched on.
  const everyone: Participants = { teacher: true, deskmate: flags.deskmateOn, addressedAgent: null }
  // The ledger is read once a turn. A submission appends to it below and the
  // estimate is taken again, so the roadmap the student gets back already
  // counts the submission they just made.
  const quizStore = options?.quizAnswers ?? createMemoryQuizAnswerStore()
  const ledger = options?.evidence ?? createMemoryEvidenceStore(quizStore.observationsForStudent)
  const courses = options?.courses ?? createMemoryCourseStore()
  const [course, rows, knownPoint] = await Promise.all([
    courses.course(options?.courseId ?? defaultCourseId),
    ledger.forStudent(studentId),
    store.resumePoint(studentId),
  ])
  const unlocks = options?.unlocks
  let recordedUnlocks = await unlocks?.forStudent(studentId) ?? []
  const legacyUnlocks = legacyUnlocksFor(course, rows)
  const masteries = options?.mastery
  // The estimate this turn reads. New evidence is stored before it is read again, so the
  // roadmap the student gets back already counts what they just did; otherwise the stored
  // copy is taken as it stands, and a module with no row yet is computed and saved first.
  async function refreshEstimate(evidence: typeof rows, newEvidence = false): Promise<CourseEstimate> {
    const stored: StoredMastery[] | null = masteries
      ? newEvidence
        ? await saveMasteryFromEvidence(course, evidence, studentId, masteries)
        : await readStoredMastery(course, evidence, studentId, masteries)
      : null
    const read = (unlockedSoFar: readonly string[]) => stored
      ? storedCourseEstimate(course, stored, unlockedSoFar)
      : estimateCourse(course, evidence, unlockedSoFar)

    const estimate = read([...recordedUnlocks, ...legacyUnlocks])
    const newlyUnlocked = estimate.unlockedModuleIds.filter(id => !recordedUnlocks.includes(id))
    if (unlocks && newlyUnlocked.length) {
      recordedUnlocks = await unlocks.record(studentId, newlyUnlocked)
      return read(recordedUnlocks)
    }
    return estimate
  }
  let estimate = await refreshEstimate(rows)
  const settled = await viewPlacement(course, studentId, store, estimate, knownPoint)
  let placement = settled.placement
  const openedPoint = settled.point
  let standing = standingFor(estimate, placement.module.id)

  if (isOpenEvent(body)) {
    const existing = await store.messages(studentId, placement.module.id)
    if (existing.length === 0 && agents) {
      yield* introduceModule(studentId, placement, standing, store, quizStore, agents, flags, options)
      return
    }
    const mode = existing.length === 0 ? 'learn' : null
    const plan = agents ? await ensurePlan(studentId, placement, standing, store, quizStore, agents, options) : undefined
    yield { type: 'state', state: await redraw(studentId, placement, standing, store, quizStore, mode, options, undefined, plan) }
    return
  }

  if (isDeskmateSwitch(body)) {
    // Only the session student's own switch is ever read or written.
    await options?.deskmateSettings?.save(studentId, body.on)
    flags.deskmateOn = body.on
    yield { type: 'state', state: await redraw(studentId, placement, standing, store, quizStore, null, options) }
    return
  }

  if (isDismissStudySuggestion(body)) {
    // Only the step the rules choose now can be dismissed, and only for the session student.
    const step = await studyStepFor(studentId, placement, standing, options)
    if (step && studySuggestionKey(step) === body.key) {
      await options?.studySuggestions?.dismiss(studentId, step.identity, step.anchor)
    }
    yield { type: 'state', state: await redraw(studentId, placement, standing, store, quizStore, null, options) }
    return
  }

  if (isPlanStart(body)) {
    // Agreeing is a new revision with the time it was agreed, so no stored
    // revision is ever rewritten. A module with no plan, or one already
    // agreed, changes nothing.
    const plan = await options?.plans?.latest(studentId, placement.module.id)
    if (plan && plan.agreedAt === null) {
      const agreedAt = (options?.now?.() ?? new Date()).toISOString()
      const agreed = { ...plan, revision: plan.revision + 1, agreedAt, createdAt: agreedAt }
      const records = await planRecordsFor(studentId, placement, quizStore, options)
      await options?.plans?.append(studentId, {
        moduleId: agreed.moduleId,
        revision: agreed.revision,
        steps: agreed.steps,
        // The step the student is on when they agree, from their records.
        currentStep: planProgress(agreed, records, placement.course.failuresBeforeRevision).currentStep,
        agreedAt,
        trigger: plan.trigger,
        decisionTurnId: plan.decisionTurnId,
      })
      await options?.activity?.record({
        studentId,
        courseId: options.courseId ?? defaultCourseId,
        type: 'plan_agreed',
        payload: { moduleId: placement.module.id },
      })
    }
    yield { type: 'state', state: await redraw(studentId, placement, standing, store, quizStore, null, options) }
    return
  }

  if (isSelectModule(body) || isPreviewModule(body)) {
    const chosen = studyModule(course, canonicalModuleId(body.moduleId))
    // Choosing a closed module changes nothing. A preview never writes the resume point.
    if (!chosen || !standing.unlockedModuleIds.includes(chosen.id)) {
      yield { type: 'state', state: await redraw(studentId, placement, standing, store, quizStore, null, options) }
      return
    }
    const point = openedPoint
    const sameModule = point !== null && canonicalModuleId(point.moduleId) === chosen.id
    const exercise = sameModule
      ? chosen.exercises.find(item => item.id === point.exerciseId) ?? chosen.exercises[0]
      : chosen.exercises[0]
    const next = { course, module: chosen, exercise }
    const [existing, displayName, quizAnswers, pattern, plan] = await Promise.all([
      store.messages(studentId, chosen.id),
      store.displayName(studentId),
      quizStore.forStudentModule(studentId, chosen.id),
      learningPatternFor(studentId, next, options),
      // A preview never proposes a plan: it writes nothing.
      isPreviewModule(body)
        ? options?.plans?.latest(studentId, chosen.id) ?? null
        : ensurePlan(studentId, next, standingFor(estimate, next.module.id), store, quizStore, agents, options),
      isPreviewModule(body) ? Promise.resolve() : adoptPlacement(studentId, store, next),
    ])
    const nextStanding = standingFor(estimate, next.module.id)
    // A preview of another module carries no suggestion: it records nothing and advises nothing.
    const suggestion = isPreviewModule(body) ? null : await studySuggestionFor(studentId, next, nextStanding, options)
    yield {
      type: 'state',
      state: composeState(next, nextStanding, existing, displayName, existing.length === 0 ? 'learn' : null, quizAnswers, pattern, await presentedPlan(studentId, next, quizStore, plan ?? null, options), suggestion),
    }
    return
  }

  if (isSelectExercise(body)) {
    const exercise = placement.module.exercises.find(choice => choice.id === body.exerciseId)
    if (!exercise) throw new UnknownExerciseError()
    const next = { ...placement, exercise }
    await adoptPlacement(studentId, store, next)
    await store.appendMessage(studentId, next.module.id, {
      author: 'event',
      approvedMove: null,
      text: exercise.title,
      exerciseId: exercise.id,
    })
    yield { type: 'state', state: await redraw(studentId, next, standing, store, quizStore, null, options) }
    return
  }

  if (isQuizAnswer(body)) {
    const stepBefore = (await planStateFor(studentId, placement, quizStore, options))?.progress.currentStep
    const marked = await recordQuizAnswer(studentId, placement, store, quizStore, body)
    // Only a stored answer feeds the ledger (through the quiz store), so mastery
    // is taken again only then; an invalid or repeat answer leaves it untouched.
    if (marked.stored) {
      standing = standingFor(await refreshEstimate(await ledger.forStudent(studentId), true), placement.module.id)
      await options?.activity?.record({
        studentId,
        courseId: options.courseId ?? defaultCourseId,
        type: 'quiz_answered',
        payload: { moduleId: placement.module.id, questionId: body.questionId, correct: marked.correct },
      })
    }
    // A wrong answer brings the agents in, as a failed submission does, and so does
    // a right answer that finishes a step of the plan; any other right answer, and
    // a repeat of an answered question, does not.
    const stepAfter = marked.stored ? (await planStateFor(studentId, placement, quizStore, options))?.progress.currentStep : undefined
    const finishedStep = stepBefore !== undefined && stepAfter !== undefined && stepAfter > stepBefore
    if (marked.stored && (!marked.correct || finishedStep) && agents) {
      yield* answerMessage(studentId, placement, standing, {
        draft: null,
        runOutput: null,
        submission: null,
      }, store, quizStore, agents, '', everyone, flags, options)
      return
    }
    yield { type: 'state', state: await redraw(studentId, placement, standing, store, quizStore, null, options) }
    return
  }

  if (isSubmission(body)) {
    await adoptPlacement(studentId, store, placement)
    const report = await checkedSubmission(body.code, placement.exercise.tests, options?.sandbox)
    if (report.outcome === 'refused') {
      await rememberSubmission(options?.submissions, {
        studentId,
        moduleId: placement.module.id,
        exerciseId: placement.exercise.id,
        code: body.code,
        results: [],
        outcome: 'refused',
        message: report.message,
        findings: codeFindings(body.code, placement.module),
      })
      await store.appendMessage(studentId, placement.module.id, {
        author: 'event',
        approvedMove: null,
        text: report.message,
        exerciseId: placement.exercise.id,
      })
      flags.notice = report.message
      yield { type: 'state', state: await redraw(studentId, placement, standing, store, quizStore, null, options) }
      return
    }
    if (!agents) throw new Error('The agents have no language model.')
    const results = report.results
    const testsPassed = results.filter(result => result.passed).length
    // Record the sandbox result before refreshing mastery. The counts the browser sent are not used.
    await ledger.append({
      studentId,
      moduleId: placement.module.id,
      exerciseId: placement.exercise.id,
      testsPassed,
      testsTotal: results.length,
    })
    await rememberSubmission(options?.submissions, {
      studentId,
      moduleId: placement.module.id,
      exerciseId: placement.exercise.id,
      code: body.code,
      results,
      outcome: testsPassed === results.length ? 'passed' : 'failed',
      message: null,
      findings: codeFindings(body.code, placement.module),
    })
    await options?.activity?.record({
      studentId,
      courseId: options?.courseId ?? defaultCourseId,
      type: 'submitted',
      payload: {
        moduleId: placement.module.id,
        exerciseId: placement.exercise.id,
        testsPassed,
        testsTotal: results.length,
      },
    })
    estimate = await refreshEstimate(await ledger.forStudent(studentId), true)
    standing = standingFor(estimate, placement.module.id)
    await store.appendMessage(studentId, placement.module.id, {
      author: 'event',
      approvedMove: null,
      text: submissionSummary(results),
      exerciseId: placement.exercise.id,
    })
    yield* answerMessage(studentId, placement, standing, {
      draft: null,
      runOutput: null,
      submission: { code: body.code, results },
    }, store, quizStore, agents, '', everyone, flags, options)
    return
  }

  if (isIdle(body)) {
    // The browser reports three quiet minutes in Practice mode. The Teacher checks in
    // once per quiet period, and only on a plan there is.
    if (agents && await quietPeriodOpen(studentId, options) && await planStateFor(studentId, placement, quizStore, options)) {
      await options?.activity?.record({
        studentId,
        courseId: options?.courseId ?? defaultCourseId,
        type: 'idle_check_in',
        payload: { moduleId: placement.module.id, exerciseId: placement.exercise.id },
      })
      yield* answerMessage(studentId, placement, standing, {
        draft: null,
        runOutput: null,
        submission: null,
      }, store, quizStore, agents, '', everyone, flags, options)
      return
    }
    yield { type: 'state', state: await redraw(studentId, placement, standing, store, quizStore, null, options) }
    return
  }

  if (isMessage(body)) {
    if (!agents) throw new Error('The agents have no language model.')
    await adoptPlacement(studentId, store, placement)
    // The switch wins: a message to Mai while she is off goes to the Teacher alone.
    let addressedAgent = messageAddressedAgent(body)
    if (addressedAgent === 'deskmate' && !flags.deskmateOn) {
      addressedAgent = null
      flags.notice = deskmateOffNotice
    }
    const quote = messageQuote(body)
    const text = body.text.trim()
    await store.appendMessage(studentId, placement.module.id, {
      author: 'student',
      approvedMove: null,
      text,
      exerciseId: placement.exercise.id,
      addressedAgent,
      quote,
    })
    await options?.activity?.record({
      studentId,
      courseId: options.courseId ?? defaultCourseId,
      type: 'message_sent',
      payload: { moduleId: placement.module.id, hasQuote: quote !== null },
    })
    // While the agreed plan asks for the student's approach, their next message is it.
    const asking = await planStateFor(studentId, placement, quizStore, options)
    const approachStep = asking?.plan.agreedAt ? asking.plan.steps[asking.progress.currentStep] : undefined
    if (approachStep?.kind === 'approach') {
      await options?.activity?.record({
        studentId,
        courseId: options?.courseId ?? defaultCourseId,
        type: 'approach_written',
        payload: { moduleId: placement.module.id, exerciseId: approachStep.ref },
      })
    }
    const participants: Participants = addressedAgent === null
      ? everyone
      : { teacher: addressedAgent === 'teacher', deskmate: addressedAgent === 'deskmate', addressedAgent }
    yield* answerMessage(studentId, placement, standing, {
      draft: messageDraft(body),
      runOutput: messageRun(body),
      submission: null,
    }, store, quizStore, agents, quote ? `${quote.text}\n${text}` : text, participants, flags, options)
    return
  }

  throw new Error('The turn endpoint does not accept that event.')
}

// Whether the student has been quiet since the Teacher last checked in: the last
// check-in is ended by any activity of theirs after it, going quiet again aside.
async function quietPeriodOpen(studentId: string, options?: TurnOptions): Promise<boolean> {
  const events = await options?.activity?.forStudent(studentId) ?? []
  const lastCheckIn = events.findLastIndex(event => event.type === 'idle_check_in')
  if (lastCheckIn === -1) return true
  return events.slice(lastCheckIn + 1).some(event => event.type !== 'went_idle' && event.type !== 'idle_check_in')
}

// A proposing turn is allowed when no allowance is in use, or when this student still has one of
// the 60 turns for the Hanoi calendar day. The reservation happens before any agent is called.
async function proposingTurnAllowed(studentId: string, options?: TurnOptions): Promise<boolean> {
  if (!options?.dailyTurns) return true
  return options.dailyTurns.take(studentId, hanoiCalendarDay(options.now?.() ?? new Date()))
}

function hanoiCalendarDay(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const part = (type: Intl.DateTimeFormatPartTypes) => {
    const value = parts.find(item => item.type === type)?.value
    if (!value) throw new Error('The Hanoi calendar day could not be read.')
    return value
  }
  return `${part('year')}-${part('month')}-${part('day')}`
}

async function* introduceModule(
  studentId: string,
  placement: Placement,
  standing: CourseStanding,
  store: ConversationStore,
  quizStore: QuizAnswerStore,
  agents: Agents,
  flags: TurnFlags,
  options?: TurnOptions,
): AsyncGenerator<InnerEvent> {
  if (!(await proposingTurnAllowed(studentId, options))) {
    flags.notice = dailyTurnLimitNotice
    yield { type: 'state', state: await redraw(studentId, placement, standing, store, quizStore, 'learn', options) }
    return
  }
  const context = await teacherContext(studentId, placement, standing, store, quizStore, {
    draft: null,
    runOutput: null,
    submission: null,
  }, options)

  const snapshot = turnSnapshot(placement, standing, '', context, options)
  const tools = teacherTools(placement, standing)
  let proposal: Move | null = null
  try {
    proposal = await agents.teacher.propose(context, tools)
  }
  catch (cause) {
    logModelFailure('teacher propose', cause)
    yield {
      type: 'state',
      state: await redrawWithTrace(studentId, placement, standing, store, quizStore, 'learn', verifyShieldTrace(null, null, [], snapshot), options, context.learningPattern),
    }
    return
  }
  const proposed = proposal ? { agent: 'teacher' as const, move: proposal } : null
  const proposedVerdict = proposed
    ? decide([proposed], snapshot, roleTable, placement.course.scope)[0]
    : undefined
  const trace = verifyShieldTrace(proposal, null, proposedVerdict ? [proposedVerdict] : [], snapshot)
  const teaching = Boolean(proposal && isTeachingMove(proposal))
  const introduction = teaching
    ? null
    : { agent: 'teacher' as const, move: { type: 'explain_concept' as const, scope: placement.module.id } }
  const introductionVerdict = introduction
    ? decide([introduction], snapshot, roleTable, placement.course.scope)[0]
    : undefined
  await recordDecisions({
    studentId,
    ruled: [
      ...(proposed && proposedVerdict ? [{ proposal: proposed, verdict: proposedVerdict }] : []),
      ...(introduction && introductionVerdict ? [{ proposal: introduction, verdict: introductionVerdict }] : []),
    ],
    snapshot,
    masteryThreshold: placement.course.masteryThreshold,
    addressedAgent: null,
    decisions: options?.decisions,
    teacherTools: tools,
    codeVersion: options?.codeVersion,
    courseHistoryId: options?.courseHistoryId,
    moduleId: placement.module.id,
    learningPattern: context.learningPattern,
  })
  const verdict = teaching ? proposedVerdict : introductionVerdict

  if (verdict?.move?.type === 'redirect_to_module') {
    const text = redirectText(placement.course, verdict.move.scope, snapshot.moduleId)
    yield { type: 'text', author: 'teacher', delta: text }
    await speakRedirect(studentId, placement, store, text)
  }
  else if (verdict?.decision === 'allow' && verdict.move && isTeachingMove(verdict.move)) {
    const text = yield* streamTeacherReply(agents, context, verdict.move)
    if (text) {
      await store.appendMessage(studentId, placement.module.id, {
        author: 'teacher',
        approvedMove: moveKey(verdict.move),
        text,
        exerciseId: placement.exercise.id,
      })
    }
  }

  const plan = await ensurePlan(studentId, placement, standing, store, quizStore, agents, options)
  yield { type: 'state', state: await redrawWithTrace(studentId, placement, standing, store, quizStore, 'learn', trace, options, context.learningPattern, plan) }
}

// Has the Teacher propose a plan for the module the student opened, unless one
// is already in force. The plan reaches the student only through the
// VerifyShield: a plan it blocks, or an answer that is not a plan, stores
// nothing. The plan changes no mastery: it reads the records and writes only
// the plan.
async function ensurePlan(
  studentId: string,
  placement: Placement,
  standing: CourseStanding,
  store: ConversationStore,
  quizStore: QuizAnswerStore,
  agents: Agents | undefined,
  options?: TurnOptions,
): Promise<LearningPlan | null> {
  const plans = options?.plans
  if (!plans) return null
  const existing = await plans.latest(studentId, placement.module.id)
  if (existing || !agents) return existing

  const context = await teacherContext(studentId, placement, standing, store, quizStore, {
    draft: null,
    runOutput: null,
    submission: null,
  }, options)
  const snapshot = turnSnapshot(placement, standing, '', context, options)
  let proposal: Move | null = null
  try {
    proposal = await agents.teacher.plan(context)
  }
  catch (cause) {
    logModelFailure('teacher plan', cause)
    return null
  }
  if (!proposal) return null
  const proposed = { agent: 'teacher' as const, move: proposal }
  const verdict = decide([proposed], snapshot, roleTable, placement.course.scope)[0]
  const turnId = crypto.randomUUID()
  await recordDecisions({
    studentId,
    ruled: verdict ? [{ proposal: proposed, verdict }] : [],
    snapshot,
    masteryThreshold: placement.course.masteryThreshold,
    addressedAgent: null,
    decisions: options?.decisions,
    turnId,
    moduleId: placement.module.id,
    learningPattern: context.learningPattern,
    codeVersion: options?.codeVersion,
    courseHistoryId: options?.courseHistoryId,
  })
  if (!verdict || verdict.decision === 'block' || verdict.move?.type !== 'propose_plan') return null
  const plan: NewLearningPlan = {
    moduleId: placement.module.id,
    revision: 1,
    steps: verdict.move.steps.map(step => ({ kind: step.kind, ref: step.ref })),
    currentStep: 0,
    agreedAt: null,
    trigger: null,
    decisionTurnId: turnId,
  }
  await plans.append(studentId, plan)
  return plans.latest(studentId, placement.module.id)
}

// Marks a quiz answer and reports whether this call stored it and whether it was
// correct. The resume point is already settled on this module by viewPlacement,
// so a quiz answer writes nothing beyond its own ledger row and event message.
async function recordQuizAnswer(
  studentId: string,
  placement: Placement,
  store: ConversationStore,
  quizStore: QuizAnswerStore,
  event: QuizAnswerEvent,
): Promise<{ stored: boolean, correct: boolean }> {
  const module = placement.module
  const index = canonicalModuleId(event.moduleId) === module.id
    ? module.quiz.findIndex(question => question.id === event.questionId)
    : -1
  const question = index >= 0 ? module.quiz[index] : undefined
  // A stray module id, an unknown question or an out-of-range choice marks
  // nothing and leaves the state as it was.
  if (!question || !isChoiceIndex(event.choice)) {
    return { stored: false, correct: false }
  }
  const correct = event.choice === question.correctIndex
  const recorded = await quizStore.record({
    studentId,
    moduleId: module.id,
    questionId: question.id,
    choice: event.choice,
    correct,
  })
  // The ledger row and the event message are written for the first answer only;
  // later choices the student makes to explore change neither.
  if (recorded.stored) {
    await store.appendMessage(studentId, module.id, {
      author: 'event',
      approvedMove: null,
      text: quizEventText(index + 1, event.choice, correct),
      exerciseId: placement.exercise.id,
    })
  }
  return { stored: recorded.stored, correct: recorded.row.correct }
}

// e.g. "Quiz 2: chose C, wrong". The number is the question's place in the
// module's quiz; the letter is the choice.
function quizEventText(number: number, choice: number, correct: boolean): string {
  return `Quiz ${number}: chose ${'ABCD'[choice]}, ${correct ? 'right' : 'wrong'}`
}

function turnSnapshot(
  placement: Placement,
  standing: CourseStanding,
  studentMessage: string,
  context: TeacherContext,
  options?: TurnOptions,
): TurnSnapshot {
  return {
    moduleId: placement.module.id,
    exerciseId: placement.exercise.id,
    masteries: standing.masteries,
    unlockedModuleIds: standing.unlockedModuleIds,
    studentMessage,
    verifyShieldOn: options?.verifyShieldOn !== false,
    highestHintRung: highestHintRung(context.conversation),
    shownMisconceptionIds: shownMisconceptions(context),
    planTargets: {
      materials: placement.module.materials.length,
      exerciseIds: placement.module.exercises.map(exercise => exercise.id),
      questionIds: placement.module.quiz.map(question => question.id),
      misconceptionIds: placement.module.misconceptionResponses.map(response => response.id),
    },
    weakSpotMisconceptionIds: context.learningPattern.weakSpots.map(spot => spot.misconceptionId),
    planInForce: context.plan !== null,
    planTriggers: context.plan?.triggers ?? [],
    approachAwaitingTry: context.plan?.approachAwaitingTry ?? false,
    studyStepModuleId: context.studySuggestion?.moduleId ?? null,
  }
}

// The misconceptions the student's work shows: those the latest submission's
// code shows, and those their wrong quiz answers named.
function shownMisconceptions(context: TeacherContext): string[] {
  const fromQuiz = context.answeredQuiz.flatMap(result =>
    !result.correct && result.misconceptionId ? [result.misconceptionId] : [],
  )
  return [...new Set([...context.codeFindings, ...fromQuiz])]
}

// The highest hint rung already approved in this module's conversation, 0 if
// none. The rung is read back from the move stored with each teacher message;
// only the teacher climbs the ladder, so other authors are not counted.
function highestHintRung(
  conversation: readonly { author: string, approvedMove: string | null }[],
): number {
  let highest = 0
  for (const message of conversation) {
    if (message.author !== 'teacher') continue
    const match = /^hint_level_(\d+)$/.exec(message.approvedMove ?? '')
    if (match) {
      const rung = Number(match[1])
      if (rung > highest) highest = rung
    }
  }
  return highest
}

async function speakRedirect(
  studentId: string,
  placement: Placement,
  store: ConversationStore,
  text: string,
): Promise<void> {
  await store.appendMessage(studentId, placement.module.id, {
    author: 'teacher',
    approvedMove: 'redirect_to_module',
    text,
    exerciseId: placement.exercise.id,
  })
}

function isTeachingMove(move: Move): boolean {
  return move.type === 'explain_concept' || move.type === 'answer_question'
}

async function* streamTeacherReply(
  agents: Agents,
  context: TeacherContext,
  move: Move,
): AsyncGenerator<InnerEvent, string | null> {
  let text = ''
  try {
    for await (const delta of agents.teacher.render(context, move)) {
      text += delta
      yield { type: 'text', author: 'teacher', delta }
    }
  }
  catch (cause) {
    logModelFailure('teacher render', cause)
    return null
  }
  return text.trim().length > 0 ? text : null
}

async function* answerMessage(
  studentId: string,
  placement: Placement,
  standing: CourseStanding,
  seen: SeenWork,
  store: ConversationStore,
  quizStore: QuizAnswerStore,
  agents: Agents,
  studentMessage: string,
  participants: Participants,
  flags: TurnFlags,
  options?: TurnOptions,
): AsyncGenerator<InnerEvent> {
  if ((participants.teacher || participants.deskmate) && !(await proposingTurnAllowed(studentId, options))) {
    flags.notice = dailyTurnLimitNotice
    yield { type: 'state', state: await redraw(studentId, placement, standing, store, quizStore, null, options) }
    return
  }
  const context = await teacherContext(studentId, placement, standing, store, quizStore, seen, options)
  const deskmate = deskmateContext(context)
  // Mai's proposal runs while the Teacher is already writing, so the first
  // words are not held back for the second model call. An agent that does not
  // take part in the turn is never called, and so proposes nothing.
  const silent = Promise.resolve<PromiseSettledResult<Move | null>>({ status: 'fulfilled', value: null })
  const tools = teacherTools(placement, standing)
  const teacherTask = participants.teacher ? settleCall(agents.teacher.propose(context, tools)) : silent
  const deskmateTask = participants.deskmate ? settleCall(agents.deskmate.propose(deskmate)) : silent
  const teacherSettled = await teacherTask
  const addressedAgent = participants.addressedAgent

  const teacherMove = teacherSettled.status === 'fulfilled' ? teacherSettled.value : null
  const snapshot = turnSnapshot(placement, standing, studentMessage, context, options)
  const turnId = crypto.randomUUID()
  const recordedAt = new Date().toISOString()
  const teacherProposals = teacherMove ? [{ agent: 'teacher' as const, move: teacherMove }] : []
  const teacherVerdicts = decide(teacherProposals, snapshot, roleTable, placement.course.scope)
  await recordDecisions({
    studentId,
    ruled: ruledPairs(teacherProposals, teacherVerdicts),
    snapshot,
    masteryThreshold: placement.course.masteryThreshold,
    addressedAgent,
    decisions: options?.decisions,
    teacherTools: tools,
    turnId,
    time: recordedAt,
    codeVersion: options?.codeVersion,
    courseHistoryId: options?.courseHistoryId,
    moduleId: placement.module.id,
    learningPattern: context.learningPattern,
  })
  const teacherVerdict = teacherVerdicts.find(verdict => verdict.agent === 'teacher')
  if (teacherVerdict && teacherVerdict.decision !== 'block' && teacherVerdict.move?.type === 'revise_plan') {
    await reviseTurnPlan(studentId, placement, quizStore, context, teacherVerdict.move.steps, turnId, options)
  }

  let teacherFailed = false
  if (teacherSettled.status === 'rejected') {
    logModelFailure('teacher propose', teacherSettled.reason)
    await rememberTeacherCouldNotAnswer(studentId, placement, store)
    teacherFailed = true
  }
  else if (teacherVerdict?.move?.type === 'redirect_to_module') {
    const text = redirectText(placement.course, teacherVerdict.move.scope, snapshot.moduleId)
    yield { type: 'text', author: 'teacher', delta: text }
    await speakRedirect(studentId, placement, store, text)
  }
  // A downgrade whose move is not a redirect (the hint ladder lowering a rung,
  // or an unknown misconception becoming a plain answer) is still spoken by
  // the Teacher, as the ruled move.
  else if ((teacherVerdict?.decision === 'allow' || teacherVerdict?.decision === 'downgrade') && teacherVerdict.move) {
    const text = yield* streamTeacherReply(agents, context, teacherVerdict.move)
    if (!text) {
      await rememberTeacherCouldNotAnswer(studentId, placement, store)
      teacherFailed = true
    }
    else {
      await store.appendMessage(studentId, placement.module.id, {
        author: 'teacher',
        approvedMove: moveKey(teacherVerdict.move),
        text,
        exerciseId: placement.exercise.id,
      })
    }
  }

  const deskmateSettled = await deskmateTask
  const deskmateMove = deskmateSettled.status === 'fulfilled' ? deskmateSettled.value : null
  const deskmateProposals = deskmateMove ? [{ agent: 'deskmate' as const, move: deskmateMove }] : []
  const deskmateVerdicts = decide(deskmateProposals, snapshot, roleTable, placement.course.scope)
  await recordDecisions({
    studentId,
    ruled: ruledPairs(deskmateProposals, deskmateVerdicts),
    snapshot,
    masteryThreshold: placement.course.masteryThreshold,
    addressedAgent,
    decisions: options?.decisions,
    turnId,
    time: recordedAt,
    codeVersion: options?.codeVersion,
    courseHistoryId: options?.courseHistoryId,
    moduleId: placement.module.id,
    learningPattern: context.learningPattern,
  })
  const trace = verifyShieldTrace(teacherMove, deskmateMove, [...teacherVerdicts, ...deskmateVerdicts], snapshot)
  const deskmateVerdict = deskmateVerdicts.find(verdict => verdict.agent === 'deskmate')

  if (teacherFailed) {
    yield { type: 'state', state: await redrawWithTrace(studentId, placement, standing, store, quizStore, null, trace, options, context.learningPattern) }
  }

  if (deskmateSettled.status === 'rejected') {
    logModelFailure('deskmate propose', deskmateSettled.reason)
    await rememberDeskmateCouldNotAnswer(studentId, placement, store)
  }
  else if (deskmateVerdict?.decision === 'allow' && deskmateVerdict.move) {
    const renderContext = await deskmateContextWithConversation(studentId, placement, deskmate, store)
    let text = ''
    let failed = false
    try {
      for await (const delta of agents.deskmate.render(renderContext, deskmateVerdict.move)) {
        text += delta
        yield { type: 'text', author: 'deskmate' as const, delta }
      }
    }
    catch (cause) {
      logModelFailure('deskmate render', cause)
      failed = true
    }

    if (failed || text.trim().length === 0) {
      await rememberDeskmateCouldNotAnswer(studentId, placement, store)
    }
    else {
      await store.appendMessage(studentId, placement.module.id, {
        author: 'deskmate',
        approvedMove: moveKey(deskmateVerdict.move),
        text,
        exerciseId: placement.exercise.id,
      })
    }
  }

  yield { type: 'state', state: await redrawWithTrace(studentId, placement, standing, store, quizStore, null, trace, options, context.learningPattern) }
}

// Writes the revision a ruled revise_plan asks for, as a new row that keeps what
// the student agreed to. It says what brought it about and which turn's decision
// ruled on it. Nothing is written for a module with no plan.
async function reviseTurnPlan(
  studentId: string,
  placement: Placement,
  quizStore: QuizAnswerStore,
  context: TeacherContext,
  steps: readonly { kind: PlanStepKind, ref: string }[],
  turnId: string,
  options?: TurnOptions,
): Promise<void> {
  const plans = options?.plans
  const current = await plans?.latest(studentId, placement.module.id)
  if (!plans || !current) return
  const candidate: LearningPlan = {
    ...current,
    revision: current.revision + 1,
    steps: steps.map(step => ({ kind: step.kind, ref: step.ref })),
    createdAt: (options?.now?.() ?? new Date()).toISOString(),
  }
  const records = await planRecordsFor(studentId, placement, quizStore, options, context.learningPattern)
  await plans.append(studentId, {
    moduleId: candidate.moduleId,
    revision: candidate.revision,
    steps: candidate.steps,
    currentStep: planProgress(candidate, records, placement.course.failuresBeforeRevision).currentStep,
    agreedAt: current.agreedAt,
    trigger: context.plan?.triggers.join(',') || null,
    decisionTurnId: turnId,
  })
}

interface PlanState {
  plan: LearningPlan
  progress: PlanProgress
}

// The student's records of the module, as the plan reads them to tell what is done.
async function planRecordsFor(
  studentId: string,
  placement: Placement,
  quizStore: QuizAnswerStore,
  options?: TurnOptions,
  pattern?: LearningPattern,
): Promise<PlanRecords> {
  const moduleId = placement.module.id
  const exerciseIds = new Set(placement.module.exercises.map(exercise => exercise.id))
  const [quizRows, submissions, activity, learned] = await Promise.all([
    quizStore.forStudentModule(studentId, moduleId),
    options?.submissions?.forStudent(studentId) ?? [],
    options?.activity?.forStudent(studentId) ?? [],
    pattern ?? learningPatternFor(studentId, placement, options),
  ])
  return {
    quizAnswers: quizRows.map(row => ({ questionId: row.questionId, correct: row.correct, time: row.time })),
    submissions: submissions
      .filter(row => row.moduleId === moduleId)
      .map(row => ({ exerciseId: row.exerciseId, outcome: row.outcome, findings: row.findings, time: row.createdAt })),
    activity: activity
      .filter(event => event.moduleId === moduleId || (typeof event.payload.exerciseId === 'string' && exerciseIds.has(event.payload.exerciseId)))
      .map(event => ({ type: event.type, time: event.time, payload: event.payload })),
    materialsSeconds: learned.materialsSeconds.find(item => item.moduleId === moduleId)?.seconds ?? 0,
  }
}

// The plan in force for the module and how far the student's records say it has got.
async function planStateFor(
  studentId: string,
  placement: Placement,
  quizStore: QuizAnswerStore,
  options?: TurnOptions,
  pattern?: LearningPattern,
  known?: LearningPlan | null,
): Promise<PlanState | null> {
  const plan = known === undefined ? await options?.plans?.latest(studentId, placement.module.id) : known
  if (!plan) return null
  const records = await planRecordsFor(studentId, placement, quizStore, options, pattern)
  return { plan, progress: planProgress(plan, records, placement.course.failuresBeforeRevision) }
}

// The plan as the student sees it, with its steps marked done from their records.
async function presentedPlan(
  studentId: string,
  placement: Placement,
  quizStore: QuizAnswerStore,
  plan: LearningPlan | null,
  options?: TurnOptions,
  pattern?: LearningPattern,
): Promise<LearningPlanView | null> {
  const state = await planStateFor(studentId, placement, quizStore, options, pattern, plan)
  return state ? planView(state.plan, placement.module, state.progress) : null
}

async function redrawWithTrace(
  studentId: string,
  placement: Placement,
  standing: CourseStanding,
  store: ConversationStore,
  quizStore: QuizAnswerStore,
  mode: 'learn' | null,
  trace: TurnTrace,
  options?: TurnOptions,
  pattern?: LearningPattern,
  plan?: LearningPlan | null,
): Promise<TurnState> {
  return {
    ...await redraw(studentId, placement, standing, store, quizStore, mode, options, pattern, plan),
    trace,
  }
}

function settleCall<T>(work: Promise<T>): Promise<PromiseSettledResult<T>> {
  return work.then(
    value => ({ status: 'fulfilled', value }),
    (reason: unknown) => ({ status: 'rejected', reason }),
  )
}

function ruledPairs(
  proposals: readonly Proposal[],
  verdicts: readonly Verdict[],
): { proposal: Proposal, verdict: Verdict }[] {
  return verdicts.flatMap((verdict) => {
    const proposed = proposals.find(item => item.agent === verdict.agent)
    return proposed ? [{ proposal: proposed, verdict }] : []
  })
}

interface DecisionsToRecord {
  studentId: string
  ruled: readonly { proposal: Proposal, verdict: Verdict }[]
  snapshot: TurnSnapshot
  masteryThreshold: number
  addressedAgent: AddressedAgent | null
  decisions: DecisionLogStore | undefined
  // The Teacher's tools for this turn: their calls go on the Teacher's decisions, and a Teacher whose
  // tool loop ended at the step cap is recorded even though it proposed nothing.
  teacherTools?: TurnTools
  // Shared by every proposal of one turn; a fresh id and time when left out.
  turnId?: string
  time?: string
  codeVersion?: string
  courseHistoryId?: number | null
  // The turn's module, and the pattern snapshot kept on each decision for audit.
  moduleId: string
  learningPattern: LearningPattern
}

async function recordDecisions({
  studentId,
  ruled,
  snapshot,
  masteryThreshold,
  addressedAgent,
  decisions,
  teacherTools,
  turnId = crypto.randomUUID(),
  time = new Date().toISOString(),
  codeVersion,
  courseHistoryId,
  moduleId,
  learningPattern,
}: DecisionsToRecord): Promise<void> {
  if (!decisions) return
  // What every decision of the turn shares; each outcome adds only how it ended.
  const decision = (agent: AddressedAgent, ending: DecisionEnding): DecisionRecord => ({
    time,
    studentId,
    turnId,
    agent,
    ...ending,
    masteries: snapshot.masteries.map(item => ({ ...item })),
    unlockedModuleIds: [...snapshot.unlockedModuleIds],
    verifyShieldOn: snapshot.verifyShieldOn,
    masteryThreshold,
    addressedAgent,
    ...(agent === 'teacher' && teacherTools ? { toolTrace: teacherTools.trace.map(call => ({ ...call })) } : {}),
    ...(codeVersion === undefined && courseHistoryId === undefined
      ? {}
      : { codeVersion: codeVersion ?? null, courseHistoryId: courseHistoryId ?? null }),
    moduleId,
    learningPattern,
  })
  if (teacherTools?.ended === 'step_cap') {
    // Not a ruling: the Teacher never reached a move, so the VerifyShield had nothing to rule on.
    await decisions.append(decision('teacher', {
      outcome: 'step_cap',
      proposedMove: 'none',
      proposedScope: null,
      verdict: null,
      ruledMove: null,
      ruledScope: null,
      ruleId: null,
      reasonCode: null,
    }))
  }
  for (const { proposal, verdict } of ruled) {
    await decisions.append(decision(verdict.agent, {
      outcome: 'ruled',
      proposedMove: moveKey(proposal.move),
      proposedScope: proposedScope(proposal.move),
      verdict: verdict.decision,
      ruledMove: verdict.move ? moveKey(verdict.move) : null,
      ruledScope: verdict.move ? proposedScope(verdict.move) : null,
      ruleId: verdict.ruleId,
      reasonCode: verdict.reasonCode,
      ruleChecks: verdict.ruleChecks.map(check => ({ ...check })),
    }))
  }
}

// The part of a decision that says how it ended.
type DecisionEnding = Pick<DecisionRecord, 'outcome' | 'proposedMove' | 'proposedScope' | 'verdict' | 'ruledMove' | 'ruledScope' | 'ruleId' | 'reasonCode' | 'ruleChecks'>

// The Teacher's tools for one turn, bound to this student's standing in this course: the model
// chooses only whether to call them, never whose mastery they read. The standing's masteries are
// the stored ones, read (and, for a module with no row yet, computed and saved) when the turn began.
function teacherTools(placement: Placement, standing: CourseStanding): TurnTools {
  return createAgentTools({
    masteryThreshold: placement.course.masteryThreshold,
    async readMastery() {
      return roadmapForStanding(placement.course, standing).map(({ id, name, state, mastery }) => ({ id, name, state, mastery }))
    },
  })
}

function verifyShieldTrace(
  teacherMove: Move | null,
  deskmateMove: Move | null,
  verdicts: readonly Verdict[],
  snapshot: TurnSnapshot,
): TurnTrace {
  return {
    active: false,
    verifyShieldOn: snapshot.verifyShieldOn,
    masteries: snapshot.masteries.map(item => ({ ...item })),
    unlockedModuleIds: [...snapshot.unlockedModuleIds],
    agents: [
      tracedAgent('teacher', teacherMove, verdicts),
      tracedAgent('deskmate', deskmateMove, verdicts),
    ],
  }
}

function tracedAgent(
  agent: AddressedAgent,
  move: Move | null,
  verdicts: readonly Verdict[],
): AgentTrace {
  if (!move) return { agent, proposal: null, scope: null, verdict: null }
  const verdict = verdicts.find(item => item.agent === agent)
  if (!verdict) return { agent, proposal: moveKey(move), scope: proposedScope(move), verdict: null }
  return {
    agent,
    proposal: moveKey(move),
    scope: proposedScope(move),
    verdict: {
      decision: verdict.decision,
      ruleId: verdict.ruleId,
      reasonCode: verdict.reasonCode,
    },
  }
}

function proposedScope(move: Move): string | null {
  if (
    move.type === 'explain_concept'
    || move.type === 'answer_question'
    || move.type === 'hint_level_N'
    || move.type === 'address_misconception'
    || move.type === 'redirect_to_module'
  ) {
    return move.scope ?? null
  }
  return null
}

async function teacherContext(
  studentId: string,
  placement: Placement,
  standing: CourseStanding,
  store: ConversationStore,
  quizStore: QuizAnswerStore,
  seen: SeenWork,
  options?: TurnOptions,
): Promise<TeacherContext> {
  const [messages, quizAnswers, findings, pattern] = await Promise.all([
    store.messages(studentId, placement.module.id),
    quizStore.forStudentModule(studentId, placement.module.id),
    codeFindingsFor(studentId, placement, seen, options),
    learningPatternFor(studentId, placement, options),
  ])
  return {
    moduleId: placement.module.id,
    exercises: placement.module.exercises.map(exercise => ({ id: exercise.id, title: exercise.title })),
    quiz: placement.module.quiz.map(question => ({ id: question.id, prompt: question.prompt })),
    materials: placement.module.materials.map(block => ({ ...block })),
    hintLadder: [...placement.module.hintLadder],
    misconceptionResponses: placement.module.misconceptionResponses.map(response => ({ ...response })),
    codeFindings: findings,
    exercise: {
      id: placement.exercise.id,
      title: placement.exercise.title,
      statement: placement.exercise.statement,
      starterCode: placement.exercise.starterCode,
    },
    draft: seen.draft,
    runOutput: seen.runOutput,
    submission: copySubmission(seen.submission),
    conversation: messages.map(message => ({
      author: message.author,
      text: textWithQuote(message),
      approvedMove: message.approvedMove,
    })),
    // Mastery stays out: the Teacher looks it up with get_student_mastery.
    roadmap: roadmapForStanding(placement.course, standing).map(({ mastery: _mastery, ...module }) => module),
    answeredQuiz: answeredQuiz(placement.module, quizAnswers),
    learningPattern: pattern,
    plan: planContext(placement.module, await planStateFor(studentId, placement, quizStore, options, pattern)),
    // Told even after the student has dismissed the dialog, for as long as the rules choose it.
    studySuggestion: await studyStepFor(studentId, placement, standing, options)
      .then(step => step ? { sentence: step.sentence, moduleId: step.moduleId } : null),
  }
}

// What the Teacher is told of the plan in force: its steps in the student's
// words with what is done and where they are, and what happened since the last
// revision. The Deskmate is told none of it.
function planContext(module: StudyModule, state: PlanState | null): TeacherContext['plan'] {
  if (!state) return null
  return {
    revision: state.plan.revision,
    agreed: state.plan.agreedAt !== null,
    steps: state.plan.steps.map((step, index) => ({
      kind: step.kind,
      ref: step.ref,
      title: planStepTitle(step, module),
      done: state.progress.done[index] ?? false,
      current: index === state.progress.currentStep,
    })),
    triggers: [...state.progress.triggers],
    approachAwaitingTry: state.progress.approachAwaitingTry,
  }
}

// The answered quiz questions, in the module's quiz order. An unanswered
// question yields nothing, so its correct choice never leaves the server.
function answeredQuiz(
  module: StudyModule,
  quizAnswers: readonly QuizAnswerRow[],
): AnsweredQuizResult[] {
  return module.quiz.flatMap((question) => {
    const row = quizAnswers.find(answer => answer.questionId === question.id)
    if (!row) return []
    return [{
      prompt: question.prompt,
      choice: row.choice,
      correctIndex: question.correctIndex,
      correct: row.correct,
      explanation: question.explanation,
      misconceptionId: question.misconceptions?.[row.choice as 0 | 1 | 2 | 3] ?? null,
    }]
  })
}

function deskmateContext(context: TeacherContext): DeskmateContext {
  return {
    exerciseStatement: context.exercise.statement,
    draft: context.draft,
    runOutput: context.runOutput,
    submission: copySubmission(context.submission),
    conversation: context.conversation.map(message => ({ ...message })),
    // The Deskmate never sees a question's explanation. Destructuring it out
    // (rather than copying the rest by hand) keeps this in step with
    // DeskmateQuizResult if the result ever grows a field.
    answeredQuiz: context.answeredQuiz.map(({ explanation: _explanation, ...rest }) => rest),
  }
}

async function deskmateContextWithConversation(
  studentId: string,
  placement: Placement,
  context: DeskmateContext,
  store: ConversationStore,
): Promise<DeskmateContext> {
  const messages = await store.messages(studentId, placement.module.id)
  return {
    ...context,
    conversation: messages.map(message => ({
      author: message.author,
      text: textWithQuote(message),
      approvedMove: message.approvedMove,
    })),
  }
}

function textWithQuote(message: StoredMessage): string {
  return message.quote ? `${message.quote.text}\n${message.text}` : message.text
}

async function rememberTeacherCouldNotAnswer(
  studentId: string,
  placement: Placement,
  store: ConversationStore,
): Promise<void> {
  await store.appendMessage(studentId, placement.module.id, {
    author: 'teacher',
    approvedMove: null,
    text: teacherFallback,
    exerciseId: placement.exercise.id,
  })
}

async function rememberDeskmateCouldNotAnswer(
  studentId: string,
  placement: Placement,
  store: ConversationStore,
): Promise<void> {
  await store.appendMessage(studentId, placement.module.id, {
    author: 'deskmate',
    approvedMove: null,
    text: deskmateFallback,
    exerciseId: placement.exercise.id,
  })
}

async function viewPlacement(
  course: Course,
  studentId: string,
  store: ConversationStore,
  estimate: CourseEstimate,
  knownPoint: ResumePoint | null,
): Promise<{ placement: Placement, point: ResumePoint | null }> {
  // With no resume point the student starts on the furthest module their
  // evidence has unlocked, which is Module 1 when they have no evidence.
  const opening = studyModule(course, furthestUnlockedModuleId(course, estimate))
  if (!opening) throw new Error('The first module of the course is missing.')
  let point = knownPoint
  const moduleId = point ? canonicalModuleId(point.moduleId) : opening.id
  const module = studyModule(course, moduleId)
  if (module && estimate.unlockedModuleIds.includes(module.id)) {
    const exercise = module.exercises.find(item => item.id === point?.exerciseId) ?? module.exercises[0]
    if (!point || point.moduleId !== module.id || point.exerciseId !== exercise.id) {
      point = { moduleId: module.id, exerciseId: exercise.id }
      await store.saveResumePoint(studentId, point)
    }
    return { placement: { course, module, exercise }, point }
  }

  const exercise = opening.exercises[0]
  if (!point) {
    point = { moduleId: opening.id, exerciseId: exercise.id }
    await store.saveResumePoint(studentId, point)
  }
  return { placement: { course, module: opening, exercise }, point }
}

async function adoptPlacement(
  studentId: string,
  store: ConversationStore,
  placement: Placement,
): Promise<void> {
  await store.saveResumePoint(studentId, {
    moduleId: placement.module.id,
    exerciseId: placement.exercise.id,
  })
}

async function redraw(
  studentId: string,
  placement: Placement,
  standing: CourseStanding,
  store: ConversationStore,
  quizStore: QuizAnswerStore,
  mode: 'learn' | null = null,
  options?: TurnOptions,
  // The pattern the Teacher saw this turn, when a caller already computed it;
  // redraw reads the records itself otherwise.
  pattern?: LearningPattern,
  // The plan the caller already read; undefined reads the stored latest.
  plan?: LearningPlan | null,
): Promise<TurnState> {
  const seen = pattern ?? await learningPatternFor(studentId, placement, options)
  const [messages, displayName, quizAnswers, learningPlan, suggestion] = await Promise.all([
    store.messages(studentId, placement.module.id),
    store.displayName(studentId),
    quizStore.forStudentModule(studentId, placement.module.id),
    presentedPlan(studentId, placement, quizStore, plan === undefined ? await (options?.plans?.latest(studentId, placement.module.id) ?? null) : plan, options, seen),
    studySuggestionFor(studentId, placement, standing, options),
  ])
  return composeState(placement, standing, messages, displayName, mode, quizAnswers, seen, learningPlan, suggestion)
}

// The one step the fixed rules choose from the student's activity log for this course, or null
// when no situation is true. Nothing is written: the log is not evidence.
async function studyStepFor(
  studentId: string,
  placement: Placement,
  standing: CourseStanding,
  options?: TurnOptions,
): Promise<StudyStep | null> {
  if (!options?.activity) return null
  return chooseStudyStep({
    course: placement.course,
    rows: await options.activity.forStudent(studentId),
    currentModuleId: placement.module.id,
    currentExerciseId: placement.exercise.id,
    unlockedModuleIds: standing.unlockedModuleIds,
  })
}

// The step as the dialog shows it: null once this episode of it was dismissed.
async function studySuggestionFor(
  studentId: string,
  placement: Placement,
  standing: CourseStanding,
  options?: TurnOptions,
): Promise<StudySuggestionView | null> {
  const step = await studyStepFor(studentId, placement, standing, options)
  if (!step) return null
  return visibleStudySuggestion(step, await options?.studySuggestions?.dismissed(studentId) ?? new Map())
}

// The pattern's weak spots in plain words: the course's response text for each
// misconception the student's records keep meeting, so the student is told what
// to work on without any ids.
function weakSpotTexts(pattern: LearningPattern, placement: Placement): string[] {
  return pattern.weakSpots.flatMap(spot =>
    placement.course.studyModules.flatMap(module =>
      module.misconceptionResponses
        .filter(response => response.id === spot.misconceptionId)
        .map(response => response.response)))
}

// The learning pattern for one student in the turn's course: a pure read of the
// student's records through the stores, nothing written. A store that is absent
// contributes nothing.
async function learningPatternFor(studentId: string, placement: Placement, options?: TurnOptions): Promise<LearningPattern> {
  return gatherLearningPattern(options ?? {}, studentId, placement.course)
}

// The exercises the student has passed, with the verified attempts each took:
// the learning pattern's counts, named from the course, in course order. Mastery
// is the roadmap's; no review signal and no raw activity event reaches here.
function presentedProgress(course: Course, pattern: LearningPattern): ProgressView {
  const attempts = new Map(pattern.exerciseAttempts.filter(item => item.passed).map(item => [item.exerciseId, item.attempts]))
  return {
    completedExercises: course.studyModules.flatMap(module =>
      module.exercises.flatMap((exercise) => {
        const taken = attempts.get(exercise.id)
        return taken === undefined
          ? []
          : [{ moduleId: module.id, moduleName: nameOfModule(course, module.id), exerciseId: exercise.id, title: exercise.title, attempts: taken }]
      })),
  }
}

function composeState(
  placement: Placement,
  standing: CourseStanding,
  messages: readonly StoredMessage[],
  displayName: string,
  mode: 'learn' | null,
  quizAnswers: readonly QuizAnswerRow[],
  pattern: LearningPattern,
  learningPlan: LearningPlanView | null = null,
  studySuggestion: StudySuggestionView | null = null,
): TurnState {
  return {
    displayName,
    course: placement.course.title,
    courseRoadmap: presentedRoadmap(placement.course, standing),
    masteryThreshold: placement.course.masteryThreshold,
    weakSpots: weakSpotTexts(pattern, placement),
    progress: presentedProgress(placement.course, pattern),
    learningPlan,
    studySuggestion,
    workingArea: {
      mode,
      moduleId: placement.module.id,
      moduleName: nameOfModule(placement.course, placement.module.id),
      materials: placement.module.materials.map(block => ({ ...block })),
      exercise: presentExercise(placement.exercise),
      exercises: placement.module.exercises.map(choice => ({
        id: choice.id,
        title: choice.title,
      })),
      quiz: presentQuiz(placement.module, quizAnswers),
    },
    conversation: messages.map(message => presentMessage(message, displayName)),
  }
}

function presentQuiz(
  module: StudyModule,
  quizAnswers: readonly QuizAnswerRow[],
): QuizQuestionView[] {
  return module.quiz.map((question) => {
    const answered = quizAnswers.find(row => row.questionId === question.id)
    return {
      id: question.id,
      prompt: question.prompt,
      choices: question.choices,
      // The correct choice and the explanation are attached only once the
      // student has answered, so an unanswered question never reveals them.
      result: answered
        ? {
            choice: answered.choice,
            correctIndex: question.correctIndex,
            correct: answered.correct,
            explanation: question.explanation,
          }
        : null,
    }
  })
}

function presentMessage(message: StoredMessage, displayName: string): ConversationMessage {
  const speaker = message.author === 'event' && isSubmissionSummary(message.text)
    ? { name: 'Practice check', role: 'Result' }
    : message.author === 'event' && isQuizSummary(message.text)
      ? { name: 'Quiz', role: 'Result' }
      : {
          student: { name: displayName, role: 'Student' },
          teacher: { name: 'Teacher', role: 'Teacher' },
          deskmate: { name: 'Mai', role: 'Deskmate' },
          event: { name: 'Exercise', role: 'Marker' },
        }[message.author]

  return {
    id: message.id,
    author: message.author,
    name: speaker.name,
    role: message.author === 'teacher' ? teacherMoveLabel(message.approvedMove) : speaker.role,
    text: message.text,
    exerciseId: message.exerciseId,
    approvedMove: message.approvedMove,
    openInLearn: message.author === 'teacher'
      && (message.approvedMove === 'explain_concept' || message.approvedMove === 'answer_question'),
    ...(message.createdAt ? { createdAt: message.createdAt } : {}),
    ...(message.addressedAgent ? { addressedAgent: message.addressedAgent } : {}),
    ...(message.quote ? { quote: message.quote } : {}),
  }
}

function teacherMoveLabel(approvedMove: string | null): string {
  if (approvedMove === 'redirect_to_module') return 'Not yet'
  if (approvedMove === 'explain_concept') return 'Explanation'
  if (approvedMove === 'answer_question') return 'Answer'
  if (approvedMove?.startsWith('hint_level_')) return 'Hint'
  if (approvedMove?.startsWith('address_misconception')) return 'Misconception'
  if (approvedMove === 'reveal_answer') return 'Answer revealed'
  if (approvedMove?.startsWith('advance_to_module:')) return 'Next module'
  if (approvedMove === 'stay_and_practise') return 'Keep practising'
  if (approvedMove === 'revise_plan') return 'Plan revised'
  if (approvedMove === 'continue_plan') return 'Check-in'
  return ''
}

function presentExercise(exercise: Exercise): CurrentExercise {
  return {
    id: exercise.id,
    title: exercise.title,
    statement: exercise.statement,
    starterCode: exercise.starterCode,
    tests: exercise.tests,
  }
}

interface SeenWork {
  draft: string | null
  runOutput: RunOutput | null
  submission: SubmissionCheck | null
}

interface MessageEvent {
  event: 'message'
  text: string
  draft?: unknown
  run?: unknown
  addressedAgent?: unknown
  quote?: unknown
}

function messageQuote(body: MessageEvent): Quote | null {
  const quote = body.quote
  if (typeof quote !== 'object' || quote === null) return null
  if (!('text' in quote) || typeof quote.text !== 'string' || quote.text.trim() === '') return null
  if (!('moduleId' in quote) || typeof quote.moduleId !== 'string' || quote.moduleId.trim() === '') return null
  if (!('source' in quote) || (quote.source !== 'agent' && quote.source !== 'materials')) return null
  return { text: quote.text.trim(), source: quote.source, moduleId: quote.moduleId.trim() }
}

// Anything but a known agent is read as no addressed agent.
function messageAddressedAgent(body: MessageEvent): AddressedAgent | null {
  return body.addressedAgent === 'teacher' || body.addressedAgent === 'deskmate' ? body.addressedAgent : null
}

function isDeskmateSwitch(input: unknown): input is { event: 'deskmate_switch', on: boolean } {
  return typeof input === 'object'
    && input !== null
    && 'event' in input
    && input.event === 'deskmate_switch'
    && 'on' in input
    && typeof input.on === 'boolean'
}

function isIdle(input: unknown): input is { event: 'idle' } {
  return typeof input === 'object'
    && input !== null
    && 'event' in input
    && input.event === 'idle'
}

function isDismissStudySuggestion(input: unknown): input is { event: 'dismiss_study_suggestion', key: string } {
  return typeof input === 'object'
    && input !== null
    && 'event' in input
    && input.event === 'dismiss_study_suggestion'
    && 'key' in input
    && typeof input.key === 'string'
}

function isPlanStart(input: unknown): input is { event: 'plan_start' } {
  return typeof input === 'object'
    && input !== null
    && 'event' in input
    && input.event === 'plan_start'
}

function copySubmission(submission: SubmissionCheck | null): SubmissionCheck | null {
  if (!submission) return null
  return {
    code: submission.code,
    results: submission.results.map(result => ({ ...result })),
  }
}

interface SubmissionEvent {
  event: 'submission'
  code: string
  results: PracticeTestResult[]
}

const uncheckedSandbox: Sandbox = {
  async check() {
    return { outcome: 'refused', message: couldNotCheck }
  },
}

// The exercise's own tests, never the counts the browser sent.
async function checkedSubmission(
  code: string,
  tests: readonly { name: string, expression: string, expected: string }[],
  sandbox: Sandbox | undefined,
): Promise<SandboxReport> {
  const report = await (sandbox ?? uncheckedSandbox).check({
    code,
    tests: tests.map(test => ({
      name: test.name,
      expression: test.expression,
      expected: test.expected,
    })),
  })
  if (report.outcome === 'checked' && report.results.length === 0) {
    return { outcome: 'refused', message: couldNotCheck }
  }
  return report
}

async function rememberSubmission(store: SubmissionStore | undefined, submission: NewSubmission): Promise<void> {
  await store?.record(submission)
}

// The misconceptions the module's declared checks read in the submitted code,
// which is none when the module declares no check or the code shows none.
function codeFindings(code: string, module: StudyModule): readonly string[] {
  const declared = module.codeMisconception
  return declared && showsCodeMisconception(code, declared) ? [declared.id] : []
}

// The findings for the work in hand: read from the code just submitted, or, for
// a turn without a submission, from the latest submission kept for the exercise.
async function codeFindingsFor(
  studentId: string,
  placement: Placement,
  seen: SeenWork,
  options?: TurnOptions,
): Promise<readonly string[]> {
  if (seen.submission) return codeFindings(seen.submission.code, placement.module)
  const latest = await options?.submissions?.latestForExercise(
    studentId,
    placement.module.id,
    placement.exercise.id,
  )
  return latest?.findings ?? []
}

function submissionSummary(results: readonly { passed: boolean }[]): string {
  const passed = results.filter(result => result.passed).length
  return `${passed}/${results.length} tests passed`
}

function isSubmissionSummary(text: string): boolean {
  return /^\d+\/\d+ tests passed$/.test(text)
}

function isQuizSummary(text: string): boolean {
  return /^Quiz \d+: chose [A-D], (right|wrong)$/.test(text)
}

function messageDraft(body: MessageEvent): string | null {
  return typeof body.draft === 'string' ? body.draft : null
}

function messageRun(body: MessageEvent): RunOutput | null {
  const run = body.run
  if (typeof run !== 'object' || run === null) return null
  if (!('stdout' in run) || !('stderr' in run) || !('error' in run)) return null
  if (typeof run.stdout !== 'string' || typeof run.stderr !== 'string') return null
  if (run.error === null) return { stdout: run.stdout, stderr: run.stderr, error: null }
  if (typeof run.error !== 'object' || run.error === null) return null
  if (!('message' in run.error) || !('line' in run.error)) return null
  if (typeof run.error.message !== 'string' || typeof run.error.line !== 'number') return null
  if (!Number.isInteger(run.error.line) || run.error.line < 1) return null
  return {
    stdout: run.stdout,
    stderr: run.stderr,
    error: { message: run.error.message, line: run.error.line },
  }
}

function isSubmission(input: unknown): input is SubmissionEvent {
  return typeof input === 'object'
    && input !== null
    && 'event' in input
    && input.event === 'submission'
    && 'code' in input
    && typeof input.code === 'string'
    && 'results' in input
    && Array.isArray(input.results)
    && input.results.length > 0
    && input.results.every(isPracticeResult)
}

function isPracticeResult(input: unknown): input is PracticeTestResult {
  return typeof input === 'object'
    && input !== null
    && 'name' in input
    && typeof input.name === 'string'
    && input.name.length > 0
    && 'passed' in input
    && typeof input.passed === 'boolean'
    && 'expected' in input
    && typeof input.expected === 'string'
    && 'actual' in input
    && typeof input.actual === 'string'
}

function isMessage(input: unknown): input is MessageEvent {
  return typeof input === 'object'
    && input !== null
    && 'event' in input
    && input.event === 'message'
    && 'text' in input
    && typeof input.text === 'string'
    && input.text.trim().length > 0
}

interface QuizAnswerEvent {
  event: 'quiz_answer'
  moduleId: string
  questionId: string
  choice: number
}

function isQuizAnswer(input: unknown): input is QuizAnswerEvent {
  return typeof input === 'object'
    && input !== null
    && 'event' in input
    && input.event === 'quiz_answer'
    && 'moduleId' in input
    && typeof input.moduleId === 'string'
    && input.moduleId.length > 0
    && 'questionId' in input
    && typeof input.questionId === 'string'
    && input.questionId.length > 0
    && 'choice' in input
    && typeof input.choice === 'number'
}

function isChoiceIndex(choice: number): boolean {
  return Number.isInteger(choice) && choice >= 0 && choice <= 3
}

function isOpenEvent(input: unknown): input is { event: 'open' } {
  return typeof input === 'object'
    && input !== null
    && 'event' in input
    && input.event === 'open'
}

function isSelectModule(input: unknown): input is { event: 'select_module', moduleId: string } {
  return isModuleEvent(input, 'select_module')
}

function isPreviewModule(input: unknown): input is { event: 'preview_module', moduleId: string } {
  return isModuleEvent(input, 'preview_module')
}

function isModuleEvent(
  input: unknown,
  event: 'select_module' | 'preview_module',
): input is { event: 'select_module' | 'preview_module', moduleId: string } {
  return typeof input === 'object'
    && input !== null
    && 'event' in input
    && input.event === event
    && 'moduleId' in input
    && typeof input.moduleId === 'string'
    && input.moduleId.length > 0
}

function isSelectExercise(input: unknown): input is { event: 'select_exercise', exerciseId: string } {
  return typeof input === 'object'
    && input !== null
    && 'event' in input
    && input.event === 'select_exercise'
    && 'exerciseId' in input
    && typeof input.exerciseId === 'string'
    && input.exerciseId.length > 0
}

function nameOfModule(course: Course, id: string): string {
  const named = course.modules.find(item => item.id === id)
  if (!named) throw new Error(`Study module ${id} is missing from the course module list.`)
  return named.name
}
