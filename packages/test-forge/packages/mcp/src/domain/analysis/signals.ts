import type { SourceFacts } from "./source-facts.ts";
import {
  classifyDeclaration,
  HOOK_NAMES,
  TEST_DECLARERS,
} from "./source-facts.ts";
import type { FileSignals, Tally } from "test-forge-contracts/analysis";

const MAX_CALL_TALLY = 40;

const MOCK_CALLEES: ReadonlySet<string> = new Set([
  "vi.mock",
  "vi.doMock",
  "vi.spyOn",
  "vi.fn",
  "vi.stubGlobal",
  "jest.mock",
  "jest.doMock",
  "jest.spyOn",
  "jest.fn",
  "sinon.stub",
  "sinon.spy",
  "sinon.mock",
  "setupServer",
  "setupWorker",
  "nock",
]);

const MOCK_SUFFIXES: ReadonlySet<string> = new Set([
  "mockResolvedValue",
  "mockResolvedValueOnce",
  "mockRejectedValue",
  "mockRejectedValueOnce",
  "mockReturnValue",
  "mockReturnValueOnce",
  "mockImplementation",
  "mockImplementationOnce",
  "mockClear",
  "mockReset",
]);

const TIME_CALLEES: ReadonlySet<string> = new Set([
  "vi.useFakeTimers",
  "vi.useRealTimers",
  "vi.setSystemTime",
  "vi.advanceTimersByTime",
  "vi.advanceTimersByTimeAsync",
  "vi.runAllTimers",
  "jest.useFakeTimers",
  "jest.useRealTimers",
  "jest.setSystemTime",
  "jest.advanceTimersByTime",
  "sinon.useFakeTimers",
  "MockDate.set",
  "MockDate.reset",
  "Date.now",
]);

const ISOLATION_PATTERN =
  /truncat|rollback|reset|clean|teardown|transaction|isolat|seed|recorder|captureDb|withDb|testContext|createContext/i;

const FACTORY_PATTERN =
  /Factory$|^create[A-Z]|^make[A-Z]|^build[A-Z]|^seed[A-Z]/;

const WHOLE_OBJECT_MATCHERS = ["toEqual", "toStrictEqual", "toMatchObject"];

const FOCUS_PATTERN = /\.(skip|only|todo|failing)$/;

export const tally = (values: readonly string[]): Tally[] => {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort(
      (left, right) =>
        right.count - left.count || left.name.localeCompare(right.name)
    );
};

export const signalsOf = (facts: SourceFacts): FileSignals => {
  const calleeNames = facts.callSites.map((site) => site.callee);
  const importedNames = new Map<string, string>();
  for (const entry of facts.imports) {
    for (const name of entry.names) importedNames.set(name, entry.module);
  }

  const harnessUtilities = tally(
    facts.callSites
      .filter((site) => importedNames.has(site.base))
      .map((site) => site.base)
  ).map((entry) => ({
    ...entry,
    module: importedNames.get(entry.name) ?? "",
  }));

  const mockSignals = tally(
    calleeNames.filter(
      (callee) =>
        MOCK_CALLEES.has(callee) ||
        MOCK_SUFFIXES.has(callee.split(".").at(-1) ?? "")
    )
  );

  const timeSignals = tally(
    calleeNames.filter((callee) => TIME_CALLEES.has(callee))
  );

  const hooks: Record<string, number> = {};
  for (const hook of HOOK_NAMES) {
    hooks[hook] = facts.callSites.filter(
      (site) =>
        site.callee === hook ||
        (TEST_DECLARERS.has(site.base) && site.last === hook)
    ).length;
  }

  return {
    lineCount: facts.lineCount,
    imports: facts.imports.map(({ module, names, kind, line }) => ({
      module,
      names,
      kind,
      line,
    })),
    harnessUtilities,
    assertions: {
      total: facts.assertions.length,
      shapes: tally(facts.assertions.map((entry) => entry.matcher)),
      wholeObject: facts.assertions.filter((entry) =>
        WHOLE_OBJECT_MATCHERS.includes(entry.matcher)
      ).length,
      negated: facts.assertions.filter((entry) =>
        entry.modifiers.includes("not")
      ).length,
      snapshot: facts.assertions.filter((entry) =>
        /Snapshot/i.test(entry.matcher)
      ).length,
    },
    isolation: {
      hooks,
      signals: tally(
        calleeNames.filter((callee) => ISOLATION_PATTERN.test(callee))
      ),
      factories: tally(
        calleeNames.filter((callee) =>
          callee.split(".").some((segment) => FACTORY_PATTERN.test(segment))
        )
      ),
    },
    timeControl: {
      controlled: timeSignals.length > 0,
      signals: timeSignals,
      dateConstructionCount: facts.callSites.filter(
        (site) => site.isNew && site.callee === "Date"
      ).length,
    },
    mocks: { used: mockSignals.length > 0, signals: mockSignals },
    tests: facts.tests,
    describes: facts.describes,
    maxDescribeDepth: facts.maxDescribeDepth,
    testCount: facts.tests.length,
    focusedOrSkipped: facts.callSites
      .filter((site) => {
        const kind = classifyDeclaration(site.callee);
        return (
          (kind === "test" || kind === "suite") &&
          FOCUS_PATTERN.test(site.callee)
        );
      })
      .map((site) => ({ callee: site.callee, line: site.line })),
    jsxElements: tally(facts.jsxElements.map((entry) => entry.name)).slice(
      0,
      MAX_CALL_TALLY
    ),
    callTally: tally(calleeNames).slice(0, MAX_CALL_TALLY),
  };
};
