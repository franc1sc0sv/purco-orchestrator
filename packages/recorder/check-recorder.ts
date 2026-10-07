import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const STAGING_DIR = path.join("tests", "e2e", ".purco-recording");
const FLOWS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "flows");
const TSC_HEAP = "--max-old-space-size=10240";
const TSCONFIG = {
  extends: "../../../tsconfig.json",
  compilerOptions: { noEmit: true, incremental: false },
  include: ["./*.ts", "../../../types"],
};

const worktree = process.argv[2] ? path.resolve(process.argv[2]) : undefined;
if (!worktree || !fs.existsSync(path.join(worktree, "tests", "e2e", "pages"))) {
  console.error("usage: npm run check:recorder -- <purco-web worktree>");
  process.exit(2);
}

const staged = path.join(worktree, STAGING_DIR);
if (fs.existsSync(staged)) {
  console.error(`${staged} already exists; remove it first`);
  process.exit(2);
}

let status = 1;
try {
  fs.mkdirSync(staged, { recursive: true });
  for (const name of fs.readdirSync(FLOWS_DIR)) {
    fs.copyFileSync(path.join(FLOWS_DIR, name), path.join(staged, name));
  }
  fs.writeFileSync(path.join(staged, "tsconfig.json"), JSON.stringify(TSCONFIG));
  const run = spawnSync("npx", ["tsc", "-p", path.join(STAGING_DIR, "tsconfig.json")], {
    cwd: worktree,
    stdio: "inherit",
    env: { ...process["env"], NODE_OPTIONS: TSC_HEAP },
  });
  status = run.status ?? 1;
} finally {
  fs.rmSync(staged, { recursive: true, force: true });
}
process.exit(status);
