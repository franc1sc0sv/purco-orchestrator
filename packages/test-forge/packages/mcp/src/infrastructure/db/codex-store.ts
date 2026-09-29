import { seedTaxonomy } from "../doctrine.ts";
import { all, one, run } from "./connection.ts";
import { toAcceptance, toFixture } from "./rows.ts";
import type {
  AcceptanceRow,
  CodexVersionRow,
  FixtureRow,
  TaxonomyExtRow,
} from "./rows.ts";
import type { DatabaseSync } from "node:sqlite";
import type {
  Acceptance,
  Evidence,
  Fixture,
  FixtureLabel,
  Mechanization,
  Procedure,
  Retirement,
  RubricItem,
  Severity,
  Verdict,
} from "test-forge-contracts/codex";
import type { Scope } from "test-forge-contracts/project";

export const OFFERED_FIXTURE_LABELS = [
  "pass",
  "violation",
  "not-applicable",
] as const;

const STORED_LABEL: Record<string, FixtureLabel> = {
  pass: "follows",
  violation: "violates",
  "not-applicable": "not-applicable",
  follows: "follows",
  violates: "violates",
};

export type AspectEntry = {
  id: string;
  scope: Scope;
  title: string;
  appliesWhen: string;
  blockingBar: string;
  governs: string;
  rationale: string;
  source: string;
  extendedAt?: string;
};

export type RuleDraft = {
  id: string;
  scope: Scope;
  aspect: string;
  severity: Severity;
  mechanization: Mechanization;
  statement: string;
  rationale: string;
  archaeology: string;
  appliesWhen: Procedure;
  detect: Procedure;
  violates: Procedure;
  rubric: RubricItem[];
  verdictSpace: Verdict[];
  evidence: Evidence;
  retired: Retirement | null;
};

export type WrittenVersion = {
  version: number;
  rowId: number;
  previousVersion: number | null;
};

export type FixtureInput = {
  path: string;
  hash?: string;
  label: string;
  isNearMiss?: boolean;
  why?: string;
  labelledBy?: string;
};

export type AcceptanceInput = {
  fixtures?: number;
  nearMisses?: number;
  reviewerScore?: { passed?: number; total?: number };
  acceptedAt?: string;
};

export type LastAcceptanceRow = Pick<
  AcceptanceRow,
  | "rule_version"
  | "fixture_count"
  | "near_miss_count"
  | "score_passed"
  | "score_total"
  | "accepted_at"
>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const toStoredLabel = (label: string): FixtureLabel => {
  const stored = STORED_LABEL[label];
  if (stored === undefined) {
    throw new Error(
      `Fixture label must be one of ${OFFERED_FIXTURE_LABELS.join(
        ", "
      )} but was "${label}"`
    );
  }
  return stored;
};

export const corpusHashOf = (evidence: Evidence): string | null => {
  const corpus: unknown = evidence.corpus;
  if (!isRecord(corpus)) return null;
  const hash = corpus["hash"];
  return typeof hash === "string" && hash.length > 0 ? hash : null;
};

export const readFixtures = (
  db: DatabaseSync,
  projectKey: string,
  ruleId: string
): Fixture[] =>
  all<FixtureRow>(
    db,
    `SELECT id, project_key, rule_id, file_path, file_hash, label, is_near_miss, why, labelled_by, created_at
       FROM fixtures
      WHERE project_key = ? AND rule_id = ?
      ORDER BY is_near_miss DESC, label, file_path`,
    [projectKey, ruleId]
  ).map(toFixture);

export const readAcceptance = (
  db: DatabaseSync,
  projectKey: string,
  ruleId: string,
  version: number
): Acceptance | null => {
  const row = one<AcceptanceRow>(
    db,
    `SELECT * FROM acceptance
      WHERE project_key = ? AND rule_id = ? AND rule_version = ?`,
    [projectKey, ruleId, version]
  );
  return row === null ? null : toAcceptance(row);
};

export const readLastAcceptance = (
  db: DatabaseSync,
  projectKey: string,
  ruleId: string
): LastAcceptanceRow | null =>
  one<LastAcceptanceRow>(
    db,
    `SELECT rule_version, fixture_count, near_miss_count, score_passed, score_total, accepted_at
       FROM acceptance
      WHERE project_key = ? AND rule_id = ?
      ORDER BY rule_version DESC LIMIT 1`,
    [projectKey, ruleId]
  );

export const readLastAcceptedVersion = (
  db: DatabaseSync,
  projectKey: string,
  ruleId: string
): number | null =>
  one<{ version: number | null }>(
    db,
    `SELECT MAX(rule_version) AS version FROM acceptance
      WHERE project_key = ? AND rule_id = ?`,
    [projectKey, ruleId]
  )?.version ?? null;

export const readCurrentRows = (
  db: DatabaseSync,
  projectKey: string,
  scope?: Scope
): CodexVersionRow[] =>
  all<CodexVersionRow>(
    db,
    `SELECT c.*
       FROM codex_versions c
      WHERE c.project_key = ?${scope === undefined ? "" : " AND c.scope = ?"}
        AND c.retired_at IS NULL
        AND c.version = (
          SELECT MAX(v.version)
            FROM codex_versions v
           WHERE v.project_key = c.project_key AND v.rule_id = c.rule_id
        )
      ORDER BY c.scope, c.aspect, c.rule_id`,
    scope === undefined ? [projectKey] : [projectKey, scope]
  );

export const readVersionRow = (
  db: DatabaseSync,
  projectKey: string,
  ruleId: string,
  version: number
): CodexVersionRow | null =>
  one<CodexVersionRow>(
    db,
    `SELECT * FROM codex_versions
      WHERE project_key = ? AND rule_id = ? AND version = ?`,
    [projectKey, ruleId, version]
  );

export const readLatestRow = (
  db: DatabaseSync,
  projectKey: string,
  ruleId: string
): CodexVersionRow | null =>
  one<CodexVersionRow>(
    db,
    `SELECT * FROM codex_versions
      WHERE project_key = ? AND rule_id = ?
      ORDER BY version DESC LIMIT 1`,
    [projectKey, ruleId]
  );

export const readLatestVersionNumber = (
  db: DatabaseSync,
  projectKey: string,
  ruleId: string
): number | null =>
  one<{ latest: number | null }>(
    db,
    `SELECT MAX(version) AS latest FROM codex_versions
      WHERE project_key = ? AND rule_id = ?`,
    [projectKey, ruleId]
  )?.latest ?? null;

export const appendVersion = (
  db: DatabaseSync,
  projectKey: string,
  rule: RuleDraft,
  decidedBy: string
): WrittenVersion => {
  const previousVersion = readLatestVersionNumber(db, projectKey, rule.id);
  const version = (previousVersion ?? 0) + 1;
  const written = run(
    db,
    `INSERT INTO codex_versions
       (project_key, scope, aspect, rule_id, version, severity, mechanization, statement, rationale,
        archaeology, applies_when_json, detect_json, violates_json, rubric_json, verdict_space_json,
        evidence_json, decided_by, retired_at, retired_reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      projectKey,
      rule.scope,
      rule.aspect,
      rule.id,
      version,
      rule.severity,
      rule.mechanization,
      rule.statement,
      rule.rationale,
      rule.archaeology,
      JSON.stringify(rule.appliesWhen),
      JSON.stringify(rule.detect),
      JSON.stringify(rule.violates),
      JSON.stringify(rule.rubric),
      JSON.stringify(rule.verdictSpace),
      JSON.stringify(rule.evidence),
      decidedBy,
      rule.retired?.at ?? null,
      rule.retired?.reason ?? null,
    ]
  );
  return {
    version,
    rowId: Number(written.lastInsertRowid),
    previousVersion,
  };
};

export const insertFixtures = (
  db: DatabaseSync,
  projectKey: string,
  ruleId: string,
  fixtures: readonly FixtureInput[]
): number => {
  let added = 0;
  for (const fixture of fixtures) {
    const label = toStoredLabel(fixture.label);
    const nearMiss = fixture.isNearMiss === true ? 1 : 0;
    const existing = one<{ id: number }>(
      db,
      `SELECT id FROM fixtures
        WHERE project_key = ? AND rule_id = ? AND file_path = ? AND label = ? AND is_near_miss = ?`,
      [projectKey, ruleId, fixture.path, label, nearMiss]
    );
    if (existing !== null) continue;
    run(
      db,
      `INSERT INTO fixtures (project_key, rule_id, file_path, file_hash, label, is_near_miss, why, labelled_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        projectKey,
        ruleId,
        fixture.path,
        fixture.hash ?? "",
        label,
        nearMiss,
        fixture.why ?? "",
        fixture.labelledBy ?? "unknown",
      ]
    );
    added += 1;
  }
  return added;
};

export const insertAcceptance = (
  db: DatabaseSync,
  projectKey: string,
  ruleId: string,
  version: number,
  fixtureCount: number,
  nearMissCount: number,
  passed: number,
  total: number,
  acceptedAt: string
): void => {
  run(
    db,
    `INSERT INTO acceptance
       (project_key, rule_id, rule_version, fixture_count, near_miss_count, score_passed, score_total, accepted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (project_key, rule_id, rule_version) DO NOTHING`,
    [
      projectKey,
      ruleId,
      version,
      fixtureCount,
      nearMissCount,
      passed,
      total,
      acceptedAt,
    ]
  );
};

const corpusHashKey = (
  projectKey: string,
  scope: string,
  aspect: string
): string => `corpus-hash:${projectKey}:${scope}:${aspect}`;

export const readCorpusHash = (
  db: DatabaseSync,
  projectKey: string,
  scope: string,
  aspect: string
): { hash: string; sampledAt: string } | null => {
  const row = one<{ value: string; updated_at: string }>(
    db,
    `SELECT value, updated_at FROM schema_meta WHERE key = ?`,
    [corpusHashKey(projectKey, scope, aspect)]
  );
  return row === null ? null : { hash: row.value, sampledAt: row.updated_at };
};

export const writeCorpusHash = (
  db: DatabaseSync,
  projectKey: string,
  scope: string,
  aspect: string,
  hash: string
): void => {
  run(
    db,
    `INSERT INTO schema_meta (key, value, updated_at)
     VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
     ON CONFLICT (key) DO UPDATE
       SET value = excluded.value, updated_at = excluded.updated_at`,
    [corpusHashKey(projectKey, scope, aspect), hash]
  );
};

export const readTaxonomyExt = (
  db: DatabaseSync,
  projectKey: string,
  scope?: Scope
): TaxonomyExtRow[] =>
  all<TaxonomyExtRow>(
    db,
    `SELECT project_key, scope, aspect, applies_when, blocking_bar, created_at
       FROM taxonomy_ext
      WHERE project_key = ?${scope === undefined ? "" : " AND scope = ?"}`,
    scope === undefined ? [projectKey] : [projectKey, scope]
  );

export const readAspectIndex = (
  db: DatabaseSync,
  projectKey: string
): Map<string, AspectEntry> => {
  const index = new Map<string, AspectEntry>();
  for (const aspect of seedTaxonomy().aspects) {
    index.set(`${aspect.scope}:${aspect.id}`, { ...aspect, source: "seed" });
  }
  for (const row of readTaxonomyExt(db, projectKey)) {
    const key = `${row.scope}:${row.aspect}`;
    const seeded = index.get(key);
    index.set(key, {
      id: row.aspect,
      scope: row.scope,
      title: seeded?.title ?? row.aspect,
      appliesWhen: row.applies_when,
      blockingBar: row.blocking_bar,
      governs: seeded?.governs ?? "",
      rationale: seeded?.rationale ?? "",
      source: seeded === undefined ? "project" : "seed+project",
      extendedAt: row.created_at,
    });
  }
  return index;
};

export const upsertTaxonomyExt = (
  db: DatabaseSync,
  projectKey: string,
  scope: Scope,
  aspect: string,
  appliesWhen: string,
  blockingBar: string
): void => {
  run(
    db,
    `INSERT INTO taxonomy_ext (project_key, scope, aspect, applies_when, blocking_bar)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (project_key, scope, aspect) DO UPDATE
       SET applies_when = excluded.applies_when, blocking_bar = excluded.blocking_bar`,
    [projectKey, scope, aspect, appliesWhen, blockingBar]
  );
};

export const insertTaxonomyExtIfAbsent = (
  db: DatabaseSync,
  projectKey: string,
  scope: string,
  aspect: string,
  appliesWhen: string,
  blockingBar: string
): number => {
  const written = run(
    db,
    `INSERT INTO taxonomy_ext (project_key, scope, aspect, applies_when, blocking_bar)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (project_key, scope, aspect) DO NOTHING`,
    [projectKey, scope, aspect, appliesWhen, blockingBar]
  );
  return Number(written.changes);
};

export const findTaxonomyExt = (
  db: DatabaseSync,
  projectKey: string,
  scope: Scope,
  aspect: string
): TaxonomyExtRow | null =>
  one<TaxonomyExtRow>(
    db,
    `SELECT project_key, scope, aspect, applies_when, blocking_bar, created_at
       FROM taxonomy_ext
      WHERE project_key = ? AND scope = ? AND aspect = ?`,
    [projectKey, scope, aspect]
  );
