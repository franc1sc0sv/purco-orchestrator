import fs from "node:fs";
import path from "node:path";
import { buildReverseGraph, expandImporters } from "./import-graph.ts";
import type { CompiledProbe } from "./probe.ts";
import { Store } from "./store.ts";
import type { Site, SiteAxis } from "./types.ts";

const walk = (dir: string, extensions: string[], out: string[]): string[] => {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, extensions, out);
      continue;
    }
    if (!extensions.some((extension) => entry.name.endsWith(extension))) {
      continue;
    }
    out.push(full);
  }
  return out;
};

const countMatches = (pattern: RegExp, contents: string): number => {
  const global = new RegExp(
    pattern.source,
    `${pattern.flags.replace("g", "")}g`,
  );
  return [...contents.matchAll(global)].length;
};

const clusterFor = (relative: string, probe: CompiledProbe): string => {
  for (const [pattern, name] of probe.clusters) {
    if (pattern.test(relative)) return name;
  }
  return "unclustered";
};

const splitOversizedClusters = (sites: Site[], limit: number): void => {
  const grouped = new Map<string, Site[]>();
  for (const site of sites) {
    const key = site.cluster ?? "unclustered";
    const list = grouped.get(key) ?? [];
    list.push(site);
    grouped.set(key, list);
  }
  for (const [cluster, list] of grouped) {
    if (list.length <= limit) continue;
    const ordered = [...list].sort((a, b) => a.path.localeCompare(b.path));
    const parts = Math.ceil(ordered.length / limit);
    const perPart = Math.ceil(ordered.length / parts);
    ordered.forEach((site, index) => {
      site.cluster = `${cluster}-${Math.floor(index / perPart) + 1}`;
    });
  }
};

export type CensusTotals = {
  scanned: number;
  matched: number;
  legacy: number;
  target: number;
  flagged: number;
  flagReaders: number;
  writers: number;
  dual: number;
  legacyOnly: number;
  untracked: number;
  targetOnly: number;
  indirect: number;
};

export type CensusResult = {
  probe: string;
  sites: Site[];
  totals: CensusTotals;
  labels: {
    flag: string;
    legacy: string;
    target: string;
    indirection: string;
  };
};

export const runCensus = (
  repoRoot: string,
  probe: CompiledProbe,
): CensusResult => {
  const files: string[] = [];
  for (const root of probe.scanRoots) {
    walk(path.join(repoRoot, root), probe.extensions, files);
  }

  const sites: Site[] = [];
  const totals: CensusTotals = {
    scanned: 0,
    matched: 0,
    legacy: 0,
    target: 0,
    flagged: 0,
    flagReaders: 0,
    writers: 0,
    dual: 0,
    legacyOnly: 0,
    untracked: 0,
    targetOnly: 0,
    indirect: 0,
  };

  const censused = new Set<string>();
  const flagReaders: string[] = [];
  const scanned: string[] = [];

  for (const full of files) {
    const relative = path.relative(repoRoot, full);
    if (probe.skip.test(relative)) continue;
    totals.scanned += 1;
    scanned.push(full);

    const contents = fs.readFileSync(full, "utf8");
    const hasFlag = probe.flag.test(contents);
    const touchesBa = probe.legacy ? probe.legacy.test(contents) : false;
    const touchesIp = probe.target ? probe.target.test(contents) : false;

    if (hasFlag && probe.flagRead.test(contents)) {
      flagReaders.push(full);
      totals.flagReaders += 1;
    }

    const isTestFile = probe.testPath.test(relative);
    if (isTestFile && !hasFlag) continue;
    if (!hasFlag && !touchesBa && !touchesIp) continue;

    totals.matched += 1;
    censused.add(full);
    const isWriter = probe.writer.test(contents);
    const cluster = clusterFor(relative, probe);

    if (touchesBa) totals.legacy += 1;
    if (touchesIp) totals.target += 1;
    if (hasFlag) totals.flagged += 1;
    if (isWriter) totals.writers += 1;
    if (touchesBa && touchesIp) totals.dual += 1;
    if (touchesBa && !touchesIp) totals.legacyOnly += 1;
    if (touchesBa && !touchesIp && !hasFlag) totals.untracked += 1;
    if (touchesIp && !touchesBa) totals.targetOnly += 1;

    const axes: SiteAxis[] = [];
    if (hasFlag) axes.push("A");
    if (!isTestFile) {
      if (touchesBa && probe.indirection?.test(contents)) axes.push("B");
      if (touchesBa && !touchesIp && !hasFlag) axes.push("C");
      if (isWriter) axes.push("D");
    }

    const state = axes.length === 0 ? "no_change" : "untriaged";
    if (axes.length === 0) axes.push("C");

    const hitsFor = (axis: SiteAxis): number => {
      if (axis === "A") return countMatches(probe.flag, contents);
      if (axis === "B" && probe.indirection) {
        return countMatches(probe.indirection, contents);
      }
      if (axis === "D") return countMatches(probe.writer, contents);
      return probe.legacy ? countMatches(probe.legacy, contents) : 1;
    };

    for (const axis of axes) {
      sites.push({
        path: relative,
        axis,
        touchesBa,
        touchesIp,
        hasFlag,
        isWriter,
        cluster,
        state,
        hits: Math.max(1, hitsFor(axis)),
      });
    }
  }

  if (probe.indirectHops > 0 && flagReaders.length > 0) {
    const graph = buildReverseGraph(
      scanned,
      path.join(repoRoot, probe.indirectRoot),
    );
    for (const reach of expandImporters(
      flagReaders,
      graph,
      probe.indirectHops,
    )) {
      if (censused.has(reach.file)) continue;
      const relative = path.relative(repoRoot, reach.file);
      if (probe.skip.test(relative)) continue;
      if (probe.testPath.test(relative)) continue;
      const contents = fs.readFileSync(reach.file, "utf8");
      totals.indirect += 1;
      sites.push({
        path: relative,
        axis: "E",
        touchesBa: false,
        touchesIp: false,
        hasFlag: false,
        isWriter: probe.writer.test(contents),
        cluster: `indirect-${clusterFor(relative, probe)}`,
        state: "untriaged",
        hits: 1,
        reachedVia: `${reach.hops} hop via ${path.relative(repoRoot, reach.via)}`,
      });
    }
  }

  splitOversizedClusters(sites, probe.maxClusterRows);

  return {
    probe: probe.name,
    sites,
    totals,
    labels: {
      flag: probe.flagLabel,
      legacy: probe.legacyLabel,
      target: probe.targetLabel,
      indirection: probe.indirectionLabel,
    },
  };
};

export const loadCensus = (
  repoRoot: string,
  probe: CompiledProbe,
  dbPath: string,
  runId: string,
  ticket: string,
): CensusResult => {
  const result = runCensus(repoRoot, probe);
  const store = new Store(dbPath, runId);
  store.startRun(ticket);
  store.addSites(result.sites);
  store.close();
  return result;
};
