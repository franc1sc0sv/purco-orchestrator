import fs from "node:fs/promises"
import path from "node:path"
import { Page } from "@playwright/test"
import { z } from "zod"

import { getTenant } from "../utils/test-tenant"
import {
  FlowRole,
  FlowSession,
  getFlowBaseUrl,
  startSession,
} from "./flow-session"

const storedCookieSchema = z.object({
  name: z.string(),
  value: z.string(),
  httpOnly: z.boolean().optional(),
  sameSite: z.enum(["Strict", "Lax", "None"]).optional(),
  expires: z.number().optional(),
})

const storageStateSchema = z.object({ cookies: z.array(storedCookieSchema) })

type StoredCookie = z.infer<typeof storedCookieSchema>

const NAVIGATION_TIMEOUT_MS = 15_000

const storagePathFor = (role: FlowRole): string =>
  path.resolve(
    __dirname,
    "../utils/storage",
    process.env.test_env || "dev",
    getTenant(),
    `${role}.json`
  )

const readCookies = async (role: FlowRole): Promise<StoredCookie[]> => {
  const filePath = storagePathFor(role)
  try {
    const state = storageStateSchema.parse(
      JSON.parse(await fs.readFile(filePath, "utf8"))
    )
    return state.cookies
  } catch (error) {
    throw new Error(
      `[loginAs] Missing or unreadable saved session for ${role} at ${filePath}: ${error}`
    )
  }
}

export const loginAs = async (
  page: Page,
  role: FlowRole
): Promise<FlowSession> => {
  const baseUrl = getFlowBaseUrl()
  const cookies = await readCookies(role)

  await page.context().addCookies(
    cookies.map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      url: baseUrl,
      httpOnly: cookie.httpOnly,
      secure: baseUrl.startsWith("https"),
      sameSite: cookie.sameSite,
      expires: cookie.expires,
    }))
  )

  await page.goto(`${baseUrl}/claims`)
  await page
    .getByRole("navigation")
    .first()
    .waitFor({ state: "visible", timeout: NAVIGATION_TIMEOUT_MS })

  return startSession(page, role)
}
