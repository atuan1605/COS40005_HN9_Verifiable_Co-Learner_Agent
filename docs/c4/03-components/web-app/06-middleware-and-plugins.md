# Component: middleware and plugins

> [C4 index](../../README.md) / Level 3: Components / Web app

Nuxt route guards and client plugins. Nothing imports them; Nuxt loads them by folder, and pages attach the
middleware by name. Part of [web-app/00-overview.md](00-overview.md).

Legend: solid = runtime import, thick = runtime link with no import (Nuxt middleware by name, plugin injection).
Blue = this component, grey = other components, brown = external.

```mermaid
flowchart LR
  classDef comp fill:#1f6fd0,stroke:#164f96,color:#ffffff
  classDef near fill:#4a5568,stroke:#2d3748,color:#ffffff
  classDef ext fill:#8a5a00,stroke:#5c3c00,color:#ffffff
  linkStyle default stroke:#8b949e,stroke-width:1.5px

  pages["<b>pages</b><br/>index, admin, lecturer,<br/>about, sign-in, sign-up"]:::near
  studentId["<b>shared/student-id.ts</b>"]:::near
  layout["<b>workspace/layout.ts</b>"]:::near
  auth["<b>Supabase Auth</b>"]:::ext
  router["<b>vue-router</b>"]:::ext

  subgraph mw["middleware and plugins"]
    direction TB
    signed["<b>middleware/signed-in.ts</b><br/>Sends signed-out users to /sign-in"]:::comp
    wl["<b>middleware/workspace-layout.ts</b><br/>Adds the remembered ?layout="]:::comp
    sl["<b>middleware/staff-landing.ts</b><br/>Sends staff from / to their page"]:::comp
    sb["<b>plugins/supabase.client.ts</b><br/>Provides $supabase"]:::comp
    lt["<b>plugins/layout-transition.client.ts</b><br/>Crossfade on layout switch"]:::comp
  end

  pages ==>|"index, lecturer, admin: by name"| signed
  pages ==>|"index: by name"| wl
  pages ==>|"index: by name"| sl
  sb ==>|"$supabase"| pages
  sb ==>|"$supabase"| signed
  signed -->|"sessionStudentId (server),<br/>studentIdFromAuth (client)"| studentId
  wl -->|"resolveWorkspaceLayout, cookie"| layout
  sb ==>|"createBrowserClient<br/>@supabase/ssr"| auth
  lt ==>|"beforeResolve, afterEach"| router

  style mw fill:none,stroke:#8b949e,stroke-dasharray:5 4
```

## Files

| File | Responsibility (from the code) |
|---|---|
| `middleware/signed-in.ts` | On the server: no session in the request cookies leads to `/sign-in`. In the browser: no signed-in user from `$supabase` leads to `/sign-in`. |
| `middleware/workspace-layout.ts` | On `/` without `?layout=` in the browser, replaces the route with one that carries the remembered layout, so Back returns to the layout that was showing. The server renders `/` from the cookie without a redirect. |
| `middleware/staff-landing.ts` | On `/`, asks one role check through `staff/landing` (`GET /api/staff-role`, which answers `{productOwner, lecturer}` with 200 for a student too, so a student's page load leaves no 403 in the server log) and redirects an administrator to `/admin` and a lecturer to `/lecturer`. A move within `/` (a layout switch) is left alone. |
| `plugins/supabase.client.ts` | Creates the browser Supabase client with the URL and publishable key from the public runtime config, and provides it as `$supabase`. |
| `plugins/layout-transition.client.ts` | Uses the View Transitions API to crossfade the switch between Study and Mindmap on the same page without remounting the panels. Skipped when reduced motion is requested or the API is missing. |

## Verified

- Imports from this repo: `signed-in.ts` imports `shared/student-id`; `staff-landing.ts` imports `staff/landing`; `workspace-layout.ts` imports `workspace/layout`. The two plugins import nothing from this repo.
- Who reads `$supabase` (search for `$supabase`): `pages/sign-in.vue`, `pages/sign-up.vue`, `pages/index.vue`, `pages/home.vue`, `middleware/signed-in.ts`.
- Middleware use (search for `definePageMeta`): `pages/index.vue`, `pages/lecturer.vue` and the two admin pages only.
- No test imports these files.
