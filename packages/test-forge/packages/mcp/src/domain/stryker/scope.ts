import type {
  LineRange,
  MutantSite,
  ProjectKind,
  ScopeRule,
} from "test-forge-contracts/stryker";

const BACKEND_PREFIXES: readonly string[] = ["src/server/", "src/pages/api/"];

const FRONTEND_PREFIXES: readonly string[] = [
  "src/client/",
  "src/components/",
  "src/utils/",
];

const GLOB_SPECIALS = /[[\]()*?{}]/g;

const startsWithAny = (path: string, prefixes: readonly string[]): boolean =>
  prefixes.some((prefix) => path.startsWith(prefix));

export const projectKindOf = (path: string): ProjectKind =>
  startsWithAny(path, FRONTEND_PREFIXES) &&
  !startsWithAny(path, BACKEND_PREFIXES)
    ? "frontend"
    : "backend";

const touches = (
  ranges: readonly LineRange[],
  first: number,
  last: number,
): boolean => ranges.some(([from, to]) => first <= to && last >= from);

export const startsOnChangedLine = (
  site: MutantSite,
  ranges: readonly LineRange[],
): boolean => touches(ranges, site.start.line, site.start.line);

export const overlapsChangedLine = (
  site: MutantSite,
  ranges: readonly LineRange[],
): boolean => touches(ranges, site.start.line, site.end.line);

export const isSelected = (
  rule: ScopeRule,
  site: MutantSite,
  ranges: readonly LineRange[],
): boolean =>
  rule === "start-line"
    ? startsOnChangedLine(site, ranges)
    : overlapsChangedLine(site, ranges);

export const siteKey = (site: MutantSite): string =>
  [
    site.file,
    site.start.line,
    site.start.column,
    site.end.line,
    site.end.column,
    site.mutator,
    site.replacement,
  ].join("|");

const escapedPath = (path: string): string =>
  path.replace(GLOB_SPECIALS, (character) => `\\${character}`);

export const rangeArgumentOf = (site: MutantSite): string =>
  `${escapedPath(site.file)}:${site.start.line}:${site.start.column - 1}-${site.end.line}:${site.end.column - 1}`;

export const rangeArgumentsOf = (sites: readonly MutantSite[]): string[] => [
  ...new Set(sites.map(rangeArgumentOf)),
];
