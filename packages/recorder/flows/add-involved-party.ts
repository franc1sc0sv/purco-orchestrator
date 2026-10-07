import { Page } from "@playwright/test"

import { TEST_CONST } from "../utils/constants-test-data"
import { FlowClaim, getSession } from "./flow-session"
import { openClaim } from "./open-claim"

const FIRST_SUB_PARTY = 1

export type InvolvedPartyInput = {
  type?: string
  organizationName?: string
  firstName?: string
  lastName?: string
  phone?: string
  email?: string
}

export type AddedInvolvedParty = Required<InvolvedPartyInput>

export const addInvolvedParty = async (
  page: Page,
  claim: FlowClaim,
  data: InvolvedPartyInput = {}
): Promise<AddedInvolvedParty> => {
  const session = getSession(page)
  const { involvedParties, creationForm } = session.pageManager
  const party: AddedInvolvedParty = {
    type: data.type ?? "Employer",
    organizationName: data.organizationName ?? TEST_CONST.ORG_NAME,
    firstName: data.firstName ?? TEST_CONST.RANDOM_NAME,
    lastName: data.lastName ?? TEST_CONST.RANDOM_LAST_NAME,
    phone: data.phone ?? TEST_CONST.PHONE_NUMBER,
    email: data.email ?? TEST_CONST.RANDOM_EMAIL,
  }

  await openClaim(page, claim)
  await involvedParties.clickInvolvedPartiesTab()
  await involvedParties.clickDotMenu()
  await involvedParties.clickAddSubPartyButton()
  await creationForm.selectInvolvedPartyType(party.type)
  await creationForm.clickSystemAccessToggle()
  await creationForm.fillOrganizationName(party.organizationName)
  await creationForm.fillFirstName(party.firstName)
  await creationForm.fillLastName(party.lastName)
  await creationForm.fillContactPhone(party.phone)
  await creationForm.clickAddEmailButton()
  await creationForm.fillContactEmail(party.email)
  await creationForm.clickAddInvolvedPartyButton()
  await involvedParties.assertSubPartyCount(FIRST_SUB_PARTY)
  return party
}
