import fs from "node:fs";
import path from "node:path";

const IMPORT_SPECIFIER = /(?:from|import)\s*["']([^"']+)["']/g;

const CANDIDATE_SUFFIXES = [
  ".ts",
  ".tsx",
  "/index.ts",
  "/index.tsx",
  "",
] as const;

const resolveSpecifier = (
  fromFile: string,
  specifier: string,
  srcRoot: string,
): string | undefined => {
  let base: string;
  if (specifier.startsWith("~/")) base = path.join(srcRoot, specifier.slice(2));
  else if (specifier.startsWith(".")) {
    base = path.resolve(path.dirname(fromFile), specifier);
  } else return undefined;

  for (const suffix of CANDIDATE_SUFFIXES) {
    const candidate = `${base}${suffix}`;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return candidate;
    }
  }
  return undefined;
};

export type ReverseGraph = Map<string, Set<string>>;

export const buildReverseGraph = (
  files: string[],
  srcRoot: string,
): ReverseGraph => {
  const graph: ReverseGraph = new Map();
  for (const file of files) {
    let contents: string;
    try {
      contents = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    for (const match of contents.matchAll(IMPORT_SPECIFIER)) {
      const target = resolveSpecifier(file, match[1] ?? "", srcRoot);
      if (!target) continue;
      const existing = graph.get(target) ?? new Set<string>();
      existing.add(file);
      graph.set(target, existing);
    }
  }
  return graph;
};

export type Reach = {
  file: string;
  hops: number;
  via: string;
};

export const expandImporters = (
  seeds: string[],
  graph: ReverseGraph,
  maxHops: number,
): Reach[] => {
  const seen = new Map<string, Reach>();
  for (const seed of seeds) seen.set(seed, { file: seed, hops: 0, via: seed });

  let frontier = new Set(seeds);
  for (let hop = 1; hop <= maxHops; hop += 1) {
    const next = new Set<string>();
    for (const file of frontier) {
      const origin = seen.get(file);
      for (const importer of graph.get(file) ?? []) {
        if (seen.has(importer)) continue;
        seen.set(importer, {
          file: importer,
          hops: hop,
          via: origin?.via ?? file,
        });
        next.add(importer);
      }
    }
    frontier = next;
    if (frontier.size === 0) break;
  }

  return [...seen.values()].filter((reach) => reach.hops > 0);
};
