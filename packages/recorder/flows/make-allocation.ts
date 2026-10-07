import { Page } from "@playwright/test"
import { TransactionMethodEnum } from "@prisma/client"

import { FlowClaim, getSession } from "./flow-session"
import { openClaim } from "./open-claim"
import { publishClaimDemand } from "./publish-claim-demand"

const CENTS_PER_DOLLAR = 100
const DAYS_PER_WEEK = 7
const THURSDAY = 3

const lastWeekThursday = (): Date => {
  const date = new Date()
  date.setDate(date.getDate() - (date.getDay() + 1 + DAYS_PER_WEEK) + THURSDAY)
  return date
}

const uniqueReference = (): string =>
  `R${Date.now().toString(36).slice(-6).toUpperCase()}`

export const makeAllocation = async (
  page: Page,
  claim: FlowClaim,
  amountCents: number
): Promise<void> => {
  const session = getSession(page)
  const amount = amountCents / CENTS_PER_DOLLAR

  await publishClaimDemand(page, claim)
  const specialistId = await session.accountingApi.getSpecialistId()
  await session.accountingApi.assignSpecialistViaApi(
    claim.claimId,
    specialistId
  )
  const paymentDate = lastWeekThursday()
  await session.accountingApi.createPaymentViaApi({
    claimId: claim.claimId,
    method: TransactionMethodEnum.CREDIT_CARD,
    amount,
    paymentDate,
    receptionDate: paymentDate,
    referenceNumber: uniqueReference(),
    involvedPartyId: session.store.get<string>("renterUserId"),
  })
  session.store.set("paymentAmount", amount)

  await openClaim(page, claim)
  await session.pageManager.claimAccounting.clickOnAccountingTab()
  await session.pageManager.claimAccounting.isSummaryTagVisible()
  await session.pageManager.claimDetailsPayment.clickOnAllocateButton(
    session.role
  )
  await session.pageManager.allocationDrawer.addAmountToAllocations()
  await session.pageManager.allocationDrawer.submitAllocations()
}
