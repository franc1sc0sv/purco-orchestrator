import type {
  Evidence,
  Retirement,
  RuleVersion,
  Severity,
  Verdict,
} from "test-forge-contracts/codex";

export const DEFAULT_VERDICT_SPACE: readonly Verdict[] = [
  "pass",
  "violation",
  "not-applicable",
];

export const emptyEvidence = (): Evidence => ({
  follows: [],
  violates: [],
  corpus: null,
});

export const latestVersion = (
  versions: readonly RuleVersion[]
): RuleVersion | null => {
  let latest: RuleVersion | null = null;
  for (const version of versions) {
    if (latest === null || version.version > latest.version) latest = version;
  }
  return latest;
};

export const latestVersionNumber = (
  versions: readonly RuleVersion[]
): number | null => latestVersion(versions)?.version ?? null;

export const nextVersionNumber = (versions: readonly RuleVersion[]): number =>
  (latestVersionNumber(versions) ?? 0) + 1;

export const isRetired = (version: RuleVersion): boolean =>
  version.retired !== null;

export const currentVersion = (
  versions: readonly RuleVersion[]
): RuleVersion | null => {
  const latest = latestVersion(versions);
  return latest === null || isRetired(latest) ? null : latest;
};

export const isCurrentVersion = (
  version: RuleVersion,
  versions: readonly RuleVersion[]
): boolean => currentVersion(versions)?.version === version.version;

export const readRetirement = (
  retiredAt: string | null,
  retiredReason: string | null
): Retirement | null =>
  retiredAt === null ? null : { at: retiredAt, reason: retiredReason ?? "" };

export const RETIREMENT_REQUIRES_REASON = "Retiring a rule requires a reason";

export const isUsableRetirementReason = (reason: unknown): reason is string =>
  typeof reason === "string" && reason.trim().length > 0;

export const retiredCopy = (
  version: RuleVersion,
  at: string,
  reason: string
): RuleVersion => ({ ...version, retired: { at, reason } });

export type StandingRetirement = {
  version: number;
  retiredAt: string;
  reason: string;
};

export const standingRetirement = (
  version: RuleVersion
): StandingRetirement | null =>
  version.retired === null
    ? null
    : {
        version: version.version,
        retiredAt: version.retired.at,
        reason: version.retired.reason,
      };

export const IMPORT_ORIGIN_FALLBACK = "unknown-corpus";

export const IMPORTED_SEVERITY: Severity = "advisory";

export const importOrigin = (projectKey: string | null | undefined): string =>
  projectKey ?? IMPORT_ORIGIN_FALLBACK;

export const importDecider = (origin: string): string => `import:${origin}`;

export const importedSeverity = (
  severity: Severity | undefined,
  markAdvisory: boolean
): Severity =>
  markAdvisory ? IMPORTED_SEVERITY : severity ?? IMPORTED_SEVERITY;
