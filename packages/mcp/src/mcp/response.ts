import { CHARACTER_LIMIT } from "../constants.ts";

export type ToolResponse = {
  content: { type: "text"; text: string }[];
  structuredContent: Record<string, unknown>;
  isError?: boolean;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const structuredOf = (json: string): Record<string, unknown> => {
  const parsed: unknown = JSON.parse(json);
  return isRecord(parsed) ? parsed : { result: parsed };
};

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const toolResponse = (
  payload: unknown,
  narrowing: string,
): ToolResponse => {
  const json = JSON.stringify(payload ?? null, null, 2);
  if (json.length <= CHARACTER_LIMIT) {
    return {
      content: [{ type: "text", text: json }],
      structuredContent: structuredOf(json),
    };
  }
  const notice = `\n\nTRUNCATED: the result is ${json.length} characters and the limit is ${CHARACTER_LIMIT}. ${narrowing}`;
  return {
    content: [
      {
        type: "text",
        text: `${json.slice(0, CHARACTER_LIMIT - notice.length)}${notice}`,
      },
    ],
    structuredContent: {
      truncated: true,
      characterLimit: CHARACTER_LIMIT,
      totalCharacters: json.length,
      narrowWith: narrowing,
    },
  };
};

export const toolFailure = (error: unknown): ToolResponse => {
  const message = messageOf(error);
  return {
    content: [
      { type: "text", text: JSON.stringify({ error: message }, null, 2) },
    ],
    structuredContent: { error: message },
    isError: true,
  };
};

export const respond = <TResult>(
  narrowing: string,
  produce: () => TResult & { then?: never },
): ToolResponse => {
  try {
    return toolResponse(produce(), narrowing);
  } catch (error) {
    return toolFailure(error);
  }
};

export const respondAsync = async (
  narrowing: string,
  produce: () => Promise<unknown>,
): Promise<ToolResponse> => {
  try {
    return toolResponse(await produce(), narrowing);
  } catch (error) {
    return toolFailure(error);
  }
};
