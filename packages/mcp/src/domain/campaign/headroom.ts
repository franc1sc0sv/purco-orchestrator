import type {
  Headroom,
  HeadroomLimits,
  HeadroomVerdict,
} from "test-forge-contracts/campaign";

export const BYTES_PER_GIB = 1024 * 1024 * 1024;

export const DEFAULT_MINIMUM_FREE_GIB = 4;

export const DEFAULT_MAXIMUM_CONTAINERS = 40;

export const defaultLimits = (): HeadroomLimits => ({
  minimumFreeBytes: DEFAULT_MINIMUM_FREE_GIB * BYTES_PER_GIB,
  maximumContainers: DEFAULT_MAXIMUM_CONTAINERS,
});

const gibOf = (bytes: number): string => (bytes / BYTES_PER_GIB).toFixed(2);

export const judgeHeadroom = (
  headroom: Headroom,
  limits: HeadroomLimits,
): HeadroomVerdict => {
  const breaches: string[] = [];
  if (headroom.freeDiskBytes < limits.minimumFreeBytes) {
    breaches.push(
      `disk headroom is ${gibOf(
        headroom.freeDiskBytes,
      )} GiB and the floor is ${gibOf(limits.minimumFreeBytes)} GiB`,
    );
  }
  if (
    headroom.containerCount !== null &&
    headroom.containerCount > limits.maximumContainers
  ) {
    breaches.push(
      `${headroom.containerCount} containers are running and the ceiling is ${limits.maximumContainers}`,
    );
  }
  if (!headroom.dockerReachable) {
    breaches.push(
      "docker did not answer, so the container environment cannot be started or counted",
    );
  }
  return { ok: breaches.length === 0, breaches, headroom, limits };
};
