import assert from "node:assert/strict";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { refreshMemoryIndex, searchMemoryIndex } from "../mcp/memory-index.mjs";

const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "memorygraph-probe-"));
const sessionsRoot = path.join(temporaryRoot, "sessions");
const sessionDir = path.join(sessionsRoot, "2026", "07", "29");
const indexDir = path.join(temporaryRoot, "index");
const titleIndexPath = path.join(temporaryRoot, "session_index.jsonl");
const cwd = "/workspace/sample-project";
mkdirSync(sessionDir, { recursive: true });

function event(type, payload, timestamp) {
  return JSON.stringify({ timestamp, type, payload });
}

function turn(turnId, prompt, answer, timestamp) {
  return [
    event("turn_context", { turn_id: turnId }, timestamp),
    event("response_item", {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: prompt }],
    }, timestamp),
    event("response_item", {
      type: "message",
      role: "assistant",
      phase: "final_answer",
      content: [{ type: "output_text", text: answer }],
    }, new Date(Date.parse(timestamp) + 1000).toISOString()),
  ];
}

function session(threadId, turns, timestamp) {
  return [
    event("session_meta", { id: threadId, cwd, timestamp, source: "Codex Desktop" }, timestamp),
    ...turns.flat(),
  ].join("\n") + "\n";
}

try {
  const shared = [
    turn("turn-shared-1", "Webhook 是什么？", "Webhook 是事件回调。", "2026-07-29T01:00:00.000Z"),
    turn("turn-shared-2", "回调如何鉴权？", "用签名鉴权。", "2026-07-29T01:01:00.000Z"),
    turn("turn-shared-3", "失败后怎么办？", "按退避策略重试。", "2026-07-29T01:02:00.000Z"),
  ];
  const sourceTurn = turn(
    "turn-routing-source",
    "讨论 delivery routing 应该放在哪里",
    "分析若干方案。\n\n## 最终结论\nDelivery routing 应由应用在发送前统一计算，并保留原始规则作为审计证据。",
    "2026-07-29T01:03:00.000Z",
  );
  const branchTurn = turn(
    "turn-routing-branch",
    "补充 delivery routing 的灰度策略",
    "Delivery routing 灰度应按工作区开关逐步放量。",
    "2026-07-29T02:03:00.000Z",
  );

  writeFileSync(
    path.join(sessionDir, "source.jsonl"),
    session("task-source", [...shared, sourceTurn], "2026-07-29T01:00:00.000Z"),
  );
  writeFileSync(
    path.join(sessionDir, "branch.jsonl"),
    session("task-branch", [...shared, sourceTurn, branchTurn], "2026-07-29T02:00:00.000Z"),
  );
  writeFileSync(titleIndexPath, [
    JSON.stringify({ id: "task-source", thread_name: "确认 Delivery Routing 归属" }),
    JSON.stringify({ id: "task-branch", thread_name: "补充 Delivery Routing 灰度策略" }),
  ].join("\n") + "\n");

  const first = refreshMemoryIndex({ cwd, sessionsRoot, titleIndexPath, indexDir });
  assert.equal(first.stats.mode, "full");
  assert.equal(first.stats.parsedFiles, 2);
  assert.equal(first.stats.reusedFiles, 0);
  assert.equal(first.stats.indexedTasks, 2);
  assert.equal(first.stats.indexedRecords, 5, "copied Turns should become canonical records");
  assert.equal(first.stats.memoryCandidates, 1);

  const searched = searchMemoryIndex(first.index, {
    query: "delivery routing",
    limit: 8,
    indexStats: first.stats,
  });
  const sourceRecord = searched.results.find((record) =>
    record.turnId === "turn-routing-source");
  assert(sourceRecord, "source delivery-routing record should be found");
  assert.equal(sourceRecord.threadId, "task-source", "earliest task owns the copied Turn");
  assert.equal(sourceRecord.duplicateCount, 2);
  assert.deepEqual(sourceRecord.copiedToThreads, ["task-source", "task-branch"]);
  assert(searched.graph.nodes.some((node) =>
    node.kind === "memory" &&
    node.memoryStatus === "candidate" &&
    node.evidenceType === "explicit-statement"));
  assert(searched.graph.edges.some((edge) =>
    edge.type === "shared-prefix" &&
    edge.layer === "task" &&
    edge.direction === "symmetric"));
  assert(searched.graph.edges.some((edge) =>
    edge.type === "contains" && edge.layer === "content"));
  assert(searched.graph.edges.some((edge) =>
    edge.type === "derived" && edge.layer === "content"));

  const unchanged = refreshMemoryIndex({ cwd, sessionsRoot, titleIndexPath, indexDir });
  assert.equal(unchanged.stats.mode, "incremental");
  assert.equal(unchanged.stats.parsedFiles, 0);
  assert.equal(unchanged.stats.reusedFiles, 2);

  appendFileSync(
    path.join(sessionDir, "branch.jsonl"),
    turn(
      "turn-routing-new",
      "delivery routing 结果如何排查？",
      "保留命中规则和工作区 ID。",
      "2026-07-29T03:00:00.000Z",
    ).join("\n") + "\n",
  );
  const changed = refreshMemoryIndex({ cwd, sessionsRoot, titleIndexPath, indexDir });
  assert.equal(changed.stats.mode, "incremental");
  assert.equal(changed.stats.parsedFiles, 1);
  assert.equal(changed.stats.reusedFiles, 1);
  assert.equal(changed.stats.indexedRecords, 6);

  process.stdout.write("MemoryGraph local index probe passed\n");
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
