# purco-orchestrator

A Claude Agent SDK orchestrator for a PurCo ticket. One agent per role, an
orchestrator that answers them, a five-level escalation ladder, and a
scratchpad that records what every agent did, said and thought.

Built on `@anthropic-ai/claude-agent-sdk`. It drives the local `claude` CLI, so
it uses your existing Claude Code credentials — no API key needed.

## Run it

```bash
node bin/purco-orchestrate.js 3222 --phases intake,plan --dry-run
node bin/purco-orchestrate.js 3222 --phases intake
node bin/purco-orchestrate.js 3222 --phases review --no-write
npm run smoke
npm run hub-test
```

Options: `--phases`, `--worktree`, `--model`, `--max-turns`, `--dry-run`,
`--no-write`, `--non-interactive`, `--ask-human`, `--run-id`, `--mailbox-db`,
`--config-dir`, `--check-mcp`.

**A detached run needs `--mailbox-db`.** Without it a human question falls back
to readline on stdin, which no background process can answer, so the run hangs
with no error. The CLI refuses to start when stdin is not a terminal and neither
`--mailbox-db` nor `--non-interactive` is given, and exits 2.

`--ask-human` sends every `ask` straight to the human instead of to the arbiter.
`--run-id` pins one id, so a ticket that runs in segments keeps its phases,
questions and events under one key; the run row reopens on each launch.

`/purco-ticket` drives all of this from one Claude Code session. Its
`references/hub.md` is the loop.

There is no spend cap. `maxTurns` is the only runaway guard, by design.

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
prompts/            one file per role, the Anthropic demo convention
  _protocol.md      the shared communication contract, appended to every role
  orchestrator.md   how the arbiter decides
  intake.md inquisitor.md planner.md builder.md fixer.md tester.md
  verifier.md reviewer.md
src/
  types.ts          phases, roles, models, escalation levels, outcome shapes
  roles.ts          prompts -> AgentDefinition, per-role model, tools, effort
  orchestrator.ts   the phase machine, the arbiter, the run report
  tools.ts          the in-process MCP server agents talk through
  bus.ts            orchestrator-mediated messages between agents
  escalation.ts     the ladder, promotion, routing and resolution
  scratchpad.ts     the JSONL event log and the live view
  tracker.ts        agent identity and attribution
  hooks.ts          SDK hooks -> scratchpad, escalation, journal
  message-handler.ts  SDK message stream -> scratchpad, cost, tokens
  agent-scratch.ts  the per-role keyed scratchpad an agent can read back
  journal.ts        per-phase attempt record, for resuming an interrupted run
  cli.ts            argument parsing and run setup
  smoke.ts          live end-to-end test of the communication machinery
  engine-test.ts    free test of gates, models, journal, scratch, arbiter
```

## Cost control

Every role names its own model. `--model` overrides all of them; without it
each role runs on what its `RoleSpec` declares. Cheap roles do not run on Opus.

| Lever                | Where                          | Effect                                  |
| -------------------- | ------------------------------ | --------------------------------------- |
| per-role `model`     | `ROLE_SPECS` in `src/roles.ts` | Sonnet for reading, Opus for judging    |
| per-role `effort`    | `ROLE_SPECS`                   | thinking budget per role                |
| per-role `maxTurns`  | `ROLE_SPECS`                   | hard turn cap per role                  |
| `--budget <usd>`     | the run                        | warns at 70 %, aborts on breach         |
| one definition/phase | `buildAgentDefinitions`        | a phase is handed only its own role     |

Every phase records its input, output, cache-read and cache-write tokens, its
model and its cost. They are in the `phases` table and in `report.md`, so a
change to any lever above can be proved rather than assumed.

The arbiter runs on Haiku and answers with one JSON object,
`{ decision, text, confidence }`. A reply that is not JSON still works: the
parser falls back to the old `DEFER TO HUMAN` prefix, and then to treating the
whole reply as an answer marked low confidence.

## Surviving an interruption

A run can stop at any moment — a power cut, an exhausted budget, a closed
laptop. Three things make the next launch pick up where it stopped.

| Mechanism        | Where                                | What it holds                            |
| ---------------- | ------------------------------------ | ---------------------------------------- |
| the `phases` row | the mailbox database                 | which phases finished                    |
| the phase journal| `<runDir>/journal/<phase>.json`      | attempt count, base commit, files written |
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

| Role         | Phase         | Writes                                      | Reads                              |
| ------------ | ------------- | ------------------------------------------- | ---------------------------------- |
| `intake`     | intake        | `01-ticket-and-context.md`                  | Linear, pack, PRs, code            |
| `inquisitor` | grill         | `02a-open-questions.md`                     | `01`, `03`, code                   |
| `planner`    | plan          | `02-plan.md`, `04-brief-*.md`, appends `03` | `01`, `02a`, `03`                  |
| `builder`    | build, static | the code                                    | one brief, `02`, `03`              |
| `tester`     | test          | `05-test-notes.md`                          | briefs, `02`, `03`, diff for scope |
| `verifier`   | verify        | `06-verification.md`                        | briefs, `02`, the live app         |
| `reviewer`   | review        | `07-review-findings.md`                     | diff, `02`, `03`, ADRs             |

Each role's prompt names the files it may read. A judging role never receives
the builder's reasoning — only the artefacts.

`grill` is half a phase. The inquisitor finds the open decisions and frames
them, but it never asks: an agent cannot hold a conversation. The human
answers them in the Claude Code session that drives the run, and that session
writes `03-decisions.md`. `plan` then refuses to start until
`03-decisions.md` exists and holds no open `- [ ]` line.

## Communication

Agents reach the orchestrator, and each other, through an in-process MCP
server. Every tool records to the scratchpad as a side effect, so
communication and observability are the same act.

| Tool       | Direction                      | Effect                             |
| ---------- | ------------------------------ | ---------------------------------- |
| `note`     | agent -> log                   | progress marker                    |
| `think`    | agent -> log                   | reasoning worth reading later      |
| `ask`      | agent -> orchestrator -> agent | **blocks** and returns a decision  |
| `escalate` | agent -> ladder                | raises a blocker at a chosen level |
| `send`     | agent -> orchestrator -> agent | queued for the recipient           |
| `inbox`    | agent <- bus                   | unread messages, marked read       |
| `handoff`  | agent -> orchestrator          | declares the phase output          |

`ask` is answered by **the arbiter**: a short, cheap `query()` call carrying
the orchestrator prompt plus a digest of the scratchpad. It returns a decision,
or `DEFER TO HUMAN`, which forwards the question to the terminal.

Every tool takes `from`. The tracker independently observes who is running; a
disagreement is recorded as an `identity mismatch` rather than trusted.

## Escalation

| Level          | Meaning                          | Who resolves          |
| -------------- | -------------------------------- | --------------------- |
| `retry`        | transient; try another way       | policy, capped at 3   |
| `repair`       | the agent can fix it itself      | policy                |
| `orchestrator` | needs a decision above the agent | the arbiter           |
| `human`        | only the user can decide         | the terminal          |
| `abort`        | an invariant broke               | nobody; the run stops |

A `retry` that repeats the same `repeat_key` three times is **promoted** to
`orchestrator` — an agent cannot loop forever on one failure. Tool failures
and permission denials raise escalations automatically from hooks, without the
agent having to notice. An `abort` marks the run and every later phase is
skipped rather than run against a broken tree.

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
| `human-questions.md` | everything deferred to the user                            |
| `report.md`          | phases with model, cost and tokens; handoffs; escalations  |
| `journal/<phase>.json` | attempt count, base commit and files written per phase   |
| `scratch/<role>.json`  | the keyed notes each role left for its next attempt      |

Phase state is also written through
`~/.claude-work/skills/purco-ticket/scripts/ticket-state.sh` with
`TICKET_CTX=agent:<label>`, so the `purco-ticket` isolation breach check stays
meaningful across orchestrated runs.

## Constraints

- Phases are **serial**. Two agents editing one worktree revert each other.
- Node runs this in strip-only mode, so the source must be erasable-syntax
  only: no parameter properties, no enums. `erasableSyntaxOnly` is on in
  `tsconfig.json` so `tsc` catches a violation before Node does.
- Agents never stage, commit, push or rebase. That stays the user's decision.
- `npm run smoke` costs about $0.10 and asserts 18 properties of the
  communication machinery against a live agent.
- `npm run engine-test` costs nothing and asserts 43 properties of the gates,
  the per-role models, the phase journal, the per-role scratchpad and the
  arbiter verdict contract.
- `npm run hub-test` costs nothing and asserts 23 properties of the signals the
  hub depends on: the run row opens and reopens, a phase row is written per
  step, and `watch` reports each phase change, each new question and the end of
  the run — and replays neither a finished phase nor an end that predates it.
