import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { Phase } from "./types.ts";

export type PhaseJournal = {
  phase: string;
  runId: string;
  attempts: number;
  startedAt: string;
  endedAt?: string;
  status: "running" | "done" | "interrupted";
  baseSha: string;
  task: string;
  filesWritten: string[];
};

const MAX_FILES = 200;

const headSha = (worktree: string): string => {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: worktree,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
};

const dirtyFiles = (worktree: string): string[] => {
  try {
    return execFileSync("git", ["status", "--porcelain"], {
      cwd: worktree,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\n")
      .map((line) => line.slice(3).trim())
      .filter((line) => line.length > 0)
      .slice(0, MAX_FILES);
  } catch {
    return [];
  }
};

export class Journal {
  private readonly dir: string;
  private readonly runId: string;
  private readonly worktree: string;

  constructor(runDir: string, runId: string, worktree: string) {
    this.dir = path.join(runDir, "journal");
    this.runId = runId;
    this.worktree = worktree;
    fs.mkdirSync(this.dir, { recursive: true });
  }

  private file(phase: Phase): string {
    return path.join(this.dir, `${phase}.json`);
  }

  read(phase: Phase): PhaseJournal | undefined {
    const file = this.file(phase);
    if (!fs.existsSync(file)) return undefined;
    try {
      return JSON.parse(fs.readFileSync(file, "utf8")) as PhaseJournal;
    } catch {
      return undefined;
    }
  }

  private save(journal: PhaseJournal): void {
    fs.writeFileSync(
      this.file(journal.phase as Phase),
      JSON.stringify(journal, null, 2),
    );
  }

  start(phase: Phase, task: string): PhaseJournal {
    const previous = this.read(phase);
    const journal: PhaseJournal = {
      phase,
      runId: this.runId,
      attempts: (previous?.attempts ?? 0) + 1,
      startedAt: new Date().toISOString(),
      status: "running",
      baseSha: headSha(this.worktree),
      task,
      filesWritten: previous?.filesWritten ?? [],
    };
    this.save(journal);
    return journal;
  }

  recordFile(phase: Phase, file: string): void {
    const journal = this.read(phase);
    if (!journal || journal.filesWritten.includes(file)) return;
    journal.filesWritten = [...journal.filesWritten, file].slice(-MAX_FILES);
    this.save(journal);
  }

  end(phase: Phase, status: "done" | "interrupted"): void {
    const journal = this.read(phase);
    if (!journal) return;
    journal.status = status;
    journal.endedAt = new Date().toISOString();
    this.save(journal);
  }

  markInterrupted(): void {
    for (const name of fs.readdirSync(this.dir)) {
      if (!name.endsWith(".json")) continue;
      const phase = name.replace(/\.json$/, "") as Phase;
      const journal = this.read(phase);
      if (journal?.status === "running") this.end(phase, "interrupted");
    }
  }

  resumeNote(phase: Phase): string {
    const journal = this.read(phase);
    if (!journal || journal.attempts <= 1) return "";
    const dirty = dirtyFiles(this.worktree);
    return [
      `## This phase was interrupted and is being resumed (attempt ${journal.attempts})`,
      "",
      `It started at ${journal.startedAt} from commit ${journal.baseSha}.`,
      "",
      journal.filesWritten.length > 0
        ? `Files a previous attempt wrote:\n${journal.filesWritten.map((f) => `- ${f}`).join("\n")}`
        : "A previous attempt wrote no files.",
      "",
      dirty.length > 0
        ? `The worktree is dirty now:\n${dirty.map((f) => `- ${f}`).join("\n")}`
        : "The worktree is clean now.",
      "",
      "Read what is already on disk before you write anything. Continue from",
      "that state. Do not start again from nothing, and do not undo work that",
      "is already correct. Call `scratch_read` for the notes you left yourself.",
    ].join("\n");
  }
}
