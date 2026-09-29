import type { FailureRecord } from "test-forge-contracts/execution";

const INFRASTRUCTURE_SIGNATURES: readonly string[] = [
  "is being accessed by other users",
  "source database",
  "error creating test database",
  "error dropping test database",
  "terminating connection due to administrator command",
  "the database system is shutting down",
  "connection terminated unexpectedly",
  "econnrefused",
  "econnreset",
  "epipe",
  "__test_db_url__ is not set",
  "container is not running",
  "no such container",
  "cannot connect to the docker daemon",
  "enospc",
  "no space left on device",
];

export const infrastructureSignatureIn = (text: string): string | null => {
  const haystack = text.toLowerCase();
  return (
    INFRASTRUCTURE_SIGNATURES.find((signature) =>
      haystack.includes(signature),
    ) ?? null
  );
};

export const infrastructureFailure = (
  failures: readonly FailureRecord[],
): string | null => {
  for (const failure of failures) {
    const signature = infrastructureSignatureIn(failure.message);
    if (signature !== null) return signature;
  }
  return null;
};
