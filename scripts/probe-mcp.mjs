import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SNAPSHOT_ROOT = mkdtempSync(path.join(os.tmpdir(), "memorygraph-mcp-probe-"));
const PREFERENCES_PATH = path.join(SNAPSHOT_ROOT, "preferences.json");
writeFileSync(PREFERENCES_PATH, JSON.stringify({ locale: "en" }));
const child = spawn(process.execPath, ["./mcp/server.mjs"], {
  cwd: ROOT,
  env: {
    ...process.env,
    MEMORYGRAPH_SNAPSHOT_DIR: SNAPSHOT_ROOT,
    MEMORYGRAPH_STATE_PATH: path.join(SNAPSHOT_ROOT, "product-state.json"),
    MEMORYGRAPH_PREFERENCES_PATH: PREFERENCES_PATH,
  },
  stdio: ["pipe", "pipe", "inherit"],
});
const output = readline.createInterface({ input: child.stdout });
let nextId = 1;
const pending = new Map();
const exactTaskTitle = "Review docs/architecture.md and reorganize the implementation notes";

output.on("line", (line) => {
  const message = JSON.parse(line);
  const entry = pending.get(message.id);
  if (!entry) return;
  pending.delete(message.id);
  if (message.error) entry.reject(new Error(message.error.message));
  else entry.resolve(message.result);
});

function request(method, params = {}) {
  const id = nextId++;
  const response = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  return response;
}

try {
  const initialized = await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "memorygraph-probe", version: "0.1.0" },
  });
  const tools = await request("tools/list");
  const resources = await request("resources/list");
  const widget = await request("resources/read", { uri: "ui://memorygraph/dag.html" });
  const mark = await request("resources/read", { uri: "ui://memorygraph/memorygraph-mark.png" });
  const mascot = await request("resources/read", { uri: "ui://memorygraph/memorygraph-mascot.png" });
  const opened = await request("tools/call", {
    name: "show_memory_graph",
    arguments: {
      title: "Probe",
      retrieval: {
        strategy: "record-first",
        scannedTasks: 3,
        candidateTasks: 1,
        scannedRecords: 12,
        deduplicatedRecords: 10,
        exactMatches: 1,
        indexMode: "incremental",
        changedFiles: 1,
        reusedFiles: 2,
        memoryCandidates: 1,
      },
      nodes: [
        { id: "project:a", title: "Project A", kind: "project" },
        { id: "a", title: exactTaskTitle, kind: "thread" },
        {
          id: "record:a:turn-1:assistant",
          title: "Original answer",
          kind: "record",
          content: "The complete original answer.",
          matchType: "exact",
          matchScore: 0.98,
          source: {
            threadId: "a",
            turnId: "turn-1",
            threadTitle: exactTaskTitle,
            role: "assistant",
            prompt: "Summarize this product",
            excerpt: "The complete original answer.",
            duplicateCount: 3,
            copies: ["a", "branch-a"],
          },
        },
        {
          id: "memory:a:turn-1:decision",
          title: "Keep the original answer",
          kind: "memory",
          content: "Keep the original answer as the source of truth.",
          memoryType: "decision",
          memoryStatus: "candidate",
          evidenceType: "explicit-statement",
          confidence: 0.78,
          source: {
            threadId: "a",
            turnId: "turn-1",
            threadTitle: exactTaskTitle,
            role: "assistant",
          },
        },
      ],
      edges: [
        { source: "project:a", target: "a", type: "membership", confidence: 1 },
        { source: "a", target: "record:a:turn-1:assistant", type: "contains", confidence: 1 },
        {
          source: "record:a:turn-1:assistant",
          target: "memory:a:turn-1:decision",
          type: "derived",
          confidence: 0.78,
        },
      ],
      rootProjectId: "project:a",
    },
  });
  const feedbackSaved = await request("tools/call", {
    name: "record_retrieval_feedback",
    arguments: {
      cwd: "/tmp/project-a",
      query: "Summarize this product",
      recordId: "record:a:turn-1:assistant",
      threadId: "a",
      turnId: "turn-1",
      verdict: "correct",
    },
  });
  const memoryReviewed = await request("tools/call", {
    name: "review_memory_candidate",
    arguments: {
      cwd: "/tmp/project-a",
      memoryId: "memory:a:turn-1:decision",
      status: "confirmed",
      threadId: "a",
      turnId: "turn-1",
    },
  });

  if (initialized.serverInfo?.name !== "memorygraph-mcp") throw new Error("Initialize failed");
  const toolNames = new Set((tools.tools || []).map((tool) => tool.name));
  for (const name of [
    "search_memory_graph",
    "refresh_memory_index",
    "record_retrieval_feedback",
    "review_memory_candidate",
    "show_memory_graph",
  ]) {
    if (!toolNames.has(name)) throw new Error(`Tool missing: ${name}`);
  }
  const searchTool = (tools.tools || []).find((tool) => tool.name === "search_memory_graph");
  if (searchTool?.title !== "搜索 MemoryGraph" || !searchTool?.description?.includes("本地 Codex 会话存档")) {
    throw new Error("Search tool must default to Chinese copy");
  }
  if (resources.resources?.[0]?.mimeType !== "text/html;profile=mcp-app") throw new Error("Resource missing");
  if (!widget.contents?.[0]?.text?.includes("MemoryGraph")) throw new Error("Widget HTML missing");
  if (!widget.contents?.[0]?.text?.includes('<html lang="zh-CN">')) {
    throw new Error("Widget must default to Simplified Chinese");
  }
  if (!widget.contents?.[0]?.text?.includes('id="languageButton"')) {
    throw new Error("Widget language switch is missing");
  }
  if (!widget.contents?.[0]?.text?.includes('id="languageOnboarding"') ||
      !widget.contents?.[0]?.text?.includes('data-select-language="zh-CN"') ||
      !widget.contents?.[0]?.text?.includes('data-select-language="en"')) {
    throw new Error("First-open language selection is missing");
  }
  if (!widget.contents?.[0]?.text?.includes('const LANGUAGE_KEY = "memorygraph-language:v2"')) {
    throw new Error("Widget language preference key is missing");
  }
  if (mark.contents?.[0]?.mimeType !== "image/png" || !mark.contents?.[0]?.blob) {
    throw new Error("Widget mark missing");
  }
  if (mascot.contents?.[0]?.mimeType !== "image/png" || !mascot.contents?.[0]?.blob) {
    throw new Error("Widget mascot missing");
  }
  if (opened.structuredContent?.nodeCount !== 4) throw new Error("Tool call failed");
  if (opened._meta?.widgetData?.preferredLocale !== "en") throw new Error("Installed language was not sent to the dashboard");
  if (opened.structuredContent?.projectCount !== 1) throw new Error("Project count missing");
  if (opened.structuredContent?.taskCount !== 1) throw new Error("Task count missing");
  if (opened.structuredContent?.recordCount !== 1) throw new Error("Record count missing");
  if (opened.structuredContent?.memoryCount !== 1) throw new Error("Memory count missing");
  if (feedbackSaved.structuredContent?.feedback?.verdict !== "correct") {
    throw new Error("Feedback tool failed");
  }
  if (memoryReviewed.structuredContent?.review?.status !== "confirmed") {
    throw new Error("Memory review tool failed");
  }
  if (!opened.structuredContent?.snapshotPath?.startsWith(SNAPSHOT_ROOT)) {
    throw new Error("Standalone snapshot path missing");
  }
  if (!opened.structuredContent?.snapshotFileName?.includes("Probe")) {
    throw new Error("Snapshot filename title missing");
  }
  const task = opened._meta?.widgetData?.nodes?.find((node) => node.kind === "thread");
  if (task?.title !== exactTaskTitle) throw new Error("Exact Codex task title was changed");
  const record = opened._meta?.widgetData?.nodes?.find((node) => node.kind === "record");
  if (record?.content !== "The complete original answer.") throw new Error("Record content missing");
  if (record?.source?.threadId !== "a" || record?.source?.turnId !== "turn-1") {
    throw new Error("Source anchor missing");
  }
  if (record?.source?.threadTitle !== exactTaskTitle) throw new Error("Source task title changed");
  if (record?.source?.duplicateCount !== 3) throw new Error("Dedup metadata missing");
  if (record?.source?.copies?.length !== 2) throw new Error("Branch-copy metadata missing");
  const memory = opened._meta?.widgetData?.nodes?.find((node) => node.kind === "memory");
  if (memory?.memoryStatus !== "candidate" || memory?.evidenceType !== "explicit-statement") {
    throw new Error("Memory evidence metadata missing");
  }
  const contains = opened._meta?.widgetData?.edges?.find((edge) => edge.type === "contains");
  const derived = opened._meta?.widgetData?.edges?.find((edge) => edge.type === "derived");
  if (contains?.layer !== "content" || derived?.layer !== "content") {
    throw new Error("Content relation layer missing");
  }
  if (opened._meta?.widgetData?.retrieval?.deduplicatedRecords !== 10) {
    throw new Error("Retrieval stats missing");
  }
  process.stdout.write("MemoryGraph MCP probe passed\n");
} finally {
  child.stdin.end();
  child.kill("SIGTERM");
  rmSync(SNAPSHOT_ROOT, { recursive: true, force: true });
}
