import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  applyProductState,
  loadProductState,
  recordRetrievalFeedback,
  reviewMemoryCandidate,
} from "../mcp/product-state.mjs";

const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "memorygraph-state-"));
const filePath = path.join(temporaryRoot, "product-state.json");

try {
  const cwd = "/tmp/project-a";
  const query = "webhook callback";
  const record = recordRetrievalFeedback({
    cwd,
    query,
    recordId: "record:1",
    threadId: "thread:1",
    turnId: "turn:1",
    verdict: "correct",
  }, { filePath, now: new Date("2026-07-29T04:00:00.000Z") });
  if (record.verdict !== "correct") throw new Error("Feedback was not stored");

  recordRetrievalFeedback({
    cwd,
    query,
    recordId: "record:1",
    threadId: "thread:1",
    turnId: "turn:1",
    verdict: "incorrect",
  }, { filePath, now: new Date("2026-07-29T04:01:00.000Z") });

  reviewMemoryCandidate({
    cwd,
    memoryId: "memory:1",
    status: "confirmed",
    threadId: "thread:1",
    turnId: "turn:1",
  }, { filePath, now: new Date("2026-07-29T04:02:00.000Z") });

  const stored = loadProductState(filePath);
  if (stored.feedback.length !== 1 || stored.feedback[0].verdict !== "incorrect") {
    throw new Error("Latest feedback did not replace the previous verdict");
  }
  if (stored.memoryReviews["memory:1"]?.status !== "confirmed") {
    throw new Error("Memory review was not stored");
  }

  const graph = {
    scope: cwd,
    query,
    nodes: [
      { id: "record:1", kind: "record", matchScore: 0.9 },
      { id: "memory:1", kind: "memory", memoryStatus: "candidate", content: "Use webhook" },
    ],
    edges: [],
  };
  applyProductState(graph, { filePath });
  const appliedRecord = graph.nodes.find((node) => node.id === "record:1");
  const appliedMemory = graph.nodes.find((node) => node.id === "memory:1");
  if (appliedRecord.userFeedback !== "incorrect" || appliedRecord.matchScore !== 0.55) {
    throw new Error("Feedback ranking signal was not applied");
  }
  if (appliedMemory.memoryStatus !== "confirmed" || !appliedMemory.reviewedAt) {
    throw new Error("Memory review was not applied");
  }

  let correctionRejected = false;
  try {
    reviewMemoryCandidate({
      cwd,
      memoryId: "memory:1",
      status: "corrected",
    }, { filePath });
  } catch {
    correctionRejected = true;
  }
  if (!correctionRejected) throw new Error("Empty correction should be rejected");

  process.stdout.write("MemoryGraph product state probe passed\n");
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
