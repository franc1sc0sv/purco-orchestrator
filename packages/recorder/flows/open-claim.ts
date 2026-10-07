import { Page } from "@playwright/test"

import {
  bindClaim,
  FlowClaim,
  getFlowBaseUrl,
  getSession,
} from "./flow-session"

export const openClaim = async (
  page: Page,
  claim: FlowClaim
): Promise<void> => {
  const session = getSession(page)
  bindClaim(session, claim)
  await page.goto(`${getFlowBaseUrl()}/claims/${claim.claimNumber}/overview`)
  await page.waitForURL(`**/claims/${claim.claimNumber}/overview`)
  await page.getByRole("tablist").first().waitFor({ state: "visible" })
}
