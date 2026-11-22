// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  modules: ['@nuxt/ui'],
  runtimeConfig: {
    supabaseSecretKey: '',
    // real is the OpenAI-compatible client. DeepSeek is that client with
    // base URL https://api.deepseek.com. A saved record on /admin replaces these.
    model: 'real',
    modelApiKey: '',
    modelBaseUrl: 'https://api.deepseek.com',
    modelName: 'deepseek-flash',
    adminEmails: 'owner@example.com',
    lecturerEmails: process.env.LECTURER_EMAILS ?? 'lecturer@example.com',
    // on unless set to off, false, or 0. A saved verify_shield_settings row replaces this.
    verifyShield: 'on',
    // Blank runs the local image. The deployed server names the Lambda function in Sydney.
    sandboxFunction: '',
    sandboxRegion: 'ap-southeast-2',
    sandboxImage: 'colearner-sandbox',
    public: {
      supabaseUrl: '',
      supabasePublishableKey: '',
    },
  },
  css: ['~/assets/css/main.css'],
  // A security run streams for minutes. Vercel allows at most 300 seconds on
  // the Hobby plan, so the engine keeps its own shorter budget below this
  // ceiling and always closes the stream itself.
  nitro: {
    vercel: {
      functions: { maxDuration: 300 },
    },
  },
  // Route changes (sign-in, workspace, admin) crossfade through the View
  // Transitions API; app/plugins/layout-transition.client.ts covers the
  // Study and Mindmap switch, which stays on the same page. Nuxt 4.6 only
  // registers its plugin from this experimental flag.
  experimental: {
    viewTransition: true,
  },
  app: {
    head: {
      htmlAttrs: { lang: 'en' },
      link: [{ rel: 'icon', type: 'image/jpeg', href: '/swb.jpg' }],
      meta: [
        {
          name: 'viewport',
          content: 'width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content',
        },
      ],
    },
  },
  colorMode: {
    preference: 'light',
    fallback: 'light',
    // Don't reuse a dark preference saved by another app on localhost.
    storageKey: 'colearner-color-mode',
  },
  vite: {
    optimizeDeps: {
      include: [
        '@codemirror/lang-python',
        '@codemirror/language',
        '@codemirror/state',
        '@lezer/highlight',
        'codemirror',
      ],
      exclude: ['pyodide'],
    },
    worker: {
      format: 'es',
    },
  },
})
