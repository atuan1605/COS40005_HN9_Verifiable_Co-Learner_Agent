import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkAdminRole, handleAdmin, handleConnectionTest, isConnectionTest } from '../server/admin/handle-admin'
import { lecturerAccount, productOwnerAccount } from '../server/auth/demo-accounts'
import { agentsForTurn, createFakeAgents } from '../server/agents'
import type { ModelSettings } from '../server/language-model'
import { createMemoryConversationStore } from '../server/storage/conversation-store'
import { createMemoryDecisionLogStore, type DecisionRecord } from '../server/storage/decision-log'
import { createMemoryModelSettingsStore } from '../server/storage/model-settings-store'
import { createMemoryStudentDirectoryStore } from '../server/storage/student-directory'
import { createMemoryVerifyShieldStore, verifyShieldForTurn } from '../server/verify-shield'
import { createFakeSandbox } from '../server/sandbox'
import { handleTurn } from '../server/turn/handle-turn'

const owner = productOwnerAccount.email
const adminEmails = 'assistant@example.com, owner@example.com'
const signedInStudent = '6f1b0c1e-1111-4111-8111-111111111111'
const savedKey = 'sk-super-secret-a1b2'
const envKey = 'sk-environment-key-zz99'
const fakeSentence = 'A running total has to be created before the loop, so each pass can add to the same number.'
const realSentence = 'Counted by the saved model.'

const realEnv: ModelSettings = {
  provider: 'real',
  apiKey: envKey,
  baseUrl: 'https://env.example',
  modelName: 'env-model',
}

const fakeEnv: ModelSettings = {
  provider: 'fake',
  apiKey: '',
  baseUrl: '',
  modelName: '',
}

function ownerRequest(overrides: {
  email?: string | null
  env?: ModelSettings
  store?: ReturnType<typeof createMemoryModelSettingsStore>
  decisions?: ReturnType<typeof createMemoryDecisionLogStore>
  verifyShield?: ReturnType<typeof createMemoryVerifyShieldStore>
  students?: ReturnType<typeof createMemoryStudentDirectoryStore>
  verifyShieldEnv?: string
  production?: boolean
  body?: unknown
} = {}) {
  return {
    email: 'email' in overrides ? overrides.email! : owner,
    adminEmails,
    env: overrides.env ?? realEnv,
    store: overrides.store ?? createMemoryModelSettingsStore(),
    decisions: overrides.decisions,
    verifyShield: overrides.verifyShield,
    students: overrides.students,
    verifyShieldEnv: overrides.verifyShieldEnv,
    production: overrides.production,
    body: overrides.body ?? { event: 'read' },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('admin handler', () => {
  it('refuses a student and leaves the saved settings untouched', async () => {
    const store = createMemoryModelSettingsStore()

    await expect(handleAdmin(ownerRequest({
      email: 'an@example.com',
      store,
      body: { event: 'save', provider: 'fake' },
    }))).rejects.toMatchObject({ statusCode: 403 })

    expect(await store.read()).toBeNull()
  })

  it('answers a role check for the administrator and refuses anyone else', () => {
    expect(checkAdminRole({ email: owner, adminEmails })).toEqual({ productOwner: true })
    expect(() => checkAdminRole({ email: 'an@example.com', adminEmails })).toThrow(expect.objectContaining({ statusCode: 403 }))
    expect(() => checkAdminRole({ email: null, adminEmails })).toThrow(expect.objectContaining({ statusCode: 401 }))
  })

  it('refuses a request with no session', async () => {
    await expect(handleAdmin(ownerRequest({ email: null })))
      .rejects.toMatchObject({ statusCode: 401 })
  })

  it('uses the saved fake provider on the next turn without a restart', async () => {
    const store = createMemoryModelSettingsStore()
    const saved = await handleAdmin(ownerRequest({
      env: realEnv,
      store,
      body: { event: 'save', provider: 'fake' },
    }))

    expect(saved.model).toEqual({
      provider: 'fake',
      apiKeyMask: 'sk-…zz99',
      baseUrl: 'https://env.example',
      modelName: 'env-model',
      saved: true,
    })

    const state = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'message', text: 'Where does the total live?' },
    }, createMemoryConversationStore({
      [signedInStudent]: 'An',
    }), await agentsForTurn(store, realEnv))

    expect(state.conversation.find(message => message.author === 'teacher')?.text).toBe(fakeSentence)
  })

  it('uses the saved real provider on the next turn', async () => {
    const store = createMemoryModelSettingsStore()
    const calls: { url: string, authorization: string, model: string }[] = []
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init)
      const body = await request.json() as { model?: string, stream?: boolean, messages?: { content?: string }[] }
      calls.push({
        url: request.url,
        authorization: request.headers.get('authorization') ?? '',
        model: body.model ?? '',
      })
      const instructions = JSON.stringify(body.messages ?? [])
      if (body.stream) return sse(realSentence)
      const proposal = instructions.includes('You are Mai') ? null : { type: 'explain_concept', scope: 'getting_started' }
      return proposalReply(instructions, proposal)
    })

    await handleAdmin(ownerRequest({
      env: fakeEnv,
      store,
      body: {
        event: 'save',
        provider: 'real',
        apiKey: savedKey,
        baseUrl: 'https://api.deepseek.com',
        modelName: 'deepseek-chat',
      },
    }))

    const state = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'message', text: 'Where does the total live?' },
    }, createMemoryConversationStore({
      [signedInStudent]: 'An',
    }), await agentsForTurn(store, fakeEnv))

    expect(calls.length).toBeGreaterThan(0)
    expect(calls.every(call => call.url === 'https://api.deepseek.com/chat/completions')).toBe(true)
    expect(calls.every(call => call.authorization === `Bearer ${savedKey}`)).toBe(true)
    expect(calls.every(call => call.model === 'deepseek-chat')).toBe(true)
    expect(state.conversation.find(message => message.author === 'teacher')?.text).toBe(realSentence)
    expect(JSON.stringify(state)).not.toContain(savedKey)
  })

  it('returns the API key only as a mask', async () => {
    const store = createMemoryModelSettingsStore()
    const saved = await handleAdmin(ownerRequest({
      store,
      body: {
        event: 'save',
        provider: 'real',
        apiKey: savedKey,
        baseUrl: 'https://api.deepseek.com',
        modelName: 'deepseek-chat',
      },
    }))
    const again = await handleAdmin(ownerRequest({ store, body: { event: 'read' } }))

    expect(saved.model.apiKeyMask).toBe('sk-…a1b2')
    expect(again.model.apiKeyMask).toBe('sk-…a1b2')
    expect(JSON.stringify(saved)).not.toContain(savedKey)
    expect(JSON.stringify(again)).not.toContain(savedKey)

    const shortKey = 'secret1'
    const short = await handleAdmin(ownerRequest({
      store,
      body: {
        event: 'save',
        provider: 'real',
        apiKey: shortKey,
        baseUrl: 'https://api.deepseek.com',
        modelName: 'deepseek-chat',
      },
    }))
    expect(short.model.apiKeyMask).toBe('…')
    expect(JSON.stringify(short)).not.toContain(shortKey)
  })

  it('keeps the saved API key when a later save leaves the key blank', async () => {
    const store = createMemoryModelSettingsStore()
    await handleAdmin(ownerRequest({
      store,
      body: {
        event: 'save',
        provider: 'real',
        apiKey: savedKey,
        baseUrl: 'https://api.deepseek.com',
        modelName: 'deepseek-flash',
      },
    }))
    const calls: { authorization: string, model: string }[] = []
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init)
      const body = await request.json() as { model?: string, stream?: boolean, messages?: unknown }
      calls.push({
        authorization: request.headers.get('authorization') ?? '',
        model: body.model ?? '',
      })
      const instructions = JSON.stringify(body.messages ?? [])
      if (body.stream) return sse(realSentence)
      const proposal = instructions.includes('You are Mai') ? null : { type: 'explain_concept', scope: 'getting_started' }
      return proposalReply(instructions, proposal)
    })

    const updated = await handleAdmin(ownerRequest({
      store,
      body: {
        event: 'save',
        provider: 'real',
        apiKey: '   ',
        baseUrl: 'https://api.deepseek.com/',
        modelName: 'deepseek-chat',
      },
    }))

    await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'message', text: 'Where does the total live?' },
    }, createMemoryConversationStore({
      [signedInStudent]: 'An',
    }), await agentsForTurn(store, fakeEnv))

    expect(updated.model.apiKeyMask).toBe('sk-…a1b2')
    expect(JSON.stringify(updated)).not.toContain(savedKey)
    expect(calls.every(call => call.authorization === `Bearer ${savedKey}`)).toBe(true)
    expect(calls.every(call => call.model === 'deepseek-chat')).toBe(true)
  })

  it('refuses a saved model address other than the approved one in production', async () => {
    const store = createMemoryModelSettingsStore()

    await expect(handleAdmin(ownerRequest({
      production: true,
      store,
      body: {
        event: 'save',
        provider: 'real',
        apiKey: savedKey,
        baseUrl: 'https://example.test',
        modelName: 'deepseek-chat',
      },
    }))).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/https:\/\/api\.deepseek\.com/) })

    expect(await store.read()).toBeNull()
  })

  it('does not call a saved address other than the approved one in production', async () => {
    const store = createMemoryModelSettingsStore()
    await store.save({
      provider: 'real',
      apiKey: savedKey,
      baseUrl: 'https://example.test',
      modelName: 'deepseek-chat',
    })

    await expect(agentsForTurn(store, realEnv, { production: true })).rejects.toThrow(/https:\/\/api\.deepseek\.com/)
  })

  it('refuses to save a real model with a blank model name', async () => {
    const store = createMemoryModelSettingsStore()

    await expect(handleAdmin(ownerRequest({
      env: fakeEnv,
      store,
      body: {
        event: 'save',
        provider: 'real',
        apiKey: savedKey,
        baseUrl: 'https://api.deepseek.com',
        modelName: ' ',
      },
    }))).rejects.toMatchObject({ statusCode: 400 })

    expect(await store.read()).toBeNull()
  })

  it('falls back to the environment when nothing has been saved', async () => {
    const store = createMemoryModelSettingsStore()
    const viewed = await handleAdmin(ownerRequest({
      env: realEnv,
      store,
      body: { event: 'read' },
    }))

    expect(viewed.model).toEqual({
      provider: 'real',
      apiKeyMask: 'sk-…zz99',
      baseUrl: 'https://env.example',
      modelName: 'env-model',
      saved: false,
    })
    expect(JSON.stringify(viewed)).not.toContain(envKey)

    const calls: string[] = []
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init)
      const body = await request.json() as { stream?: boolean, messages?: unknown }
      calls.push(request.url)
      const instructions = JSON.stringify(body.messages ?? [])
      if (body.stream) return sse('From the environment.')
      const proposal = instructions.includes('You are Mai') ? null : { type: 'explain_concept', scope: 'getting_started' }
      return proposalReply(instructions, proposal)
    })

    const state = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'message', text: 'Where does the total live?' },
    }, createMemoryConversationStore({
      [signedInStudent]: 'An',
    }), await agentsForTurn(store, realEnv))

    expect(calls.every(url => url === 'https://env.example/chat/completions')).toBe(true)
    expect(state.conversation.find(message => message.author === 'teacher')?.text).toBe('From the environment.')

    const scripted = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'message', text: 'And the empty case?' },
    }, createMemoryConversationStore({
      [signedInStudent]: 'An',
    }), await agentsForTurn(store, fakeEnv))

    expect(scripted.conversation.find(message => message.author === 'teacher')?.text).toBe(fakeSentence)
  })

  it('shows the decision chain as verified or broken', async () => {
    const decisions = createMemoryDecisionLogStore()
    await decisions.append(loggedDecision())

    const verified = await handleAdmin(ownerRequest({ decisions }))
    expect(verified.chain).toBe('verified')
    expect(verified).not.toHaveProperty('brokenAt')
    expect(JSON.stringify(verified)).not.toContain('content_hash')
    expect(JSON.stringify(verified)).not.toContain('previous_hash')

    const broken = await handleAdmin(ownerRequest({
      decisions: {
        ...decisions,
        async chain() {
          return 'broken' as const
        },
      },
      body: { verdict: 'allow' },
    }))
    expect(broken.chain).toBe('broken')
    expect(broken.decisions.map(decision => decision.turnId)).toEqual(['turn-0'])
    expect(JSON.stringify(broken)).not.toContain('content_hash')
  })

  it('shows the administrator one decision per agent proposal', async () => {
    const decisions = createMemoryDecisionLogStore()
    const lesson = 'LISTS_LESSON_SHOULD_NOT_BE_LOGGED'
    await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'message', text: 'What are lists?' },
    }, createMemoryConversationStore({
      [signedInStudent]: 'An Nguyen',
    }), createFakeAgents(
      { proposal: { type: 'explain_concept', scope: 'lists_and_tuples' }, text: lesson },
      { proposal: { type: 'peer_question' }, text: 'wait, are we still on loops?' },
    ), { decisions })

    const viewed = await handleAdmin(ownerRequest({ decisions }))
    const teacher = viewed.decisions.find(decision => decision.agent === 'teacher')
    const deskmate = viewed.decisions.find(decision => decision.agent === 'deskmate')

    expect(viewed.decisions).toHaveLength(2)
    expect(teacher?.turnId).toMatch(/^[0-9a-f-]{36}$/)
    expect(teacher?.time).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(deskmate?.turnId).toBe(teacher?.turnId)
    expect(deskmate?.time).toBe(teacher?.time)
    expect(Object.keys(teacher ?? {}).sort()).toEqual(decisionFields)
    expect(teacher).toMatchObject({
      studentId: signedInStudent,
      agent: 'teacher',
      proposedMove: 'explain_concept',
      proposedScope: 'lists_and_tuples',
      verdict: 'downgrade',
      ruledMove: 'redirect_to_module',
      ruledScope: 'lists_and_tuples',
      ruleId: 'scope_requires_unlocked_module',
      reasonCode: 'MODULE_CLOSED',
      masteries: priorMasteries,
      unlockedModuleIds: ['getting_started'],
      verifyShieldOn: true,
      ruleChecks: [
        { ruleId: 'role_table', passed: true, reasonCode: 'ROLE_PERMITTED' },
        { ruleId: 'scope_in_course', passed: true, reasonCode: 'IN_COURSE' },
        { ruleId: 'scope_requires_unlocked_module', passed: false, reasonCode: 'MODULE_CLOSED' },
      ],
    })
    expect(deskmate).toMatchObject({
      studentId: signedInStudent,
      agent: 'deskmate',
      proposedMove: 'peer_question',
      proposedScope: null,
      verdict: 'allow',
      ruledMove: 'peer_question',
      ruledScope: null,
      ruleId: 'role_table',
      reasonCode: 'ROLE_PERMITTED',
      verifyShieldOn: true,
      ruleChecks: [
        { ruleId: 'role_table', passed: true, reasonCode: 'ROLE_PERMITTED' },
        { ruleId: 'all_rules', passed: true, reasonCode: 'ALL_RULES_PASSED' },
      ],
    })
    expect(JSON.stringify(viewed.decisions)).not.toContain(lesson)
    expect(JSON.stringify(viewed.decisions)).not.toContain('An Nguyen')
    expect(JSON.stringify(viewed.decisions)).not.toContain('What are lists?')
  })

  it('shows the newest hundred decisions first', async () => {
    const decisions = createMemoryDecisionLogStore()
    for (let index = 0; index < 101; index += 1) {
      await decisions.append(loggedDecision({
        time: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
        turnId: `turn-${index}`,
      }))
    }

    const viewed = await handleAdmin(ownerRequest({ decisions }))

    expect(viewed.decisions).toHaveLength(100)
    expect(viewed.decisions[0]?.turnId).toBe('turn-100')
    expect(viewed.decisions[99]?.turnId).toBe('turn-1')
    expect(viewed.decisions.map(decision => decision.turnId)).not.toContain('turn-0')
  })

  it('reads a decision recorded before rule checks with its rule checks absent', async () => {
    const decisions = createMemoryDecisionLogStore()
    await decisions.append(loggedDecision({ turnId: 'older' }))
    await decisions.append(loggedDecision({ turnId: 'off', time: '2026-01-02T00:00:00.000Z', verifyShieldOn: false, ruleChecks: [] }))

    const viewed = await handleAdmin(ownerRequest({ decisions }))

    expect(viewed.decisions.find(decision => decision.turnId === 'older')).not.toHaveProperty('ruleChecks')
    expect(viewed.decisions.find(decision => decision.turnId === 'off')?.ruleChecks).toEqual([])
  })

  it('reads back the addressed agent of each decision', async () => {
    const decisions = createMemoryDecisionLogStore()
    await decisions.append(loggedDecision({ turnId: 'to-mai', agent: 'deskmate', addressedAgent: 'deskmate' }))
    await decisions.append(loggedDecision({ turnId: 'to-nobody', time: '2026-01-02T00:00:00.000Z', addressedAgent: null }))

    const viewed = await handleAdmin(ownerRequest({ decisions }))

    expect(viewed.decisions.find(decision => decision.turnId === 'to-mai')?.addressedAgent).toBe('deskmate')
    expect(viewed.decisions.find(decision => decision.turnId === 'to-nobody')?.addressedAgent).toBeNull()
  })

  it('filters decisions by verdict and by student', async () => {
    const decisions = createMemoryDecisionLogStore()
    const otherStudent = '6f1b0c1e-2222-4222-8222-222222222222'
    await decisions.append(loggedDecision({
      turnId: 'an-allow',
      verdict: 'allow',
      time: '2026-01-01T00:00:01.000Z',
    }))
    await decisions.append(loggedDecision({
      turnId: 'an-block',
      verdict: 'block',
      ruledMove: null,
      ruledScope: null,
      reasonCode: 'ROLE_FORBIDDEN',
      time: '2026-01-01T00:00:02.000Z',
    }))
    await decisions.append(loggedDecision({
      turnId: 'other-block',
      studentId: otherStudent,
      verdict: 'block',
      ruledMove: null,
      ruledScope: null,
      reasonCode: 'ROLE_FORBIDDEN',
      time: '2026-01-01T00:00:03.000Z',
    }))
    await decisions.append(loggedDecision({
      turnId: 'an-downgrade',
      verdict: 'downgrade',
      time: '2026-01-01T00:00:04.000Z',
    }))
    for (let index = 0; index < 100; index += 1) {
      await decisions.append(loggedDecision({
        turnId: `later-allow-${index}`,
        verdict: 'allow',
        time: new Date(Date.UTC(2026, 0, 2, 0, 0, index)).toISOString(),
      }))
    }

    const byVerdict = await handleAdmin(ownerRequest({
      decisions,
      body: { event: 'read', verdict: 'block' },
    }))
    const byStudent = await handleAdmin(ownerRequest({
      decisions,
      body: { event: 'read', studentId: signedInStudent, verdict: '' },
    }))
    const byBoth = await handleAdmin(ownerRequest({
      decisions,
      body: { event: 'read', verdict: 'block', studentId: otherStudent },
    }))

    expect(byVerdict.decisions.map(decision => decision.turnId)).toEqual(['other-block', 'an-block'])
    expect(byStudent.decisions.map(decision => decision.turnId)).not.toContain('other-block')
    expect(byStudent.decisions).toHaveLength(100)
    expect(byStudent.decisions[0]?.turnId).toBe('later-allow-99')
    expect(byBoth.decisions.map(decision => decision.turnId)).toEqual(['other-block'])
  })

  it('switches the VerifyShield off and the next turn allows the proposed move', async () => {
    const verifyShieldStore = createMemoryVerifyShieldStore()
    const decisions = createMemoryDecisionLogStore()
    const answer = 'A list keeps items in order.'

    const before = await handleAdmin(ownerRequest({
      decisions,
      verifyShield: verifyShieldStore,
      verifyShieldEnv: 'on',
    }))
    expect(before.verifyShieldOn).toBe(true)

    const switched = await handleAdmin(ownerRequest({
      decisions,
      verifyShield: verifyShieldStore,
      verifyShieldEnv: 'on',
      body: { event: 'verifyShield', enabled: false },
    }))
    expect(switched.verifyShieldOn).toBe(false)

    await expect(handleAdmin(ownerRequest({
      email: 'an@example.com',
      verifyShield: verifyShieldStore,
      body: { event: 'verifyShield', enabled: true },
    }))).rejects.toMatchObject({ statusCode: 403 })
    expect(await verifyShieldStore.read()).toBe(false)

    const state = await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'message', text: 'What are lists?' },
    }, createMemoryConversationStore({
      [signedInStudent]: 'An Nguyen',
    }), createFakeAgents({
      proposal: { type: 'explain_concept', scope: 'lists_and_tuples' },
      text: answer,
    }), {
      verifyShieldOn: await verifyShieldForTurn(verifyShieldStore, 'on'),
      decisions,
    })

    expect(state.conversation.find(message => message.author === 'teacher')?.text).toBe(answer)
    const viewed = await handleAdmin(ownerRequest({
      decisions,
      verifyShield: verifyShieldStore,
      verifyShieldEnv: 'on',
    }))
    expect(viewed.verifyShieldOn).toBe(false)
    expect(viewed.decisions).toHaveLength(1)
    expect(viewed.decisions[0]).toMatchObject({
      verdict: 'allow',
      ruleId: 'verify_shield',
      reasonCode: 'VERIFYSHIELD_OFF',
      verifyShieldOn: false,
      proposedScope: 'lists_and_tuples',
    })
    expect(JSON.stringify(viewed.decisions)).not.toContain(answer)
    expect(JSON.stringify(viewed.decisions)).not.toContain('An Nguyen')
  })

  it('writes the shared VerifyShield setting once per switch event', async () => {
    const inner = createMemoryVerifyShieldStore()
    const save = vi.fn(async (enabled: boolean) => inner.save(enabled))
    const verifyShield = { read: () => inner.read(), save }

    const switched = await handleAdmin(ownerRequest({
      verifyShield,
      verifyShieldEnv: 'on',
      body: { event: 'verifyShield', enabled: false },
    }))

    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith(false)
    expect(switched.verifyShieldOn).toBe(false)

    const read = await handleAdmin(ownerRequest({ verifyShield, verifyShieldEnv: 'on' }))
    expect(read.verifyShieldOn).toBe(false)
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('refuses a student the decision log', async () => {
    const decisions = createMemoryDecisionLogStore()
    await decisions.append(loggedDecision({ turnId: 'kept' }))

    await expect(handleAdmin(ownerRequest({
      email: 'an@example.com',
      decisions,
      body: { event: 'read', verdict: 'allow', studentId: signedInStudent },
    }))).rejects.toMatchObject({ statusCode: 403 })

    const viewed = await handleAdmin(ownerRequest({ decisions }))
    expect(viewed.decisions.map(decision => decision.turnId)).toEqual(['kept'])
  })

  it('does not log a turn that has no agent proposal', async () => {
    const decisions = createMemoryDecisionLogStore()
    await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'open' },
    }, createMemoryConversationStore({
      [signedInStudent]: 'An Nguyen',
    }), undefined, { decisions })

    const viewed = await handleAdmin(ownerRequest({ decisions }))
    expect(viewed.decisions).toEqual([])
  })

  it('does not log the code from a submission', async () => {
    const decisions = createMemoryDecisionLogStore()
    await handleTurn({
      sessionStudentId: signedInStudent,
      body: {
        event: 'submission',
        code: 'print("STUDENT_CODE_SHOULD_NOT_BE_LOGGED")\n',
        results: [{ name: 'adds the numbers', passed: false, expected: '6', actual: '0' }],
      },
    }, createMemoryConversationStore({
      [signedInStudent]: 'An Nguyen',
    }), createFakeAgents({
      proposal: { type: 'explain_concept', scope: 'getting_started' },
      text: 'Look at where the total is created.',
    }), {
      decisions,
      sandbox: createFakeSandbox({
        outcome: 'checked',
        results: [{ name: 'adds the numbers', passed: false, expected: '6', actual: '0' }],
      }),
    })

    const viewed = await handleAdmin(ownerRequest({ decisions }))
    expect(viewed.decisions).toHaveLength(1)
    expect(JSON.stringify(viewed.decisions)).not.toContain('STUDENT_CODE_SHOULD_NOT_BE_LOGGED')
    expect(JSON.stringify(viewed.decisions)).not.toContain('An Nguyen')
  })

  it('logs the opening proposal and the introduction that is spoken', async () => {
    const decisions = createMemoryDecisionLogStore()
    await handleTurn({
      sessionStudentId: signedInStudent,
      body: { event: 'open' },
    }, createMemoryConversationStore({
      [signedInStudent]: 'An Nguyen',
    }), createFakeAgents({
      proposal: { type: 'stay_and_practise' },
      text: 'A running total survives every pass of the loop.',
    }), { decisions })

    const viewed = await handleAdmin(ownerRequest({ decisions }))

    expect(viewed.decisions.map(decision => decision.turnId)).toEqual([
      viewed.decisions[0]?.turnId,
      viewed.decisions[0]?.turnId,
    ])
    expect(viewed.decisions.map(decision => ({
      agent: decision.agent,
      proposedMove: decision.proposedMove,
      verdict: decision.verdict,
      ruledMove: decision.ruledMove,
    }))).toEqual([
      { agent: 'teacher', proposedMove: 'explain_concept', verdict: 'allow', ruledMove: 'explain_concept' },
      { agent: 'teacher', proposedMove: 'stay_and_practise', verdict: 'allow', ruledMove: 'stay_and_practise' },
    ])
    expect(JSON.stringify(viewed.decisions)).not.toContain('An Nguyen')
  })
})

describe('admin student numbers', () => {
  const an = {
    id: signedInStudent,
    displayName: 'An',
    studentNumber: 'SWB0001',
    email: 'an@example.com',
    campus: 'Hanoi' as const,
  }
  const binh = {
    id: '6f1b0c1e-2222-4222-8222-222222222222',
    displayName: 'Bình',
    studentNumber: 'SWB0002',
    email: 'binh@example.com',
    campus: null,
  }

  it('lists every student for the administrator', async () => {
    const students = createMemoryStudentDirectoryStore([an, binh])

    const viewed = await handleAdmin(ownerRequest({ students, body: { event: 'students' } }))

    expect(viewed.students).toEqual([an, binh])
  })

  it('reads the directory only when the request asks for it', async () => {
    const decisions = createMemoryDecisionLogStore()
    await decisions.append(loggedDecision({ turnId: 'read-back' }))
    const students = {
      list: async (): Promise<never> => {
        throw new Error('The directory should not be read')
      },
      changeNumber: async (): Promise<never> => {
        throw new Error('The directory should not be written')
      },
      changeCampus: async (): Promise<never> => {
        throw new Error('The directory should not be written')
      },
    }

    const viewed = await handleAdmin(ownerRequest({ decisions, students, body: { event: 'read' } }))

    expect(viewed.students).toEqual([])
    expect(viewed.decisions.map(decision => decision.turnId)).toEqual(['read-back'])
  })

  it('changes a number and records who changed it, from what and to what', async () => {
    const students = createMemoryStudentDirectoryStore([an, binh])

    const changed = await handleAdmin(ownerRequest({
      students,
      body: { event: 'studentNumber', studentId: an.id, studentNumber: 'SWB9001' },
    }))

    expect(changed.students).toContainEqual({ ...an, studentNumber: 'SWB9001' })
    expect(students.changes).toEqual([{
      studentId: an.id,
      oldNumber: 'SWB0001',
      newNumber: 'SWB9001',
      actorEmail: owner,
    }])
  })

  it.each(['SWB001', 'swb0001', 'SWB0001x', '', '  '])(
    'refuses the number "%s" before touching the directory',
    async (studentNumber) => {
      const students = createMemoryStudentDirectoryStore([an])

      await expect(handleAdmin(ownerRequest({
        students,
        body: { event: 'studentNumber', studentId: an.id, studentNumber },
      }))).rejects.toMatchObject({ statusCode: 400 })

      expect(students.changes).toEqual([])
      expect((await students.list())[0]?.studentNumber).toBe('SWB0001')
    },
  )

  it('refuses a number another student already has', async () => {
    const students = createMemoryStudentDirectoryStore([an, binh])

    await expect(handleAdmin(ownerRequest({
      students,
      body: { event: 'studentNumber', studentId: an.id, studentNumber: binh.studentNumber },
    }))).rejects.toMatchObject({ statusCode: 400 })

    expect(students.changes).toEqual([])
  })

  it('refuses a number a student had before, so a number is never given out twice', async () => {
    const students = createMemoryStudentDirectoryStore([an, binh])
    await handleAdmin(ownerRequest({
      students,
      body: { event: 'studentNumber', studentId: an.id, studentNumber: 'SWB9001' },
    }))

    await expect(handleAdmin(ownerRequest({
      students,
      body: { event: 'studentNumber', studentId: binh.id, studentNumber: 'SWB0001' },
    }))).rejects.toMatchObject({ statusCode: 400 })

    expect((await students.list()).find(student => student.id === binh.id)?.studentNumber).toBe('SWB0002')
  })

  it('refuses a student the directory does not have', async () => {
    const students = createMemoryStudentDirectoryStore([an])

    await expect(handleAdmin(ownerRequest({
      students,
      body: { event: 'studentNumber', studentId: '6f1b0c1e-3333-4333-8333-333333333333', studentNumber: 'SWB9001' },
    }))).rejects.toMatchObject({ statusCode: 404 })
  })

  it.each([
    { email: 'an@example.com', name: 'student' },
    { email: lecturerAccount.email, name: 'lecturer' },
  ])('refuses a $name and leaves the numbers alone', async ({ email }) => {
    const students = createMemoryStudentDirectoryStore([an])

    await expect(handleAdmin(ownerRequest({
      email,
      students,
      body: { event: 'studentNumber', studentId: an.id, studentNumber: 'SWB9001' },
    }))).rejects.toMatchObject({ statusCode: 403 })

    expect(students.changes).toEqual([])
  })
})

describe('admin connection test', () => {
  const form = {
    event: 'testConnection',
    provider: 'real',
    apiKey: savedKey,
    baseUrl: 'https://api.deepseek.com',
    modelName: 'deepseek-chat',
  }

  // A provider that answers the two questions in order and keeps the headers the calls were sent
  // with. A string is the words the model wrote; `{ toolCall }` is a call of the proposal tool.
  function scriptedConnection(replies: (string | { toolCall: string } | Response)[]): { authorities: string[] } {
    const authorities: string[] = []
    let calls = 0
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init)
      authorities.push(request.headers.get('authorization') ?? '')
      const reply = replies[calls++]
      if (reply === undefined) throw new Error('No scripted reply left.')
      if (reply instanceof Response) return reply
      if (typeof reply === 'string') {
        return Response.json({ choices: [{ message: { role: 'assistant', content: reply }, finish_reason: 'stop' }] })
      }
      return Response.json({
        choices: [{
          message: { role: 'assistant', content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'propose', arguments: reply.toolCall } }] },
          finish_reason: 'tool_calls',
        }],
      })
    })
    return { authorities }
  }

  it('answers the administrator both checks, and saves nothing', async () => {
    const store = createMemoryModelSettingsStore()
    scriptedConnection(['Counted in a loop.', { toolCall: '{"proposal": "checked"}' }])

    const report = await handleConnectionTest(ownerRequest({ store, body: form }))

    expect(report.reply.ok).toBe(true)
    expect(report.toolCall.ok).toBe(true)
    expect(await store.read()).toBeNull()
  })

  it('tests the settings on the form, not the ones already saved', async () => {
    const store = createMemoryModelSettingsStore()
    await store.save({ provider: 'real', apiKey: 'sk-already-saved-0000', baseUrl: 'https://saved.example', modelName: 'saved-model' })
    const provider = scriptedConnection(['Counted in a loop.', { toolCall: '{"proposal": "checked"}' }])

    await handleConnectionTest(ownerRequest({ store, body: form }))

    expect(provider.authorities).toEqual([`Bearer ${savedKey}`, `Bearer ${savedKey}`])
    expect(await store.read()).toMatchObject({ apiKey: 'sk-already-saved-0000' })
  })

  it('keeps the key in effect when the form leaves the field blank', async () => {
    const store = createMemoryModelSettingsStore()
    await store.save({ provider: 'real', apiKey: savedKey, baseUrl: 'https://api.deepseek.com', modelName: 'deepseek-chat' })
    const provider = scriptedConnection(['Counted in a loop.', { toolCall: '{"proposal": "checked"}' }])

    await handleConnectionTest(ownerRequest({ store, body: { ...form, apiKey: '  ' } }))

    expect(provider.authorities).toEqual([`Bearer ${savedKey}`, `Bearer ${savedKey}`])
  })

  it('reports a failing key on both answers, and never the key itself', async () => {
    const store = createMemoryModelSettingsStore()
    const refused = () => Response.json({ error: { message: `Invalid API key ${savedKey}` } }, { status: 401 })
    scriptedConnection([refused(), refused()])

    const report = await handleConnectionTest(ownerRequest({ store, body: form }))

    expect(report.reply).toEqual({ ok: false, ms: report.reply.ms, error: 'Invalid API key …' })
    expect(report.toolCall.ok).toBe(false)
    expect(JSON.stringify(report)).not.toContain(savedKey)
    expect(await store.read()).toBeNull()
  })

  it('reports a model that answers in words instead of calling the tool', async () => {
    const store = createMemoryModelSettingsStore()
    scriptedConnection(['Counted in a loop.', 'I would explain the loop.'])

    const report = await handleConnectionTest(ownerRequest({ store, body: form }))

    expect(report.reply.ok).toBe(true)
    expect(report.toolCall.ok).toBe(false)
    expect(report.toolCall.error).toContain('tool call')
  })

  it('refuses anyone but the administrator before calling the provider', async () => {
    const store = createMemoryModelSettingsStore()
    const provider = scriptedConnection(['Counted in a loop.', { toolCall: '{"proposal": "checked"}' }])

    await expect(handleConnectionTest(ownerRequest({ email: 'an@example.com', store, body: form })))
      .rejects.toMatchObject({ statusCode: 403 })
    await expect(handleConnectionTest(ownerRequest({ email: null, store, body: form })))
      .rejects.toMatchObject({ statusCode: 401 })
    expect(provider.authorities).toEqual([])
  })

  it.each([
    { body: { event: 'testConnection', provider: 'fake' }, message: 'nothing to test' },
    { body: { event: 'testConnection', provider: 'real', apiKey: savedKey, baseUrl: '', modelName: 'deepseek-chat' }, message: 'base URL is blank' },
    { body: { event: 'testConnection', provider: 'real', apiKey: savedKey, baseUrl: 'https://api.deepseek.com', modelName: ' ' }, message: 'model name is blank' },
    { body: { event: 'testConnection' }, message: 'The model provider is missing.' },
  ])('refuses $message before calling the provider', async ({ body, message }) => {
    const store = createMemoryModelSettingsStore()
    const provider = scriptedConnection(['Counted in a loop.', { toolCall: '{"proposal": "checked"}' }])

    await expect(handleConnectionTest(ownerRequest({ store, body })))
      .rejects.toMatchObject({ statusCode: 400, message: new RegExp(message) })
    expect(provider.authorities).toEqual([])
    expect(await store.read()).toBeNull()
  })

  it('routes the event by itself, so the page does not pay for a decision read', () => {
    expect(isConnectionTest({ event: 'testConnection' })).toBe(true)
    expect(isConnectionTest({ event: 'save', provider: 'real' })).toBe(false)
    expect(isConnectionTest({ event: 'read' })).toBe(false)
    expect(isConnectionTest(null)).toBe(false)
  })
})

const decisionFields = [
  'addressedAgent',
  'agent',
  'learningPattern',
  'masteries',
  'masteryThreshold',
  'moduleId',
  'outcome',
  'proposedMove',
  'proposedScope',
  'reasonCode',
  'ruleChecks',
  'ruleId',
  'ruledMove',
  'ruledScope',
  'studentId',
  'time',
  'toolTrace',
  'turnId',
  'unlockedModuleIds',
  'verdict',
  'verifyShieldOn',
]

function loggedDecision(overrides: Partial<DecisionRecord> = {}): DecisionRecord {
  return {
    time: '2026-01-01T00:00:00.000Z',
    studentId: signedInStudent,
    turnId: 'turn-0',
    agent: 'teacher',
    proposedMove: 'explain_concept',
    proposedScope: 'loops',
    outcome: 'ruled',
    verdict: 'allow',
    ruledMove: 'explain_concept',
    ruledScope: 'loops',
    ruleId: 'role_table',
    reasonCode: 'ROLE_PERMITTED',
    masteries: priorMasteries,
    unlockedModuleIds: ['getting_started', 'variables', 'strings', 'conditionals', 'loops'],
    verifyShieldOn: true,
    masteryThreshold: 0.9,
    ...overrides,
  }
}

// Every module sits at the Bayesian Knowledge Tracing prior until a submission
// gives the estimate something to read.
const priorMasteries = [
  { moduleId: 'getting_started', mastery: 0.1 },
  { moduleId: 'variables', mastery: 0.1 },
  { moduleId: 'strings', mastery: 0.1 },
  { moduleId: 'conditionals', mastery: 0.1 },
  { moduleId: 'loops', mastery: 0.1 },
  { moduleId: 'lists_and_tuples', mastery: 0.1 },
  { moduleId: 'dictionaries_and_sets', mastery: 0.1 },
  { moduleId: 'functions', mastery: 0.1 },
  { moduleId: 'modules_and_library', mastery: 0.1 },
  { moduleId: 'file_handling', mastery: 0.1 },
  { moduleId: 'error_handling', mastery: 0.1 },
]

function sse(text: string): Response {
  const chunks = [
    { choices: [{ delta: { content: text }, finish_reason: null }] },
    { choices: [{ delta: {}, finish_reason: 'stop' }] },
  ]
  const payload = chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n'
  return new Response(payload, {
    headers: { 'content-type': 'text/event-stream' },
  })
}

describe('admin campus', () => {
  const an = {
    id: signedInStudent,
    displayName: 'An',
    studentNumber: 'SWB0001',
    email: 'an@example.com',
    campus: 'Hanoi' as const,
  }
  const binh = {
    id: '6f1b0c1e-2222-4222-8222-222222222222',
    displayName: 'Bình',
    studentNumber: 'SWB0002',
    email: 'binh@example.com',
    campus: null,
  }

  it('lists every student with their campus', async () => {
    const students = createMemoryStudentDirectoryStore([an, binh])
    const viewed = await handleAdmin(ownerRequest({ students, body: { event: 'students' } }))
    expect(viewed.students.map(student => student.campus)).toEqual(['Hanoi', null])
  })

  it('changes a campus and records who, from what and to what', async () => {
    const students = createMemoryStudentDirectoryStore([an, binh])

    const changed = await handleAdmin(ownerRequest({
      students,
      body: { event: 'campus', studentId: an.id, campus: 'Da Nang' },
    }))

    expect(changed.students).toContainEqual({ ...an, campus: 'Da Nang' })
    expect(students.campusChanges).toEqual([{ studentId: an.id, oldCampus: 'Hanoi', newCampus: 'Da Nang', actorEmail: owner }])
  })

  it('lets the owner give a campus to a student who has none', async () => {
    const students = createMemoryStudentDirectoryStore([an, binh])
    await handleAdmin(ownerRequest({ students, body: { event: 'campus', studentId: binh.id, campus: 'Can Tho' } }))
    expect(students.campusChanges).toEqual([{ studentId: binh.id, oldCampus: null, newCampus: 'Can Tho', actorEmail: owner }])
  })

  it('records nothing when the campus is already that one', async () => {
    const students = createMemoryStudentDirectoryStore([an, binh])
    await handleAdmin(ownerRequest({ students, body: { event: 'campus', studentId: an.id, campus: 'Hanoi' } }))
    expect(students.campusChanges).toEqual([])
  })

  it('refuses a campus that is not one of the four, and an unknown student', async () => {
    const students = createMemoryStudentDirectoryStore([an, binh])
    await expect(handleAdmin(ownerRequest({ students, body: { event: 'campus', studentId: an.id, campus: 'Mars' } })))
      .rejects.toMatchObject({ statusCode: 400, message: 'Choose Hanoi, Da Nang, Ho Chi Minh City or Can Tho.' })
    await expect(handleAdmin(ownerRequest({
      students,
      body: { event: 'campus', studentId: '6f1b0c1e-3333-4333-8333-333333333333', campus: 'Hanoi' },
    }))).rejects.toMatchObject({ statusCode: 404 })
    expect(students.campusChanges).toEqual([])
  })

  it('refuses anyone but the administrator', async () => {
    const students = createMemoryStudentDirectoryStore([an, binh])
    await expect(handleAdmin(ownerRequest({
      email: 'an@example.com',
      students,
      body: { event: 'campus', studentId: an.id, campus: 'Da Nang' },
    }))).rejects.toMatchObject({ statusCode: 403 })
    expect(students.campusChanges).toEqual([])
  })
})

describe('admin deletes a student', () => {
  const an = {
    id: signedInStudent,
    displayName: 'An',
    studentNumber: 'SWB0001',
    email: 'an@example.com',
    campus: 'Hanoi' as const,
  }
  const binh = {
    id: '6f1b0c1e-2222-4222-8222-222222222222',
    displayName: 'Bình',
    studentNumber: 'SWB0002',
    email: 'binh@example.com',
    campus: null,
  }

  it('deletes one student and answers with the students who remain', async () => {
    const students = createMemoryStudentDirectoryStore([an, binh])

    const deleted = await handleAdmin(ownerRequest({ students, body: { event: 'deleteStudent', studentId: an.id } }))

    expect(deleted.students).toEqual([binh])
    expect(students.deleted).toEqual([an.id])
  })

  it('refuses an unknown student, a missing student and anyone but the administrator', async () => {
    const students = createMemoryStudentDirectoryStore([an, binh])
    await expect(handleAdmin(ownerRequest({
      students,
      body: { event: 'deleteStudent', studentId: '6f1b0c1e-3333-4333-8333-333333333333' },
    }))).rejects.toMatchObject({ statusCode: 404 })
    await expect(handleAdmin(ownerRequest({ students, body: { event: 'deleteStudent' } })))
      .rejects.toMatchObject({ statusCode: 400, message: 'The student is missing.' })
    await expect(handleAdmin(ownerRequest({
      email: 'an@example.com',
      students,
      body: { event: 'deleteStudent', studentId: an.id },
    }))).rejects.toMatchObject({ statusCode: 403 })
    expect(students.deleted).toEqual([])
    expect(await students.list()).toHaveLength(2)
  })
})

// The Teacher proposes by tool call and Mai as JSON in the text, as the real agents ask.
function proposalReply(instructions: string, proposal: unknown): Response {
  const message = instructions.includes('You are the Teacher')
    ? { role: 'assistant', content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'propose', arguments: JSON.stringify({ proposal }) } }] }
    : { role: 'assistant', content: JSON.stringify({ proposal }) }
  return Response.json({
    id: 'chatcmpl-test',
    choices: [{ message, finish_reason: 'tool_calls' in message ? 'tool_calls' : 'stop' }],
  })
}
