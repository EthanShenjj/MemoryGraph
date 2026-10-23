import {
  existsSync,
  openSync,
  closeSync,
  unlinkSync,
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
    reviewHistory: [],
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
    if (value.version !== STATE_VERSION) throw new Error("Unsupported state version");
    return {
      version: STATE_VERSION,
      feedback: Array.isArray(value.feedback) ? value.feedback : [],
      memoryReviews: value.memoryReviews && typeof value.memoryReviews === "object"
        ? value.memoryReviews
        : {},
      reviewHistory: Array.isArray(value.reviewHistory) ? value.reviewHistory : [],
    };
  } catch (error) {
    throw new Error(`Cannot read saved MemoryGraph state; existing state was not overwritten: ${error.message}`);
  }
}

function atomicWrite(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(temporary, filePath);
}

function updateState(filePath, update) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const lock = `${filePath}.lock`;
  let descriptor;
  try { descriptor = openSync(lock, "wx"); }
  catch { throw new Error("Memory state is busy; retry after the other writer finishes"); }
  try {
    const state = loadProductState(filePath);
    const result = update(state);
    atomicWrite(filePath, state);
    return result;
  } finally { closeSync(descriptor); unlinkSync(lock); }
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
    input.verdict === "incorrect" ? "incorrect" : input.verdict === "cleared" ? "cleared" : "";
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

  return updateState(filePath, (state) => {
    const identity = feedbackIdentity(entry);
    state.feedback = state.feedback
      .filter((candidate) => feedbackIdentity(candidate) !== identity)
      .concat(verdict === "cleared" ? [] : [entry])
      .slice(-FEEDBACK_LIMIT);
    return entry;
  });
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
    content: input.status === "corrected" ? normalizedText(input.content) : "",
    note: normalizedText(input.note),
    threadId: normalizedText(input.threadId),
    turnId: normalizedText(input.turnId),
    supersededBy: input.status === "superseded" ? normalizedText(input.supersededBy) : "",
    updatedAt: now.toISOString(),
  };
  if (!review.cwd || !review.memoryId || !allowed.has(review.status)) {
    throw new Error("cwd, memoryId, and a valid memory status are required");
  }
  if (review.status === "corrected" && !review.content) {
    throw new Error("Corrected memory requires replacement content");
  }

  return updateState(filePath, (state) => {
    const previous = state.memoryReviews[review.memoryId];
    if (previous && previous.cwd !== review.cwd) throw new Error("Memory belongs to another project");
    if (["confirmed", "superseded"].includes(review.status) && !review.content && previous?.content) review.content = previous.content;
    const revision = previous?.revision || 0;
    if (input.expectedRevision !== undefined && input.expectedRevision !== revision) {
      throw new Error("Memory changed in another window; refresh before saving");
    }
    if (review.status === "superseded") {
      if (!review.supersededBy) throw new Error("Choose a replacement memory");
      const replacement = state.memoryReviews[review.supersededBy];
      if (!replacement || replacement.cwd !== review.cwd || !["confirmed", "corrected"].includes(replacement.status)) {
        throw new Error("Replacement must be a confirmed memory in this project");
      }
      const visited = new Set([review.memoryId]);
      let target = review.supersededBy;
      while (target) {
        if (visited.has(target)) throw new Error("Replacement cycle is not allowed");
        visited.add(target);
        target = state.memoryReviews[target]?.supersededBy;
      }
    }
    review.revision = revision + 1;
    state.reviewHistory.push({ ...review, previous: previous || null });
    state.memoryReviews[review.memoryId] = review;
    return review;
  });
}

export function applyProductState(graph, {
  filePath = defaultProductStatePath(),
  state: providedState,
} = {}) {
  const state = providedState || loadProductState(filePath);
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
        matchScore: node.retrievalScoreApplied ? originalScore : adjustedScore,
        userFeedback: entry.verdict,
        feedbackAt: entry.createdAt,
      };
    }
    if (node.kind === "memory") {
      const review = state.memoryReviews[node.id];
      if (!review || normalizedText(review.cwd) !== cwd) return node;
      return {
        ...node,
        content: ["corrected", "confirmed", "superseded"].includes(review.status) && review.content
          ? review.content
          : node.content,
        memoryStatus: review.status,
        reviewNote: review.note,
        reviewedAt: review.updatedAt,
        reviewRevision: review.revision || 0,
        supersededBy: review.supersededBy || "",
        reviewHistory: state.reviewHistory.filter((item) => item.cwd === cwd && item.memoryId === node.id).slice(-20),
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
