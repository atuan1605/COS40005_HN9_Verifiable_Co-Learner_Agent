# Component: cyber-security

> [C4 index](../../README.md) / Level 3: Components / Turn and admin server

`web/server/cyber-security/`, the injection suite and the run that tests the agents with it. It loads and validates
the committed suite, turns it into the listing the Cyber Security page shows, and streams a Cyber test run
case by case. When the stream closes it writes one Cyber test record, and the product owner's routes list, open and
delete those records. Everything outside the folder goes through `index.ts`. Part of [server/00-overview.md](00-overview.md).

Legend: solid = runtime import, dashed = type-only import, thick = runtime link with no import. Blue = this
component, grey = other components.

```mermaid
flowchart LR
  classDef comp fill:#1f6fd0,stroke:#164f96,color:#ffffff
  classDef near fill:#4a5568,stroke:#2d3748,color:#ffffff
  classDef ext fill:#8a5a00,stroke:#5c3c00,color:#ffffff
  linkStyle default stroke:#8b949e,stroke-width:1.5px

  spa["<b>Cyber Security page</b>"]:::near
  suiteRoute["<b>api/admin/security-suite.get.ts</b>"]:::near
  runRoute["<b>api/admin/security-run.post.ts</b>"]:::near
  recordsRoute["<b>api/admin/security-records.get.ts</b>"]:::near
  recordRoute["<b>api/admin/security-records/[id].get.ts</b>"]:::near
  deleteRoute["<b>api/admin/security-records/[id].delete.ts</b>"]:::near
  admin["<b>admin/handle-admin.ts</b>"]:::near
  auth["<b>auth/staff-session-email.ts</b>"]:::near
  turn["<b>turn/handle-turn.ts</b>"]:::near
  agents["<b>agents/index.ts</b>"]:::near
  lm["<b>language-model/index.ts</b>"]:::near
  shield["<b>verify-shield/index.ts</b>"]:::near
  sandbox["<b>sandbox/index.ts</b>"]:::near
  studentModel["<b>student-model/index.ts</b>"]:::near
  course["<b>course/index.ts</b>"]:::near
  storage["<b>storage</b><br/>memory stores, supabase stores"]:::near
  sharedTypes["<b>shared/injection-suite.ts</b>"]:::near
  yaml["<b>injection-suite.yaml</b><br/>committed asset"]:::near

  subgraph cyber["cyber-security"]
    direction TB
    index["<b>index.ts</b><br/>the interface"]:::comp
    suite["<b>injection-suite.ts</b><br/>parseInjectionSuite, suiteView"]:::comp
    handleSuite["<b>handle-suite.ts</b><br/>handleSuiteRequest"]:::comp
    handleRun["<b>handle-run.ts</b><br/>handleRunRequest, one run"]:::comp
    handleRecords["<b>handle-records.ts</b><br/>list, detail and delete"]:::comp
    run["<b>run-suite.ts</b><br/>runInjectionSuite"]:::comp
    fixture["<b>fixture.ts</b><br/>the fixture student, module,<br/>exercise and their text"]:::comp
  end

  spa ==>|"GET /api/admin/security-suite"| suiteRoute
  spa ==>|"POST /api/admin/security-run"| runRoute
  spa ==>|"GET /api/admin/security-records"| recordsRoute
  spa ==>|"GET /api/admin/security-records/:id"| recordRoute
  spa ==>|"DELETE /api/admin/security-records/:id"| deleteRoute
  suiteRoute -->|"handleSuiteRequest,<br/>InjectionSuiteInvalidError"| index
  suiteRoute -->|"SignInRequiredError,<br/>ProductOwnerRequiredError"| admin
  suiteRoute -->|"staffSessionEmail"| auth
  suiteRoute ==>|"the committed asset<br/>(useStorage)"| yaml
  runRoute -->|"handleRunRequest, runInjectionSuite,<br/>budget and errors"| index
  runRoute -->|"SignInRequiredError,<br/>ProductOwnerRequiredError"| admin
  runRoute -->|"staffSessionEmail"| auth
  runRoute -->|"createConfiguredAgents"| agents
  runRoute -->|"resolveModelChoice,<br/>modelAddressLocked"| lm
  runRoute -->|"verifyShieldForTurn"| shield
  runRoute ==>|"the committed asset<br/>(useStorage)"| yaml
  runRoute -->|"the model, shield and<br/>record stores"| storage
  recordsRoute -->|"handleRecordsRequest"| index
  recordsRoute -->|"2 error classes"| admin
  recordsRoute -->|"staffSessionEmail"| auth
  recordsRoute -->|"the record store"| storage
  recordRoute -->|"handleRecordRequest,<br/>CyberTestRecordNotFoundError"| index
  recordRoute -->|"2 error classes"| admin
  recordRoute -->|"staffSessionEmail"| auth
  recordRoute -->|"the record store"| storage
  deleteRoute -->|"handleDeleteRecordRequest,<br/>CyberTestRecordNotFoundError"| index
  deleteRoute -->|"2 error classes"| admin
  deleteRoute -->|"staffSessionEmail"| auth
  deleteRoute -->|"the record store"| storage
  index --> suite
  index --> handleSuite
  index --> handleRun
  index --> handleRecords
  index --> run
  handleSuite -->|"requireProductOwner"| admin
  handleSuite --> suite
  handleSuite -.->|"type: InjectionSuiteView"| sharedTypes
  handleRun -->|"requireProductOwner"| admin
  handleRun -->|"InjectionSuiteInvalidError"| handleSuite
  handleRun --> suite
  handleRun -.->|"type: CyberTestRecordStore"| storage
  handleRun -.->|"type: InjectionRunEvent"| sharedTypes
  handleRecords -->|"requireProductOwner"| admin
  handleRecords -.->|"type: CyberTestRecordStore"| storage
  handleRecords -.->|"types: record list item<br/>and detail"| sharedTypes
  run -->|"handleTurn"| turn
  run -.->|"type: Agents"| agents
  run -->|"createFakeSandbox, type: Sandbox"| sandbox
  run -->|"createMemoryUnlockStore"| studentModel
  run -->|"fixtureCourse (one module)"| course
  run -->|"memory conversation and course stores"| storage
  run --> fixture
  run -.->|"types: run events"| sharedTypes
  suite -.->|"category ids and labels"| sharedTypes

  style cyber fill:none,stroke:#8b949e,stroke-dasharray:5 4
```

## Interface (`index.ts`)

| Export | Kind | What it is for |
|---|---|---|
| `parseInjectionSuite(text)` | function | Reads the YAML and answers either the suite or every problem in it at once. Pure. |
| `suiteView(suite)` | function | The listing the page shows: categories in a fixed order, each with its cases and no forbidden fragments. |
| `minimumCasesPerCategory` | constant | 15. |
| `InjectionCase`, `InjectionPriorTurn`, `InjectionSuite` | types | What the parser and the run work with. A case keeps its forbidden fragments on the server. |
| `InjectionSuiteParseResult` | type | `{ ok: true, suite }` or `{ ok: false, problems }`. |
| `handleSuiteRequest(request)` | function | The administrator check, then load, parse and list. |
| `InjectionSuiteInvalidError` | class | `statusCode` 500 and the `problems`, so the route can answer every one of them. |
| `handleRunRequest(request)` | function | The administrator check, the one-run guard, load and parse, then the run's event stream wrapped so the guard is released however the stream ends and one Cyber test record is written when it closes. |
| `InjectionRunInProgressError` | class | `statusCode` 409, refused before any model call. |
| `runInjectionSuite(suite, deps)` | function | The run itself, as an async generator of run events. |
| `injectionRunBudgetMs` | constant | Four minutes. |
| `InjectionRunDeps` | type | The agents, the captured shield state, the provider and model label, and the test-only overrides. |
| `handleRecordsRequest(request)` | function | The administrator check, then the stored records newest first, without their case results. |
| `handleRecordRequest(request, id)` | function | The administrator check, then one record with its case results and the per-family tally derived from them. |
| `handleDeleteRecordRequest(request, id)` | function | The administrator check, then the record's removal, answering `{ deleted: true }`. |
| `parseRecordId(segment)` | function | Reads the id from a path segment only when it is digits; anything else is not found. |
| `CyberTestRecordNotFoundError` | class | `statusCode` 404, for an unknown or malformed id. |
| `CyberTestRecordsRequest` | type | What the records routes pass in: the confirmed email, `adminEmails` and the record store. |
| `InjectionSuiteRequest`, `InjectionRunRequest` | types | What a route passes in: the confirmed email, `adminEmails`, a loader for the committed text, and for a run the generator to stream, the optional guard callbacks and the record store. |
| `fixtureStudentId`, `fixtureModuleId`, `fixtureExerciseId`, `fixtureExerciseTitle`, `fixtureHint`, `fixtureMisconception`, `fixtureSolution` | constants | The fixed world a case runs in (the Loops module and its summing exercise) and the text its forbidden fragments are authored against. |
| `fixtureCourse` | value | The one-module course a run places every case in. Built by `courseFromSpec` in `fixture.ts`, so the case world never reads the real course. |

## The suite file

`web/server/assets/injection-suite.yaml` is committed with the code and loaded through the Nitro asset storage. Its
shape is `version: 1` and a non-empty `cases` list. Each case has an `id`, a `category` from the eight in
`shared/injection-suite.ts`, an `agent` (`teacher` or `deskmate`), a `prompt`, one or more `forbiddenFragments`, and
optionally `priorTurns` (each with `role` and `text`) and a `note` for the page.

The parser judges the whole file before any case runs. Text that is not YAML comes back as that one problem; once it
parses, every shape problem (wrong field type, unknown category, an empty `forbiddenFragments`) comes back in one
list. With the shape right, duplicate case ids and every category under fifteen cases are collected together. A
route answers with one 500 carrying the list, and the page shows every problem.

The listing keeps the forbidden fragments on the server. The page receives each case's prompt, family, agent, count
of earlier turns and note, which is enough to show and label it without publishing what a reply must not contain.

The committed suite holds 120 cases, fifteen in each of the eight families. Its fragments are authored against the
fixture module's solution, last hint rung and misconception correction, and against the real agent prompt text, so
they do not drift with the course spec. Because the run places every case in the fixture course, no fragment can
name text the agents never hold.

## A run

`runInjectionSuite` yields one `start` event, then a `case` event for each case as it finishes, then one `done`
event.

| Event | Fields | When |
|---|---|---|
| `start` | `totalCases`, `provider`, `model`, `startedAt`, `verifyShieldOn` | Once, before any case. `verifyShieldOn` is the saved switch the route read once, so a later change does not reach a run in flight. |
| `case` | `id`, `category`, `agent`, `prompt`, `verdict`, `leakedFragment`, `replyExcerpt`, `priorTurns` | As each case lands, up to three at a time (`concurrency` defaults to 3). |
| `done` | `total`, `passed`, `leaked`, `stopped`, `durationMs` | Once at the end, `stopped` being `complete` or `budget`. Absent when the run is cancelled. |

Each case builds its own in-memory world: the one-module fixture course served by a memory course store, one
conversation holding the fixture student with the Loops module unlocked and its summing exercise as the resume
point, then any earlier turns the case carries. It calls `handleTurn` with
the case's prompt, its addressed agent and the captured `verifyShieldOn`, exactly as a real student turn would. The
case is a Leak when the agent's last new reply contains one of its forbidden fragments,
compared as literal text without regard to case; a leak carries the fragment and the first 400 characters of the
reply. Messages before the prompt are never counted as the reply, so a seeded earlier turn cannot decide a case.

The run schedules cases until all have started or the four-minute budget is reached; with the budget reached it
stops scheduling, finishes the cases already running and closes with `stopped: 'budget'`. Nothing the run touches
is persisted, apart from the one Cyber test record described next. A cancel aborts the route's signal, the engine
returns without a `done` event, and the generator's `finally` releases the one-run guard.

## The Cyber test record

`handleRunRequest` reads the stream it returns and, when that stream closes, writes one [Cyber test
record](../server/08-storage.md) with the run's `start` facts (start time, provider, model label, shield state,
total cases), its suite version, every `case` event it delivered, and the counts and score computed from them. A
run that delivered `done` is stored `complete` or `budget`; a stream that closed without `done` is stored
`cancelled` with only the cases the browser received, and its duration is the time since `start`. A record with no
finished case holds a null score, never zero. A refused caller, an invalid suite and a second concurrent run write
nothing, because they fail before a stream exists. A run that fails before its `start` event also writes
nothing, since there are no facts to identify it by. The record store's `record` can reject: the failure is
logged and ignored, so the stream, the browser's status and the run are unchanged. The browser posts nothing
about results; only the events already streamed decide the record.

## The records API

Three product-owner routes serve the history the page shows: `GET /api/admin/security-records` lists stored records
newest first by the database's `created_at` then `id`, each line carrying the identity and every list fact but never
the case results; `GET /api/admin/security-records/:id` returns one record with its stored cases and the per-family
tally, which the handler derives with `securitySummary` rather than counting by hand; and
`DELETE /api/admin/security-records/:id` removes one and answers `{ deleted: true }`. An unknown id, and a path
segment that is not digits only (which would let `0x10` or `1e3` name a record), is a 404 before any store read or
removal. There is no update route and no pagination: a
record is immutable apart from being deleted. Every call refuses a caller who is not the product owner before touching
the store. The shared contracts are `CyberTestRecordListItem`, the list line, and `CyberTestRecordDetail`, the line
plus `cases` and `categories`; both live in `shared/injection-suite.ts` with `CyberTestStop`.

The one-run flag lives in the route (`security-run.post.ts`), so one run streams per server instance. The route
passes `begin` and `end`; `handleRunRequest` claims the flag after the administrator check and before loading the
suite, refuses a second run with `InjectionRunInProgressError` (409), and wraps the stream so `end` releases the flag
however it finishes, is cancelled, or fails. The route also decides the model: the saved settings or the environment,
the `resolveModelChoice` guard against a fake or locked address, `provider` as `fake` or `real`, and the label the
page shows.

## The score summary

The page does not wait for `done` to show totals. `securitySummary` in `shared/injection-suite.ts` is a pure
function of the events that have arrived: passed, leaked, the number finished of the total, the per-category tally
of the families reached, the model label, the start time and the duration so far. The score is the share of
finished cases with no leak, and is null until one finishes. Nothing on the page is stored, so a reload starts
blank; the run's record is kept server-side.

## Verified imports

- Imports: runtime `requireProductOwner` from [`admin`](09-admin.md), `handleTurn` from [`turn`](02-turn.md),
  `createFakeSandbox` from [`sandbox`](14-sandbox.md), `createMemoryUnlockStore` from
  [`student-model`](05-student-model.md), `courseFromSpec` from [`course`](04-course.md), and the memory
  conversation and course stores from [`storage`](08-storage.md). Types only from [`agents`](06-agents.md)
  (`Agents`), [`sandbox`](14-sandbox.md) (`Sandbox`), [`storage`](08-storage.md) (`CyberTestRecordStore`) and
  [`shared`](../shared.md) (the suite view, run events, category ids, agent and labels). External:
  `zod` and `yaml`. The suite asset is read by the routes, not here.
- Runtime importers, all through `index.ts`: `api/admin/security-suite.get.ts` (`handleSuiteRequest`,
  `InjectionSuiteInvalidError`), `api/admin/security-run.post.ts` (`handleRunRequest`, `runInjectionSuite`,
  `injectionRunBudgetMs`, `InjectionRunInProgressError`, `InjectionSuiteInvalidError`),
  `api/admin/security-records.get.ts` (`handleRecordsRequest`), `api/admin/security-records/[id].get.ts`
  (`handleRecordRequest`, `parseRecordId`, `CyberTestRecordNotFoundError`) and
  `api/admin/security-records/[id].delete.ts` (`handleDeleteRecordRequest`, `parseRecordId`,
  `CyberTestRecordNotFoundError`).
- Tests: `cyber-security-suite.test.ts` (parse, validate, list, administrator gate), `cyber-security-run.test.ts`
  (events, verdicts, shield pass-through, cancel, budget, summary arithmetic, and the record archived at the
  request seam from a memory store), `cyber-security-records.test.ts` (list order and shape, detail with the derived
  tally, delete, unknown and malformed ids, and the owner gate before any store call). All import from
  `server/cyber-security`.
- The suite asset is loaded by the suite and run routes through `useStorage('assets:server')`; nothing else reads it.

## Notes

- The fixture world is not the course store: `handleTurn` is given an in-memory course store serving only
  `fixtureCourse`, so a run never reads the real course and never writes student data, decisions or activity. The
  decision log is not part of a run's result.
- A case addresses one agent. The other agent never answers that turn, as with a student naming an agent in the
  workspace.
- The run's `model` label reads `Fake model` when the configured provider is the fake one; the page shows that
  provider warning above the results so a rehearsal is not mistaken for a test of the real agent.
