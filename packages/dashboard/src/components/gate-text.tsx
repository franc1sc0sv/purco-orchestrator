import type { ReactNode } from "react";
import { ToneBadge } from "@/components/state-badge";

type Block =
  | { kind: "title"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "footer"; text: string };

const HEADING = /^[A-Z][^.!?]{2,70}:$/;
const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+/;
const LABEL = /^([A-Z][A-Za-z0-9 ()/'-]{1,40}):\s+(.+)$/;
const RISK = /^(High|Medium|Low)(?: risk)?:\s*(.+)$/i;
const CODE_TOKEN =
  /(`[^`]+`|\b[\w./-]+\.(?:tsx?|jsx?|md|sql|json|prisma|mjs|mts)(?::\d+)?\b|\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b|\b[a-z]+(?:[A-Z][a-z0-9]+)+\b|\b[0-9a-f]{7,40}\b)/g;

const RISK_TONE = { high: "burn", medium: "waiting", low: "done" } as const;

export const parseGateText = (text: string): Block[] => {
  const lines = text.replace(/\r/g, "").split("\n");
  const blocks: Block[] = [];
  let footer = false;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line.trim().length === 0) continue;
    if (line.trim() === "---") {
      footer = true;
      continue;
    }
    if (footer) {
      blocks.push({ kind: "footer", text: line.trim() });
      continue;
    }
    if (blocks.length === 0) {
      blocks.push({ kind: "title", text: line.trim() });
      continue;
    }
    if (BULLET.test(line)) {
      const item = line.replace(BULLET, "");
      const last = blocks.at(-1);
      if (last?.kind === "list") last.items.push(item);
      else blocks.push({ kind: "list", items: [item] });
      continue;
    }
    if (HEADING.test(line.trim())) {
      blocks.push({ kind: "heading", text: line.trim().slice(0, -1) });
      continue;
    }
    blocks.push({ kind: "paragraph", text: line.trim() });
  }
  return blocks;
};

const Inline = ({ text }: { text: string }) => {
  const parts: ReactNode[] = [];
  let index = 0;
  for (const match of text.matchAll(CODE_TOKEN)) {
    const start = match.index ?? 0;
    if (start > index) parts.push(text.slice(index, start));
    const token = match[0].replace(/^`|`$/g, "");
    parts.push(
      <code key={start} className="bg-muted rounded px-1 py-0.5 font-mono text-[0.85em]">
        {token}
      </code>,
    );
    index = start + match[0].length;
  }
  if (index < text.length) parts.push(text.slice(index));
  return <>{parts}</>;
};

const Labeled = ({ text }: { text: string }) => {
  const risk = RISK.exec(text);
  if (risk) {
    const level = risk[1].toLowerCase() as keyof typeof RISK_TONE;
    return (
      <span className="flex items-start gap-2">
        <ToneBadge tone={RISK_TONE[level]} dot={false} className="mt-0.5 shrink-0">
          {level}
        </ToneBadge>
        <span>
          <Inline text={risk[2]} />
        </span>
      </span>
    );
  }
  const label = LABEL.exec(text);
  if (label) {
    return (
      <span>
        <span className="font-semibold">{label[1]}:</span> <Inline text={label[2]} />
      </span>
    );
  }
  return <Inline text={text} />;
};

export const GateText = ({ text }: { text: string }) => (
  <div className="grid max-w-4xl gap-3 text-sm leading-relaxed">
    {parseGateText(text).map((block, index) => {
      if (block.kind === "title") {
        return (
          <h3 key={index} className="text-base font-semibold">
            <Inline text={block.text} />
          </h3>
        );
      }
      if (block.kind === "heading") {
        return (
          <h4 key={index} className="text-muted-foreground mt-2 border-b pb-1 text-xs font-semibold tracking-wider uppercase">
            {block.text}
          </h4>
        );
      }
      if (block.kind === "list") {
        return (
          <ul key={index} className="grid list-disc gap-1.5 pl-5 marker:text-muted-foreground">
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>
                <Labeled text={item} />
              </li>
            ))}
          </ul>
        );
      }
      if (block.kind === "footer") {
        return (
          <p key={index} className="text-muted-foreground mt-2 border-t pt-3 text-xs">
            {block.text}
          </p>
        );
      }
      return (
        <p key={index}>
          <Labeled text={block.text} />
        </p>
      );
    })}
  </div>
);
