import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import readline from "node:readline";
import { normalizeGraph } from "./graph.mjs";
import { refreshMemoryIndex, searchMemoryIndex, readMemoryRecord } from "./memory-index.mjs";
import {
  applyProductState,
  loadProductState,
  recordRetrievalFeedback,
  reviewMemoryCandidate,
} from "./product-state.mjs";
import { saveGraphSnapshot } from "./snapshot.mjs";
import { readPreferredLocale } from "./preferences.mjs";

const RESOURCE_URI = "ui://memorygraph/dag.html";
const MARK_URI = "ui://memorygraph/memorygraph-mark.png";
const MASCOT_URI = "ui://memorygraph/memorygraph-mascot.png";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HTML = readFileSync(path.join(ROOT, "assets", "widget.html"), "utf8");
const MARK_PNG = readFileSync(path.join(ROOT, "assets", "memorygraph-mark.png")).toString("base64");
const MASCOT_PNG = readFileSync(path.join(ROOT, "assets", "memorygraph-mascot.png")).toString("base64");

const RESOURCE_META = {
  ui: {
    prefersBorder: false,
    csp: {
      connectDomains: [],
      resourceDomains: [],
    },
  },
  "openai/widgetDescription": "本地优先、可追溯来源的 Codex 对话记忆图谱。",
  "openai/widgetPrefersBorder": false,
  "openai/widgetCSP": {
    connect_domains: [],
    resource_domains: [],
  },
};

const TOOL = {
  name: "show_memory_graph",
  title: "显示 MemoryGraph",
  description: "打开或刷新以项目为根的 MemoryGraph，并默认保存带日期和标题的独立 HTML 快照。画布会清晰区分项目与任务结构、精确记录、内容关联和记忆候选。",
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
        description: "保存带日期、时间和标题的独立本地 HTML 快照。",
      },
      snapshotTitle: {
        type: "string",
        description: "可选的文件名标题；未填写时使用图谱标题。",
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
            matchType: { type: "string", enum: ["exact", "lexical", "semantic", "context"] },
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
    "openai/toolInvocation/invoking": "正在生成 MemoryGraph…",
    "openai/toolInvocation/invoked": "MemoryGraph 已就绪",
  },
};

const SEARCH_TOOL = {
  name: "search_memory_graph",
  title: "搜索 MemoryGraph",
  description: "在精确项目工作目录对应的已支持本地 Codex 会话存档（活跃及归档）中搜索，并报告失败或不支持的来源。它会建立或增量刷新仅本地的轮次索引，将用户提问与最终 AI 回答配对，按轮次 ID 去重分支副本，将记录归属到最早的来源任务，打开可追溯来源的 MemoryGraph，并默认保存独立 HTML 快照。",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["cwd", "query"],
    properties: {
      cwd: {
        type: "string",
        description: "精确的项目工作目录；结果不会跨越此边界。",
      },
      query: { type: "string", maxLength: 1000, description: "用户的原始查询；空字符串浏览最近记录。" },
      requestId: { type: "string", description: "客户端请求标识，用于忽略迟到响应。" },
      cursor: { type: "string", description: "上一页返回的 nextCursor；过滤条件变化后必须清空。" },
      after: { type: "string", description: "记录时间起点（含），带时区的 ISO 时间。" },
      before: { type: "string", description: "记录时间终点（不含），带时区的 ISO 时间。" },
      includeArchived: { type: "boolean", default: true },
      includeExcluded: { type: "boolean", default: false },
      limit: { type: "number", minimum: 1, maximum: 20, default: 8 },
      forceRebuild: {
        type: "boolean",
        default: false,
        description: "重新解析每个项目会话，而不是复用未变化的本地索引条目。",
      },
      saveSnapshot: {
        type: "boolean",
        default: true,
        description: "保存带日期、时间和标题的独立本地 HTML 快照。",
      },
      snapshotTitle: {
        type: "string",
        description: "可选的文件名标题；未填写时使用 MemoryGraph 结果标题。",
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
    "openai/toolInvocation/invoking": "正在搜索本地对话记忆…",
    "openai/toolInvocation/invoked": "MemoryGraph 搜索已就绪",
  },
};

const REFRESH_TOOL = {
  name: "refresh_memory_index",
  title: "刷新记忆索引",
  description: "为精确的项目工作目录建立或增量刷新仅本地的轮次级记忆索引；该缓存不会修改 Codex 任务或对话历史。",
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
  title: "记录检索反馈",
  description: "保存项目范围内的本地反馈，将某条来源记录标为与原始查询相符或不相符；后续相同查询会将该反馈作为有限的排序信号。",
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
      verdict: { type: "string", enum: ["correct", "incorrect", "cleared"] },
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
  title: "审核记忆候选",
  description: "在保留来源任务和轮次级溯源信息的同时，确认、拒绝、修正、替代或重置一条项目范围内的本地记忆候选。",
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
      expectedRevision: { type: "integer", minimum: 0 },
      supersededBy: { type: "string", description: "已确认的替代记忆 ID" },
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

const READ_RECORD_TOOL = {
  name: "read_memory_record",
  title: "读取原始记录",
  description: "在指定项目重新读取来源文件并核验完整内容哈希，分块返回原始回答及可选相邻轮次；不修改历史。",
  inputSchema: { type: "object", additionalProperties: false, required: ["cwd", "recordId"], properties: {
    cwd: { type: "string" }, recordId: { type: "string" }, contentHash: { type: "string" },
    offset: { type: "integer", minimum: 0, default: 0 },
    length: { type: "integer", minimum: 1, maximum: 20000, default: 12000 },
    context: { type: "integer", minimum: 0, maximum: 2, default: 0 },
  } },
  annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  _meta: { ui: { resourceUri: RESOURCE_URI, visibility: ["model", "app"] }, "openai/widgetAccessible": true },
};

function resultFor(graph, extraStructuredContent = {}) {
  const snapshot = graph.snapshot || null;
  return {
    content: [{
      type: "text",
      text: `MemoryGraph 已打开，包含 ${graph.nodes.length} 个节点和 ${graph.edges.length} 条关系。` +
        (snapshot?.path ? ` 快照已保存至 ${snapshot.path}。` : ""),
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
    mascotPngBase64: MASCOT_PNG,
    title: args.snapshotTitle || graph.title || graph.query || "MemoryGraph",
  });
  graph.snapshot = snapshot;
  return snapshot;
}

function refreshResult(refreshed) {
  return {
    content: [{
      type: "text",
      text: `记忆索引已${refreshed.stats.mode === "incremental" ? "增量刷新" : "完整构建"}：${refreshed.stats.indexedTasks} 个任务、${refreshed.stats.indexedRecords} 条规范记录、${refreshed.stats.memoryCandidates} 条记忆候选。`,
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
        serverInfo: { name: "memorygraph-mcp", version: "0.3.0" },
      };
    case "tools/list":
      return {
        tools: [
          SEARCH_TOOL,
          READ_RECORD_TOOL,
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
        graph.preferredLocale = readPreferredLocale();
        maybeSaveSnapshot(graph, params.arguments);
        return resultFor(graph);
      }
      if (params.name === REFRESH_TOOL.name) {
        return refreshResult(refreshMemoryIndex({
          cwd: params.arguments?.cwd,
          force: Boolean(params.arguments?.forceRebuild),
        }));
      }
      if (params.name === READ_RECORD_TOOL.name) {
        const refreshed = refreshMemoryIndex({ cwd: params.arguments?.cwd });
        const record = readMemoryRecord(refreshed.index, params.arguments || {});
        return { content: [{ type: "text", text: record.text }], structuredContent: { record } };
      }
      if (params.name === SEARCH_TOOL.name) {
        const refreshed = refreshMemoryIndex({
          cwd: params.arguments?.cwd,
          force: Boolean(params.arguments?.forceRebuild),
        });
        const productState = loadProductState();
        const searched = searchMemoryIndex(refreshed.index, {
          productState,
          query: params.arguments?.query,
          limit: params.arguments?.limit,
          cursor: params.arguments?.cursor,
          after: params.arguments?.after,
          before: params.arguments?.before,
          includeArchived: params.arguments?.includeArchived,
          includeExcluded: params.arguments?.includeExcluded,
          indexStats: refreshed.stats,
        });
        const graph = normalizeGraph(searched.graph);
        graph.requestId = String(params.arguments?.requestId || "");
        applyProductState(graph, { state: productState });
        graph.preferredLocale = readPreferredLocale();
        maybeSaveSnapshot(graph, params.arguments);
        return resultFor(graph, {
          results: searched.results,
          page: searched.page,
          coverage: searched.coverage,
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
            text: feedback.verdict === "cleared" ? "检索反馈已撤销。" : feedback.verdict === "correct"
              ? "检索结果已确认为正确并保存到本地。"
              : "检索结果已标记为不正确并保存到本地。",
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
            text: `记忆候选审核已保存到本地，当前状态：${review.status}。`,
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
            description: "可搜索、可追溯来源的 Codex 对话记忆图谱。",
            mimeType: "text/html;profile=mcp-app",
            _meta: RESOURCE_META,
          },
          {
            uri: MARK_URI,
            name: "memorygraph-mark",
            title: "MemoryGraph 标识",
            description: "MemoryGraph 小组件使用的本地应用标识。",
            mimeType: "image/png",
          },
          {
            uri: MASCOT_URI,
            name: "memorygraph-mascot",
            title: "MemoryGraph IP 形象",
            description: "MemoryGraph 小组件使用的本地角色形象。",
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
      if (params.uri === MASCOT_URI) {
        return {
          contents: [{
            uri: MASCOT_URI,
            mimeType: "image/png",
            blob: MASCOT_PNG,
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
