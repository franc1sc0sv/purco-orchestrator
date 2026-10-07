import { Page } from "@playwright/test"

import PageManager from "../pages/page-manager/page-manager"
import AccountingApiFunctions from "../utils/api-functions/accounting-api-functions"
import ClaimsApiFunctions from "../utils/api-functions/claims-api-functions"
import { RuntimeStore } from "../utils/runtime-store"
import { getTenant } from "../utils/test-tenant"
import { getBaseUrl } from "../utils/url-utils"

export type FlowRole =
  | "superAdmin"
  | "admin"
  | "specialist"
  | "clientAdmin"
  | "clientMember"

export type FlowClaim = {
  claimId: string
  claimNumber: string
}

export type FlowSession = {
  page: Page
  role: FlowRole
  store: RuntimeStore
  pageManager: PageManager
  claimsApi: ClaimsApiFunctions
  accountingApi: AccountingApiFunctions
}

const sessions = new WeakMap<Page, FlowSession>()

export const getFlowBaseUrl = (): string =>
  getBaseUrl(process.env.envmode || "stage", getTenant())

export const startSession = (page: Page, role: FlowRole): FlowSession => {
  const tenant = getTenant()
  const store = new RuntimeStore()
  const request = page.context().request
  const session: FlowSession = {
    page,
    role,
    store,
    pageManager: new PageManager(page, tenant, store),
    claimsApi: new ClaimsApiFunctions(request, tenant, store),
    accountingApi: new AccountingApiFunctions(request, tenant, store),
  }
  sessions.set(page, session)
  return session
}

export const getSession = (page: Page): FlowSession => {
  const session = sessions.get(page)
  if (!session) {
    throw new Error(
      "No flow session for this page. Call loginAs(page, role) first."
    )
  }
  return session
}

export const bindClaim = (session: FlowSession, claim: FlowClaim): void => {
  session.store.set("claimId", claim.claimId)
  session.store.set("claimNumber", claim.claimNumber)
  session.store.set("numberClaim", claim.claimNumber)
}
