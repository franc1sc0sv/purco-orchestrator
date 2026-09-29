import fs from "node:fs";
import { z } from "zod";

export const DEFAULT_CLUSTERS: [string, string][] = [
  ["^prisma/", "prisma"],
  ["^db/", "database-policies"],
  ["^e2e/", "e2e"],
  ["^tests/", "test-harness"],
  ["pages/api/public", "public-api"],
  ["stripe", "stripe"],
  ["quickbooks", "quickbooks"],
  ["third-part", "third-parties"],
  ["webhook", "webhooks"],
  ["payables", "payables"],
  ["disbursement", "disbursements"],
  ["remittance", "remittance"],
  ["claim-demand", "claim-demands"],
  ["payment-allocation", "payment-allocations"],
  ["recurring|payment-plan|promissory|late-fee", "payment-plans"],
  ["usecases/payments|queries/payments|payments/", "payments"],
  ["claim-accounting-tab", "claim-accounting-tab"],
  ["involved-part", "involved-parties"],
  [
    "compose-|journal|activity-log|claim-history|notification|email|letter",
    "communications-and-history",
  ],
  ["reports|dashboard|balance-stats|core-reports|client-health", "reports"],
  ["client-organizations|/clients?/", "client-organizations"],
  ["claims-management", "claims-management"],
  ["/dtos/|output\\.schema|input\\.schema", "schemas-and-dtos"],
  ["infrastructure/queries", "queries-other"],
  ["infrastructure/repositories", "repositories"],
  ["infrastructure/services|/services/", "services"],
  ["/utils/|/helpers/", "utils"],
  ["^src/client/|^src/pages/", "frontend-other"],
  ["^src/server/", "backend-other"],
  ["^src/lib/|^src/types/", "shared-other"],
];

export const DEFAULT_WRITER =
  "\\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\\(|insertInto\\(|updateTable\\(|deleteFrom\\(";

export const DEFAULT_SKIP = "/tests/|\\.test\\.|/node_modules/";

export const DEFAULT_TEST_PATH =
  "/tests/|\\.test\\.|^tests/|^e2e/|/factories/|/seeds/";

export const DEFAULT_FLAG_READ =
  "isFeatureEnabled|useFlags|getMultipleFlags|flags\\?\\.|flags\\[";

const probeSchema = z.object({
  name: z.string(),
  ticket: z.string().optional(),
  flag: z.string(),
  flagLabel: z.string().optional(),
  legacy: z.string().optional(),
  legacyLabel: z.string().optional(),
  target: z.string().optional(),
  targetLabel: z.string().optional(),
  indirection: z.string().optional(),
  indirectionLabel: z.string().optional(),
  writer: z.string().optional(),
  flagRead: z.string().optional(),
  testPath: z.string().optional(),
  indirectHops: z.number().int().min(0).max(6).optional(),
  indirectRoot: z.string().optional(),
  skip: z.string().optional(),
  scanRoots: z.array(z.string()).optional(),
  extensions: z.array(z.string()).optional(),
  extraClusters: z.array(z.tuple([z.string(), z.string()])).optional(),
  clusters: z.array(z.tuple([z.string(), z.string()])).optional(),
  maxClusterRows: z.number().int().positive().optional(),
});

export type Probe = z.infer<typeof probeSchema>;

export type CompiledProbe = {
  name: string;
  ticket?: string;
  flag: RegExp;
  flagLabel: string;
  legacy?: RegExp;
  legacyLabel: string;
  target?: RegExp;
  targetLabel: string;
  indirection?: RegExp;
  indirectionLabel: string;
  writer: RegExp;
  flagRead: RegExp;
  testPath: RegExp;
  indirectHops: number;
  indirectRoot: string;
  skip: RegExp;
  scanRoots: string[];
  extensions: string[];
  clusters: [RegExp, string][];
  maxClusterRows: number;
};

const compile = (source: string, field: string): RegExp => {
  try {
    return new RegExp(source);
  } catch (error) {
    throw new Error(
      `probe field ${field} is not a valid regex: ${String(error)}`,
    );
  }
};

export const compileProbe = (probe: Probe): CompiledProbe => {
  const rules = probe.clusters ?? [
    ...(probe.extraClusters ?? []),
    ...DEFAULT_CLUSTERS,
  ];
  return {
    name: probe.name,
    ticket: probe.ticket,
    flag: compile(probe.flag, "flag"),
    flagLabel: probe.flagLabel ?? "the flag",
    legacy: probe.legacy ? compile(probe.legacy, "legacy") : undefined,
    legacyLabel: probe.legacyLabel ?? "the legacy concept",
    target: probe.target ? compile(probe.target, "target") : undefined,
    targetLabel: probe.targetLabel ?? "the target concept",
    indirection: probe.indirection
      ? compile(probe.indirection, "indirection")
      : undefined,
    indirectionLabel: probe.indirectionLabel ?? "the legacy indirection",
    writer: compile(probe.writer ?? DEFAULT_WRITER, "writer"),
    flagRead: compile(probe.flagRead ?? DEFAULT_FLAG_READ, "flagRead"),
    testPath: compile(probe.testPath ?? DEFAULT_TEST_PATH, "testPath"),
    indirectHops: probe.indirectHops ?? 0,
    indirectRoot: probe.indirectRoot ?? "src",
    skip: compile(probe.skip ?? DEFAULT_SKIP, "skip"),
    scanRoots: probe.scanRoots ?? ["src"],
    extensions: probe.extensions ?? [".ts", ".tsx"],
    clusters: rules.map(([pattern, name], index) => [
      compile(pattern, `clusters[${index}]`),
      name,
    ]),
    maxClusterRows: probe.maxClusterRows ?? 25,
  };
};

export const loadProbe = (probePath: string): CompiledProbe => {
  const raw: unknown = JSON.parse(fs.readFileSync(probePath, "utf8"));
  const parsed = probeSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `probe ${probePath} is invalid:\n${z.prettifyError(parsed.error)}`,
    );
  }
  return compileProbe(parsed.data);
};
