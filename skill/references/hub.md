# The hub loop

This session is the hub. The engine and its workers are the spokes. Every decision a worker or
the lead cannot make reaches the user here, and you put it in front of them. Never answer one
yourself.

One ticket is one launch and one watch. The run pauses at each gate inside the engine and
continues when the user answers, so there are no segments to relaunch and no context to rebuild.

## Keep this session small

The engine keeps the memory: the lead's session, the store, the pack and the run directory. This
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

Reuse the last run id for this ticket, so a resumed ticket keeps its steps, questions and lead
session under one key:

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
  --budget <usd> \
  --worktree $WT
```

- Add `--resume` when the run id already has steps.
- A standalone Test Forge operation: add `--workflow test --targets "<targets>" --focus "<lines>"`,
  and `--scope backend|frontend` when the targets do not make it obvious.
- `--mailbox-db` is required: without it the run asks on its own stdin, which no background
  process can answer.
- `--budget` is the ceiling for the whole run, lead included. Take it from the last
  `report.md` of a similar ticket; the cost table there names each step.
- `--dry-run` prints the steps and the gates and costs nothing.
- Do not pass `--model`. Every role names its own model, all Opus 5.5 or Sonnet 5.5.

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

Report the step table, the cost and why the run ended. A step that ended `escalated` or a run that
`stopped` did not finish: say what stopped it, from the status output, and what the user can
change before a relaunch with `--resume`.

Then `ship` in this session, per `references/phases.md`, after the user says yes.
