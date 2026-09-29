import { TESTING_ROOT } from "../constants.ts";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Handle } from "test-forge-contracts/listing";

export const HANDLES_PATH = join(TESTING_ROOT, "data", "handles");

export const writeHandle = (
  kind: string,
  items: readonly unknown[]
): Handle => {
  const json = JSON.stringify(items, null, 2);
  const digest = createHash("sha256")
    .update(`${kind}\u0000${json}`)
    .digest("hex")
    .slice(0, 12);
  const handleId = `${kind}-${digest}`;
  const path = join(HANDLES_PATH, `${handleId}.json`);
  mkdirSync(HANDLES_PATH, { recursive: true });
  writeFileSync(path, json, "utf8");
  return { handleId, path, itemCount: items.length, bytes: json.length };
};
