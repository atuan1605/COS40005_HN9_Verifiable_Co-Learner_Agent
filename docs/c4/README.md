# C4 architecture of the Verifiable Co-Learner

The files are numbered in the order to read them, from the whole system down to single components.

| Order | Level | Question it answers | File |
|---|---|---|---|
| 1 | Level 1: System Context | Who uses the system and which outside systems does it depend on? | [01-context.md](01-context.md) |
| 2 | Level 2: Containers | What runs, and how do the parts talk to each other? | [02-containers.md](02-containers.md) |
| 3 | Level 3: Components | What is inside each container, component by component? | [03-components/](03-components/) (below) |
| 4 | Deployment (supplementary view) | Where does it run today, and what is planned? | [04-deployment.md](04-deployment.md) |

Deployment is a supplementary view in C4. It is numbered 4 only to keep the reading order; C4's own "Level 4" is
code, which is not drawn here.

The [local ML demo](local-ml-demo.md) has its own container and component views. A presenter runs it on a development machine.

## Level 3: Components

Two containers have code of their own, so each has an overview (component level) followed by one file per component.
Components are ordered the way a request travels through them (server) or the way a screen is built (web app).

### Turn and admin server (`web/server/`)

| File | Component | One line |
|---|---|---|
| [00-overview.md](03-components/server/00-overview.md) | All server components | How the server components call each other |
| [01-routes.md](03-components/server/01-routes.md) | routes | HTTP endpoints: `/turn`, `/api/student`, `/api/admin`, the security suite and run, `/course-outline` |
| [02-turn.md](03-components/server/02-turn.md) | turn | Runs one turn from request to screen state |
| [03-verify-shield.md](03-components/server/03-verify-shield.md) | verify-shield | VerifyShield: allow, block or downgrade each move, and the on/off switch |
| [04-course.md](03-components/server/04-course.md) | course | Course modules, study content, roadmap |
| [05-student-model.md](03-components/server/05-student-model.md) | student-model | Evidence ledger, Bayesian Knowledge Tracing, the unlock chain and where the student stands |
| [06-agents.md](03-components/server/06-agents.md) | agents | Teacher and Deskmate: moves, role table, prompts, and the agents built on a language model |
| [07-language-model.md](03-components/server/07-language-model.md) | language-model | The real language model and the choice of model settings |
| [08-storage.md](03-components/server/08-storage.md) | storage | Store interfaces and their Supabase versions |
| [09-admin.md](03-components/server/09-admin.md) | admin | Administrator handler: model, shield, decisions |
| [10-lecturer.md](03-components/server/10-lecturer.md) | lecturer | Lecturer handler: courses, enrollments, course history |
| [11-student.md](03-components/server/11-student.md) | student | Profile, mindmap and the actions the browser reports |
| [12-activity-recorder.md](03-components/server/12-activity-recorder.md) | activity recorder | Append-only activity log shared by the student handler and the turn |
| [14-sandbox.md](03-components/server/14-sandbox.md) | sandbox | Re-runs a submission; only its report is evidence |
| [16-learning-pattern.md](03-components/server/16-learning-pattern.md) | learning pattern | Where the student's work says they struggle and how they study, one pure function of their records |
| [17-learning-plan.md](03-components/server/17-learning-plan.md) | learning plan | The Teacher's one-to-five-step plan for a module, agreed by the student, kept as append-only revisions |
| [18-study-suggestion.md](03-components/server/18-study-suggestion.md) | study suggestion | The one next step chosen by fixed rules from the student's activity log, and the memory of what they dismissed |
| [19-cyber-security.md](03-components/server/19-cyber-security.md) | cyber-security | The injection suite, its validation, and the streamed run that tests the agents with it |

### Web app (`web/app/`)

| File | Component | One line |
|---|---|---|
| [00-overview.md](03-components/web-app/00-overview.md) | All web app components | How the six components relate |
| [01-pages.md](03-components/web-app/01-pages.md) | pages | Workspace, sign-in, About and admin pages |
| [02-workspace-components.md](03-components/web-app/02-workspace-components.md) | workspace components | Chat, roadmap, practice panel, editor |
| [03-about-components.md](03-components/web-app/03-about-components.md) | about components | Sample turn and shield diagram |
| [04-client-helpers.md](03-components/web-app/04-client-helpers.md) | client helpers | Drafts, mindmap arrangement, layout, markdown, intro |
| [05-python-runner.md](03-components/web-app/05-python-runner.md) | python runner | Pyodide worker client and session |
| [06-middleware-and-plugins.md](03-components/web-app/06-middleware-and-plugins.md) | middleware and plugins | Auth guard, Supabase client, layout cookie |

### Shared by both

| File | Component | One line |
|---|---|---|
| [shared.md](03-components/shared.md) | shared (`web/shared/`) | Session helper and turn types used by server and browser |

## How to read the diagrams

- Box colours are fixed so they stay readable in light and dark themes: **blue** is code in this repo (the thing being
  described), **grey** is another part of this repo, **brown** is an external system, **teal** is a database.
- Level 3 arrows: a **solid** arrow is a runtime `import`; a **dashed** arrow is a type-only import (erased at build
  time); a **thick** arrow is a runtime link with no import (an HTTP call, a Worker started with `new Worker`, Nuxt
  auto-registration, a Nuxt plugin or middleware attached by name).
- Every arrow label says what is called or why.

## How the component diagrams were checked

Level 3 relationships come from the real `import` statements in `web/server`, `web/shared`, `web/app`, `web/tests`
and `web/e2e`: 553 runtime imports inside the repo (496 relative and 57 through a Nuxt alias such as `#shared/turn` or
`~/drafts/store`), 0 unresolved. Type-only imports are erased at build time, so each component's "Verified" section
lists its type-only importers in a table instead of drawing them. Where there is no import, the link is drawn
thick and the file that creates it is named in that section. Each component file ends with the importers and tests
found by that check.

## Reading paths

- **New to the project:** 1, 2, then `server/00-overview.md` and `web-app/00-overview.md`.
- **Working on how agents are kept in line:** `02-turn.md`, `03-verify-shield.md`, `06-agents.md`, `07-language-model.md`.
- **Working on the student screen:** `web-app/01-pages.md`, `02-workspace-components.md`, `05-python-runner.md`.
- **Planning the AWS move:** `04-deployment.md`, then `08-storage.md` and `shared.md` (the code that depends on Supabase).

## Not covered

- The database schema in `supabase/migrations/` is not drawn; the tables each store uses are listed in `08-storage.md`.
- The sandbox on Lambda in Sydney is described in `infra/sandbox` and drawn in `04-deployment.md`. The account owner applies that plan.
