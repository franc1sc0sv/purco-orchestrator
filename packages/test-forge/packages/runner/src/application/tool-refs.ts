import type { ToolName } from "test-forge-contracts/tool-names";

export const RUNNER_TOOLS = {
  gatesEvaluate: "gates_evaluate",
  ledgerRunStart: "ledger_run_start",
  ledgerRunEnd: "ledger_run_end",
  ledgerPassRecord: "ledger_pass_record",
  ledgerState: "ledger_state",
  closureUnresolved: "closure_unresolved",
  codexRulesFor: "codex_rules_for",
  codexRuleGet: "codex_rule_get",
} as const satisfies Record<string, ToolName>;
