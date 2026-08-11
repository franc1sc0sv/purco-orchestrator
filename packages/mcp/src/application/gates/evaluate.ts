import { doneVectorOf, gateRows, workList } from "../../domain/gates/gates.ts";
import { evaluatePredicates } from "../../domain/gates/predicates.ts";
import { resolveProject } from "../../infrastructure/project.ts";
import { flakeProbe } from "../execution/flake-probe.ts";
import { gateStatic } from "../execution/gate-static.ts";
import { execSuite } from "../execution/run-suite.ts";
import { passRecord } from "../ledger/pass-record.ts";
import {
  gatherEvidence,
  openGateEvidence,
  recordEvidence,
  repoRelative,
  runUnits,
} from "./evidence.ts";
import type {
  DoneVector,
  GateResult,
  WorkItem,
} from "test-forge-contracts/gates";

export type GateCommands = {
  test?: string;
  typecheck?: string;
  lint?: string;
};

export type ProbeRequest = {
  repeats?: number;
  seed?: number;
};

export type EvaluateGatesOptions = {
  cwd: string;
  runId: number;
  commands?: GateCommands;
  files?: readonly string[];
  probe?: ProbeRequest;
  timeoutMs?: number;
};

export type CollectedStatic = { ok: boolean; errors: number };

export type CollectedSuite = {
  reportParsed: boolean;
  passed: number | null;
  failed: number | null;
};

export type CollectedFlake = { stable: boolean; divergences: number };

export type CollectedEvidence = {
  static?: CollectedStatic;
  suite?: CollectedSuite;
  flake?: CollectedFlake;
};

export type GatesEvaluation = {
  projectKey: string;
  runId: number;
  passNo: number;
  collected: CollectedEvidence;
  predicates: DoneVector;
  gates: GateResult[];
  workList: WorkItem[];
  allTrue: boolean;
  stalled: boolean;
};

export const evaluateGates = async ({
  cwd,
  runId,
  commands = {},
  files,
  probe,
  timeoutMs,
}: EvaluateGatesOptions): Promise<GatesEvaluation> => {
  const db = openGateEvidence();
  const { projectKey, rootPath } = await resolveProject(cwd);
  const targets = (
    files !== undefined && files.length > 0 ? files : runUnits(db, runId)
  ).map((file) => repoRelative(rootPath, file));

  const collected: CollectedEvidence = {};

  if (commands.typecheck !== undefined || commands.lint !== undefined) {
    const result = await gateStatic({
      cwd,
      ...(commands.typecheck === undefined
        ? {}
        : { typecheckCommand: commands.typecheck }),
      ...(commands.lint === undefined ? {} : { lintCommand: commands.lint }),
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    });
    recordEvidence({
      db,
      projectKey,
      runId,
      kind: "static",
      unitPath: "",
      ok: result.ok,
      detail: {
        ok: result.ok,
        ran: result.ran,
        totalErrors: result.totalErrors,
        totalWarnings: result.totalWarnings,
        problems: [
          ...(result.typecheck?.problems ?? []),
          ...(result.lint?.problems ?? []),
        ],
      },
    });
    collected.static = { ok: result.ok, errors: result.totalErrors };
  }

  if (commands.test !== undefined) {
    const result = await execSuite({
      cwd,
      command: commands.test,
      files: targets,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
    });
    recordEvidence({
      db,
      projectKey,
      runId,
      kind: "suite",
      unitPath: "",
      ok: result.reportParsed && result.failed === 0,
      detail: {
        command: result.command,
        family: result.family,
        exitCode: result.exitCode,
        reportParsed: result.reportParsed,
        reportError: result.reportError,
        passed: result.passed,
        failed: result.failed,
        skipped: result.skipped,
        failures: result.failures,
        tests: result.tests,
      },
    });
    collected.suite = {
      reportParsed: result.reportParsed,
      passed: result.passed,
      failed: result.failed,
    };

    if (probe !== undefined) {
      const flake = await flakeProbe({
        cwd,
        command: commands.test,
        files: targets,
        ...(probe.repeats === undefined ? {} : { repeats: probe.repeats }),
        ...(probe.seed === undefined ? {} : { seed: probe.seed }),
        ...(timeoutMs === undefined ? {} : { timeoutMs }),
      });
      recordEvidence({
        db,
        projectKey,
        runId,
        kind: "flake",
        unitPath: "",
        ok: flake.stable,
        detail: {
          stable: flake.stable,
          repeats: flake.repeats,
          seed: flake.seed,
          countsDiverge: flake.countsDiverge,
          divergences: flake.divergences,
          unparsedRuns: flake.unparsedRuns,
        },
      });
      collected.flake = {
        stable: flake.stable,
        divergences: flake.divergences.length,
      };
    }
  }

  const table = evaluatePredicates(
    await gatherEvidence({ cwd, runId, projectKey, rootPath }),
  );
  const predicates = doneVectorOf(table);
  const recorded = await passRecord({ cwd, runId, predicates });

  return {
    projectKey,
    runId,
    passNo: recorded.passNo,
    collected,
    predicates,
    gates: gateRows(table),
    workList: workList(table),
    allTrue: recorded.allGreen,
    stalled: recorded.stalled,
  };
};
