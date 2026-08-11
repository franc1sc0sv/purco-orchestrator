export const SCOPES = ["backend", "frontend"] as const;

export type Scope = (typeof SCOPES)[number];

export type ProjectKey = string;

export type Project = {
  projectKey: ProjectKey;
  shortName: string;
  rootPath: string;
};

export const isScope = (value: unknown): value is Scope =>
  typeof value === "string" && SCOPES.includes(value as Scope);
