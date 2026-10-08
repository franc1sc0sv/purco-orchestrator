import { appendFileSync } from "node:fs"
import { declareFactoryPlugin, PluginKind } from "__STRYKER_API_PLUGIN__"

const EVENTS_PATH = process.env.FORGE_STRYKER_EVENTS

const write = (record) => {
  if (EVENTS_PATH) appendFileSync(EVENTS_PATH, JSON.stringify({ ts: Date.now(), ...record }) + "\n")
}

function forgeEventsFactory() {
  return {
    onDryRunCompleted() {
      write({ event: "dryRunCompleted" })
    },
    onMutantTested(result) {
      write({
        event: "mutantTested",
        file: result.fileName,
        mutator: result.mutatorName,
        replacement: result.replacement,
        location: result.location,
        status: result.status,
        testsCompleted: result.testsCompleted ?? null,
      })
    },
    onMutationTestReportReady() {
      write({ event: "reportReady" })
    },
  }
}

export const strykerPlugins = [
  declareFactoryPlugin(PluginKind.Reporter, "forge-events", forgeEventsFactory),
]
