# purco-engine

The orchestrator of `purco-orchestrator`. It runs one workflow per launch, with one fresh Agent SDK
session per step, a lead session that remembers the whole run, gates that pause the run for the
human, and a record on disk of what every agent did.

Built on `@anthropic-ai/claude-agent-sdk`. It drives the local `claude` CLI, so it uses your Claude
Code login; no API key is needed.

## Run it

```bash
node bin/purco-orchestrate.js 3222 --dry-run
node bin/purco-orchestrate.js 3222 --run-id <id> --mailbox-db <db> --budget <usd>
node bin/purco-orchestrate.js 3222 --workflow spike --run-id <id> --mailbox-db <db>
node bin/purco-orchestrate.js 3222 --workflow test --targets "<targets>" --focus "<lines>" --mailbox-db <db>
```

Options: `--workflow`, `--phases`, `--worktree`, `--model`, `--budget`, `--resume`, `--max-turns`,
`--dry-run`, `--no-write`, `--non-interactive`, `--ask-human`, `--run-id`, `--mailbox-db`,
`--config-dir`, `--targets`, `--focus`, `--scope`, `--test-depth`, `--check-mcp`.

`--test-depth quick` (the ticket default) runs Test Forge without mutation and pruning;
`--test-depth full` (the default for `--workflow test`) runs all eight phases.

**A detached run needs `--mailbox-db`.** Without it a human question falls back to readline on
stdin, which no background process can answer. The CLI refuses to start when stdin is not a
terminal and neither `--mailbox-db` nor `--non-interactive` is given, and exits 2.

`--ask-human` sends every worker question straight to the human instead of to the lead. `--run-id`
pins one id, so a resumed run keeps its steps, questions and lead session under one key.

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
src/
  types.ts            phases, roles, models, escalation levels, outcome shapes
  workflows.ts        the ticket, spike and test workflows as data
  plan.ts             steps, step keys and labels
  roles.ts            prompts -> AgentDefinition, per-role model, tools, effort
  lead.ts             the lead: one resumed session, structured decisions
  orchestrator.ts     the step queue, gates, grill, fix loop, test step, report
  grill.ts            the grill through the mailbox, one question at a time
  forge.ts            the test step: a Test Forge operation on this run's mailbox
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
| lead                               | Opus 5.5   | medium |
| planner, reviewer, checker, tester | Opus 5.5   | high   |
| builder                            | Opus 5.5   | medium |
| inquisitor, synthesist             | Sonnet 5.5 | high   |
| intake, verifier, surveyor         | Sonnet 5.5 | medium |
| fixer                              | Sonnet 5.5 | low    |

The 5.5 effort levels are recalibrated: Opus 5.5 at `medium` matches or beats Opus 5 at `high` on
coding. Confirm a change with `npm run eval` and the cost table in `report.md` before you keep it.

`--budget <usd>` covers the whole run, lead included: it warns at 70 % and stops the run on
breach. Each role's `maxTurns` is a hard cap; `--max-turns` can lower it, never raise it. Every
step records its tokens, model and cost in the `phases` table and in `report.md`.

## Surviving an interruption

A run can stop at any moment — a power cut, an exhausted budget, a closed
laptop. Three things make the next launch pick up where it stopped.

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
| Test Forge   | test          | test files, `forge-run.json`                    | the codex, diff for scope    |
| `verifier`   | verify        | `06-verification.md`                            | briefs, `02`, the live app   |
| `fixer`      | static        | the code                                        | `yarn static`                |
| `reviewer`   | review        | `07-review-findings.md`                         | diff, `02`, `03`, ADRs       |

The `tester` role runs only when the project has no accepted Test Forge codex for the scope.

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
the failing worker already sees the error. An `abort`, a gate refusal, a `stop` from the lead or the
human, or a spent budget stops the run, and every later step is skipped.

## The monitor

```bash
node bin/purco-orchestrate.js monitor
```

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
| `lead-session.txt`   | the lead's session id, also kept in the `runs` table       |
| `forge.log`          | the Test Forge operation log of the test step              |

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
