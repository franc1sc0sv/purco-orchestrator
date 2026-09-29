import fs from "node:fs";
import path from "node:path";
import type { RoleName } from "./types.ts";

export type ScratchEntry = {
  key: string;
  value: string;
  at: string;
};

const MAX_ENTRIES = 40;
const MAX_VALUE = 1200;

export class AgentScratch {
  private readonly dir: string;

  constructor(runDir: string) {
    this.dir = path.join(runDir, "scratch");
    fs.mkdirSync(this.dir, { recursive: true });
  }

  private file(role: RoleName): string {
    return path.join(this.dir, `${role}.json`);
  }

  read(role: RoleName): ScratchEntry[] {
    const file = this.file(role);
    if (!fs.existsSync(file)) return [];
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
      return Array.isArray(parsed) ? (parsed as ScratchEntry[]) : [];
    } catch {
      return [];
    }
  }

  write(role: RoleName, key: string, value: string): ScratchEntry[] {
    const entries = this.read(role).filter((entry) => entry.key !== key);
    entries.push({
      key,
      value: value.slice(0, MAX_VALUE),
      at: new Date().toISOString(),
    });
    const kept = entries.slice(-MAX_ENTRIES);
    fs.writeFileSync(this.file(role), JSON.stringify(kept, null, 2));
    return kept;
  }

  clear(role: RoleName): void {
    const file = this.file(role);
    if (fs.existsSync(file)) fs.rmSync(file);
  }
}
