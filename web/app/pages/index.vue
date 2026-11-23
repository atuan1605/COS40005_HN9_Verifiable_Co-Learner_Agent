<script setup lang="ts">
import ConversationPanel from '~/components/workspace/ConversationPanel.vue'
import CourseRoadmap from '~/components/workspace/CourseRoadmap.vue'
import MindmapNotes, { type NoteDraft } from '~/components/workspace/MindmapNotes.vue'
import { shrinkImage } from '~/utils/shrink-image'
import MindmapCanvas from '~/components/workspace/MindmapCanvas.vue'
import WorkingArea from '~/components/workspace/WorkingArea.vue'
import StudySuggestionToast from '~/components/workspace/StudySuggestionToast.vue'
import CampusStep from '~/components/workspace/CampusStep.vue'
import type { Campus } from '#shared/campus'
import type { AddressedAgent, StudySuggestionView, PracticeTestResult, Quote, RedrawState, RunOutput, TurnEvent, TurnTrace } from '#shared/turn'
import { sessionStudentId, studentIdFromAuth } from '#shared/student-id'
import { createDraftStore } from '~/drafts/store'
import { type Arrangement, type Point } from '~/mindmap/arrangement'
import { recordStudentActivity } from '~/activity/record'
import { resolveWorkspaceLayout, workspaceLayoutCookie, workspaceLayoutCookieOptions, workspaceLayoutFrom, workspaceLayouts, type WorkspaceLayoutId } from '~/workspace/layout'

interface SubmissionPayload {
  code: string
  results: PracticeTestResult[]
}

definePageMeta({
  middleware: ['signed-in', 'staff-landing', 'workspace-layout'],
})

async function signOut() {
  await useNuxtApp().$supabase.auth.signOut()
  portraitUrl.value = null
  await navigateTo('/sign-in')
}

const route = useRoute()
const rememberedLayout = useCookie<string | null>(workspaceLayoutCookie, workspaceLayoutCookieOptions)
const layout = computed(() => resolveWorkspaceLayout(route.query.layout, rememberedLayout.value))

function layoutTarget(id: WorkspaceLayoutId) {
  return { path: '/', query: { ...route.query, layout: id } }
}

watchEffect(() => {
  const requested = workspaceLayoutFrom(route.query.layout)
  if (requested) rememberedLayout.value = requested
})

watch(layout, (value, previous) => {
  if (previous && value !== previous) void reportActivity({ event: 'layout_switched', layout: value })
})

const { data, error } = await useFetch<RedrawState>('/turn', {
  method: 'POST',
  body: { event: 'open' },
})

let suggestionTimer: ReturnType<typeof setTimeout> | undefined
const suggestionQuietMs = 400

// A report of the student's activity that does not redraw the workspace. Afterwards the
// page asks for the workspace again, so the study suggestion follows the new log.
function reportActivity(body: Record<string, unknown>): Promise<void> {
  return recordStudentActivity(body).then(scheduleSuggestionRefresh)
}

const workspace = ref<RedrawState | null>(null)
const latestTrace = ref<TurnTrace | null>(null)
const deskmateBusy = ref(false)
const deskmateError = ref('')

// The student's own deskmate switch, saved through the turn endpoint.
async function saveDeskmate(on: boolean) {
  if (deskmateBusy.value) return
  deskmateBusy.value = true
  deskmateError.value = ''
  try {
    const state = await $fetch<RedrawState>('/turn', {
      method: 'POST',
      body: { event: 'deskmate_switch', on },
    })
    if (workspace.value) workspace.value = { ...workspace.value, deskmateOn: state.deskmateOn }
  }
  catch {
    deskmateError.value = 'Could not save the deskmate switch. Try again.'
  }
  finally {
    deskmateBusy.value = false
  }
}
const workingMode = ref<'learn' | 'practice'>('learn')

function chooseMode(mode: 'learn' | 'practice') {
  if (mode === workingMode.value) return
  workingMode.value = mode
  void reportActivity({ event: 'mode_switched', mode })
}

// The plan's current step asks for the student's approach: the message box invites it.
const askingApproach = computed(() => {
  const plan = workspace.value?.learningPlan
  if (!plan?.agreed) return false
  return plan.steps.find(step => step.current)?.id.startsWith('approach:') ?? false
})

const practiceQuietMs = 3 * 60 * 1000
let quietTimer: ReturnType<typeof setTimeout> | undefined
let practiceQuiet = false
let practiceRunning = false
let quietPlace: { moduleId: string, exerciseId: string } | null = null

function clearQuietTimer() {
  if (quietTimer === undefined) return
  clearTimeout(quietTimer)
  quietTimer = undefined
}

function practicePlace(): { moduleId: string, exerciseId: string } | null {
  const area = workspace.value?.workingArea
  if (!area || workingMode.value !== 'practice') return null
  return { moduleId: area.moduleId, exerciseId: area.exercise.id }
}

function recordReturn() {
  if (!practiceQuiet || !quietPlace) return
  practiceQuiet = false
  const place = quietPlace
  quietPlace = null
  void reportActivity({ event: 'returned', moduleId: place.moduleId, exerciseId: place.exerciseId })
}

function armQuietTimer() {
  clearQuietTimer()
  if (practiceRunning) return
  quietTimer = setTimeout(() => {
    quietTimer = undefined
    const place = practicePlace()
    if (!place) return
    practiceQuiet = true
    quietPlace = place
    void reportActivity({ event: 'went_idle', moduleId: place.moduleId, exerciseId: place.exerciseId })
    void checkInAfterQuiet()
  }, practiceQuietMs)
}

function markPracticeActivity() {
  if (!import.meta.client) return
  if (!practicePlace()) return
  recordReturn()
  armQuietTimer()
}

function onPracticeRunning(running: boolean) {
  practiceRunning = running
  if (running) clearQuietTimer()
  else markPracticeActivity()
}

function leavePractice() {
  recordReturn()
  practiceRunning = false
  clearQuietTimer()
}

watch(workingMode, (mode, previous) => {
  if (!import.meta.client) return
  if (mode === 'practice') markPracticeActivity()
  else if (previous === 'practice') leavePractice()
})

onBeforeUnmount(() => {
  clearQuietTimer()
})
const studentId = ref('')
const selecting = ref(false)
const selectError = ref('')
const pendingModuleId = ref('')
const pendingModuleName = ref('')
// What the current select turn is waiting on, so that control shows a spinner.
const selectingModuleId = ref('')
const selectingExerciseId = ref('')
const answering = ref<{ questionId: string, choice: number } | null>(null)
// True while the student's agreement to the Teacher's plan is being recorded.
const planStarting = ref(false)
const moduleViews = new Map<string, RedrawState>()
let workspaceVersion = 0
const moduleLoads = new Map<string, Promise<RedrawState>>()
let selectGeneration = 0
const sending = ref(false)
// Shared with the profile page, so a new picture shows here at once.
const portraitUrl = useState<string | null>('student-picture-url', () => null)
// Unknown until the profile opens; null means the student has not chosen one yet.
const campus = ref<Campus | null | undefined>(undefined)
interface NoteItem {
  id: string
  text: string
  colour: string
  x: number
  y: number
  imageUrl: string | null
}
interface NoteLink {
  id: string
  fromNoteId: string
  target: { kind: 'module', moduleId: string } | { kind: 'note', noteId: string }
}
interface MindmapState {
  mindmap: {
    notes: NoteItem[]
    links: NoteLink[]
    positions: { moduleId: string, x: number, y: number }[]
  }
}
const notes = ref<NoteItem[]>([])
const noteLinks = ref<NoteLink[]>([])
const modulePositions = ref<MindmapState['mindmap']['positions']>()
const arrangementError = ref('')
const selectedNoteId = ref('')
const addingNote = ref(false)
const noteError = ref('')
const noteSaved = ref('')
// The X on the mindmap panel folds it to a reopen button, so more canvas shows.
const mindmapPanelOpen = ref(true)
const reopenPanelButton = ref<{ $el: HTMLElement } | null>(null)
const closePanelButton = ref<{ $el: HTMLElement } | null>(null)
async function setMindmapPanelOpen(open: boolean) {
  mindmapPanelOpen.value = open
  await nextTick()
  // Focus follows the panel, so a keyboard user is never left on a removed button.
  const target = open ? closePanelButton.value : reopenPanelButton.value
  target?.$el?.focus()
}
let noteSavedTimer: ReturnType<typeof setTimeout> | undefined

function showNoteSaved(message: string) {
  clearTimeout(noteSavedTimer)
  noteSaved.value = message
  noteSavedTimer = setTimeout(() => {
    noteSaved.value = ''
  }, 4000)
}
const noteModules = computed(() => (workspace.value?.courseRoadmap ?? []).map(module => ({
  id: module.id,
  name: module.name,
})))

function applyMindmap(state: MindmapState) {
  notes.value = state.mindmap.notes.map(note => ({
    id: note.id,
    text: note.text,
    colour: note.colour,
    x: note.x,
    y: note.y,
    imageUrl: note.imageUrl ?? null,
  }))
  noteLinks.value = state.mindmap.links
}

const canvasNotes = computed(() => notes.value.flatMap((note) => {
  const link = noteLinks.value.find(item => item.fromNoteId === note.id && item.target.kind === 'module')
  const target = link?.target
  if (!target || target.kind !== 'module') return []
  const title = note.text.split('\n')[0]?.trim() || 'Note'
  return [{
    id: note.id,
    title,
    colour: note.colour,
    x: note.x,
    y: note.y,
    moduleId: target.moduleId,
    moduleName: noteModules.value.find(module => module.id === target.moduleId)?.name ?? target.moduleId,
  }]
}))
const noteToNoteLinks = computed(() => noteLinks.value.flatMap((link) => {
  const target = link.target
  return target.kind === 'note' ? [{ id: link.id, fromNoteId: link.fromNoteId, toNoteId: target.noteId }] : []
}))
const incomingQuote = ref<Quote | null>(null)
const askButton = ref<{ x: number, y: number, text: string, source: 'agent' | 'materials' } | null>(null)
const sendError = ref('')
const streamingTeacher = ref('')
const streamingDeskmate = ref('')
const liveDraft = ref<string | null>(null)
const latestRun = ref<RunOutput | null>(null)
const workingAreaExpanded = ref(true)
const mindmapPanelChrome = 'lg:overflow-hidden lg:rounded-2xl lg:bg-paper lg:shadow-[0_0_0_1px_var(--color-ink-200),0px_12px_36px_-6px_rgba(15,23,42,0.12),0px_4px_12px_-2px_rgba(15,23,42,0.04)]'
const phonePanels = computed(() => layout.value === 'mindmap'
  ? [
      { id: 'roadmap' as const, name: 'Progress map' },
      { id: 'notes' as const, name: 'Notes List' },
    ]
  : [
      { id: 'roadmap' as const, name: 'Roadmap' },
      { id: 'working' as const, name: 'Working area' },
      { id: 'conversation' as const, name: 'Conversation' },
    ])
const phonePanel = ref<(typeof phonePanels.value)[number]['id']>('working')

watch(layout, (value) => {
  if (value === 'mindmap' && (phonePanel.value === 'working' || phonePanel.value === 'conversation')) phonePanel.value = 'roadmap'
  if (value === 'study' && phonePanel.value === 'notes') phonePanel.value = 'working'
  selectedMindmapModuleId.value = ''
})
const conversationUnread = ref(false)
const isPhone = ref(false)

function conversationIsOpen() {
  return !isPhone.value || phonePanel.value === 'conversation'
}

function noteReply() {
  if (!conversationIsOpen()) conversationUnread.value = true
}

function choosePanel(panel: (typeof phonePanels.value)[number]['id']) {
  phonePanel.value = panel
  if (panel === 'conversation') conversationUnread.value = false
}

async function openInLearn() {
  chooseMode('learn')
  phonePanel.value = 'working'
  if (layout.value === 'mindmap') await navigateTo(layoutTarget('study'))
}

const currentModuleName = computed(() => workspace.value?.workingArea.moduleName)
const selectedMindmapModuleId = ref('')
const selectedMindmapModule = computed(() => workspace.value?.courseRoadmap
  .find(module => module.id === selectedMindmapModuleId.value))

async function selectMindmapModule(moduleId: string) {
  if (selecting.value || sending.value) return
  selectError.value = ''
  selectedMindmapModuleId.value = moduleId
  choosePanel('notes')
  await selectModule(moduleId)
}

function selectMindmapNote(noteId: string) {
  selectedNoteId.value = noteId
  mindmapPanelOpen.value = true
  choosePanel('notes')
}

function studyFrame(panel: 'working' | 'conversation') {
  const place = panel === 'working'
    ? 'md:col-start-1 md:row-start-2 lg:col-start-2 lg:row-start-1'
    : 'md:col-start-2 md:row-start-2 lg:col-start-3 lg:row-start-1'
  const display = phonePanel.value === panel ? 'flex' : 'max-md:hidden md:flex'
  return ['h-full min-h-0 min-w-0 flex-col overflow-hidden', place, display]
}

watch([streamingTeacher, streamingDeskmate], ([teacher, deskmate]) => {
  if (teacher || deskmate) noteReply()
})

watch(() => workspace.value?.conversation, (messages, previous) => {
  if (!messages || !previous || messages.length <= previous.length) return
  const added = messages.slice(previous.length)
  if (added.some(message => message.author === 'teacher' || message.author === 'deskmate')) noteReply()
})

let phoneMedia: MediaQueryList | undefined

function syncPhone() {
  isPhone.value = phoneMedia?.matches ?? false
}

onMounted(() => {
  phoneMedia = window.matchMedia('(width < 48rem)')
  syncPhone()
  phoneMedia.addEventListener('change', syncPhone)
  document.addEventListener('selectionchange', onSelectionChange)
  warmModules()
  void loadPortrait()
})

onBeforeUnmount(() => {
  clearTimeout(noteSavedTimer)
  phoneMedia?.removeEventListener('change', syncPhone)
  document.removeEventListener('selectionchange', onSelectionChange)
})

type ArrangementChange =
  | { event: 'mindmap_moved', kind: 'module', id: string, x: number, y: number }
  | { event: 'import_arrangement', positions: MindmapState['mindmap']['positions'] }
  | { event: 'reset_arrangement' }

let arrangementQueue = Promise.resolve()
let arrangementVersion = 0
let savedPositions: MindmapState['mindmap']['positions'] = []

function changeArrangement(body: ArrangementChange, errorMessage: string) {
  const version = ++arrangementVersion
  arrangementError.value = ''
  arrangementQueue = arrangementQueue.then(async () => {
    try {
      const state = await $fetch<MindmapState>('/api/student', { method: 'POST', body })
      savedPositions = state.mindmap.positions
    }
    catch {
      arrangementError.value = errorMessage
    }
    if (version === arrangementVersion) modulePositions.value = [...savedPositions]
  })
}

function onMindmapMoved(moduleId: string, point: Point) {
  modulePositions.value = [
    ...(modulePositions.value ?? []).filter(position => position.moduleId !== moduleId),
    { moduleId, ...point },
  ]
  changeArrangement({ event: 'mindmap_moved', kind: 'module', id: moduleId, ...point }, 'Could not save the module position. Try moving it again.')
}

let arrangementChecked = false
function importLocalArrangement(arrangement: Arrangement) {
  if (arrangementChecked || !modulePositions.value || modulePositions.value.length > 0) return
  const positions = Object.entries(arrangement).map(([moduleId, point]) => ({ moduleId, ...point }))
  if (positions.length === 0) return
  arrangementChecked = true
  changeArrangement({ event: 'import_arrangement', positions }, 'Could not import the old arrangement. Reload to try again.')
}

function resetMindmapArrangement() {
  changeArrangement({ event: 'reset_arrangement' }, 'Could not reset the arrangement. Try again.')
}

async function saveNote(draft: NoteDraft) {
  if (addingNote.value) return
  if (!draft.title.trim() || (!draft.id && !draft.target)) {
    noteError.value = 'A note needs a title and a link to a module or another note.'
    return
  }
  addingNote.value = true
  noteError.value = ''
  noteSaved.value = ''
  const text = draft.body.trim() ? `${draft.title.trim()}\n${draft.body}` : draft.title.trim()
  try {
    let noteId = draft.id ?? ''
    if (!noteId) {
      const previous = new Set(notes.value.map(note => note.id))
      // A new note's image goes with it, so the save is one request.
      const image = draft.image ? await shrunk(draft.image, 'The note was not saved.') : undefined
      const created = await $fetch<MindmapState>('/api/student', {
        method: 'POST',
        body: {
          event: 'note_created',
          text,
          colour: draft.colour,
          x: 48,
          y: 48,
          target: draft.target,
          ...(image ? { image } : {}),
        },
      })
      applyMindmap(created)
      noteId = created.mindmap.notes.find(note => !previous.has(note.id))?.id ?? ''
    }
    else {
      applyMindmap(await $fetch<MindmapState>('/api/student', {
        method: 'POST',
        body: {
          event: 'note_changed',
          noteId,
          text,
          colour: draft.colour,
        },
      }))
      // A note linked only to other notes may stay that way.
      if (draft.moduleId) await moveModuleLink(noteId, draft.moduleId)
    }
    if (!noteId) throw new Error('The note was not saved.')
    selectedNoteId.value = noteId
    if (draft.id && draft.image !== undefined) await saveNoteImage(noteId, draft.image)
    showNoteSaved('Note saved.')
  }
  catch (error) {
    noteError.value = error instanceof NoteImageError ? error.message : 'The note could not be saved. Try again.'
  }
  finally {
    addingNote.value = false
  }
}

class NoteImageError extends Error {}

// The image is shrunk in the browser to about 1024 px WebP before it is sent.
async function shrunk(file: File, failure: string): Promise<Awaited<ReturnType<typeof shrinkImage>>> {
  try {
    return await shrinkImage(file)
  }
  catch (error) {
    throw new NoteImageError(`${failure} ${error instanceof Error ? error.message : ''}`.trim())
  }
}

async function saveNoteImage(noteId: string, file: File | null) {
  const image = file ? await shrunk(file, 'The note was saved, but not its image.') : null
  try {
    applyMindmap(await $fetch<MindmapState>('/api/student', {
      method: 'POST',
      body: { event: 'note_image_changed', noteId, image },
    }))
  }
  catch {
    throw new NoteImageError('The note was saved, but not its image. Try again.')
  }
}

// Link the new module first, then drop the old one, so the note is never
// left without a link.
async function moveModuleLink(noteId: string, moduleId: string) {
  const linked = noteLinks.value.some(item =>
    item.fromNoteId === noteId && item.target.kind === 'module' && item.target.moduleId === moduleId)
  if (!linked) {
    applyMindmap(await $fetch<MindmapState>('/api/student', {
      method: 'POST',
      body: { event: 'note_linked', noteId, target: { kind: 'module', moduleId } },
    }))
  }
  for (const link of noteLinks.value.filter(item => item.fromNoteId === noteId && item.target.kind === 'module')) {
    if (link.target.kind === 'module' && link.target.moduleId !== moduleId) {
      applyMindmap(await $fetch<MindmapState>('/api/student', {
        method: 'POST',
        body: { event: 'note_unlinked', linkId: link.id },
      }))
    }
  }
}

function onNoteMoved(noteId: string, point: { x: number, y: number }) {
  notes.value = notes.value.map(note => note.id === noteId ? { ...note, x: point.x, y: point.y } : note)
  void $fetch('/api/student', {
    method: 'POST',
    body: { event: 'mindmap_moved', kind: 'note', id: noteId, x: point.x, y: point.y },
  }).catch(() => {
    noteError.value = 'The note could not be moved. Try again.'
  })
}

async function deleteNote(noteId: string) {
  noteError.value = ''
  try {
    const state = await $fetch<MindmapState>('/api/student', {
      method: 'POST',
      body: { event: 'note_deleted', noteId },
    })
    applyMindmap(state)
    if (selectedNoteId.value === noteId) selectedNoteId.value = ''
  }
  catch {
    noteError.value = 'The note could not be deleted. Try again.'
  }
}

async function linkNotes(noteId: string, targetNoteId: string) {
  noteError.value = ''
  try {
    applyMindmap(await $fetch<MindmapState>('/api/student', {
      method: 'POST',
      body: { event: 'note_linked', noteId, target: { kind: 'note', noteId: targetNoteId } },
    }))
  }
  catch {
    noteError.value = 'The notes could not be linked. Try again.'
  }
}

async function unlinkNotes(linkId: string) {
  noteError.value = ''
  const link = noteLinks.value.find(item => item.id === linkId)
  if (link && noteLinks.value.filter(item => item.fromNoteId === link.fromNoteId).length <= 1) {
    noteError.value = 'A note keeps at least one link. Link it elsewhere first, or delete the note.'
    return
  }
  try {
    applyMindmap(await $fetch<MindmapState>('/api/student', {
      method: 'POST',
      body: { event: 'note_unlinked', linkId },
    }))
  }
  catch {
    noteError.value = 'The link could not be removed. Try again.'
  }
}

async function loadPortrait() {
  try {
    const state = await $fetch<MindmapState & { profile: { pictureUrl: string | null, campus: Campus | null } }>('/api/student', {
      method: 'POST',
      body: { event: 'open' },
    })
    portraitUrl.value = state.profile.pictureUrl
    campus.value = state.profile.campus
    savedPositions = state.mindmap.positions
    modulePositions.value = savedPositions
    applyMindmap(state)
  }
  catch {
    portraitUrl.value = null
    arrangementError.value = 'Could not load the arrangement. Reload to try again.'
  }
}

function rememberModule(state: RedrawState) {
  // A remembered view never keeps a study suggestion: the server decides what to show.
  moduleViews.set(state.workingArea.moduleId, { ...state, studySuggestion: null })
}

function withCurrentModule(state: RedrawState, moduleId: string): RedrawState {
  return {
    ...state,
    courseRoadmap: state.courseRoadmap.map(module => (
      module.current === (module.id === moduleId)
        ? module
        : { ...module, current: module.id === moduleId }
    )),
  }
}

function showWorkspace(state: RedrawState) {
  workspaceVersion += 1
  if (state.workingArea.mode === 'learn') workingMode.value = 'learn'
  if (state.trace) latestTrace.value = state.trace
  workspace.value = state
  rememberModule(state)
}

function prefetchModule(moduleId: string): Promise<RedrawState> | null {
  if (!import.meta.client || moduleViews.has(moduleId)) return null
  const existing = moduleLoads.get(moduleId)
  if (existing) return existing
  const current = workspace.value
  const chosen = current?.courseRoadmap.find(module => module.id === moduleId)
  if (!chosen || chosen.current || chosen.state === 'closed') return null
  const pending = $fetch<RedrawState>('/turn', {
    method: 'POST',
    body: { event: 'preview_module', moduleId },
  }).then((state) => {
    if (state.workingArea.moduleId === moduleId) moduleViews.set(moduleId, state)
    return state
  }).finally(() => {
    moduleLoads.delete(moduleId)
  })
  moduleLoads.set(moduleId, pending)
  return pending
}

function warmModules() {
  const current = workspace.value
  if (!current) return
  const next = current.courseRoadmap.find(module =>
    module.state !== 'closed'
    && !module.current
    && !moduleViews.has(module.id)
    && !moduleLoads.has(module.id),
  )
  if (!next) return
  prefetchModule(next.id)?.then(() => warmModules()).catch(() => {})
}

if (data.value) {
  showWorkspace(data.value)
  if (import.meta.client) {
    void reportActivity({
      event: 'module_opened',
      moduleId: data.value.workingArea.moduleId,
    })
  }
}

if (import.meta.server) {
  const event = useRequestEvent()
  studentId.value = (event && await sessionStudentId(event)) || ''
}
else {
  studentId.value = (await studentIdFromAuth(useNuxtApp().$supabase)) ?? ''
}

async function selectModule(moduleId: string) {
  const current = workspace.value
  if (!current || selecting.value || sending.value) return
  const chosen = current.courseRoadmap.find(module => module.id === moduleId)
  if (!chosen || chosen.current || chosen.state === 'closed') return

  markPracticeActivity()
  const snapshot = current
  const modeBeforeSelect = workingMode.value
  const generation = ++selectGeneration
  rememberModule(snapshot)
  selecting.value = true
  selectingModuleId.value = moduleId
  selectError.value = ''
  const cached = moduleViews.get(moduleId)
  if (cached) {
    pendingModuleId.value = ''
    pendingModuleName.value = ''
    showWorkspace(withCurrentModule(cached, moduleId))
  }
  else {
    pendingModuleId.value = moduleId
    pendingModuleName.value = chosen.name
    workspace.value = withCurrentModule(snapshot, moduleId)
    moduleLoads.get(moduleId)?.then((state) => {
      if (generation !== selectGeneration || pendingModuleId.value !== moduleId) return
      if (state.workingArea.moduleId !== moduleId) return
      pendingModuleId.value = ''
      pendingModuleName.value = ''
      showWorkspace(withCurrentModule(state, moduleId))
    }).catch(() => {})
  }

  try {
    showWorkspace(await $fetch<RedrawState>('/turn', {
      method: 'POST',
      body: { event: 'select_module', moduleId },
    }))
    void reportActivity({ event: 'module_opened', moduleId })
  }
  catch {
    workingMode.value = modeBeforeSelect
    showWorkspace(snapshot)
    selectError.value = 'That module could not be opened.'
  }
  finally {
    selecting.value = false
    selectingModuleId.value = ''
    pendingModuleId.value = ''
    pendingModuleName.value = ''
  }
}

function scheduleSuggestionRefresh() {
  if (!import.meta.client) return
  clearTimeout(suggestionTimer)
  suggestionTimer = setTimeout(() => void refreshSuggestion(), suggestionQuietMs)
}

// The workspace open redraw: it introduces the module only while its conversation is empty,
// and otherwise only redraws. A redraw that arrives after the student has acted again is dropped.
async function refreshSuggestion() {
  if (!workspace.value) return
  if (selecting.value || sending.value) {
    scheduleSuggestionRefresh()
    return
  }
  const version = workspaceVersion
  try {
    const state = await $fetch<RedrawState>('/turn', { method: 'POST', body: { event: 'open' } })
    if (version !== workspaceVersion || selecting.value || sending.value) return
    if (state.workingArea.moduleId !== workspace.value?.workingArea.moduleId) return
    showWorkspace(state)
  }
  catch {
    // The suggestion is advice: a missed redraw leaves the workspace as it was.
  }
}

const suggestionBusy = ref(false)
const suggestionError = ref('')

// Closing and following both dismiss this episode first; a dismissal that is not saved leaves
// the dialog up. Following then moves the student with the controls they already have.
async function closeSuggestion(follow: boolean) {
  const suggestion = workspace.value?.studySuggestion
  if (!suggestion || suggestionBusy.value) return
  suggestionBusy.value = true
  suggestionError.value = ''
  try {
    showWorkspace(await $fetch<RedrawState>('/turn', {
      method: 'POST',
      body: { event: 'dismiss_study_suggestion', key: suggestion.key },
    }))
  }
  catch {
    suggestionError.value = 'That could not be saved. Try again.'
    return
  }
  finally {
    suggestionBusy.value = false
  }
  if (follow) await followSuggestion(suggestion)
}

async function followSuggestion(suggestion: StudySuggestionView) {
  const action = suggestion.action
  if (action.kind === 'study') {
    await navigateTo(layoutTarget('study'))
    phonePanel.value = 'working'
  }
  if (workspace.value?.workingArea.moduleId !== action.moduleId) await selectModule(action.moduleId)
  if (workspace.value?.workingArea.moduleId !== action.moduleId) return
  if (action.kind === 'learn') {
    chooseMode('learn')
    return
  }
  await selectExercise(action.exerciseId)
  chooseMode('practice')
}

async function selectExercise(exerciseId: string) {
  const current = workspace.value
  if (!current || selecting.value || sending.value) return
  if (current.workingArea.exercise.id === exerciseId) return

  markPracticeActivity()
  selecting.value = true
  selectingExerciseId.value = exerciseId
  selectError.value = ''
  try {
    showWorkspace(await $fetch<RedrawState>('/turn', {
      method: 'POST',
      body: { event: 'select_exercise', exerciseId },
    }))
  }
  catch {
    selectError.value = 'That exercise could not be opened.'
  }
  finally {
    selecting.value = false
    selectingExerciseId.value = ''
  }
}

async function answerQuiz(answer: { questionId: string, choice: number }) {
  const current = workspace.value
  // A quiz turn replaces the whole workspace, so it holds the same lock as a
  // module or exercise select: a stale answer must not land on a newer view.
  if (!current || selecting.value || sending.value) return
  // A question already answered keeps its first answer and is locked.
  const question = current.workingArea.quiz.find(item => item.id === answer.questionId)
  if (!question || question.result) return

  selecting.value = true
  answering.value = answer
  selectError.value = ''
  try {
    showWorkspace(await $fetch<RedrawState>('/turn', {
      method: 'POST',
      body: {
        event: 'quiz_answer',
        moduleId: current.workingArea.moduleId,
        questionId: answer.questionId,
        choice: answer.choice,
      },
    }))
  }
  catch {
    selectError.value = 'That answer could not be marked.'
  }
  finally {
    selecting.value = false
    answering.value = null
  }
}

// After three quiet minutes in Practice mode the Teacher may check in. The server
// allows one check-in per quiet period, so asking again is harmless.
async function checkInAfterQuiet() {
  if (sending.value || selecting.value) return
  sending.value = true
  try {
    await readTurn({ event: 'idle' })
  }
  catch {
    // A missed check-in is not worth an error: the student is simply left to work.
  }
  finally {
    sending.value = false
    streamingTeacher.value = ''
    streamingDeskmate.value = ''
  }
}

async function startPlan() {
  const current = workspace.value
  if (!current || !current.learningPlan || current.learningPlan.agreed) return
  if (selecting.value || sending.value || planStarting.value) return

  planStarting.value = true
  selectError.value = ''
  try {
    showWorkspace(await $fetch<RedrawState>('/turn', {
      method: 'POST',
      body: { event: 'plan_start' },
    }))
  }
  catch {
    selectError.value = 'That plan could not be started.'
  }
  finally {
    planStarting.value = false
  }
}

async function readTurn(body: unknown): Promise<boolean> {
  const response = await fetch('/turn', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/x-ndjson',
    },
    body: JSON.stringify(body),
  })
  if (!response.ok || !response.body) return false

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let sawState = false
  while (true) {
    const { done, value } = await reader.read()
    if (value) buffer += decoder.decode(value, { stream: !done })
    if (done) buffer += decoder.decode()
    const lines = buffer.split('\n')
    buffer = done ? '' : (lines.pop() ?? '')
    const events: TurnEvent[] = []
    for (const line of lines) {
      if (line.trim().length === 0) continue
      events.push(JSON.parse(line) as TurnEvent)
    }
    if (await applyTurnEvents(events)) sawState = true
    if (done) break
  }
  return sawState
}

async function applyTurnEvents(events: TurnEvent[]): Promise<boolean> {
  const textCount = events.filter(event => event.type === 'text').length
  // A buffered reply arrives as one chunk. Reveal it a word at a time so the
  // student sees it being written. Live chunks already contain one piece.
  const buffered = textCount > 1 && events.some(event => event.type === 'state')
  let sawState = false
  for (const turnEvent of events) {
    if (turnEvent.type === 'text') {
      if (turnEvent.author === 'deskmate') streamingDeskmate.value += turnEvent.delta
      else streamingTeacher.value += turnEvent.delta
      if (buffered) await nextPaint()
    }
    if (turnEvent.type === 'state') {
      showWorkspace(turnEvent.state)
      streamingTeacher.value = ''
      streamingDeskmate.value = ''
      sawState = true
    }
  }
  return sawState
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve())
  })
}

function onRun(result: RunOutput | null) {
  latestRun.value = result
}

function onDraft(code: string) {
  liveDraft.value = code
  markPracticeActivity()
}

function onPasted(characters: number) {
  const exerciseId = workspace.value?.workingArea.exercise.id
  if (!exerciseId || characters < 1) return
  void reportActivity({ event: 'pasted', exerciseId, characters })
  markPracticeActivity()
}

function onRunFinished(run: { exerciseId: string, outcome: 'completed' | 'error' | 'stopped' | 'failed', errorType: string | null }) {
  if (!run.exerciseId) return
  void reportActivity({ event: 'code_run', exerciseId: run.exerciseId })
  void reportActivity({
    event: 'run_finished',
    exerciseId: run.exerciseId,
    outcome: run.outcome,
    errorType: run.errorType,
  })
}

function onSelectionChange() {
  const selection = document.getSelection()
  if (!selection || selection.isCollapsed || selection.toString().trim() === '') {
    askButton.value = null
    return
  }
  const node = selection.anchorNode
  const element = node instanceof Element ? node : node?.parentElement
  const source = element?.closest('[data-quote-source]')?.getAttribute('data-quote-source')
  if (source !== 'agent' && source !== 'materials') {
    askButton.value = null
    return
  }
  const rect = selection.getRangeAt(0).getBoundingClientRect()
  askButton.value = { x: rect.left, y: rect.bottom + 8, text: selection.toString().trim(), source }
}

function askQuote() {
  const ask = askButton.value
  const moduleId = workspace.value?.workingArea.moduleId
  if (!ask || !moduleId) return
  incomingQuote.value = { text: ask.text, source: ask.source, moduleId }
  askButton.value = null
  document.getSelection()?.removeAllRanges()
}

async function sendMessage(text: string, addressedAgent: AddressedAgent | null, quote: Quote | null) {
  const current = workspace.value
  if (!current || sending.value || selecting.value) return
  markPracticeActivity()
  const storedDraft = studentId.value
    ? createDraftStore(localStorage, studentId.value).read(current.workingArea.exercise.id)
    : null
  await streamAgentTurn({
    event: 'message',
    text,
    ...(addressedAgent ? { addressedAgent } : {}),
    ...(quote ? { quote } : {}),
    draft: liveDraft.value ?? storedDraft,
    run: latestRun.value,
  }, 'That message could not be sent.')
  incomingQuote.value = null
}

async function submitCode(submission: SubmissionPayload) {
  if (!workspace.value || sending.value || selecting.value) return
  markPracticeActivity()
  await streamAgentTurn({
    event: 'submission',
    code: submission.code,
    results: submission.results,
  }, 'That submission could not be sent.')
}

async function streamAgentTurn(body: unknown, failure: string) {
  sending.value = true
  sendError.value = ''
  streamingTeacher.value = ''
  streamingDeskmate.value = ''
  try {
    const shown = await readTurn(body)
    if (!shown) sendError.value = failure
  }
  catch {
    streamingTeacher.value = ''
    streamingDeskmate.value = ''
    sendError.value = failure
  }
  finally {
    sending.value = false
  }
}

useHead({
  title: computed(() => workspace.value?.workingArea.moduleName ?? 'Workspace'),
})

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(word => word.length > 0)
  const first = words[0]
  if (!first) return ''
  if (words.length === 1) return Array.from(first).slice(0, 2).join('')
  return words.slice(0, 2).map(word => Array.from(word)[0] ?? '').join('')
}
</script>

<template>
  <main
    v-if="error || !workspace"
    class="phone-safe grid min-h-dvh place-items-center bg-default px-6 text-center"
  >
    <p class="max-w-sm text-sm text-balance">
      The workspace could not be opened.
    </p>
  </main>
  <main
    v-else
    :data-layout="layout"
    :inert="campus === null"
    class="flex h-dvh min-h-0 w-full flex-col overflow-hidden bg-elevated"
  >
    <!-- Until a campus is chosen the workspace behind it cannot be reached. -->
    <Teleport v-if="campus === null" to="body">
      <CampusStep @chosen="campus = $event" />
    </Teleport>
    <header class="phone-safe-top flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b border-default bg-default px-6 md:grid md:h-12 md:grid-cols-[1fr_auto_1fr] md:gap-4">
      <p class="flex shrink-0 items-center gap-3 text-sm font-semibold tracking-tight text-highlighted">
        <img
          src="/swinburne-fpt-logo.webp"
          alt=""
          width="871"
          height="705"
          class="block h-8 w-auto shrink-0"
        >
        <span class="max-md:sr-only">Verifiable Co-Learner</span>
      </p>
      <nav
        class="flex items-center rounded-[6px] border border-ink-200/80 bg-ink-100 p-0.5"
        aria-label="Workspace layout"
      >
        <NuxtLink
          v-for="option in workspaceLayouts"
          :key="option.id"
          v-slot="{ href, navigate }"
          custom
          :to="layoutTarget(option.id)"
        >
          <a
            :href="href ?? undefined"
            class="inline-flex min-h-11 min-w-11 items-center justify-center rounded-[4px] px-2.5 py-1 text-xs leading-4 md:inline md:min-h-0 md:min-w-0"
            :class="layout === option.id ? 'bg-paper font-medium text-ink-900 shadow-[0px_1px_1px_rgba(0,0,0,0.05)]' : 'text-ink-500 hover:bg-paper/60 hover:text-ink-800'"
            :aria-current="layout === option.id ? 'page' : undefined"
            @click="navigate"
          >{{ option.name }}</a>
        </NuxtLink>
      </nav>
      <div class="flex shrink-0 items-center gap-2 md:gap-4 md:justify-self-end">
        <div class="flex items-center gap-2 border-r border-ink-200 pr-2 md:pr-[13px]">
          <img
            v-if="portraitUrl"
            :src="portraitUrl"
            alt=""
            class="size-6 shrink-0 rounded-full object-cover"
            data-navbar-picture
          >
          <span
            v-else
            class="flex size-6 shrink-0 items-center justify-center rounded-full bg-ink-200 text-[11px] font-medium leading-4 text-ink-700"
            aria-hidden="true"
            data-navbar-initials
          >{{ initialsOf(workspace.displayName) }}</span>
          <NuxtLink to="/profile" class="text-xs font-medium leading-4 text-ink-700 underline-offset-2 hover:underline max-md:sr-only">{{ workspace.displayName }}</NuxtLink>
          <span class="font-mono text-[10px] leading-4 tracking-[0.5px] text-ink-400 uppercase max-md:hidden">Student</span>
        </div>
        <UButton
          type="button"
          color="neutral"
          variant="ghost"
          size="xs"
          class="min-h-11 min-w-11 px-2 text-xs font-medium text-ink-500 hover:bg-transparent hover:text-ink-900 md:min-h-0 md:min-w-0 md:px-0"
          @click="signOut"
        >
          Sign out
        </UButton>
      </div>
    </header>
    <div
      class="flex shrink-0 border-b border-ink-200 bg-paper md:hidden"
      role="tablist"
      aria-label="Panels"
    >
      <button
        v-for="panel in phonePanels"
        :key="panel.id"
        type="button"
        role="tab"
        class="relative min-h-11 min-w-0 flex-1 truncate border-b-2 px-1 text-sm"
        :class="phonePanel === panel.id ? 'border-brand-600 font-medium text-ink-900' : 'border-transparent font-normal text-ink-500'"
        :aria-selected="phonePanel === panel.id"
        @click="choosePanel(panel.id)"
      >
        {{ panel.name }}
        <span
          v-if="panel.id === 'conversation' && conversationUnread"
          class="absolute top-1.5 right-1.5 size-2 rounded-full bg-brand-600"
          role="img"
          aria-label="New reply"
        />
      </button>
    </div>
    <div
      class="min-h-0 min-w-0 flex-1"
      :class="layout === 'study'
        ? 'grid grid-cols-1 grid-rows-[minmax(0,1fr)] md:grid-cols-2 md:grid-rows-[auto_minmax(0,1fr)] lg:grid-cols-[220px_minmax(0,1fr)_360px] lg:grid-rows-[minmax(0,1fr)]'
        : ['relative grid grid-cols-1 grid-rows-[minmax(0,1fr)] overflow-hidden bg-ink-50 md:grid-cols-2 lg:block',
           mindmapPanelOpen ? 'md:grid-rows-[minmax(17rem,45%)_minmax(0,1fr)]' : 'md:grid-rows-[minmax(0,1fr)]']"
    >
      <MindmapCanvas
        v-if="layout === 'mindmap'"
        :modules="workspace.courseRoadmap"
        :course="workspace.course"
        :student-id="studentId"
        :mastery-threshold="workspace.masteryThreshold"
        :pending-module-id="pendingModuleId"
        :selecting-module-id="selectingModuleId"
        :positions="modulePositions"
        :save-error="arrangementError"
        :notes="canvasNotes"
        :note-links="noteToNoteLinks"
        :selected-note-id="selectedNoteId"
        @select-module="selectMindmapModule"
        @clear-selection="selectedMindmapModuleId = ''"
        @prefetch-module="prefetchModule"
        @moved="onMindmapMoved"
        @import-local="importLocalArrangement"
        @reset-arrangement="resetMindmapArrangement"
        @note-moved="onNoteMoved"
        @select-note="selectMindmapNote"
      />
      <CourseRoadmap
        v-else
        class="md:col-span-2 md:row-start-1 lg:col-span-1 lg:col-start-1 lg:row-start-1"
        :class="phonePanel === 'roadmap' ? 'max-md:flex' : 'max-md:hidden'"
        :modules="workspace.courseRoadmap"
        :mastery-threshold="workspace.masteryThreshold"
        :progress="workspace.progress"
        :weak-spots="workspace.weakSpots"
        :pending-module-id="pendingModuleId"
        :selecting-module-id="selectingModuleId"
        @select-module="selectModule"
        @prefetch-module="prefetchModule"
      />
      <div v-show="layout === 'study'" :class="studyFrame('working')">
        <WorkingArea
          :area="workspace.workingArea"
          :plan="workspace.learningPlan"
          :plan-starting="planStarting"
          :mode="workingMode"
          :student-id="studentId"
          :selecting="selecting"
          :select-error="selectError"
          :pending-module-name="pendingModuleName"
          :submitting="sending"
          :answering="answering"
          :selecting-exercise-id="selectingExerciseId"
          :expanded="workingAreaExpanded"
          @update:mode="chooseMode"
          @update:expanded="workingAreaExpanded = $event"
          @select-exercise="selectExercise"
          @draft="onDraft"
          @run="onRun"
          @run-finished="onRunFinished"
          @pasted="onPasted"
          @active="markPracticeActivity"
          @running="onPracticeRunning"
          @submit="submitCode"
          @quiz-answer="answerQuiz"
          @start-plan="startPlan"
        />
      </div>
      <div
        :role="layout === 'mindmap' ? 'complementary' : undefined"
        :aria-label="layout === 'mindmap' ? 'Mindmap panel' : undefined"
        :class="layout === 'study' ? studyFrame('conversation') : [
          mindmapPanelChrome,
          'z-10 min-h-0 min-w-0 flex-col gap-3 overflow-hidden bg-paper p-4',
          'max-md:absolute max-md:inset-x-0 max-md:bottom-0 max-md:h-[min(75%,36rem)] max-md:rounded-t-2xl max-md:border max-md:border-ink-200',
          'md:col-span-2 md:row-start-2 lg:absolute lg:top-4 lg:right-4 lg:h-[40rem] lg:max-h-[calc(100%-2rem)] lg:w-[360px]',
          !mindmapPanelOpen ? 'hidden' : phonePanel === 'notes' ? 'flex' : 'max-md:hidden md:flex',
        ]"
      >
        <div v-if="layout === 'mindmap'" class="shrink-0 border-b border-ink-200 pb-3">
          <div class="flex items-start justify-between gap-2">
            <h2 class="min-w-0 flex-1 text-sm font-medium text-ink-900">
              {{ currentModuleName }}
            </h2>
            <UButton
              ref="closePanelButton"
              type="button"
              color="neutral"
              variant="ghost"
              class="-mt-2 -mr-2 min-h-11 min-w-11 shrink-0 justify-center rounded-sm text-lg text-ink-600 hover:text-ink-900"
              aria-label="Close the mindmap panel"
              @click="setMindmapPanelOpen(false)"
            >
              <span aria-hidden="true">×</span>
            </UButton>
          </div>
          <p v-if="selectedMindmapModule?.state === 'closed'" class="text-sm text-ink-600">
            {{ selectedMindmapModule.name }} · {{ selectedMindmapModule.closedReason }}
          </p>
          <p v-else-if="selecting" role="status" class="text-sm text-ink-600">Opening module…</p>
          <p v-else-if="selectError && selectedMindmapModuleId" role="alert" class="text-sm text-ink-600">{{ selectError }}</p>
          <NuxtLink
            v-else
            :to="layoutTarget('study')"
            class="inline-flex min-h-11 items-center text-sm font-medium text-brand-700 underline"
            @click="phonePanel = 'working'"
          >
            Study this module
          </NuxtLink>
        </div>
        <MindmapNotes
          v-if="layout === 'mindmap'"
          class="min-h-0 flex-1"
          :notes="notes"
          :links="noteLinks"
          :modules="noteModules"
          :selected-id="selectedNoteId"
          :default-module-id="selectedMindmapModuleId"
          :saving="addingNote"
          :saved="noteSaved"
          :error="noteError"
          @select="selectedNoteId = $event"
          @save="saveNote"
          @remove="deleteNote"
          @link="linkNotes"
          @unlink="unlinkNotes"
        />
        <ConversationPanel
          v-if="layout === 'study'"
          :messages="workspace.conversation"
          :display-name="workspace.displayName"
          :portrait-url="portraitUrl"
          :incoming-quote="incomingQuote"
          :asking-approach="askingApproach"
          :trace="latestTrace"
          :deskmate-on="workspace.deskmateOn"
          :deskmate-busy="deskmateBusy"
          :deskmate-error="deskmateError"
          :notice="workspace.notice"
          :sending="sending"
          :send-error="sendError"
          :streaming-teacher="streamingTeacher"
          :streaming-deskmate="streamingDeskmate"
          :loading="pendingModuleName.length > 0"
          :floating="false"
          @send="sendMessage"
          @active="markPracticeActivity"
          @open-learn="openInLearn"
          @toggle-deskmate="saveDeskmate"
        />
      </div>
      <UButton
        v-if="layout === 'mindmap' && !mindmapPanelOpen"
        ref="reopenPanelButton"
        type="button"
        class="absolute top-4 right-4 z-10 min-h-11 rounded-lg bg-accent px-4 text-sm font-medium text-on-accent shadow-md hover:bg-accent-hover"
        :class="phonePanel === 'notes' ? 'flex' : 'max-md:hidden md:flex'"
        aria-label="Open the mindmap panel"
        @click="setMindmapPanelOpen(true)"
      >
        Notes
      </UButton>
    </div>
    <StudySuggestionToast
      v-if="workspace.studySuggestion && campus !== null"
      :key="workspace.studySuggestion.key"
      :suggestion="workspace.studySuggestion"
      :busy="suggestionBusy"
      :error="suggestionError"
      @close="closeSuggestion(false)"
      @follow="closeSuggestion(true)"
    />
    <button
      v-if="askButton"
      type="button"
      class="fixed z-30 min-h-11 rounded-full bg-accent px-3 text-sm font-medium text-on-accent shadow-md"
      :style="{ left: `${askButton.x}px`, top: `${askButton.y}px` }"
      @mousedown.prevent="askQuote"
    >
      Ask
    </button>
  </main>
</template>
