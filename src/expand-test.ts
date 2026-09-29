import { expandPlaceholders, expandedNames } from "./mcp-servers.ts";

const lookup = (name: string): string | undefined =>
  ({ SET_VAR: "from-env", EMPTY_VAR: "" })[name];

const cases: Array<[string, string]> = [
  ["${SET_VAR}", "from-env"],
  ["${MISSING:-fallback}", "fallback"],
  ["${SET_VAR:-fallback}", "from-env"],
  ["${EMPTY_VAR:-fallback}", "fallback"],
  ["${MISSING}", ""],
  ["prefix-${SET_VAR}-suffix", "prefix-from-env-suffix"],
  ["no placeholder", "no placeholder"],
  [
    "${A:-postgresql://u:p@localhost:5432/db}",
    "postgresql://u:p@localhost:5432/db",
  ],
];

let failed = 0;
for (const [input, want] of cases) {
  const got = expandPlaceholders(input, lookup);
  const ok = got === want;
  if (!ok) failed++;
  process.stdout.write(
    `${ok ? "PASS" : "FAIL"}  ${JSON.stringify(input)} -> ${JSON.stringify(got)}${ok ? "" : ` want ${JSON.stringify(want)}`}\n`,
  );
}
process.stdout.write(
  `names: ${JSON.stringify(expandedNames("${A:-x}/${B}"))}\n`,
);
process.stdout.write(`${cases.length - failed}/${cases.length} passed\n`);
process.exit(failed === 0 ? 0 : 1);
