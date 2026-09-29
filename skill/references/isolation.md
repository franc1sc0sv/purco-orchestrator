# Isolation

A phase must not inherit the reasoning of the phase before it. The agent that
wrote the code must not be the agent that tests, verifies or reviews it.

## Isolation is not parallelism

Read this first. Isolation means **separate context**, not **same time**.

Phases run one after another, in one worktree. Two agents that edit the same
worktree revert each other, and a read-only review agent has done it here as
well. Never fan out edit agents into one tree. Never run two phases at once to
"save time".

The only thing that runs in parallel is a fan-out inside a single phase, over
units that do not touch the same files. `references/workflows.md` covers that.

## What crosses a phase boundary

Only files. Never a transcript, never a conclusion, never a reassurance.

A phase ends when its output file is written. The next phase starts by reading
its declared inputs, and nothing else. If a phase needs something that is not
in its input list, that is a signal the earlier phase did not write down
enough — go back and write it down. Do not pass it through conversation.

## The input contract

| Phase   | May read                                                                                      | Must not read                                                        |
| ------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| intake  | Linear ticket and project, existing pack, open PRs, worktree state, ADRs, `CONTEXT.md`        | —                                                                    |
| plan    | `01-ticket-and-context.md`, the code it will touch                                            | —                                                                    |
| build   | one `04-brief-*.md`, `02-plan.md`, `03-decisions.md`, the repo                                | `05`, `06`, `07` from an earlier round                               |
| test    | `04-brief-*.md`, `02-plan.md`, `03-decisions.md`, the codex, the diff **for file scope only** | the build context; the implementation as a source of expected values |
| verify  | `04-brief-*.md`, `02-plan.md`, the running app                                                | the build context; the test files                                    |
| review  | the diff, `02-plan.md`, `03-decisions.md`, the spec and ADRs, `guardrails.md`                 | the build context; any claim that the change is correct              |
| respond | the PR comments, the diff, `guardrails.md`                                                    | the reviewer's framing as settled truth                              |
| ship    | the probe output                                                                              | —                                                                    |

Three entries in that table are the whole point:

- **test** reads the diff to know which files to scope, and nothing more from
  it. Every expected value is hand-computed from factory data and from the
  brief. An expectation copied out of a run encodes the bug instead of
  catching it.
- **verify** uses the live app. A green suite is not verification, and the
  test files are not evidence.
- **review** gets the diff and the spec, never the argument for why the diff
  is right. On a stale spec a deviation is still a true positive.

## The breach rule

`build` must not share a context with `test`, `verify` or `review`.

The probe checks this and reports it:

```
isolation
  BREACH   test    shared a context with build (session:0eb59c05-…)
```

A breach is not fatal, and it does not invalidate the code. It means the
judgement was made by the author, so it carries no independent weight. Re-run
that phase in a fresh context before you trust it.

## How to isolate a phase

Through the engine (`/purco <TICKET>`) this is automatic: every step is a fresh
Agent SDK session, and judging workers read only files. The two ways below are
for the in-session lane. Both are valid; pick by whether you want a human
checkpoint.

### Fresh session — hard isolation

The strongest option, and the reason `00-RUNBOOK.md` exists. At the end of a
phase, print the next phase's command and stop. The user runs `/clear`, or
opens a new session in the worktree, and pastes it. The new context has no
memory of the build at all.

Use it for `test`, `verify` and `review` whenever the ticket matters.

### One subagent per phase — automatic isolation

The parent orchestrates and holds only the phase reports. Each phase is one
`Agent` call whose prompt names its allowed inputs and forbids the rest.

```
Read only these files: general-access-files/PURCO-XXXX/04-brief-a.md and
02-plan.md. Do not read any other file in that folder. You are testing an
implementation you did not write and must not assume it is correct. Derive
every expected value from the brief and from factory data, never from running
the code. Report failures with the assertion diff. Write your notes to
05-test-notes.md.
```

Constraints:

- One agent per phase. `build` is always a single agent — never two.
- No nested subagents. A phase agent does not spawn its own.
- Never fork `purco-review`; invoke it directly.
- Record the phase with its own context label so the breach check is real:

```
TICKET_CTX="agent:tester-1" ticket-state.sh set test done "usecase tests"
```

Without `TICKET_CTX`, the phase records the session id, and a subagent inherits
the parent's session id — so the breach check would miss it. Pass the label.

## Recording context

`set` stores a `ctx` field with every phase. It defaults to
`session:$CLAUDE_CODE_SESSION_ID`. Override it with `TICKET_CTX` or as the
fourth argument:

```
ticket-state.sh set review done "purco-review" "agent:reviewer-1"
```

`probe` prints each phase's context and the breach list. `json` returns
`.isolation.breaches` as a count, so a workflow can gate on it.

## What isolation does not fix

Isolation removes author bias. It does not remove a bad brief. If the brief is
wrong, an isolated tester writes tests that faithfully prove the wrong thing.
That is what the intake and plan gates are for.
