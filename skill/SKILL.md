---
name: purco
description: >
  One entry point for PurCo work driven by the purco-orchestrator engine: a whole ticket
  (intake, grill, plan, build, Test Forge, verify, static, review) run from one Claude Code
  session, a feature-flag removal spike, a standalone Test Forge operation, the Test Forge
  doctrine session, War Games replay and the Test Forge board. Use when starting, resuming or
  checking a PURCO ticket, when asked for a ticket's status or next step, when starting or
  resuming a spike or its census, when asked to write, harden or prove a test suite, when asked
  to set up or revise testing rules or the codex, to replay War Games, or to show the testing
  board. Replaces purco-ticket, purco-spike, test-forge, test-rules, test-replay and test-status.
argument-hint: "<TICKET | status | next | <phase> | spike <TICKET> [verb] | test \"<targets>\" | rules | replay | board | ship | respond>"
metadata:
  category: user
  tags: [workflow, orchestrator, ticket, spike, test-forge, testing]
---

# /purco

One engine, three workflows, one session. The engine at
`/Users/franciscohernandez/projects/purco-projects/purco-orchestrator` runs the workers, keeps a
lead session that remembers the whole run, and stops at the gates. This session is the hub: it
launches once, arms one watch, and puts every question, gate and signature in front of the user.
The engine holds the memory, so this session stays small and never needs `/clear` to continue.

## Paths

Resolve these once, from the probe, never from the conversation.

```bash
ORCH=/Users/franciscohernandez/projects/purco-projects/purco-orchestrator
ENGINE=$ORCH/packages/engine
STATE=$ENGINE/bin/ticket-state.sh
TICKET=<PURCO-XXXX>
GAF=/Users/franciscohernandez/projects/purco-projects/general-access-files/$TICKET
WT=<worktree from the probe>
DB=$GAF/orchestrator.sqlite
```

## Dispatch

| Argument                               | Do this                                                                             |
| -------------------------------------- | ----------------------------------------------------------------------------------- |
| `PURCO-1234`, `1234`, `run PURCO-1234` | The ticket workflow through the hub. Read `references/hub.md`.                     |
| _(empty)_, `status [TICKET]`           | Probe and report: phase, open questions, last run, cost. Change nothing.           |
| `next`, or a phase name                | Run one phase in this session, per `references/phases.md`.                          |
| `spike <TICKET> [verb]`                | The spike workflow. Read `references/spike.md`.                                     |
| `test "<targets>" --focus "<lines>"`   | A standalone Test Forge operation through the hub. Read `references/hub.md`.       |
| `rules [--scope backend\|frontend]`    | The Test Forge doctrine session, in this session. Read `references/test-rules.md`. |
| `replay [scenario]`                    | War Games replay. Read `references/test-replay.md`.                                |
| `board`                                | The Test Forge board, read-only. Read `references/test-status.md`.                 |
| `ship`, `respond`                      | Commit, PR and PR feedback, in this session, per `references/phases.md`.           |

## The probe comes first

The probe is the only trustworthy source for the branch, the base, the PR and the phase:

```bash
$STATE probe [TICKET]
```

If it finds no worktree, run `/wt PURCO-XXXX` and nothing else. Do not run `git worktree`, `yarn`
or `cp` yourself.

## The hierarchy

```
LEVEL 0  the user + this session (the hub): QUESTION, GATE, SIGN, RUN_END
LEVEL 1  the lead (Opus 5.5, one resumed session per run) + the engine (steps, gates, budget)
LEVEL 2  workers, one fresh context per step: per phase, per brief, per cluster
LEVEL 3  inside the test step only: Test Forge posts, dispatched from the gates work list
```

The engine owns the order of the steps; the lead owns judgment at the points the engine hands it.
Workers that judge (tester, verifier, reviewer, every Test Forge post) never see the builder's
reasoning, only files.

## The context pack

Every ticket owns `general-access-files/PURCO-XXXX/`. It is the durable memory of the ticket:

```
00-RUNBOOK.md             the next command, from assets/runbook.template.md
01-ticket-and-context.md  intake
02a-open-questions.md     the inquisitor's questions (and .json)
03-decisions.md           what the user settled; the engine writes the grill answers here
02-plan.md                the approved plan
04-brief-<n>-<slice>.md   one brief per slice, built in file-name order
05-test-notes.md          only when the plain tester ran instead of Test Forge
06-verification.md        live-app evidence
07-review-findings.md     review output
forge-run.json            the Test Forge run id for this ticket
orchestrator-runs/<run>/  events, report.md, gates/, journal/, forge.log
```

## Gates

The engine stops at these and posts a GATE item; the user answers through this session.

1. After intake: the intake card.
2. After plan: the plan card. An explicit approval before any code.
3. The Test Forge plan: the operation plan, with its agent count and cost estimate.
4. Before any commit, in this session: "Ready to commit and push?" Applying review fixes is not
   permission to commit them.
5. Before pushing to a base that is not `dev`.

## Rules

- Serial only. One worktree, one run at a time.
- Workers never stage, commit, push or rebase. `ship` belongs to this session and the user.
- Never answer a question, a gate or a signature for the user. Route it.
- Never mark a phase done by hand. The engine records phase state through `ticket-state.sh`.
- The gates are code. When one refuses, read the refusal; it names what is open.
- Artifacts go in the context pack, never in the repository.
- Guardrails for the code itself are in `references/guardrails.md`.
- Report in Simplified Technical English, plain text labels, no icons.
