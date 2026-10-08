import { readFileSync } from "node:fs"

const CONFIG = __CONFIG__

type Manifest = { env?: Record<string, string>; templates?: string[] }

export default function forgeStrykerAttach() {
  const manifest = JSON.parse(readFileSync(CONFIG.manifestPath, "utf8")) as Manifest
  const carried = manifest.env ?? {}
  if (Object.keys(carried).length === 0) {
    throw new Error("the harness manifest carried no environment: " + CONFIG.manifestPath)
  }
  for (const [key, value] of Object.entries(carried)) {
    process.env[key] = value
  }
  process.env.FORGE_SEED_TEMPLATES = (manifest.templates ?? []).join(",")
  return () => undefined
}
