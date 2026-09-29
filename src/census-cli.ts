import path from "node:path";
import { runCensus } from "./census.ts";
import { loadProbe } from "./probe.ts";
import { Store } from "./store.ts";

type Args = {
  probe: string;
  repo: string;
  db: string;
  run: string;
  dryRun: boolean;
};

const usage = `usage: purco-census --probe <file> --repo <dir> [--db <file>] [--run <id>] [--dry-run]

  --probe    probe JSON, see probes/README.md
  --repo     repository root to scan
  --db       sqlite file to write; omit with --dry-run
  --run      run id, defaults to census-<timestamp>
  --dry-run  print the census, write nothing
`;

const parse = (argv: string[]): Args => {
  const args: Record<string, string> = {};
  let dryRun = false;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (token?.startsWith("--")) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${token} needs a value\n\n${usage}`);
      }
      args[token.slice(2)] = value;
      index += 1;
    }
  }
  if (!args.probe || !args.repo) throw new Error(usage);
  if (!args.db && !dryRun)
    throw new Error(`--db is required without --dry-run\n\n${usage}`);
  return {
    probe: path.resolve(args.probe),
    repo: path.resolve(args.repo),
    db: args.db ? path.resolve(args.db) : "",
    run: args.run ?? `census-${Date.now()}`,
    dryRun,
  };
};

const pad = (label: string, value: number | string): string =>
  `${label.padEnd(34)}${String(value).padStart(6)}`;

const main = (): void => {
  const args = parse(process.argv.slice(2));
  const probe = loadProbe(args.probe);
  const result = runCensus(args.repo, probe);
  const { totals, labels } = result;

  const lines = [
    `CENSUS  probe ${result.probe}  repo ${path.basename(args.repo)}`,
    "",
    pad("files scanned", totals.scanned),
    pad("files matched", totals.matched),
    pad(`carry ${labels.flag}`, totals.flagged),
    pad("create, edit or delete", totals.writers),
  ];

  if (totals.legacy > 0 || totals.target > 0) {
    lines.push(
      "",
      pad(`touch ${labels.legacy}`, totals.legacy),
      pad(`touch ${labels.target}`, totals.target),
      pad("both concepts", totals.dual),
      pad("legacy only", totals.legacyOnly),
      pad("legacy only, no flag", totals.untracked),
      pad("target only", totals.targetOnly),
    );
  }

  const byAxis = new Map<string, number>();
  const byCluster = new Map<string, { rows: number; writers: number }>();
  for (const site of result.sites) {
    const axisKey = `${site.axis}:${site.state ?? "untriaged"}`;
    byAxis.set(axisKey, (byAxis.get(axisKey) ?? 0) + 1);
    const key = site.cluster ?? "unclustered";
    const entry = byCluster.get(key) ?? { rows: 0, writers: 0 };
    entry.rows += 1;
    if (site.isWriter) entry.writers += 1;
    byCluster.set(key, entry);
  }

  lines.push("", pad("site rows", result.sites.length), "");
  for (const [key, n] of [...byAxis].sort()) lines.push(pad(key, n));

  const oversized = [...byCluster].filter(
    ([, entry]) => entry.rows > probe.maxClusterRows,
  );
  const unclustered = byCluster.get("unclustered")?.rows ?? 0;

  lines.push(
    "",
    `CLUSTERS  ${byCluster.size} total, limit ${probe.maxClusterRows}`,
    "",
  );
  for (const [cluster, entry] of [...byCluster].sort(
    (a, b) => b[1].writers - a[1].writers || b[1].rows - a[1].rows,
  )) {
    lines.push(
      `${cluster.padEnd(32)}${String(entry.rows).padStart(5)} rows ${String(entry.writers).padStart(4)} writers`,
    );
  }

  lines.push("");
  lines.push(
    unclustered === 0
      ? "OK    every row has a cluster"
      : `WARN  ${unclustered} rows are unclustered; add extraClusters rules to the probe`,
  );
  lines.push(
    oversized.length === 0
      ? `OK    no cluster is above ${probe.maxClusterRows} rows`
      : `WARN  oversized clusters: ${oversized.map(([c]) => c).join(", ")}`,
  );

  if (!args.dryRun) {
    const store = new Store(args.db, args.run);
    store.startRun(probe.ticket ?? result.probe);
    store.addSites(result.sites);
    const work = store.clustersWithWork();
    store.close();
    lines.push(
      "",
      `WROTE ${result.sites.length} rows to ${args.db} as run ${args.run}`,
      `      ${work.length} clusters need a surveyor`,
    );
  }

  process.stdout.write(`${lines.join("\n")}\n`);
};

main();
