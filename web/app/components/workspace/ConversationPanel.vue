<script setup lang="ts">
import type { ConversationMessage, Quote, TurnTrace } from '#shared/turn'
import { addresseeName, addressMenu, chooseAddressee, type AddressedAgent } from '~/workspace/addressed-agent'
import { bubbleClass, eventClass, nameClass, portraitClass, portraitSrc } from '~/workspace/message-style'
import { dateMessages } from '~/workspace/conversation-dates'
import BusySpinner from '../BusySpinner.vue'
import ChatMarkdown from './ChatMarkdown.vue'

const props = defineProps<{
  messages: ConversationMessage[]
  displayName: string
  trace: TurnTrace | null
  sending: boolean
  sendError: string
  streamingTeacher: string
  streamingDeskmate: string
  loading?: boolean
  floating?: boolean
  deskmateOn: boolean
  deskmateBusy?: boolean
  deskmateError?: string
  notice?: string
  portraitUrl?: string | null
  incomingQuote?: Quote | null
  // The plan's current step asks for the student's approach, so the box invites it.
  askingApproach?: boolean
}>()

const emit = defineEmits<{
  send: [text: string, addressedAgent: AddressedAgent | null, quote: Quote | null]
  openLearn: []
  close: []
  toggleDeskmate: [on: boolean]
  active: []
}>()

interface BubbleRow {
  key: string
  kind: 'bubble'
  author: 'student' | 'teacher' | 'deskmate'
  name: string
  role: string
  text: string
  openInLearn: boolean
  writing: boolean
  day: string | null
  time: string | null
  addressedAgent: AddressedAgent | null
  quote: Quote | null
}

interface TypingRow {
  key: string
  kind: 'typing'
  author: 'teacher' | 'deskmate'
  name: string
}

interface EventRow {
  key: string
  kind: 'event'
  name: string
  text: string
  day: string | null
  time: string | null
}

const roleClass = {
  student: 'text-on-self/70',
  teacher: 'text-brand-600',
  deskmate: 'text-amber-700',
} as const

const text = ref('')
const quote = ref<Quote | null>(null)
watch(() => props.incomingQuote, (value) => {
  quote.value = value ?? null
})
const pending = ref('')
const addressee = ref<AddressedAgent | null>(null)
const pendingAddressee = ref<AddressedAgent | null>(null)
const menuIndex = ref(0)
const menu = computed(() => addressee.value ? [] : addressMenu(text.value, props.deskmateOn))
const messageInput = ref<HTMLInputElement | null>(null)

watch(menu, () => {
  menuIndex.value = 0
})

// Switching Mai off takes her chip out of the composer.
watch(() => props.deskmateOn, (on) => {
  if (!on && addressee.value === 'deskmate') addressee.value = null
})

function choose(agent: AddressedAgent) {
  const chosen = chooseAddressee(text.value, agent)
  addressee.value = chosen.addressedAgent
  text.value = chosen.text
  messageInput.value?.focus()
}

function removeAddressee() {
  addressee.value = null
  messageInput.value?.focus()
}

function onKeydown(event: KeyboardEvent) {
  if (menu.value.length > 0) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      menuIndex.value = (menuIndex.value + step + menu.value.length) % menu.value.length
      return
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      choose(menu.value[menuIndex.value]!.agent)
      return
    }
  }
  if (event.key === 'Backspace' && addressee.value && text.value.length === 0) {
    event.preventDefault()
    addressee.value = null
  }
}
const scroller = ref<HTMLElement | null>(null)
let revealObserver: IntersectionObserver | null = null
const mounted = ref(false)

function scrollToNewest() {
  const element = scroller.value
  if (!element || element.clientHeight === 0) return
  element.scrollTop = element.scrollHeight
}

const rows = computed(() => {
  // Dated in the browser's time zone. On the server the times are hidden so
  // the first render cannot disagree with the student's clock.
  const dates = mounted.value
    ? dateMessages(props.messages)
    : props.messages.map(() => ({ day: null, time: null }))
  const shown: Array<BubbleRow | EventRow | TypingRow> = props.messages.map((message, index) => {
    const { day, time } = dates[index]!
    if (message.author === 'event') {
      return {
        key: message.id,
        kind: 'event' as const,
        name: message.name,
        text: message.text,
        day,
        time,
      }
    }
    return {
      key: message.id,
      kind: 'bubble' as const,
      author: message.author,
      name: message.name,
      role: message.role,
      text: message.text,
      openInLearn: message.openInLearn,
      writing: false,
      day,
      time,
      addressedAgent: message.addressedAgent ?? null,
      quote: message.quote ?? null,
    }
  })

  if (props.sending && pending.value) {
    shown.push({
      key: 'pending-student',
      kind: 'bubble',
      author: 'student',
      name: props.displayName,
      role: 'Student',
      text: pending.value,
      openInLearn: false,
      writing: false,
      day: null,
      time: null,
      addressedAgent: pendingAddressee.value,
      quote: quote.value,
    })
  }
  if (props.streamingTeacher) {
    shown.push({
      key: 'streaming-teacher',
      kind: 'bubble',
      author: 'teacher',
      name: 'Teacher',
      role: '',
      text: props.streamingTeacher,
      openInLearn: false,
      writing: true,
      day: null,
      time: null,
      addressedAgent: null,
      quote: null,
    })
  }
  else if (props.sending && pendingAddressee.value !== 'deskmate') {
    shown.push({
      key: 'typing-teacher',
      kind: 'typing',
      author: 'teacher',
      name: 'Teacher',
    })
  }
  if (props.streamingDeskmate) {
    shown.push({
      key: 'streaming-deskmate',
      kind: 'bubble',
      author: 'deskmate',
      name: 'Mai',
      role: 'Deskmate',
      text: props.streamingDeskmate,
      openInLearn: false,
      writing: true,
      day: null,
      time: null,
      addressedAgent: null,
      quote: null,
    })
  }
  else if (props.sending && props.deskmateOn && pendingAddressee.value !== 'teacher') {
    shown.push({
      key: 'typing-deskmate',
      kind: 'typing',
      author: 'deskmate',
      name: 'Mai',
    })
  }
  return shown
})

watch(() => [rows.value.length, props.streamingTeacher, props.streamingDeskmate, props.sending] as const, () => {
  nextTick(scrollToNewest)
})

onMounted(() => {
  mounted.value = true
  const element = scroller.value
  if (!element) return
  let wasHidden = element.clientHeight === 0
  revealObserver = new IntersectionObserver((entries) => {
    const visible = entries.some(entry => entry.isIntersecting)
    if (visible && wasHidden) {
      scrollToNewest()
      nextTick(scrollToNewest)
    }
    wasHidden = !visible
  })
  revealObserver.observe(element)
})

onBeforeUnmount(() => {
  revealObserver?.disconnect()
  revealObserver = null
})

function submit() {
  const value = text.value.trim()
  if (!value || props.sending || menu.value.length > 0) return
  pending.value = value
  pendingAddressee.value = addressee.value
  emit('send', value, addressee.value, quote.value)
}

watch(() => props.sending, (sending) => {
  if (sending) return
  if (!props.sendError && text.value.trim() === pending.value) {
    text.value = ''
    quote.value = null
    addressee.value = null
  }
  pending.value = ''
  pendingAddressee.value = null
})
</script>

<template>
  <section
    class="flex h-full min-h-0 min-w-0 flex-col bg-ink-50/40"
    aria-label="Conversation"
  >
    <header class="flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-ink-200 bg-paper px-4 md:h-14 md:flex-nowrap lg:px-6">
      <div class="flex min-w-0 flex-col gap-0.5">
        <div class="flex items-center gap-2">
          <h2 class="text-xs leading-4 font-semibold tracking-[-0.2px] text-ink-800">
            Conversation
          </h2>
          <span
            v-if="floating"
            class="hidden size-1.5 shrink-0 rounded-full bg-emerald-500 lg:block"
            aria-hidden="true"
          />
        </div>
      </div>
      <div class="flex shrink-0 items-center gap-2">
        <span
          id="conversation-deskmate"
          class="text-[11px] leading-[16.5px] text-ink-500"
        >Deskmate</span>
        <BusySpinner
          v-if="deskmateBusy"
          class="text-ink-400"
        />
        <button
          type="button"
          role="switch"
          class="relative h-11 w-11 shrink-0 disabled:opacity-60 md:h-4 md:w-7 md:rounded-full"
          :class="deskmateOn ? 'md:bg-amber-500' : 'md:bg-ink-200'"
          :aria-checked="deskmateOn"
          :aria-busy="deskmateBusy"
          :disabled="deskmateBusy"
          aria-labelledby="conversation-deskmate"
          @click="emit('toggleDeskmate', !deskmateOn)"
        >
          <span
            class="absolute top-1/2 left-1/2 h-4 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full md:hidden"
            :class="deskmateOn ? 'bg-amber-500' : 'bg-ink-200'"
            aria-hidden="true"
          />
          <span
            class="absolute top-1/2 size-3 -translate-y-1/2 rounded-full bg-paper shadow-[0px_1px_2px_rgba(0,0,0,0.05)]"
            :class="deskmateOn ? 'left-[22px] md:left-3.5' : 'left-[10px] md:left-0.5'"
          />
        </button>
        <button
          v-if="floating"
          type="button"
          class="ml-1 inline-flex size-11 items-center justify-center rounded-sm text-ink-500 hover:bg-ink-100 hover:text-ink-900 md:size-7"
          aria-label="Close conversation"
          @click="emit('close')"
        >
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      </div>
    </header>

    <p
      v-if="deskmateError"
      class="shrink-0 border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700"
      role="alert"
    >
      {{ deskmateError }}
    </p>

    <div
      ref="scroller"
      class="min-h-0 flex-1 overflow-y-auto px-4 py-5"
    >
      <p
        v-if="loading"
        role="status"
        class="text-sm text-ink-400"
      >
        Loading conversation
      </p>
      <p
        v-else-if="rows.length === 0"
        class="text-sm text-ink-400"
      >
        No messages yet.
      </p>
      <ol
        v-else
        class="flex flex-col gap-4"
      >
        <template
          v-for="row in rows"
          :key="row.key"
        >
        <li
          v-if="row.kind !== 'typing' && row.day"
          class="flex w-full items-center gap-3"
          data-day-separator
        >
          <span class="h-px flex-1 bg-ink-200" aria-hidden="true" />
          <span class="text-[11px] leading-4 font-medium text-ink-500">{{ row.day }}</span>
          <span class="h-px flex-1 bg-ink-200" aria-hidden="true" />
        </li>
        <li
          class="flex w-full"
          :class="row.kind === 'event' ? 'justify-center' : row.author === 'student' ? 'justify-end' : 'justify-start'"
        >
          <p
            v-if="row.kind === 'event'"
            :class="eventClass"
          >
            {{ row.name }} · {{ row.text }}<template v-if="row.time">
              · <time data-message-time>{{ row.time }}</time></template>
          </p>
          <div
            v-else-if="row.kind === 'typing'"
            class="flex max-w-[96%] items-start gap-3"
            role="status"
            :aria-label="`${row.name} is writing`"
          >
            <span
              class="mt-0.5 size-11 shrink-0 overflow-hidden rounded-[4px] border"
              :class="portraitClass[row.author]"
              aria-hidden="true"
            >
              <img
                :src="portraitSrc[row.author]"
                alt=""
                class="size-full object-cover [image-rendering:pixelated]"
              >
            </span>
            <article
              class="w-fit max-w-full min-w-0 text-[13px] leading-5"
              :class="bubbleClass[row.author]"
            >
              <p class="mb-0.5 text-[12px] leading-4 font-semibold" :class="nameClass[row.author]">
                {{ row.name }}
              </p>
              <p class="flex items-center gap-1 py-1" aria-hidden="true">
                <span class="size-1.5 animate-pulse rounded-full bg-current opacity-70" />
                <span class="size-1.5 animate-pulse rounded-full bg-current opacity-70 [animation-delay:150ms]" />
                <span class="size-1.5 animate-pulse rounded-full bg-current opacity-70 [animation-delay:300ms]" />
              </p>
            </article>
          </div>
          <div
            v-else
            class="flex max-w-[96%] items-start gap-3"
            :class="row.author === 'student' ? 'flex-row-reverse' : 'flex-row'"
          >
            <span
              class="mt-0.5 size-11 shrink-0 overflow-hidden rounded-[4px] border"
              :class="portraitClass[row.author]"
              :data-portrait="row.author"
              aria-hidden="true"
            >
              <img
                :src="row.author === 'student' && portraitUrl ? portraitUrl : portraitSrc[row.author]"
                alt=""
                class="size-full object-cover"
                :class="row.author === 'student' && portraitUrl ? '' : '[image-rendering:pixelated]'"
              >
            </span>
            <article
              class="w-fit max-w-full min-w-0 text-[13px] leading-5 break-words"
              :class="bubbleClass[row.author]"
              :data-quote-source="row.author === 'student' ? undefined : 'agent'"
            >
              <p class="mb-0.5 flex items-baseline gap-1.5">
                <span
                  class="text-[12px] leading-4 font-semibold"
                  :class="nameClass[row.author]"
                >{{ row.name }}</span>
                <span
                  v-if="row.role"
                  class="text-[11px] leading-4"
                  :class="roleClass[row.author]"
                >{{ row.role }}</span>
                <time
                  v-if="row.time"
                  class="ml-auto pl-2 font-mono text-[10px] leading-4 opacity-60"
                  data-message-time
                >{{ row.time }}</time>
              </p>
              <blockquote
                v-if="row.kind === 'bubble' && row.quote"
                class="mb-1 border-l-2 border-current/30 pl-2 text-[12px] leading-4 opacity-80"
              >{{ row.quote.text }}</blockquote>
              <p v-if="row.author === 'student'">
                <span
                  v-if="row.addressedAgent"
                  class="mr-1 inline-flex rounded-full bg-paper/70 px-1.5 text-[11px] leading-4 font-medium"
                  data-addressed-agent
                >@{{ addresseeName(row.addressedAgent) }}</span>{{ row.text }}
              </p>
              <ChatMarkdown
                v-else
                :text="row.text"
                :writing="row.writing"
              />
              <button
                v-if="row.openInLearn"
                type="button"
                class="mt-2 text-[11px] leading-4 font-medium text-brand-700 underline decoration-brand-300 underline-offset-2 hover:decoration-brand-700"
                @click="emit('openLearn')"
              >
                Open in Learn
              </button>
            </article>
          </div>
        </li>
        </template>
      </ol>
    </div>

    <form
      class="shrink-0 border-t border-ink-200 bg-paper p-3 md:px-4"
      @submit.prevent="submit"
    >
      <ul
        v-if="menu.length > 0"
        id="address-menu"
        role="listbox"
        aria-label="Address an agent"
        class="mb-2 flex flex-col gap-0.5 rounded-[4px] border border-ink-200 bg-paper p-1 shadow-sm"
      >
        <li
          v-for="(option, index) in menu"
          :id="`address-option-${option.agent}`"
          :key="option.agent"
          role="option"
          :aria-selected="index === menuIndex"
          class="flex min-h-11 cursor-pointer items-center rounded-[3px] px-2 text-sm text-ink-800 md:min-h-8 md:text-xs"
          :class="index === menuIndex ? 'bg-brand-50' : 'hover:bg-ink-50'"
          @mousedown.prevent="choose(option.agent)"
        >
          {{ option.name }}
        </li>
      </ul>
      <div class="flex items-center gap-2">
        <div class="flex min-w-0 flex-1 items-center gap-1.5 rounded-[4px] border border-ink-200 bg-ink-50 pl-1.5 focus-within:border-brand-500 focus-within:ring-1 focus-within:ring-brand-500">
          <span
            v-if="quote"
            class="inline-flex max-w-[40%] shrink-0 items-center gap-0.5 rounded-full bg-ink-200 py-0.5 pr-0.5 pl-2 text-xs leading-4 text-ink-800"
          >
            <span class="truncate">{{ quote.text }}</span>
            <button
              type="button"
              class="inline-flex size-6 items-center justify-center rounded-full hover:bg-ink-300"
              aria-label="Remove quote"
              :disabled="sending"
              @click.prevent="quote = null"
            >
              <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          </span>
          <span
            v-if="addressee"
            class="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-brand-100 py-0.5 pr-0.5 pl-2 text-xs leading-4 font-medium text-brand-900"
            data-addressee-chip
          >
            @{{ addresseeName(addressee) }}
            <button
              type="button"
              class="inline-flex size-6 items-center justify-center rounded-full text-brand-700 hover:bg-brand-200"
              :aria-label="`Stop addressing ${addresseeName(addressee)}`"
              :disabled="sending"
              @click.prevent="removeAddressee"
            >
              <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" /></svg>
            </button>
          </span>
          <label class="min-w-0 flex-1">
            <span class="sr-only">Message</span>
            <input
              ref="messageInput"
              data-composer-input
              v-model="text"
              name="message"
:placeholder="askingApproach ? 'Write your approach in your own words, before you code' : 'Message, or @ to address an agent'"
              autocomplete="off"
              aria-autocomplete="list"
              aria-controls="address-menu"
              :disabled="sending"
              class="h-11 w-full bg-transparent pr-[13px] pl-1 text-base text-ink-800 outline-none placeholder:text-ink-400 disabled:opacity-60 md:h-[32px] md:text-xs"
              @keydown="onKeydown"
              @input="emit('active')"
            >
          </label>
        </div>
        <button
          type="submit"
          class="h-11 min-w-11 shrink-0 rounded-[4px] bg-accent px-3 text-xs leading-4 font-medium text-on-accent shadow-[0px_1px_1px_rgba(0,0,0,0.05)] hover:bg-accent-hover disabled:bg-accent disabled:text-on-accent disabled:opacity-100 md:h-[34px] md:min-w-0 md:px-3.5"
          :disabled="sending || text.trim().length === 0"
          :aria-busy="sending"
        >
          <span class="inline-flex items-center gap-1.5">
            <BusySpinner v-if="sending" />
            Send
          </span>
        </button>
      </div>
      <p
        v-if="notice"
        role="status"
        class="mt-2 text-xs text-ink-500"
      >
        {{ notice }}
      </p>
      <p
        v-if="sendError"
        role="alert"
        class="mt-2 text-sm text-rose-600"
      >
        {{ sendError }}
      </p>
    </form>
  </section>
</template>
