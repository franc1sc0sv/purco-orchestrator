import type {
  Kill,
  KillAttribution,
  MutantOutcome,
} from "test-forge-contracts/mutation";

export const SURVIVOR_OUTCOMES: readonly MutantOutcome[] = [
  "survived",
  "equivalent-claimed",
  "refuted",
];

export const UNRUN_OUTCOMES: readonly MutantOutcome[] = [
  "pending",
  "error",
  "timeout",
];

export type EquivalenceVerdict = {
  upheld: boolean | null;
  signedBy: string | null;
  refutedBy: string | null;
};

export type EquivalenceClassification = {
  outcome: MutantOutcome;
  countsTowardD5: boolean;
  needsHumanSignature: boolean;
};

export const ATTRIBUTION_INCOMPLETE =
  "indeterminate: attribution incomplete, re-run without bail";

export type KillRecord = {
  mutantId: number;
  testFile: string;
  testName: string;
  attributionComplete: boolean;
};

export type AttributionSummary = {
  attribution: KillAttribution[];
  withoutUniqueKills: string[];
  withoutKills: string[];
  attributionComplete: boolean;
  indeterminate: string | null;
  d6: boolean | null;
};

export const testRef = (file: string, name: string): string =>
  `${file}::${name}`;

export const upholdsEquivalence = (
  verdict: EquivalenceVerdict | null
): boolean =>
  verdict !== null && verdict.upheld === true && verdict.signedBy !== null;

export const isOpenSurvivor = (
  outcome: MutantOutcome,
  verdict: EquivalenceVerdict | null
): boolean =>
  SURVIVOR_OUTCOMES.includes(outcome) && !upholdsEquivalence(verdict);

export const isUnrun = (outcome: MutantOutcome): boolean =>
  UNRUN_OUTCOMES.includes(outcome);

export const d5Holds = (survivorCount: number, unrunCount: number): boolean =>
  survivorCount === 0 && unrunCount === 0;

export const classifyEquivalence = (
  verdict: EquivalenceVerdict
): EquivalenceClassification => {
  const signed = verdict.signedBy !== null && verdict.signedBy !== "";
  const outcome: MutantOutcome =
    verdict.upheld === true && signed
      ? "equivalent-signed"
      : verdict.refutedBy
      ? "refuted"
      : "equivalent-claimed";
  return {
    outcome,
    countsTowardD5: outcome !== "equivalent-signed",
    needsHumanSignature: verdict.upheld === true && !signed,
  };
};

const killersByMutant = (
  kills: readonly KillRecord[]
): Map<number, string[]> => {
  const killers = new Map<number, string[]>();
  for (const kill of kills) {
    const existing = killers.get(kill.mutantId);
    const reference = testRef(kill.testFile, kill.testName);
    if (existing) existing.push(reference);
    else killers.set(kill.mutantId, [reference]);
  }
  return killers;
};

type TestTally = {
  testFile: string;
  testName: string;
  mutantIds: number[];
  uniqueMutantIds: number[];
};

const tallyByTest = (kills: readonly KillRecord[]): TestTally[] => {
  const killers = killersByMutant(kills);
  const byTest = new Map<string, TestTally>();

  for (const kill of kills) {
    const key = testRef(kill.testFile, kill.testName);
    const entry = byTest.get(key) ?? {
      testFile: kill.testFile,
      testName: kill.testName,
      mutantIds: [],
      uniqueMutantIds: [],
    };
    entry.mutantIds.push(kill.mutantId);
    if ((killers.get(kill.mutantId) ?? []).length === 1)
      entry.uniqueMutantIds.push(kill.mutantId);
    byTest.set(key, entry);
  }

  return [...byTest.values()];
};

export const attributeKills = (
  kills: readonly KillRecord[],
  declaredTests: readonly (string | Kill)[]
): AttributionSummary => {
  const tallies = tallyByTest(kills);

  if (!kills.every((kill) => kill.attributionComplete)) {
    return {
      attribution: tallies
        .map((entry) => ({
          testFile: entry.testFile,
          testName: entry.testName,
          mutantIds: entry.mutantIds,
          uniqueMutantIds: null,
          kills: entry.mutantIds.length,
          uniqueKills: null,
        }))
        .sort((left, right) => right.kills - left.kills),
      withoutUniqueKills: [],
      withoutKills: [],
      attributionComplete: false,
      indeterminate: ATTRIBUTION_INCOMPLETE,
      d6: null,
    };
  }

  const attribution = tallies.map((entry) => ({
    ...entry,
    kills: entry.mutantIds.length,
    uniqueKills: entry.uniqueMutantIds.length,
  }));

  const declared = declaredTests.map((test) =>
    typeof test === "string" ? test : testRef(test.file, test.name)
  );
  const withKills = new Set(
    attribution.map((entry) => testRef(entry.testFile, entry.testName))
  );
  const withoutKills = declared.filter((test) => !withKills.has(test));
  const withoutUniqueKills = attribution
    .filter((entry) => entry.uniqueKills === 0)
    .map((entry) => testRef(entry.testFile, entry.testName));

  return {
    attribution: attribution.sort(
      (left, right) => right.uniqueKills - left.uniqueKills
    ),
    withoutUniqueKills,
    withoutKills,
    attributionComplete: true,
    indeterminate: null,
    d6: withoutUniqueKills.length === 0 && withoutKills.length === 0,
  };
};
