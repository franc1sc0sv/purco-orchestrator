import {
  findTaxonomyExt,
  upsertTaxonomyExt,
} from "../../infrastructure/db/codex-store.ts";
import { openDb } from "../../infrastructure/db/connection.ts";
import {
  blockingBarNames,
  isSeededAspect,
} from "../../infrastructure/doctrine.ts";
import { resolveProject } from "../../infrastructure/project.ts";
import { SCOPES } from "test-forge-contracts/project";
import type { Scope } from "test-forge-contracts/project";

const ASPECT_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export type TaxonomySetInput = {
  cwd: string;
  scope: Scope;
  aspect: string;
  appliesWhen: string;
  blockingBar: string;
};

export type TaxonomySetResult = {
  projectKey: string;
  scope: Scope;
  aspect: string;
  appliesWhen: string;
  blockingBar: string;
  created: boolean;
  updated: boolean;
  source: string;
};

export const taxonomySet = async ({
  cwd,
  scope,
  aspect,
  appliesWhen,
  blockingBar,
}: TaxonomySetInput): Promise<TaxonomySetResult> => {
  const db = openDb();
  const { projectKey } = await resolveProject(cwd);
  if (!SCOPES.includes(scope)) {
    throw new Error(`scope must be one of ${SCOPES.join(", ")}`);
  }
  if (!ASPECT_ID.test(aspect)) {
    throw new Error("aspect must be a lowercase, hyphen-separated identifier");
  }
  if (appliesWhen.trim().length === 0) {
    throw new Error(
      "An aspect requires appliesWhen: the sentence that decides whether it governs a file"
    );
  }
  const bars = blockingBarNames();
  if (!bars.includes(blockingBar)) {
    throw new Error(`blockingBar must be one of ${bars.join(", ")}`);
  }

  const existed = findTaxonomyExt(db, projectKey, scope, aspect) !== null;
  upsertTaxonomyExt(db, projectKey, scope, aspect, appliesWhen, blockingBar);

  return {
    projectKey,
    scope,
    aspect,
    appliesWhen,
    blockingBar,
    created: !existed,
    updated: existed,
    source: isSeededAspect(scope, aspect) ? "seed+project" : "project",
  };
};
