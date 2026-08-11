# TEST FORGE

Test Forge is a multi-agent system that first learns a repository's testing standards from the tests
it already has, and then writes new integration tests to those standards. A doctrine session turns
each standard into a **rule** — a detection procedure with fixtures, a rubric and a human signature —
and an operation drives a squad of agents until ten objective predicates are all true. Nothing is
installed into any repository: the whole system lives under `~/.claude/testing` and works on every
project you point it at.

---

## Getting started — hand this to your AI

Clone this repository, open a Claude Code session anywhere, and paste the block below. It performs
the whole installation and stops when `/test-forge` is ready to use.

> Set up Test Forge on this machine. Work through these steps in order and stop at the first one
> that fails, telling me exactly what failed.
>
> 1. Confirm `node --version` is 22 or newer. The server runs TypeScript directly through Node's
>    native type stripping, so there is no build step. If it is older, stop and tell me.
> 2. Confirm Docker Desktop is running with `docker ps`. If it is not, stop and tell me.
> 3. Move this clone to `~/.claude/testing` if it is not already there, then run `npm install`
>    in it.
> 4. Copy each of `skills/test-forge`, `skills/test-rules`, `skills/test-replay` and
>    `skills/test-status` into `~/.claude/skills/`.
> 5. Register the MCP server at user scope:
>    `claude mcp add-json test-forge '{"command":"node","args":["'"$HOME"'/.claude/testing/packages/mcp/src/server.ts"]}' --scope user`
> 6. Verify with `claude mcp list` that `test-forge` is connected. If it is not, stop and tell me.
> 7. Add Docker Desktop's binary directory to my shell `PATH` if it is missing —
>    `/Applications/Docker.app/Contents/Resources/bin` on macOS. Without it the credential helper
>    cannot be resolved and every mutation campaign fails to boot. Do not skip this.
> 8. Tell me to restart my Claude Code session, because the MCP server only loads its code when the
>    process starts.
>
> After I restart, in a session opened inside the repository I want to test:
>
> 9. Read `~/.claude/testing/codex-exports/purco-web-backend.codex.json` and import it with the
>    `codex_import` tool, passing the file's contents as the payload and my repository path as
>    `cwd`.
> 10. Confirm the tool list contains `mutation_campaign_start`, `mutation_batch_run` and
>     `board_outcome_record_batch`, then run `/test-status` and show me the board.

Full detail, and what to do when something goes wrong, is in [SETUP.md](SETUP.md).

**Three things to know before your first run.** Imported rules arrive as _advisory_, never blocking —
read them and promote the ones you agree with. **Restart your session after every `git pull`**, because
a running server keeps the code it loaded and the failure is silent. And run **one mutation campaign at
a time**: six workers is six Vitest processes plus a container set.

---

## The four commands

There are four commands and no others.

| Command        | What it does                                                                                                                                                                            | When you run it                                                                                                                                  |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/test-rules`  | A doctrine session. Learns rules from the existing test corpus, then grills you until each rule is enforceable, fixtured and frozen into the codex. Writes no test and runs no test.    | Once per repository before anything else. Again whenever a standard changes, an aspect is empty, or a review keeps arguing about the same thing. |
| `/test-forge`  | One operation. Writes the tests, reviews them rule by rule, runs them, verifies every failure, mutates the source to prove the tests bite, prunes the tests that earn nothing, reports. | When you want a test suite for named use cases or files — written, proved and finished, not drafted.                                             |
| `/test-replay` | Re-runs every recorded War Games scenario (a past agent failure) against the current briefs and current rules. Reports total, passing, newly regressed, newly fixed.                    | After **any** change to a rule, a rubric, a fixture set or an agent brief. Before trusting a restored rank.                                      |
| `/test-status` | Shows the board: every agent post, its rank, score, trend and state, and the one thing worth your attention. Read-only.                                                                 | When you want to know which aspect is weak or what to run next.                                                                                  |

### The one hard rule

**`/test-forge` refuses to run without a codex for the scope.** The first thing it does is call
`codex_gaps` and `codex_rules_for`. If no rule is accepted for `backend` or `frontend`, it does not
open a run, does not spawn an agent, and does not write a test "in the meantime". It tells you to run
`/test-rules` first. A test written against no standard cannot be reviewed against one, so the
refusal is the feature.

### The one habit

**Run `/test-replay` after any rule change.** A rule edit that fixes one detection usually breaks
another, and the War Games corpus is the only thing that tells you which. Replay is cheap; a silently
weakened inspector is not. The same habit covers a rubric edit, a new fixture and any change to an
agent brief.

---

## Where things run

`/test-rules`, `/test-replay` and `/test-status` read the corpus and the database. **They need no
Docker**, no test infrastructure and no running services. Run them anywhere, including on a machine
that cannot start a container.

`/test-forge` **must run where Docker runs.** The operation executes the real suite — three times for
the flake probe through `runner_flake_probe`, then once per mutant through `mutation_apply_and_run` —
and an integration suite needs its containers: Postgres, LocalStack, the mail catcher, the payment
mock. On a machine without Docker, gates 2, 5, 6 and 7 cannot be cleared, so the run stalls with
nothing to show for it. Start the test infrastructure before you start the operation, and let the
Range Officer reuse it.

---

## The three groups

Everything under `~/.claude/testing` belongs to exactly one of three groups, split by what a thing
**is** rather than by which command reads it:

| Group        | Holds                                                                                       | Who edits it                                                                 |
| ------------ | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `packages/`  | **Code.** The contracts, the MCP server, the headless host.                                 | Changed by a code edit, reviewed like code.                                  |
| `resources/` | **Authored content** that code reads: briefs, doctrine, canaries, templates.                | Written and revised by a human, in prose or JSON.                            |
| `data/`      | **Machine state.** `forge.db`, the runner sessions, the session logs and the codex exports. | Written only by the server, the runner and the skills. Never edited by hand. |

The split exists so that each group has one rule. Code is typed and type-checked. Content is
reviewed as writing, and an edit to it is a doctrine decision, not a deployment. State is disposable
in form and precious in content — you back it up, you never hand-edit it. When the three were mixed
in one directory, a brief edit and a server change looked the same in a diff, and the database sat
beside the source it was written by.

---

## Install

Node **22.20 or later** is required. Node strips TypeScript types natively, so the packages run as
`.ts` files directly: **there is no build step and no `dist` folder.** The database is the built-in
`node:sqlite` module, so nothing is compiled and no native dependency is installed.

```bash
cd ~/.claude/testing
npm install
```

That one install covers every package — `packages/` is an npm workspace.

Type-check the whole workspace at any time:

```bash
npm run check
```

### Register the MCP server

Roland is the tool layer. Every command reaches it as `mcp__test-forge__<tool>`, so register it once,
at user scope, and every project sees it:

```bash
claude mcp add --scope user test-forge -- node /Users/franciscohernandez/.claude/testing/packages/mcp/src/server.ts
```

Check it:

```bash
claude mcp list
```

`test-forge` must be listed and connected. If it is not, no command will work — the skills call
Roland on their first tool call and stop when he does not answer.

Every Roland tool takes a `cwd` argument: an absolute path inside the target repository. That is how
one server, registered once, serves every project.

### The headless runner (optional)

`packages/runner` is a host that drives an operation without a chat window. It loads the ledger
state, builds one cycle prompt per pass from the false predicates, and keeps calling the agent SDK
with the stored session id so context carries from cycle to cycle.

```bash
cd ~/.claude/testing/packages/runner

# cycle 1: the plan, and nothing else
node src/main.ts --cwd /path/to/repo --scope backend \
  --focus "Cover the payment allocation use case, including the refund branch." \
  --target src/server/api/payments/allocate.usecase.ts

# after you have read the plan
node src/main.ts --cwd /path/to/repo --run 7 --approve-plan
```

The runner prints a live spend readout after each cycle — cumulative output tokens, cost and elapsed
time — because there is no budget cap and no pass limit. It stops on `DONE`, `BLOCKED` or `STALLED`,
never on a token count. On `BLOCKED` it prints the single question and exits cleanly, so you answer
it and resume the same run with `--run <id> --approve-plan`. Ctrl-C saves the session and tells you
how to resume.

The host enforces the standing orders itself rather than trusting a prompt: no git commands, no
secret or `.env` file read through any tool, and no write to a file that is not a test file. A
refused call comes back to the agent with the reason.

---

## The tool vocabulary

Roland exposes one flat catalogue of 47 tools. These names are the whole vocabulary; a skill, a brief
or the runner that names anything else is wrong, not the server.

| Family   | Tools                                                                                                                                                                                                                                                                                   |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ast      | `ast_check`, `ast_file_facts`, `ast_corpus_hash`                                                                                                                                                                                                                                        |
| board    | `board_outcome_record`, `board_compute`, `board_attention`, `board_wargame_record`, `board_wargame_list`, `board_replay_record`                                                                                                                                                         |
| closure  | `closure_compute`, `closure_resolve`, `closure_unresolved`                                                                                                                                                                                                                              |
| codex    | `codex_rules_for`, `codex_rule_get`, `codex_rule_write`, `codex_accept_rule`, `codex_retire_rule`, `codex_revert`, `codex_history`, `codex_fixture_add`, `codex_fixture_list`, `codex_taxonomy_set`, `codex_aspects`, `codex_gaps`, `codex_export`, `codex_import`, `codex_corpus_mark` |
| gates    | `gates_evaluate`, `gates_status`                                                                                                                                                                                                                                                        |
| ledger   | `ledger_run_start`, `ledger_run_end`, `ledger_pass_record`, `ledger_unit_upsert`, `ledger_finding_upsert`, `ledger_verdict_record`, `ledger_overturn_record`, `ledger_waiver_record`, `ledger_finding_known`, `ledger_state`                                                            |
| mutation | `mutation_generate`, `mutation_apply_and_run`, `mutation_survivors`, `mutation_equivalence_record`, `mutation_attribution`                                                                                                                                                              |
| runner   | `runner_run_suite`, `runner_flake_probe`, `runner_gate_static`                                                                                                                                                                                                                          |

`ast_file_facts` returns a file's imports, test titles and structure in one call, so there is no
separate outline, search or imports tool to reach for.

Every result is capped at 25000 characters. `closure_compute` and `ast_file_facts` can exceed that on
a wide scope; when they do, the result is truncated and names the argument that narrows it.

---

## File layout

```
~/.claude/testing/
  package.json              the npm workspace root
  tsconfig.base.json        strict, nodenext, erasableSyntaxOnly
  README.md                 this file

  packages/                 CODE
    contracts/              shared types, imported by both other packages
      src/                  one module per family, reached through the exports map
    mcp/                    test-forge-mcp-server, entry src/server.ts
      src/mcp/              the tool catalogue: registration, schemas, annotations
      src/application/      one file per tool, orchestrating domain and infrastructure
      src/domain/           pure functions over plain data: scoring, gates, operators, AST facts
      src/infrastructure/   the SQLite connection, the filesystem, git, child processes
    runner/                 test-forge-runner, entry src/main.ts

  resources/                AUTHORED CONTENT
    agents/                 one brief per post, grouped by squad
      command/palmer.md     the orchestrator - a main loop, never a subagent
      gray-team/            doctrine: Jai-006, Adriana-111, Mike-120, CPO Mendez, Deja
      blue-team/            authorship: the Pathfinder, the Quartermaster, the Spartan authors
      osiris/               review: the Inspectors, and Locke the Adjudicator
      majestic/             execution: the Armorer, the Range Officer, the Stress post
      noble/                verification: Carter-A259, Jorge-052, the Oracle, the Skeptic, the Tracker, Lone Wolf
      headhunters/          mutation: the Ghost, the Hunter, the Saboteur
      section-zero/         audit: the Warden and the Registrar
    doctrine/
      rule.schema.json      the shape a rule must have to be accepted
      taxonomy.seed.json    the seed aspects for backend and frontend
      mechanization.md      full, partial and judgment: what a rule may claim to detect
    canaries/               planted violations per aspect, for the Warden's reviewer-integrity audit
      manifest.json
      backend/              one .bad.ts per backend aspect
      frontend/             one .bad.tsx per frontend aspect
    templates/
      report.html           the operation report shell

  data/                     MACHINE STATE
    forge.db                every rule, run, finding, verdict, mutant, rank and War Games scenario
    sessions.json           the runner session id per project and scope
    sessions/               one doctrine session log per project and date
    exports/                the codex payloads written by /test-rules --export

~/.claude/skills/
  test-forge/SKILL.md       the operation, its phases and its eight gates
  test-rules/SKILL.md       the doctrine session
  test-replay/SKILL.md      the War Games replay
  test-status/SKILL.md      the board
```

The skills must live under `~/.claude/skills` — Claude Code discovers them nowhere else.

### Naming an agent

The runner keys each brief by its callsign in lower case with dashes, plus a short alias and the
brief's file name. `john-117`, `linda-058`, `vale`, `thorne`, `parangosky` and `inspector` all
resolve. Where one callsign holds two posts, the bare name goes to the more specific brief: `locke`
is the Adjudicator, and the Inspector post is `inspector`, `vale`, `buck` or `tanaka`.

---

## How a project is identified

Every row in the database carries a project key, so one database serves every repository without a
codex from one project ever being applied to another. You never pass that key: every Roland tool
takes `cwd`, an absolute path inside the target repository, and derives the key from it.

The key comes from the git remote of that repository, normalised so that the form of the URL does not
matter:

```
git@github.com:Org/Repo.git   ->  github.com/org/repo
https://github.com/org/repo   ->  github.com/org/repo
```

The scheme, the user, the port, a trailing slash and the `.git` suffix are all stripped, and the
result is lower-cased. A clone, a fork checked out elsewhere and a worktree therefore share one
codex, which is what you want: the standards belong to the repository, not to the directory.

A directory with no git remote falls back to the absolute path of its repository root, which
`git rev-parse --show-toplevel` reports. That works, but it is per-machine and per-path — move the
directory and the codex looks empty. Set a remote before you invest a doctrine session in a project.

To see the key a directory will resolve to before you write anything, read the remote yourself:

```bash
git -C /path/to/repo config --get remote.origin.url
```

---

## The codex is append-only

A rule is never updated in place. `codex_rule_write` appends a new version row, and the accepted
version is the newest one that carries a human signature through `codex_accept_rule`. Reverting a bad
rule change is a query, not a recovery: `codex_revert` picks the previous version and accepts it.
That is also why `/test-replay` matters — the War Games corpus is the evidence that the version you
just accepted still detects what the last one detected.
