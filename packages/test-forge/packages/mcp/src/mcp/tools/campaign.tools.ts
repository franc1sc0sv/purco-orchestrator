import { campaignStart } from "../../application/campaign/start.ts";
import { campaignStatus } from "../../application/campaign/status.ts";
import { campaignStop } from "../../application/campaign/stop.ts";
import { respondAsync } from "../response.ts";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const campaignStartInput = z
  .object({
    cwd: z.string().describe("Absolute path of the repository root."),
    concurrency: z
      .number()
      .int()
      .describe(
        "How many lanes to build, one reusable worktree and one seed template each. Default 6, ceiling 6, because this machine has 11 cores and 18 GB shared with a docker VM that already takes 7.65 GB.",
      )
      .optional(),
    projectConfigFile: z
      .string()
      .describe(
        "Repository relative path of the project's own vitest config, which the generated lane config extends. Default 'vitest.config.mts'.",
      )
      .optional(),
    globalSetupFile: z
      .string()
      .describe(
        "Repository relative path of the project's global setup, which the campaign runs once. Default 'tests/integration/setups/global-setup.ts'.",
      )
      .optional(),
    laneWorkers: z
      .number()
      .int()
      .describe(
        "Vitest workers inside one lane. Default 1. Lanes times workers is held at or below 6, so every worker still gets a seed template of its own.",
      )
      .optional(),
    bootTimeoutMs: z
      .number()
      .int()
      .describe(
        "How long to wait for the shared environment to come up. Default 600000.",
      )
      .optional(),
    holdTimeoutMs: z
      .number()
      .int()
      .describe(
        "How long the environment stays up before it releases itself. Default 21600000, six hours.",
      )
      .optional(),
    minimumFreeGb: z
      .number()
      .describe("Disk headroom floor in GiB. Default 4.")
      .optional(),
    maximumContainers: z
      .number()
      .int()
      .describe("Running container ceiling. Default 40.")
      .optional(),
    seedDbName: z
      .string()
      .describe(
        "The database the project's global setup migrates and seeds, and the source the per worker templates are cloned from. Default 'seed_db'.",
      )
      .optional(),
    dbSetupFile: z
      .string()
      .describe(
        "Repository relative path of the project's per test database setup file, which the lane config replaces with the forge one that copies from a per worker template. Default 'tests/integration/setups/setup-db-per-test.ts'.",
      )
      .optional(),
  })
  .strict();

const campaignStatusInput = z
  .object({
    cwd: z.string().describe("Absolute path of the repository root."),
    campaignId: z
      .number()
      .int()
      .describe(
        "Campaign to report on. Without it the newest ready campaign for this repository is used.",
      )
      .optional(),
    minimumFreeGb: z
      .number()
      .describe("Disk headroom floor in GiB. Default 4.")
      .optional(),
    maximumContainers: z
      .number()
      .int()
      .describe("Running container ceiling. Default 40.")
      .optional(),
  })
  .strict();

const campaignStopInput = z
  .object({
    cwd: z.string().describe("Absolute path of the repository root."),
    campaignId: z.number().int().describe("Campaign to shut down."),
    drainTimeoutMs: z
      .number()
      .int()
      .describe(
        "How long to wait for the environment to tear its own containers down before it is signalled. Default 180000.",
      )
      .optional(),
    keepWorktrees: z
      .boolean()
      .describe(
        "Leave the lane worktrees and the campaign directory on disk for inspection. Default false.",
      )
      .optional(),
  })
  .strict();

export const registerCampaignTools = (server: McpServer): void => {
  server.registerTool(
    "mutation_campaign_start",
    {
      title: "Pay the test environment cost once",
      description: [
        "Starts one shared test environment for a whole mutation campaign and builds the reusable lanes that run against it. The environment is the project's own global setup, run once in its own throwaway worktree, held open by a process that keeps the containers alive; the environment values it produced are written to a manifest. Every lane is a worktree whose generated vitest config extends the project config and swaps the global setup for one that attaches to that manifest, so no container, migration or seed is paid per mutant.",
        "",
        "It also splits the seed database. Postgres refuses to copy a template while any session is connected to it, so every worker that copies from one shared seed database queues behind every other worker and more lanes buy almost nothing. The boot process therefore migrates and seeds once, then clones that one seed database into seed_db_1 .. seed_db_N, one per worker. Each lane config declares its own template names in the test environment, and the generated per test database setup that the lane config puts in place of the project's own reads that variable and copies only from the template belonging to its worker. The templates are dropped when the environment is released.",
        "",
        "Nothing in the repository is edited. The project's vitest config, global setup and test files are untouched, so a normal test run and CI behave exactly as before.",
        "",
        "Args:",
        "- cwd (string): absolute path of the repository root.",
        "- concurrency (integer, optional): how many lanes, default 6, ceiling 6. The ceiling is the machine, not a preference: 11 cores and 18 GB are shared between the vitest processes and a docker VM that already holds 7.65 GB, so a seventh lane starves the containers that every lane depends on and slows the whole campaign.",
        "- projectConfigFile (string, optional): the project's vitest config, default 'vitest.config.mts'.",
        "- globalSetupFile (string, optional): the project's global setup, default 'tests/integration/setups/global-setup.ts'.",
        "- laneWorkers (integer, optional): vitest workers inside one lane, default 1, held so that lanes times workers stays at or below 6.",
        "- bootTimeoutMs (integer, optional): wait for the environment, default 600000.",
        "- holdTimeoutMs (integer, optional): how long the environment stays up, default 21600000.",
        "- minimumFreeGb (number, optional): disk floor, default 4.",
        "- maximumContainers (integer, optional): container ceiling, default 40.",
        "- seedDbName (string, optional): the migrated and seeded database the templates are cloned from, default 'seed_db'.",
        "- dbSetupFile (string, optional): the project's per test database setup file the lane config replaces, default 'tests/integration/setups/setup-db-per-test.ts'.",
        "",
        "Returns: { ok: true, campaign: { campaignId, rootPath, baseDir, manifestPath, bootPid, bootLogPath, state, concurrency, detail, startedAt, endedAt }, lanes: Array<{ laneNo, worktreePath, cacheDir, configPath, state, mutantsRun }>, templates: string[], headroom, warnings: string[] } or { ok: false, reason, campaignId, headroom, bootLogTail }.",
        "",
        "Examples:",
        "- Use it once before a batch of mutants, then call mutation_batch_run.",
        "- Use it with the default concurrency: the ceiling already matches what this machine can feed.",
        "- Do NOT use it for a single mutant: mutation_apply_and_run pays its own environment and needs no campaign.",
        "- Do NOT leave it running: mutation_campaign_stop is what releases the containers, the templates and the disk.",
        "",
        "Error handling: the guard refuses to start when disk headroom is under the floor, when too many containers are already running, or when docker does not answer, and returns the readings that refused it. A worktree that cannot be built, an environment that never became ready, and a boot process that died early all come back ok false with the tail of the boot log, and every worktree already created is removed first. A boot that cannot clone the templates tears its own containers down and reports the failure in the boot log, and a lane whose template variable is missing fails loudly instead of falling back to the shared seed database.",
      ].join("\n"),
      inputSchema: campaignStartInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    (input) =>
      respondAsync(
        "Start fewer lanes: every lane reports its own worktree and cache paths.",
        () => campaignStart(input),
      ),
  );

  server.registerTool(
    "mutation_campaign_status",
    {
      title: "Report the campaign environment and the headroom",
      description: [
        "Reports whether a campaign's shared environment is still up, which environment values it carried, how the lanes stand, and whether the machine still has the disk and container headroom the run needs.",
        "",
        "Args:",
        "- cwd (string): absolute path of the repository root.",
        "- campaignId (integer, optional): without it, the newest ready campaign for this repository.",
        "- minimumFreeGb (number, optional): disk floor, default 4.",
        "- maximumContainers (integer, optional): container ceiling, default 40.",
        "",
        "Returns: { ok: true, campaign, lanes, bootAlive: boolean, manifestReady: boolean, carriedEnvKeys: string[], headroom: { ok, breaches, headroom, limits }, bootLogTail } or { ok: false, reason, openCampaignIds }.",
        "",
        "Examples:",
        "- Use it before a long batch to check the environment is still attached.",
        "- Use it after an aborted batch to read which limit was breached.",
        "- Do NOT use it to run mutants: call mutation_batch_run.",
        "- Do NOT use it to free the containers: call mutation_campaign_stop.",
        "",
        "Error handling: an unknown campaignId, and a repository with no ready campaign, both return ok false together with the ids of every campaign that is not finished. A boot process that has died shows bootAlive false while the campaign still reads ready, which means the lanes will fail until the campaign is stopped and started again.",
      ].join("\n"),
      inputSchema: campaignStatusInput.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    (input) =>
      respondAsync("Ask about one campaignId per call.", () =>
        campaignStatus(input),
      ),
  );

  server.registerTool(
    "mutation_campaign_stop",
    {
      title: "Release the campaign environment",
      description: [
        "Asks the held environment to finish, which lets it drop the per worker seed templates and run the project's own teardown over its containers, then removes every lane worktree and the campaign directory. Signals the process only when it will not finish on its own.",
        "",
        "Args:",
        "- cwd (string): absolute path of the repository root.",
        "- campaignId (integer): campaign to shut down.",
        "- drainTimeoutMs (integer, optional): wait for self teardown, default 180000.",
        "- keepWorktrees (boolean, optional): leave the lanes on disk, default false.",
        "",
        "Returns: { ok: true, campaign, teardownClean: boolean, killed: boolean, removedWorktrees: number } or { ok: false, reason }.",
        "",
        "Examples:",
        "- Use it as soon as the last batch is recorded, because the containers hold memory and disk until it runs.",
        "- Use it with keepWorktrees when a lane result needs to be inspected by hand.",
        "- Do NOT use it between batches: the whole point of the campaign is that the environment outlives one batch.",
        "- Do NOT rely on the process dying on its own: an unstopped campaign leaks containers.",
        "",
        "Error handling: an unknown campaignId returns ok false and changes nothing. When the environment does not finish inside drainTimeoutMs it is sent SIGTERM and then SIGKILL, teardownClean comes back false and killed true, and the containers may survive, so check docker afterwards.",
      ].join("\n"),
      inputSchema: campaignStopInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    (input) =>
      respondAsync("Stop one campaignId per call.", () => campaignStop(input)),
  );
};
