import { acceptRule } from "../../application/codex/accept-rule.ts";
import { aspects } from "../../application/codex/aspects.ts";
import { corpusMark } from "../../application/codex/corpus-mark.ts";
import { exportCodex } from "../../application/codex/export.ts";
import { fixtureAdd } from "../../application/codex/fixture-add.ts";
import { fixtureList } from "../../application/codex/fixture-list.ts";
import { gaps } from "../../application/codex/gaps.ts";
import { history } from "../../application/codex/history.ts";
import { importCodex } from "../../application/codex/import.ts";
import { retireRule } from "../../application/codex/retire-rule.ts";
import { revert } from "../../application/codex/revert.ts";
import { ruleGet } from "../../application/codex/rule-get.ts";
import type { RuleInput } from "../../application/codex/rule-input.ts";
import { ruleWrite } from "../../application/codex/rule-write.ts";
import { rulesFor } from "../../application/codex/rules-for.ts";
import { taxonomySet } from "../../application/codex/taxonomy-set.ts";
import { listView } from "../../application/listing/list-view.ts";
import { listPageInput, pageFor } from "../page.ts";
import { respondAsync } from "../response.ts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  FIXTURE_LABELS,
  MECHANIZATIONS,
  SEVERITIES,
  VERDICT_SPACE,
} from "test-forge-contracts/codex";
import { SCOPES } from "test-forge-contracts/project";
import { z } from "zod";

type ProcedureDraft = NonNullable<RuleInput["appliesWhen"]>;
type RubricDraft = NonNullable<RuleInput["rubric"]>[number];
type EvidenceDraft = NonNullable<RuleInput["evidence"]>;
type CitationDraft = EvidenceDraft["follows"][number];
type CorpusDraft = NonNullable<EvidenceDraft["corpus"]>;
type FixtureDraft = NonNullable<RuleInput["fixtures"]>[number];
type AcceptanceDraft = NonNullable<RuleInput["acceptance"]>;

const cwd = z
  .string()
  .describe("Absolute path inside the project the codex belongs to.");

const ruleId = z
  .string()
  .describe("Rule identifier, stable across every version of the rule.");

const scope = z
  .enum(SCOPES)
  .describe("Half of the corpus the rule governs: backend or frontend.");

const procedureSchema = z
  .object({
    human: z
      .string()
      .describe("The sentence a human applies when no check can decide.")
      .optional(),
    check: z
      .union([z.string(), z.null()])
      .describe(
        "Check-DSL expression, 'grep:<pattern>' or 'ast:<expression>', or null when the rule carries no mechanical check."
      )
      .optional(),
    paths: z
      .object({
        include: z
          .array(z.string())
          .describe(
            "Globs the procedure is limited to. Empty means every file."
          )
          .default([]),
        exclude: z
          .array(z.string())
          .describe("Globs the procedure never runs over.")
          .default([]),
      })
      .strict()
      .describe("Path filter applied before the check runs.")
      .optional(),
  })
  .strict();

const citationSchema = z
  .object({
    path: z.string().describe("Corpus file the citation points at."),
    line: z.number().int().describe("Line the excerpt starts on.").optional(),
    excerpt: z.string().describe("The quoted source line.").optional(),
    note: z.string().describe("Why this line is evidence.").optional(),
  })
  .strict();

const corpusSampleSchema = z
  .object({
    scanned: z.number().int().describe("Files read during the sweep."),
    followed: z.number().int().describe("Files that follow the rule."),
    violated: z.number().int().describe("Files that break the rule."),
    notApplicable: z
      .number()
      .int()
      .describe("Files the rule does not govern.")
      .optional(),
    sampledAt: z.string().describe("ISO timestamp of the sweep.").optional(),
  })
  .strict();

const evidenceSchema = z
  .object({
    follows: z
      .array(citationSchema)
      .describe("Cited files that obey the rule.")
      .default([]),
    violates: z
      .array(citationSchema)
      .describe("Cited files that break the rule.")
      .default([]),
    corpus: corpusSampleSchema
      .describe("Counts from the corpus sweep behind the rule.")
      .nullable()
      .default(null),
  })
  .strict();

const rubricItemSchema = z
  .object({
    id: z.string().describe("Stable identifier of the rubric line.").optional(),
    question: z.string().describe("What the reviewer must answer."),
    expects: z.string().describe("The answer a conforming file gives."),
    weight: z.number().describe("Relative weight of the line.").optional(),
  })
  .strict();

const fixtureSchema = z
  .object({
    path: z.string().describe("Corpus file used as a fixture."),
    hash: z
      .string()
      .describe("Content hash pinned when the fixture was labelled.")
      .optional(),
    label: z
      .enum(FIXTURE_LABELS)
      .describe("The verdict this file must receive from the rule."),
    isNearMiss: z
      .boolean()
      .describe("True when the file sits just outside the rule.")
      .optional(),
    why: z.string().describe("Why the file carries this label.").optional(),
    labelledBy: z.string().describe("Who labelled the file.").optional(),
  })
  .strict();

const acceptanceSchema = z
  .object({
    fixtures: z.number().int().describe("Labelled files counted.").optional(),
    nearMisses: z
      .number()
      .int()
      .describe("Near-miss files among them.")
      .optional(),
    reviewerScore: z
      .object({
        passed: z
          .number()
          .int()
          .describe("Labelled files the rule decided correctly.")
          .optional(),
        total: z
          .number()
          .int()
          .describe("Labelled files the rule was scored against.")
          .optional(),
      })
      .strict()
      .describe("Score the rule earned over its fixtures.")
      .optional(),
    acceptedAt: z
      .string()
      .describe("ISO timestamp of the acceptance.")
      .optional(),
  })
  .strict();

const ruleSchema = z
  .object({
    id: ruleId.optional(),
    version: z
      .number()
      .int()
      .describe(
        "Ignored on write; the store computes the next version. Accepted so an exported rule can be written back unchanged."
      )
      .optional(),
    aspect: z
      .string()
      .describe("Lowercase hyphen-separated aspect the rule belongs to.")
      .optional(),
    scope: scope.optional(),
    severity: z
      .enum(SEVERITIES)
      .describe("blocking stops a run; advisory only reports.")
      .optional(),
    mechanization: z
      .enum(MECHANIZATIONS)
      .describe(
        "How much of the rule a check can decide: full, partial or judgment."
      )
      .optional(),
    statement: z.string().describe("The rule in one sentence.").optional(),
    rationale: z.string().describe("Why the rule exists.").optional(),
    archaeology: z
      .string()
      .describe("What the corpus showed that produced the rule.")
      .optional(),
    appliesWhen: procedureSchema
      .describe("Procedure that decides whether the rule governs a file.")
      .optional(),
    detect: procedureSchema
      .describe("Procedure that finds the sites the rule speaks about.")
      .optional(),
    violates: procedureSchema
      .describe("Procedure that decides whether a site breaks the rule.")
      .optional(),
    rubric: z
      .array(rubricItemSchema)
      .describe("Questions a reviewer answers when judgment decides.")
      .optional(),
    verdictSpace: z
      .array(z.enum(VERDICT_SPACE))
      .describe("Verdicts a review of this rule may return.")
      .optional(),
    evidence: evidenceSchema
      .describe("Citations and corpus counts behind the rule.")
      .optional(),
    fixtures: z
      .array(fixtureSchema)
      .describe("Labelled corpus files to record with this version.")
      .optional(),
    acceptance: acceptanceSchema
      .describe("Acceptance record to store against this version.")
      .optional(),
    retired: z
      .object({
        at: z.string().describe("ISO timestamp of the retirement."),
        reason: z.string().describe("Why the rule no longer holds."),
      })
      .strict()
      .describe("Present only when the version is written already retired.")
      .optional(),
    decidedBy: z
      .string()
      .describe("human, corpus, or an import origin.")
      .optional(),
    createdAt: z
      .string()
      .describe(
        "Ignored on write; the store stamps the row. Accepted so an exported rule can be written back unchanged."
      )
      .optional(),
  })
  .strict();

const rulesForInput = z
  .object({
    cwd,
    scope: scope.optional(),
    filePath: z
      .string()
      .describe("Test file under consideration; absolute or relative to cwd.")
      .optional(),
    page: listPageInput.optional(),
  })
  .strict();

const ruleGetInput = z
  .object({
    cwd,
    ruleId,
    version: z
      .number()
      .int()
      .min(1)
      .describe("Specific version; omit for the current one.")
      .optional(),
  })
  .strict();

const ruleWriteInput = z
  .object({
    cwd,
    rule: ruleSchema.describe(
      "Rule document matching doctrine/rule.schema.json."
    ),
    decidedBy: z
      .string()
      .describe("human, corpus, or an import origin.")
      .optional(),
  })
  .strict();

const revertInput = z
  .object({
    cwd,
    ruleId,
    toVersion: z.number().int().min(1).describe("Version to copy forward."),
    decidedBy: z
      .string()
      .describe("Who ordered the revert. Defaults to human.")
      .optional(),
  })
  .strict();

const retireRuleInput = z
  .object({
    cwd,
    ruleId,
    reason: z.string().describe("Why the rule no longer holds."),
    decidedBy: z
      .string()
      .describe("Who ordered the retirement. Defaults to human.")
      .optional(),
  })
  .strict();

const historyInput = z.object({ cwd, ruleId }).strict();

const fixtureAddInput = z
  .object({
    cwd,
    ruleId,
    filePath: z
      .string()
      .describe("Corpus file to label; absolute or relative to cwd."),
    label: z
      .enum(FIXTURE_LABELS)
      .describe("The verdict this file must receive from the rule."),
    isNearMiss: z
      .boolean()
      .describe(
        "True when the file sits just outside the rule and must not be flagged. Defaults to false."
      )
      .optional(),
    why: z
      .string()
      .describe("Why this file carries this label, in one sentence."),
    labelledBy: z.string().describe("Who labelled it."),
  })
  .strict();

const fixtureListInput = z.object({ cwd, ruleId }).strict();

const acceptRuleInput = z
  .object({
    cwd,
    ruleId,
    ruleVersion: z.number().int().min(1).describe("Version being frozen."),
    scorePassed: z
      .number()
      .int()
      .min(0)
      .describe("Labelled files the rule decided correctly."),
    scoreTotal: z
      .number()
      .int()
      .min(0)
      .describe("Labelled files the rule was scored against."),
  })
  .strict();

const taxonomySetInput = z
  .object({
    cwd,
    scope,
    aspect: z.string().describe("Lowercase hyphen-separated aspect id."),
    appliesWhen: z
      .string()
      .describe(
        "The sentence that decides whether this aspect governs a file."
      ),
    blockingBar: z
      .string()
      .describe(
        "Evidence bar a rule of this aspect must meet: low, majority or near-total."
      ),
  })
  .strict();

const gapsInput = z
  .object({ cwd, scope: scope.optional(), page: listPageInput.optional() })
  .strict();

const exportInput = z.object({ cwd, scope: scope.optional() }).strict();

const importInput = z
  .object({
    cwd,
    payload: z
      .union([
        z.string(),
        z.record(z.string(), z.unknown()),
        z.array(z.unknown()),
      ])
      .describe("Export payload, as an object or a JSON string."),
    markAdvisory: z
      .boolean()
      .describe(
        "Force every imported rule to advisory severity. Defaults to true."
      )
      .optional(),
  })
  .strict();

const aspectsInput = z
  .object({
    cwd,
    scope: scope.optional(),
    corpusHashes: z
      .record(z.string(), z.string())
      .describe(
        "Aspect id (or scope:aspect) to the current corpus hash, for the staleness comparison."
      )
      .optional(),
  })
  .strict();

const corpusMarkInput = z
  .object({
    cwd,
    scope,
    aspect: z.string().describe("Aspect the sweep covered."),
    corpusHash: z
      .string()
      .describe("Hash of the corpus the sweep read, from ast_corpus_hash."),
  })
  .strict();

const toProcedure = (
  input: z.infer<typeof procedureSchema>
): ProcedureDraft => ({
  ...(input.human === undefined ? {} : { human: input.human }),
  ...(input.check === undefined ? {} : { check: input.check }),
  ...(input.paths === undefined ? {} : { paths: input.paths }),
});

const toCitation = (input: z.infer<typeof citationSchema>): CitationDraft => ({
  path: input.path,
  ...(input.line === undefined ? {} : { line: input.line }),
  ...(input.excerpt === undefined ? {} : { excerpt: input.excerpt }),
  ...(input.note === undefined ? {} : { note: input.note }),
});

const toCorpusSample = (
  input: z.infer<typeof corpusSampleSchema>
): CorpusDraft => ({
  scanned: input.scanned,
  followed: input.followed,
  violated: input.violated,
  ...(input.notApplicable === undefined
    ? {}
    : { notApplicable: input.notApplicable }),
  ...(input.sampledAt === undefined ? {} : { sampledAt: input.sampledAt }),
});

const toEvidence = (input: z.infer<typeof evidenceSchema>): EvidenceDraft => ({
  follows: input.follows.map(toCitation),
  violates: input.violates.map(toCitation),
  corpus: input.corpus === null ? null : toCorpusSample(input.corpus),
});

const toRubricItem = (
  input: z.infer<typeof rubricItemSchema>
): RubricDraft => ({
  question: input.question,
  expects: input.expects,
  ...(input.id === undefined ? {} : { id: input.id }),
  ...(input.weight === undefined ? {} : { weight: input.weight }),
});

const toFixture = (input: z.infer<typeof fixtureSchema>): FixtureDraft => ({
  path: input.path,
  label: input.label,
  ...(input.hash === undefined ? {} : { hash: input.hash }),
  ...(input.isNearMiss === undefined ? {} : { isNearMiss: input.isNearMiss }),
  ...(input.why === undefined ? {} : { why: input.why }),
  ...(input.labelledBy === undefined ? {} : { labelledBy: input.labelledBy }),
});

const toAcceptance = (
  input: z.infer<typeof acceptanceSchema>
): AcceptanceDraft => ({
  ...(input.fixtures === undefined ? {} : { fixtures: input.fixtures }),
  ...(input.nearMisses === undefined ? {} : { nearMisses: input.nearMisses }),
  ...(input.acceptedAt === undefined ? {} : { acceptedAt: input.acceptedAt }),
  ...(input.reviewerScore === undefined
    ? {}
    : {
        reviewerScore: {
          ...(input.reviewerScore.passed === undefined
            ? {}
            : { passed: input.reviewerScore.passed }),
          ...(input.reviewerScore.total === undefined
            ? {}
            : { total: input.reviewerScore.total }),
        },
      }),
});

const toRuleInput = (rule: z.infer<typeof ruleSchema>): RuleInput => ({
  ...(rule.id === undefined ? {} : { id: rule.id }),
  ...(rule.aspect === undefined ? {} : { aspect: rule.aspect }),
  ...(rule.scope === undefined ? {} : { scope: rule.scope }),
  ...(rule.severity === undefined ? {} : { severity: rule.severity }),
  ...(rule.mechanization === undefined
    ? {}
    : { mechanization: rule.mechanization }),
  ...(rule.statement === undefined ? {} : { statement: rule.statement }),
  ...(rule.rationale === undefined ? {} : { rationale: rule.rationale }),
  ...(rule.archaeology === undefined ? {} : { archaeology: rule.archaeology }),
  ...(rule.appliesWhen === undefined
    ? {}
    : { appliesWhen: toProcedure(rule.appliesWhen) }),
  ...(rule.detect === undefined ? {} : { detect: toProcedure(rule.detect) }),
  ...(rule.violates === undefined
    ? {}
    : { violates: toProcedure(rule.violates) }),
  ...(rule.rubric === undefined
    ? {}
    : { rubric: rule.rubric.map(toRubricItem) }),
  ...(rule.verdictSpace === undefined
    ? {}
    : { verdictSpace: rule.verdictSpace }),
  ...(rule.evidence === undefined
    ? {}
    : { evidence: toEvidence(rule.evidence) }),
  ...(rule.fixtures === undefined
    ? {}
    : { fixtures: rule.fixtures.map(toFixture) }),
  ...(rule.acceptance === undefined
    ? {}
    : { acceptance: toAcceptance(rule.acceptance) }),
  ...(rule.retired === undefined ? {} : { retired: rule.retired }),
  ...(rule.decidedBy === undefined ? {} : { decidedBy: rule.decidedBy }),
});

export const registerCodexTools = (server: McpServer): void => {
  server.registerTool(
    "codex_rules_for",
    {
      title: "Rules that govern a scope and a file",
      description: [
        "Returns the current version of every rule whose aspect can apply to this scope and file, with fixtures, acceptance and an applicability result. Every appliesWhen check is run by the check DSL: a rule whose check proves it out of scope is excluded and listed under excluded, and a rule whose check cannot be run comes back with applicability.rule.evaluable false and a reason and is listed under unevaluated, so a mechanical rule never degrades into a silent pass.",
        "",
        "Args:",
        "- cwd (string): absolute path inside the project.",
        "- scope ('backend' | 'frontend', optional): limit to one half of the corpus. Omit for both.",
        "- filePath (string, optional): the test file under consideration, absolute or relative to cwd. Omit to skip the file-level checks.",
        "- page (object, optional): { list: 'rules' | 'excluded' | 'unevaluated', offset, limit } opens a window of one list.",
        "",
        "Returns: { projectKey: string, scope: string, filePath: string | null, aspects: AspectEntry[], rules: ListView, excluded: ListView, unevaluated: ListView }. Each ListView carries { total, groups by aspect, sample of the rule ids, handle, page?, items? } and the rules handle path is a JSON file holding every rule in full, with its fixtures and its applicability.",
        "",
        "Examples:",
        "- Use it before reviewing a test file, to learn every rule the file must answer to, then read the rules handle for their text.",
        "- Use it at the start of an operation to prove the scope has an accepted codex at all.",
        "- Do NOT use it to read one rule you already know the id of: call codex_rule_get, which is far smaller.",
        "- Do NOT use it to find what the codex is missing: call codex_gaps, which reports aspects with no rule and rules with no fixture.",
        "",
        "Truncation: the rule bodies live in the handle file rather than in the reply, so a wide scope no longer blows the 25000 character limit. A page is capped at 100 items.",
        "",
        "Error handling: an unresolvable cwd fails the call. A filePath that does not exist is not an error; the file-level checks come back unevaluable with the reason, and the rules still report.",
      ].join("\n"),
      inputSchema: rulesForInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ cwd, scope: ruleScope, filePath, page }) =>
      respondAsync(
        "Ask for one list at a time with page, and read the handle file for the rule bodies.",
        async () => {
          const governing = await rulesFor({ cwd, scope: ruleScope, filePath });
          return {
            projectKey: governing.projectKey,
            scope: governing.scope,
            filePath: governing.filePath,
            aspects: governing.aspects,
            rules: listView({
              kind: "codex-rules",
              items: governing.rules,
              label: (rule) => `${rule.id} v${rule.version} (${rule.aspect})`,
              group: (rule) => rule.aspect,
              page: pageFor("rules", page),
            }),
            excluded: listView({
              kind: "codex-rules-excluded",
              items: governing.excluded,
              label: (entry) => `${entry.ruleId}: ${entry.reason}`,
              page: pageFor("excluded", page),
            }),
            unevaluated: listView({
              kind: "codex-rules-unevaluated",
              items: governing.unevaluated,
              label: (entry) => `${entry.ruleId}: ${entry.reason}`,
              page: pageFor("unevaluated", page),
            }),
          };
        }
      )
  );

  server.registerTool(
    "codex_rule_get",
    {
      title: "One rule with its fixtures and acceptance",
      description: [
        "Returns one rule with its fixtures and its acceptance record. Reports the current version unless a version is named. Checks come back in the canonical check-DSL string form.",
        "",
        "Args:",
        "- cwd (string): absolute path inside the project.",
        "- ruleId (string): rule identifier.",
        "- version (integer >= 1, optional): a specific version; omit for the current one.",
        "",
        "Returns: { projectKey: string, ruleId: string, found: boolean, isCurrent?: boolean, latestVersion?: number | null, lastAcceptedVersion?: number | null, lastAcceptance?: { version, fixtures, nearMisses, reviewerScore, acceptedAt } | null, rule: RuleVersion | null }.",
        "",
        "Examples:",
        "- Use it to read the exact statement and rubric a verdict must cite.",
        "- Use it with version to compare what the rule said when a past verdict was reached.",
        "- Do NOT use it to list every version: call codex_history, which returns the whole line with dates and deciders.",
        "- Do NOT use it to find the rules that govern a file: call codex_rules_for.",
        "",
        "Error handling: an unknown ruleId is not an error; the call returns found false and rule null. A version that does not exist returns found false with latestVersion set, so the caller can see what does exist.",
      ].join("\n"),
      inputSchema: ruleGetInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ cwd, ruleId: id, version }) =>
      respondAsync(
        "Name a single ruleId. The result is one rule and cannot be narrowed further.",
        () => ruleGet({ cwd, ruleId: id, version })
      )
  );

  server.registerTool(
    "codex_rule_write",
    {
      title: "Append a new version of a rule",
      description: [
        "Appends a new version of a rule. The codex is append-only, so this never updates a prior row: it computes the next version number for the rule id, inserts fixtures that are not already recorded, and records the acceptance result for the new version. appliesWhen, detect and violates each carry a check-DSL string, 'grep:<pattern>' or 'ast:<expression>', or null when no check can decide.",
        "",
        "Args:",
        "- cwd (string): absolute path inside the project.",
        "- rule (object): rule document matching doctrine/rule.schema.json. Fields: id, aspect, scope, severity, mechanization, statement, rationale, archaeology, appliesWhen, detect, violates, rubric, verdictSpace, evidence, fixtures, acceptance, retired, decidedBy. version and createdAt are accepted and ignored so an exported rule can be written back unchanged.",
        "- decidedBy (string, optional): human, corpus, or an import origin.",
        "",
        "Returns: { projectKey: string, ruleId: string, version: number, previousVersion: number | null, rowId: number, fixturesAdded: number, acceptanceRecorded: boolean, appendOnly: true }.",
        "",
        "Examples:",
        "- Use it to freeze a rule a doctrine session has finished grilling.",
        "- Use it to correct a rule statement, which appends version n+1 and leaves version n auditable.",
        "- Do NOT use it to withdraw a rule: call codex_retire_rule, which appends a retired version with the reason.",
        "- Do NOT use it to restore an older wording: call codex_revert, which copies the target version forward for you.",
        "",
        "Error handling: a rule missing a required field fails the call naming the field, and nothing is written. A scope, severity or mechanization outside the allowed set is rejected by the schema before the use case runs.",
      ].join("\n"),
      inputSchema: ruleWriteInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    ({ cwd, rule, decidedBy }) =>
      respondAsync(
        "The result is one written version and cannot be narrowed. Send one rule per call.",
        () => ruleWrite({ cwd, rule: toRuleInput(rule), decidedBy })
      )
  );

  server.registerTool(
    "codex_revert",
    {
      title: "Copy an older rule version forward",
      description: [
        "Reverts a rule by appending a new version that copies the target version. History stays intact and no prior row is touched.",
        "",
        "Args:",
        "- cwd (string): absolute path inside the project.",
        "- ruleId (string): rule identifier.",
        "- toVersion (integer >= 1): the version to copy forward.",
        "- decidedBy (string, optional): who ordered the revert. Defaults to human.",
        "",
        "Returns: { projectKey: string, ruleId: string, revertedFrom: number, version: number, rowId: number }.",
        "",
        "Examples:",
        "- Use it when a rule edit made detection worse and test-replay proved it.",
        "- Do NOT use it to write a wording that never existed: call codex_rule_write.",
        "- Do NOT use it to see which version to go back to: call codex_history first.",
        "",
        "Error handling: a ruleId or toVersion that does not exist fails the call, and nothing is appended.",
      ].join("\n"),
      inputSchema: revertInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    ({ cwd, ruleId: id, toVersion, decidedBy }) =>
      respondAsync(
        "The result is one appended version and cannot be narrowed. Revert one rule per call.",
        () => revert({ cwd, ruleId: id, toVersion, decidedBy })
      )
  );

  server.registerTool(
    "codex_retire_rule",
    {
      title: "Retire a rule, append-only",
      description: [
        "Retires a rule by appending a new version marked retired, carrying the reason and the decider. Nothing is deleted and no prior row is changed, so the rule and every verdict it produced stay auditable. Retiring an already retired rule reports the standing retirement and appends nothing.",
        "",
        "Args:",
        "- cwd (string): absolute path inside the project.",
        "- ruleId (string): rule identifier.",
        "- reason (string): why the rule no longer holds.",
        "- decidedBy (string, optional): who ordered the retirement. Defaults to human.",
        "",
        "Returns: { projectKey: string, ruleId: string, retired: true, alreadyRetired: boolean, version: number, previousVersion?: number | null, rowId?: number, retiredAt: string, reason: string, appendOnly: true }.",
        "",
        "Examples:",
        "- Use it when a standard was dropped and its rule must stop blocking runs.",
        "- Do NOT use it to soften a rule that still holds: append an advisory version with codex_rule_write instead.",
        "- Do NOT use it to undo a bad edit: call codex_revert, which keeps the rule alive.",
        "",
        "Error handling: an unknown ruleId fails the call. A second retirement is not an error; it returns alreadyRetired true with the standing reason.",
      ].join("\n"),
      inputSchema: retireRuleInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ cwd, ruleId: id, reason, decidedBy }) =>
      respondAsync(
        "The result is one retirement and cannot be narrowed. Retire one rule per call.",
        () => retireRule({ cwd, ruleId: id, reason, decidedBy })
      )
  );

  server.registerTool(
    "codex_history",
    {
      title: "Every version of one rule",
      description: [
        "Returns every version of a rule with its date, decider, severity, mechanization, statement, retirement and acceptance record.",
        "",
        "Args:",
        "- cwd (string): absolute path inside the project.",
        "- ruleId (string): rule identifier.",
        "",
        "Returns: { projectKey: string, ruleId: string, currentVersion: number | null, versions: Array<{ version: number, scope: string, aspect: string, severity: string, mechanization: string, statement: string, decidedBy: string, createdAt: string, retired: { at, reason } | null, acceptance: { fixtures, nearMisses, reviewerScore, acceptedAt } | null }> }.",
        "",
        "Examples:",
        "- Use it to find the version a past verdict was reached under.",
        "- Use it before a revert, to choose the version worth copying forward.",
        "- Do NOT use it to read a rule in full: call codex_rule_get, which returns the procedures, rubric and fixtures.",
        "",
        "Error handling: an unknown ruleId is not an error; versions comes back empty with currentVersion null.",
      ].join("\n"),
      inputSchema: historyInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ cwd, ruleId: id }) =>
      respondAsync(
        "The result is the version line of one rule. Ask for a single ruleId.",
        () => history({ cwd, ruleId: id })
      )
  );

  server.registerTool(
    "codex_fixture_add",
    {
      title: "Label one corpus file as a fixture",
      description: [
        "Labels one real corpus file as a fixture for a rule and pins it by content hash, so a later edit to that file is visible instead of silently changing what the rule was accepted against. A near-miss is a file that almost violates the rule and must not be flagged; a rule with no near-miss has never been probed at its boundary.",
        "",
        "Args:",
        "- cwd (string): absolute path inside the project.",
        "- ruleId (string): rule the fixture belongs to.",
        "- filePath (string): corpus file to label, absolute or relative to cwd.",
        "- label ('follows' | 'violates' | 'not-applicable'): the verdict this file must receive from the rule.",
        "- isNearMiss (boolean, optional, default false): true when the file sits just outside the rule and must not be flagged.",
        "- why (string): why this file carries this label, in one sentence.",
        "- labelledBy (string): who labelled it.",
        "",
        "Returns: { projectKey: string, ruleId: string, ruleFound: boolean, ruleVersion: number | null, path: string, label: string, isNearMiss: boolean, pinnedHash: string, currentHash: string, added: boolean, alreadyPresent: boolean, hashDrifted: boolean, total: number, nearMissCount: number }.",
        "",
        "Examples:",
        "- Use it to pin the file that made the rule obvious, before accepting the rule.",
        "- Use it with isNearMiss true to pin the file that must not be flagged, which is what probes the boundary.",
        "- Do NOT use it to check which fixtures a rule already has: call codex_fixture_list.",
        "- Do NOT use it to score the rule over its fixtures: call codex_accept_rule.",
        "",
        "Error handling: an unreadable filePath fails the call with the resolved path. Adding the same path and label twice is not an error; it returns alreadyPresent true and adds nothing. A file whose content moved since it was pinned returns hashDrifted true.",
      ].join("\n"),
      inputSchema: fixtureAddInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ cwd, ruleId: id, filePath, label, isNearMiss, why, labelledBy }) =>
      respondAsync(
        "The result is one fixture and cannot be narrowed. Label one file per call.",
        () =>
          fixtureAdd({
            cwd,
            ruleId: id,
            filePath,
            label,
            isNearMiss,
            why,
            labelledBy,
          })
      )
  );

  server.registerTool(
    "codex_fixture_list",
    {
      title: "Fixtures of one rule, with drift",
      description: [
        "Returns every fixture of one rule with its label, why, labeller and pinned hash, plus a summary. A rule whose nearMissCount is zero has never been probed at its boundary. driftedCount reports fixtures whose file changed since it was pinned, and missingCount reports fixtures whose file is gone.",
        "",
        "Args:",
        "- cwd (string): absolute path inside the project.",
        "- ruleId (string): rule identifier.",
        "",
        "Returns: { projectKey: string, ruleId: string, fixtures: Array<{ path, hash, label, isNearMiss, why, labelledBy, createdAt, missing: boolean, currentHash: string | null, drifted: boolean }>, summary: { total: number, byLabel: Record<string, number>, nearMissCount: number, probedAtBoundary: boolean, driftedCount: number, missingCount: number } }.",
        "",
        "Examples:",
        "- Use it before accepting a rule, to see whether its boundary was ever probed.",
        "- Use it after a corpus change, to see which fixtures drifted away from what the rule was accepted against.",
        "- Do NOT use it to find rules with no fixture at all: call codex_gaps, which sweeps the whole scope.",
        "- Do NOT use it to add a fixture: call codex_fixture_add.",
        "",
        "Error handling: an unknown ruleId is not an error; fixtures comes back empty with a zeroed summary. A fixture whose file is missing is reported with missing true and currentHash null, not as a failure.",
      ].join("\n"),
      inputSchema: fixtureListInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ cwd, ruleId: id }) =>
      respondAsync(
        "The result is the fixture set of one rule. Ask for a single ruleId.",
        () => fixtureList({ cwd, ruleId: id })
      )
  );

  server.registerTool(
    "codex_accept_rule",
    {
      title: "Freeze a rule version with its score",
      description: [
        "Freezes one rule version with its reviewer score over the labelled fixtures. Acceptance is refused, with the reason returned rather than thrown, when scorePassed is below scoreTotal, when scoreTotal is zero, or when the version is retired or absent: a rule that misses one labelled file will miss real ones.",
        "",
        "Args:",
        "- cwd (string): absolute path inside the project.",
        "- ruleId (string): rule identifier.",
        "- ruleVersion (integer >= 1): the version being frozen.",
        "- scorePassed (integer >= 0): labelled files the rule decided correctly.",
        "- scoreTotal (integer >= 0): labelled files the rule was scored against.",
        "",
        "Returns on acceptance: { projectKey, ruleId, ruleVersion, accepted: true, alreadyAccepted: boolean, fixtures: number, nearMisses: number, reviewerScore: { passed, total }, acceptedAt: string, boundaryProbed: boolean }. Returns on refusal: { projectKey, ruleId, ruleVersion, accepted: false, reason: string }.",
        "",
        "Examples:",
        "- Use it as the last step of a doctrine session, once the rule decided every labelled file correctly.",
        "- Do NOT use it to record the fixtures themselves: call codex_fixture_add first.",
        "- Do NOT read accepted false as a failed call: it is a refusal with the reason, and the call succeeded.",
        "",
        "Error handling: a partial score, a zero total, a retired version or a missing version all come back as accepted false with the reason. Accepting the same version twice returns alreadyAccepted true.",
      ].join("\n"),
      inputSchema: acceptRuleInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ cwd, ruleId: id, ruleVersion, scorePassed, scoreTotal }) =>
      respondAsync(
        "The result is one acceptance and cannot be narrowed. Accept one rule version per call.",
        () =>
          acceptRule({ cwd, ruleId: id, ruleVersion, scorePassed, scoreTotal })
      )
  );

  server.registerTool(
    "codex_taxonomy_set",
    {
      title: "Add or override an aspect for this project",
      description: [
        "Records an aspect this project adds beyond the seed taxonomy, or overrides the appliesWhen sentence and blocking bar of a seed aspect for this project. One row per scope and aspect, so writing the same pair again updates it.",
        "",
        "Args:",
        "- cwd (string): absolute path inside the project.",
        "- scope ('backend' | 'frontend'): half of the corpus the aspect governs.",
        "- aspect (string): lowercase hyphen-separated aspect id.",
        "- appliesWhen (string): the sentence that decides whether this aspect governs a file.",
        "- blockingBar (string): evidence bar a rule of this aspect must meet - low, majority or near-total.",
        "",
        "Returns: { projectKey: string, scope: string, aspect: string, appliesWhen: string, blockingBar: string, created: boolean, updated: boolean, source: string }.",
        "",
        "Examples:",
        "- Use it when a project has a standard the seed taxonomy has no aspect for.",
        "- Use it to tighten a seed aspect's appliesWhen sentence for this repository only.",
        "- Do NOT use it to write the rule itself: an aspect only says what a rule of that kind must clear. Call codex_rule_write.",
        "- Do NOT use it to see which aspects exist: call codex_aspects.",
        "",
        "Error handling: a scope outside backend and frontend is rejected by the schema. Writing the same scope and aspect again is not an error; it returns updated true.",
      ].join("\n"),
      inputSchema: taxonomySetInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ cwd, scope: aspectScope, aspect, appliesWhen, blockingBar }) =>
      respondAsync(
        "The result is one aspect row and cannot be narrowed. Set one aspect per call.",
        () =>
          taxonomySet({
            cwd,
            scope: aspectScope,
            aspect,
            appliesWhen,
            blockingBar,
          })
      )
  );

  server.registerTool(
    "codex_gaps",
    {
      title: "What the codex is missing",
      description: [
        "The freeze-time inspection of a scope: aspects with no rule, rules with no fixture, rules with no near-miss, and rules whose current version was never accepted. Each entry carries the reason it is a gap, so an uncovered aspect is visible instead of passing silently. Whether an aspect applies to real files is a human judgement from its appliesWhen sentence, which is returned with every entry.",
        "",
        "Args:",
        "- cwd (string): absolute path inside the project.",
        "- scope ('backend' | 'frontend', optional): limit the sweep to one half of the corpus. Omit for both.",
        "- page (object, optional): { list: 'aspectsWithoutRule' | 'rulesWithoutFixtures' | 'rulesWithoutNearMiss' | 'rulesNotAccepted', offset, limit } opens a window of one list.",
        "",
        "Returns: { projectKey: string, scope: string, summary: { aspectsWithoutRule: number, rulesWithoutFixtures: number, rulesWithoutNearMiss: number, rulesNotAccepted: number, clear: boolean }, aspectsWithoutRule: ListView, rulesWithoutFixtures: ListView, rulesWithoutNearMiss: ListView, rulesNotAccepted: ListView }. Each ListView carries { total, sample, handle, page?, items? } and its handle path is a JSON file holding every gap with its reason.",
        "",
        "Examples:",
        "- Use it as the first call of an operation, to refuse to run when the scope has no accepted rule.",
        "- Use it at the end of a doctrine session, to prove the codex is ready to freeze.",
        "- Do NOT use it to read the rules that do exist: call codex_rules_for.",
        "- Do NOT use it to check one rule's fixtures: call codex_fixture_list.",
        "",
        "Truncation: the four lists come back as bounded summaries, so a wide taxonomy no longer blows the 25000 character limit. A page is capped at 100 items and the handle file is the lossless copy.",
        "",
        "Error handling: an unresolvable cwd fails the call. An empty codex is not an error; every aspect is reported under aspectsWithoutRule with summary.clear false.",
      ].join("\n"),
      inputSchema: gapsInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ cwd, scope: gapScope, page }) =>
      respondAsync(
        "Ask for one list at a time with page, and read the handle file for everything else.",
        async () => {
          const missing = await gaps({ cwd, scope: gapScope });
          return {
            projectKey: missing.projectKey,
            scope: missing.scope,
            summary: missing.summary,
            aspectsWithoutRule: listView({
              kind: "codex-aspects-without-rule",
              items: missing.aspectsWithoutRule,
              label: (entry) => `${entry.aspect}: ${entry.reason}`,
              page: pageFor("aspectsWithoutRule", page),
            }),
            rulesWithoutFixtures: listView({
              kind: "codex-rules-without-fixtures",
              items: missing.rulesWithoutFixtures,
              label: (entry) => `${entry.ruleId}: ${entry.reason}`,
              page: pageFor("rulesWithoutFixtures", page),
            }),
            rulesWithoutNearMiss: listView({
              kind: "codex-rules-without-near-miss",
              items: missing.rulesWithoutNearMiss,
              label: (entry) => `${entry.ruleId}: ${entry.reason}`,
              page: pageFor("rulesWithoutNearMiss", page),
            }),
            rulesNotAccepted: listView({
              kind: "codex-rules-not-accepted",
              items: missing.rulesNotAccepted,
              label: (entry) => `${entry.ruleId}: ${entry.reason}`,
              page: pageFor("rulesNotAccepted", page),
            }),
          };
        }
      )
  );

  server.registerTool(
    "codex_export",
    {
      title: "Read the codex out as a portable payload",
      description: [
        "Reads the current codex out as a portable payload: the project aspects plus every current rule with its fixtures and acceptance. Checks come out in the canonical check-DSL string form, so the payload can be written back without loss.",
        "",
        "Args:",
        "- cwd (string): absolute path inside the project.",
        "- scope ('backend' | 'frontend', optional): export one half of the corpus. Omit for both.",
        "",
        "Returns: { schemaVersion: number, exportedAt: string, project: { key: string, shortName: string, remoteUrl: string | null }, scope: string, aspects: Array<{ id, scope, appliesWhen, blockingBar }>, rules: RuleVersion[] }.",
        "",
        "Examples:",
        "- Use it to carry a codex to a sibling repository, then feed the payload to codex_import there.",
        "- Use it to snapshot the codex before a doctrine session rewrites rules.",
        "- Do NOT use it to read one rule: call codex_rule_get.",
        "- Do NOT use it to judge whether the codex is complete: call codex_gaps.",
        "",
        "Truncation: a full codex with every rule, fixture and evidence citation very often exceeds the 25000 character limit; the text is cut with a TRUNCATED notice and the structured content reports the true size. Narrow the result by passing scope, and export backend and frontend in two calls.",
        "",
        "Error handling: an unresolvable cwd fails the call. An empty codex is not an error; rules comes back empty.",
      ].join("\n"),
      inputSchema: exportInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ cwd, scope: exportScope }) =>
      respondAsync(
        "Pass scope and export backend and frontend in two calls instead of one.",
        () => exportCodex({ cwd, scope: exportScope })
      )
  );

  server.registerTool(
    "codex_import",
    {
      title: "Read another corpus's codex into this project",
      description: [
        "Reads a codex payload from another corpus into this project, appending a version of every rule it carries and adding any aspect this project does not have. Every rule is forced to advisory severity when markAdvisory is true, which is the default, because the evidence behind it came from a different corpus.",
        "",
        "Args:",
        "- cwd (string): absolute path inside the project.",
        "- payload (object | array | string): an export payload from codex_export, as an object or a JSON string.",
        "- markAdvisory (boolean, optional, default true): force every imported rule to advisory severity.",
        "",
        "Returns: { projectKey: string, origin: string, markAdvisory: boolean, aspectsAdded: number, rulesImported: number, rules: Array<{ ruleId: string, version: number, severity: string }> }.",
        "",
        "Examples:",
        "- Use it to seed a new repository from a codex that was already grilled somewhere else.",
        "- Do NOT use it to write one rule you composed by hand: call codex_rule_write.",
        "- Do NOT trust an import as accepted doctrine: the imported rules are advisory until codex_accept_rule scores them against this corpus.",
        "",
        "Error handling: a payload string that is not valid JSON fails the call with the parser message. A payload with no rules key is not an error; rulesImported comes back 0. A rule inside the payload that is missing a required field fails the call naming the field, and the whole import is rolled back.",
      ].join("\n"),
      inputSchema: importInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    ({ cwd, payload, markAdvisory }) =>
      respondAsync(
        "The result is a summary of one import and cannot be narrowed. Import one payload per call.",
        () => importCodex({ cwd, payload, markAdvisory })
      )
  );

  server.registerTool(
    "codex_aspects",
    {
      title: "The aspect taxonomy with staleness",
      description: [
        "The seed aspect taxonomy merged with this project's taxonomy extensions, with the rule count and a staleness flag per aspect. An aspect is stale when it has never been swept, or when the supplied corpus hash differs from the hash stored at the last sweep.",
        "",
        "Args:",
        "- cwd (string): absolute path inside the project.",
        "- scope ('backend' | 'frontend', optional): limit to one half of the corpus. Omit for both.",
        "- corpusHashes (object mapping string to string, optional): aspect id, or 'scope:aspect', to the current corpus hash from ast_corpus_hash. Omit to skip the comparison, which leaves every never-swept aspect stale.",
        "",
        "Returns: { projectKey: string, scope: string, blockingBars: Record<string, { label, meaning, reason }>, aspects: Array<{ id, scope, title, appliesWhen, blockingBar, governs, rationale, source, ruleCount: number, sampledCorpusHash: string | null, sampledAt: string | null, currentCorpusHash: string | null, stale: boolean, staleReason: string }>, staleCount: number }.",
        "",
        "Examples:",
        "- Use it to open a doctrine session, to see which aspects the corpus has moved under.",
        "- Use it with corpusHashes from ast_corpus_hash to prove a past sweep still holds.",
        "- Do NOT use it to learn which aspects have no rule: call codex_gaps, which names the gap and its reason.",
        "- Do NOT use it to record a fresh sweep: call codex_corpus_mark.",
        "",
        "Error handling: an unresolvable cwd fails the call. A corpusHashes key that matches no aspect is ignored rather than failing.",
      ].join("\n"),
      inputSchema: aspectsInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ cwd, scope: aspectScope, corpusHashes }) =>
      respondAsync(
        "Pass scope to list one half of the taxonomy instead of both.",
        () => aspects({ cwd, scope: aspectScope, corpusHashes })
      )
  );

  server.registerTool(
    "codex_corpus_mark",
    {
      title: "Record the corpus a sweep read",
      description: [
        "Records the corpus hash sampled for one aspect, so codex_aspects can tell later whether the sweep went stale.",
        "",
        "Args:",
        "- cwd (string): absolute path inside the project.",
        "- scope ('backend' | 'frontend'): half of the corpus the sweep covered.",
        "- aspect (string): the aspect the sweep covered.",
        "- corpusHash (string): the hash of the corpus that was read, from ast_corpus_hash.",
        "",
        "Returns: { projectKey: string, scope: string, aspect: string, corpusHash: string, sampledAt: string | null }.",
        "",
        "Examples:",
        "- Use it right after sweeping an aspect, so the next session knows what the sweep saw.",
        "- Do NOT use it to compute the hash: call ast_corpus_hash and pass its hash here.",
        "- Do NOT use it to judge staleness: call codex_aspects with corpusHashes.",
        "",
        "Error handling: a scope outside backend and frontend is rejected by the schema. Marking the same aspect again overwrites the stored hash and is not an error.",
      ].join("\n"),
      inputSchema: corpusMarkInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ cwd, scope: markScope, aspect, corpusHash }) =>
      respondAsync(
        "The result is one mark and cannot be narrowed. Mark one aspect per call.",
        () => corpusMark({ cwd, scope: markScope, aspect, corpusHash })
      )
  );
};
