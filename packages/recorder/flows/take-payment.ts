import { Page } from "@playwright/test"

import constantsData from "../data/constants-data.json"
import { TEST_CONST } from "../utils/constants-test-data"
import { WaitHelpers } from "../utils/wait-helpers"
import { FlowClaim, getSession } from "./flow-session"
import { openClaim } from "./open-claim"
import { publishClaimDemand } from "./publish-claim-demand"

const PAYMENT_ROW_TIMEOUT_MS = 180_000
const UI_IDLE_TIMEOUT_MS = 15_000

export type TakePaymentOptions = {
  waitForPaymentRow?: boolean
}

export const takePayment = async (
  page: Page,
  claim: FlowClaim,
  options: TakePaymentOptions = {}
): Promise<number> => {
  const { waitForPaymentRow = true } = options
  const session = getSession(page)
  const { pageManager, store } = session
  const { testScriptsConstants } = constantsData

  const openAccountingTab = async (): Promise<void> => {
    await pageManager.claimAccounting.clickOnAccountingTab()
    await pageManager.claimAccounting.isSummaryTagVisible()
  }

  await publishClaimDemand(page, claim)
  await openClaim(page, claim)
  await openAccountingTab()

  await pageManager.claimAccountSummaryTable.setTotalClaimAmount()
  const paymentAmount = store.get<number>("FullClaimAmount")
  store.set("paymentAmount", paymentAmount)

  await pageManager.claimDetail.actionsMenu()
  await pageManager.takePaymentDrawer.clickTakeAPaymentOption()
  await pageManager.takePaymentDrawer.involvedPartySelection()
  await pageManager.takePaymentDrawer.fullAmountSelection()
  await pageManager.involvedPartyPayments.cardOptionSelection()
  await pageManager.involvedPartyPayments.addCardInformation(
    testScriptsConstants.cardNumber
  )
  await pageManager.involvedPartyPayments.addDateCardInformation(
    testScriptsConstants.expCardDate
  )
  await pageManager.involvedPartyPayments.addCvcNumber(
    testScriptsConstants.cvcNumber
  )
  await pageManager.involvedPartyPayments.selectCountry()
  await pageManager.involvedPartyPayments.isZipcodeRequired(
    TEST_CONST.RANDOM_ZIP_CODE
  )
  await pageManager.takePaymentDrawer.clickAddPaymentButton()

  if (waitForPaymentRow) {
    await new WaitHelpers(page).waitForUiIdle({ timeout: UI_IDLE_TIMEOUT_MS })
    await openAccountingTab()
    await pageManager.claimDetailsPayment.pollForPaymentRow(openAccountingTab, {
      timeout: PAYMENT_ROW_TIMEOUT_MS,
    })
  }
  return paymentAmount
}
