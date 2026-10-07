# Phases

Each phase below gives: what you do, what "done" means, and the prompt the
user pastes to run this phase alone in a fresh session. The prompts belong in
`00-RUNBOOK.md` so a new session needs nothing from the previous one.

---

## wt — the worktree

`/wt PURCO-XXXX` and nothing else. The engine does create, setup, install and
`.env` copy, and returns one summary. Do not run `git worktree`, `yarn`, or
`cp` yourself.

- Base is `origin/dev` unless the user names another base. For a **stacked**
  ticket the base is the parent feature branch — the user says so explicitly
  ("create the worktree based on dev", "point it at the parent PR").
- The worktree is a sibling dir: `purco-web@PURCO-XXXX`.
- Then tell the user to `cd` in and run `claude`. Never `claude -w`.

**Isolation is absolute.** A worktree for one ticket does not touch another
ticket's files, even when the tickets are related. Two worktrees that share a
`node_modules` break each other — install in one, and the other's binaries
move under it.

Done: the engine printed its summary and the user is in the new worktree.

---

## intake — everything before an opinion

Gather, in this order:

1. The Linear ticket: description, comments, attachments, `gitBranchName`.
2. Its Linear **project** — sibling tickets often define the shape of this one.
3. The existing context pack `general-access-files/PURCO-XXXX/`, if any.
4. Open PRs on the same feature, and the parent PR when this is stacked.
5. What the worktree already contains — earlier sessions may have left work.
6. The ADRs and `CONTEXT.md` entries the ticket touches.

Then **stop**. Report in under 20 lines: what was asked, what the code does
today, the decisions that block everything else, and any contradiction between
the ticket, the mockups and the code. Then ask your questions.

Write `01-ticket-and-context.md`. Seed `00-RUNBOOK.md` from
`assets/runbook.template.md`.

Prompt:

```
Read the ticket and its whole Linear project, then read every file in
general-access-files/PURCO-XXXX/ and the open PRs for this feature. Also check
what this worktree already has in it. Do not write anything yet and do not
plan. When you are done, tell me in under 20 lines: what is being asked, what
the code does today, the decisions that block the rest, and any contradiction
you found between the ticket, the design and the code. Then ask me your
questions.
```

Done: the report is delivered and the questions are answered.

---

## grill — every decision, settled

Nothing is planned while a decision is open. This phase closes them all.

It has two halves, split by who can speak. An agent cannot hold a
conversation, so the agent frames the questions and the human answers them in
a live session.

### Half 1 — the inquisitor lists the questions

The inquisitor reads `01-ticket-and-context.md` and the code, looks up every
**fact** itself, and writes `02a-open-questions.md`. One numbered entry per
decision, in dependency order, each with the options, what follows from each,
its recommended answer, and whether it blocks the plan. It asks nothing.

A question you could answer by reading the code is not a question. Facts come
from the filesystem, the ADRs, Linear and the read-only Postgres tools.

### Half 2 — the grill

Run `/grilling` over that file, in a live session with the user.

- **One question at a time.** Wait for the answer before the next one. This
  overrides any older instruction to batch questions.
- Walk the dependency order. An answer often removes a later question.
- Give your recommended answer with every question, and name the file, the
  line or the ADR it rests on. The user must not decide blind.
- Name the document whenever an answer contradicts an ADR, a spec, the
  mockups or the code.
- Park what is not the user's call, and write it as `- [ ] <question>`.

Write `03-decisions.md`: one line per settled decision, and an open `- [ ]`
line per parked one. Every later phase treats that file as binding.

**Gate: `plan` refuses to start while `03-decisions.md` is missing or holds an
open `- [ ]` line.** The refusal names what is still open.

Prompt:

```
Read general-access-files/PURCO-XXXX/01-ticket-and-context.md and the code it
names. Look up every fact yourself. Then write 02a-open-questions.md: every
decision this ticket leaves open, in dependency order, with options, your
recommendation and whether it blocks the plan. Then grill me through that
list, one question at a time, and write what we settle to 03-decisions.md.
Do not plan and do not write any code.
```

Done: `02a-open-questions.md` exists and `03-decisions.md` holds an answer for
every blocking question.

---

## plan — the approach, agreed

`03-decisions.md` is already settled. **Never re-open a decision in it.** The
grill did that work; the plan builds on it.

Write `02-plan.md`: the approach, the files it touches, the slices it breaks
into, the feature flag if there is one, the test surface, and what is
explicitly out of scope.

If a decision is still genuinely contested — the grill missed it, or the code
turned out different — stop and put it to the user, then append it to
`03-decisions.md`. Appending only; what is above stays exactly as it is.

Then split the plan into `04-brief-<slice>.md` files. A brief is
implementable by a session that has read nothing else: the goal, the files, the
constraints, the acceptance check, and its scope boundary.

**Gate: the plan is the user's decision. Get an explicit yes before code.**

Prompt:

```
Read general-access-files/PURCO-XXXX/01-ticket-and-context.md and
03-decisions.md, and treat every decision in 03-decisions.md as settled.
Write the plan to 02-plan.md — approach, files, slices, feature flag, test
surface, and what is out of scope. Then split it into one brief per slice.
Do not write any code until I say yes.
```

Done: `02-plan.md` and the briefs exist, and the user approved.

---

## build — one brief at a time

Implement exactly one brief. The scope boundary in the brief is binding: no
adjacent improvement, no refactor of code that is not broken, no speculative
abstraction. Match the surrounding style. No code comments.

Feature flags:

- Key every flag with `FEATURE_FLAGS` from `src/types/feature-flags.ts`, one
  `useFlags` hook per flag.
- **The flag-off path keeps the original behavior exactly.** That is the whole
  point of the flag. When the ticket says reuse an existing flag, reuse it —
  do not add a new one.

Data access: writes and single-key reads may use Prisma. Anything with nested
relations, a relation filter, aggregation, or on a page-load path is
hand-written Kysely with correlated `EXISTS`. See `.claude/rules/data-access.md`.

New UI is shadcn. Backend follows the tRPC/usecase/InversifyJS layering, and
internal routers carry no `.output()`.

Prompt:

```
Read general-access-files/PURCO-XXXX/04-brief-<slice>.md and implement it.
Stay strictly inside its scope. Ask before committing.
```

Done: the brief's acceptance check passes and nothing outside its scope moved.

---

## test — tests that bite

**Run this in a context that did not write the code.** A fresh session, or one
subagent whose prompt names only the brief and the plan as inputs. Record it
with its own `TICKET_CTX` so the breach check can see it.

`/purco test` with an explicit file scope, one lane per unit:

```
/purco test "src/server/api/modules/<mod>/usecases/<x>.usecase.ts, src/server/api/modules/<mod>/domain/services/<y>.service.ts"
```

It refuses without an accepted codex for the scope — run `/purco rules` first
if there is none. In an orchestrated run the engine runs the stages itself:

1. map: one mapper writes the unit contract, the coverage matrix, the effect
   closure and one test file per unit. The user approves the test plan.
2. write: one test author per file, side by side; each runs only its own file.
3. check: `gates_evaluate` runs types, lint, the suite and the flake probe.
4. inspect: one inspector per file judges each applicable rule.
5. verify: one defect verifier per red test; a defect skeptic attacks each
   confirmed defect.
6. mutate (full depth): mutants on the changed lines only; one survivor
   analyst per file, one equivalence hunter per file with claims.
7. prune (full depth): tests with no unique kill are deleted or exempted.

Code routes every work item to the file that owns it; the lead answers what
code cannot, and only the user signs waivers and equivalences.

Rules that come from this repo's own corrections:

- Integration tests at the **usecase** level, no mocks, real bus and real
  rows. No query-level unit tests.
- Expected values are hand-computed from factory data, never read back from
  the result, and never transcribed from a run — a literal transcript can
  encode the bug.
- Assert the whole object with one `toEqual`, and the full ordered recorder
  array, not a filtered subset.
- Test data comes from factories, never inline `prisma.create`.
- **Where a flag gates the change, run the suite twice — flag ON and flag
  OFF.** `createMockContext` defaults flags to true, so pin the production
  config in flag tests.
- Handler tests must be green, including breakage a flag retrofit caused.

Write the scope, the flag matrix and the must-not-regress list to
`05-test-notes.md`.

`/e2e-creator` writes a new Playwright spec in the PageManager/POM style,
targeting `@smoketest`.

Done: the suite is green in both flag states, and mutations prove the tests
bite.

---

## verify — the live app, not the test files

**Run this in a context that did not write the code**, and give it the brief,
not the implementation.

`/playwright-mcp` drives the running app the way a person would: log in as the
role that matters, walk the flow, read the in-app notification or the email,
check the numbers. A passing test suite is not verification.

- Use the server the user already has running; ask which one rather than
  starting a second.
- For a performance ticket, report real timings against the target, and
  compare flag ON to flag OFF.
- Capture the evidence — screenshots, timings, network — into
  `06-verification.md`.

Prompt:

```
Use the live app with Playwright — not test files. Log in as <role>, walk
<flow>, and tell me what you see. I have a server running already; confirm
which one before you start. Record the evidence in
general-access-files/PURCO-XXXX/06-verification.md.
```

Done: the flow works in the live app in every flag state that ships.

---

## static — the whole project

`yarn static` runs `tsc` and `biome ci` in parallel; `yarn tsc` alone when
that is all you need. Never single-file `npx tsc` or `npx eslint`.

`tsc` is TypeScript 7 here and `biome:ci` only checks changed files. If `tsc`
runs out of memory, raise `--max-old-space-size` rather than narrowing the
project. Never add a per-file lint override to silence a rule; fix the code.

The commit and push hooks run these gates anyway, so this phase is for finding
the breakage early, not a pre-commit ritual.

Done: clean, or the failures are understood and fixed.

---

## review — `/purco-review`

**Run this in a context that did not write the code.** Give it the diff, the
plan and the ADRs — never the argument for why the change is correct. Never
fork it; invoke it directly.

Runs the review agents in waves. It is autonomous: no approvals, no partial
results.

- Trace the full data flow before accepting any HIGH or CRITICAL — this
  review's false positives have all come from stopping short of the flow.
- A deferred concern is LOW.
- Check the stacked PRs first: an apparent gap is often the next PR's
  deliverable.
- On a stale spec, a deviation is still a true positive — the fix may be to
  update the spec.
- Real findings that are out of scope become a ticket. They do not become
  scope creep. Collect them in `07-review-findings.md`.

Done: findings are triaged, in-scope ones fixed, out-of-scope ones written down.

---

## ship — commit and PR

**Gate: ask first, every time.** "Ready to commit and push?"

Then, in one flow:

1. `/purco-commit` — `feat(PURCO-XXXX): message`, first line ≤ 72 chars.
2. Rebase and squash to **one** commit onto the base the probe reports —
   `dev` for a normal ticket, the **parent feature branch** for a stacked one.
   Squash only when the user has not said otherwise.
3. `/purco-pr` — draft unless told otherwise, pointing at that same base.
   **No Summary section**; start with the concrete sections.

If a quality gate rewrites files during commit, the user re-stages — you never
touch the index.

The videos in `verify/videos/` (one per acceptance criterion, plus flag ON and
flag OFF when a flag gates the change) are uploaded and embedded in the PR body.

Done: one commit, pushed, PR open against the right base.

---

## respond — comments, CI, conflicts

- `/pr-comments-address` for review and QA comments. Verify each finding
  against the code before agreeing; say plainly which ones do not hold. Apply
  the fixes, then **ask** before committing them.
- Replying to a review comment needs the reply endpoint:
  `pulls/{pr}/comments/{id}/replies`.
- Snyk errors on every PR here and never blocks a merge.
- CI failure: read the run, find the cause, and check whether a sibling PR
  shares the pattern — one fix often covers both.
- Rebase and conflicts: the base may have moved or been merged. Rebase onto
  what the probe reports, keep both features' changes when two widgets touch
  the same file, and run the **sibling feature's tests** too — a clean rebase
  can still be a semantic conflict.

Done: comments answered, CI green, branch rebased.
