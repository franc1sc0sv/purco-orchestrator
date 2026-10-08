import type { Kill } from "test-forge-contracts/mutation";
import type { MutantSite } from "test-forge-contracts/stryker";

export type CoveredSite = {
  site: MutantSite;
  coveredBy: readonly Kill[];
};

const lineSpanOf = (site: MutantSite): number => site.end.line - site.start.line;

const intersectsLines = (site: MutantSite, other: MutantSite): boolean =>
  site.file === other.file &&
  other.start.line <= site.end.line &&
  other.end.line >= site.start.line;

const insideLines = (site: MutantSite, other: MutantSite): boolean =>
  other.start.line >= site.start.line && other.end.line <= site.end.line;

const nearest = (candidates: readonly CoveredSite[]): CoveredSite[] => {
  const smallest = Math.min(...candidates.map((entry) => lineSpanOf(entry.site)));
  return candidates.filter((entry) => lineSpanOf(entry.site) === smallest);
};

const distinct = (kills: readonly Kill[]): Kill[] => {
  const seen = new Map<string, Kill>();
  for (const kill of kills) seen.set(`${kill.file}|${kill.name}`, kill);
  return [...seen.values()];
};

export const coveringTestsOf = (
  site: MutantSite,
  covered: readonly CoveredSite[],
): Kill[] => {
  const sameLines = covered.filter((entry) => intersectsLines(site, entry.site));
  const inside = sameLines.filter((entry) => insideLines(site, entry.site));
  const chosen =
    inside.length > 0
      ? inside
      : sameLines.length > 0
        ? nearest(sameLines)
        : [];
  return distinct(chosen.flatMap((entry) => entry.coveredBy));
};
