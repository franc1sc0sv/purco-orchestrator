# Guardrails

Every rule here comes from a correction that was actually given during ticket
work. They are ordered by how often they bite.

## Git and the index

- **Never stage or unstage anything.** The index belongs to the user. When a
  commit hook reformats files, say so and let the user re-stage.
- **Verify git facts with `git` in Bash.** A sandbox or an indexed snapshot can
  report a stale HEAD.
- One commit per PR, rebased and squashed. PRs merge by rebase, never a merge
  commit. Squash unless the user says not to.
- Rebase onto the base the probe reports. For a stacked ticket that is the
  parent feature branch, not `dev`. Sometimes it is a release branch.
- In a worktree, use `git -C <path>`, not `cd && git`.
- After a rebase, run the **sibling feature's** tests too. A clean textual
  rebase can still be a semantic conflict.
- Never commit or push without asking.

## Feature flags

- Key flags with `FEATURE_FLAGS` from `src/types/feature-flags.ts`. One
  `useFlags` hook per flag.
- **The flag-off path keeps the original behavior exactly.** Keeping the old
  path alive is why the flag exists.
- Reuse the existing flag when the ticket says so. Do not invent a second flag
  for one feature.
- Test both states. `createMockContext` defaults every flag to true, so pin
  the production config in a flag test.

## Tests

- Integration tests at the usecase level. No mocks, real event bus, real rows.
  No query-level unit tests.
- Expected values are hand-computed from factory data — never derived from the
  result, never transcribed from a run.
- One `toEqual` on the whole object. The full ordered recorder array, not a
  subset.
- Test data comes from factories. Never inline `prisma.create`.
- Soft-delete a claim through `DeleteClaimUseCase`
  (`src/server/api/modules/claims-management/usecases/claims/main/delete-claim.usecase.ts`),
  never raw SQL.
- `beforeAll` seeding that fails silently skips tests, and skipped tests read
  as green. Check the count.
- Counting tests means expanding `it.for` tables — count in Bash, not by eye.
- Verification is the live app. Test files are not verification.

## Data access

- Prisma is for writes and single-table reads by key.
- Anything with nested relations, a relation filter, aggregation, or on a
  page-load path is hand-written Kysely with correlated `EXISTS`. A relation
  filter compiles to an uncorrelated `IN (SELECT ...)` that reads the whole
  table — this took production down once.
- Index the correlated columns and verify with `EXPLAIN`, not query count.
- Cast enums in a Kysely `where()` or the result comes back empty.

## Code

- No comments. If the code needs one, make the code clearer instead.
- No barrel files. No `any`, no `as unknown`. `error`, not `e` or `err`.
- No dynamic `await import(...)`.
- Surgical changes only: no adjacent improvement, no refactor of working code,
  and remove only the imports your own change orphaned.
- New UI is shadcn. Mantine V5 is being migrated away from.
- `throwAppError` is backend-only. Internal routers carry no `.output()`.
- Never add a per-file lint override to silence a rule — fix the code.
- Tenant checks go through `isPurCo()` / `isSDI()`; roles through the
  utilities in `validate-is-role.ts`. Never compare role strings.

## Files and artifacts

- Plans, reports, briefs, mockups and notes go in
  `general-access-files/PURCO-XXXX/`. agent-os specs go in `agent-os/`.
  Never a repo root, never `src/` or `tests/`.
- Never read the contents of `.env*`, keys, or anything under `secrets/`.
  Checking that a file exists or reading a key's name is fine; reading the
  value is not. If a task appears to need one, stop and ask.

## Worktrees

- One ticket per worktree. A worktree never touches another ticket's files,
  even for a related ticket.
- Two worktrees must not share `node_modules` — installing in one breaks the
  other's binaries.
- `/wt` owns create, setup and cleanup. Do not run the setup steps yourself.

## Reviews

- Trace the full data flow before flagging HIGH or CRITICAL.
- A deferred concern is LOW; keep LOWs to a few.
- Check RLS global policies in `internal-user-policies.sql` before claiming a
  policy gap. Org isolation is RLS, not app code, and `billing_accounts` is
  RLS-exempt by design.
- Read the stacked PRs before calling something missing.
- On a stale spec, a deviation is still a true positive — the fix may be the
  spec.
- Do not take another agent's finding at face value; verify it.

## Production

- Read-only SQL against production. No exceptions.
- Missing environment variables kill the boot — an env-var gate has caused an
  outage here.

## Reporting

- Report in ASD-STE100 Simplified Technical English.
- No icons, no emojis. Plain text labels.
- No Summary section in a PR description.
- Say plainly when a test fails, a step was skipped, or a finding does not
  hold.
