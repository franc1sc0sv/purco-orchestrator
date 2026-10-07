import { Page } from "@playwright/test"

const TITLE_CARD_MS = 1500
const TITLE_CARD_ID = "recording-title-card"

export type FlagState = "ON" | "OFF" | "NONE"

export type TitleCardInput = {
  ticket: string
  criterion: string
  flagState: FlagState
}

export const showTitleCard = async (
  page: Page,
  input: TitleCardInput
): Promise<void> => {
  const flagLine =
    input.flagState === "NONE" ? "" : `Feature flag: ${input.flagState}`

  await page.evaluate(
    ({ id, ticket, criterion, flag }) => {
      const overlay = document.createElement("div")
      overlay.id = id
      overlay.style.cssText = [
        "position:fixed",
        "inset:0",
        "z-index:2147483647",
        "display:flex",
        "flex-direction:column",
        "align-items:center",
        "justify-content:center",
        "gap:24px",
        "padding:64px",
        "background:#0f172a",
        "color:#f8fafc",
        "font-family:system-ui,sans-serif",
        "text-align:center",
      ].join(";")

      const lines: Array<[string, string]> = [
        [ticket, "font-size:28px;font-weight:600;color:#94a3b8"],
        [criterion, "font-size:44px;font-weight:700;line-height:1.2"],
        [flag, "font-size:28px;font-weight:600;color:#38bdf8"],
      ]
      for (const [text, style] of lines) {
        if (!text) continue
        const line = document.createElement("div")
        line.style.cssText = style
        line.textContent = text
        overlay.append(line)
      }
      document.documentElement.append(overlay)
    },
    {
      id: TITLE_CARD_ID,
      ticket: input.ticket,
      criterion: input.criterion,
      flag: flagLine,
    }
  )

  await page.waitForTimeout(TITLE_CARD_MS)

  await page.evaluate((id) => {
    document.getElementById(id)?.remove()
  }, TITLE_CARD_ID)
}
