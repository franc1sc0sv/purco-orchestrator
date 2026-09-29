import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { execFileSync } from "node:child_process";

export const LINEAR_SERVER = "linear";

export const LINEAR_TOOL_NAMES = [
  "get_issue",
  "list_project_issues",
  "list_comments",
  "search_issues",
].map((name) => `mcp__${LINEAR_SERVER}__${name}`);

const ENDPOINT = "https://api.linear.app/graphql";

const KEYCHAIN_SERVICE = "LINEAR_API_KEY";

let cachedKey: string | undefined;
let resolved = false;

export const resolveLinearKey = (): string | undefined => {
  if (resolved) return cachedKey;
  resolved = true;
  const fromEnv = process.env.LINEAR_API_KEY;
  if (typeof fromEnv === "string" && fromEnv.length > 0) {
    cachedKey = fromEnv;
    return cachedKey;
  }
  if (process.platform === "darwin") {
    try {
      const account = process.env.USER ?? "";
      const value = execFileSync(
        "security",
        ["find-generic-password", "-a", account, "-s", KEYCHAIN_SERVICE, "-w"],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
      ).trim();
      if (value.length > 0) cachedKey = value;
    } catch {
      cachedKey = undefined;
    }
  }
  return cachedKey;
};

export const hasLinearKey = (): boolean => resolveLinearKey() !== undefined;

export const linearKeySource = (): string => {
  if (
    typeof process.env.LINEAR_API_KEY === "string" &&
    process.env.LINEAR_API_KEY.length > 0
  ) {
    return "environment";
  }
  return resolveLinearKey() ? "keychain" : "none";
};

const text = (body: string) => ({
  content: [{ type: "text" as const, text: body }],
});

const failure = (body: string) => ({ ...text(body), isError: true });

const NO_KEY =
  "No Linear API key is available, so Linear is unreachable. Read the seeded ticket at 00-ticket.md instead, and escalate at level human if that file does not exist.";

const gql = async (
  query: string,
  variables: Record<string, unknown>
): Promise<{ data?: Record<string, unknown>; error?: string }> => {
  const key = resolveLinearKey();
  if (!key) return { error: NO_KEY };
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: key,
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!response.ok) {
      return { error: `Linear returned HTTP ${response.status}` };
    }
    const payload = (await response.json()) as {
      data?: Record<string, unknown>;
      errors?: Array<{ message: string }>;
    };
    if (payload.errors && payload.errors.length > 0) {
      return { error: payload.errors.map((e) => e.message).join("; ") };
    }
    return { data: payload.data };
  } catch (error) {
    return { error: `Linear request failed: ${String(error)}` };
  }
};

const splitIdentifier = (
  identifier: string
): { key: string; number: number } | undefined => {
  const parts = identifier.trim().toUpperCase().split("-");
  if (parts.length !== 2) return undefined;
  const number = Number(parts[1]);
  if (!Number.isInteger(number)) return undefined;
  return { key: parts[0], number };
};

const ISSUE_FIELDS = `
  identifier
  title
  description
  url
  priority
  estimate
  state { name type }
  assignee { name }
  labels { nodes { name } }
  parent { identifier title }
  children { nodes { identifier title } }
  project { id name description }
`;

type IssueNode = {
  identifier: string;
  title: string;
  description?: string | null;
  url: string;
  priority?: number | null;
  state?: { name: string; type: string } | null;
  assignee?: { name: string } | null;
  labels?: { nodes: Array<{ name: string }> } | null;
  parent?: { identifier: string; title: string } | null;
  children?: { nodes: Array<{ identifier: string; title: string }> } | null;
  project?: { id: string; name: string; description?: string | null } | null;
};

const renderIssue = (issue: IssueNode): string =>
  [
    `# ${issue.identifier} — ${issue.title}`,
    `state: ${issue.state?.name ?? "unknown"} · priority: ${
      issue.priority ?? "none"
    } · assignee: ${issue.assignee?.name ?? "unassigned"}`,
    `url: ${issue.url}`,
    issue.labels?.nodes?.length
      ? `labels: ${issue.labels.nodes.map((l) => l.name).join(", ")}`
      : "",
    issue.project
      ? `project: ${issue.project.name} (${issue.project.id})`
      : "project: none",
    issue.parent
      ? `parent: ${issue.parent.identifier} — ${issue.parent.title}`
      : "",
    issue.children?.nodes?.length
      ? `children: ${issue.children.nodes
          .map((c) => `${c.identifier} ${c.title}`)
          .join(" | ")}`
      : "",
    "",
    "## Description",
    issue.description?.trim() || "(empty)",
    issue.project?.description
      ? `\n## Project description\n${issue.project.description}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

export const buildLinearServer = () =>
  createSdkMcpServer({
    name: LINEAR_SERVER,
    version: "0.1.0",
    instructions: hasLinearKey()
      ? "Read-only Linear access for this run. Use get_issue for the ticket, list_project_issues for its siblings, list_comments for the discussion."
      : "Linear is NOT configured for this run. Every tool here will fail. Use the seeded ticket file instead.",
    tools: [
      tool(
        "get_issue",
        "Read one Linear issue by identifier, such as PURCO-3222, with its description, state, labels, parent, children and project.",
        { identifier: z.string() },
        async (args) => {
          const parsed = splitIdentifier(args.identifier);
          if (!parsed) {
            return failure(
              `Could not parse "${args.identifier}". Use the form PURCO-1234.`
            );
          }
          const { data, error } = await gql(
            `query($key: String!, $number: Float!) {
               issues(filter: { team: { key: { eq: $key } }, number: { eq: $number } }, first: 1) {
                 nodes { ${ISSUE_FIELDS} }
               }
             }`,
            parsed
          );
          if (error) return failure(error);
          const nodes = (data?.issues as { nodes: IssueNode[] } | undefined)
            ?.nodes;
          if (!nodes || nodes.length === 0) {
            return failure(`Linear has no issue ${args.identifier}.`);
          }
          return text(renderIssue(nodes[0]));
        }
      ),

      tool(
        "list_project_issues",
        "List every issue in the Linear project that contains the given issue. Use it to see the sibling tickets that define the shape of this work.",
        { identifier: z.string(), limit: z.number().optional() },
        async (args) => {
          const parsed = splitIdentifier(args.identifier);
          if (!parsed) return failure(`Could not parse "${args.identifier}".`);
          const { data, error } = await gql(
            `query($key: String!, $number: Float!, $limit: Int!) {
               issues(filter: { team: { key: { eq: $key } }, number: { eq: $number } }, first: 1) {
                 nodes {
                   project {
                     name
                     description
                     issues(first: $limit) {
                       nodes { identifier title state { name } priority url }
                     }
                   }
                 }
               }
             }`,
            { ...parsed, limit: args.limit ?? 50 }
          );
          if (error) return failure(error);
          const project = (
            data?.issues as
              | {
                  nodes: Array<{
                    project?: {
                      name: string;
                      description?: string | null;
                      issues: {
                        nodes: Array<{
                          identifier: string;
                          title: string;
                          state?: { name: string } | null;
                          priority?: number | null;
                          url: string;
                        }>;
                      };
                    } | null;
                  }>;
                }
              | undefined
          )?.nodes?.[0]?.project;
          if (!project) {
            return text(`${args.identifier} is not in a Linear project.`);
          }
          return text(
            [
              `# Project ${project.name}`,
              project.description?.trim() ?? "",
              "",
              ...project.issues.nodes.map(
                (issue) =>
                  `- ${issue.identifier} [${issue.state?.name ?? "?"}] ${
                    issue.title
                  }`
              ),
            ]
              .filter(Boolean)
              .join("\n")
          );
        }
      ),

      tool(
        "list_comments",
        "Read the comment thread on a Linear issue, oldest first.",
        { identifier: z.string() },
        async (args) => {
          const parsed = splitIdentifier(args.identifier);
          if (!parsed) return failure(`Could not parse "${args.identifier}".`);
          const { data, error } = await gql(
            `query($key: String!, $number: Float!) {
               issues(filter: { team: { key: { eq: $key } }, number: { eq: $number } }, first: 1) {
                 nodes {
                   comments(first: 100) {
                     nodes { body createdAt user { name } }
                   }
                 }
               }
             }`,
            parsed
          );
          if (error) return failure(error);
          const comments = (
            data?.issues as
              | {
                  nodes: Array<{
                    comments: {
                      nodes: Array<{
                        body: string;
                        createdAt: string;
                        user?: { name: string } | null;
                      }>;
                    };
                  }>;
                }
              | undefined
          )?.nodes?.[0]?.comments?.nodes;
          if (!comments || comments.length === 0) {
            return text(`${args.identifier} has no comments.`);
          }
          return text(
            comments
              .map(
                (comment) =>
                  `## ${comment.user?.name ?? "unknown"} — ${
                    comment.createdAt
                  }\n${comment.body}`
              )
              .join("\n\n")
          );
        }
      ),

      tool(
        "search_issues",
        "Search Linear issues by text. Use it to find prior work on the same feature.",
        { text: z.string(), limit: z.number().optional() },
        async (args) => {
          const { data, error } = await gql(
            `query($term: String!, $limit: Int!) {
               searchIssues(term: $term, first: $limit) {
                 nodes { identifier title state { name } url }
               }
             }`,
            { term: args.text, limit: args.limit ?? 20 }
          );
          if (error) return failure(error);
          const nodes = (
            data?.searchIssues as
              | {
                  nodes: Array<{
                    identifier: string;
                    title: string;
                    state?: { name: string } | null;
                  }>;
                }
              | undefined
          )?.nodes;
          if (!nodes || nodes.length === 0) {
            return text(`No Linear issues matched "${args.text}".`);
          }
          return text(
            nodes
              .map(
                (issue) =>
                  `- ${issue.identifier} [${issue.state?.name ?? "?"}] ${
                    issue.title
                  }`
              )
              .join("\n")
          );
        }
      ),
    ],
  });
