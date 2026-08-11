import { closureCompute } from "../../application/closure/compute.ts";
import { closureResolveBatch } from "../../application/closure/resolve-batch.ts";
import { closureResolve } from "../../application/closure/resolve.ts";
import { closureUnresolved } from "../../application/closure/unresolved.ts";
import { listView } from "../../application/listing/list-view.ts";
import { listPageInput, pageFor, pageInput } from "../page.ts";
import { respondAsync } from "../response.ts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { Resolution } from "test-forge-contracts/closure";
import { z } from "zod";

const existingTestResolution = z
  .object({
    kind: z
      .literal("existing-test")
      .describe("The node is already covered by a test that exists today."),
    testFile: z
      .string()
      .describe("Test file holding the citation, absolute or relative to cwd."),
    testName: z
      .string()
      .describe(
        "Exact test title inside that file. It is read back from the file and rejected when absent."
      ),
    verifiedBy: z
      .string()
      .describe("Who verified the citation. Defaults to roland:citation-check.")
      .optional(),
  })
  .strict();

const newCaseResolution = z
  .object({
    kind: z
      .literal("new-case")
      .describe("The node will be covered by a test still to be written."),
    testRef: z
      .string()
      .describe("Reference of the planned test, for example file::title.")
      .optional(),
  })
  .strict();

const waivedResolution = z
  .object({
    kind: z
      .literal("waived")
      .describe("The node is deliberately left uncovered."),
    reason: z.string().describe("Why the node needs no coverage."),
    signedBy: z.string().describe("Who signed the waiver."),
  })
  .strict();

const resolutionInput = z
  .discriminatedUnion("kind", [
    existingTestResolution,
    newCaseResolution,
    waivedResolution,
  ])
  .describe("How this node is accounted for.");

type ResolutionInput = z.infer<typeof resolutionInput>;

const closureComputeInput = z
  .object({
    cwd: z.string().describe("Absolute path of the repository root."),
    entryFiles: z
      .array(z.string())
      .describe("Files under test, repository relative or absolute."),
    runId: z
      .number()
      .int()
      .describe("Run to persist the nodes into, so D8 can be checked later.")
      .optional(),
    page: listPageInput.optional(),
  })
  .strict();

const closureResolveInput = z
  .object({
    cwd: z.string().describe("Absolute path of the repository root."),
    runId: z.number().int().describe("Run that owns the node."),
    nodeId: z
      .string()
      .describe("Node identifier from closure_compute, shaped kind:path."),
    resolution: resolutionInput,
  })
  .strict();

const closureResolveBatchInput = z
  .object({
    cwd: z.string().describe("Absolute path of the repository root."),
    runId: z.number().int().describe("Run that owns the nodes."),
    resolutions: z
      .array(
        z
          .object({
            nodeId: z
              .string()
              .describe(
                "Node identifier from closure_compute, shaped kind:path."
              ),
            resolution: resolutionInput,
          })
          .strict()
      )
      .min(1)
      .describe(
        "Every node you are accounting for, in one call. The whole worklist from closure_unresolved belongs here."
      ),
    page: listPageInput.optional(),
  })
  .strict();

const closureUnresolvedInput = z
  .object({
    cwd: z.string().describe("Absolute path of the repository root."),
    runId: z.number().int().describe("Run whose nodes are counted."),
    page: pageInput.optional(),
  })
  .strict();

const toResolution = (input: ResolutionInput): Resolution => {
  if (input.kind === "existing-test") {
    return {
      kind: "existing-test",
      testFile: input.testFile,
      testName: input.testName,
      ...(input.verifiedBy === undefined
        ? {}
        : { verifiedBy: input.verifiedBy }),
    };
  }
  if (input.kind === "new-case") {
    return {
      kind: "new-case",
      ...(input.testRef === undefined ? {} : { testRef: input.testRef }),
    };
  }
  return { kind: "waived", reason: input.reason, signedBy: input.signedBy };
};

export const registerClosureTools = (server: McpServer): void => {
  server.registerTool(
    "closure_compute",
    {
      title: "Compute the effect closure of the entry files",
      description: [
        "Indexes the repository sources and walks out from the entry files to everything their change can reach: direct callers, consumers of every table the entries write, transitive event handlers, transitive callers when the entry is a shared symbol, external side effects, and the frontend crossing in both directions through routers, hooks, components and routes. It never samples.",
        "",
        "Args:",
        "- cwd (string): absolute path of the repository root.",
        "- entryFiles (string[]): files under test, repository relative or absolute.",
        "- runId (integer, optional): run to persist the nodes into. Without it nothing is written.",
        "- page (object, optional): { list: 'nodes' | 'edges', offset, limit } opens a window of one list. Omit it and only the summaries come back.",
        "",
        "Returns: { counts: { nodes, edges, byKind, maxHops, indexedFiles }, nodes: ListView, edges: ListView }. A ListView is { total, groups: Array<{ key, count }>, sample: string[], handle: { handleId, path, itemCount, bytes }, page?, items? } and the handle path is a JSON file holding every item, so nothing is lost when the items are not inlined.",
        "",
        "Examples:",
        "- Use it at the start of a run to learn everything a change to the entry files can break.",
        "- Use it with runId so closure_resolve_batch and closure_unresolved can account for each node afterwards.",
        "- Use counts and groups to size the radius, and read the handle file when you need every node.",
        "- Do NOT use it to ask which nodes are still open: call closure_unresolved, which reads the persisted run.",
        "- Do NOT use it to account for nodes: call closure_resolve_batch with the whole worklist in one call.",
        "",
        "Truncation: the summaries are bounded, so the result stays inside the 25000 character limit whatever the graph size. A page is capped at 100 items and the handle file is the lossless copy.",
        "",
        "Error handling: an entry file that cannot be read still becomes an entry node, it simply reaches nothing. A bad cwd fails the call.",
      ].join("\n"),
      inputSchema: closureComputeInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ cwd, entryFiles, runId, page }) =>
      respondAsync(
        "Ask for one list at a time with page, and read the handle file for everything else.",
        async () => {
          const closure = await closureCompute({ cwd, entryFiles, runId });
          return {
            counts: closure.counts,
            nodes: listView({
              kind: "closure-nodes",
              items: closure.nodes,
              label: (node) => `${node.kind} ${node.path} (${node.hops} hops)`,
              group: (node) => node.kind,
              page: pageFor("nodes", page),
            }),
            edges: listView({
              kind: "closure-edges",
              items: closure.edges,
              label: (edge) => `${edge.from} -> ${edge.to} (${edge.kind})`,
              group: (edge) => edge.kind,
              page: pageFor("edges", page),
            }),
          };
        }
      )
  );

  server.registerTool(
    "closure_resolve",
    {
      title: "Account for one closure node",
      description: [
        "Marks one closure node as covered by an existing test, covered by a case still to be written, or waived. An existing-test citation is verified by reading the named file and matching the test title; a citation that cannot be found is rejected and nothing is written.",
        "",
        "Args:",
        "- cwd (string): absolute path of the repository root.",
        "- runId (integer): run that owns the node.",
        "- nodeId (string): node identifier from closure_compute.",
        "- resolution (object): one of { kind: 'existing-test', testFile, testName, verifiedBy? }, { kind: 'new-case', testRef? }, { kind: 'waived', reason, signedBy }.",
        "",
        "Returns: { resolved: true, verified: true, citation: 'file::title' } for an existing test, { resolved: true, verified: false, plannedTest: string } for a new case, { resolved: true, verified: false, waivedBy: string } for a waiver, or { resolved: false, verified: false, reason: string, testNamesInFile?: string[] } when the citation fails.",
        "",
        "Examples:",
        "- Use it for a single late node you decided on after the worklist was already cleared.",
        "- Use kind 'waived' only with a reason and a signature, because a waiver is auditable.",
        "- Do NOT use it once per node over a worklist: that is one model turn per node. Call closure_resolve_batch with every node in one call.",
        "- Do NOT use it to create the nodes: call closure_compute with a runId first.",
        "- Do NOT use it to check whether D8 holds: call closure_unresolved.",
        "",
        "Error handling: a testFile that cannot be read, or a testName absent from it, comes back as resolved false with the test names found in that file, and the node stays open. A resolution whose shape does not match one of the three forms is rejected by the schema before the run is touched.",
      ].join("\n"),
      inputSchema: closureResolveInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ cwd, runId, nodeId, resolution }) =>
      respondAsync(
        "Resolve one nodeId per call; this result covers a single node.",
        () =>
          closureResolve({
            cwd,
            runId,
            nodeId,
            resolution: toResolution(resolution),
          })
      )
  );

  server.registerTool(
    "closure_resolve_batch",
    {
      title: "Account for every open closure node in one call",
      description: [
        "Applies many node resolutions in one call and answers with a summary instead of one result per node. Each entry is verified exactly as closure_resolve verifies it, an entry that fails leaves its node open without stopping the rest, and the remaining open count and D8 are read back after the last entry so no follow-up call is needed.",
        "",
        "Args:",
        "- cwd (string): absolute path of the repository root.",
        "- runId (integer): run that owns the nodes.",
        "- resolutions (array): every { nodeId, resolution } you are accounting for. The whole closure_unresolved worklist belongs in one call.",
        "- page (object, optional): { list: 'outcomes' | 'rejections', offset, limit } opens a window of one list.",
        "",
        "Returns: { requested, resolvedCount, rejectedCount, unresolvedCount, totalNodes, d8, outcomes: ListView, rejections: ListView }. Each ListView carries { total, groups, sample, handle, page?, items? } and its handle path is a JSON file holding every outcome.",
        "",
        "Examples:",
        "- Use it with the entire list closure_unresolved returned, in one call, after you have decided each node.",
        "- Use rejections.sample to see which citations were refused without reading the handle file.",
        "- Do NOT loop closure_resolve over a worklist; one call per node costs a model turn per node.",
        "- Do NOT use it to create the nodes: call closure_compute with a runId first.",
        "",
        "Truncation: the summary is bounded whatever the worklist size, so the result stays inside the 25000 character limit. A page is capped at 100 items and the handle file is the lossless copy.",
        "",
        "Error handling: a rejected citation, an unknown node and a storage failure all land in rejections with the reason, and the call still reports what did land. The counts at the end come from the persisted run, not from the entries you sent.",
      ].join("\n"),
      inputSchema: closureResolveBatchInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ cwd, runId, resolutions, page }) =>
      respondAsync(
        "Ask for one list at a time with page, and read the handle file for everything else.",
        async () => {
          const batch = await closureResolveBatch({
            cwd,
            runId,
            resolutions: resolutions.map((entry) => ({
              nodeId: entry.nodeId,
              resolution: toResolution(entry.resolution),
            })),
          });
          return {
            requested: batch.requested,
            resolvedCount: batch.resolvedCount,
            rejectedCount: batch.rejectedCount,
            unresolvedCount: batch.unresolvedCount,
            totalNodes: batch.totalNodes,
            d8: batch.d8,
            outcomes: listView({
              kind: "closure-resolutions",
              items: batch.outcomes,
              label: (outcome) =>
                `${outcome.nodeId} ${outcome.kind}: ${outcome.detail}`,
              group: (outcome) =>
                outcome.resolved ? outcome.kind : "rejected",
              page: pageFor("outcomes", page),
            }),
            rejections: listView({
              kind: "closure-rejections",
              items: batch.rejections,
              label: (outcome) => `${outcome.nodeId}: ${outcome.detail}`,
              group: (outcome) => outcome.kind,
              page: pageFor("rejections", page),
            }),
          };
        }
      )
  );

  server.registerTool(
    "closure_unresolved",
    {
      title: "List the closure nodes still open",
      description: [
        "Reads the persisted nodes of a run and returns the ones still unresolved, sorted by kind then identifier, with the predicate D8 that holds when the list is empty.",
        "",
        "Args:",
        "- cwd (string): absolute path of the repository root.",
        "- runId (integer): run whose nodes are counted.",
        "- page (object, optional): { offset, limit } opens a window of the open nodes. Omit it and only the summary comes back.",
        "",
        "Returns: { unresolvedCount: number, totalNodes: number, d8: boolean, unresolved: ListView }. The ListView carries { total, groups by node kind, sample, handle, page?, items? } and its handle path is a JSON file holding every open node, which is the worklist to hand to closure_resolve_batch.",
        "",
        "Examples:",
        "- Use it to decide whether the closure gate can pass.",
        "- Use groups to see which kinds are still open, then read the handle file for the worklist.",
        "- Do NOT use it to build the node list: call closure_compute with a runId.",
        "- Do NOT use it to account for nodes: call closure_resolve_batch.",
        "",
        "Truncation: the summary is bounded whatever the run size. A page is capped at 100 items and the handle file is the lossless copy.",
        "",
        "Error handling: a run with no persisted nodes is not an error; it returns an empty list, totalNodes 0 and d8 true, so check totalNodes before trusting the pass.",
      ].join("\n"),
      inputSchema: closureUnresolvedInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    ({ cwd, runId, page }) =>
      respondAsync(
        "Ask for a narrower page, and read the handle file for the whole worklist.",
        async () => {
          const open = await closureUnresolved({ cwd, runId });
          return {
            unresolvedCount: open.unresolvedCount,
            totalNodes: open.totalNodes,
            d8: open.d8,
            unresolved: listView({
              kind: "closure-unresolved",
              items: open.unresolved,
              label: (node) => `${node.kind} ${node.nodeId}`,
              group: (node) => node.kind,
              page,
            }),
          };
        }
      )
  );
};
