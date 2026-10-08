import { posix } from "node:path";

export type PathAlias = {
  pattern: string;
  targets: string[];
};

export type ResolverConfig = {
  baseUrl: string | null;
  aliases: PathAlias[];
};

export type ReverseImportGraph = Map<string, Set<string>>;

const IMPORT_SPECIFIER =
  /\b(?:from|import|require|mock|doMock|unmock|importActual|importMock)\s*\(?\s*["']([^"'\n]+)["']/g;

const RESOLVED_SUFFIXES: readonly string[] = [
  "",
  ".ts",
  ".tsx",
  "/index.ts",
  "/index.tsx",
];

const DEFAULT_ALIASES: readonly PathAlias[] = [
  { pattern: "~/*", targets: ["src/*"] },
  { pattern: "@/*", targets: ["src/*"] },
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stripJsonComments = (text: string): string => {
  let output = "";
  let index = 0;
  while (index < text.length) {
    const character = text[index] ?? "";
    const next = text[index + 1];
    if (character === '"') {
      let end = index + 1;
      while (end < text.length && text[end] !== '"') {
        end += text[end] === "\\" ? 2 : 1;
      }
      output += text.slice(index, end + 1);
      index = end + 1;
    } else if (character === "/" && next === "/") {
      const end = text.indexOf("\n", index);
      index = end === -1 ? text.length : end;
    } else if (character === "/" && next === "*") {
      const end = text.indexOf("*/", index + 2);
      index = end === -1 ? text.length : end + 2;
    } else {
      output += character;
      index += 1;
    }
  }
  return output.replace(/,(\s*[}\]])/g, "$1");
};

const toRepoPath = (path: string): string => posix.normalize(path);

const aliasesOf = (paths: unknown): PathAlias[] => {
  if (!isRecord(paths)) return [];
  return Object.entries(paths).flatMap(([pattern, targets]) =>
    Array.isArray(targets)
      ? [
          {
            pattern,
            targets: targets.filter(
              (target): target is string => typeof target === "string",
            ),
          },
        ]
      : [],
  );
};

export const parseResolverConfig = (tsconfigText: string | null): ResolverConfig => {
  let options: Record<string, unknown> = {};
  if (tsconfigText !== null) {
    try {
      const parsed: unknown = JSON.parse(stripJsonComments(tsconfigText));
      if (isRecord(parsed) && isRecord(parsed.compilerOptions)) {
        options = parsed.compilerOptions;
      }
    } catch {
      options = {};
    }
  }
  return {
    baseUrl: typeof options.baseUrl === "string" ? options.baseUrl : null,
    aliases: [...aliasesOf(options.paths), ...DEFAULT_ALIASES],
  };
};

export const specifiersOf = (text: string): string[] =>
  [...text.matchAll(IMPORT_SPECIFIER)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );

const aliasBases = (specifier: string, aliases: readonly PathAlias[]): string[] =>
  aliases.flatMap(({ pattern, targets }) => {
    const star = pattern.indexOf("*");
    if (star === -1) {
      return pattern === specifier ? targets.map(toRepoPath) : [];
    }
    const prefix = pattern.slice(0, star);
    const suffix = pattern.slice(star + 1);
    const fits =
      specifier.length >= prefix.length + suffix.length &&
      specifier.startsWith(prefix) &&
      specifier.endsWith(suffix);
    if (!fits) return [];
    const middle = specifier.slice(prefix.length, specifier.length - suffix.length);
    return targets.map((target) => toRepoPath(target.replace("*", middle)));
  });

const baseCandidates = (
  fromFile: string,
  specifier: string,
  config: ResolverConfig,
): string[] => {
  if (specifier.startsWith(".")) {
    return [toRepoPath(posix.join(posix.dirname(fromFile), specifier))];
  }
  const bases = aliasBases(specifier, config.aliases);
  if (config.baseUrl !== null) {
    bases.push(toRepoPath(posix.join(config.baseUrl, specifier)));
  }
  return bases;
};

export const resolveImport = (
  fromFile: string,
  specifier: string,
  config: ResolverConfig,
  known: ReadonlySet<string>,
): string | null => {
  for (const base of baseCandidates(fromFile, specifier, config)) {
    const withoutScriptExtension = base.replace(/\.(?:js|jsx)$/, "");
    for (const root of new Set([base, withoutScriptExtension])) {
      for (const suffix of RESOLVED_SUFFIXES) {
        const candidate = `${root}${suffix}`;
        if (known.has(candidate)) return candidate;
      }
    }
  }
  return null;
};

export const importsOf = (
  fromFile: string,
  text: string,
  config: ResolverConfig,
  known: ReadonlySet<string>,
): string[] => {
  const resolved = new Set<string>();
  for (const specifier of specifiersOf(text)) {
    const target = resolveImport(fromFile, specifier, config, known);
    if (target !== null && target !== fromFile) resolved.add(target);
  }
  return [...resolved];
};

export const addImports = (
  graph: ReverseImportGraph,
  fromFile: string,
  targets: readonly string[],
): void => {
  for (const target of targets) {
    const importers = graph.get(target) ?? new Set<string>();
    importers.add(fromFile);
    graph.set(target, importers);
  }
};

export const DEFAULT_HUB_IMPORTER_LIMIT = 25;

export const reachingFiles = (
  seeds: readonly string[],
  graph: ReadonlyMap<string, ReadonlySet<string>>,
  hubImporterLimit: number = DEFAULT_HUB_IMPORTER_LIMIT,
): Set<string> => {
  const seedSet = new Set(seeds);
  const reached = new Set<string>();
  let frontier = [...seeds];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const file of frontier) {
      const importers = graph.get(file) ?? new Set<string>();
      const isHub = !seedSet.has(file) && importers.size > hubImporterLimit;
      if (isHub) continue;
      for (const importer of importers) {
        if (reached.has(importer)) continue;
        reached.add(importer);
        next.push(importer);
      }
    }
    frontier = next;
  }
  return reached;
};
