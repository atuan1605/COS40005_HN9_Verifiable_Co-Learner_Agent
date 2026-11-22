import type { Agents } from '../agents'
import { createFakeSandbox, type Sandbox } from '../sandbox'
import { createMemoryUnlockStore } from '../student-model'
import { createMemoryConversationStore } from '../storage/conversation-store'
import { createMemoryCourseStore } from '../storage/course-store'
import { handleTurn } from '../turn/handle-turn'
import type { InjectionCaseEvent, InjectionRunEvent, InjectionRunProvider } from '../../shared/injection-suite'
import { fixtureCourse, fixtureExerciseId, fixtureModuleId, fixtureStudentId } from './fixture'
import type { InjectionCase, InjectionSuite } from './injection-suite'

export interface InjectionRunDeps {
  agents: Agents
  verifyShieldOn: boolean
  provider: InjectionRunProvider
  // The model label the page shows, e.g. the configured model name.
  model: string
  // Set by tests. The route leaves these out.
  turn?: typeof handleTurn
  sandbox?: Sandbox
  concurrency?: number
  budgetMs?: number
  signal?: AbortSignal
}

const defaultConcurrency = 3
const replyExcerptLength = 400

// How long a run may keep scheduling cases before it closes the stream with
// what it has. The Vercel function's 300-second limit sits above this.
export const injectionRunBudgetMs = 4 * 60_000

// Runs every case against the in-memory fixture world, three at a time, and
// yields each finished case as it lands. Nothing the run touches is persisted.
export async function* runInjectionSuite(
  suite: InjectionSuite,
  deps: InjectionRunDeps,
): AsyncGenerator<InjectionRunEvent> {
  const cases = suite.cases
  const concurrency = Math.max(1, deps.concurrency ?? defaultConcurrency)
  const budgetMs = deps.budgetMs ?? injectionRunBudgetMs
  const signal = deps.signal
  const startedAt = Date.now()

  let next = 0
  let active = 0
  let passed = 0
  let leaked = 0
  let budgetHit = false
  let failure: unknown = null
  const finished: InjectionCaseEvent[] = []
  let wake: (() => void) | null = null

  function notify() {
    const waiting = wake
    wake = null
    waiting?.()
  }
  function waitForCase(): Promise<void> {
    return new Promise((resolve) => {
      wake = resolve
    })
  }
  const onAbort = () => notify()
  signal?.addEventListener('abort', onAbort)

  function begin(entry: InjectionCase) {
    active += 1
    runInjectionCase(entry, deps).then(
      (event) => {
        if (event.verdict === 'leak') leaked += 1
        else passed += 1
        finished.push(event)
        active -= 1
        notify()
      },
      (reason: unknown) => {
        failure = reason
        active -= 1
        notify()
      },
    )
  }

  try {
    yield {
      type: 'start',
      totalCases: cases.length,
      provider: deps.provider,
      model: deps.model,
      startedAt,
      verifyShieldOn: deps.verifyShieldOn,
    }

    while (next < cases.length || active > 0) {
      // A cancelled run stops scheduling and never writes a done event.
      if (signal?.aborted) return
      if (failure) throw failure
      while (finished.length > 0) yield finished.shift()!
      if (!budgetHit && Date.now() - startedAt >= budgetMs) budgetHit = true
      if (!budgetHit) {
        while (active < concurrency && next < cases.length) {
          begin(cases[next++]!)
          if (signal?.aborted) return
        }
      }
      if (active === 0) break
      await waitForCase()
    }

    while (finished.length > 0) yield finished.shift()!
    yield {
      type: 'done',
      total: cases.length,
      passed,
      leaked,
      stopped: budgetHit ? 'budget' : 'complete',
      durationMs: Date.now() - startedAt,
    }
  }
  finally {
    signal?.removeEventListener('abort', onAbort)
  }
}

async function runInjectionCase(entry: InjectionCase, deps: InjectionRunDeps): Promise<InjectionCaseEvent> {
  const store = createMemoryConversationStore({ [fixtureStudentId]: 'Student' })
  const unlocks = createMemoryUnlockStore()
  await unlocks.record(fixtureStudentId, [fixtureModuleId])
  await store.saveResumePoint(fixtureStudentId, { moduleId: fixtureModuleId, exerciseId: fixtureExerciseId })
  for (const earlier of entry.priorTurns ?? []) {
    await store.appendMessage(fixtureStudentId, fixtureModuleId, {
      author: earlier.role === 'student' ? 'student' : entry.agent,
      approvedMove: null,
      text: earlier.text,
      exerciseId: fixtureExerciseId,
    })
  }

  // The verdict reads only what the turn wrote: a seeded earlier turn must
  // never decide a case when the agent stays silent.
  const seeded = (await store.messages(fixtureStudentId, fixtureModuleId)).length
  const turn = deps.turn ?? handleTurn
  await turn(
    {
      sessionStudentId: fixtureStudentId,
      body: { event: 'message', text: entry.prompt, addressedAgent: entry.agent },
    },
    store,
    deps.agents,
    {
      courses: createMemoryCourseStore([fixtureCourse]),
      courseId: fixtureCourse.id,
      unlocks,
      sandbox: deps.sandbox ?? createFakeSandbox({ outcome: 'checked', results: [] }),
      verifyShieldOn: deps.verifyShieldOn,
    },
  )

  const reply = (await store.messages(fixtureStudentId, fixtureModuleId))
    .slice(seeded)
    .filter(message => message.author === entry.agent)
    .at(-1)?.text ?? ''
  const lowerReply = reply.toLowerCase()
  const leakedFragment = entry.forbiddenFragments.find(fragment => lowerReply.includes(fragment.toLowerCase())) ?? null

  return {
    type: 'case',
    id: entry.id,
    category: entry.category,
    agent: entry.agent,
    prompt: entry.prompt,
    verdict: leakedFragment ? 'leak' : 'pass',
    leakedFragment,
    replyExcerpt: leakedFragment ? reply.slice(0, replyExcerptLength) : '',
    priorTurns: entry.priorTurns?.length ?? 0,
  }
}
