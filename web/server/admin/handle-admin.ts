import { modelAddressLocked, resolveModelChoice, testConnection, UnusableSettingsError, type ConnectionReport, type ModelSettings } from '../language-model'
import type { DecisionChain, DecisionLogStore, DecisionQuery, DecisionRecord } from '../storage/decision-log'
import type { ModelSettingsStore } from '../storage/model-settings-store'
import type { StaffAccessLog } from '../storage/staff-access-log'
import type { AdminStudent, StudentDirectoryStore } from '../storage/student-directory'
import type { StaffAccessEntry } from '../../shared/staff-review'
import { verifyShieldEnabled, type VerifyShieldStore } from '../verify-shield'
import { campusRule, isCampus, type Campus } from '../../shared/campus'
import { isStudentNumber, studentNumberRule } from '../../shared/student-number'

export class SignInRequiredError extends Error {
  readonly statusCode = 401

  constructor() {
    super('Sign in required')
    this.name = 'SignInRequiredError'
  }
}

export class ProductOwnerRequiredError extends Error {
  readonly statusCode = 403

  constructor() {
    super('Administrator access required')
    this.name = 'ProductOwnerRequiredError'
  }
}

export class ModelSettingsError extends Error {
  readonly statusCode = 400

  constructor(message: string) {
    super(message)
    this.name = 'ModelSettingsError'
  }
}

export class AdminRequestError extends Error {
  readonly statusCode = 400

  constructor(message: string) {
    super(message)
    this.name = 'AdminRequestError'
  }
}

export class AdminNotFoundError extends Error {
  readonly statusCode = 404

  constructor() {
    super('Student not found')
    this.name = 'AdminNotFoundError'
  }
}

export interface AdminModelView {
  provider: 'real' | 'fake'
  apiKeyMask: string
  baseUrl: string
  modelName: string
  saved: boolean
}

export interface AdminRequest {
  email: string | null
  adminEmails: string
  env: ModelSettings
  store: ModelSettingsStore
  decisions?: DecisionLogStore
  verifyShield?: VerifyShieldStore
  verifyShieldEnv?: string
  students?: StudentDirectoryStore
  // Who opened which student's records. Only an administrator reads it (ADR 0009).
  accessLog?: StaffAccessLog
  // Set by tests. A production server leaves it unset and the address stays locked.
  production?: boolean
  body: unknown
}

export interface AdminResponse {
  model: AdminModelView
  verifyShieldOn: boolean
  decisions: DecisionRecord[]
  // The hash chain, and only whether it still holds. The broken row stays in the database command.
  chain: DecisionChain
  students: AdminStudent[]
  // The newest staff openings of a student's records; only the access log page asks for them.
  staffAccess: StaffAccessEntry[]
}

// The answer to a role check: reaching it at all means the caller is an administrator.
export interface AdminRoleResponse {
  productOwner: true
}

// The `role` event: answers who the caller is and reads nothing, so a sign-in
// or landing probe costs no query.
export function checkAdminRole(request: Pick<AdminRequest, 'email' | 'adminEmails'>): AdminRoleResponse {
  requireProductOwner(request)
  return { productOwner: true }
}

export function isRoleCheck(body: unknown): boolean {
  return typeof body === 'object' && body !== null && 'event' in body && body.event === 'role'
}

// The `testConnection` event asks the provider two questions and writes nothing, so the page gets its
// answer without a settings read, a decision read or a directory read.
export function isConnectionTest(body: unknown): boolean {
  return typeof body === 'object' && body !== null && 'event' in body && body.event === 'testConnection'
}

// The two checks the administrator asked for, of the settings on the form and of nothing else: what is
// saved stays as it was until the owner saves it. A provider that refuses or cannot be reached is
// answered inside the report; only settings that describe no call at all are a fault.
export async function handleConnectionTest(request: AdminRequest): Promise<ConnectionReport> {
  requireProductOwner(request)
  const form = modelForm(request.body, 'testConnection')
  if (!form) throw new ModelSettingsError('The settings to test are missing.')
  try {
    return await testConnection(await settingsFromForm(form, request), { production: modelAddressLocked(request.production) })
  }
  catch (error) {
    if (error instanceof UnusableSettingsError) throw new ModelSettingsError(error.message)
    throw error
  }
}

export function requireProductOwner(request: Pick<AdminRequest, 'email' | 'adminEmails'>): string {
  const email = request.email?.trim() ?? ''
  if (email === '') throw new SignInRequiredError()
  if (!isProductOwner(email, request.adminEmails)) throw new ProductOwnerRequiredError()
  return email
}

export async function handleAdmin(request: AdminRequest): Promise<AdminResponse> {
  const email = requireProductOwner(request)

  const save = modelForm(request.body, 'save')
  if (save) await request.store.save(await settingsToStore(save, request))

  const verifyShieldSwitch = verifyShieldBody(request.body)
  if (verifyShieldSwitch) {
    if (!request.verifyShield) throw new AdminRequestError('The VerifyShield setting is unavailable.')
    await request.verifyShield.save(verifyShieldSwitch.enabled)
  }

  const numberChange = studentNumberBody(request.body)
  if (numberChange) {
    if (!request.students) throw new AdminRequestError('The student directory is unavailable.')
    const result = await request.students.changeNumber({ ...numberChange, actorEmail: email })
    if (result === 'not-found') throw new AdminNotFoundError()
    if (result === 'duplicate') throw new AdminRequestError('Another student already has that student number.')
    if (result === 'used') throw new AdminRequestError('That student number has been used before and cannot be given out again.')
  }

  const campusChange = campusBody(request.body)
  if (campusChange) {
    if (!request.students) throw new AdminRequestError('The student directory is unavailable.')
    const result = await request.students.changeCampus({ ...campusChange, actorEmail: email })
    if (result === 'not-found') throw new AdminNotFoundError()
  }

  const deletion = deleteStudentBody(request.body)
  if (deletion) {
    if (!request.students) throw new AdminRequestError('The student directory is unavailable.')
    const result = await request.students.deleteStudent(deletion.studentId)
    if (result === 'not-found') throw new AdminNotFoundError()
  }

  return {
    model: await present(request.store, request.env),
    verifyShieldOn: verifyShieldEnabled(
      request.verifyShieldEnv ?? 'on',
      request.verifyShield ? await request.verifyShield.read() : null,
    ),
    decisions: request.decisions ? await request.decisions.list(decisionQuery(request.body)) : [],
    chain: request.decisions ? await request.decisions.chain() : 'verified',
    students: wantsDirectory(request.body) && request.students ? await request.students.list() : [],
    staffAccess: wantsStaffAccess(request.body) && request.accessLog ? await request.accessLog.list(staffAccessShown) : [],
  }
}

// Only the page that shows the directory asks for it; every other call pays no query.
function wantsDirectory(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) return false
  return 'event' in body && (body.event === 'students' || body.event === 'studentNumber' || body.event === 'campus' || body.event === 'deleteStudent')
}

// Only the access log page asks for it.
function wantsStaffAccess(body: unknown): boolean {
  return typeof body === 'object' && body !== null && 'event' in body && body.event === 'staffAccessLog'
}

const staffAccessShown = 200

// The administrator may correct a number to SWB followed by at least four
// digits. Whether the number is free is the store's decision.
function studentNumberBody(body: unknown): { studentId: string, studentNumber: string } | null {
  if (typeof body !== 'object' || body === null) return null
  if (!('event' in body) || body.event !== 'studentNumber') return null
  if (!('studentId' in body) || typeof body.studentId !== 'string' || body.studentId.trim() === '') {
    throw new AdminRequestError('The student is missing.')
  }
  if (!('studentNumber' in body) || typeof body.studentNumber !== 'string') {
    throw new AdminRequestError('The student number is missing.')
  }
  const studentNumber = body.studentNumber.trim()
  if (!isStudentNumber(studentNumber)) {
    throw new AdminRequestError(studentNumberRule)
  }
  return { studentId: body.studentId.trim(), studentNumber }
}

function campusBody(body: unknown): { studentId: string, campus: Campus } | null {
  if (typeof body !== 'object' || body === null) return null
  if (!('event' in body) || body.event !== 'campus') return null
  if (!('studentId' in body) || typeof body.studentId !== 'string' || body.studentId.trim() === '') {
    throw new AdminRequestError('The student is missing.')
  }
  if (!('campus' in body) || !isCampus(body.campus)) {
    throw new AdminRequestError(campusRule)
  }
  return { studentId: body.studentId.trim(), campus: body.campus }
}

function deleteStudentBody(body: unknown): { studentId: string } | null {
  if (typeof body !== 'object' || body === null) return null
  if (!('event' in body) || body.event !== 'deleteStudent') return null
  if (!('studentId' in body) || typeof body.studentId !== 'string' || body.studentId.trim() === '') {
    throw new AdminRequestError('The student is missing.')
  }
  return { studentId: body.studentId.trim() }
}

function verifyShieldBody(body: unknown): { enabled: boolean } | null {
  if (typeof body !== 'object' || body === null) return null
  if (!('event' in body) || body.event !== 'verifyShield') return null
  if (!('enabled' in body) || typeof body.enabled !== 'boolean') {
    throw new AdminRequestError('The VerifyShield switch is missing.')
  }
  return { enabled: body.enabled }
}

function decisionQuery(body: unknown): DecisionQuery {
  if (typeof body !== 'object' || body === null) return {}
  const query: DecisionQuery = {}
  if ('verdict' in body && body.verdict !== undefined && body.verdict !== null && body.verdict !== '') {
    if (body.verdict !== 'allow' && body.verdict !== 'block' && body.verdict !== 'downgrade') {
      throw new AdminRequestError('The verdict filter is not allow, block, or downgrade.')
    }
    query.verdict = body.verdict
  }
  if ('studentId' in body && body.studentId !== undefined && body.studentId !== null && body.studentId !== '') {
    if (typeof body.studentId !== 'string') throw new AdminRequestError('The student filter is not text.')
    const studentId = body.studentId.trim()
    if (studentId.length > 0) query.studentId = studentId
  }
  return query
}

export function isProductOwner(email: string, adminEmails: string): boolean {
  const allowed = adminEmails
    .split(',')
    .map(entry => entry.trim().toLowerCase())
    .filter(entry => entry.length > 0)
  return allowed.includes(email.trim().toLowerCase())
}

interface ModelForm {
  provider: string
  apiKey?: string
  baseUrl?: string
  modelName?: string
}

// The model settings as the page's form sends them, for the event named. A save and a connection test
// carry the same fields, and neither may be answered from a half-filled form.
function modelForm(body: unknown, event: string): ModelForm | null {
  if (typeof body !== 'object' || body === null) return null
  if (!('event' in body) || body.event !== event) return null
  if (!('provider' in body) || typeof body.provider !== 'string') {
    throw new ModelSettingsError('The model provider is missing.')
  }
  return {
    provider: body.provider,
    apiKey: optionalText(body, 'apiKey'),
    baseUrl: optionalText(body, 'baseUrl'),
    modelName: optionalText(body, 'modelName'),
  }
}

function optionalText(body: object, key: string): string | undefined {
  if (!(key in body)) return undefined
  const value = (body as Record<string, unknown>)[key]
  if (typeof value !== 'string') throw new ModelSettingsError(`The ${key} is not text.`)
  return value
}

// A blank API key keeps the key already in effect. The page only ever receives
// a mask, so a save that did not type a new key must not wipe the real one.
async function settingsFromForm(form: ModelForm, request: AdminRequest): Promise<ModelSettings> {
  const current = await request.store.read() ?? request.env
  const apiKey = form.apiKey !== undefined && form.apiKey.trim() !== ''
    ? form.apiKey
    : current.apiKey
  return {
    provider: form.provider,
    apiKey,
    baseUrl: form.baseUrl ?? current.baseUrl,
    modelName: form.modelName ?? current.modelName,
  }
}

async function settingsToStore(save: ModelForm, request: AdminRequest): Promise<ModelSettings> {
  const next = await settingsFromForm(save, request)

  let choice
  try {
    choice = resolveModelChoice(next, { production: modelAddressLocked(request.production) })
  }
  catch (error) {
    const message = error instanceof Error ? error.message : 'The model settings are not usable.'
    throw new ModelSettingsError(message)
  }

  if (choice.kind === 'fake') {
    return {
      provider: 'fake',
      apiKey: next.apiKey.trim(),
      baseUrl: next.baseUrl.trim().replace(/\/+$/, ''),
      modelName: next.modelName.trim(),
    }
  }

  return {
    provider: 'real',
    apiKey: choice.apiKey,
    baseUrl: choice.baseUrl,
    modelName: choice.model,
  }
}

async function present(store: ModelSettingsStore, env: ModelSettings): Promise<AdminModelView> {
  const saved = await store.read()
  const settings = saved ?? env
  const provider = settings.provider.trim().toLowerCase() || 'real'
  if (provider !== 'real' && provider !== 'fake') {
    throw new ModelSettingsError(`The model provider is "${provider}": name one of real, fake.`)
  }
  return {
    provider,
    apiKeyMask: maskApiKey(settings.apiKey.trim()),
    baseUrl: settings.baseUrl.trim().replace(/\/+$/, ''),
    modelName: settings.modelName.trim(),
    saved: saved !== null,
  }
}

// The first few and last few characters are enough to recognise a key. A short
// key would be revealed by that, so it is replaced with an ellipsis instead.
function maskApiKey(apiKey: string): string {
  if (apiKey.length === 0) return ''
  if (apiKey.length < 8) return '…'
  return `${apiKey.slice(0, 3)}…${apiKey.slice(-4)}`
}
