export const SIZES = ["S", "M", "L"] as const;

export type Size = (typeof SIZES)[number];

export type SizeFacts = {
  filesNamed: number;
  backend: boolean;
  frontend: boolean;
  migration: boolean;
  flag: boolean;
  acceptanceCriteria: number;
};

export type SizeVerdict = { size: Size; reasons: string[] };

export const FACT_KEYS = [
  "files_named",
  "backend",
  "frontend",
  "migration",
  "flag",
  "acceptance_criteria",
] as const;

const RANK: Record<Size, number> = { S: 0, M: 1, L: 2 };

export const higherSize = (a: Size, b: Size): Size => (RANK[a] >= RANK[b] ? a : b);

export const sizeFor = (facts: SizeFacts): SizeVerdict => {
  const sides = Number(facts.backend) + Number(facts.frontend);
  const large: string[] = [];
  if (facts.migration) large.push("it has a migration");
  if (sides === 2 && facts.filesNamed > 5) {
    large.push(`it touches backend and frontend across ${facts.filesNamed} files`);
  }
  if (facts.acceptanceCriteria > 6) {
    large.push(`it has ${facts.acceptanceCriteria} acceptance criteria`);
  }
  if (large.length > 0) return { size: "L", reasons: large };

  const beyondSmall: string[] = [];
  if (facts.filesNamed > 2) beyondSmall.push(`${facts.filesNamed} files are named`);
  if (sides > 1) beyondSmall.push("it touches backend and frontend");
  if (facts.flag) beyondSmall.push("it adds or changes a feature flag");
  if (facts.acceptanceCriteria > 2) {
    beyondSmall.push(`it has ${facts.acceptanceCriteria} acceptance criteria`);
  }
  if (beyondSmall.length > 0) return { size: "M", reasons: beyondSmall };

  return {
    size: "S",
    reasons: [
      `${facts.filesNamed} files, ${sides === 0 ? "no side named" : facts.backend ? "backend only" : "frontend only"}, no migration, no flag, ${facts.acceptanceCriteria} acceptance criteria`,
    ],
  };
};

export const factsFromCounts = (
  counts: Record<string, number> | undefined,
): SizeFacts | { missing: string[] } => {
  if (!counts) return { missing: [...FACT_KEYS] };
  const missing = FACT_KEYS.filter((key) => typeof counts[key] !== "number");
  if (missing.length > 0) return { missing };
  return {
    filesNamed: counts.files_named ?? 0,
    backend: (counts.backend ?? 0) > 0,
    frontend: (counts.frontend ?? 0) > 0,
    migration: (counts.migration ?? 0) > 0,
    flag: (counts.flag ?? 0) > 0,
    acceptanceCriteria: counts.acceptance_criteria ?? 0,
  };
};

export const sizeForBriefs = (briefs: number): Size =>
  briefs > 3 ? "L" : briefs > 1 ? "M" : "S";

export const raiseSize = (
  current: Size,
  candidate: Size,
  reason: string,
): { size: Size; raised: boolean; reason: string } =>
  RANK[candidate] > RANK[current]
    ? { size: candidate, raised: true, reason }
    : { size: current, raised: false, reason: "" };

const SIZE_ANSWER = /^\s*(?:approve\s+)?(?:size\s+)?([SML])\s*[.!]?\s*$/i;

export const parseSizeAnswer = (answer: string): Size | undefined => {
  const match = SIZE_ANSWER.exec(answer);
  const letter = match?.[1]?.toUpperCase();
  return SIZES.find((size) => size === letter);
};

export const testDepthFor = (size: Size): "quick" | "full" =>
  size === "L" ? "full" : "quick";

export const reviewTaskFor = ({
  size,
  ticket,
  base,
  pack,
}: {
  size: Size | undefined;
  ticket: string;
  base: string;
  pack: string;
}): string =>
  size === "S"
    ? `Review only the output of git diff origin/${base}...HEAD for ${ticket}. Do not sweep the ADRs. Report only in-scope defects that the builder must fix with report, for_role "builder". Write ${pack}/07-review-findings.md. Your context pack is ${pack}.`
    : `Review the diff against origin/${base} for ${ticket}. Report each in-scope defect that the builder must fix with report, for_role "builder". Write ${pack}/07-review-findings.md. Your context pack is ${pack}.`;
