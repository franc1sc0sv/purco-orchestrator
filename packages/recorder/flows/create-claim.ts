import { Page } from "@playwright/test"

import ClaimDataFactory, {
  ClaimDataOverrides,
} from "../utils/claim-data-factory"
import { TEST_CONST } from "../utils/constants-test-data"
import { getTenant } from "../utils/test-tenant"
import { FlowClaim, getFlowBaseUrl, getSession } from "./flow-session"

type ClaimCreateResponse = {
  result: { data: { json: { id: string; claimNumber: number | string } } }
}

export type CreateClaimInput = {
  overrides?: ClaimDataOverrides
}

export const createClaim = async (
  page: Page,
  data: CreateClaimInput = {}
): Promise<FlowClaim> => {
  const session = getSession(page)
  const tenant = getTenant()
  const claimData = new ClaimDataFactory(tenant).createClaimData(
    session.role,
    data.overrides
  )
  if (!claimData) {
    throw new Error(`[createClaim] No claim data for role ${session.role}`)
  }

  await page.goto(`${getFlowBaseUrl()}/claims`)
  await session.pageManager.claimsHomePage.newClaimClick()
  await session.pageManager.claimForm.fillClaimForm(claimData, session.role)

  const created = page.waitForResponse(
    (response) =>
      response.url().includes("claimsManagement.claims.create") &&
      response.status() === 200
  )
  const [createResponse] = await Promise.all([
    created,
    session.pageManager.claimForm.clickCreateClaim(),
  ])
  const body: ClaimCreateResponse = await createResponse.json()
  const { id, claimNumber } = body.result.data.json

  const claim: FlowClaim = { claimId: id, claimNumber: String(claimNumber) }
  session.store.set("claimId", claim.claimId)
  session.store.set("claimNumber", claim.claimNumber)
  session.store.set("numberClaim", claim.claimNumber)
  session.store.set("renterFirstName", TEST_CONST.RANDOM_NAME)
  session.store.set("renterLastName", TEST_CONST.RANDOM_LAST_NAME)
  session.store.set("sdiRenterBusinessName", TEST_CONST.BUSINESS_NAME)
  return claim
}
