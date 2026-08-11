import { openDb, run } from "./db/connection.ts";
import { remoteUrl, repoRoot } from "./git.ts";
import { basename, resolve } from "node:path";
import type { Project } from "test-forge-contracts/project";

const cache = new Map<string, Project>();

export const normaliseRemote = (url: string): string =>
  url
    .trim()
    .replace(/^git\+/i, "")
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
    .replace(/^[^@/]+@/, "")
    .replace(/:\d+\//, "/")
    .replace(/:/, "/")
    .replace(/\/+$/, "")
    .replace(/\.git$/i, "")
    .toLowerCase();

export const resolveProject = async (cwd: string): Promise<Project> => {
  const from = resolve(cwd);
  const cached = cache.get(from);
  if (cached) return cached;

  const rootPath = await repoRoot(from);
  const remote = await remoteUrl(from);
  const projectKey = remote ? normaliseRemote(remote) : rootPath;
  const shortName = basename(projectKey) || projectKey;

  run(
    openDb(),
    `INSERT INTO projects (project_key, short_name, remote_url, root_path)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (project_key) DO NOTHING`,
    [projectKey, shortName, remote || null, rootPath],
  );

  const project: Project = { projectKey, shortName, rootPath };
  cache.set(from, project);
  return project;
};

export const projectKeyOf = async (cwd: string): Promise<string> =>
  (await resolveProject(cwd)).projectKey;
