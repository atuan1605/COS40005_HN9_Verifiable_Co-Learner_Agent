<script setup lang="ts">
import type { LecturerCourse, LecturerResponse } from '#shared/lecturer'
import { isProductOwner } from '~/staff/landing'
import ClassOverview from '~/components/lecturer/ClassOverview.vue'
import CourseEditor from '~/components/lecturer/CourseEditor.vue'
import CourseInsightsPanel from '~/components/lecturer/CourseInsightsPanel.vue'
import CoursePreviewPanel from '~/components/lecturer/CoursePreviewPanel.vue'
import StudentRoster from '~/components/lecturer/StudentRoster.vue'

definePageMeta({ middleware: 'signed-in' })
useHead({ title: 'Lecturer' })

const productOwner = ref(false)
onMounted(async () => {
  const role = (url: string) => $fetch(url as '/api/staff-role')
  productOwner.value = await isProductOwner(role)
})

async function signOut() {
  await useNuxtApp().$supabase.auth.signOut()
  await navigateTo('/sign-in')
}

const { data, error, status } = await useFetch<LecturerResponse>('/api/lecturer', {
  key: 'lecturer-courses',
  getCachedData: () => undefined,
})

const pane = ref<'overview' | 'insights' | 'editor' | 'preview'>('overview')

const historyLabels: Record<string, string> = {
  seeded: 'Course seeded',
  course_spec_imported: 'Course spec published',
}
const drafts = reactive<Record<string, number>>({})
const saving = ref<string | null>(null)
const notice = ref('')
const saveError = ref('')
const importing = ref(false)

async function importSpec(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || importing.value || saving.value) return
  importing.value = true
  notice.value = ''
  saveError.value = ''
  try {
    await $fetch('/api/lecturer/spec', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: await file.text(),
    })
    data.value = await $fetch<LecturerResponse>('/api/lecturer')
    delete drafts.intro_python
    notice.value = 'Course spec imported.'
  }
  catch (error) {
    const statusCode = (error as { statusCode?: number }).statusCode
    saveError.value = statusCode === 400
      ? 'Choose a valid JSON course spec for the Python course.'
      : 'Could not import the course spec.'
  }
  finally {
    importing.value = false
  }
}

function percentage(value: number) {
  return new Intl.NumberFormat('en', { style: 'percent', maximumSignificantDigits: 15 }).format(value)
}

async function saveThreshold(course: LecturerCourse) {
  if (saving.value || importing.value) return
  saving.value = course.id
  notice.value = ''
  saveError.value = ''
  try {
    const threshold = (drafts[course.id] ?? course.masteryThreshold * 100) / 100
    data.value = await $fetch<LecturerResponse>('/api/lecturer', {
      method: 'POST',
      body: { courseId: course.id, threshold },
    })
    delete drafts[course.id]
    notice.value = 'Mastery threshold saved.'
  }
  catch {
    saveError.value = 'Could not save the mastery threshold.'
  }
  finally {
    saving.value = null
  }
}
const dateTime = new Intl.DateTimeFormat('en', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
})
</script>

<template>
  <div class="flex min-h-dvh flex-col bg-muted">
    <header class="phone-safe-top shrink-0 border-b border-default/80 bg-default px-4 py-4 md:px-8">
      <div class="mx-auto flex w-full max-w-[86rem] items-center justify-between gap-4">
        <p class="flex items-center gap-2 text-sm font-semibold tracking-tight text-highlighted">
          <img src="/swinburne-fpt-logo.webp" alt="" width="871" height="705" class="block h-8 w-auto shrink-0">
          Verifiable Co-Learner
        </p>
        <div class="flex items-center gap-4">
          <NuxtLink
            v-if="productOwner"
            to="/admin"
            class="text-sm text-muted underline decoration-transparent underline-offset-4 hover:text-highlighted hover:decoration-current"
          >
            Administrator page
          </NuxtLink>
          <button
            type="button"
            class="min-h-11 text-sm text-muted underline decoration-transparent underline-offset-4 hover:text-highlighted hover:decoration-current md:min-h-0"
            @click="signOut"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>

    <main class="phone-safe-bottom mx-auto flex w-full max-w-[90rem] flex-1 flex-col gap-6 p-4 md:p-8">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h1 class="text-xl font-semibold tracking-tight text-highlighted">Lecturer</h1>
        <nav class="flex flex-wrap gap-2" aria-label="Lecturer sections">
          <button v-for="item in [['overview', 'Overview'], ['insights', 'Insights'], ['editor', 'Editor'], ['preview', 'Preview']] as const" :key="item[0]" type="button" class="min-h-11 rounded-sm px-3 text-sm" :class="pane === item[0] ? 'bg-accent text-on-accent' : 'border border-default'" @click="pane = item[0]">{{ item[1] }}</button>
        </nav>
      </div>
      <CourseEditor v-if="pane === 'editor'" course-id="intro_python" />
      <CoursePreviewPanel v-if="pane === 'preview'" course-id="intro_python" />
      <p v-if="status === 'pending'" role="status" class="text-sm text-muted">Loading courses…</p>
      <p v-else-if="error" role="alert" class="text-sm text-default">
        {{ error.statusCode === 403 ? 'This page is for lecturers.' : 'Courses are unavailable right now.' }}
      </p>
      <p v-else-if="!data?.courses.length" class="text-sm text-muted">You have no courses.</p>
      <p v-if="notice" role="status" class="text-sm text-default">{{ notice }}</p>
      <p v-if="saveError" role="alert" class="text-sm text-rose-700">{{ saveError }}</p>
      <CourseInsightsPanel v-if="pane === 'insights' && data?.courses.length" :courses="data.courses" />
      <section
        v-for="course in pane === 'overview' ? data?.courses : []"
        :key="course.id"
        class="flex flex-col gap-4"
        :aria-label="course.title"
      >
        <h2 class="text-lg font-semibold text-highlighted">{{ course.title }}</h2>
        <ClassOverview :course="course" />
        <StudentRoster :course="course" />
        <div class="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-[1fr_1fr_2fr]">
          <form class="rounded-xl border border-default bg-default p-5 shadow-xs" @submit.prevent="saveThreshold(course)">
            <h3 class="text-sm font-semibold text-highlighted">Mastery threshold</h3>
            <p class="mt-1 text-sm text-muted">Current threshold {{ percentage(course.masteryThreshold) }}</p>
            <div class="mt-3 flex flex-wrap items-center gap-2">
              <input
                :value="drafts[course.id] ?? percentage(course.masteryThreshold).replace('%', '')"
                @input="drafts[course.id] = ($event.target as HTMLInputElement).valueAsNumber"
                type="number"
                min="50"
                max="99"
                step="any"
                required
                aria-label="Mastery threshold (%)"
                class="min-h-11 w-24 rounded-md border border-default bg-default px-3 text-default"
              >
              <span class="text-sm text-muted" aria-hidden="true">%</span>
              <button
                type="submit"
                :disabled="saving !== null || importing"
                class="ml-auto min-h-11 rounded-md bg-accent px-4 text-sm font-medium text-on-accent hover:bg-accent-hover disabled:opacity-50"
              >
                {{ saving === course.id ? 'Saving…' : 'Save threshold' }}
              </button>
            </div>
          </form>
          <div v-if="course.id === 'intro_python'" class="rounded-xl border border-default bg-default p-5 shadow-xs">
            <h3 class="text-sm font-semibold text-highlighted">Course spec</h3>
            <p class="mt-1 text-sm text-muted">Modules, quizzes and exercises as one JSON file.</p>
            <div class="mt-3 flex flex-wrap gap-2">
              <a
                href="/api/lecturer/spec?courseId=intro_python"
                download="intro_python.json"
                class="inline-flex items-center min-h-11 rounded-md border border-default px-4 text-sm font-medium text-highlighted hover:bg-ink-50"
              >Export course spec</a>
              <!-- The browser's own file button is drawn in the browser's language, so the
                   input is hidden and this label is the visible English button. -->
              <label
                class="inline-flex cursor-pointer items-center focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-brand-600 min-h-11 rounded-md border border-default px-4 text-sm font-medium text-highlighted hover:bg-ink-50"
                :class="importing || saving !== null ? 'pointer-events-none opacity-60' : ''"
              >
                {{ importing ? 'Importing…' : 'Import course spec' }}
                <input
                  type="file"
                  accept=".json,application/json"
                  :disabled="importing || saving !== null"
                  class="sr-only"
                  @change="importSpec"
                >
              </label>
            </div>
          </div>
          <section class="rounded-xl border border-default bg-default shadow-xs p-5 md:col-span-2 xl:col-span-1">
            <h3 class="text-sm font-semibold text-highlighted">Course history</h3>
            <p v-if="!course.history.length" class="mt-3 text-sm text-muted">No course history yet.</p>
            <ul v-else class="mt-1 max-h-64 divide-y divide-default overflow-y-auto">
              <li
                v-for="(entry, index) in course.history"
                :key="index"
                class="py-2.5 text-sm"
              >
                <p class="text-default">
                  <template v-if="entry.previousThreshold !== undefined && entry.masteryThreshold !== undefined">
                    Mastery threshold changed from {{ percentage(entry.previousThreshold) }} to {{ percentage(entry.masteryThreshold) }}
                  </template>
                  <template v-else>{{ historyLabels[entry.action] ?? entry.action }}</template>
                </p>
                <p class="text-xs text-muted [overflow-wrap:anywhere]">{{ entry.actorEmail }}, <time :datetime="entry.time">{{ dateTime.format(new Date(entry.time)) }} UTC</time></p>
              </li>
            </ul>
          </section>
        </div>
      </section>
    </main>
  </div>
</template>
