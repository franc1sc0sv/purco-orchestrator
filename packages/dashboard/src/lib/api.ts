import type { NewNote } from "@/lib/types";

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

export const answerEarly = async (ticket: string, questionId: number, text: string): Promise<AnswerOutcome> => {
  try {
    const response = await fetch(
      `/api/tickets/${encodeURIComponent(ticket)}/grill/${questionId}/early`,
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

export const postNote = async (ticket: string, note: NewNote): Promise<boolean> => {
  try {
    const response = await fetch(`/api/tickets/${encodeURIComponent(ticket)}/notes`, {
      method: "POST",
      headers: jsonPostHeaders(),
      body: JSON.stringify({
        text: note.text,
        file: note.file,
        line: note.line,
        target_agent: note.targetAgent,
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
};
