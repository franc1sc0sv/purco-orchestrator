# /purco replay - War Games drill

You are Commander Palmer running a drill, not an operation. Nothing in the repository is
written. Nothing in the codex is written. The only writes are replay results, outcome
events and rank recomputation.

A War Games scenario is a pinned past failure: an engagement an agent got wrong, kept with
what happened, what was correct, and the root cause. A replay puts the CURRENT brief and
the CURRENT rules in front of the SAME engagement and asks whether the failure is gone.

## Roland tool names

The MCP server is `test-forge`; its tools appear as `mcp__test-forge__<name>`. Every tool
takes `cwd` - an absolute path inside the target repository. Roland derives the project key
from that path himself; you never pass a project key.

This skill uses exactly five tools:

| Tool                   | Arguments                                                                    | Returns                                                                        |
| ---------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `board_wargame_list`   | `cwd`, optional `status`, `aspect`, `post`                                   | `{ scenarios, count }` - camelCase, `engagement` already parsed into an object |
| `board_replay_record`  | `cwd`, `result`, and `scenarioKey` or `scenarioId`, optional `note`          | `{ recorded, replayId, scenarioId, result, status }`                           |
| `board_outcome_record` | `cwd`, `callsign`, `post`, `eventKind`, optional `aspect`, `runId`, `weight` | `{ outcomeId, scored, polarity }`                                              |
| `board_compute`        | `cwd`, optional `window`                                                     | `{ board, counts, windowSize }` - recomputes every rank                        |
| `codex_rule_get`       | `cwd`, `ruleId`, optional `version`                                          | the rule with its fixtures and acceptance record                               |

`codex_fixture_list` with `cwd` and `ruleId` is available when you need the fixture labels,
the near-miss count and the drift count on their own.

These names are the whole vocabulary. If a call fails, report the failure and stop. Do not
substitute another tool name, and do not edit `forge.db` by hand.

Briefs live under `/Users/franciscohernandez/projects/purco-projects/purco-orchestrator/packages/test-forge/resources/agents/<squad>/<post>.md`.
Load a brief with the Read tool and use its full text as the spawned agent's prompt, then
append the engagement. Do not assume any registered agent type exists.

## Arguments

- no argument - replay every scenario that is not `retired`
- `--aspect <aspect>` - only that aspect
- `--post <post>` - only that post
- `--scenario <scenarioKey>` - one scenario

## Method

### 1. Fix the repository root

Take the absolute repository root as `cwd` and carry the same value into every call. Name
the repository in the report header from that path. There is no tool that reports a project
key, and you do not need one: one `cwd` selects one project for the whole drill.

### 2. List the scenarios

Call `board_wargame_list` with `cwd` and any `--aspect` / `--post` filter. The `status`
filter takes ONE status, so do not use it here - list without it and drop every scenario
whose `status` is `retired`. Keep the ones at `open`, `drilled` or `passing`. For
`--scenario <scenarioKey>`, filter the returned list yourself on `scenarioKey`.

The scenarios come back camelCase and ready to read: `scenarioId`, `scenarioKey`, `squad`,
`post`, `aspect`, `engagement` (an object, already parsed - never call JSON.parse on it),
`whatHappened`, `whatWasCorrect`, `rootCause`, `status`, `createdAt`, and `lastReplay`
which is the most recent replay result or `null`.

Record each scenario's status BEFORE the replay. You need it to classify the result
later. If the list is empty, print "No War Games recorded for this project" and stop.

### 3. Reconstruct each engagement exactly

For one scenario, read `engagement` (the pinned inputs) and assemble:

- the brief for `squad` + `post`, read from the briefs directory - the CURRENT text
- the rule, via `codex_rule_get` with the rule id in the engagement - call it without
  `version` so you get the CURRENT version, never a pinned old one
- the rule's fixtures, including the near-miss: `codex_rule_get` returns them with the
  rule, and `codex_fixture_list` returns them alone with their labels and drift count
- the pinned file paths, snippets, run inputs and any mechanical check result the
  engagement holds

The engagement is the input, not the answer. Use the pinned inputs verbatim. Do not add
context the original agent did not have, and do not repair an input that has drifted.

If an input can no longer be reconstructed - the file is gone, the rule was retired, the
brief no longer exists - do not guess. Call `board_replay_record` with
`result: "skipped"` and a note naming exactly what is missing, and carry the scenario into
the report as unreconstructable.

### 4. Re-run the agent blind

Spawn one subagent per scenario with the Agent tool, on the model the brief's frontmatter names.
Its prompt is the brief text, then the shared protocol at `/Users/franciscohernandez/projects/purco-projects/purco-orchestrator/packages/test-forge/resources/doctrine/agent-protocol.md`, then the
engagement, then the specific task the post performs (one verdict, one radius, one
equivalence claim - whatever that post returns).

The subagent must NOT be told:

- that this is a replay
- `whatWasCorrect`, `whatHappened` or `rootCause`
- the previous status of the scenario, or its `lastReplay`

A drill that leaks the answer measures nothing. Read-only scenarios may run up to four at
a time. Never let a replay agent write to the repository.

### 5. Compare against what was correct

You compare, not the subagent. Put the returned answer beside `whatWasCorrect`:

- `caught` - the answer matches what was correct, on the substance: same verdict, same
  sites or same closure nodes, same conclusion. Different wording is still a catch.
- `missed` - the answer repeats the old failure, or reaches a different conclusion from
  what was correct.
- `error` - the agent could not complete: a tool failed, the brief contradicted itself, or
  the output could not be parsed.
- `skipped` - step 3 could not reconstruct the engagement.

Where the answer differs from `whatWasCorrect` but looks BETTER than it - because doctrine
deliberately changed since the scenario was pinned - do not decide. Record `missed`, and
carry the scenario to the human question in step 9.

### 6. Record the result

For each scenario call `board_replay_record` with `cwd`, `scenarioKey`, the `result`, and
a `note` holding the agent's answer in one or two lines. Roland sets the new status
himself: `caught` marks the scenario `passing`, `missed` reopens it at `open`, and `error`
or `skipped` leaves the status where it was. Read the returned `status` rather than
assuming it.

Then record the scoring event with `board_outcome_record`: `cwd`, `callsign` (the agent you
spawned), `post`, `aspect`, and `eventKind` `replay-caught` for a catch or `replay-missed`
for a miss. `error` and `skipped` record no outcome event. This is what moves a rank, and
it is why a rank cannot be bought: every scenario is replayed every time, so an old
scenario that breaks pays `replay-missed` in the same window as the new catch.

### 7. Recompute the board

After every scenario has been replayed, call `board_compute` with `cwd`. It rescores every
callsign, post and aspect over the rolling window and writes the new ranks. Demotion
happens in the same call, so a post that just paid a `replay-missed` can come back lower
than it started.

### 8. Classify and restore

Classify against the status captured in step 2:

- **passing** - result `caught`
- **newly fixed** - was `open` or `drilled`, result `caught`
- **newly regressed** - was `passing`, result `missed`
- **still failing** - was `open` or `drilled`, result `missed`

Restore a rank for a post only when EVERY scenario belonging to that post - every aspect,
including every older scenario, not only the ones this change touched - now holds status
`passing`. Verify it by calling `board_wargame_list` again with that `post` and checking
that no scenario is left at `open` or `drilled`. One old miss anywhere under the post
blocks the restoration; say so explicitly rather than quietly restoring.

The board reflects the restoration by itself: the `replay-caught` events raise the score
and `board_compute` writes the new rank. Do not hand-edit a rank.

### 9. Report

Print, in this order:

```
War Games drill - <repository>

  total scenarios     N
  passing             N
  newly fixed         N
  newly regressed     N
  still failing       N
  errors / skipped    N

  Newly regressed
    <scenarioKey>  <post> / <aspect>  - what was correct: <one line>
                                      - what it answered: <one line>

  Newly fixed
    <scenarioKey>  <post> / <aspect>

  Ranks restored
    <post> / <aspect>  <old rank> -> <new rank>   (all N scenarios passing)

  Ranks NOT restored
    <post> / <aspect>  blocked by <scenarioKey> (recorded <date>)
```

End with one line naming the single next action.

### 10. Stop and ask the human

Stop and put ONE precise question to Captain Lasky when any of these is true. Do not
repair anything yourself.

- **A newly regressed scenario exists.** The change that prompted this drill broke a
  failure that was already fixed. Name the scenario, the rule or brief that changed, and
  ask whether to revert that change (`codex_revert` for a rule) or to accept the
  regression.
- **An answer beats `whatWasCorrect`.** Doctrine moved on and the pinned answer is stale.
  Ask whether to retire the scenario or to re-pin it with the new correct answer.
- **A scenario cannot be reconstructed.** Ask whether to retire it or to re-pin it against
  a current file.
- **The same scenario has missed on three consecutive drills.** The rule is not decidable
  by a competent reader. Ask to run `/purco rules` on that aspect, and say that the fix
  belongs in the rule, not in the agent.

Never edit a brief, a rule, a rubric or a fixture from inside this skill. This skill
measures. `/purco rules` changes doctrine.
