import tsconfigPaths from "vite-tsconfig-paths"
import { defineConfig } from "vitest/config"

import baseConfig from "__PROJECT_CONFIG__"

const CONFIG = __CONFIG__

const baseTest = baseConfig.test ?? {}

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    env: baseTest.env,
    globalSetup: ["./.test-forge/stryker/boot-setup.ts"],
    include: [".test-forge/stryker/hold.test.ts"],
    exclude: [],
    environment: "node",
    pool: "forks",
    fileParallelism: false,
    testTimeout: CONFIG.holdTimeoutMs,
    hookTimeout: CONFIG.bootTimeoutMs,
    teardownTimeout: CONFIG.bootTimeoutMs,
  },
})
