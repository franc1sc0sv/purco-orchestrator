import {
  addEdge,
  addNode,
  emptyGraph,
  nodeList,
  summarize,
} from "../../domain/closure/graph.ts";
import type { ClosureCounts } from "../../domain/closure/graph.ts";
import { openDb, run, tx } from "../../infrastructure/db/connection.ts";
import {
  SOURCE_EXTENSIONS,
  listSourceFiles,
  readSourceFile,
} from "../../infrastructure/files.ts";
import { projectKeyOf } from "../../infrastructure/project.ts";
import { dirname, relative, resolve, sep } from "node:path";
import type { ClosureEdge, ClosureNode } from "test-forge-contracts/closure";

export type ClosureComputeInput = {
  cwd: string;
  entryFiles: readonly string[];
  runId?: number | undefined;
};

export type ClosureComputeCounts = ClosureCounts & { indexedFiles: number };

export type ClosureComputeResult = {
  nodes: ClosureNode[];
  edges: ClosureEdge[];
  counts: ClosureComputeCounts;
};

type IndexedFile = {
  path: string;
  text: string;
  imports: string[];
};

type SourceIndex = {
  files: Map<string, IndexedFile>;
  importers: Map<string, Set<string>>;
};

type TableWrite = {
  table: string;
  operation: string;
  columns: string[];
};

type EntryWrite = TableWrite & { from: string };

type TableRead = {
  table: string;
  operation: string;
};

type HookUsage = {
  path: string;
  procedurePath: string;
};

const SHARED_PATH =
  /(^|\/)(shared|common|utils|util|lib|libs|helpers|core)(\/|$)/;
const TEST_PATH = /(\.|-)(test|spec)\.[cm]?[jt]sx?$/;
const ROUTE_PATH = /(^|\/)(pages|app)\//;
const HANDLER_PATH = /(handler|subscriber|listener|consumer)/i;
const HANDLER_SHAPE =
  /implements\s+I?EventHandler|@EventsHandler|extends\s+EventHandler|registerHandler/;
const ROUTER_SHAPE =
  /createTRPCRouter|t\.router\s*\(|publicProcedure|protectedProcedure/;
const BACKEND_DEPENDENCY = /use-?case|service|repositor|handler/i;

const EXTERNAL_MARKERS: readonly { id: string; pattern: RegExp }[] = [
  { id: "stripe", pattern: /\bStripe\b|stripe\./ },
  {
    id: "aws-s3",
    pattern: /S3Client|@aws-sdk\/client-s3|getSignedUrl|createPresigned/,
  },
  {
    id: "aws-eventbridge",
    pattern: /EventBridge|PutEventsCommand|Scheduler(Client|Command)/,
  },
  {
    id: "email",
    pattern: /nodemailer|sendgrid|@aws-sdk\/client-ses|SESClient|sendEmail/i,
  },
  { id: "http", pattern: /\bfetch\s*\(|\baxios\b|got\s*\(/ },
  { id: "storage", pattern: /@google-cloud\/storage|Bucket\(|uploadFile/ },
  { id: "queue", pattern: /SQSClient|SendMessageCommand|bullmq|Queue\(/ },
];

const group = (match: RegExpExecArray, index: number): string =>
  match[index] ?? "";

const toPosix = (path: string): string => path.split(sep).join("/");

const importSpecifiers = (text: string): string[] => {
  const specifiers: string[] = [];
  const patterns = [
    /\bfrom\s+["']([^"']+)["']/g,
    /\bimport\s+["']([^"']+)["']/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null)
      specifiers.push(group(match, 1));
  }
  return specifiers;
};

const resolveSpecifier = (
  specifier: string,
  fromPath: string,
  fileSet: ReadonlySet<string>,
): string | null => {
  let base: string;
  if (specifier.startsWith(".")) {
    base = resolve(`/${dirname(fromPath)}`, specifier).slice(1);
  } else if (specifier.startsWith("~/") || specifier.startsWith("@/")) {
    base = `src/${specifier.slice(2)}`;
  } else {
    return null;
  }
  const candidates = [
    base,
    ...SOURCE_EXTENSIONS.map((extension) => base + extension),
    ...SOURCE_EXTENSIONS.map((extension) => `${base}/index${extension}`),
  ];
  return candidates.find((candidate) => fileSet.has(candidate)) ?? null;
};

const buildIndex = (root: string): SourceIndex => {
  const files = new Map<string, IndexedFile>();
  for (const relativePath of listSourceFiles(root)) {
    const text = readSourceFile(root, relativePath);
    if (text === null) continue;
    files.set(relativePath, { path: relativePath, text, imports: [] });
  }
  const fileSet = new Set(files.keys());
  const importers = new Map<string, Set<string>>();
  for (const file of files.values()) {
    for (const specifier of importSpecifiers(file.text)) {
      const target = resolveSpecifier(specifier, file.path, fileSet);
      if (target === null || target === file.path) continue;
      file.imports.push(target);
      const known = importers.get(target);
      if (known) known.add(file.path);
      else importers.set(target, new Set([file.path]));
    }
  }
  return { files, importers };
};

const importersOf = (index: SourceIndex, path: string): ReadonlySet<string> =>
  index.importers.get(path) ?? new Set<string>();

const exportedSymbols = (text: string): string[] => {
  const symbols = new Set<string>();
  const patterns = [
    /export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)/g,
    /export\s+(?:const|let|var)\s+([A-Za-z0-9_$]+)/g,
    /export\s+(?:abstract\s+)?class\s+([A-Za-z0-9_$]+)/g,
    /export\s+(?:type|interface|enum)\s+([A-Za-z0-9_$]+)/g,
    /export\s+default\s+(?:async\s+)?(?:function|class)\s+([A-Za-z0-9_$]+)/g,
    /(?:^|\n)\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z0-9_$]+)/g,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) symbols.add(group(match, 1));
  }
  return [...symbols];
};

const normalizeTable = (raw: string): string => {
  const lowered = raw.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  return lowered.endsWith("s") ? lowered.slice(0, -1) : lowered;
};

const objectKeysAfter = (text: string, startIndex: number): string[] => {
  const open = text.indexOf("{", startIndex);
  if (open === -1) return [];
  let depth = 0;
  let end = -1;
  for (let index = open; index < text.length; index += 1) {
    const character = text[index];
    if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        end = index;
        break;
      }
    }
  }
  if (end === -1) return [];
  const body = text.slice(open + 1, end);
  const keys = new Set<string>();
  let depthInBody = 0;
  let current = "";
  const collect = (fragment: string): void => {
    const key = /^\s*([A-Za-z0-9_$]+)\s*:/.exec(fragment);
    if (key) keys.add(group(key, 1));
  };
  for (const character of body) {
    if ("{[(".includes(character)) depthInBody += 1;
    else if ("}])".includes(character)) depthInBody -= 1;
    if (character === "," && depthInBody === 0) {
      collect(current);
      current = "";
      continue;
    }
    current += character;
  }
  collect(current);
  return [...keys];
};

const extractWrites = (text: string): TableWrite[] => {
  const writes: TableWrite[] = [];
  const prisma =
    /\.([a-zA-Z][A-Za-z0-9_]*)\.(create|createMany|createManyAndReturn|update|updateMany|upsert|delete|deleteMany)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = prisma.exec(text)) !== null) {
    const dataIndex = text.indexOf("data", match.index);
    const columns =
      dataIndex !== -1 && dataIndex - match.index < 400
        ? objectKeysAfter(text, dataIndex)
        : [];
    writes.push({
      table: normalizeTable(group(match, 1)),
      operation: group(match, 2),
      columns,
    });
  }
  const kysely =
    /\.(insertInto|updateTable|deleteFrom)\s*\(\s*["']([^"']+)["']\s*\)/g;
  while ((match = kysely.exec(text)) !== null) {
    const anchors = [
      text.indexOf(".set(", match.index),
      text.indexOf(".values(", match.index),
    ]
      .filter((position) => position !== -1)
      .sort((left, right) => left - right);
    const anchor = anchors[0];
    writes.push({
      table: normalizeTable(group(match, 2)),
      operation: group(match, 1),
      columns: anchor === undefined ? [] : objectKeysAfter(text, anchor),
    });
  }
  return writes;
};

const extractReads = (text: string): TableRead[] => {
  const reads: TableRead[] = [];
  const prisma =
    /\.([a-zA-Z][A-Za-z0-9_]*)\.(findMany|findFirst|findFirstOrThrow|findUnique|findUniqueOrThrow|count|aggregate|groupBy)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = prisma.exec(text)) !== null) {
    reads.push({
      table: normalizeTable(group(match, 1)),
      operation: group(match, 2),
    });
  }
  const kysely = /\.selectFrom\s*\(\s*["']([^"']+)["']\s*\)/g;
  while ((match = kysely.exec(text)) !== null) {
    reads.push({
      table: normalizeTable(group(match, 1)),
      operation: "selectFrom",
    });
  }
  const rawSql =
    /\bselect\b[\s\S]{0,400}?\bfrom\s+["'`]?([a-z_][a-z0-9_]*)["'`]?/gi;
  while ((match = rawSql.exec(text)) !== null) {
    reads.push({ table: normalizeTable(group(match, 1)), operation: "sql" });
  }
  return reads;
};

const extractPublishedEvents = (text: string): string[] => {
  const events = new Set<string>();
  const patterns = [
    /\.(?:publish|publishAll|dispatch|emit|addDomainEvent)\s*\(\s*new\s+([A-Z][A-Za-z0-9_]*)/g,
    /\bnew\s+([A-Z][A-Za-z0-9_]*Event)\s*\(/g,
    /domainEvents\.push\s*\(\s*new\s+([A-Z][A-Za-z0-9_]*)/g,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) events.add(group(match, 1));
  }
  return [...events];
};

const extractExternals = (text: string): string[] =>
  EXTERNAL_MARKERS.filter((marker) => marker.pattern.test(text)).map(
    (marker) => marker.id,
  );

const isHandlerFile = (file: IndexedFile): boolean =>
  HANDLER_PATH.test(file.path) || HANDLER_SHAPE.test(file.text);

const handlersOfEvent = (index: SourceIndex, eventName: string): string[] => {
  const word = new RegExp(`\\b${eventName}\\b`);
  const handlers: string[] = [];
  for (const file of index.files.values()) {
    if (TEST_PATH.test(file.path)) continue;
    if (!word.test(file.text)) continue;
    if (!isHandlerFile(file)) continue;
    handlers.push(file.path);
  }
  return handlers;
};

const mentionsAny = (text: string, symbols: readonly string[]): boolean =>
  symbols.some((symbol) => new RegExp(`\\b${symbol}\\b`).test(text));

const routerFilesFor = (
  index: SourceIndex,
  symbols: readonly string[],
): IndexedFile[] => {
  const found: IndexedFile[] = [];
  for (const file of index.files.values()) {
    if (TEST_PATH.test(file.path)) continue;
    if (!ROUTER_SHAPE.test(file.text)) continue;
    if (!mentionsAny(file.text, symbols)) continue;
    found.push(file);
  }
  return found;
};

const routerMounts = (index: SourceIndex): Map<string, Set<string>> => {
  const mounts = new Map<string, Set<string>>();
  const fileSet = new Set(index.files.keys());
  for (const file of index.files.values()) {
    if (!/\bappRouter\b/.test(file.text)) continue;
    const symbolToPath = new Map<string, string>();
    const importPattern =
      /import\s+\{?\s*([A-Za-z0-9_,\s]+?)\s*\}?\s+from\s+["']([^"']+)["']/g;
    let match: RegExpExecArray | null;
    while ((match = importPattern.exec(file.text)) !== null) {
      const target = resolveSpecifier(group(match, 2), file.path, fileSet);
      if (target === null) continue;
      for (const raw of group(match, 1).split(",")) {
        const symbol = raw
          .trim()
          .split(/\s+as\s+/)
          .pop();
        if (symbol) symbolToPath.set(symbol, target);
      }
    }
    const mountPattern = /([A-Za-z0-9_]+)\s*:\s*([A-Za-z0-9_]*[Rr]outer)\b/g;
    while ((match = mountPattern.exec(file.text)) !== null) {
      const target = symbolToPath.get(group(match, 2));
      if (target === undefined) continue;
      const known = mounts.get(target);
      if (known) known.add(group(match, 1));
      else mounts.set(target, new Set([group(match, 1)]));
    }
  }
  return mounts;
};

const proceduresReferencing = (
  file: IndexedFile,
  symbols: readonly string[],
): string[] => {
  const anchors: { name: string; index: number }[] = [];
  const pattern =
    /(?:^|\n)\s*([A-Za-z0-9_]+)\s*:\s*(?:[A-Za-z0-9_]*[Pp]rocedure|t\.procedure)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(file.text)) !== null) {
    anchors.push({ name: group(match, 1), index: match.index });
  }
  const named: string[] = [];
  for (let position = 0; position < anchors.length; position += 1) {
    const anchor = anchors[position];
    if (anchor === undefined) continue;
    const next = anchors[position + 1];
    const body = file.text.slice(
      anchor.index,
      next === undefined ? file.text.length : next.index,
    );
    if (mentionsAny(body, symbols)) named.push(anchor.name);
  }
  return named;
};

const hookUsages = (
  index: SourceIndex,
  procedurePaths: readonly string[],
): HookUsage[] => {
  const usages: HookUsage[] = [];
  for (const file of index.files.values()) {
    if (TEST_PATH.test(file.path)) continue;
    for (const procedurePath of procedurePaths) {
      const pattern = new RegExp(
        `\\b(?:api|trpc|client)\\.${procedurePath.replace(/\./g, "\\.")}\\b`,
      );
      if (pattern.test(file.text))
        usages.push({ path: file.path, procedurePath });
    }
  }
  return usages;
};

const consumedProcedurePaths = (text: string): string[] => {
  const paths = new Set<string>();
  const pattern =
    /\b(?:api|trpc|client)\.([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)\.(?:useQuery|useMutation|useSuspenseQuery|useInfiniteQuery|query|mutate)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null)
    paths.add(`${group(match, 1)}.${group(match, 2)}`);
  return [...paths];
};

const persistNodes = async (
  cwd: string,
  runId: number,
  nodes: readonly ClosureNode[],
): Promise<void> => {
  const db = openDb();
  const key = await projectKeyOf(cwd);
  tx(db, (txScope) => {
    for (const node of nodes) {
      run(
        txScope.db,
        "INSERT OR IGNORE INTO radius_nodes (project_key, run_id, node_ref, node_kind) VALUES (?, ?, ?, ?)",
        [key, runId, node.id, node.kind],
      );
    }
  });
};

export const closureCompute = async ({
  cwd,
  entryFiles,
  runId,
}: ClosureComputeInput): Promise<ClosureComputeResult> => {
  const root = resolve(cwd);
  const index = buildIndex(root);
  const entries = entryFiles.map((entry) =>
    toPosix(entry.startsWith(root) ? relative(root, entry) : entry),
  );

  const graph = emptyGraph();
  const entryIds = new Map<string, string>();
  const entrySymbols: string[] = [];
  const writes: EntryWrite[] = [];
  const events = new Set<string>();
  const externals = new Set<string>();
  const consumedPaths = new Set<string>();

  for (const entry of entries) {
    const file = index.files.get(entry);
    const text = file ? file.text : readSourceFile(root, entry);
    const { node } = addNode(graph, {
      kind: "entry",
      path: entry,
      reachedVia: "run focus",
      hops: 0,
    });
    entryIds.set(entry, node.id);
    if (text === null) continue;
    entrySymbols.push(...exportedSymbols(text));
    for (const write of extractWrites(text))
      writes.push({ ...write, from: node.id });
    for (const event of extractPublishedEvents(text)) events.add(event);
    for (const external of extractExternals(text)) externals.add(external);
    for (const procedurePath of consumedProcedurePaths(text))
      consumedPaths.add(procedurePath);
  }

  const symbols = [...new Set(entrySymbols)];
  const primaryEntryId = [...entryIds.values()][0] ?? "";

  for (const entry of entries) {
    const from = entryIds.get(entry) ?? primaryEntryId;
    for (const caller of importersOf(index, entry)) {
      if (TEST_PATH.test(caller)) continue;
      const { node } = addNode(graph, {
        kind: "caller",
        path: caller,
        reachedVia: `imports ${entry}`,
        hops: 1,
      });
      addEdge(graph, {
        from,
        to: node.id,
        kind: "caller",
        detail: "one hop from the unit under test",
      });
    }
  }

  for (const write of writes) {
    const changedColumns = write.columns;
    const visited = new Set(entries);
    for (const file of index.files.values()) {
      if (visited.has(file.path) || TEST_PATH.test(file.path)) continue;
      const reads = extractReads(file.text);
      if (!reads.some((read) => read.table === write.table)) continue;
      const touchesColumn =
        changedColumns.length === 0 ||
        changedColumns.some((column) =>
          new RegExp(`\\b${column}\\b`).test(file.text),
        );
      if (!touchesColumn) continue;
      visited.add(file.path);
      const via = `reads ${write.table}${
        changedColumns.length > 0 ? ` (${changedColumns.join(",")})` : ""
      }`;
      const { node } = addNode(graph, {
        kind: "consumer",
        path: file.path,
        reachedVia: via,
        hops: 1,
      });
      addEdge(graph, {
        from: write.from,
        to: node.id,
        kind: "mutation-consumer",
        detail: via,
      });
      const shapeChanged =
        exportedSymbols(file.text).length > 0 &&
        changedColumns.some((column) =>
          new RegExp(
            `\\b(select|return|map|as)\\b[\\s\\S]{0,400}\\b${column}\\b`,
          ).test(file.text),
        );
      if (!shapeChanged) continue;
      for (const consumerOfConsumer of importersOf(index, file.path)) {
        if (
          visited.has(consumerOfConsumer) ||
          TEST_PATH.test(consumerOfConsumer)
        )
          continue;
        visited.add(consumerOfConsumer);
        const next = addNode(graph, {
          kind: "consumer",
          path: consumerOfConsumer,
          reachedVia: `shape change from ${file.path}`,
          hops: 2,
        });
        addEdge(graph, {
          from: node.id,
          to: next.node.id,
          kind: "mutation-consumer",
          detail: "followed because the returned shape changed",
        });
      }
    }
  }

  const seenEvents = new Set<string>();
  const eventQueue = [...events].map((name) => ({
    name,
    hops: 1,
    from: primaryEntryId,
  }));
  while (eventQueue.length > 0) {
    const current = eventQueue.shift();
    if (current === undefined) break;
    if (seenEvents.has(current.name)) continue;
    seenEvents.add(current.name);
    for (const handlerPath of handlersOfEvent(index, current.name)) {
      const { node, added } = addNode(graph, {
        kind: "handler",
        path: handlerPath,
        reachedVia: `handles ${current.name}`,
        hops: current.hops,
      });
      addEdge(graph, {
        from: current.from,
        to: node.id,
        kind: "event-handler",
        detail: current.name,
      });
      if (!added) continue;
      const handlerFile = index.files.get(handlerPath);
      if (handlerFile === undefined) continue;
      for (const nested of extractPublishedEvents(handlerFile.text)) {
        if (seenEvents.has(nested)) continue;
        eventQueue.push({
          name: nested,
          hops: current.hops + 1,
          from: node.id,
        });
      }
      for (const external of extractExternals(handlerFile.text))
        externals.add(external);
    }
  }

  for (const entry of entries) {
    if (!SHARED_PATH.test(entry)) continue;
    const visited = new Set([entry]);
    const queue = [
      { path: entry, hops: 1, from: entryIds.get(entry) ?? primaryEntryId },
    ];
    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) break;
      for (const importer of importersOf(index, current.path)) {
        if (visited.has(importer) || TEST_PATH.test(importer)) continue;
        visited.add(importer);
        const { node } = addNode(graph, {
          kind: "shared-caller",
          path: importer,
          reachedVia: `transitive caller of shared ${entry}`,
          hops: current.hops,
        });
        addEdge(graph, {
          from: current.from,
          to: node.id,
          kind: "shared-caller",
          detail: "change is inside the shared symbol",
        });
        queue.push({ path: importer, hops: current.hops + 1, from: node.id });
      }
    }
  }

  for (const external of externals) {
    const { node } = addNode(graph, {
      kind: "external",
      path: external,
      reachedVia: "external side effect reached by the closure",
      hops: 1,
    });
    addEdge(graph, {
      from: primaryEntryId,
      to: node.id,
      kind: "external",
      detail: external,
    });
  }

  const mounts = routerMounts(index);
  const procedurePaths = new Set<string>();
  const procedureNodeByPath = new Map<string, string>();
  if (symbols.length > 0) {
    for (const routerFile of routerFilesFor(index, symbols)) {
      const mountNames = [...(mounts.get(routerFile.path) ?? [])];
      const procedures = proceduresReferencing(routerFile, symbols);
      const labels =
        procedures.length > 0 && mountNames.length > 0
          ? mountNames.flatMap((mount) =>
              procedures.map((procedure) => `${mount}.${procedure}`),
            )
          : procedures;
      const via =
        labels.length > 0
          ? `exposes ${labels.join(", ")}`
          : "router references the unit under test";
      const { node } = addNode(graph, {
        kind: "procedure",
        path: routerFile.path,
        reachedVia: via,
        hops: 1,
      });
      for (const label of labels) {
        procedurePaths.add(label);
        procedureNodeByPath.set(label, node.id);
      }
      addEdge(graph, {
        from: primaryEntryId,
        to: node.id,
        kind: "router",
        detail: via,
      });
    }
  }

  for (const usage of hookUsages(index, [...procedurePaths])) {
    const hook = addNode(graph, {
      kind: "hook",
      path: usage.path,
      reachedVia: `calls ${usage.procedurePath}`,
      hops: 2,
    });
    addEdge(graph, {
      from: procedureNodeByPath.get(usage.procedurePath) ?? primaryEntryId,
      to: hook.node.id,
      kind: "hook",
      detail: usage.procedurePath,
    });
    const componentQueue = [{ path: usage.path, hops: 3, from: hook.node.id }];
    const visited = new Set([usage.path]);
    while (componentQueue.length > 0) {
      const current = componentQueue.shift();
      if (current === undefined) break;
      for (const importer of importersOf(index, current.path)) {
        if (visited.has(importer) || TEST_PATH.test(importer)) continue;
        visited.add(importer);
        if (ROUTE_PATH.test(importer)) {
          const route = addNode(graph, {
            kind: "route",
            path: importer,
            reachedVia: `renders ${current.path}`,
            hops: current.hops,
          });
          addEdge(graph, {
            from: current.from,
            to: route.node.id,
            kind: "route",
            detail: "route rendering the changed field",
          });
          continue;
        }
        const component = addNode(graph, {
          kind: "component",
          path: importer,
          reachedVia: `renders data from ${usage.procedurePath}`,
          hops: current.hops,
        });
        addEdge(graph, {
          from: current.from,
          to: component.node.id,
          kind: "component",
          detail: usage.procedurePath,
        });
        componentQueue.push({
          path: importer,
          hops: current.hops + 1,
          from: component.node.id,
        });
      }
    }
  }

  for (const procedurePath of consumedPaths) {
    const [mount, procedure] = procedurePath.split(".");
    if (mount === undefined || procedure === undefined) continue;
    for (const file of index.files.values()) {
      if (TEST_PATH.test(file.path)) continue;
      const mountNames = mounts.get(file.path);
      if (!mountNames || !mountNames.has(mount)) continue;
      if (!new RegExp(`\\b${procedure}\\s*:`).test(file.text)) continue;
      const router = addNode(graph, {
        kind: "procedure",
        path: file.path,
        reachedVia: `serves ${procedurePath}`,
        hops: 1,
      });
      addEdge(graph, {
        from: primaryEntryId,
        to: router.node.id,
        kind: "router",
        detail: procedurePath,
      });
      for (const dependency of file.imports) {
        if (TEST_PATH.test(dependency)) continue;
        if (!BACKEND_DEPENDENCY.test(dependency)) continue;
        const backend = addNode(graph, {
          kind: "caller",
          path: dependency,
          reachedVia: `backend behind ${procedurePath}`,
          hops: 2,
        });
        addEdge(graph, {
          from: router.node.id,
          to: backend.node.id,
          kind: "caller",
          detail: procedurePath,
        });
      }
    }
  }

  const nodes = nodeList(graph);
  if (runId !== undefined) await persistNodes(root, runId, nodes);

  return {
    nodes,
    edges: graph.edges,
    counts: { ...summarize(graph), indexedFiles: index.files.size },
  };
};
