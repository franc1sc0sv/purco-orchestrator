# Recording flows

This library belongs to purco-orchestrator (`packages/recorder/flows`). The engine copies it into `<ticket worktree>/tests/e2e/.purco-recording/` at record time, together with the ticket's recording scripts, and deletes that folder when the step ends. A recording script imports a flow as `./<flow>`.

Standard flows for fast video recording. Each flow takes a Playwright `Page` and uses the existing page objects (`tests/e2e/pages/**`), API helpers (`tests/e2e/utils/api-functions`) and saved sessions (`tests/e2e/utils/storage/<env>/<tenant>/<role>.json`).

| Flow | Call | Returns | Notes |
| --- | --- | --- | --- |
| `login-as.ts` | `loginAs(page, role)` | session | Puts the saved session cookie in the browser. No OTP form. Run it first. |
| `create-claim.ts` | `createClaim(page, { overrides? })` | `{ claimId, claimNumber }` | Fills the new-claim form through `ClaimsHomePage` and `ClaimForm`. |
| `open-claim.ts` | `openClaim(page, claim)` | nothing | Goes to `/claims/<number>/overview`. |
| `make-allocation.ts` | `makeAllocation(page, claim, amountCents)` | nothing | Seeds a payment by API, then allocates it in the allocation drawer. |
| `take-payment.ts` | `takePayment(page, claim, { waitForPaymentRow? })` | payment amount | Takes a full card payment in the drawer. Waits up to 180 s for the payment row. |
| `add-involved-party.ts` | `addInvolvedParty(page, claim, data?)` | party data | Adds a sub party. Defaults come from `TEST_CONST`. |
| `set-flag.ts` | `setFlag(page, FEATURE_FLAGS.X, enabled)` | nothing | Pins the client-side flag for this page. Call it before `loginAs`. |
| `title-card.ts` | `showTitleCard(page, { ticket, criterion, flagState })` | nothing | Full-screen card for 1.5 s. Call it first. |

`publish-claim-demand.ts` and `flow-session.ts` are helpers for the flows. They are not flows.

## Environment

- `TENANT=purco` or `sdi`.
- `envmode=local` for the app on port 3000. The default is `stage`.
- `test_env=dev` selects the saved session folder. The default is `dev`.
- `apiSuperAdmin.json` must exist in the same folder. The API helpers read it.

## Feature flags

`setFlag` rewrites the Flagsmith client response in the browser. It changes only the flags that the browser reads. Server-side flags keep the value set in Flagsmith. The repo has no other way to control flags in e2e tests.

## Example recording script

```ts
import { test } from "@playwright/test"

import { FEATURE_FLAGS } from "~/types/feature-flags"
import { createClaim } from "./create-claim"
import { loginAs } from "./login-as"
import { makeAllocation } from "./make-allocation"
import { setFlag } from "./set-flag"
import { showTitleCard } from "./title-card"

test("PURCO-0000: allocation with the flag on @recording", async ({ page }) => {
  await setFlag(page, FEATURE_FLAGS.ENABLE_AUTO_ASSIGN_SPECIALIST, true)
  await showTitleCard(page, {
    ticket: "PURCO-0000",
    criterion: "A payment is allocated",
    flagState: "ON",
  })
  await loginAs(page, "superAdmin")
  const claim = await createClaim(page)
  await makeAllocation(page, claim, 120_000)
})
```

The engine runs it and moves the video to `<pack>/verify/videos/`. To run a script by hand, put the library and the script in `tests/e2e/.purco-recording/`, then:

```bash
TENANT=purco envmode=local npx playwright test tests/e2e/.purco-recording/<script>.spec.ts -c tests/e2e/.purco-recording/recording.config.ts
```

The normal e2e config reads only `tests/e2e/specs`, so these specs do not run in the smoke or regression suites. Do not add `@smoketest` or `@regression` tags to them.
