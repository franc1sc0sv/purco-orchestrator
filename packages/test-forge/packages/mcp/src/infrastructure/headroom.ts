import { runProcess } from "./process.ts";
import { statfsSync } from "node:fs";
import type { Headroom } from "test-forge-contracts/campaign";

const DOCKER_TIMEOUT_MS = 15_000;

const diskOf = (
  path: string,
): { freeDiskBytes: number; totalDiskBytes: number } => {
  try {
    const stats = statfsSync(path);
    return {
      freeDiskBytes: stats.bavail * stats.bsize,
      totalDiskBytes: stats.blocks * stats.bsize,
    };
  } catch {
    return { freeDiskBytes: 0, totalDiskBytes: 0 };
  }
};

export const readDisk = diskOf;

export const readContainers = async (): Promise<{
  containerCount: number | null;
  dockerReachable: boolean;
}> => {
  const result = await runProcess({
    command: "docker",
    args: ["ps", "--format", "{{.ID}}"],
    cwd: process.cwd(),
    timeoutMs: DOCKER_TIMEOUT_MS,
  });
  if (result.code !== 0 || result.spawnError !== null) {
    return { containerCount: null, dockerReachable: false };
  }
  const lines = result.stdout.split("\n").filter((line) => line.trim() !== "");
  return { containerCount: lines.length, dockerReachable: true };
};

export const readHeadroom = async (path: string): Promise<Headroom> => ({
  ...diskOf(path),
  ...(await readContainers()),
});

export const readDiskOnlyHeadroom = (path: string): Headroom => ({
  ...diskOf(path),
  containerCount: null,
  dockerReachable: true,
});
