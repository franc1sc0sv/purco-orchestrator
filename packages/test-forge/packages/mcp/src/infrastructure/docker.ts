import { runProcess } from "./process.ts";

const DOCKER_TIMEOUT_MS = 60_000;

const TESTCONTAINERS_LABEL = "label=org.testcontainers=true";

const dockerOutput = async (
  args: readonly string[],
  path: string | undefined,
): Promise<string[]> => {
  const result = await runProcess({
    command: "docker",
    args,
    cwd: process.cwd(),
    timeoutMs: DOCKER_TIMEOUT_MS,
    env: path === undefined ? {} : { PATH: path },
  });
  if (result.code !== 0) return [];
  return result.stdout.split("\n").filter((line) => line.trim() !== "");
};

export const listTestContainerIds = (
  path: string | undefined,
): Promise<string[]> =>
  dockerOutput(
    ["ps", "--quiet", "--no-trunc", "--filter", TESTCONTAINERS_LABEL],
    path,
  );

export const listRunningContainerIds = (
  path: string | undefined,
): Promise<string[]> => dockerOutput(["ps", "--quiet", "--no-trunc"], path);

export const removeContainers = async (
  ids: readonly string[],
  path: string | undefined,
): Promise<void> => {
  if (ids.length === 0) return;
  await runProcess({
    command: "docker",
    args: ["rm", "--force", "--volumes", ...ids],
    cwd: process.cwd(),
    timeoutMs: DOCKER_TIMEOUT_MS,
    env: path === undefined ? {} : { PATH: path },
  });
};

export const listContainerIdsPublishing = async (
  hostPorts: readonly number[],
  path: string | undefined,
): Promise<string[]> => {
  const lists = await Promise.all(
    hostPorts.map((port) =>
      dockerOutput(
        ["ps", "--quiet", "--no-trunc", "--filter", `publish=${port}`],
        path,
      ),
    ),
  );
  return [...new Set(lists.flat())];
};
