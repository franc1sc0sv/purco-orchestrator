# purco-orchestrator

One engine for PurCo work, driven from one Claude Code session through the `/purco` skill.

| Package                    | What it is                                                                 |
| -------------------------- | -------------------------------------------------------------------------- |
| `packages/engine`          | The orchestrator: workflows, the lead, the gates, the mailbox, the workers |
| `packages/test-forge`      | Test Forge: the codex, the Roland MCP server, the runner and the briefs    |
| `skill/`                   | The `/purco` skill, symlinked into each Claude profile                     |

## The hierarchy

```
LEVEL 0  the user + the /purco session (the hub): QUESTION, GATE, SIGN, RUN_END
LEVEL 1  the lead (Opus 5.5, one resumed session per run) + the engine (steps, gates, budget)
LEVEL 2  workers, one fresh context per step: per phase, per brief, per cluster
LEVEL 3  inside the test step only: Test Forge posts, dispatched from the gates work list
```

The engine owns the order of the steps. The lead owns judgment at the points the engine hands it:
worker questions, gate cards, whether a judge's defect sends a brief back to the builder, and which
grill questions an answer settles. Every model is Opus 5.5 or Sonnet 5.5.

## Workflows

| Workflow | Steps                                                                            |
| -------- | -------------------------------------------------------------------------------- |
| `ticket` | intake, grill, plan, build per brief, test (Test Forge), verify, static, review |
| `spike`  | survey per cluster, audit, synthesize                                            |
| `test`   | one Test Forge operation                                                         |

## Install

```bash
npm install
```

Node 22.20 or later. Everything runs as TypeScript through Node's type stripping; there is no
build step. Test Forge's state lives in `packages/test-forge/data/` and is not in git.

## Tests

```bash
npm run engine-test   # free: gates, lead contract, grill, step keys, guards, store, journal
npm run hub-test      # free: the watch and mailbox signals the hub depends on
npm run smoke         # live, about $0.10: the worker tool contract against a real agent
```
