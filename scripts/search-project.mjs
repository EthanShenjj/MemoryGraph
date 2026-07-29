import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [cwd, query, outputPath] = process.argv.slice(2);

if (!cwd || !query) {
  throw new Error("Usage: node scripts/search-project.mjs <cwd> <query> [result.json]");
}

const testRoot = process.env.MEMORYGRAPH_TEST_ROOT ||
  process.env.THREAD_ATLAS_TEST_ROOT ||
  path.join(os.tmpdir(), "memorygraph-search-test");
const child = spawn(process.execPath, ["./mcp/server.mjs"], {
  cwd: ROOT,
  env: {
    ...process.env,
    MEMORYGRAPH_INDEX_DIR: process.env.MEMORYGRAPH_INDEX_DIR ||
      process.env.THREAD_ATLAS_INDEX_DIR ||
      path.join(testRoot, "index"),
    MEMORYGRAPH_SNAPSHOT_DIR: process.env.MEMORYGRAPH_SNAPSHOT_DIR ||
      process.env.THREAD_ATLAS_SNAPSHOT_DIR ||
      path.join(testRoot, "snapshots"),
    MEMORYGRAPH_STATE_PATH: process.env.MEMORYGRAPH_STATE_PATH ||
      process.env.THREAD_ATLAS_STATE_PATH ||
      path.join(testRoot, "product-state.json"),
  },
  stdio: ["pipe", "pipe", "inherit"],
});

const lines = readline.createInterface({ input: child.stdout });
let nextId = 1;
const pending = new Map();

lines.on("line", (line) => {
  const message = JSON.parse(line);
  const request = pending.get(message.id);
  if (!request) return;
  pending.delete(message.id);
  if (message.error) request.reject(new Error(message.error.message));
  else request.resolve(message.result);
});

function call(method, params = {}) {
  const id = nextId++;
  const response = new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
  });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  return response;
}

try {
  await call("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "memorygraph-search-test", version: "1.0.0" },
  });
  const result = await call("tools/call", {
    name: "search_memory_graph",
    arguments: {
      cwd,
      query,
      limit: 12,
      forceRebuild: true,
      saveSnapshot: true,
      snapshotTitle: `${path.basename(cwd)}-${query}-verified`,
    },
  });
  if (outputPath) {
    mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }
  process.stdout.write(`${JSON.stringify(result.structuredContent, null, 2)}\n`);
} finally {
  child.stdin.end();
  child.kill("SIGTERM");
}
