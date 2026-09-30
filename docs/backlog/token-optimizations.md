# Backlog: token and cost optimizations

Source: the PURCO-3446 run on 2026-09-30. Evidence is in `general-access-files/PURCO-3446/` (`00-RUNBOOK.md`, `orchestrator-runs/`, `scratch/`).

## Cost seen on PURCO-3446

| Work | Cost |
| --- | --- |
| Intake, grill, plan | $4.57 |
| Five build slices | $9.16 |
| Plain tester | $5.62 |
| Test Forge run 33: 2 plans, no tests | $3.25 |
| Test Forge run 34: plan, 4 authors, 4 Inspectors, RLS fixes, suite, waivers (no mutation) | $47.06 |
| Build 6: seed module | $4.78 |
| Review | $2.87 |

Test Forge run 34 attempt 1 alone cost $20.87. Almost all of it was cache reads: each Opus author re-sent the brief, the rules, a large test file and every earlier suite output on each turn (10 M+ cache tokens per author).

## A. Stop paid work that produces nothing

1. **Test surface is not found.** `testSurface()` in `packages/engine/src/forge.ts` does not read the `## Test surface` section of `02-plan.md`, so Test Forge asked for the focus on every attempt (3 times on PURCO-3446, also on PURCO-3445). Fix the parser.
2. **No codex check before the plan.** Run 33 planned a backend run twice, then learned that no frontend codex exists. Check that a codex exists for the scope before any plan, and fail at once when none exists.
3. **`forge-run.json` ignores the scope.** `storedRunId()` in `forge.ts` reuses the stored run id whatever `--scope` is, so `--resume --scope frontend` reopened the backend run 33. Store the run id per scope, or add a `--fresh` flag.
4. **Bookkeeping before `gates_evaluate`.** In run 34 attempt 1 the authors wrote the tests, but the commander did not record the focus, matrix and radius mapping before `gates_evaluate`, so the vector did not move and the attempt ended STALLED. The commander must record the mapping from the author manifests before each `gates_evaluate`, and must not call it twice with no work in between.
5. **Repeated questions.** E004, E005 and E006 asked the same seed-module question. Do not ask again about an escalation that has an answer.

## B. Make each agent cheaper

6. **Authors re-run the whole database suite.** Authors run only their own file, with a `-t` filter, and keep only failures in context.
7. **Three layers write tests.** Builders, the plain tester and then Test Forge authors (who reworked the tester's files). When Test Forge will run, skip the plain tester; builders write tests from the plan's Test surface.
8. **Opus everywhere.** Use Sonnet for mechanical edits and clerk posts (recording, Range Officer, Registrar). Keep Opus for authors of complex files and for judgment.
9. **One Inspector per rule is the default.** Make one Inspector per file, judging each rule separately and posting verdicts in one batch, the engine default. Today it needs a signed override.
10. **Large test files.** A 3,141-line test file is re-read on every turn. Seed-module moves shrink the files; prefer them when a file passes about 1,500 lines.

## C. Remove escalations the hub has to handle

11. **Workers cannot run EXPLAIN.** Give workers the read-only postgres MCP, with `set_config('app.current_user_role','SUPER_ADMIN',false)` first, because `view_bucket_report_live` returns 0 rows without it.
12. **The verifier cannot log in.** Give the verifier the maildev OTP login script (`general-access-files/PURCO-3445/scratch/explore-dashboard.mjs`, `sessionCookie()`), and tell it to use `yarn dev:nomail` when maildev already runs in Docker.
13. **The lead does not see hub decisions.** The lead said the EXPLAIN was not done and the waivers were unsigned when both were done. The lead reads the decisions log in `00-RUNBOOK.md` before each answer.
14. **Test Forge cannot run git.** It cannot find the changed lines for mutation. The engine computes `git diff -U0` line ranges for the target files and passes them to the mutation phase.
15. **The launch dies at the 2-hour Bash limit.** Launch the engine detached (`nohup ... & disown`) by default, and document it in `skill/references/hub.md`.
16. **Codex rules with truncated text or drifted fixtures** caused three escalations on PURCO-3446 (seed-module, denial, timezone). Repair them in one rules session (see follow-up 2 below).

## Also seen

- `--budget` counts every earlier phase of the same run id, so a resume needs the old spend plus the new allowance. Show the spent amount at launch.
- 100 idle `crystaldba/postgres-mcp` containers held 6.1 GB of 8.2 GB Docker memory and killed LocalStack (exit 137), so 0 tests ran. Check Docker memory before a suite or mutation run.
- An answer that starts with "approve" drops the notes after it. A progress note from Test Forge arrived as a plan gate.

## Follow-ups

### 1. Frontend rules session

There is no accepted frontend codex, so Test Forge refuses every frontend run. PURCO-3446 wanted a frontend Test Forge run for the chip and tooltip changes (UI-1 to UI-4) and could not have one. Run `/purco rules --scope frontend` with the user to write and accept the first frontend rules, then a frontend Test Forge run becomes possible.

### 2. Codex fixes for three rules

- `backend-authorization-denied-actor-proven`: the mechanical check accepts only four error-based forms. Code that filters a widget out (no throw) is proven by `toStrictEqual({ mutations: [], returned: {} })`. Accept that form. The user ruled this on PURCO-3446 run 34 (escalations 35 and 36).
- `backend-date-boundary-timezone-both-sides-pinned`: the check sees only literal times in `anchorDenverClock(...)` calls, not a table fed through `it.for`. Accept table rows. Ruled on escalation 34.
- `backend-data-setup-read-path-seed-module`: the rule text reached the Inspectors truncated, and 5 of its 8 fixtures have drifted. Repair the text and the fixtures. Also say that Test Forge's write hook refuses `prisma/seeds/`, so a seed move is a builder step, not an author step.
