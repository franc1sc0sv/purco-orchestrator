# The spike workflow

A feature-flag removal spike: the census finds every site, surveyors judge one cluster each, the
checker re-derives every finding, and the synthesist writes the report. The spike ships no code.

## Paths

Add these to the paths in `SKILL.md`:

```bash
WT=/Users/franciscohernandez/projects/purco-projects/purco-web@$TICKET
PROBE=$ENGINE/probes/<name>.json      # --probe wins; else the ticket's probe
RUN=spike-$(date +%Y%m%d-%H%M%S)      # one id for sites, questions and steps
```

On a resume, reuse the last run id from the store (the query in `references/hub.md`, move 1), or
the census rows and the questions land under different keys. If `$WT` does not exist, tell the
user to run `/wt $TICKET` first.

## verify

Run `$GAF/RUNBOOK.md` steps 0 through 8, including 3b, 3c and 3d. Report one table: step, command,
expected, actual, pass or fail. Stop at the first failure and say which step. `node -v` must be
22.20.0 or newer, because the store uses `node:sqlite`. Step 3d prints the real step plan from the
store: one survey step per cluster with work, ordered by writer density, then audit, then
synthesize.

## census

```bash
node $ENGINE/bin/purco-census.js --probe $PROBE --repo $WT --dry-run
```

If either self-check line says `WARN`, do not write to the store: report it and ask whether to add
`extraClusters` rules to the probe. An oversized cluster brings back the attention dilution the
caps exist to prevent. When both say `OK`:

```bash
node $ENGINE/bin/purco-census.js --probe $PROBE --repo $WT --db $DB --run $RUN
```

Report the axis table and the cluster count.

## run

The hub loop in `references/hub.md`, with the spike workflow:

```bash
node $ENGINE/bin/purco-orchestrate.js $TICKET \
  --workflow spike \
  --run-id $RUN \
  --mailbox-db $DB \
  --worktree $WT
```

The dashboard is optional and idempotent:

```bash
lsof -ti :4317 >/dev/null 2>&1 && echo "monitor already up" || \
  (nohup node $ENGINE/bin/purco-orchestrate.js monitor --port 4317 \
     > /tmp/orch-monitor.log 2>&1 & sleep 3; echo "monitor started")
```

Probe the port, not the URL: a hook here redirects HTTP fetches from Bash.

## status

```bash
node $ENGINE/bin/purco-spike.js status --db $DB --run $RUN
```

Report sites by axis and state, findings by verdict, open and answered questions, and the next
clusters by writer density. Untriaged sites block `audit`; say how many and in which clusters.

## report

Score the run against ground truth first:

```bash
node $ENGINE/bin/purco-eval.js --db $DB --run $RUN --labels $GAF/eval/labelled-sites.json
```

`missing 0` means the hand labels still match the probe; `unjudged 0` means the survey finished.
A low agreement rate means the survey is not trustworthy; say so plainly.

Then build the HTML from `$ENGINE/templates/spike-report.template.html`, after reading
`$ENGINE/templates/README.md`. Compute the axis rows and the check chips from the store. Publish
with the `Artifact` tool; if `$GAF/ARTIFACT_URL.txt` exists, pass that URL as `url` so the same
page updates, and otherwise write the new URL into that file.

## Rules

- Never mark a site or a finding yourself. Those belong to the workers.
- A large rejected pile is a healthy result: the census pattern is deliberately wide.
