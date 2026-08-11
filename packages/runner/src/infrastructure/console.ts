const RULE_WIDTH = 72;

export const line = (text = ""): void => {
  process.stdout.write(`${text}\n`);
};

export const rule = (label: string): void => {
  const tail = "=".repeat(Math.max(4, RULE_WIDTH - label.length));
  line(`\n==== ${label} ${tail}`);
};
