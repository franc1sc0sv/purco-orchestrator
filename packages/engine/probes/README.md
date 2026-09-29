# Probes

A probe is the reusable part of a flag-removal spike. It is data, not code. One
JSON file per investigation, and the census, the clusters and the four axes all
come out of it.

```bash
node bin/purco-census.js --probe probes/involved-party.json \
  --repo ../purco-web@PURCO-3252 \
  --db ../general-access-files/PURCO-3252/orchestrator.sqlite \
  --run census-1
```

## The four axes

They are generic. Any migration from an old concept to a new one, behind a flag,
has the same four shapes:

| Axis | Meaning                                                      |
| ---- | ------------------------------------------------------------ |
| A    | the file carries the flag — both branches need a decision    |
| B    | the file reaches the old concept through an indirection      |
| C    | old concept, no new concept, **no flag** — the untracked set |
| D    | the file creates, edits or deletes — rank these first        |

Axis C is the one that matters. A flag sweep only finds the places somebody
remembered. Axis C is the set difference that finds the rest.

## Fields

| Field            | Required | Meaning                                              |
| ---------------- | -------- | ---------------------------------------------------- |
| `name`           | yes      | short slug, used as the probe name in reports        |
| `flag`           | yes      | regex for the flag, both the constant and the key    |
| `legacy`         | no       | regex for the concept being migrated away from       |
| `target`         | no       | regex for the concept being migrated to              |
| `indirection`    | no       | regex for the adapter that hides the old concept     |
| `writer`         | no       | regex for a mutation; defaults to Prisma plus Kysely |
| `skip`           | no       | regex for paths to ignore; defaults to tests         |
| `scanRoots`      | no       | defaults to `["src"]`                                |
| `extensions`     | no       | defaults to `[".ts", ".tsx"]`                        |
| `extraClusters`  | no       | rules prepended to the shared default set            |
| `clusters`       | no       | rules that **replace** the default set outright      |
| `maxClusterRows` | no       | split threshold, defaults to 25                      |
| `*Label`         | no       | plain words for the report, e.g. "a billing account" |

Omit `legacy` and `target` and you get the simple case: find every place one
flag is used, split into clusters, write paths first. Axes A and D only.

## Why the split threshold exists

An agent handed 80 files analyses the first few deeply and skims the rest. It
will flag a pattern in one file and approve the same pattern in another. So no
cluster is allowed above `maxClusterRows`; oversized ones split by path into
`<cluster>-1`, `<cluster>-2`. Each agent then gets its whole attention budget for
a list it can actually hold.

## Adding a probe

Copy `flag-only.template.json`, set `flag`, and run the census. Check the cluster
table it prints: if `unclustered` has rows, add `extraClusters` rules until it is
empty. Nothing else needs to change — no code, no prompts.
