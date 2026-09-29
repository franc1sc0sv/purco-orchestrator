import type { ModelCost, PostTokens } from "../infrastructure/sdk.ts";

export type AllocatedUsage = PostTokens & { costUsd: number };

export const HOST_CALLSIGN = "host";

const weight = (post: PostTokens): number =>
  post.inputTokens +
  5 * post.outputTokens +
  0.1 * post.cacheReadTokens +
  1.25 * post.cacheWriteTokens;

const emptyPost = (model: string): PostTokens => ({
  callsign: HOST_CALLSIGN,
  model,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
});

export const modelKey = (model: string): string =>
  model.replace(/-\d{8}$/, "").replace(/\[.*\]$/, "");

export const cycleCost = (
  reported: number,
  alreadyRecorded: number,
  resumed: boolean
): number => (resumed ? Math.max(0, reported - alreadyRecorded) : reported);

export const allocateUsage = ({
  posts,
  modelCosts,
  recordedByModel,
  resumed,
}: {
  posts: readonly PostTokens[];
  modelCosts: readonly ModelCost[];
  recordedByModel: ReadonlyMap<string, number>;
  resumed: boolean;
}): AllocatedUsage[] => {
  const rows: AllocatedUsage[] = [];
  const models = new Set([
    ...posts.map((post) => modelKey(post.model)),
    ...modelCosts.map((entry) => modelKey(entry.model)),
  ]);

  for (const model of models) {
    const reported = modelCosts
      .filter((entry) => modelKey(entry.model) === model)
      .reduce((sum, entry) => sum + entry.costUsd, 0);
    const cost = cycleCost(reported, recordedByModel.get(model) ?? 0, resumed);
    const users = posts
      .filter((post) => modelKey(post.model) === model)
      .map((post) => ({ ...post, model }));
    const total = users.reduce((sum, post) => sum + weight(post), 0);

    if (users.length === 0 || total === 0) {
      if (cost > 0) rows.push({ ...emptyPost(model), costUsd: cost });
      continue;
    }
    for (const post of users) {
      rows.push({ ...post, costUsd: (cost * weight(post)) / total });
    }
  }
  return rows;
};
