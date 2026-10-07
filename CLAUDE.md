# purco-orchestrator

## No tests

**Never write tests in this repository.** Do not add, extend or edit test files or test checks: no
new `*-test.ts`, `*.test.ts` or `*.spec.ts` files, no new `check(...)` entries in the existing
scripts (`packages/engine/src/engine-test.ts`, `hub-test.ts`, `expand-test.ts`, `pg-test.ts`), no
test setup for the dashboard. This applies to the main session and to every subagent; put it in
every agent prompt that touches this repository.

- The existing test files stay as they are. Running them is allowed; changing them is not.
- Verify a change with `npm run check` and `npm run build -w purco-dashboard`.
- If a change breaks an existing test file, stop and ask the user. Do not fix, extend or delete the
  test to make it pass.
- The hook `.claude/hooks/no-tests.sh` enforces this for Write, Edit, MultiEdit, NotebookEdit and
  Bash writes into test files. It is registered in `.claude/settings.json` and in the user settings,
  so it also applies to sessions that start in another folder.

This rule is about the orchestrator's own code. The Test Forge feature still writes tests in the
target repository (purco-web) during a ticket run; that is product behaviour, not this rule.
