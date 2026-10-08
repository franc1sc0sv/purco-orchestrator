import { defineConfig } from "vitest/config"

import baseConfig from "__PROJECT_CONFIG__"

const CONFIG = __CONFIG__

const baseTest = baseConfig.test ?? {}

const isProject = (value: unknown): boolean =>
  typeof value === "object" && value !== null

const project = (baseTest.projects ?? []).find(
  (candidate) => isProject(candidate) && candidate.test?.name === CONFIG.projectName
)

if (project === undefined) {
  throw new Error("the project config has no project named " + CONFIG.projectName)
}

let swapped = 0

const swapDbSetup = (setupFiles: string | string[] | undefined): string[] => {
  const listed = typeof setupFiles === "string" ? [setupFiles] : (setupFiles ?? [])
  return listed.map((file) => {
    if (!file.endsWith(CONFIG.dbSetupFile)) return file
    swapped += 1
    return CONFIG.workerDbSetup
  })
}

const setupFiles = CONFIG.attach ? swapDbSetup(project.test?.setupFiles) : project.test?.setupFiles

if (CONFIG.attach && swapped === 0) {
  throw new Error(
    "no setup file of project " + CONFIG.projectName + " matches " + CONFIG.dbSetupFile +
      ", so every worker would copy from one shared seed database"
  )
}

export default defineConfig({
  ...baseConfig,
  test: {
    ...baseTest,
    projects: [
      {
        ...project,
        test: { ...project.test, include: CONFIG.testFiles ?? project.test?.include, setupFiles },
      },
    ],
    globalSetup: CONFIG.attach ? [CONFIG.attachSetup] : [],
  },
})
