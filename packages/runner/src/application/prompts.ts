import { PREDICATE_KEY_OF } from "../domain/cycle.ts";
import type { CycleAssignment, WorkGroup, WorkRef } from "../domain/cycle.ts";
import { RUNNER_TOOLS } from "./tool-refs.ts";
import { PREDICATE_IDS, PREDICATE_NAMES } from "test-forge-contracts/gates";
import type { DoneVector } from "test-forge-contracts/gates";
import type { Project, Scope } from "test-forge-contracts/project";

const MAX_REFS = 20;

export type UnitSummary = {
  filePath: string;
  authorCallsign: string | null;
  state: string;
};

export type CycleFacts = {
  cycle: number;
  runId: number;
  cwd: string;
  passes: number;
  passStalled: boolean;
  openFindings: number;
  survivingMutants: number;
  pendingMutants: number;
  units: readonly UnitSummary[];
};

export type OpeningFacts = {
  operation: string;
  focus: string;
  scope: Scope;
  targets: readonly string[];
  runId: number;
  project: Project;
  cwd: string;
  approved: boolean;
};

export const vectorLine = (vector: DoneVector): string =>
  PREDICATE_IDS.map(
    (id) =>
      `${id} ${PREDICATE_NAMES[id]} ${
        vector[PREDICATE_KEY_OF[id]] ? "true" : "FALSE"
      }`
  ).join("  |  ");

const refLine = (reference: WorkRef): string =>
  reference.location.length > 0 && reference.location !== reference.ref
    ? `${reference.ref} (${reference.location})`
    : reference.ref;

const groupLines = (group: WorkGroup): string => {
  const shown = group.refs.slice(0, MAX_REFS).map(refLine);
  const hidden = group.refs.length - shown.length;
  const more = hidden > 0 ? `\n    (+${hidden} more)` : "";
  return `- ${group.predicate}: ${group.reason}\n    ${shown.join(
    "\n    "
  )}${more}`;
};

export const workLines = (groups: readonly WorkGroup[]): string =>
  groups.length === 0
    ? "No outstanding item is recorded against any predicate."
    : groups.map(groupLines).join("\n");

const unitLines = (units: readonly UnitSummary[]): string =>
  units.length === 0
    ? "No unit is assigned yet."
    : units
        .map(
          (unit) =>
            `- ${unit.filePath} - ${unit.authorCallsign ?? "unassigned"} - ${
              unit.state
            }`
        )
        .join("\n");

export const openingPrompt = ({
  operation,
  focus,
  scope,
  targets,
  runId,
  project,
  cwd,
  approved,
}: OpeningFacts): string => `You are Commander Sarah Palmer. This is a HEADLESS Test Forge operation: Captain Lasky
is not at the console while a cycle runs. Anything you would normally ask him in
conversation must instead become a BLOCKED exit carrying one precise question.

Project: ${project.projectKey} (${project.shortName})
Repository root: ${project.rootPath}
Scope: ${scope}
Run id: ${runId} - ${
  RUNNER_TOOLS.ledgerRunStart
} already opened this run and already loaded the focus
lines as D9 items. Do not call ${RUNNER_TOOLS.ledgerRunStart} again.

Every Roland tool call takes cwd: "${cwd}".

Captain Lasky asked for:
<<<OPERATION
${operation}
OPERATION

The run focus, verbatim:
<<<FOCUS
${focus}
FOCUS

Target paths:
${
  targets.length > 0
    ? targets.map((path) => `- ${path}`).join("\n")
    : "- none named; derive them from the focus"
}

Invoke the test-forge skill and follow it. Spawn every squad through the Agent tool,
naming the subagent by its callsign in lower case with dashes - jai-006, linda-058,
john-117, locke, carter-a259, jonah, parangosky. One Spartan owns one file. One
Inspector holds one rule against one file.

${
  approved
    ? `Captain Lasky approved the plan on the command line. Work phase 1 to produce the
matrix, the closure and the aspect list, then continue into phase 2 and keep going.
You do not stop to ask permission to spawn.`
    : `Captain Lasky has NOT approved a plan. THIS CYCLE PRODUCES THE PLAN AND NOTHING ELSE.
Read-only phase 1 work is permitted - Linda-058, Samuel-034, ${RUNNER_TOOLS.closureUnresolved},
${RUNNER_TOOLS.codexRulesFor}, ${RUNNER_TOOLS.codexRuleGet}. Then present the plan in full and stop. Spawn no author,
write no test, post no verdict, and do not close the run. End your turn with the plan and
the line "PLAN READY FOR APPROVAL".`
}

Close every cycle the way the skill says: ${
  RUNNER_TOOLS.gatesEvaluate
} for the done vector and the work
list, then ${RUNNER_TOOLS.ledgerPassRecord} for this run, then the pass JSON. ${
  RUNNER_TOOLS.gatesEvaluate
} owns the
vector - never assemble one yourself and never hand one to ${
  RUNNER_TOOLS.ledgerPassRecord
}.`;

export const cyclePrompt = (
  facts: CycleFacts,
  vector: DoneVector,
  assignment: CycleAssignment
): string => `Cycle ${facts.cycle} of run ${
  facts.runId
}. This is the ledger, not a summary: Roland
computed it from recorded rows, so it outranks your memory of the last cycle.

Done vector, as ${RUNNER_TOOLS.gatesEvaluate} returned it just now:
${vectorLine(vector)}
False predicates: ${
  assignment.failing.length > 0 ? assignment.failing.join(", ") : "none"
}
Passes recorded: ${facts.passes}${
  facts.passStalled ? " - the last two passes carry an IDENTICAL vector" : ""
}

Work list:
${workLines(assignment.groups)}

Units:
${unitLines(facts.units)}

Findings still open: ${facts.openFindings}
Mutants surviving unexplained: ${facts.survivingMutants}; pending: ${
  facts.pendingMutants
}

Every Roland tool call takes cwd: "${facts.cwd}".

Assign only the false predicates, only to the squad that owns each one, only on the
items listed above. Never re-open a true predicate. Never task two squads on one item.
Then call ${
  RUNNER_TOOLS.gatesEvaluate
} for the fresh vector and work list, call ${RUNNER_TOOLS.ledgerPassRecord} for
this run without handing it a vector, and emit the pass JSON.

If a work item cannot advance without Captain Lasky, call ${
  RUNNER_TOOLS.ledgerRunEnd
} with exitKind
BLOCKED and ONE precise question: the fact that forced it, the options as (a), (b), (c),
and what each costs. If the vector is identical to the previous pass a second time, call
${RUNNER_TOOLS.ledgerRunEnd} with exitKind STALLED. If all ten are true, call ${
  RUNNER_TOOLS.ledgerRunEnd
} with
exitKind DONE.`;
