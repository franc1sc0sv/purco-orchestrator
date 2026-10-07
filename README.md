# purco-orchestrator

One engine for PurCo work, driven from one Claude Code session through the `/purco` skill.

| Package                    | What it is                                                                 |
| -------------------------- | -------------------------------------------------------------------------- |
| `packages/engine`          | The orchestrator: workflows, the lead, the gates, the mailbox, the workers |
| `packages/test-forge`      | Test Forge: the codex, the ledger, the test-forge MCP server, the rules session |
| `skill/`                   | The `/purco` skill, symlinked into each Claude profile                     |

## The hierarchy

```
LEVEL 0  the user + the /purco session (the hub): QUESTION, GATE, SIGN, RUN_END
LEVEL 1  the lead (Opus 5.5, a fresh session per decision) + the engine (steps, gates, routing, memory)
LEVEL 2  workers, one fresh context per step: per phase, per brief, per cluster, per test file
```

The engine owns the order of the steps. The lead owns judgment at the points the engine hands it:
worker questions, gate cards, whether a judge's defect sends a brief back to the builder, and which
grill questions an answer settles. Workers run on Sonnet 5.5; Opus 5.5 is kept for the lead,
the planner, the reviewer, the defect skeptic and the equivalence hunter.

The lead has no memory. For every decision the engine builds a brief from the store: the event, every
settled line of `03-decisions.md` and every earlier lead decision on the same file, flag, rule or step,
the open items of the stage, and the stored result of every step the decision depends on. A missing
result stops the decision. Every decision and its brief is kept in the `decisions` table.

## Stages, lease and size

A ticket runs in four fixed stages: plan (intake, grill, plan), implementation (build, static),
testing (test), verification (verify, record, review). Each step is `pending`, `running`, `waiting`,
`halted`, `done`, `failed` or `skipped`, kept in the store. `record` is a placeholder until the video
step exists.

A run holds a lease on its ticket (heartbeat every 5 s). A second run for the same ticket is refused
while the holder is alive; a holder silent for 60 s with a dead pid loses the lease.

Intake measures the ticket and code maps it to a size, S, M or L. The intake gate card shows it, and
one word (`S`, `M`, `L` or `approve size L`) changes it. During the run the size only goes up. S skips
the grill and the defect skeptic, and skips the test plan gate when there are two test files or fewer.
S and M run Test Forge at quick depth, L at full depth. `--test-depth` always wins.

## Workflows

| Workflow | Steps                                                                            |
| -------- | -------------------------------------------------------------------------------- |
| `ticket` | intake, grill, plan, build per brief, static, test (Test Forge), verify, record, review |
| `spike`  | survey per cluster, audit, synthesize                                            |
| `test`   | the Test Forge stages alone: map, write, check, inspect, verify, mutate, prune   |

## Install

```bash
npm install
```

Node 22.20 or later. Everything runs as TypeScript through Node's type stripping; there is no
build step for the engine. Test Forge's state lives in `packages/test-forge/data/` and is not in git.

## Dashboard

```bash
npm run build -w purco-dashboard
node packages/engine/bin/purco-orchestrate.js monitor
```

Then open http://localhost:4317. Build once; the monitor serves `packages/dashboard/dist`.

## Tests

```bash
npm run engine-test   # free: gates, lead contract, grill, step keys, guards, store, journal
npm run hub-test      # free: the watch and mailbox signals the hub depends on
npm run smoke         # live, about $0.10: the worker tool contract against a real agent
```
