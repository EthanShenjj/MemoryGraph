import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import readline from "node:readline";
import { normalizeGraph } from "./graph.mjs";
import { refreshMemoryIndex, searchMemoryIndex } from "./memory-index.mjs";
import {
  applyProductState,
  recordRetrievalFeedback,
  reviewMemoryCandidate,
} from "./product-state.mjs";
import { saveGraphSnapshot } from "./snapshot.mjs";

const RESOURCE_URI = "ui://memorygraph/dag.html";
const MARK_URI = "ui://memorygraph/memorygraph-mark.png";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HTML = readFileSync(path.join(ROOT, "assets", "widget.html"), "utf8");
const MARK_PNG = readFileSync(path.join(ROOT, "assets", "memorygraph-mark.png")).toString("base64");

const RESOURCE_META = {
  ui: {
    prefersBorder: false,
    csp: {
      connectDomains: [],
      resourceDomains: [],
    },
  },
  "openai/widgetDescription": "Local-first MemoryGraph for source-backed Codex conversation recall.",
  "openai/widgetPrefersBorder": false,
  "openai/widgetCSP": {
    connect_domains: [],
    resource_domains: [],
  },
};

const TOOL = {
  name: "show_memory_graph",
  title: "Show MemoryGraph",
  description: "Open or refresh a project-rooted MemoryGraph and save a standalone date-title HTML snapshot by default. The canvas shows project and task structure; exact records, content relations, and memory candidates stay visibly distinct.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      title: { type: "string" },
      query: { type: "string" },
      scope: { type: "string" },
      mode: { type: "string", enum: ["project", "search", "branch"] },
      generatedAt: { type: "string" },
      rootProjectId: { type: "string" },
      saveSnapshot: {
        type: "boolean",
        default: true,
        description: "Save a standalone local HTML snapshot using date, time, and title.",
      },
      snapshotTitle: {
        type: "string",
        description: "Optional filename title. The graph title is used when omitted.",
      },
      nodes: {
        type: "array",
        maxItems: 200,
        items: {
          type: "object",
          additionalProperties: true,
          required: ["id", "title"],
          properties: {
            id: { type: "string" },
            title: { type: "string" },
            summary: { type: "string" },
            content: { type: "string" },
            kind: { type: "string", enum: ["project", "record", "thread", "memory", "decision", "artifact", "milestone"] },
            status: { type: "string" },
            updatedAt: {},
            projectId: { type: "string" },
            cwd: { type: "string" },
            hostId: { type: "string" },
            cluster: { type: "string" },
            matchReason: { type: "string" },
            matchType: { type: "string", enum: ["exact", "semantic", "context"] },
            matchScore: { type: "number", minimum: 0, maximum: 1 },
            memoryType: {
              type: "string",
              enum: ["decision", "fact", "requirement", "open-question", "plan", "definition", "insight"],
            },
            memoryStatus: {
              type: "string",
              enum: ["candidate", "confirmed", "corrected", "superseded", "rejected"],
            },
            evidenceType: { type: "string" },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            source: {
              type: "object",
              additionalProperties: false,
              properties: {
                threadId: { type: "string" },
                turnId: { type: "string" },
                threadTitle: { type: "string" },
                role: { type: "string", enum: ["user", "assistant", "system"] },
                timestamp: {},
                prompt: { type: "string" },
                excerpt: { type: "string" },
                contentHash: { type: "string" },
                duplicateCount: { type: "number", minimum: 1 },
                cwd: { type: "string" },
                line: { type: "number", minimum: 0 },
                copies: { type: "array", items: { type: "string" } },
              },
            },
            tags: { type: "array", items: { type: "string" } },
          },
        },
      },
      edges: {
        type: "array",
        maxItems: 400,
        items: {
          type: "object",
          additionalProperties: true,
          required: ["source", "target"],
          properties: {
            id: { type: "string" },
            source: { type: "string" },
            target: { type: "string" },
            type: { type: "string", enum: ["membership", "fork", "shared-prefix", "continuation", "related", "contains", "derived"] },
            layer: { type: "string", enum: ["task", "content"] },
            direction: { type: "string", enum: ["directed", "symmetric"] },
            evidenceType: { type: "string" },
            evidence: { type: "string" },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            label: { type: "string" },
          },
        },
      },
      retrieval: {
        type: "object",
        additionalProperties: false,
        properties: {
          strategy: { type: "string" },
          scannedTasks: { type: "number", minimum: 0 },
          candidateTasks: { type: "number", minimum: 0 },
          scannedRecords: { type: "number", minimum: 0 },
          deduplicatedRecords: { type: "number", minimum: 0 },
          exactMatches: { type: "number", minimum: 0 },
          semanticMatches: { type: "number", minimum: 0 },
          indexMode: { type: "string" },
          changedFiles: { type: "number", minimum: 0 },
          reusedFiles: { type: "number", minimum: 0 },
          memoryCandidates: { type: "number", minimum: 0 },
        },
      },
    },
    required: ["nodes", "edges"],
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  _meta: {
    ui: {
      resourceUri: RESOURCE_URI,
      visibility: ["model", "app"],
    },
    "openai/outputTemplate": RESOURCE_URI,
    "openai/widgetAccessible": true,
    "openai/toolInvocation/invoking": "Building MemoryGraph...",
    "openai/toolInvocation/invoked": "MemoryGraph ready",
  },
};

const SEARCH_TOOL = {
  name: "search_memory_graph",
  title: "Search MemoryGraph",
  description: "Search the complete local Codex session archive for one exact project cwd. Builds or incrementally refreshes a local-only Turn index, pairs user prompts with final AI answers, deduplicates branch copies by Turn ID, attributes each record to its earliest source task, opens a source-backed MemoryGraph, and saves a standalone date-title HTML snapshot by default.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["cwd", "query"],
    properties: {
      cwd: {
        type: "string",
        description: "Exact project working directory. Results never cross this boundary.",
      },
      query: { type: "string", description: "Literal user query. It is never silently replaced." },
      limit: { type: "number", minimum: 1, maximum: 20, default: 8 },
      forceRebuild: {
        type: "boolean",
        default: false,
        description: "Reparse every project session instead of reusing unchanged local index entries.",
      },
      saveSnapshot: {
        type: "boolean",
        default: true,
        description: "Save a standalone local HTML snapshot using date, time, and title.",
      },
      snapshotTitle: {
        type: "string",
        description: "Optional filename title. The MemoryGraph result title is used when omitted.",
      },
    },
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  _meta: {
    ui: {
      resourceUri: RESOURCE_URI,
      visibility: ["model", "app"],
    },
    "openai/outputTemplate": RESOURCE_URI,
    "openai/widgetAccessible": true,
    "openai/toolInvocation/invoking": "Searching local conversation memory...",
    "openai/toolInvocation/invoked": "MemoryGraph search ready",
  },
};

const REFRESH_TOOL = {
  name: "refresh_memory_index",
  title: "Refresh Memory Index",
  description: "Build or incrementally refresh the local-only Turn-level memory index for one exact project cwd. This cache does not modify Codex tasks or conversation history.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["cwd"],
    properties: {
      cwd: { type: "string" },
      forceRebuild: { type: "boolean", default: false },
    },
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

const FEEDBACK_TOOL = {
  name: "record_retrieval_feedback",
  title: "Record Retrieval Feedback",
  description: "Store local project-scoped feedback that marks one source record as correct or incorrect for a literal query. Future identical queries use the feedback as a bounded ranking signal.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["cwd", "query", "recordId", "verdict"],
    properties: {
      cwd: { type: "string" },
      query: { type: "string" },
      recordId: { type: "string" },
      threadId: { type: "string" },
      turnId: { type: "string" },
      verdict: { type: "string", enum: ["correct", "incorrect"] },
      reason: { type: "string" },
    },
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  _meta: {
    ui: { visibility: ["model", "app"] },
    "openai/widgetAccessible": true,
  },
};

const REVIEW_MEMORY_TOOL = {
  name: "review_memory_candidate",
  title: "Review Memory Candidate",
  description: "Confirm, reject, correct, supersede, or reset one local project-scoped memory candidate while preserving its source task and Turn provenance.",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["cwd", "memoryId", "status"],
    properties: {
      cwd: { type: "string" },
      memoryId: { type: "string" },
      status: {
        type: "string",
        enum: ["candidate", "confirmed", "corrected", "superseded", "rejected"],
      },
      content: { type: "string" },
      note: { type: "string" },
      threadId: { type: "string" },
      turnId: { type: "string" },
    },
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  _meta: {
    ui: { visibility: ["model", "app"] },
    "openai/widgetAccessible": true,
  },
};

function resultFor(graph, extraStructuredContent = {}) {
  const snapshot = graph.snapshot || null;
  return {
    content: [{
      type: "text",
      text: `MemoryGraph opened with ${graph.nodes.length} nodes and ${graph.edges.length} edges.` +
        (snapshot?.path ? ` Snapshot saved to ${snapshot.path}.` : ""),
    }],
    structuredContent: {
      version: 1,
      widget: "memorygraph",
      title: graph.title,
      query: graph.query,
      scope: graph.scope,
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      projectCount: graph.nodes.filter((node) => node.kind === "project").length,
      taskCount: graph.nodes.filter((node) => node.kind === "thread").length,
      recordCount: graph.nodes.filter((node) => node.kind === "record").length,
      memoryCount: graph.nodes.filter((node) => node.kind === "memory").length,
      snapshotPath: snapshot?.path,
      snapshotFileName: snapshot?.fileName,
      ...extraStructuredContent,
    },
    _meta: {
      "openai/outputTemplate": RESOURCE_URI,
      "openai/widgetSessionId": `memorygraph:${graph.scope}`,
      widgetData: graph,
    },
  };
}

function maybeSaveSnapshot(graph, args = {}) {
  if (args.saveSnapshot === false) return null;
  const snapshot = saveGraphSnapshot({
    graph,
    widgetHtml: HTML,
    markPngBase64: MARK_PNG,
    title: args.snapshotTitle || graph.title || graph.query || "MemoryGraph",
  });
  graph.snapshot = snapshot;
  return snapshot;
}

function refreshResult(refreshed) {
  return {
    content: [{
      type: "text",
      text: `Memory index ${refreshed.stats.mode}: ${refreshed.stats.indexedTasks} tasks, ${refreshed.stats.indexedRecords} canonical records, ${refreshed.stats.memoryCandidates} memory candidates.`,
    }],
    structuredContent: {
      version: 1,
      widget: "memorygraph-memory-index",
      indexPath: refreshed.indexPath,
      ...refreshed.stats,
    },
  };
}

function handle(method, params = {}) {
  switch (method) {
    case "initialize":
      return {
        protocolVersion: params.protocolVersion || "2025-06-18",
        capabilities: {
          tools: { listChanged: false },
          resources: { subscribe: false, listChanged: false },
        },
        serverInfo: { name: "memorygraph-mcp", version: "0.1.0" },
      };
    case "tools/list":
      return {
        tools: [
          SEARCH_TOOL,
          REFRESH_TOOL,
          FEEDBACK_TOOL,
          REVIEW_MEMORY_TOOL,
          TOOL,
        ],
      };
    case "tools/call":
      if (params.name === TOOL.name) {
        const graph = normalizeGraph(params.arguments || {});
        applyProductState(graph);
        maybeSaveSnapshot(graph, params.arguments);
        return resultFor(graph);
      }
      if (params.name === REFRESH_TOOL.name) {
        return refreshResult(refreshMemoryIndex({
          cwd: params.arguments?.cwd,
          force: Boolean(params.arguments?.forceRebuild),
        }));
      }
      if (params.name === SEARCH_TOOL.name) {
        const refreshed = refreshMemoryIndex({
          cwd: params.arguments?.cwd,
          force: Boolean(params.arguments?.forceRebuild),
        });
        const searched = searchMemoryIndex(refreshed.index, {
          query: params.arguments?.query,
          limit: params.arguments?.limit,
          indexStats: refreshed.stats,
        });
        const graph = normalizeGraph(searched.graph);
        applyProductState(graph);
        maybeSaveSnapshot(graph, params.arguments);
        return resultFor(graph, {
          results: searched.results,
          index: {
            mode: refreshed.stats.mode,
            changedFiles: refreshed.stats.parsedFiles,
            reusedFiles: refreshed.stats.reusedFiles,
            indexedTasks: refreshed.stats.indexedTasks,
            indexedRecords: refreshed.stats.indexedRecords,
            indexPath: refreshed.indexPath,
          },
        });
      }
      if (params.name === FEEDBACK_TOOL.name) {
        const feedback = recordRetrievalFeedback(params.arguments);
        return {
          content: [{
            type: "text",
            text: feedback.verdict === "correct"
              ? "Retrieval result confirmed and stored locally."
              : "Retrieval result marked incorrect and stored locally.",
          }],
          structuredContent: {
            version: 1,
            widget: "memorygraph-feedback",
            feedback,
          },
        };
      }
      if (params.name === REVIEW_MEMORY_TOOL.name) {
        const review = reviewMemoryCandidate(params.arguments);
        return {
          content: [{
            type: "text",
            text: `Memory candidate review stored locally with status ${review.status}.`,
          }],
          structuredContent: {
            version: 1,
            widget: "memorygraph-memory-review",
            review,
          },
        };
      }
      throw new Error(`Unknown tool: ${params.name}`);
    case "resources/list":
      return {
        resources: [
          {
            uri: RESOURCE_URI,
            name: "memorygraph-widget",
            title: "MemoryGraph",
            description: "Searchable, source-backed Codex conversation memory graph.",
            mimeType: "text/html;profile=mcp-app",
            _meta: RESOURCE_META,
          },
          {
            uri: MARK_URI,
            name: "memorygraph-mark",
            title: "MemoryGraph mark",
            description: "Local app mark used by the MemoryGraph widget.",
            mimeType: "image/png",
          },
        ],
      };
    case "resources/read":
      if (params.uri === RESOURCE_URI) {
        return {
          contents: [{
            uri: RESOURCE_URI,
            mimeType: "text/html;profile=mcp-app",
            text: HTML,
            _meta: RESOURCE_META,
          }],
        };
      }
      if (params.uri === MARK_URI) {
        return {
          contents: [{
            uri: MARK_URI,
            mimeType: "image/png",
            blob: MARK_PNG,
          }],
        };
      }
      throw new Error(`Unknown resource: ${params.uri}`);
    case "ping":
      return {};
    default:
      throw new Error(`Unsupported method: ${method}`);
  }
}

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

export function startServer(input = process.stdin) {
  const lines = readline.createInterface({ input });
  lines.on("line", async (line) => {
    if (!line.trim()) return;
    let request;
    try {
      request = JSON.parse(line);
      if (request.id === undefined) return;
      const result = await handle(request.method, request.params);
      write({ jsonrpc: "2.0", id: request.id, result });
    } catch (error) {
      if (request?.id === undefined) return;
      write({
        jsonrpc: "2.0",
        id: request.id,
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : String(error),
        },
      });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startServer();
}
