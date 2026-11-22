<script setup lang="ts">
import { isLecturer } from '~/staff/landing'

// The header both administrator pages share: the nav between Decisions and
// Settings, and the switch to the lecturer page for an administrator who also
// lectures.
const route = useRoute()

const pages = [
  { to: '/admin', label: 'Decisions' },
  { to: '/admin/students', label: 'Students' },
  { to: '/admin/access-log', label: 'Access log' },
  { to: '/admin/security', label: 'Cyber Security' },
  { to: '/admin/settings', label: 'Settings' },
] as const

const alsoLectures = ref(false)
onMounted(async () => {
  // A direct $fetch argument makes TypeScript compare every route. Naming the
  // one route this call uses keeps that comparison small.
  const role = (url: string) => $fetch(url as '/api/staff-role')
  alsoLectures.value = await isLecturer(role)
})

const linkClass = 'text-sm text-muted underline decoration-transparent underline-offset-4 hover:text-highlighted hover:decoration-current'

async function signOut() {
  await useNuxtApp().$supabase.auth.signOut()
  await navigateTo('/sign-in')
}
</script>

<template>
  <header class="phone-safe-top shrink-0 border-b border-default/80 bg-default px-4 py-3 md:px-8">
    <div class="mx-auto flex w-full max-w-[90rem] flex-wrap items-center justify-between gap-x-6 gap-y-2">
      <div class="flex flex-wrap items-center gap-x-6 gap-y-2">
        <p class="flex items-center gap-2 text-sm font-semibold tracking-tight text-highlighted">
          <img
            src="/swinburne-fpt-logo.webp"
            alt=""
            width="871"
            height="705"
            class="block h-8 w-auto shrink-0"
          >
          Verifiable Co-Learner
        </p>
        <nav
          aria-label="Administrator"
          class="flex items-center gap-1"
        >
          <NuxtLink
            v-for="item in pages"
            :key="item.to"
            :to="item.to"
            class="inline-flex min-h-11 items-center rounded-sm px-3 text-sm font-medium md:min-h-9"
            :class="route.path === item.to ? 'bg-brand-50 text-brand-700' : 'text-muted hover:bg-elevated hover:text-highlighted'"
            :aria-current="route.path === item.to ? 'page' : undefined"
          >
            {{ item.label }}
          </NuxtLink>
        </nav>
      </div>
      <div class="flex items-center gap-4">
        <NuxtLink
          v-if="alsoLectures"
          to="/lecturer"
          :class="linkClass"
        >
          Lecturer page
        </NuxtLink>
        <button
          type="button"
          :class="linkClass"
          class="min-h-11 md:min-h-0"
          @click="signOut"
        >
          Sign out
        </button>
      </div>
    </div>
  </header>
</template>
