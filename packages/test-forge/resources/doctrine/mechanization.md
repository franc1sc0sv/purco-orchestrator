# Mechanization guide

CPO Mendez follows this guide when drafting a rule. Nothing here is advice. A rule that fails any
gate in this document does not enter the codex.

A rule is a **detection procedure**, not a sentence. "Tests should be isolated" is a slogan. A rule
tells an inspector exactly where to look, exactly what to look at, and exactly which of three
verdicts to return. If two competent people can read the rule and the file and disagree, the rule is
not finished.

---

## 1. The decidability test

Before anything else, ask:

> Given this rule text and this file, and nothing else, could two competent reviewers reach
> different verdicts?

If the answer is yes, the rule is not ready. Send it back down the ladder in section 2, or grill
Captain Lasky until the ambiguity is named and closed.

Three things make a rule undecidable. Each has a fix.

**Undefined predicate.** "The test must not be over-mocked." Nobody can bound "over". Fix: name the
seam. "No module in `src/server/**` may be replaced by a test double. Doubles are allowed only for
modules that cross a process boundary, listed in `externals.json`."

**Hidden scope.** "Tests must pin the tenant." Which tests? All of them, or only the ones that read
tenant-dependent code? Fix: `appliesWhen` becomes its own decidable sentence, and it is evaluated
first. A file that fails `appliesWhen` returns `not-applicable` and is never scored.

**Implicit exception.** "Never filter by date." True until the code under test _is_ a date filter.
An exception that lives only in the drafter's head produces a rule that flags the same file every
run and gets ignored by the third run. Fix: the exception becomes a near-miss fixture (section 5)
and a branch of `appliesWhen` or `violates`.

The output of this test is binary. There is no "mostly decidable".

---

## 2. The mechanization ladder

Every rule sits at one of three tiers. Tier 3 is where drafting starts. Tier 3 is never shipped.

| Tier | Name                | What the inspector is given                      | Ships?                              |
| ---- | ------------------- | ------------------------------------------------ | ----------------------------------- |
| 3    | Free judgment       | A sentence and its own taste                     | Never                               |
| 2    | Structured judgment | A fixed rubric of 3-5 closed questions           | Yes, marked `judgment` or `partial` |
| 1    | Mechanical          | An AST or structural query run by Roland in code | Yes, marked `full`                  |

The worked example below is the same rule at all three tiers. The rule comes from the `isolation`
aspect: a test must carve out its own data by a dedicated owning entity, not by a time window.

### Tier 3 — free judgment (draft only, never shipped)

```
statement: Tests should isolate their data properly and not rely on date windows.
```

Why this fails: "properly" is undefined; two reviewers reading the same file will split on whether a
`createdAt` bound counts as isolation or as an ordinary filter; the rule cannot say what to do with
a test of a date filter. Verdicts from a tier-3 rule are unreproducible, so they cannot be diffed
across runs, cannot be regression-tested, and cannot be audited by ONI Section Zero.

Tier 3 exists for exactly one purpose: it is what the human says out loud in the first minute of the
doctrine session. It is raw material.

### Tier 2 — structured judgment

The sentence is replaced by a fixed rubric. Three to five questions. Every question has a closed
answer set. The inspector answers the questions; the **verdict is computed from the answers**, not
chosen by the inspector.

```json
{
  "id": "backend.isolation.dedicated-owner",
  "aspect": "isolation",
  "scope": "backend",
  "severity": "high",
  "statement": "A test selects its data through an owning entity created by that test, never through a time window.",
  "mechanization": "partial",
  "verdictSpace": ["pass", "violation", "not-applicable"],
  "appliesWhen": {
    "human": "The test reads back persisted rows through a query it controls: a list, search, report, or export call that takes filter arguments.",
    "check": "file calls a use case whose input object contains at least one filter-shaped key"
  },
  "rubric": [
    {
      "q": "Does the test create an owning entity (client, organisation, account) inside its own setup?",
      "answers": ["yes", "no"]
    },
    {
      "q": "Is that entity's identifier passed to the query under test as a filter?",
      "answers": ["yes", "no", "no-such-entity"]
    },
    {
      "q": "Does the query under test receive a date, timestamp, or period bound?",
      "answers": [
        "no",
        "yes-as-the-only-narrowing-filter",
        "yes-alongside-the-owner-filter"
      ]
    },
    {
      "q": "Is a date bound the behaviour being asserted, per the test title and the assertions?",
      "answers": ["yes", "no"]
    }
  ],
  "violates": {
    "human": "Violation when the only thing separating this test's rows from other tests' rows is a time bound.",
    "check": "q1=no OR q2!=yes OR (q3=yes-as-the-only-narrowing-filter AND q4=no)"
  }
}
```

This is shippable. Two reviewers can still disagree on a single rubric answer, but the disagreement
is now **localised and nameable**: they disagree on question 3, on this file, and that is a
one-sentence question for Captain Lasky rather than an argument about philosophy.

### Tier 1 — mechanical

The rubric collapses into a structural query that Roland runs in code. No model is consulted.

```json
{
  "id": "backend.isolation.dedicated-owner",
  "mechanization": "full",
  "appliesWhen": {
    "human": "The test calls a use case whose input carries filter keys.",
    "check": {
      "kind": "ast",
      "query": "CallExpression[callee.property.name='execute'] > ObjectExpression",
      "requireAnyKey": ["where", "filters", "filter", "params", "input"]
    }
  },
  "detect": {
    "human": "Collect the keys of the filter object passed to the use case, and the identifiers bound in the file's setup.",
    "check": {
      "kind": "ast",
      "collect": {
        "filterKeys": "keys of the ObjectExpression matched by appliesWhen.check",
        "setupBindings": "identifiers assigned from any call matching /Factory|factory|create[A-Z]/ above the first assertion"
      }
    }
  },
  "violates": {
    "human": "No filter key resolves to an identifier created in this file's setup, and at least one filter key is date-shaped.",
    "check": {
      "kind": "predicate",
      "expression": "filterKeys.every(k => !setupBindings.includes(resolve(k))) && filterKeys.some(k => /date|At$|from|to|period|since|until/i.test(k))"
    }
  }
}
```

Tier 1 is worth the effort because a mechanical check is free to run, identical on every run, and
diffable. Roland can run it across ten thousand files in a second, which is what makes the
disagreement set in section 6 possible at all.

Not every rule reaches tier 1, and forcing one that cannot is worse than leaving it at tier 2. A
rule reaches tier 1 only when the violating shape is visible in the syntax. "The expected value must
be hand-computed rather than derived from the result" is not visible in the syntax in general — but
its most common instance, _the expected value references the variable holding the result_, is. Ship
the tier-1 check for the instance and mark `mechanization: "partial"`, with the rubric carrying the
rest.

---

## 3. The question that pushes a rule down the ladder

One question moves a rule from tier 3 to tier 2, and from tier 2 to tier 1:

> **What would you search for to find a violation without reading the file?**

Ask it of the human, out loud, and write down the literal answer. The answer is almost always a
grep, and a grep is one step from an AST query.

| Slogan (tier 3)               | Answer to the question                                                        | Becomes (tier 1 or 2)                                               |
| ----------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| "Don't mock internals"        | `grep "vi.mock("                                                              | grep -v node_modules`                                               | Every `vi.mock` argument must resolve to a module in `externals.json`. |
| "Don't use raw SQL for setup" | `grep "prisma\.\w*\.create("` in test files                                   | Direct client writes are a violation outside `tests/factories/**`.  |
| "Pin the flags"               | list flags read by the code under test, list flags set in the file, diff them | Violation when the read set is not a subset of the set-in-file set. |
| "No arbitrary waits"          | `grep -E "setTimeout                                                          | sleep\(                                                             | waitFor\(\s*\(\)\s*=>\s*\{\s*\}"`                                      | Any timer-based wait is a violation; `waitFor` with an assertion body is a pass. |
| "Assert whole objects"        | count `expect(x.` chains against the same subject in one test                 | More than N field-level assertions on one subject is a violation.   |

If the human cannot answer the question at all — if the only answer is "I would read it and I would
know" — the rule stays at tier 2 with a rubric, and the rubric questions are extracted by asking
"what are you looking at while you read it?" until three to five closed questions exist.

If the human's answer is a search that returns half the corpus, the rule is too broad. Narrow
`appliesWhen`, not the search.

---

## 4. Rule fields and where each one comes from

| Field           | Source                                                                | Gate                                       |
| --------------- | --------------------------------------------------------------------- | ------------------------------------------ |
| `statement`     | The human's own words, tightened                                      | Decidability test                          |
| `rationale`     | Why the failure hurts, in consequence terms                           | Must name a real cost                      |
| `archaeology`   | The commits, incidents, or review comments that produced the practice | At least one citation or `none-found`      |
| `appliesWhen`   | Human sentence plus check                                             | Evaluated first, always                    |
| `detect`        | What to collect from the file                                         | Must be collection only, no verdict        |
| `violates`      | The predicate over what `detect` collected                            | Must be total over the collected values    |
| `rubric`        | Tier-2 questions, closed answers                                      | 3-5 entries, never open text               |
| `verdictSpace`  | Fixed: pass, violation, not-applicable                                | Never extended                             |
| `mechanization` | full / partial / judgment                                             | Set by which tier shipped                  |
| `fixtures`      | Real corpus files, including near-misses                              | Section 5                                  |
| `acceptance`    | Fixture and near-miss pass counts, reviewer score, timestamp          | Section 7                                  |
| `evidence`      | Corpus files that follow, that violate, and the corpus size           | Meets the aspect's blocking bar            |
| `decidedBy`     | `human` or `corpus`                                                   | A rule the human overruled records `human` |

`detect` never returns a verdict, and `violates` never reads the file. Keeping the two apart is what
lets Roland cache detection results and re-score a redrafted rule without re-reading anything.

---

## 5. Near-miss fixtures

A rule with one obvious good example and one obvious bad example is not tested. It is illustrated.
Both examples are far from the boundary, so passing them proves only that the rule is not
catastrophically inverted.

The fixture set must contain **near-misses**: files that sit one step on either side of the line and
that a careless rule gets wrong.

### The worked case

The rule: _isolate by a dedicated client, never by a date window._

The obvious violation:

```ts
const result = await listClaims.execute({
  filters: { dateReceivedFrom: startOfMonth, dateReceivedTo: endOfMonth },
});
expect(result.items).toHaveLength(3);
```

Three rows this month. Also every row any other test seeded this month. Flake.

The near-miss, which must **pass**:

```ts
const client = await clientFactory.create();
await claimFactory.create({
  clientId: client.id,
  dateReceived: new Date("2026-01-10"),
});
await claimFactory.create({
  clientId: client.id,
  dateReceived: new Date("2026-02-10"),
});

const result = await listClaims.execute({
  filters: {
    clientId: client.id,
    dateReceivedFrom: FEB_1,
    dateReceivedTo: FEB_28,
  },
});

expect(result.items.map((claim) => claim.dateReceived)).toEqual([
  new Date("2026-02-10"),
]);
```

This test filters by date. It filters by date **because the date filter is the behaviour under
test**. The dedicated client is still doing the isolating; the date bound is the assertion subject.
A rule that greps for `dateReceivedFrom` flags this file on every run, forever, and the human
learns to skim the report.

That is the whole argument for near-misses. A rule is not measured by whether it catches the bad
file. It is measured by whether it leaves the good file alone.

### What the fixture set must contain

- At least one clear follower and one clear violator.
- At least two near-misses, and at least one of them must be a **pass** — a file that carries the
  violation's surface marks for a legitimate reason.
- At least one `not-applicable` file, so the `appliesWhen` branch is exercised.
- Every fixture is a real path in the corpus, at a pinned revision. Invented fixtures prove the rule
  against the drafter's imagination, which is the thing being audited.

---

## 6. The disagreement set

This is how near-misses are found, rather than guessed.

The sweep has already clustered every corpus file and assigned each one a label for the aspect —
follows, violates, or out of scope. That label came from reading. The draft rule's `check` came from
the ladder. Run the check over **every file in the corpus** and compare.

```
                     check says PASS      check says VIOLATION
sweep says follows        agree              DISAGREEMENT
sweep says violates    DISAGREEMENT             agree
```

The agreement cells are not interesting. The two disagreement cells are the entire product of this
step.

- **check pass, sweep violates** — the check is blind. Something the reader could see is not in the
  syntax. Either widen `detect`, or accept that the rule is tier 2 and put the missing signal in the
  rubric.
- **check violation, sweep follows** — the check is over-broad. These are the near-misses. This is
  the cell that produced the date-filter case in section 5.

Then:

1. Every file in a disagreement cell becomes a **fixture**, with the sweep's label as expected.
2. Every distinct _reason_ behind a disagreement becomes an item on the **grilling agenda** for
   Captain Lasky. Not every file — the reason. Fourteen files that all filter by date because they
   test date filters are one agenda item.
3. The agenda item is a closed question with the options spelled out, never "what do you think about
   this?" For example: _"Fourteen tests filter by date and pass a dedicated client as well. Is the
   rule (a) date filters allowed whenever an owner filter is also present, or (b) allowed only when
   the test title names the date behaviour?"_

Target: fewer than five percent of applicable files in disagreement after redrafting. A rule that
cannot get under that ceiling is either two rules wearing one name — split it — or genuinely tier 2.

---

## 7. Acceptance: fix the rule, never the labels

Deja Examiner runs the acceptance gate. The rule passes only when:

- every fixture returns its expected verdict,
- **every near-miss returns its expected verdict**, counted separately from ordinary fixtures,
- the reviewer score meets the aspect's blocking bar from `taxonomy.seed.json`,
- the evidence set meets that same bar.

When the gate misses, there are two ways to make the number green. Only one is allowed.

**Allowed: fix the rule.** Narrow `appliesWhen`. Add a branch to `violates`. Add a rubric question.
Split the rule in two. Demote it from tier 1 to tier 2. Drop it entirely and record why.

**Forbidden: fix the labels.** Editing the sweep's label so the check agrees with itself, deleting
the inconvenient fixture, or relabelling a near-miss as out of scope. That turns the acceptance
gate into a tautology: a check that agrees with a label that was written to agree with the check.
The gate then reports green forever and detects nothing, and every downstream predicate — D2, D7,
D9 — inherits the lie.

The one exception, and it is narrow: a sweep label may be corrected when the human inspects that
specific file and states the original label was a **reading error** — the reader misread the code,
not the rule. That correction is recorded on the rule's version row with the human as `decidedBy`
and the file path attached. It is a signed act, not an edit.

Because the codex is append-only, a redraft is a new version row, never an in-place change. The
failed draft stays. Its disagreement set stays. When the same rule is proposed again in six months,
the record shows it was already tried and what it cost.

A rule that cannot pass the gate after three redrafts is not accepted. The aspect ships one rule
lighter. That is a correct outcome, and for a near-total aspect it is the expected one.
