# Runbook — {{TICKET}}: {{TITLE}}

Every step in order. Each phase hands off through a file, so no session needs
the previous one in memory.

Through `/purco {{TICKET}}` the engine runs every step in its own fresh session,
so isolation is automatic and no `/clear` is needed. The rule below is for the
in-session lane only.

**In the in-session lane, run `test`, `verify` and `review` in a fresh session.** `/clear` first, then
paste. The agent that wrote the code must not judge it. Phases are serial —
never two at once in this worktree.

Pack: `general-access-files/{{TICKET}}/`
Worktree: `{{WORKTREE}}`
Branch: `{{BRANCH}}` → base `{{BASE}}`

Where this ticket stands:

```
/Users/franciscohernandez/projects/purco-projects/purco-orchestrator/packages/engine/bin/ticket-state.sh probe {{TICKET}}
```

| Phase   | Produces                                         | State |
| ------- | ------------------------------------------------ | ----- |
| intake  | `01-ticket-and-context.md`                       | todo  |
| plan    | `02-plan.md`, `03-decisions.md`, `04-brief-*.md` | todo  |
| build   | the code                                         | todo  |
| test    | `05-test-notes.md`, green suite both flag states | todo  |
| verify  | `06-verification.md`                             | todo  |
| static  | clean `yarn static`                              | todo  |
| review  | `07-review-findings.md`                          | todo  |
| ship    | one commit, draft PR                             | todo  |
| respond | comments answered, CI green                      | todo  |

---

## intake

```
Read the ticket and its whole Linear project, then read every file in
general-access-files/{{TICKET}}/ and the open PRs for this feature. Also check
what this worktree already has in it. Do not write anything yet and do not
plan. When you are done, tell me in under 20 lines: what is being asked, what
the code does today, the decisions that block the rest, and any contradiction
you found between the ticket, the design and the code. Then ask me your
questions.
```

## plan

```
Read general-access-files/{{TICKET}}/01-ticket-and-context.md and write the
plan to 02-plan.md — approach, files, slices, feature flag, test surface, and
what is out of scope. Grill me on anything genuinely contested instead of
picking for me, and record what we settle in 03-decisions.md. Then split it
into one brief per slice. Do not write any code until I say yes.
```

## build

One brief per session.

```
Read general-access-files/{{TICKET}}/04-brief-<slice>.md and implement it.
Stay strictly inside its scope. Ask before committing.
```

## test

Fresh session. You did not write this code.

```
/purco test "<explicit file scope, comma separated>"
```

Then, when a flag gates the change:

```
Run the usecase tests for this scope twice — flag ON and flag OFF. Report
every failure with its assertion diff. Record the scope and the flag matrix in
general-access-files/{{TICKET}}/05-test-notes.md.
```

## verify

Fresh session. Judge the brief, not the implementation.

```
Use the live app with Playwright — not test files. Log in as <role>, walk
<flow>, and tell me what you see. I have a server running already; confirm
which one before you start. Record the evidence in
general-access-files/{{TICKET}}/06-verification.md.
```

## static

```
yarn static
```

## review

Fresh session.

```
/purco-review
```

Out-of-scope findings become a ticket, collected in `07-review-findings.md`.

## ship

```
Ready to commit and push. One commit, rebased onto {{BASE}}, then a draft PR
against {{BASE}}. No Summary section in the description.
```

## respond

```
/pr-comments-address
```

Verify each finding against the code before agreeing with it, apply the fixes,
then ask before committing.

---

## Open questions

_(carry unresolved decisions here so the next session sees them first)_

## Decisions log

_(one line each: what was settled, when)_
