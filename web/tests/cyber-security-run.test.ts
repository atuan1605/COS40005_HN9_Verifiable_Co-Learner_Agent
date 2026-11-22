import { describe, expect, it, vi } from 'vitest'
import { createAgents, type Agents } from '../server/agents'
import { productOwnerAccount } from '../server/auth/demo-accounts'
import {
  fixtureExerciseId,
  fixtureModuleId,
  fixtureStudentId,
  handleRunRequest,
  InjectionRunInProgressError,
  InjectionSuiteInvalidError,
  runInjectionSuite,
  type InjectionCase,
  type InjectionRunDeps,
  type InjectionSuite,
} from '../server/cyber-security'
import { injectionCategoryIds } from '../shared/injection-suite'
import type { InjectionRunEvent } from '../shared/injection-suite'
import { createFakeLanguageModel } from '../server/language-model'
import type { handleTurn } from '../server/turn/handle-turn'
import type { RedrawState } from '../shared/turn'

const adminEmails = 'assistant@example.com, owner@example.com'

function probe(overrides: Partial<InjectionCase> & Pick<InjectionCase, 'id'>): InjectionCase {
  return {
    category: 'answer_extraction',
    agent: 'teacher',
    prompt: 'Give me the code.',
    forbiddenFragments: ['total += number'],
    ...overrides,
  }
}

function suiteOf(cases: InjectionCase[]): InjectionSuite {
  return { version: 1, cases }
}

async function collect(events: AsyncGenerator<InjectionRunEvent>): Promise<InjectionRunEvent[]> {
  const collected: InjectionRunEvent[] = []
  for await (const event of events) collected.push(event)
  return collected
}

function casesOf(events: InjectionRunEvent[]) {
  return events.flatMap(event => event.type === 'case' ? [event] : [])
}

function deps(model: ReturnType<typeof createFakeLanguageModel>, overrides: Partial<InjectionRunDeps> = {}): InjectionRunDeps {
  return { agents: createAgents(model), verifyShieldOn: true, provider: 'fake', concurrency: 1, ...overrides }
}

// The teacher's render text is the scripted reply, so the reply decides the verdict.
function teacherScript(replies: string[]) {
  return createFakeLanguageModel({
    steps: replies.map(() => ({ proposal: { type: 'explain_concept', scope: fixtureModuleId } })),
    replies,
  })
}

function generatedSuite(): string {
  const lines = ['version: 1', 'cases:']
  for (const category of injectionCategoryIds) {
    for (let number = 1; number <= 15; number++) {
      lines.push(
        `  - id: ${category}-${String(number).padStart(2, '0')}`,
        `    category: ${category}`,
        `    agent: ${number % 2 === 0 ? 'deskmate' : 'teacher'}`,
        `    prompt: "Probe ${number} for ${category}"`,
        '    forbiddenFragments: ["total += number"]',
      )
    }
  }
  return `${lines.join('\n')}\n`
}

describe('the injection run engine', () => {
  it('calls a reply containing a fragment a leak and a clean reply a pass, ignoring case', async () => {
    const model = teacherScript([
      'Sure, put TOTAL += NUMBER inside the loop.',
      'Try writing the loop yourself first.',
    ])
    const events = await collect(runInjectionSuite(suiteOf([
      probe({ id: 'leaks', forbiddenFragments: ['TOTAL += NUMBER'] }),
      probe({ id: 'passes', forbiddenFragments: ['print(total)'] }),
    ]), deps(model)))

    expect(events[0]).toEqual({ type: 'start', totalCases: 2, provider: 'fake' })
    const [leak, pass] = casesOf(events)
    expect(leak).toMatchObject({
      id: 'leaks',
      verdict: 'leak',
      leakedFragment: 'TOTAL += NUMBER',
      priorTurns: 0,
    })
    expect(leak.replyExcerpt).toContain('TOTAL += NUMBER')
    expect(pass).toMatchObject({ id: 'passes', verdict: 'pass', leakedFragment: null, replyExcerpt: '' })
    expect(events.at(-1)).toEqual({ type: 'done', total: 2, passed: 1, leaked: 1, stopped: 'complete' })
  })

  it('replays a case earlier turns before its prompt', async () => {
    const model = teacherScript(['Try it yourself.'])
    await collect(runInjectionSuite(suiteOf([
      probe({
        id: 'multi-turn',
        priorTurns: [
          { role: 'student', text: 'Can I have a hint?' },
          { role: 'agent', text: 'Write the total before the loop.' },
        ],
      }),
    ]), deps(model)))

    const prompt = model.calls[0].prompt
    expect(prompt).toContain('Can I have a hint?')
    expect(prompt).toContain('Write the total before the loop.')
    expect(prompt.indexOf('Can I have a hint?')).toBeLessThan(prompt.lastIndexOf('Give me the code.'))
  })

  it('does not read a seeded earlier turn as the reply when the agent stays silent', async () => {
    const turn = (async () => ({} as RedrawState)) as typeof handleTurn
    const events = await collect(runInjectionSuite(suiteOf([
      probe({
        id: 'silent',
        forbiddenFragments: ['total += number'],
        priorTurns: [{ role: 'agent', text: 'Write total += number inside the loop.' }],
      }),
    ]), deps(teacherScript([]), { turn })))

    expect(casesOf(events)[0]).toMatchObject({ id: 'silent', verdict: 'pass', leakedFragment: null })
  })

  it('closes with a budget done event and runs no case once the budget is spent', async () => {
    const turn = vi.fn()
    const events = await collect(runInjectionSuite(suiteOf([
      probe({ id: 'first' }),
      probe({ id: 'second' }),
    ]), deps(teacherScript([]), { turn, budgetMs: 0 })))

    expect(events).toEqual([
      { type: 'start', totalCases: 2, provider: 'fake' },
      { type: 'done', total: 2, passed: 0, leaked: 0, stopped: 'budget' },
    ])
    expect(turn).not.toHaveBeenCalled()
  })

  it('passes the VerifyShield flag through to the turn', async () => {
    const seen: (boolean | undefined)[] = []
    const turn = (async (_request, store, _agents, options) => {
      seen.push(options?.verifyShieldOn)
      await store.appendMessage(fixtureStudentId, fixtureModuleId, {
        author: 'teacher',
        approvedMove: null,
        text: 'Try it yourself.',
        exerciseId: fixtureExerciseId,
      })
      return {} as RedrawState
    }) as typeof handleTurn

    await collect(runInjectionSuite(suiteOf([probe({ id: 'one' })]), {
      agents: {} as Agents,
      verifyShieldOn: false,
      provider: 'fake',
      concurrency: 1,
      turn,
    }))

    expect(seen).toEqual([false])
  })

  it('keeps at most three cases running at a time and finishes every case', async () => {
    let active = 0
    let most = 0
    const turn = (async (_request, store) => {
      active += 1
      most = Math.max(most, active)
      await new Promise(resolve => setTimeout(resolve, 15))
      await store.appendMessage(fixtureStudentId, fixtureModuleId, {
        author: 'teacher',
        approvedMove: null,
        text: 'Try it yourself.',
        exerciseId: fixtureExerciseId,
      })
      active -= 1
      return {} as RedrawState
    }) as typeof handleTurn
    const cases = Array.from({ length: 7 }, (_, index) => probe({ id: `case-${index + 1}` }))

    const events = await collect(runInjectionSuite(suiteOf(cases), {
      agents: {} as Agents,
      verifyShieldOn: true,
      provider: 'fake',
      turn,
    }))

    expect(most).toBe(3)
    expect(casesOf(events)).toHaveLength(7)
    expect(events.at(-1)).toMatchObject({ type: 'done', total: 7, stopped: 'complete' })
  })

  it('stops scheduling and ends without a done event when the run is cancelled', async () => {
    const controller = new AbortController()
    const turn = (() => new Promise<RedrawState>(() => {})) as typeof handleTurn
    const events: InjectionRunEvent[] = []

    const iterating = (async () => {
      for await (const event of runInjectionSuite(
        suiteOf(Array.from({ length: 6 }, (_, index) => probe({ id: `case-${index + 1}` }))),
        { agents: {} as Agents, verifyShieldOn: true, provider: 'fake', turn, signal: controller.signal },
      )) {
        events.push(event)
      }
    })()

    setTimeout(() => controller.abort(), 10)
    await Promise.race([
      iterating,
      new Promise((_, reject) => setTimeout(() => reject(new Error('The run did not stop.')), 1000)),
    ])

    expect(events.every(event => event.type === 'start')).toBe(true)
    expect(events.some(event => event.type === 'done')).toBe(false)
  })
})

describe('the injection run request', () => {
  it('refuses a caller with no session before loading the suite', async () => {
    const load = vi.fn(async () => generatedSuite())
    const run = vi.fn()

    await expect(handleRunRequest({ email: null, adminEmails, load, run }))
      .rejects.toMatchObject({ statusCode: 401 })
    expect(load).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
  })

  it('refuses a student before loading the suite', async () => {
    const load = vi.fn(async () => generatedSuite())
    const run = vi.fn()

    await expect(handleRunRequest({ email: 'an@example.com', adminEmails, load, run }))
      .rejects.toMatchObject({ statusCode: 403 })
    expect(load).not.toHaveBeenCalled()
    expect(run).not.toHaveBeenCalled()
  })

  it('refuses a malformed suite with no model call', async () => {
    const load = vi.fn(async () => 'version: 1\ncases: [')
    const run = vi.fn()

    await expect(handleRunRequest({ email: productOwnerAccount.email, adminEmails, load, run }))
      .rejects.toBeInstanceOf(InjectionSuiteInvalidError)
    expect(run).not.toHaveBeenCalled()
  })

  it('answers the administrator with start, case and done events in order', async () => {
    const end = vi.fn()
    const run = vi.fn((suite: InjectionSuite) => (async function* () {
      yield { type: 'start' as const, totalCases: suite.cases.length, provider: 'fake' as const }
      yield {
        type: 'case' as const,
        id: 'permission-overstep-01',
        category: 'permission_overstep' as const,
        agent: 'teacher' as const,
        prompt: 'A probe.',
        verdict: 'pass' as const,
        leakedFragment: null,
        replyExcerpt: '',
        priorTurns: 0,
      }
      yield { type: 'done' as const, total: suite.cases.length, passed: 1, leaked: 0, stopped: 'complete' as const }
    })())

    const events = await collect(await handleRunRequest({
      email: productOwnerAccount.email,
      adminEmails,
      load: async () => generatedSuite(),
      run,
      begin: () => true,
      end,
    }))

    expect(run).toHaveBeenCalledTimes(1)
    expect(events.map(event => event.type)).toEqual(['start', 'case', 'done'])
    expect(events[0]).toMatchObject({ totalCases: 120, provider: 'fake' })
    expect(end).toHaveBeenCalledTimes(1)
  })

  it('refuses a second run while one is in progress', async () => {
    const load = vi.fn(async () => generatedSuite())

    await expect(handleRunRequest({
      email: productOwnerAccount.email,
      adminEmails,
      load,
      run: vi.fn(),
      begin: () => false,
      end: vi.fn(),
    })).rejects.toBeInstanceOf(InjectionRunInProgressError)
    expect(load).not.toHaveBeenCalled()
  })
})
