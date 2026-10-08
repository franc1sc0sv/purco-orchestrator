import { runProcess } from "./process.ts";

const DOCKER_TIMEOUT_MS = 60_000;

const TESTCONTAINERS_LABEL = "label=org.testcontainers=true";

const SESSION_LABEL = "org.testcontainers.session-id";

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

export const sessionIdPublishing = async (
  hostPort: number,
  path: string | undefined,
): Promise<string | null> => {
  const [container] = await dockerOutput(
    ["ps", "--quiet", "--no-trunc", "--filter", `publish=${hostPort}`],
    path,
  );
  if (container === undefined) return null;
  const [session] = await dockerOutput(
    [
      "inspect",
      "--format",
      `{{ index .Config.Labels "${SESSION_LABEL}" }}`,
      container,
    ],
    path,
  );
  return session === undefined || session === "" ? null : session;
};

export const listSessionContainerIds = (
  sessionId: string,
  path: string | undefined,
): Promise<string[]> =>
  dockerOutput(
    [
      "ps",
      "--quiet",
      "--no-trunc",
      "--filter",
      `label=${SESSION_LABEL}=${sessionId}`,
    ],
    path,
  );
