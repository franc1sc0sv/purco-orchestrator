# TEST FORGE — setting up on a new machine

Everything below is one-time. After it, you use `/test-forge` in any checkout of
a repository whose codex you have imported.

## What you are installing

| Piece      | Where it goes                | What it does                                                      |
| ---------- | ---------------------------- | ----------------------------------------------------------------- |
| MCP server | this repo, `packages/mcp`    | Holds all state and computes the predicates. Never reasons.       |
| Runner     | this repo, `packages/runner` | Optional. Hosts an operation so it survives closing the terminal. |
| Skills     | `~/.claude/skills/`          | The four slash commands.                                          |
| Codex      | your own `data/forge.db`     | The testing rules, imported from an export file.                  |

Your `data/` directory is **not** in this repository. It holds your runs,
findings and ranks, which are yours alone. Only the codex is shared, through an
export file.

## 1. Requirements

- **Node 22 or newer.** The server runs TypeScript directly through Node's
  native type stripping, so there is no build step. Check with `node --version`.
- **Docker Desktop**, running. Mutation campaigns start containers.
- The repository you want to test, checked out.

## 2. Install

```bash
git clone <this repo> ~/.claude/testing
cd ~/.claude/testing
npm install
```

## 3. Install the skills

```bash
cp -R ~/.claude/testing/skills/test-forge   ~/.claude/skills/
cp -R ~/.claude/testing/skills/test-rules   ~/.claude/skills/
cp -R ~/.claude/testing/skills/test-replay  ~/.claude/skills/
cp -R ~/.claude/testing/skills/test-status  ~/.claude/skills/
```

## 4. Register the MCP server

```bash
claude mcp add-json test-forge \
  '{"command":"node","args":["'"$HOME"'/.claude/testing/packages/mcp/src/server.ts"]}' \
  --scope user
```

Confirm it connected:

```bash
claude mcp list
```

## 5. Import the codex

Start a **new** Claude Code session inside the repository you want to test, then
ask it to run `codex_import` with the contents of:

```
~/.claude/testing/codex-exports/purco-web-backend.codex.json
```

Imported rules arrive as **advisory**, never blocking. That is deliberate — read
them, and promote the ones you agree with. A rule you have not read should not
be able to fail your gates.

The project is identified by the normalised git remote URL, so importing once
covers every worktree of that repository you have now or create later.

## 6. Verify

- `claude mcp list` shows `test-forge` connected.
- The tool list contains `mutation_campaign_start`, `mutation_batch_run` and
  `board_outcome_record_batch`.
- `/test-status` runs and reports the board.

## Using it

| Command                | What it does                                                                                                           |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `/test-forge <target>` | The full operation. Writes or hardens tests, reviews, runs, mutates, proves. Does not stop until all eight gates pass. |
| `/test-rules`          | Learns or revises the testing rules. Never writes or runs tests.                                                       |
| `/test-status`         | The board. Read-only.                                                                                                  |
| `/test-replay`         | Re-runs recorded past failures against current rules and briefs. Run after any rule or brief change.                   |

Give `/test-forge` your focus directives in the same message. They are honoured
for the whole run.

## Two things that will bite you

**The MCP server loads its code when the process starts.** After you `git pull`,
restart your session. Editing files on disk does not reach a running server, and
the failure is silent — the operation runs happily against the old code.

**Run one mutation campaign at a time.** Six workers is six Vitest processes plus
a container set. Two at once will page and both will be slower.

## If a campaign will not boot

It refuses up front with `DOCKER_CREDENTIAL_HELPER_MISSING`, naming the helper it
looked for and every directory it searched. The usual cause is that
`docker-credential-desktop` is not resolvable from the server's `PATH`. Add
Docker Desktop's `bin` directory to your `PATH`:

```
/Applications/Docker.app/Contents/Resources/bin
```
