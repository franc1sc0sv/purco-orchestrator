# Workflows

The Workflow tool needs explicit opt-in. Invoking `purco-ticket --workflow`,
or the user asking for one in their own words ("make a dynamic workflow for
this", "orchestrate this", "launch multiple agents"), is that opt-in. Nothing
else is — a phase that would merely benefit from parallelism gets done
directly.

Load the `workflow-authoring` skill before writing a script. The size
guideline for this session is medium: under 15 agents.

## When a workflow earns its cost

It pays when the work fans out over **independent** units and each unit's
result can be checked mechanically:

- one lane per widget, per module, or per file scope
- review-then-verify, where each finding is verified as its review lands
- a test scope split across several usecases
- many Playwright lanes checking separate flows and roles

It does not pay for a single brief, a single file, or anything where the units
must agree with each other as they go. Two sequential agents are not a
workflow.

## The observed anti-pattern

> "Whenever you are finishing a workflow, you are finding more and more issues,
> and that is not possible."

A workflow that surfaces new problems at the end was scoped wrong: the lanes
shared state, or the verification was inside the same agent that did the work.
Split verification into its own phase with its own agent, and give each lane a
schema so a lane either produced a result or failed loudly.

Also observed: workflows running long. Keep per-agent scope small and give
each lane a hard deliverable rather than an open instruction.

## Ticket-shaped patterns

### Fan out over slices, verify each as it lands

The default. Each slice implements from its own brief; its verification starts
as soon as that slice finishes, without waiting for the others.

```js
export const meta = {
  name: "purco-ticket-slices",
  description: "Implement each brief slice, then verify each one as it lands",
  phases: [{ title: "Build" }, { title: "Verify" }],
}

const SLICES = args.slices

const results = await pipeline(
  SLICES,
  (s) =>
    agent(
      `Read general-access-files/${args.ticket}/04-brief-${s}.md and implement it. ` +
        `Stay strictly inside its scope. Do not commit.`,
      { label: `build:${s}`, phase: "Build", schema: BUILD_SCHEMA }
    ),
  (build) =>
    parallel(
      build.touchedFiles.map(
        (f) => () =>
          agent(`Verify ${f} against the brief's acceptance check. Report pass/fail with evidence.`, {
            label: `verify:${f}`,
            phase: "Verify",
            schema: VERDICT_SCHEMA,
          })
      )
    )
)

return { results: results.flat().filter(Boolean) }
```

### Flag matrix over a test scope

One lane per unit, each run twice, so a flag regression cannot hide.

```js
const LANES = args.scopes.flatMap((s) => [
  { scope: s, flag: "on" },
  { scope: s, flag: "off" },
])

const out = await parallel(
  LANES.map(
    (l) => () =>
      agent(
        `Run the usecase tests for ${l.scope} with ${args.flag} = ${l.flag}. ` +
          `Report every failure with its assertion diff. Do not fix anything.`,
        { label: `test:${l.scope}:${l.flag}`, phase: "Test", schema: TEST_SCHEMA }
      )
  )
)
```

Two lanes must never share a worktree. Give each lane its own scope inside one
tree and run them read-only, or serialize anything that writes — a parallel
edit in a shared tree reverts the other lane's work, and even a read-only
review agent has done it.

### Playwright lanes over flows and roles

```js
const CHECKS = args.flows.flatMap((flow) =>
  args.roles.map((role) => ({ flow, role }))
)

await parallel(
  CHECKS.map(
    (c) => () =>
      agent(
        `Use the live app with Playwright. Log in as ${c.role}, walk ${c.flow}, ` +
          `and report what you see with a screenshot. Do not modify any file.`,
        { label: `e2e:${c.role}:${c.flow}`, phase: "Verify", schema: FLOW_SCHEMA }
      )
  )
)
```

Playwright lanes need separate browser sessions — use `playwright-parallel`,
and confirm which dev server is already running before starting another.

## Rules for every ticket workflow

- **No nested subagents.** A workflow agent does not spawn its own.
- **Never fork `purco-review`.** Invoke it directly.
- Workflows do not commit. They report; the user approves; then ship.
- The tree must be green at each phase boundary, since a lane starts from the
  tree the previous phase left.
- `isolation: "worktree"` fails when the session is already in a worktree —
  which is the normal case for a ticket. Run in the current tree instead.
- Write each lane's output into the context pack, not into the transcript, so
  the next session can read it.
