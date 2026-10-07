# purco-engine

The orchestrator of `purco-orchestrator`. It runs one workflow per launch, with one fresh Agent SDK
session per step, a lead that starts fresh for each decision and gets a full brief, gates that pause the run for the
human, and a record on disk of what every agent did.

Built on `@anthropic-ai/claude-agent-sdk`. It drives the local `claude` CLI, so it uses your Claude
Code login; no API key is needed.

## Run it

```bash
node bin/purco-orchestrate.js 3222 --dry-run
node bin/purco-orchestrate.js 3222 --run-id <id> --mailbox-db <db>
node bin/purco-orchestrate.js 3222 --workflow spike --run-id <id> --mailbox-db <db>
node bin/purco-orchestrate.js 3222 --workflow test --targets "<targets>" --focus "<lines>" --mailbox-db <db>
```

Options: `--workflow`, `--phases`, `--worktree`, `--model`, `--resume`, `--max-turns`,
`--dry-run`, `--no-write`, `--non-interactive`, `--ask-human`, `--run-id`, `--mailbox-db`,
`--config-dir`, `--targets`, `--focus`, `--scope`, `--test-depth`, `--test-mode`, `--check-mcp`.

`--test-depth quick` (the ticket default) runs Test Forge without mutation and pruning;
`--test-depth full` (the default for `--workflow test`) adds mutation on the changed lines and
pruning. In the ticket workflow the default follows the ticket size (S and M quick, L full), and
an explicit `--test-depth` always wins.

`--test-mode write` (the default) maps the change, writes tests and prunes. `--test-mode harden` skips
map, write and the first inspect. It finds the existing usecase-level test files that import the changed
production files, records the names of their tests, generates mutants on the changed lines only, runs
them against those files, runs the survivor analyst and the equivalence hunter, and has test authors add
tests only to kill survivors in those same files. It then re-runs the mutants, checks the gates, inspects
only the files that changed and verifies red tests. It never prunes, never creates a test file, and
restores any test that existed before the run. A `test-mode.txt` file holding `harden` in the context
pack sets the mode for one ticket. Harden mode always ends escalated: D7, D8 and D9 need a coverage
matrix, an effect closure and a focus map, which it does not build, and the ledger waives single items,
never an empty matrix. The end summary lists the other predicates that fail.

The test plan gate stores a JSON payload with the question (`payload_json` column of `questions`) for the
dashboard: units, test level, radius, depth, size, mode and warnings. If the mapper ends with no accepted
handoff, the step ends escalated and posts no gate.

**Stages and steps.** Every ticket phase belongs to one of four stages: plan (intake, grill, plan),
implementation (build, static), testing (every `test:*` step), verification (verify, record, review).
The ticket phases run in this order: intake, grill, plan, build, static, test, verify, record, review.
`record` is a code-only step (no model, no tokens) described below. The `steps` table
holds each step's status (`pending`, `running`, `waiting`, `halted`, `done`, `failed`, `skipped`),
attempt, times and its result as JSON; `Store.pipeline()` returns stages, steps and the latest attempt.
A step is `waiting` while a gate, question or sign item is open for it.

**Live check and record.** The `verify` worker writes one Playwright script per passing acceptance
criterion to `<pack>/verify/flows/<nn>-<slug>[-flag-on|-flag-off].spec.ts`, built on the flow
library of the orchestrator (`packages/recorder/flows/`, imported as `./<flow>`), and lists them in `<pack>/verify/flows/flows.json`
(`[{ file, criterion, flagState }]`). The `record` step (`src/record.ts`) reads that manifest. For each
run it stages `packages/recorder/flows/*` once into `<worktree>/tests/e2e/.purco-recording/`, copies each script there, and runs
`npx playwright test <script> -c tests/e2e/.purco-recording/recording.config.ts --output <scratch>` in the worktree with
`TENANT` (default `purco`) and `envmode=local`, and moves the video to
`<pack>/verify/videos/<nn>-<slug>[-flag-on|-flag-off].webm`. Each script has 3 minutes. A failing
script fails the step: the findings name the flow and the error tail. The step result counts `flows`,
`videos` and `failed`, and is updated after each flow, with the step reason showing "recording 2 of 4".
The staged folder is deleted when the step ends, also after an error, so it never reaches purco-web git.
The step is `skipped` when the worktree has no `tests/e2e/pages` ("worktree has no tests/e2e/pages") or when verify wrote no scripts.
`npm run check:recorder -- <worktree>` stages the library into a purco-web worktree, type-checks it there and deletes it. The PR step embeds the videos.

**Lease.** The `leases` table holds one row per ticket: run id, pid, host and a heartbeat written
every 5 s. A launch takes a free lease, or one whose heartbeat is older than 60 s and whose pid is
dead on the same host. Otherwise it exits with an error naming the live run. The lease is released on
a normal end and on SIGINT or SIGTERM. `--resume` is unchanged.

**Results.** `handoff` returns status, summary, files, optional `counts` (numbers) and optional
`findings` (`{title, severity, location}`). A malformed handoff is refused with a fix message. A step
that ends with no accepted handoff is `failed` with the summary `no result`.

**The lead and the decision log.** The lead starts a fresh session for each decision. `brief.ts`
builds its brief with no size cap: the event, the settled lines of `03-decisions.md` that name the
same file, flag, rule id or step, earlier logged decisions on the same subjects, the open items of the
stage, and the stored result of every earlier step of the stage plus the plan step. If a finished
dependent step has no stored result, the lead does not run and the decision is a `defer` that names
it. Each decision and its brief go to the `decisions` table.

**Size.** Intake reports `files_named`, `backend`, `frontend`, `migration`, `flag` and
`acceptance_criteria` in its `counts`; `size.ts` maps them to S, M or L and the reasons. The intake gate
card shows "Size: X, because: ...". The human may answer `S`, `M`, `L` or `approve size L`. During the
run the size only rises (the plan makes more briefs than the size allows: S above 1, M above 3), with a
reason in the next gate card. S skips the grill (the plan lists its assumptions), skips the test plan
gate for two test files or fewer, and runs no defect skeptic.

**A detached run needs `--mailbox-db`.** Without it a human question falls back to readline on
stdin, which no background process can answer. The CLI refuses to start when stdin is not a
terminal and neither `--mailbox-db` nor `--non-interactive` is given, and exits 2.

`--ask-human` sends every worker question straight to the human instead of to the lead. `--run-id`
pins one id, so a resumed run keeps its steps and questions under one key.

`/purco` drives all of this from one Claude Code session; its `references/hub.md` is the loop.

The worktree is resolved from the ticket number against `git worktree list`.
Create one first with `/wt <TICKET>`.

## MCP servers

An SDK-spawned session inherits **none** of this machine's MCP servers: OAuth
connectors cannot complete their flow headlessly, and project `.mcp.json`
servers need an approval a headless session cannot give. So the orchestrator
passes every server it needs explicitly, per role.

| Server                           | How                                                               | Roles                     |
| -------------------------------- | ----------------------------------------------------------------- | ------------------------- |
| `linear`                         | in-process tools over Linear's GraphQL API, `LINEAR_API_KEY`      | intake, planner           |
| `playwright`                     | stdio, `npx @playwright/mcp@latest`                               | verifier                  |
| `postgres-purco`, `postgres-sdi` | stdio, loaded from purco-web `.mcp.json` and **forced read-only** | planner, tester, reviewer |

Verify all three before a real run:

```bash
node bin/purco-orchestrate.js 3222 --check-mcp
```

### Linear

The official Linear MCP is OAuth-only, so this project implements four
read-only tools directly against Linear's GraphQL API: `get_issue`,
`list_project_issues`, `list_comments`, `search_issues`. They need a Linear
personal API key, from Linear: Settings, Security, API keys.

The key is resolved from `LINEAR_API_KEY`, and on macOS falls back to the
Keychain. **Prefer the Keychain** — the value never lands in a dotfile, and the
command below prompts for it without echoing:

```bash
security add-generic-password -a "$USER" -s LINEAR_API_KEY -w
```

Run that in your own terminal. Nothing else is needed; the orchestrator reads it
per run. The environment variable still wins if set, but an interactive
`export` only lives in that one shell — persist it in your profile if you go
that way.

Without a key from either source, every Linear tool
fails with a clear message and intake falls back to `<pack>/00-ticket.md` — a
file you can seed from a Claude Code session, where Linear is authenticated:

> Read PURCO-3222 and its Linear project, and write the ticket, its comments
> and the relevant sibling tickets to
> `general-access-files/PURCO-3222/00-ticket.md`.

If neither Linear nor that file works, intake escalates to the human instead of
inventing the ask. When Linear does work, intake writes `00-ticket.md` anyway so
a later run does not depend on it.

### Postgres runs in-process, not in docker

The docker `crystaldba/postgres-mcp` server took **32 seconds** to complete an
MCP handshake — past the SDK's 30s connect timeout — leaked a container per
run, and reported real configuration errors as an opaque timeout. So this
project connects directly with `pg` instead. The same probe now answers in
**under 40ms** and names the actual error.

Tools per tenant (`pg-purco`, `pg-sdi`): `list_schemas`, `list_tables`,
`describe_table`, `read`, `explain`.

Read-only is enforced three independent ways:

1. `isReadOnlySql` rejects anything but a single `SELECT` / `WITH … SELECT` /
   `SHOW` / `EXPLAIN`, before a connection is even taken.
2. Every statement runs inside `BEGIN TRANSACTION READ ONLY`, always rolled
   back. **Postgres itself** refuses a write there.
3. `SET LOCAL statement_timeout = 15s`, and at most 200 rows come back.

`--check-mcp` asserts all three per tenant, including that
`transaction_read_only` really is `on`. Connection strings are read from
`.mcp.json` at runtime, expanded, and never printed; errors are scrubbed of
URIs and passwords before they reach an agent.

### It resolves its own connection

The loader probes candidates in order and keeps the first that answers
`select 1`:

1. the configured value, with `ORCH_PG_DB_<TENANT>` applied if set
2. the same connection with the database set to the tenant name
3. the other tenant's connection, with the tenant name as the database

It logs which one won, and never the secret:

```
purco: connected to localhost/purco - database corrected to "purco"
sdi: connected to localhost/sdi - borrowed from purco, database "sdi"
```

No environment variables are required for this to work.

### Why that fallback exists

Neither `PURCO_MCP_DATABASE_URI` nor `SDI_MCP_DATABASE_URI` is set, so the
`${VAR:-default}` fallbacks are used — and they fail:

- purco: `database "purco-db" does not exist` (the local database is `purco`)
- sdi: `password authentication failed for user "postgres"`

`purco-web-db-1` on port 5432 actually holds `purco` and `sdi`, 116 public
tables each, and purco's configured value authenticates correctly — only its
database name is wrong. That is why step 2 and step 3 above recover both
tenants without any manual configuration.

The durable fix is to set `PURCO_MCP_DATABASE_URI` and `SDI_MCP_DATABASE_URI`
properly. That also repairs interactive Claude Code's postgres servers, which
are broken for the same reason but report it as a 30s connect timeout rather
than the real error.

## Which Claude profile it uses

The SDK drives the local `claude` CLI, so it bills your Claude Code
subscription — no API key. It runs under the profile in `CLAUDE_CONFIG_DIR`,
which the orchestrator passes explicitly to every agent so a run does not
depend on the caller's shell. Default is the current `CLAUDE_CONFIG_DIR`, else
`~/.claude-work`. Override with `--config-dir`.

## Layout

```
prompts/              one file per role
  _protocol.md        the shared worker contract, appended to every role
  lead.md             how the lead decides
  intake.md inquisitor.md planner.md builder.md fixer.md tester.md
  verifier.md reviewer.md surveyor.md checker.md synthesist.md
  mapper.md test-author.md inspector.md defect-verifier.md defect-skeptic.md
  survivor-analyst.md equivalence-hunter.md   the Test Forge roles
src/
  types.ts            phases, stages, step statuses, roles, models, escalation levels, outcome shapes
  workflows.ts        the ticket, spike and test workflows as data
  plan.ts             steps, step keys and labels
  roles.ts            prompts -> AgentDefinition, per-role model, tools, effort
  lead.ts             the lead: a fresh session per decision, structured decisions
  brief.ts            the lead's brief: subjects, settled lines, earlier decisions, results
  lease.ts            the per-ticket lease and its heartbeat
  size.ts             facts to S, M or L, and the size rules
  handoff.ts          the schema of a worker's handoff
  orchestrator.ts     the step queue, gates, grill, fix loop, test step, report
  grill.ts            the grill through the mailbox, one question at a time
  forge.ts            the test step: the Test Forge stages, driven in code
  forge-units.ts      the unit list, the run file, changed lines, work-item routing
  forge-server.ts     the test-forge MCP server the Test Forge roles use
  test-paths.ts       the guard that keeps test authors on test files
  tools.ts            the in-process MCP server workers talk through
  bus.ts              reports handed from one role to a later one
  escalation.ts       the ladder, promotion, routing and resolution
  hooks.ts            SDK hooks -> scratchpad, journal, read-only SQL, protected files
  protected-files.ts  the guard for dotenv files and keys
  mailbox.ts          human items in the store: question, gate, sign
  scratchpad.ts       the JSONL event log and the live view
  journal.ts          per-step attempt record, for resuming an interrupted run
  cli.ts              argument parsing and run setup
bin/ticket-state.sh   phase state and the isolation breach check
```

## Cost control

Every role names its own model and effort in `ROLE_SPECS` (`src/roles.ts`). Only Opus 5.5 and
Sonnet 5.5 are used. `--model` overrides all of them, the lead included.

| Role                               | Model      | Effort |
| ---------------------------------- | ---------- | ------ |
| lead                                                    | Opus 5.5   | medium |
| planner, reviewer, defect-skeptic, equivalence-hunter   | Opus 5.5   | high   |
| checker, inquisitor, synthesist                         | Sonnet 5.5 | high   |
| builder, tester, intake, verifier, surveyor             | Sonnet 5.5 | medium |
| mapper, test-author, inspector, defect-verifier         | Sonnet 5.5 | medium |
| survivor-analyst                                        | Sonnet 5.5 | medium |
| fixer                                                   | Sonnet 5.5 | low    |

The 5.5 effort levels are recalibrated: Opus 5.5 at `medium` matches or beats Opus 5 at `high` on
coding. Confirm a change with `npm run eval` and the cost table in `report.md` before you keep it.

Each role's `maxTurns` is a hard cap; `--max-turns` can lower it, never raise it. Every
step records its tokens, model and cost in the `phases` table and in `report.md`.

## Surviving an interruption

A run can stop at any moment — a power cut, a crash, a closed laptop. Three things make the next launch pick up where it stopped.

| Mechanism        | Where                                | What it holds                            |
| ---------------- | ------------------------------------ | ---------------------------------------- |
| the `phases` row | the mailbox database                 | which phases finished                    |
| the step journal | `<runDir>/journal/<step>.json`       | attempt count, base commit, files written |
| the scratchpad   | `<runDir>/scratch/<role>.json`       | what each role wrote down for itself      |

Relaunch the same run id with `--resume`:

```bash
node bin/purco-orchestrate.js 3222 --run-id <same id> --mailbox-db <db> --resume
```

It skips every phase already recorded `done`, and for a phase that was
interrupted it puts a resume note in front of the agent: the attempt number,
the commit it started from, the files the last attempt wrote, and what `git
status` shows now. The agent calls `scratch_read` for its own notes and
continues from the tree instead of starting again.

Agents are told to write output and scratch entries **as they go**, never only
at the end, because work that exists nowhere but in a context is lost work.

## Roles

| Role         | Step          | Writes                                          | Reads                        |
| ------------ | ------------- | ----------------------------------------------- | ---------------------------- |
| `intake`     | intake        | `01-ticket-and-context.md`                      | Linear, pack, PRs, code      |
| `inquisitor` | grill         | `02a-open-questions.md` and `.json`             | `01`, `03`, code             |
| human        | grill:human   | `03-decisions.md`, through the engine           | the questions, one at a time |
| `planner`    | plan          | `02-plan.md`, `04-brief-<n>-*.md`, appends `03` | `01`, `02a`, `03`            |
| `builder`    | build:<brief> | the code, one brief per step                    | its brief, `02`, `03`        |
| Test Forge   | test:<stage>  | test files, `forge-run.json`, `forge/run-<id>/` | the codex, diff for scope    |
| `verifier`   | verify        | `06-verification.md`                            | briefs, `02`, the live app   |
| `fixer`      | static        | the code                                        | `yarn static`                |
| `reviewer`   | review        | `07-review-findings.md`                         | diff, `02`, `03`, ADRs       |

The `tester` role runs only when the project has no accepted Test Forge codex for the scope.

Roles marked `testFilesOnly` (`test-author`, `tester`) are held to test files by a result check, not
only by tool refusals. A refuse hook blocks `Write`/`Edit` outside test paths and any Bash command
that runs `git` (also behind `env`, `sudo`, `xargs`, `sh -c` and similar), but Bash can still edit
files, so the engine audits the worktree. The command filter is best-effort: it cannot be complete
(`g''it`, `$(echo git)`, `$G`, `\git`), and it only catches the common forms and quote or backslash
splitting. The result audit is the control. Before the worker starts it snapshots every modified or
untracked non-test file (`git status --porcelain -z --untracked-files=all`), every git-ignored file
(`git ls-files --others --ignored --exclude-standard -z`) except the generated directories listed in
`AUDIT_SKIPPED_DIRECTORIES` (`node_modules`, `.next`, `dist`, `build`, `coverage`, `.turbo`,
`test-results`, `playwright-report`, `.purco-recording`), `.git/config` and every file under
`.git/hooks` and `.git/info` (resolved with `git rev-parse --git-common-dir`, so linked worktrees
work), plus the HEAD commit. Each file gets a sha256 and its mode; the bytes stay in memory only for
the restore and are never written to disk, logs, alerts or step reasons, which carry paths only.
After the worker ends, for any reason, it snapshots again. A non-test file that is new, removed or
changed, or a moved HEAD, is a violation. The engine then restores those files to their pre-worker
bytes, deletes new files, moves HEAD back (`git reset --soft`), fails the step with
`changed production code: <files>` and raises a `halted` alert. Test files are never touched.

The audit fails closed. If a snapshot or the restore throws, the step fails with
`write audit unavailable: <short error>` or `restore failed: <files>`, a `halted` alert titled
`Write audit failed` is raised and the run stops. A git command that fails on an `index.lock` or
busy error is retried once after 500 ms before that. Parallel test authors share one worktree: after
a violation and restore, every worker still running keeps its original baseline, except that the
restored paths are set to the state they were restored to, so a later change by any worker is still
detected. Those workers are also marked tainted, so they fail too, because the engine cannot tell
whose edit it was.

A judging role never receives the builder's reasoning, only the files. When a judge reports a
defect for the builder, the lead decides whether a repair pass runs: a fresh builder on that one
brief with the defects, then the judge again, at most twice per judging phase.

The grill runs inside the run. The inquisitor writes the questions; the engine posts each blocking
question to the mailbox, one at a time, writes each answer to `03-decisions.md` at once, and asks
the lead which remaining questions that answer settles. `plan` refuses to start while
`03-decisions.md` is missing or holds an open `- [ ]` line.

## Communication

Workers reach the orchestrator through an in-process MCP server. Every tool records to the
scratchpad, so communication and observability are the same act. The engine knows which worker is
running, so no tool takes a `from` field.

| Tool            | Effect                                                        |
| --------------- | ------------------------------------------------------------- |
| `note`          | progress marker at a milestone                                |
| `think`         | one decision, its reason and its evidence                     |
| `ask`           | blocks, and returns the lead's decision or the human's answer |
| `escalate`      | raises a blocker at a chosen level                            |
| `report`        | a message for a later role, relayed into that role's task     |
| `handoff`       | the step outcome: delivered, blocked, disputed or failed      |
| `scratch_write` | durable per-role notes                                        |
| `scratch_read`  | read those notes back on a resumed step                       |

Relayed messages, repair defects, gate notes and the resume note reach the worker as tagged blocks
in its task: `<handed_messages>`, `<defects_to_fix>`, `<human_notes>`, `<resume_note>`.

The lead answers with one JSON object, enforced by `outputFormat`:
`{ decision, text, target?, settled? }`. The decisions are `answer`, `defer`, `continue`, `rerun`
and `stop`, and the engine refuses one that is not allowed for the event. `defer` sends the
question to the human.

## Escalation

| Level          | Meaning                          | Who resolves          |
| -------------- | -------------------------------- | --------------------- |
| `retry`        | transient; try another way       | policy, capped at 3   |
| `repair`       | the agent can fix it itself      | policy                |
| `orchestrator` | needs a decision above the agent | the lead              |
| `human`        | only the user can decide         | the mailbox           |
| `abort`        | an invariant broke               | nobody; the run stops |

A `retry` that repeats the same `repeat_key` three times is promoted to `orchestrator`. The hooks
record a tool failure or a permission denial, but they do not raise an escalation for it, because
the failing worker already sees the error. An `abort`, a gate refusal, or a `stop` from the lead or the
human stops the run, and every later step is skipped.

## Telemetry, burn rate, stuck detection and alerts

The engine writes live worker data to the SQLite store. A worker cannot forget it.

Tables:

| Table | Content |
| --- | --- |
| `workers` | One row per worker (`run|step|label`): state, current action, tokens in, out, cache read, cache write, cost, turns, max turns, context size, files read, files written, start, last event, last activity, end, halt reason. The lead has one row per decision (role `lead`). |
| `samples` | Cumulative burn tokens and cost per worker, at most every 10 s. Burn tokens are input, output and cache write. Cache reads are left out. |
| `alerts` | `id, ticket, run_id, worker_id, step, kind, message, at, seen`. Kinds: `gate question sign stuck loop burn halted done`. |

States: `starting thinking tool waiting-human waiting-lead done failed halted`.
Usage comes from each assistant message, deduplicated by message id (a repeated id keeps the
largest value per field). Cost per message comes from `src/pricing.ts` (Sonnet 5.5 and Opus 5.5
list prices). When the worker ends, the SDK `total_cost_usd` and final usage replace the running
totals.

Store reads for the dashboard: `liveWorkers(ticket)`, `workers(ticket)`, `samples(ticket, sinceIso)`,
`costRollup(ticket)` (ticket, each stage, each step, each worker), `alerts(ticket, unseenOnly)`,
`markAlertsSeen(ids)`.

Thresholds (all in `src/thresholds.ts`):

| Rule | Value |
| --- | --- |
| Watchdog interval | 15 s |
| Burn rate window | 2 minutes, from samples |
| Normal rate | Median of finished workers of the role (at least 3), else the role default (60k tokens/min; 40k intake, 90k builder, fixer and tester) |
| Burn alert | 2x normal, once per worker and level |
| Burn stop | 3x normal for 2 minutes. Halt reason `burn rate` |
| Stuck alert | State `thinking` or `tool` with no tool call and no file change for 5 minutes |
| Stuck stop | Still stuck 10 minutes after the alert. Halt reason `stuck` |
| Loop alert | Same tool and identical input 3 times in a row |

Waiting states are never stuck. A halt aborts the SDK query through its `AbortController`, marks the
worker and the step `halted`, keeps the journal, and stops the run at that step. Resume it later.

Alerts are stored and, on macOS only, sent with `osascript` through `execFile`. A failure to notify
never fails the run.

## The dashboard

Build the UI once, then start the monitor and open `http://localhost:4317`:

```bash
npm run build -w purco-dashboard
node bin/purco-orchestrate.js monitor
```

The monitor finds every `general-access-files/*/orchestrator.sqlite`, opens the stores read-only,
and serves the built UI from `packages/dashboard/dist`. Screens: Tickets (one card per ticket),
the ticket view (stage bars, live agent diagram, burn rate, cost by step, alerts, decisions) and
History (finished tickets). The page asks for browser notification permission and shows a
notification and a toast for each new alert. JSON endpoints: `/api/tickets`, `/api/tickets/:ticket`,
`/api/history`, `POST /api/tickets/:ticket/alerts/seen`, and the SSE stream `/api/stream?ticket=X`.
The old page stays at `/legacy`. Set `PURCO_GAF` to read another folder.

## The monitor

Serves `http://127.0.0.1:4317` (`--port` to change) and polls every two
seconds. It reads the run directories on disk, so it works during a run, after
one, and across several at once — nothing needs to be wired into it.

Top tiles: how many orchestrators are running, how many sub-agents are live in
those runs, how many decisions are still open, runs recorded, total cost.

Per run, expandable: the phase table with status and cost; a row per agent with
its event, tool-call, failure, thought, question and message-sent counts plus
its last action; every orchestrator decision with the level, the question, the
answer and who gave it; every agent-to-agent message with whether it was read;
and a colour-coded live event feed, newest first, where thinking, escalations
and resolutions are distinguishable at a glance.

A run counts as running while it has no `run_end` event and something was
recorded in the last five minutes; otherwise it reads as finished or stalled.

## What lands on disk

Under `general-access-files/<TICKET>/orchestrator-runs/<runId>/`:

| File                 | Contents                                                   |
| -------------------- | ---------------------------------------------------------- |
| `events.jsonl`       | every event, one per line, the machine-readable scratchpad |
| `live.md`            | the same grouped per agent, for reading                    |
| `escalations.json`   | every escalation with its resolution and who gave it       |
| `messages.json`      | the inter-agent messages and when they were read           |
| `human-questions.md` | every question, gate and signature put to the user         |
| `report.md`          | steps with model, cost and tokens; handoffs; escalations   |
| `journal/<step>.json` | attempt count, base commit and files written per step     |
| `scratch/<role>.json` | the keyed notes each role left for its next attempt       |
| `gates/<step>.md`    | the card the lead wrote for each gate                      |
| `forge.log`          | the Test Forge stage log: the vector after each pass       |

Phase state is also written through `bin/ticket-state.sh` with `TICKET_CTX=agent:<label>`, so the
isolation breach check stays meaningful across orchestrated runs.

## Constraints

- Phases are **serial**. Two agents editing one worktree revert each other.
- Node runs this in strip-only mode, so the source must be erasable-syntax
  only: no parameter properties, no enums. `erasableSyntaxOnly` is on in
  `tsconfig.json` so `tsc` catches a violation before Node does.
- Agents never stage, commit, push or rebase. That stays the user's decision.
- Workers load the project settings only (`settingSources: ["project"]`), not the user profile.
- `npm run smoke` costs about $0.10 and checks the worker tool contract against a live agent.
- `npm run engine-test` costs nothing: gates, the lead decision contract, step keys, the
  protected file guard, the grill loop, the store, the journal and the per-role models.
- `npm run hub-test` costs nothing: the run row, the phase rows, and the `watch` lines for each
  phase change, question, gate and run end.
