export type BatchFailure = {
  ref: string;
  error: string;
};

export const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const failureOf = (ref: string, error: unknown): BatchFailure => ({
  ref,
  error: messageOf(error),
});
