import { Page } from "@playwright/test"

import constantsData from "../data/constants-data.json"
import {
  bindClaim,
  FlowClaim,
  getFlowBaseUrl,
  getSession,
} from "./flow-session"

const demandPublishedKey = (claim: FlowClaim): string =>
  `demandPublished:${claim.claimId}`

export const publishClaimDemand = async (
  page: Page,
  claim: FlowClaim
): Promise<void> => {
  const session = getSession(page)
  if (session.store.has(demandPublishedKey(claim))) {
    return
  }
  bindClaim(session, claim)

  const apiUrl = getFlowBaseUrl()
  const { testScriptsConstants } = constantsData

  await session.claimsApi.claimInvolParGet()
  await session.claimsApi.claimDemandListGet()
  await session.claimsApi.updateClaimDemandPost(
    `${apiUrl}${testScriptsConstants.UpdateClaimDemandEndpointDraft}`
  )
  await session.claimsApi.publishClaimDemandPost(
    `${apiUrl}${testScriptsConstants.UpdateClaimDemandEndpointPublish}`
  )
  await session.claimsApi.giveSystemAccess(
    `${apiUrl}${testScriptsConstants.involvePartiUpdateEndpoint}`,
    false
  )
  session.store.set(demandPublishedKey(claim), true)
}
