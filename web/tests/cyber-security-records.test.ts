import { describe, expect, it, vi } from 'vitest'
import type {
  CyberTestRecordDetail,
  CyberTestRecordListItem,
  InjectionCaseEvent,
  InjectionCategoryId,
} from '../shared/injection-suite'
import { productOwnerAccount } from '../server/auth/demo-accounts'
import { ProductOwnerRequiredError, SignInRequiredError } from '../server/admin/handle-admin'
import {
  CyberTestRecordNotFoundError,
  handleDeleteRecordRequest,
  handleRecordRequest,
  handleRecordsRequest,
  parseRecordId,
} from '../server/cyber-security'
import {
  createMemoryCyberTestRecordStore,
  type CyberTestRecord,
  type CyberTestRecordStore,
} from '../server/storage/cyber-test-record-store'

const adminEmails = 'assistant@example.com, owner@example.com'

function caseEvent(category: InjectionCategoryId, verdict: 'pass' | 'leak', number: number): InjectionCaseEvent {
  return {
    type: 'case',
    id: `${category}-${String(number).padStart(2, '0')}`,
    category,
    agent: 'teacher',
    prompt: `Probe ${number}`,
    verdict,
    leakedFragment: verdict === 'leak' ? 'the hidden solution' : null,
    replyExcerpt: verdict === 'leak' ? 'Here it is: the hidden solution' : '',
    priorTurns: 0,
  }
}

function record(overrides: Partial<CyberTestRecord> = {}): CyberTestRecord {
  return {
    startedAt: 1_700_000_000_000,
    durationMs: 4_200,
    provider: 'fake',
    model: 'Fake model',
    verifyShieldOn: true,
    stopped: 'complete',
    suiteVersion: 1,
    totalCases: 3,
    finishedCases: 2,
    passed: 1,
    leaked: 1,
    score: 0.5,
    cases: [
      caseEvent('answer_extraction', 'leak', 1),
      caseEvent('answer_extraction', 'pass', 2),
    ],
    ...overrides,
  }
}

function owner(store: CyberTestRecordStore) {
  return { email: productOwnerAccount.email, adminEmails, store }
}

async function seeded() {
  const store = createMemoryCyberTestRecordStore()
  // The later row starts earlier in the run's own clock: the list follows the
  // order the records arrived, not the run times they carry.
  await store.record(record({ startedAt: 1_700_000_100_000 }))
  await store.record(record({ startedAt: 1_700_000_000_000, model: 'deepseek-chat', provider: 'real' }))
  return store
}

describe('Cyber test records for the product owner', () => {
  it('lists records newest first with every list fact and no case results', async () => {
    const store = await seeded()

    const { records }: { records: CyberTestRecordListItem[] } = await handleRecordsRequest(owner(store))

    expect(records).toHaveLength(2)
    expect(records[0]).toMatchObject({
      id: 2,
      startedAt: 1_700_000_000_000,
      provider: 'real',
      model: 'deepseek-chat',
      finishedCases: 2,
      passed: 1,
      leaked: 1,
      score: 0.5,
    })
    expect(records[1]!.id).toBe(1)
    for (const line of records) expect('cases' in line).toBe(false)
  })

  it('returns the full record and the per-family tally derived from its cases', async () => {
    const store = createMemoryCyberTestRecordStore()
    await store.record(record())

    const detail: CyberTestRecordDetail = await handleRecordRequest(owner(store), 1)

    expect(detail.id).toBe(1)
    expect(detail.cases).toEqual([caseEvent('answer_extraction', 'leak', 1), caseEvent('answer_extraction', 'pass', 2)])
    expect(detail.categories).toEqual({ answer_extraction: { passed: 1, leaked: 1 } })
    expect(detail.totalCases).toBe(3)
    expect(detail.score).toBe(0.5)
  })

  it('deletes a record and reports an unknown id as not found', async () => {
    const store = await seeded()

    await expect(handleDeleteRecordRequest(owner(store), 2)).resolves.toEqual({ deleted: true })

    const { records } = await handleRecordsRequest(owner(store))
    expect(records.map(line => line.id)).toEqual([1])
    await expect(handleRecordRequest(owner(store), 2)).rejects.toBeInstanceOf(CyberTestRecordNotFoundError)
  })

  it('treats an unknown or malformed id as not found, and a malformed id never reaches the store', async () => {
    const store = await seeded()
    const read = vi.spyOn(store, 'read')
    const remove = vi.spyOn(store, 'remove')

    await expect(handleRecordRequest(owner(store), 99)).rejects.toBeInstanceOf(CyberTestRecordNotFoundError)
    await expect(handleDeleteRecordRequest(owner(store), 99)).rejects.toBeInstanceOf(CyberTestRecordNotFoundError)
    expect(read).toHaveBeenCalledTimes(1)
    expect(read).toHaveBeenCalledWith(99)
    expect(remove).toHaveBeenCalledTimes(1)
    expect(remove).toHaveBeenCalledWith(99)

    read.mockClear()
    remove.mockClear()
    for (const id of [0, -1, 1.5, Number.NaN]) {
      await expect(handleRecordRequest(owner(store), id)).rejects.toBeInstanceOf(CyberTestRecordNotFoundError)
      await expect(handleDeleteRecordRequest(owner(store), id)).rejects.toBeInstanceOf(CyberTestRecordNotFoundError)
    }
    expect(read).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
  })

  it('refuses a caller who is not the product owner before any store call', async () => {
    const memory = createMemoryCyberTestRecordStore()
    const store: CyberTestRecordStore = memory
    const list = vi.spyOn(store, 'list')
    const read = vi.spyOn(store, 'read')
    const remove = vi.spyOn(store, 'remove')

    await expect(handleRecordsRequest({ email: null, adminEmails, store })).rejects.toBeInstanceOf(SignInRequiredError)
    await expect(handleRecordRequest({ email: null, adminEmails, store }, 1)).rejects.toBeInstanceOf(SignInRequiredError)
    await expect(handleDeleteRecordRequest({ email: null, adminEmails, store }, 1)).rejects.toBeInstanceOf(SignInRequiredError)

    for (const email of ['an@example.com', 'lecturer@example.com']) {
      await expect(handleRecordsRequest({ email, adminEmails, store })).rejects.toBeInstanceOf(ProductOwnerRequiredError)
      await expect(handleRecordRequest({ email, adminEmails, store }, 1)).rejects.toBeInstanceOf(ProductOwnerRequiredError)
      await expect(handleDeleteRecordRequest({ email, adminEmails, store }, 1)).rejects.toBeInstanceOf(ProductOwnerRequiredError)
    }

    expect(list).not.toHaveBeenCalled()
    expect(read).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
  })

  it('reads an id only from a digits-only path segment', () => {
    expect(parseRecordId('12')).toBe(12)
    expect(parseRecordId('007')).toBe(7)
    for (const segment of [undefined, '', '0x10', '1e3', '12.0', '-1', ' 1']) {
      expect(Number.isNaN(parseRecordId(segment))).toBe(true)
    }
  })
})
