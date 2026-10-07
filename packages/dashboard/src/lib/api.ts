const readToken = (): string =>
  document.querySelector<HTMLMetaElement>('meta[name="purco-token"]')?.content ?? "";

export const jsonPostHeaders = (): Record<string, string> => ({
  "content-type": "application/json",
  "x-purco-token": readToken(),
});

export type AnswerOutcome = "answered" | "already-answered" | "failed";

export const answerItem = async (ticket: string, id: string, text: string): Promise<AnswerOutcome> => {
  try {
    const response = await fetch(
      `/api/tickets/${encodeURIComponent(ticket)}/items/${encodeURIComponent(id)}/answer`,
      {
        method: "POST",
        headers: jsonPostHeaders(),
        body: JSON.stringify({ text }),
      },
    );
    if (response.ok) return "answered";
    return response.status === 409 ? "already-answered" : "failed";
  } catch {
    return "failed";
  }
};
