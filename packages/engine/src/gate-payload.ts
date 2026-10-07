import type { ForgeScope, Unit } from "./forge-units.ts";

export type TestMode = "write" | "harden";

export type PlanGateWarningCode =
  | "mapper-no-result"
  | "focus-none"
  | "non-usecase-files"
  | "radius-unresolved-majority";

export type PlanGateWarning = { code: PlanGateWarningCode; message: string };

export type PlanGateUnit = {
  file: string;
  rows: number;
  sources: string[];
  focusLines: number[];
  usecaseLevel: boolean;
};

export type PlanGatePayload = {
  type: "test-plan";
  ticket: string;
  runId: number;
  scope: ForgeScope;
  mode: TestMode;
  depth: "full" | "quick";
  size: string | null;
  contract: string;
  units: PlanGateUnit[];
  radius: { total: number; unresolved: number };
  warnings: PlanGateWarning[];
};

const USECASE_TEST = /(^|[/])tests[/](?:.*[/])?usecases[/]/;

const RADIUS_UNRESOLVED_LIMIT = 0.5;

export const isUsecaseTest = (file: string, scope: ForgeScope): boolean =>
  scope === "frontend" || USECASE_TEST.test(file);

export const planGatePayload = (input: {
  ticket: string;
  runId: number;
  scope: ForgeScope;
  mode: TestMode;
  depth: "full" | "quick";
  size: string | null;
  contract: string;
  units: readonly Unit[];
  radius: { total: number; unresolved: number };
  mapperDelivered: boolean;
}): PlanGatePayload => {
  const units = input.units.map((unit) => ({
    file: unit.file,
    rows: unit.rows.length,
    sources: unit.sources,
    focusLines: unit.focusLines,
    usecaseLevel: isUsecaseTest(unit.file, input.scope),
  }));
  const warnings: PlanGateWarning[] = [];
  if (!input.mapperDelivered) {
    warnings.push({ code: "mapper-no-result", message: "The mapper ended with no accepted result." });
  }
  if (units.length > 0 && units.every((unit) => unit.focusLines.length === 0)) {
    warnings.push({ code: "focus-none", message: "No unit has a focus line." });
  }
  const notUsecase = units.filter((unit) => !unit.usecaseLevel);
  if (notUsecase.length > 0) {
    warnings.push({
      code: "non-usecase-files",
      message: `${notUsecase.length} planned file(s) are not usecase-level tests.`,
    });
  }
  if (
    input.radius.total > 0 &&
    input.radius.unresolved / input.radius.total > RADIUS_UNRESOLVED_LIMIT
  ) {
    warnings.push({
      code: "radius-unresolved-majority",
      message: `${input.radius.unresolved} of ${input.radius.total} radius nodes are unresolved.`,
    });
  }
  return {
    type: "test-plan",
    ticket: input.ticket,
    runId: input.runId,
    scope: input.scope,
    mode: input.mode,
    depth: input.depth,
    size: input.size,
    contract: input.contract,
    units,
    radius: input.radius,
    warnings,
  };
};
