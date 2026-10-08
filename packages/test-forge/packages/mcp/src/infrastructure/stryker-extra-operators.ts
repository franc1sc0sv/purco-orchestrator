import { readTextFile } from "./files.ts";
import { parse } from "@babel/parser";
import { join } from "node:path";
import type { MutantSite } from "test-forge-contracts/stryker";

type AstNode = {
  type: string;
  start: number;
  end: number;
  loc: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
  [key: string]: unknown;
};

export type ExtraSite = MutantSite & { originalText: string };

export type ExtraSitesOfFile = {
  file: string;
  sites: ExtraSite[];
  error: string | null;
};

const JSX_MUTATOR = "ExtraJsxBooleanAttribute";

const LOGICAL_MUTATOR = "ExtraLogicalOperand";

const NUMBER_MUTATOR = "ExtraNumberLiteral";

const RUNTIME_TYPESCRIPT_NODES: ReadonlySet<string> = new Set([
  "TSAsExpression",
  "TSSatisfiesExpression",
  "TSNonNullExpression",
  "TSTypeAssertion",
  "TSInstantiationExpression",
  "TSParameterProperty",
  "TSEnumDeclaration",
  "TSEnumBody",
  "TSEnumMember",
  "TSModuleDeclaration",
  "TSModuleBlock",
  "TSExportAssignment",
  "TSImportEqualsDeclaration",
  "TSExternalModuleReference",
]);

const SKIPPED_KEYS: ReadonlySet<string> = new Set([
  "loc",
  "extra",
  "leadingComments",
  "trailingComments",
  "innerComments",
  "range",
]);

const COMPARISON_OPERATORS: ReadonlySet<string> = new Set([
  "===",
  "!==",
  "==",
  "!=",
  "<",
  ">",
  "<=",
  ">=",
  "in",
  "instanceof",
]);

const BOOLEAN_ATTRIBUTE_NAME =
  /^(?:is|has|should|can|show|hide|allow|enable|disable|with|auto)[A-Z]|^(?:disabled|checked|loading|required|readOnly|open|opened|visible|hidden|selected|active|multiple|centered|fullWidth|autoFocus)$/;

const isNode = (value: unknown): value is AstNode =>
  typeof value === "object" &&
  value !== null &&
  "type" in value &&
  typeof value.type === "string" &&
  "start" in value &&
  typeof value.start === "number" &&
  "end" in value &&
  typeof value.end === "number" &&
  "loc" in value;

const childrenOf = (node: AstNode): AstNode[] =>
  Object.entries(node).flatMap(([key, value]) => {
    if (SKIPPED_KEYS.has(key)) return [];
    if (Array.isArray(value)) return value.filter(isNode);
    return isNode(value) ? [value] : [];
  });

const isTypeOnly = (node: AstNode): boolean =>
  node.type.startsWith("TS") && !RUNTIME_TYPESCRIPT_NODES.has(node.type);

const field = (node: AstNode, key: string): unknown => node[key];

const nodeField = (node: AstNode, key: string): AstNode | null => {
  const value = field(node, key);
  return isNode(value) ? value : null;
};

const isBooleanLiteral = (node: AstNode): boolean => node.type === "BooleanLiteral";

const isBooleanShaped = (node: AstNode, attributeName: string): boolean => {
  if (isBooleanLiteral(node)) return true;
  if (node.type === "UnaryExpression") return field(node, "operator") === "!";
  if (node.type === "BinaryExpression") {
    return COMPARISON_OPERATORS.has(String(field(node, "operator")));
  }
  if (node.type === "LogicalExpression") {
    return field(node, "operator") !== "??";
  }
  if (node.type === "CallExpression") {
    const callee = nodeField(node, "callee");
    return callee?.type === "Identifier" && field(callee, "name") === "Boolean";
  }
  const named =
    node.type === "Identifier" ||
    node.type === "MemberExpression" ||
    node.type === "OptionalMemberExpression";
  return named && BOOLEAN_ATTRIBUTE_NAME.test(attributeName);
};

const attributeNameOf = (node: AstNode): string => {
  const name = nodeField(node, "name");
  return name?.type === "JSXIdentifier" ? String(field(name, "name")) : "";
};

const siteOf = (
  file: string,
  source: string,
  node: AstNode,
  mutator: string,
  replacement: string,
): ExtraSite | null => {
  const originalText = source.slice(node.start, node.end);
  if (originalText === replacement) return null;
  return {
    file,
    mutator,
    replacement,
    start: { line: node.loc.start.line, column: node.loc.start.column + 1 },
    end: { line: node.loc.end.line, column: node.loc.end.column + 1 },
    originalText,
  };
};

const jsxSites = (file: string, source: string, node: AstNode): ExtraSite[] => {
  if (node.type !== "JSXAttribute") return [];
  const container = nodeField(node, "value");
  if (container?.type !== "JSXExpressionContainer") return [];
  const expression = nodeField(container, "expression");
  if (expression === null || expression.type === "JSXEmptyExpression") return [];
  if (!isBooleanShaped(expression, attributeNameOf(node))) return [];
  return ["true", "false"].flatMap((replacement) => {
    const site = siteOf(file, source, expression, JSX_MUTATOR, replacement);
    return site === null ? [] : [site];
  });
};

const logicalSites = (file: string, source: string, node: AstNode): ExtraSite[] => {
  if (node.type !== "LogicalExpression") return [];
  const operator = field(node, "operator");
  if (operator !== "&&" && operator !== "||") return [];
  return ["left", "right"].flatMap((side) => {
    const operand = nodeField(node, side);
    if (operand === null) return [];
    return ["true", "false"].flatMap((replacement) => {
      const site = siteOf(file, source, operand, LOGICAL_MUTATOR, replacement);
      return site === null ? [] : [site];
    });
  });
};

const isPropertyKey = (parent: AstNode | null, node: AstNode): boolean =>
  parent !== null &&
  (parent.type === "ObjectProperty" ||
    parent.type === "ClassProperty" ||
    parent.type === "ObjectMethod" ||
    parent.type === "ClassMethod") &&
  field(parent, "computed") !== true &&
  nodeField(parent, "key") === node;

const numberSites = (
  file: string,
  source: string,
  node: AstNode,
  parent: AstNode | null,
): ExtraSite[] => {
  if (node.type !== "NumericLiteral" || isPropertyKey(parent, node)) return [];
  const value = field(node, "value");
  if (typeof value !== "number" || !Number.isFinite(value)) return [];
  return ["0", String(value + 1)].flatMap((replacement) => {
    const site = siteOf(file, source, node, NUMBER_MUTATOR, replacement);
    return site === null ? [] : [site];
  });
};

const visit = (
  file: string,
  source: string,
  node: AstNode,
  parent: AstNode | null,
  found: ExtraSite[],
): void => {
  if (isTypeOnly(node)) return;
  found.push(
    ...jsxSites(file, source, node),
    ...logicalSites(file, source, node),
    ...numberSites(file, source, node, parent),
  );
  for (const child of childrenOf(node)) visit(file, source, child, node, found);
};

const parserPluginsOf = (file: string) =>
  file.endsWith(".tsx")
    ? (["typescript", "jsx", "decorators-legacy"] as const)
    : (["typescript", "decorators-legacy"] as const);

export const listExtraSites = (
  root: string,
  files: readonly string[],
): ExtraSitesOfFile[] =>
  files.map((file) => {
    const source = readTextFile(join(root, file));
    if (source === null) return { file, sites: [], error: `cannot read ${file}` };
    try {
      const ast = parse(source, {
        sourceType: "module",
        plugins: [...parserPluginsOf(file)],
      });
      const found: ExtraSite[] = [];
      if (isNode(ast.program)) visit(file, source, ast.program, null, found);
      return { file, sites: found, error: null };
    } catch (error) {
      return {
        file,
        sites: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
