---
name: test-status
description: Shows the TEST FORGE board for this project - how every agent post is performing, its rank, score, trend and state - and names the one thing worth the user's attention. Use when asked how the testing agents are doing, which aspect is weak, what to run next, or for a TEST FORGE status or ranks report. Read-only; it changes no rule, no test and no repository file.
---

# /test-status - the board

Read-only. You compute the board and print it. You do not open a run, you do not spawn an
agent, you do not touch the codex or the repository. The only state that moves is the rank
cache inside `forge.db`, which `board_compute` rewrites from the outcomes already recorded;
no rule, no test, no fixture and no file in the repository is written or read for writing.

## Roland tool names

The MCP server is `test-forge`; tools appear as `mcp__test-forge__<name>` and every one
takes `cwd` - an absolute path inside the target repository. Roland resolves the project
from that path himself.

This skill uses two tools and nothing else:

| Tool              | Arguments                | Returns                                                         |
| ----------------- | ------------------------ | --------------------------------------------------------------- |
| `board_compute`   | `cwd`, optional `window` | `{ board, counts: { posts, byState }, windowSize }`             |
| `board_attention` | `cwd`                    | `{ sentence, basis }` - the one sentence naming the next action |

If either call fails, say so and stop. Do not reach for another tool, and do not compose a
board from anything else.

## Method

1. Take the absolute repository root as `cwd`. Name the repository in the header from that
   path; there is no tool that reports a project key, and the board does not need one.
2. Call `board_compute` with `cwd`. The optional `--window N` argument sets the rolling
   window; the default is 40 outcomes. Every entry in `board` carries `callsign`, `post`,
   `aspect`, `score`, `state`, `rank`, `trend`, `outcomes`, `windowSize` and
   `unscoredEvents`. The array arrives sorted by score descending.
3. Call `board_attention` with `cwd`. Print its `sentence` verbatim. Do not write your own.
4. Print the board grouped by squad, then the interpretation, then the key reading, then
   the single next action.

If `board_compute` returns an empty `board`, print the header, say "No scored outcomes
recorded for this project yet", print the `board_attention` sentence, and stop.

## Squad grouping

Group each entry by the `post` string it carries:

| Squad             | Posts                                                                                                                                                      |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Command           | Orchestrator                                                                                                                                               |
| Gray Team         | Surveyor, Cartographer, Archivist, Lawgiver, Examiner                                                                                                      |
| Blue Team         | Author, Pathfinder, Quartermaster                                                                                                                          |
| Fireteam Osiris   | Inspector, Adjudicator                                                                                                                                     |
| Fireteam Majestic | Armorer, Range Officer, Stress                                                                                                                             |
| Headhunters       | Saboteur, Ghost, Hunter                                                                                                                                    |
| Noble Team        | Verification Lead, Execution Path Tracker, Cross-Boundary Execution Path Tracker, Intent Oracle, Refutation, Contested Failure - Independent Re-derivation |
| ONI Section Zero  | Reviewer Integrity Audit (Canary Control), Board, Ranks and War Games                                                                                      |

A post not in this table goes under "Unassigned". Inside a squad, sort by score ascending -
the weakest first, because that is what the reader is looking for. That reverses the order
`board_compute` returns, so sort the group yourself.

## Output

```
TEST FORGE board - <repository>
window: last <N> outcomes

Gray Team
  CPO Mendez        Lawgiver     Field Marshal   93.4  up     HOLDING          (25 outcomes)
  Deja              Examiner     Sergeant        71.0  down   WATCH            (12 outcomes)

Fireteam Osiris
  Locke             Inspector    Corporal        62.5  flat   NEEDS ATTENTION  (18 outcomes)   aspect: assertions
...

Columns: callsign, post, rank, score, trend, STATE, outcome count, aspect.
```

Show the aspect on every row that carries one. Where one callsign holds a post across
several aspects, print one row per aspect - a post can hold in one aspect and stand down in
another, and merging the rows hides exactly the fact the reader needs.

Where an entry reports `unscoredEvents` above zero, add that count to the row. Those events
were recorded under an event kind the board does not score, so they widen the window without
moving the score.

Then print this block in full. It is the point of the command, not a footnote.

```
How to read a state

  HOLDING          85+     Do nothing. This is not where your attention belongs.
  WATCH            70-84   Read the last two War Games entries for that post.
  NEEDS ATTENTION  50-69   Run /test-rules on the named aspect.
  STAND DOWN       under 50  The post is demoted and the aspect goes back to doctrine.

The key reading

  A low score almost always points at the DOCTRINE, not the agent. Every Spartan in a
  post reads the same rule, so a rule that one competent reviewer misreads will be
  misread again by the next one. The action is to make the rule decidable - sharper
  appliesWhen, a near-miss fixture, a rubric question with a citation it can be
  anchored to - not to rewrite an agent.
```

End with exactly one line, the sentence returned by `board_attention`:

```
Next: <the sentence>
```

Print nothing after it.

## Rank ladder, for reference

Inheritor 97+ (40 outcomes), Field Marshal 93+ (25), Captain 88+ (15), Warrant Officer 80+
(8), Sergeant 70+ (4), Corporal 55+ (1), Recruit otherwise. A rank needs both the score and
the outcome count, so a new post sits at Recruit until it has been used enough to mean
something. Say that when a reader asks why a high score shows a low rank.

## What this skill never does

- It never opens a run, spawns an agent, or writes a rule, a fixture or a test.
- It never calls a third tool. `board_compute` and `board_attention` are the whole command.
- It never invents an action sentence. `board_attention` computes it.
- It never explains a low score as an agent being weak before the doctrine for that aspect
  has been checked.
