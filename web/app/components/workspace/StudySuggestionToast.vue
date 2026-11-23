<script setup lang="ts">
import type { StudySuggestionView } from '#shared/turn'

// The one next step the rules chose from the student's activity, as a toast that leaves the
// workspace usable. Closing it (X, Escape from inside it, or the 10-second timer) and following it all dismiss
// this episode; only following it moves the student, and it never submits code. It never
// takes focus. On phones it sits at the top so the composer stays clear. The page remounts it for each new suggestion, so the timer starts again.
const props = defineProps<{
  suggestion: StudySuggestionView
  busy: boolean
  error: string
}>()

const emit = defineEmits<{ close: [], follow: [] }>()

const lifetimeMs = 10_000
const hovered = ref(false)
const focused = ref(false)
let remainingMs = lifetimeMs
let startedAt = 0
let timer: ReturnType<typeof setTimeout> | undefined
const panel = ref<HTMLElement | null>(null)

// The timer runs only while nobody is reading the toast and no dismissal failed.
const running = computed(() => !hovered.value && !focused.value && !props.busy && !props.error)

function start() {
  startedAt = Date.now()
  timer = setTimeout(() => emit('close'), remainingMs)
}

function pause() {
  clearTimeout(timer)
  timer = undefined
  remainingMs = Math.max(0, remainingMs - (Date.now() - startedAt))
}

watch(running, (now) => {
  if (now) start()
  else pause()
})

// A failed dismissal stops the timer for good: the student retries with X or the button.
watch(() => props.error, (error) => {
  if (error) remainingMs = lifetimeMs
})

// Clicking a button disables it while the dismissal is sent, which drops focus without a focusout
// that names a new target, so the hold is read again once the request settles.
watch(() => props.busy, (busy) => {
  if (!busy) focused.value = panel.value?.contains(document.activeElement) ?? false
})

// Escape closes only from inside the toast, so it never steals Escape from the editor or a dialog.
function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || event.defaultPrevented || props.busy) return
  emit('close')
}

// Only a mouse hovers; a touch's pointerenter must not hold the timer forever.
function onPointerEnter(event: PointerEvent) {
  if (event.pointerType === 'mouse') hovered.value = true
}

function onPointerLeave(event: PointerEvent) {
  if (event.pointerType === 'mouse') hovered.value = false
}

onMounted(() => {
  if (running.value) start()
})

onBeforeUnmount(() => {
  clearTimeout(timer)
})

function onFocusOut(event: FocusEvent) {
  focused.value = panel.value?.contains(event.relatedTarget as Node | null) ?? false
}
</script>

<template>
  <section
    ref="panel"
    aria-live="polite"
    aria-labelledby="study-suggestion-title"
    data-study-suggestion
    class="phone-safe fixed inset-x-0 top-0 z-40 flex flex-col gap-3 border-b border-ink-200 bg-paper p-4 shadow-md md:inset-x-auto md:top-auto md:right-4 md:bottom-4 md:border-t md:w-96 md:rounded-xl md:border"
    @pointerenter="onPointerEnter"
    @pointerleave="onPointerLeave"
    @keydown="onKeydown"
    @focusin="focused = true"
    @focusout="onFocusOut"
  >
    <div class="flex items-start gap-2">
      <div class="flex min-w-0 flex-1 flex-col gap-1">
        <h2 id="study-suggestion-title" class="font-mono text-[10px] leading-4 tracking-[0.5px] text-ink-500 uppercase">
          Your next step
        </h2>
        <p class="text-sm/5 text-ink-900">
          {{ suggestion.sentence }}
        </p>
      </div>
      <button
        type="button"
        aria-label="Close suggestion"
        class="-mt-2 -mr-2 grid size-11 shrink-0 place-items-center rounded-lg text-ink-500 hover:text-ink-900 disabled:opacity-50"
        :disabled="busy"
        @click="emit('close')"
      >
        <svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
    <p
      v-if="error"
      role="alert"
      class="rounded-sm border border-rose-200/80 bg-rose-50 px-[13px] py-[11px] text-xs leading-[19.5px] text-rose-700"
    >
      {{ error }}
    </p>
    <div class="flex justify-end">
      <UButton
        type="button"
        class="min-h-11 rounded-lg bg-accent px-4 text-sm font-medium text-on-accent hover:bg-accent-hover"
        :disabled="busy"
        @click="emit('follow')"
      >
        {{ suggestion.button }}
      </UButton>
    </div>
  </section>
</template>
