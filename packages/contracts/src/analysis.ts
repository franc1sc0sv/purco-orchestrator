export const CHECK_FORMS = ["ast", "grep"] as const;

export type CheckForm = (typeof CHECK_FORMS)[number];

export type CheckSite = {
  line: number;
  quote: string;
};

export type CheckOutcome = {
  checkId: string;
  kind: CheckForm | null;
  expression: string | null;
  evaluable: boolean;
  applied: boolean;
  violated: boolean;
  sites: CheckSite[];
  siteCount: number;
  sitesTruncated: boolean;
  error: string | null;
};

export type FileCheckReport = {
  filePath: string;
  fileHash: string;
  checks: CheckOutcome[];
  appliedCount: number;
  violatedCount: number;
  erroredCount: number;
};

export type Tally = {
  name: string;
  count: number;
};

export type HarnessUtility = Tally & {
  module: string;
};

export type ImportFact = {
  module: string;
  names: string[];
  kind: string;
  line: number;
};

export type AssertionFacts = {
  total: number;
  shapes: Tally[];
  wholeObject: number;
  negated: number;
  snapshot: number;
};

export type IsolationFacts = {
  hooks: Record<string, number>;
  signals: Tally[];
  factories: Tally[];
};

export type TimeControlFacts = {
  controlled: boolean;
  signals: Tally[];
  dateConstructionCount: number;
};

export type MockFacts = {
  used: boolean;
  signals: Tally[];
};

export type TestFact = {
  title: string;
  line: number;
  callee: string;
  depth: number;
  ancestors: string[];
};

export type DescribeFact = {
  title: string;
  line: number;
  callee: string;
  depth: number;
};

export type DeclarationSite = {
  callee: string;
  line: number;
};

export type FileSignals = {
  lineCount: number;
  imports: ImportFact[];
  harnessUtilities: HarnessUtility[];
  assertions: AssertionFacts;
  isolation: IsolationFacts;
  timeControl: TimeControlFacts;
  mocks: MockFacts;
  tests: TestFact[];
  describes: DescribeFact[];
  maxDescribeDepth: number;
  testCount: number;
  focusedOrSkipped: DeclarationSite[];
  jsxElements: Tally[];
  callTally: Tally[];
};

export type FileFactsReport = FileSignals & {
  filePath: string;
  fileHash: string;
  byteLength: number;
};

export type CorpusFile = {
  path: string;
  hash: string;
  lineCount: number;
};

export type CorpusHashReport = {
  hash: string;
  fileCount: number;
  totalLines: number;
  globs: string[];
  files?: CorpusFile[];
};
