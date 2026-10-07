import path from "node:path"
import { defineConfig, devices } from "@playwright/test"

import { getBaseUrl } from "../utils/url-utils"

const VIDEO_SIZE = { width: 1280, height: 720 }

export default defineConfig({
  testDir: path.join(process.cwd(), "tests/e2e/.purco-recording"),
  testMatch: ["**/*.spec.ts"],
  outputDir: path.join(process.cwd(), "tests/e2e/.purco-recording/output"),
  timeout: 120_000,
  expect: { timeout: 25_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: getBaseUrl(
      process.env.envmode || "stage",
      process.env.TENANT || "purco"
    ),
    headless: true,
    viewport: VIDEO_SIZE,
    video: { mode: "on", size: VIDEO_SIZE },
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
})
