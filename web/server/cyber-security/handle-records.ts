import type { CyberTestRecordDetail, CyberTestRecordListItem } from '../../shared/injection-suite'
import { securitySummary } from '../../shared/injection-suite'
import { requireProductOwner } from '../admin/handle-admin'
import type { CyberTestRecordStore } from '../storage/cyber-test-record-store'

export class CyberTestRecordNotFoundError extends Error {
  readonly statusCode = 404

  constructor() {
    super('Cyber test record not found')
    this.name = 'CyberTestRecordNotFoundError'
  }
}

export interface CyberTestRecordsRequest {
  email: string | null
  adminEmails: string
  store: CyberTestRecordStore
}

export async function handleRecordsRequest(request: CyberTestRecordsRequest): Promise<{ records: CyberTestRecordListItem[] }> {
  requireProductOwner(request)
  return { records: await request.store.list() }
}

export async function handleRecordRequest(request: CyberTestRecordsRequest, id: number): Promise<CyberTestRecordDetail> {
  requireProductOwner(request)
  if (!isRecordId(id)) throw new CyberTestRecordNotFoundError()
  const stored = await request.store.read(id)
  if (!stored) throw new CyberTestRecordNotFoundError()
  const summary = securitySummary(
    stored.cases,
    stored.totalCases,
    stored.model,
    stored.startedAt,
    stored.startedAt + stored.durationMs,
  )
  return { ...stored, categories: summary.categories }
}

export async function handleDeleteRecordRequest(request: CyberTestRecordsRequest, id: number): Promise<{ deleted: true }> {
  requireProductOwner(request)
  if (!isRecordId(id)) throw new CyberTestRecordNotFoundError()
  if (!(await request.store.remove(id))) throw new CyberTestRecordNotFoundError()
  return { deleted: true }
}

// The route hands over the raw path segment. Number('0x10') and Number('1e3')
// would turn a malformed address into a real id, so only digits are accepted.
export function parseRecordId(segment: string | undefined): number {
  return segment !== undefined && /^\d+$/.test(segment) ? Number(segment) : Number.NaN
}

function isRecordId(id: number): boolean {
  return Number.isInteger(id) && id > 0
}
