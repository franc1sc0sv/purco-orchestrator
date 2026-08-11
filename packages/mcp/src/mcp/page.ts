import { MAX_PAGE_LIMIT } from "test-forge-contracts/listing";
import type { PageRequest } from "test-forge-contracts/listing";
import { z } from "zod";

const offset = z
  .number()
  .int()
  .min(0)
  .describe("Zero-based index of the first item to return.");

const limit = z
  .number()
  .int()
  .min(1)
  .max(MAX_PAGE_LIMIT)
  .describe(`How many items to return, at most ${MAX_PAGE_LIMIT}.`);

export const pageInput = z
  .object({ offset, limit })
  .strict()
  .describe(
    "An explicit narrow request for one window of the list. Omit it and the call returns the summary and the handle only, which is lossless because the handle file holds every item."
  );

export const listPageInput = z
  .object({
    list: z
      .string()
      .describe(
        "Which list of the result to open, named exactly as the result names it."
      ),
    offset,
    limit,
  })
  .strict()
  .describe(
    "An explicit narrow request for one window of one named list. Omit it and the call returns the summary and the handle of every list, which is lossless because each handle file holds every item."
  );

export type ListPageInput = z.infer<typeof listPageInput>;

export const pageFor = (
  list: string,
  request: ListPageInput | undefined
): PageRequest | undefined =>
  request === undefined || request.list !== list
    ? undefined
    : { offset: request.offset, limit: request.limit };
