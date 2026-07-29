import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

const STATE_VERSION = 1;
const FEEDBACK_LIMIT = 1_000;
const PRODUCT_STATE_PATH = path.join(
  os.homedir(),
  ".codex",
  "memorygraph",
  "product-state.json",
);
const LEGACY_PRODUCT_STATE_PATH = path.join(
  os.homedir(),
  ".codex",
  "thread-atlas",
  "product-state.json",
);

export function defaultProductStatePath() {
  return process.env.MEMORYGRAPH_STATE_PATH ||
    process.env.THREAD_ATLAS_STATE_PATH ||
    PRODUCT_STATE_PATH;
}

function emptyState() {
  return {
    version: STATE_VERSION,
    feedback: [],
    memoryReviews: {},
  };
}

export function loadProductState(filePath = defaultProductStatePath()) {
  const readablePath = !existsSync(filePath) &&
      filePath === PRODUCT_STATE_PATH &&
      existsSync(LEGACY_PRODUCT_STATE_PATH)
    ? LEGACY_PRODUCT_STATE_PATH
    : filePath;
  if (!existsSync(readablePath)) return emptyState();
  try {
    const value = JSON.parse(readFileSync(readablePath, "utf8"));
    if (value.version !== STATE_VERSION) return emptyState();
    return {
      version: STATE_VERSION,
      feedback: Array.isArray(value.feedback) ? value.feedback : [],
      memoryReviews: value.memoryReviews && typeof value.memoryReviews === "object"
        ? value.memoryReviews
        : {},
    };
  } catch {
    return emptyState();
  }
}

function atomicWrite(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, filePath);
}

function normalizedText(value) {
  return String(value || "").trim();
}

function feedbackIdentity(entry) {
  return [
    normalizedText(entry.cwd),
    normalizedText(entry.query).toLocaleLowerCase(),
    normalizedText(entry.recordId),
  ].join("\u0000");
}

export function recordRetrievalFeedback(input = {}, {
  filePath = defaultProductStatePath(),
  now = new Date(),
} = {}) {
  const verdict = input.verdict === "correct" ? "correct" :
    input.verdict === "incorrect" ? "incorrect" : "";
  const entry = {
    cwd: normalizedText(input.cwd),
    query: normalizedText(input.query),
    recordId: normalizedText(input.recordId),
    threadId: normalizedText(input.threadId),
    turnId: normalizedText(input.turnId),
    verdict,
    reason: normalizedText(input.reason),
    createdAt: now.toISOString(),
  };
  if (!entry.cwd || !entry.query || !entry.recordId || !entry.verdict) {
    throw new Error("cwd, query, recordId, and a valid verdict are required");
  }

  const state = loadProductState(filePath);
  const identity = feedbackIdentity(entry);
  state.feedback = state.feedback
    .filter((candidate) => feedbackIdentity(candidate) !== identity)
    .concat(entry)
    .slice(-FEEDBACK_LIMIT);
  atomicWrite(filePath, state);
  return entry;
}

export function reviewMemoryCandidate(input = {}, {
  filePath = defaultProductStatePath(),
  now = new Date(),
} = {}) {
  const allowed = new Set(["confirmed", "rejected", "corrected", "superseded", "candidate"]);
  const review = {
    cwd: normalizedText(input.cwd),
    memoryId: normalizedText(input.memoryId),
    status: normalizedText(input.status),
    content: normalizedText(input.content),
    note: normalizedText(input.note),
    threadId: normalizedText(input.threadId),
    turnId: normalizedText(input.turnId),
    updatedAt: now.toISOString(),
  };
  if (!review.cwd || !review.memoryId || !allowed.has(review.status)) {
    throw new Error("cwd, memoryId, and a valid memory status are required");
  }
  if (review.status === "corrected" && !review.content) {
    throw new Error("Corrected memory requires replacement content");
  }

  const state = loadProductState(filePath);
  state.memoryReviews[review.memoryId] = review;
  atomicWrite(filePath, state);
  return review;
}

export function applyProductState(graph, {
  filePath = defaultProductStatePath(),
} = {}) {
  const state = loadProductState(filePath);
  const cwd = normalizedText(graph.scope || graph.nodes?.find((node) => node.kind === "project")?.cwd);
  const query = normalizedText(graph.query).toLocaleLowerCase();
  const feedback = new Map(
    state.feedback
      .filter((entry) =>
        normalizedText(entry.cwd) === cwd &&
        normalizedText(entry.query).toLocaleLowerCase() === query)
      .map((entry) => [entry.recordId, entry]),
  );

  graph.nodes = (graph.nodes || []).map((node) => {
    if (node.kind === "record") {
      const entry = feedback.get(node.id);
      if (!entry) return node;
      const originalScore = Number(node.matchScore || 0);
      const adjustedScore = entry.verdict === "correct"
        ? Math.min(1, originalScore + 0.12)
        : Math.max(0, originalScore - 0.35);
      return {
        ...node,
        retrievalOriginalScore: originalScore,
        matchScore: adjustedScore,
        userFeedback: entry.verdict,
        feedbackAt: entry.createdAt,
      };
    }
    if (node.kind === "memory") {
      const review = state.memoryReviews[node.id];
      if (!review || normalizedText(review.cwd) !== cwd) return node;
      return {
        ...node,
        content: review.status === "corrected" && review.content
          ? review.content
          : node.content,
        memoryStatus: review.status,
        reviewNote: review.note,
        reviewedAt: review.updatedAt,
      };
    }
    return node;
  });
  graph.feedbackSummary = {
    correct: [...feedback.values()].filter((entry) => entry.verdict === "correct").length,
    incorrect: [...feedback.values()].filter((entry) => entry.verdict === "incorrect").length,
  };
  return graph;
}
