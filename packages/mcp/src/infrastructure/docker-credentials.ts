import { accessSync, constants, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

export const DOCKER_CREDENTIAL_HELPER_MISSING =
  "DOCKER_CREDENTIAL_HELPER_MISSING";

const WELL_KNOWN_DIRECTORIES: readonly string[] = [
  "/Applications/Docker.app/Contents/Resources/bin",
  join(homedir(), "Applications", "Docker.app", "Contents", "Resources", "bin"),
  join(homedir(), ".docker", "bin"),
  join(homedir(), ".rd", "bin"),
  "/usr/local/bin",
  "/opt/homebrew/bin",
  "/usr/bin",
];

const DOCKER_CONFIG_PATH = join(homedir(), ".docker", "config.json");

export type CredentialHelperPath =
  | { ok: true; helper: string | null; path: string }
  | { ok: false; helper: string; searched: readonly string[] };

const configuredHelper = (): string | null => {
  let text: string;
  try {
    text = readFileSync(DOCKER_CONFIG_PATH, "utf8");
  } catch {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) return null;
    const store = (parsed as { credsStore?: unknown }).credsStore;
    if (typeof store !== "string" || store.trim() === "") return null;
    return `docker-credential-${store.trim()}`;
  } catch {
    return null;
  }
};

const isExecutable = (path: string): boolean => {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

const entriesOf = (path: string): string[] =>
  path.split(delimiter).filter((entry) => entry !== "");

const uniqueOrder = (entries: readonly string[]): string[] => [
  ...new Set(entries),
];

export const dockerCredentialPath = (
  basePath: string = process.env["PATH"] ?? ""
): CredentialHelperPath => {
  const helper = configuredHelper();
  if (helper === null) return { ok: true, helper: null, path: basePath };

  const onPath = entriesOf(basePath);
  const searched = uniqueOrder([...onPath, ...WELL_KNOWN_DIRECTORIES]);
  const found = searched.find((directory) =>
    isExecutable(join(directory, helper))
  );
  if (found === undefined) return { ok: false, helper, searched };

  return {
    ok: true,
    helper,
    path: onPath.includes(found)
      ? basePath
      : [found, ...onPath].join(delimiter),
  };
};

export const credentialHelperRefusal = (
  helper: string,
  searched: readonly string[]
): string =>
  [
    `${DOCKER_CREDENTIAL_HELPER_MISSING}: docker is configured with credsStore in ${DOCKER_CONFIG_PATH},`,
    `so every container start runs "${helper}", but no executable of that name is in any of these directories:`,
    `${searched.join(", ")}.`,
    "Install Docker Desktop, or put the helper on PATH, or remove credsStore from the docker config,",
    "then start the campaign again.",
  ].join(" ");
