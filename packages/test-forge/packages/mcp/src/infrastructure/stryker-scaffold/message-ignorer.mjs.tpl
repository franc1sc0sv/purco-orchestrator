import { declareValuePlugin, PluginKind } from "__STRYKER_API_PLUGIN__"

const LOGGERS = new Set(["console", "logger", "log"])

const ERROR_NAME = /(Error|Exception)$/

const isLogger = (node) =>
  (node.type === "Identifier" && LOGGERS.has(node.name)) ||
  (node.type === "MemberExpression" &&
    node.object.type === "ThisExpression" &&
    node.property.type === "Identifier" &&
    LOGGERS.has(node.property.name))

const isLogCall = (node) =>
  node.type === "CallExpression" && node.callee.type === "MemberExpression" && isLogger(node.callee.object)

const isErrorConstruction = (node) =>
  node?.type === "NewExpression" && node.callee.type === "Identifier" && ERROR_NAME.test(node.callee.name)

const isText = (node) => node.type === "StringLiteral" || node.type === "TemplateLiteral"

const isMessageProperty = (path) =>
  path.parent?.type === "ObjectProperty" &&
  path.parent.key.type === "Identifier" &&
  path.parent.key.name === "message" &&
  isErrorConstruction(path.parentPath?.parentPath?.parent)

const CODE_TABLE_NAME = /^[A-Z0-9_]*CODES?(_[A-Z0-9_]*)?$/

const isNumber = (node) =>
  node?.type === "NumericLiteral" ||
  (node?.type === "UnaryExpression" && node.operator === "-" && node.argument.type === "NumericLiteral")

const isCodeTable = (path) =>
  path.node.type === "ObjectExpression" &&
  path.parent?.type === "VariableDeclarator" &&
  path.parent.id.type === "Identifier" &&
  CODE_TABLE_NAME.test(path.parent.id.name) &&
  path.node.properties.some((property) => property.type === "ObjectProperty") &&
  path.node.properties.every(
    (property) => property.type === "SpreadElement" || (property.type === "ObjectProperty" && isNumber(property.value)),
  )

const messageIgnorer = {
  shouldIgnore(path) {
    if (isCodeTable(path)) return "numeric code table"
    if (isLogCall(path.node)) return "log call"
    if (!isText(path.node)) return undefined
    if (isErrorConstruction(path.parent) || isMessageProperty(path)) return "error message"
    return undefined
  },
}

export const strykerPlugins = [declareValuePlugin(PluginKind.Ignore, "forge-messages", messageIgnorer)]
