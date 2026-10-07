# Test Forge

Test Forge first learns a repository's testing standards from the tests it already has, and then
writes new integration tests to those standards. A rules session turns each standard into a
**rule**: a detection procedure with fixtures, a rubric and a human signature. In a ticket run, the
engine's `test` step drives ten objective predicates to true. Nothing is installed into any
repository.

This package holds the state and the tools. It does not orchestrate anything: the purco-orchestrator
engine (`packages/engine/src/forge.ts`) runs the test stages, and the `/purco rules` skill runs the
rules session.

## The test step

The engine runs the stages in code and starts one worker for each unit of judgment work. The roles
and their prompts are in `packages/engine/prompts/`.

| Stage   | Who                                                                   | What                                                                            |
| ------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| map     | `mapper`                                                              | the unit contract, the coverage matrix, the effect closure, one file per unit   |
| plan    | the user                                                              | approves the test plan                                                          |
| write   | `test-author`, one per file, side by side                             | writes the file, runs only that file, records covered cells and focus lines     |
| check   | code (`gates_evaluate`)                                               | types, lint, the suite and the flake probe                                      |
| inspect | `inspector`, one per file                                             | one verdict per applicable rule                                                 |
| verify  | `defect-verifier` per red test, `defect-skeptic` per confirmed defect | rules on every red test                                                         |
| mutate  | code, then `survivor-analyst` and `equivalence-hunter` per file       | full depth only: mutants on the changed lines, `bail: false`                    |
| prune   | code, then the test authors                                           | full depth only: tests with no unique kill are deleted or exempted              |
| close   | code                                                                  | resolves open escalations through the lead, records the exit                    |

After every stage, `gates_evaluate` is the only source of truth. Code routes each work item to the
file that owns it; the lead answers what code cannot; only the user signs waivers and equivalences.

`quick` depth skips mutate and prune, and records D5 and D6 as skipped, not measured.

## The one hard rule

The test step refuses to start without an accepted codex for the scope. With no accepted rule for
`backend` or `frontend`, it opens no run and writes no test, and it says to run `/purco rules`
first. In a ticket run, the engine then falls back to its plain `tester` worker for that step.

## The rules session

`/purco rules` learns rules from the existing test corpus, then grills the user until each rule is
enforceable, fixtured and frozen into the codex. It writes no test and runs no test. Its agent
briefs are in `resources/rules-session/`: the corpus surveyor, the pattern mapper, the history
checker, the rule writer and the rule examiner.

## Layout

```
packages/
  contracts/      shared types, one module per tool family
  mcp/            test-forge-mcp-server, entry src/server.ts
    src/mcp/            the tool catalogue
    src/application/    one file per tool; the engine imports these directly
    src/domain/         pure functions: gates, predicates, mutation operators, AST facts
    src/infrastructure/ SQLite, the filesystem, git, child processes
resources/
  doctrine/       rule.schema.json, taxonomy.seed.json, mechanization.md
  rules-session/  the five rules-session briefs
data/             forge.db and the session logs; not in git
codex-exports/    portable codex payloads
```

## Install

Node 22.20 or later. The packages run as `.ts` through Node's type stripping; there is no build
step. One `npm install` at the monorepo root covers this package.

Register the MCP server once per Claude profile. The engine starts its own copy for its workers;
the registration is for the rules session:

```bash
claude mcp add --scope user test-forge -- node /Users/franciscohernandez/projects/purco-projects/purco-orchestrator/packages/test-forge/packages/mcp/src/server.ts
```

Every tool takes `cwd`, an absolute path inside the target repository. The project key comes from
that repository's normalised git remote, so every worktree of one repository shares one codex.

Mutation campaigns start containers: Docker Desktop must run, and its `bin` directory
(`/Applications/Docker.app/Contents/Resources/bin` on macOS) must be on the `PATH`. Run one
campaign at a time. Restart the Claude Code session after a pull, because a running server keeps the
code it loaded.

The PurCo rules import at their real severities (23 blocking, 3 advisory) with
`markAdvisory: false`. When you import someone else's doctrine, omit the flag so the rules arrive
advisory until you have read them.

## The codex is append-only

A rule is never updated in place. `codex_rule_write` appends a new version row, and the accepted
version is the newest one that carries a human signature through `codex_accept_rule`.
`codex_revert` writes an older version back as a new one.
