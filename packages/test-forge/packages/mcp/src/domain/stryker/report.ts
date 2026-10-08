import type {
  MutantSite,
  SourcePosition,
} from "test-forge-contracts/stryker";

export type ReportTest = {
  file: string;
  name: string;
};

export type ReportMutant = {
  site: MutantSite;
  status: string;
  statusReason: string | null;
  originalText: string;
  coveredBy: ReportTest[];
  killedBy: ReportTest[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const positionOf = (value: unknown): SourcePosition | null => {
  if (!isRecord(value)) return null;
  const { line, column } = value;
  return typeof line === "number" && typeof column === "number"
    ? { line, column }
    : null;
};

export const offsetOf = (source: string, position: SourcePosition): number => {
  let offset = 0;
  for (let line = 1; line < position.line; line += 1) {
    const next = source.indexOf("\n", offset);
    if (next === -1) return source.length;
    offset = next + 1;
  }
  return offset + position.column - 1;
};

const testsOf = (report: unknown): Map<string, ReportTest> => {
  const tests = new Map<string, ReportTest>();
  if (!isRecord(report) || !isRecord(report.testFiles)) return tests;
  for (const [file, description] of Object.entries(report.testFiles)) {
    if (!isRecord(description) || !Array.isArray(description.tests)) continue;
    for (const test of description.tests) {
      if (isRecord(test) && typeof test.id === "string") {
        tests.set(test.id, {
          file,
          name: typeof test.name === "string" ? test.name : test.id,
        });
      }
    }
  }
  return tests;
};

const resolveTests = (
  ids: unknown,
  tests: ReadonlyMap<string, ReportTest>,
): ReportTest[] => {
  if (!Array.isArray(ids)) return [];
  return ids.flatMap((id) => {
    const found = typeof id === "string" ? tests.get(id) : undefined;
    return found === undefined ? [] : [found];
  });
};

const mutantOf = (
  file: string,
  source: string,
  raw: unknown,
  tests: ReadonlyMap<string, ReportTest>,
): ReportMutant | null => {
  if (!isRecord(raw) || !isRecord(raw.location)) return null;
  const start = positionOf(raw.location.start);
  const end = positionOf(raw.location.end);
  if (start === null || end === null) return null;
  if (typeof raw.mutatorName !== "string" || typeof raw.status !== "string") {
    return null;
  }
  return {
    site: {
      file,
      mutator: raw.mutatorName,
      replacement: typeof raw.replacement === "string" ? raw.replacement : "",
      start,
      end,
    },
    status: raw.status,
    statusReason:
      typeof raw.statusReason === "string" ? raw.statusReason : null,
    originalText: source.slice(offsetOf(source, start), offsetOf(source, end)),
    coveredBy: resolveTests(raw.coveredBy, tests),
    killedBy: resolveTests(raw.killedBy, tests),
  };
};

export const parseStrykerReport = (text: string): ReportMutant[] => {
  const report: unknown = JSON.parse(text);
  if (!isRecord(report) || !isRecord(report.files)) {
    throw new Error("the Stryker report has no files section");
  }
  const tests = testsOf(report);
  const mutants: ReportMutant[] = [];
  for (const [file, description] of Object.entries(report.files)) {
    if (!isRecord(description) || !Array.isArray(description.mutants)) continue;
    const source =
      typeof description.source === "string" ? description.source : "";
    for (const raw of description.mutants) {
      const mutant = mutantOf(file, source, raw, tests);
      if (mutant !== null) mutants.push(mutant);
    }
  }
  return mutants;
};
