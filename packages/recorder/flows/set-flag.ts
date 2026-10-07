import { Page } from "@playwright/test"
import { z } from "zod"

import { FEATURE_FLAGS, FeatureFlagKey } from "~/types/feature-flags"

const FLAGSMITH_CLIENT_ROUTE = /\/api\/v1\/(flags|identities)\//
const FLAGSMITH_CACHE_PREFIX = "FLAGSMITH_DB"

const flagStateSchema = z
  .object({
    enabled: z.boolean(),
    feature: z.object({ name: z.string() }).passthrough(),
  })
  .passthrough()

const flagsResponseSchema = z.union([
  z.array(flagStateSchema),
  z.object({ flags: z.array(flagStateSchema) }).passthrough(),
])

type FlagState = z.infer<typeof flagStateSchema>

const FLAG_KEYS: ReadonlySet<string> = new Set(Object.values(FEATURE_FLAGS))

const isFeatureFlagKey = (name: string): name is FeatureFlagKey =>
  FLAG_KEYS.has(name)

const pinsByPage = new WeakMap<Page, Map<FeatureFlagKey, boolean>>()

const applyPins = (
  flags: FlagState[],
  pins: Map<FeatureFlagKey, boolean>
): FlagState[] => {
  const pinned = flags.map((flag) => {
    const name = flag.feature.name
    const pin = isFeatureFlagKey(name) ? pins.get(name) : undefined
    return pin === undefined ? flag : { ...flag, enabled: pin }
  })
  const present = new Set(flags.map((flag) => flag.feature.name))
  const missing = [...pins.entries()]
    .filter(([name]) => !present.has(name))
    .map(([name, enabled]) => ({
      id: 0,
      enabled,
      feature_state_value: null,
      feature: { id: 0, name, type: "STANDARD" },
    }))
  return [...pinned, ...missing]
}

const installRoute = async (
  page: Page,
  pins: Map<FeatureFlagKey, boolean>
): Promise<void> => {
  await page.addInitScript((prefix) => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(prefix)) {
        localStorage.removeItem(key)
      }
    }
  }, FLAGSMITH_CACHE_PREFIX)

  await page.route(FLAGSMITH_CLIENT_ROUTE, async (route) => {
    const response = await route.fetch()
    const parsed = flagsResponseSchema.safeParse(await response.json())
    if (!parsed.success) {
      await route.fulfill({ response })
      return
    }
    const body = Array.isArray(parsed.data)
      ? applyPins(parsed.data, pins)
      : { ...parsed.data, flags: applyPins(parsed.data.flags, pins) }
    await route.fulfill({ response, json: body })
  })
}

export const setFlag = async (
  page: Page,
  flag: FeatureFlagKey,
  enabled: boolean
): Promise<void> => {
  const existing = pinsByPage.get(page)
  if (existing) {
    existing.set(flag, enabled)
    return
  }
  const pins = new Map<FeatureFlagKey, boolean>([[flag, enabled]])
  pinsByPage.set(page, pins)
  await installRoute(page, pins)
}
