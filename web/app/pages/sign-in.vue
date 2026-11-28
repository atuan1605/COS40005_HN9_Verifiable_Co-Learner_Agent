<script setup lang="ts">
import { sessionStudentId } from '#shared/student-id'
import { recordStudentActivity } from '~/activity/record'
import { staffLanding } from '~/staff/landing'
import { claimIntro, introAttribute, introHeadScript, introSeenKey, introStart } from '~/sign-in/intro'

const email = ref('')
const password = ref('')
const errorMessage = ref('')
const credentialsRejected = ref(false)
const pending = ref(false)

const incorrectMessage = 'Email or password is incorrect.'
const unreachableMessage = 'Sign-in is unavailable right now.'

const inputClass = 'min-h-11 rounded-sm px-[13px] py-[9px] text-base/6 ring-ink-300 md:min-h-0 md:text-sm/5'

const requestFetch = useRequestFetch()

// Staff land on their own page; everyone else lands on the course.
async function signedInDestination() {
  return (await staffLanding(requestFetch)) ?? '/'
}

if (import.meta.server) {
  const event = useRequestEvent()
  if (event && await sessionStudentId(event)) {
    await navigateTo(await signedInDestination())
  }
}

useHead({
  title: 'Sign in',
  // Marks <html> before first paint so the intro never flashes the resting layout.
  script: [{ key: 'sign-in-intro', innerHTML: introHeadScript, tagPosition: 'head' }],
})

// A client-side visit (after signing out) never ran the head script.
if (import.meta.client) {
  try {
    if (!localStorage.getItem(introSeenKey) && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      document.documentElement.setAttribute(introAttribute, '')
    }
  }
  catch {}
}

const stage = ref<HTMLElement | null>(null)
const desktopLockup = ref<HTMLElement | null>(null)
const phoneLockup = ref<HTMLElement | null>(null)
const phoneHeader = ref<HTMLElement | null>(null)
const card = ref<HTMLElement | null>(null)

onMounted(() => {
  const root = document.documentElement
  let storage: Storage | undefined
  try {
    storage = localStorage
  }
  catch {}
  const play = claimIntro(storage, matchMedia('(prefers-reduced-motion: reduce)').matches)
  if (play) playIntro()
  root.removeAttribute(introAttribute)
})

onBeforeUnmount(() => document.documentElement.removeAttribute(introAttribute))

function playIntro() {
  const desktop = desktopLockup.value?.offsetParent ? desktopLockup.value : null
  const lockup = desktop ?? phoneLockup.value
  if (!lockup) return
  const box = lockup.getBoundingClientRect()

  let start
  if (desktop && stage.value) {
    const panel = stage.value.getBoundingClientRect()
    start = introStart(box, panel, { x: panel.left + panel.width / 2, y: panel.top + panel.height / 2 }, 2.2, 48)
  }
  else {
    // On a phone the lockup starts in the space between the header and the card.
    const top = phoneHeader.value?.getBoundingClientRect().bottom ?? box.bottom
    const bottom = card.value?.getBoundingClientRect().top ?? top
    const gap = Math.max(bottom - top, 0)
    const maxScale = Math.min(1.8, Math.max(1, (gap * 0.7) / box.height))
    const focusY = gap > box.height * 1.5 ? top + gap / 2 : box.top + box.height / 2
    start = introStart(box, { left: 0, top: 0, width: document.documentElement.clientWidth, height: 0 }, { x: document.documentElement.clientWidth / 2, y: focusY }, maxScale, 16)
  }

  const from = `translate(${start.x}px, ${start.y}px) scale(${start.scale})`
  lockup.animate(
    [
      { offset: 0, opacity: 0, transform: `${from} scale(0.94)`, easing: 'cubic-bezier(0.16, 1, 0.3, 1)' },
      { offset: 0.24, opacity: 1, transform: from },
      { offset: 0.46, opacity: 1, transform: from, easing: 'cubic-bezier(0.65, 0, 0.2, 1)' },
      { offset: 1, opacity: 1, transform: 'none' },
    ],
    { duration: 1400, fill: 'backwards' },
  )

  stage.value?.querySelectorAll<HTMLElement>('[data-intro-rise]').forEach((element, index) => {
    element.animate(
      [
        { opacity: 0, transform: 'translateY(10px)' },
        { opacity: 1, transform: 'none' },
      ],
      { duration: 560, delay: 1080 + index * 110, easing: 'cubic-bezier(0.16, 1, 0.3, 1)', fill: 'backwards' },
    )
  })
}

async function signIn() {
  errorMessage.value = ''
  credentialsRejected.value = false
  pending.value = true
  try {
    const { error } = await useNuxtApp().$supabase.auth.signInWithPassword({
      email: email.value,
      password: password.value,
    })
    if (error) {
      if (error.name === 'AuthRetryableFetchError') {
        errorMessage.value = unreachableMessage
        return
      }
      errorMessage.value = incorrectMessage
      credentialsRejected.value = true
      return
    }
    const destination = await signedInDestination()
    if (destination === '/') await recordStudentActivity({ event: 'signed_in' })
    await navigateTo(destination)
  }
  catch {
    errorMessage.value = unreachableMessage
  }
  finally {
    pending.value = false
  }
}
</script>

<template>
  <div class="flex min-h-dvh flex-col bg-muted lg:grid lg:grid-cols-2">
    <header
      ref="phoneHeader"
      class="phone-safe-top flex shrink-0 items-center border-b border-default/80 bg-default px-4 py-4 md:px-8 lg:hidden"
    >
      <p
        ref="phoneLockup"
        data-intro-lockup
        class="text-base font-semibold tracking-tight text-highlighted"
      >
        <NuxtLink to="/home" class="flex min-h-11 items-center gap-3">
          <img
            src="/swinburne-crest.png"
            alt="Swinburne University of Technology"
            width="190"
            height="288"
            class="block h-10 w-auto shrink-0"
          >
          Verifiable Co-Learner
        </NuxtLink>
      </p>
    </header>

    <aside
      ref="stage"
      class="relative isolate hidden overflow-hidden border-r border-default bg-default p-12 lg:grid lg:min-h-dvh lg:grid-rows-[1fr_auto_1fr] lg:justify-items-center lg:gap-y-10"
    >
      <span
        aria-hidden="true"
        class="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(var(--color-ink-300)_1px,transparent_1px)] bg-size-[22px_22px] opacity-60 [mask-image:radial-gradient(ellipse_at_center,black_20%,transparent_72%)]"
      />
      <span
        aria-hidden="true"
        class="pointer-events-none absolute top-1/2 left-1/2 -z-10 size-[32rem] -translate-x-1/2 -translate-y-1/3 rounded-full bg-sky-200/35 blur-3xl"
      />
      <p
        ref="desktopLockup"
        data-intro-lockup
        class="self-start text-lg font-semibold tracking-tight text-highlighted"
      >
        <NuxtLink to="/home" class="flex items-center gap-5">
          <img
            src="/swinburne-fpt-logo.webp"
            alt="Swinburne University of Technology, in alliance with FPT Education"
            width="871"
            height="705"
            class="block h-24 w-auto shrink-0"
          >
          <span aria-hidden="true" class="h-10 w-px bg-ink-200" />
          Verifiable Co-Learner
        </NuxtLink>
      </p>

      <div class="flex w-full max-w-lg flex-col gap-10">
        <p data-intro-rise class="text-center text-[2.25rem]/[1.12] font-semibold tracking-[-0.02em] text-balance text-highlighted">
          Learn with a teacher and a deskmate beside you.
        </p>

        <AboutSampleTurn data-intro-rise class="bg-paper! shadow-[0_1px_2px_rgb(15_23_42/0.04),0_24px_48px_-20px_rgb(15_23_42/0.18)]" />
      </div>

      <p data-intro-rise class="self-end text-xs tracking-wide text-muted">
        Swinburne University of Technology
      </p>
    </aside>

    <main class="phone-safe-bottom flex flex-1 flex-col items-center justify-center p-4 md:p-6">
      <form
        ref="card"
        class="page-enter flex w-full flex-col gap-6 rounded-xl border border-default bg-default p-4 shadow-[0_1px_2px_rgb(15_23_42/0.04),0_16px_40px_-20px_rgb(15_23_42/0.16)] md:max-w-sm md:p-8"
        @submit.prevent="signIn"
      >
        <div class="flex flex-col gap-1">
          <h1 class="text-2xl font-semibold tracking-tight text-highlighted">
            Sign in
          </h1>
          <p class="text-sm/5 text-muted">
            Pick up your module and conversation where you left off.
          </p>
        </div>
        <p
          v-if="errorMessage"
          role="alert"
          class="flex items-start gap-2.5 rounded-sm border border-rose-200/80 bg-rose-50 px-[13px] py-[11px] text-xs leading-[19.5px] text-rose-700"
        >
          <span class="inline-flex shrink-0 pt-0.5">
            <img
              src="/sign-in-error.svg"
              alt=""
              width="16"
              height="16"
            >
          </span>
          {{ errorMessage }}
        </p>
        <div class="flex flex-col gap-4">
          <label class="flex flex-col gap-1.5 text-xs font-medium leading-4 text-default">
            <span>Email</span>
            <UInput
              v-model="email"
              type="email"
              name="email"
              autocomplete="username"
              required
              color="neutral"
              fixed
              class="w-full"
              :ui="{ base: inputClass }"
            />
          </label>
          <label class="flex flex-col gap-1.5 pb-2 text-xs font-medium leading-4 text-default">
            <span>Password</span>
            <UInput
              v-model="password"
              type="password"
              name="password"
              autocomplete="current-password"
              required
              color="neutral"
              fixed
              class="w-full"
              :aria-invalid="credentialsRejected || undefined"
              :ui="{ base: credentialsRejected ? `${inputClass} ring-rose-300 focus-visible:ring-rose-300` : inputClass }"
            />
          </label>
          <UButton
            type="submit"
            block
            size="lg"
            :loading="pending"
            class="min-h-11 rounded-sm bg-accent text-on-accent px-4 py-2.5 text-sm font-medium shadow-xs hover:bg-accent-hover active:bg-accent-hover disabled:bg-accent md:min-h-0"
          >
            Sign in
          </UButton>
        </div>
      </form>
      <NuxtLink
        to="/sign-up"
        class="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-brand-700 underline-offset-4 hover:underline md:min-h-0"
      >
        New student? Sign up
      </NuxtLink>
      <NuxtLink
        to="/home"
        class="mt-2 inline-flex min-h-11 items-center text-xs font-medium text-muted underline-offset-4 hover:text-highlighted hover:underline md:min-h-0"
      >
        About the co-learner
      </NuxtLink>
    </main>
  </div>
</template>
