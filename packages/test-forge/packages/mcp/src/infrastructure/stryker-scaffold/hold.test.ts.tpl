import { existsSync } from "node:fs"
import { it } from "vitest"

const CONFIG = __CONFIG__

it(
  "holds the mutation environment open",
  async () => {
    while (!existsSync(CONFIG.stopFilePath)) {
      await new Promise((settle) => setTimeout(settle, 500))
    }
  },
  CONFIG.holdTimeoutMs
)
