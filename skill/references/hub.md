# The hub loop

This session is the hub. The engine and its workers are the spokes. Every decision a worker or
the lead cannot make reaches the user here, and you put it in front of them. Never answer one
yourself.

One ticket is one launch and one watch. The run pauses at each gate inside the engine and
continues when the user answers, so there are no segments to relaunch and no context to rebuild.

## Keep this session small

The engine keeps the memory: the store (steps, results, the lead's decision log), the pack and the run directory. The lead keeps none; it gets a fresh brief for each decision. This
session keeps only the paths, the run id and the items the watch reports.

- Do not read `report.md`, `live.md`, `events.jsonl` or the pack files unless the user asks, or a
  question needs one file to be answered.
- Show a gate card as the engine wrote it. Do not re-derive it.
- If this session is lost or cleared, run `/purco <TICKET>` again. It reads the last run id from
  the store and relaunches with `--resume`; no decision is lost, because answers live in the store.

## Move 0: once per ticket

1. Probe: `$STATE probe PURCO-XXXX`. If there is no worktree, run `/wt PURCO-XXXX` first, and ask
   the user for the base when the ticket is stacked.
2. Seed the pack: `$STATE init PURCO-XXXX`, then write `00-RUNBOOK.md` from
   `assets/runbook.template.md`.
3. Intake needs the ticket. `LINEAR_API_KEY` in the environment or the macOS Keychain is enough.
   Without it, write `<pack>/00-ticket.md` from this session before you launch.

## Move 1: the run id

Reuse the last run id for this ticket, so a resumed ticket keeps its steps and questions under one key.
The engine holds a lease on the ticket, so a second launch is refused while the first is alive; a run whose
process died is taken over after 60 s of silence:

```bash
node --experimental-strip-types --no-warnings -e "
import { DatabaseSync } from 'node:sqlite';
const d = new DatabaseSync(process.argv[1]);
for (const r of d.prepare('select run_id, status, started_at from runs order by started_at desc limit 3').all())
  console.log(r.run_id, r.status, r.started_at);
" $DB
```

No row, or the user wants a fresh run: `RUN=ticket-$(date +%Y%m%d-%H%M%S)`. A row that is not
`complete`: reuse it and add `--resume`.

## Move 2: arm the watch, before the launch

`Monitor` with `persistent: true` and a specific description, for example
`purco run for PURCO-3252`:

```bash
node $ENGINE/bin/purco-spike.js watch --db $DB --run $RUN --interval 5
```

An item posted with nobody listening waits until the next `status` call, and the run stays blocked
meanwhile.

## Move 3: launch once, detached

Bash with `run_in_background: true`:

```bash
node $ENGINE/bin/purco-orchestrate.js $TICKET \
  --run-id $RUN \
  --mailbox-db $DB \
  --worktree $WT
```

- Add `--resume` when the run id already has steps.
- A standalone Test Forge operation: add `--workflow test --targets "<targets>" --focus "<lines>"`,
  and `--scope backend|frontend` when the targets do not make it obvious.
- `--mailbox-db` is required: without it the run asks on its own stdin, which no background
  process can answer.
- `--dry-run` prints the steps and the gates and costs nothing.
- `--test-depth quick|full` sets how deep the Test Forge step goes. `quick` (the ticket default)
  skips mutation and pruning, which are the longest stages; `full` (the default for
  `--workflow test`) runs them on the changed lines only. Say which one ran when you report the result.
- `--test-mode harden` (or a `test-mode.txt` file with `harden` in the context pack) mutates the changed
  lines against the existing usecase-level tests first, then adds tests only for survivors. It never
  prunes and never deletes an existing test. It ends `escalated` because D7, D8 and D9 cannot hold
  without a matrix; read the summary for the predicates that really fail. The default is `write`.
- The dashboard can answer open gates, questions and signatures (`POST /api/tickets/<ticket>/items/<id>/answer`).
- The ticket runs in four stages (plan, implementation, testing, verification) in this order: intake,
  grill, plan, build, static, test, verify, record, review. Intake sizes the ticket S, M or L, and the
  intake gate card says why ("Size: X, because: ..."). Answer the gate with `approve`, or add one word
  (`S`, `M`, `L`, `approve size L`) to change the size. The size only goes up during the run. S skips
  the grill; the test depth follows the size (S and M quick, L full) unless `--test-depth` is given.
- `verify` also writes recording scripts and `verify/flows/flows.json`; `record` then runs them with no
  model and writes the videos to `verify/videos/`. `record` is `skipped` when the ticket worktree has no
  `tests/e2e/flows/recording.config.ts` or when verify wrote no scripts. A failing script fails the
  step. Tell the user which videos exist, and embed them in the PR at ship.
- Do not pass `--model`. Every role names its own model: Sonnet 5.5 by default, Opus 5.5 for the
  planner, the reviewer, the lead, the defect skeptic and the equivalence hunter.

## Move 4: route every item

The watch emits these lines:

```
PHASE <step> <status> | <agent> | <summary>
QUESTION <id> | <agent> | <step> | <text>
GATE <id> | <agent> | <step> | <card>
SIGN <id> | <agent> | <step> | <text>
RUN_END <status> | ...
WATCH_ERROR <text>
```

Read the full text of any item with:

```bash
node $ENGINE/bin/purco-spike.js questions --db $DB --run $RUN
```

Write the answer back with:

```bash
node $ENGINE/bin/purco-spike.js answer --db $DB --run $RUN --id <ID> --text "<answer>"
```

The run continues within about two seconds. An item cannot be answered twice.

| Line       | What you do                                                                                                                                                                                                                                  |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PHASE`    | Report it in one line and keep going.                                                                                                                                                                                                         |
| `QUESTION` | `AskUserQuestion` with the real options from the text, your recommendation and why, and the file and line it concerns. Grill questions arrive this way, one at a time; "park" leaves one open, and the plan step does not start while one is. |
| `GATE`     | Show the card. `AskUserQuestion`: approve, stop, or request changes (the user's notes go back as the answer, and the step runs again with them). Answer with `approve`, `stop`, or the notes.                                                |
| `SIGN`     | A waiver or an equivalence claim that only the user can sign. Show exactly what is being signed and what it leaves unchecked. Write the user's decision, in their words, with their name.                                                   |
| `RUN_END`  | Stop the monitor, then report the status below.                                                                                                                                                                                               |

If the user is away, say so and leave the item open. Never invent an answer to keep the run
moving.

## Move 5: close out

```bash
node $ENGINE/bin/purco-spike.js status --db $DB --run $RUN
```

Report the step table, the cost and why the run ended. When a Test Forge step ran, each of its
workers has its own `test:<stage>:<file>` row in the status output; report the three most
expensive rows. `$GAF/orchestrator-runs/$RUN/forge.log` holds the vector after each pass. A step that ended `escalated` or a run that
`stopped` did not finish: say what stopped it, from the status output, and what the user can
change before a relaunch with `--resume`.

Then `ship` in this session, per `references/phases.md`, after the user says yes.
