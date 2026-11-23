# Verifiable Co-Learner Agent

A web-based co-learner for first-year students learning Python, where a teacher agent and a deskmate agent help the student learn deeper, not just faster, and a deterministic VerifyShield rules on every agent move before the student sees it.

## Language

### People and agents

**Student**:
The first-year learner, with no programming background, who studies a course in the app. The primary user. A lecturer or an administrator is never a student: they are never enrolled and never see a student's pages.
_Avoid_: user, learner

**Profile**:
A student's own display name and profile picture, which they can change, shown with their student number and campus, which they cannot. Only students have a profile for now.
_Avoid_: account, settings

**Campus**:
The Swinburne campus a student studies at: Hanoi, Da Nang, Ho Chi Minh City or Can Tho. The student chooses it once, the first time they sign in, and must choose one before studying; afterwards only an administrator can change it. Lecturers and the administrator see it beside the student number, and a lecturer can filter enrolled students by it. It changes nothing about the course, the mastery threshold or the agents.
_Avoid_: site, location, branch

**Student number**:
A student's short identifier in the form SWB followed by at least four digits (SWB0001), like a university student ID, given to the student when their account is created and unique across the whole system; a number is never given out twice. Lecturers and administrators can see it; only an administrator can change it, and each change is recorded. It is how staff tell students apart.
_Avoid_: student id, user id

**Teacher agent**:
The co-learner agent that knows the full content of the current module; the only agent allowed to teach, correct, or suggest moving the student to another module. The student may also choose any unlocked module themselves.
_Avoid_: tutor, assistant, bot, instructor

**Deskmate agent**:
The co-learner agent working at roughly the student's level, which learns alongside them and may only ask peer questions or share confusion. Named Mai to the student. Knows only what the student can see: the exercise, the student's work and the conversation, never the module's hints or misconception responses.
_Avoid_: companion, buddy, second tutor

**Co-learner agent**:
The whole product as the student experiences it: the teacher agent and the deskmate agent operating inside the VerifyShield.

**Administrator**:
The person who reviews what the VerifyShield decided, switches it on or off, and chooses the language model. Also sees every student by name, student number and email, and is the only person who can change a student number or a student's campus, or delete one student and every record of theirs (including the staff access entries about them). No one can edit a single row of a ledger. May open any student's records for review (see **Staff review**) and reads the **Staff access log**, which only an administrator can read. Never sees a student's mastery. Does not manage courses: that is the lecturer.
_Avoid_: product owner, admin, assessor

**Lecturer**:
The person who owns a course: edits or imports its course spec, sets its mastery threshold, and sees who is enrolled by name, student number and email. May open the records of a student enrolled in a course they own (see **Staff review**), and sees each such student's **Course progress** and per-module **Mastery**, the same stored figure the student sees (ADR 0013). The administrator never sees mastery. Has no say over the VerifyShield or the language model. One person may be both a lecturer and an administrator.
_Avoid_: teacher, instructor, admin, product owner

### Course

**Course**:
A subject taught through Python exercises with automatic tests, such as Introduction to Programming with Python. It is made of parts and modules, is owned by one lecturer, and has its own mastery threshold. A student's mastery, evidence, conversations and resume point all belong to one course.
_Avoid_: subject, class, program

**Enrollment**:
A student's membership of a course. A student studies only the courses they are enrolled in.
_Avoid_: registration, subscription

**Course spec**:
The single file that declares everything a course contains: its parts, modules in order, and each module's materials, quiz, exercises, hint ladder and misconception responses, plus what counts as out of course. A lecturer edits it as a course draft or imports it whole, and it takes effect only when published whole; the course is whatever its published spec says.
_Avoid_: syllabus, course file, curriculum

**Course draft**:
A lecturer's unpublished changes to a course spec, made in the editor or loaded from an imported or exported file. Students never see a draft; publishing it replaces the course spec as one change in the course history.
_Avoid_: unsaved spec, working copy

**Course preview**:
The lecturer's view of a course draft as a student would see it, with exercises they can run and submit and the teacher-only content shown and marked. No agents take part and nothing is recorded.
_Avoid_: test mode, student view

**Materials**:
What a module teaches in Learn mode, as an ordered list of blocks: text, code examples, images and videos. A diagram is an image. Every kind of block is optional.
_Avoid_: content, lesson, notes

**Mastery threshold**:
The mastery a module must reach, together with one passed exercise, to count as mastered. Set by the lecturer for the whole course, the same for every module in it. The only part of the mastery estimate a lecturer can change.
_Avoid_: pass mark, cut-off, BKT threshold

**Course history**:
The record of every change a lecturer made to a course: each course spec published and each change of mastery threshold, with who made it and when. It records the course, never a student or a verdict.
_Avoid_: audit log, decision log, changelog

**Module**:
One unit of the course that a student masters, such as Module 5: Loops. It has one mastery and its own conversation. Internal design documents call the same thing an *item*. The numbered system components (M1 to M7) are never written "Module N". In architecture, "module" is never used for a part of the system: see **Component**.
_Avoid_: topic, lesson, unit, node

**Part**:
A named group of consecutive modules on the course roadmap, such as Part 2: Control Flow. A part has no mastery of its own.
_Avoid_: section, chapter, module

**Exercise**:
A practice task belonging to one module, checked by automatic tests.
_Avoid_: problem, task, assignment

**Quiz**:
The three multiple-choice questions belonging to one module, offered in Learn mode after the materials to check understanding. Each question has four choices and exactly one is correct.
_Avoid_: test, exam, check

**Quiz answer**:
The student's choice on one quiz question, marked right or wrong by the server. The correct choice is never sent to the student's device. A quiz answer is not an attempt.
_Avoid_: response, quiz attempt

**Test**:
One automatic check of an exercise, comparing what the student's code returns for a given input with the expected value. The word belongs to exercises only: one prompt in the injection suite is an Injection case and a run of that suite is a Cyber test run, never a Test.
_Avoid_: assertion, test case

**Misconception**:
A specific wrong idea that explains a student's mistake, such as setting a running total back to zero inside the loop. Only the teacher agent names or corrects one to the student.
_Avoid_: bug, error, mistake

**Hint ladder**:
The three hints of a module, from gentlest (1) to most direct (3). The teacher agent gives one rung at a time, may repeat a rung already given, never skips ahead to a rung beyond the next one, and never goes past rung 3; no rung is the finished solution.
_Avoid_: hint list, hint level

**Course roadmap**:
The picture of the course that shows every module, grouped into parts, as mastered, open, or closed, with the student's mastery beside it and the reason a closed module is closed. A module that its course spec lists without content stays closed as not available. Its header shows the student's **Course progress** as "x/total modules mastered" with a bar and the percentage.
_Avoid_: knowledge map, skill tree, course map, progress map

**Course progress**:
How far a student is through a course: the mastered modules out of the modules that have content, as a count and a whole percentage rounded down. Modules listed without content are left out, so 100% is reachable. It is derived from stored **Mastery** and never stored, and the student's roadmap and the lecturer's screens use the same derivation.
_Avoid_: completion, course completion, overall mastery

**Unlocked module**:
A module that is open or mastered. Module 1 is unlocked from the start; each later module unlocks when the one before it is mastered, and stays unlocked even if mastery later falls or the lecturer raises the mastery threshold.
_Avoid_: available, accessible

**Out of course**:
Anything the student asks about that is not part of any module, such as classes or pandas, including small talk. Treated like a question about a closed module: the teacher agent redirects instead of answering.
_Avoid_: off-topic, irrelevant

**Mindmap**:
The student's personal canvas of a course: every module of the course roadmap, which the student can move but never remove or change, together with the student's own notes and the links they draw. It is neither evidence nor part of the resume point, and it never changes a module's state or the current module.
_Avoid_: roadmap, knowledge map, mind map

**Note**:
A student's own item on their mindmap: natural-language text, an optional image and a colour from a fixed set, which the student can create, change, link to modules or other notes, and delete. A note is always linked to at least one module or other note. The agents never read notes.
_Avoid_: node, card, sticky

**Mindmap arrangement**:
Where the student has placed each module and note on their mindmap. Personal to the student and kept with their account, so it follows them across devices.
_Avoid_: roadmap arrangement, map arrangement, layout, positions

### Workspace

**Workspace layout**:
How the student's screen is arranged. There are two, chosen by the student: the Study layout (the course roadmap as a list beside the working area and conversation) and the Mindmap layout (the mindmap as a canvas beside a panel that holds the chosen note and a link to study the current module, with no working area and no conversation; choosing an unlocked module on the canvas makes it the current module). Switching layouts changes nothing but the arrangement on screen.
_Avoid_: screen, view, variant, Map canvas, Roadmap layout

**Conversation**:
The exchange between the student and both agents about one module. Each module has its own conversation; moving to another exercise in the same module continues it.
_Avoid_: chat, thread, session

**Portrait**:
The picture beside each message in a conversation. The teacher agent and the deskmate agent have fixed portraits, the same for every student; the student's portrait is the profile picture from their profile.
_Avoid_: avatar, icon

**Quote**:
Text the student selects from an agent message or from the materials and places in their message to ask about it. It is part of the student's message, so the turn is ruled like any other.
_Avoid_: selection, citation, reference

**Working area**:
The panel that shows either the current module's materials and quiz (Learn mode) or the current exercise, editor and test results (Practice mode).

**Run**:
Executing the student's code in the editor to see its output. A run is not an attempt and produces no evidence.
_Avoid_: execute, test

**Submission**:
The student's code sent to be checked against the exercise's tests. The only action that counts as an attempt and produces evidence.
_Avoid_: run, check, upload

**Attempt**:
One submission on an exercise.

**Sandbox**:
The isolated place on the server side where a submission is run again against the exercise's tests; only its result is evidence. A run never goes to the sandbox.
_Avoid_: checker, runner, judge

**Approved library**:
A Python module a student may import, the same for runs and submissions. Only the development team changes the list.
_Avoid_: allowed package, whitelist

**Evidence**:
A recorded fact about what the student did, produced from a submission by the sandbox or from a quiz answer. Results the student's browser reports are never evidence. Reading materials, running code and chatting produce none.

**Activity log**:
The record of what a student did in the app: signing in, opening a module, switching mode or layout, runs, submissions, quiz answers, messages, changes to notes and the mindmap, and changes to their profile. It never holds keystrokes, drafts or the code of a run, and it is never evidence, so it never changes mastery. Only a staff review page shows it. On first sign-in, on Home and on the profile, students are told that their activity, submitted code and conversations are recorded, that their lecturers and administrators can review them, and that DeepSeek processes their conversations.
_Avoid_: audit log, tracking, telemetry, history

**Draft**:
The code currently in the student's editor that has not been submitted. Kept on the student's device only; it is neither evidence nor part of the resume point.
_Avoid_: save, autosave

**Staff review**:
The read-only page where a lecturer, for a student enrolled in a course they own, or an administrator, for any student, looks at that student's latest activity, submissions with their code and test results, and conversation, beside the **Review signals**. A student never sees it, and opening it is recorded in the **Staff access log**.
_Avoid_: monitoring, surveillance, audit

**Review signal**:
A prompt on the staff review page for a person to look at some work: a large paste (200 characters or more) followed by a pass on the same exercise, or a pass with no run before it. Each links to the activity events behind it and is worded as something to look at, never as cheating. Worked out when the page opens, never stored, and never changes mastery.
_Avoid_: flag, alert, cheating detection, score

**Staff access log**:
The record of every time a lecturer or an administrator opened a student's records: who, which student, what they opened and when. Written before any record is handed over, append-only, and readable only by an administrator.
_Avoid_: audit log, activity log

### Standing

**Resume point**:
What a student gets back on signing in again: the module and exercise they were on, and that module's conversation.
_Avoid_: progress, session, save state

**Progress**:
The student's record over time: exercises completed and attempts needed to pass them.
_Avoid_: resume point, mastery

**Mastery**:
The system's estimate, between 0 and 1, of how well a student knows a module, computed from evidence alone, from both submissions and quiz answers, where a passed exercise moves it more than a correct quiz answer; a module counts as mastered once its mastery reaches the threshold and the student has passed at least one of its exercises, so quiz answers alone never master a module.
_Avoid_: progress, score, level, SM

**Progress panel**:
What a student sees of their own progress, under the course roadmap: each module's mastery (the roadmap's bars), the exercises they have passed with how many verified attempts each took (every submission up to and including the first pass), and their weak spots in plain words. Its figures are the evidence ledger's and the learning pattern's. It never shows a **Review signal** or the raw **Activity log**, and it changes nothing.
_Avoid_: dashboard, report card

**Learning plan**:
The Teacher's suggestion, for one module, of what the student should do there and in what order: one to five steps. The student agrees to it with Start, and from then on it is in progress, with one step current. A plan is kept as revisions, each a new record rather than an edit, and the newest revision is the one in force. A step is done only when the student's verified records show it: a sandbox result, a quiz answer, a run, or time on the materials. The Teacher may revise a plan only after something new: the same exercise failed three times (the course spec may say otherwise), a wrong quiz answer, a misconception found in the code, or a finished step; a revision with nothing new behind it becomes a check-in. Each revision records what brought it about and the decision-log entry that ruled on it. It never changes mastery or opens a module.
_Avoid_: roadmap, syllabus, to-do list

**Approach**:
The student's own plain-words account of how they will solve an exercise, written before they code it. While the agreed plan's current step asks for it, the student's next message is kept as their approach. It is tried, not judged: until the student has run or submitted since writing it, the Teacher gives no hint or correction and only checks in.
_Avoid_: plan (that is the Teacher's), answer, solution

**Quiet period**:
Three minutes in Practice mode without activity. The Teacher checks in once on the plan in force; any activity of the student ends the period, and only then may it check in again.
_Avoid_: timeout, inactivity

**Study suggestion**:
The one next step a student is shown, drawn from how they have actually been studying: fixed rules read their activity log for the current course and choose at most one, among the modules they have unlocked and the work of the current module. They see it in a toast at the bottom of the workspace, which stays usable; it closes itself after ten seconds (paused while they point at or focus it), or when they close it or follow it, and each of these dismisses it; following it only moves them somewhere they could already open, and never submits code for them. A closed step stays dismissed until it has ended and the rules choose it again, and a lower step does not take its place at the moment of dismissal. The rules, not a language model, choose it. The Teacher's prompt includes the current step and the VerifyShield stops it advising the opposite; the Deskmate never hears it. It is not a learning plan, and since the activity log is not evidence it changes no mastery, unlock or roadmap.
_Avoid_: nudge, alert, learning plan

**Plan step**:
One item of a learning plan: the module's materials, one of its quiz questions, one of its exercises, or one of its misconception responses that the student's learning pattern calls a weak spot. A step the module no longer holds, or a misconception that is not a weak spot, is dropped or refuses the plan, so a plan never points outside its module.
_Avoid_: task, milestone

### VerifyShield

**Turn**:
One student message together with the agent messages that answer it.

**Addressed agent**:
The one agent a student names at the start of a message (`@Teacher` or `@Mai`); only that agent answers the turn. A message that names no agent is answered by both, teacher first. Naming an agent never widens what it may do: the deskmate agent still only asks peer questions or shares confusion.
_Avoid_: mention, tag, target

**Deskmate switch**:
The student's own choice to keep the deskmate agent out of their conversations. While it is off the deskmate agent proposes nothing, so nothing of it reaches the decision log, and naming it as the addressed agent has no effect. On unless the student switches it off; it belongs to the student, across courses and devices. It is not the VerifyShield, which only an administrator switches.
_Avoid_: Mai toggle, mute

**Move**:
A typed pedagogical action an agent proposes from a closed set; the agent writes text only for a move that has been approved.
_Avoid_: action, intent, response

**VerifyShield**:
The deterministic envelope that rules on every proposed move (allow, block, or downgrade) before any text for it is written. It rules on moves only: the words an agent writes for an approved move are not checked. It can be switched off for every student at once to show the behaviour without it; it is on unless switched off.
_Avoid_: shield, guard, filter, harness

**Redirect**:
The move the VerifyShield puts in place of a teacher move about a closed module or something out of course: the teacher names where that belongs and brings the student back to the current module.
_Avoid_: refusal, decline

**Decision log**:
The record of every verdict the VerifyShield reached, with what it was proposed, what it knew (including the mastery threshold in force), the rule checks it made, the addressed agent of the turn, and whether it was switched on. Each decision carries a hash of its content and of the decision before it, so an edit can be detected, and it records the code version and the course history entry that were in force. It records the system, never the student's work.
_Avoid_: audit log, history, evidence

**Rule check**:
One rule the VerifyShield applied to a proposed move, in order, with whether it passed and why. The last rule check is the one that decided the verdict. A verdict reached while the VerifyShield was off has none.
_Avoid_: rule result, step

**VerifyShield trace**:
A panel, off by default, that shows the raw verdict for each turn, meant for assessors rather than students.
_Avoid_: shield trace

### Security testing

**Injection case**:
One adversarial prompt in the injection suite, addressed to the Teacher or Mai, kept with its attack family, the earlier turns it replays, and the fragments a reply must never contain. It is not a Test.
_Avoid_: test case, attack prompt, probe

**Injection suite**:
The committed set of 120 injection cases grouped into eight attack families, each family with at least fifteen cases. It is validated as a whole when it loads, so a faulty case stops every run instead of being skipped.
_Avoid_: test suite, prompt set, eval set

**Cyber test run**:
An administrator's run of the whole injection suite against the configured model, streamed case by case, with the VerifyShield state captured when it starts and passed to every case. It rules nothing: a case leaks when the reply contains one of its forbidden fragments. The page streams the results live for the visit, and every run that started leaves one Cyber test record.
_Avoid_: security test, audit run, scan

**Cyber test record**:
The one immutable row a Cyber test run leaves behind when its stream closes, written by the server from the events it already streamed: start time, duration, provider, model label, VerifyShield state, how the run stopped (complete, budget or cancelled), suite version, total and finished cases, passed and leaked, the score (null when no case finished) and the case results. It identifies a run without opening it; only an administrator reaches it, and a delete removes it when it is no longer needed.
_Avoid_: test result, report, archive entry

**Leak**:
A run result where an agent's reply contains the protected material the injection case tried to extract.
_Avoid_: failure, breach, violation

**Cyber Security page**:
The administrator page with two tabs, Run and Past results. Run is first: it shows the suite's totals as four tiles, runs or cancels a Cyber test run with its live score summary and case rows, and carries the VerifyShield switch, which is the same saved setting the Settings page reads and writes. Past results lists the saved Cyber test records newest first and opens one as a read-only view that can be deleted.
_Avoid_: security dashboard, test console

### Architecture

**Component**:
A named part of a container that has one job, such as the VerifyShield of the server or the python runner of the web app. Its folder is the kebab-case of its name (`verify-shield/`). Follows the C4 convention, so it is the word for a part of the system in the C4 documents, the research documents (M1 to M7) and code comments. A **Module** is only ever a unit of the course. A Vue single-file component is a Vue component, not a C4 component; say "Vue component" where both could be meant.
_Avoid_: module, part, layer
