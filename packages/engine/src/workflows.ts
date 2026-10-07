import type { Phase } from "./types.ts";

export const WORKFLOW_NAMES = ["ticket", "spike", "test"] as const;

export type WorkflowName = (typeof WORKFLOW_NAMES)[number];

export type Workflow = {
  name: WorkflowName;
  phases: Phase[];
  gatesAfter: Phase[];
  judged: Phase[];
  maxReruns: number;
};

export const WORKFLOWS: Record<WorkflowName, Workflow> = {
  ticket: {
    name: "ticket",
    phases: [
      "intake",
      "grill",
      "plan",
      "build",
      "static",
      "test",
      "verify",
      "record",
      "review",
    ],
    gatesAfter: ["intake", "plan"],
    judged: ["test", "verify", "review"],
    maxReruns: 2,
  },
  spike: {
    name: "spike",
    phases: ["survey", "audit", "synthesize"],
    gatesAfter: [],
    judged: [],
    maxReruns: 0,
  },
  test: {
    name: "test",
    phases: ["test"],
    gatesAfter: [],
    judged: [],
    maxReruns: 0,
  },
};

export const MAX_GATE_REVISIONS = 3;

export const isWorkflowName = (value: string): value is WorkflowName =>
  (WORKFLOW_NAMES as readonly string[]).includes(value);
