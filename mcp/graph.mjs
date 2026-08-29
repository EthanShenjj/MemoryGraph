const NODE_KINDS = new Set([
  "project", "record", "thread", "memory", "decision", "artifact", "milestone",
]);
const EDGE_TYPES = new Set(["membership", "fork", "shared-prefix", "continuation", "related", "contains", "derived"]);
const MATCH_TYPES = new Set(["exact", "semantic", "context"]);
const MEMORY_TYPES = new Set([
  "decision", "fact", "requirement", "open-question", "plan", "definition", "insight",
]);
const MEMORY_STATUSES = new Set([
  "candidate", "confirmed", "corrected", "superseded", "rejected",
]);
const EDGE_LAYERS = new Set(["task", "content"]);
const EDGE_DIRECTIONS = new Set(["directed", "symmetric"]);

function text(value, fallback = "", max = 500) {
  const normalized = String(value ?? "").trim();
  return (normalized || fallback).slice(0, max);
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function source(raw = {}) {
  return {
    threadId: text(raw?.threadId, "", 160),
    turnId: text(raw?.turnId, "", 160),
    threadTitle: text(raw?.threadTitle, "", 240),
    role: ["user", "assistant", "system"].includes(raw?.role) ? raw.role : "",
    timestamp: raw?.timestamp ?? null,
    prompt: text(raw?.prompt, "", 4000),
    excerpt: text(raw?.excerpt, "", 1200),
    contentHash: text(raw?.contentHash, "", 160),
    duplicateCount: Math.max(1, Math.min(99, Math.round(number(raw?.duplicateCount, 1)))),
    cwd: text(raw?.cwd, "", 500),
    line: Math.max(0, Math.round(number(raw?.line, 0))),
    copies: Array.isArray(raw?.copies)
      ? [...new Set(raw.copies.map((item) => text(item, "", 160)).filter(Boolean))].slice(0, 40)
      : [],
  };
}

function retrieval(raw = {}) {
  return {
    strategy: text(raw?.strategy, "record-first", 80),
    scannedTasks: Math.max(0, Math.round(number(raw?.scannedTasks, 0))),
    candidateTasks: Math.max(0, Math.round(number(raw?.candidateTasks, 0))),
    scannedRecords: Math.max(0, Math.round(number(raw?.scannedRecords, 0))),
    deduplicatedRecords: Math.max(0, Math.round(number(raw?.deduplicatedRecords, 0))),
    exactMatches: Math.max(0, Math.round(number(raw?.exactMatches, 0))),
    semanticMatches: Math.max(0, Math.round(number(raw?.semanticMatches, 0))),
    indexMode: text(raw?.indexMode, "", 40),
    changedFiles: Math.max(0, Math.round(number(raw?.changedFiles, 0))),
    reusedFiles: Math.max(0, Math.round(number(raw?.reusedFiles, 0))),
    memoryCandidates: Math.max(0, Math.round(number(raw?.memoryCandidates, 0))),
  };
}

export function normalizeGraph(input = {}) {
  const rawNodes = Array.isArray(input.nodes) ? input.nodes : [];
  const seen = new Set();
  const nodes = rawNodes.slice(0, 200).flatMap((raw, index) => {
    const id = text(raw?.id, `node-${index + 1}`, 160);
    if (seen.has(id)) return [];
    seen.add(id);
    const kind = NODE_KINDS.has(raw?.kind) ? raw.kind : "thread";
    return [{
      id,
      // A thread title is the exact Codex task title and must survive normalization.
      // Visual clamping belongs to the widget, not to the data boundary.
      title: text(raw?.title, "未命名任务", kind === "thread" ? 500 : 160),
      summary: text(raw?.summary, "", 1200),
      content: text(raw?.content, "", 20000),
      kind,
      status: text(raw?.status, "unknown", 40),
      updatedAt: raw?.updatedAt ?? null,
      projectId: text(raw?.projectId, "", 160),
      cwd: text(raw?.cwd, "", 500),
      hostId: text(raw?.hostId, "", 120),
      cluster: text(raw?.cluster, "未分组", 80),
      matchReason: text(raw?.matchReason, "", 300),
      matchType: MATCH_TYPES.has(raw?.matchType) ? raw.matchType : "",
      matchScore: Math.max(0, Math.min(1, number(raw?.matchScore, 0))),
      memoryType: MEMORY_TYPES.has(raw?.memoryType) ? raw.memoryType : "",
      memoryStatus: MEMORY_STATUSES.has(raw?.memoryStatus)
        ? raw.memoryStatus
        : (kind === "memory" ? "candidate" : ""),
      evidenceType: text(raw?.evidenceType, "", 80),
      confidence: Math.max(0, Math.min(1, number(raw?.confidence, 0))),
      source: source(raw?.source),
      tags: Array.isArray(raw?.tags)
        ? [...new Set(raw.tags.map((tag) => text(tag, "", 40)).filter(Boolean))].slice(0, 8)
        : [],
    }];
  });

  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = (Array.isArray(input.edges) ? input.edges : [])
    .slice(0, 400)
    .flatMap((raw, index) => {
      const source = text(raw?.source, "", 160);
      const target = text(raw?.target, "", 160);
      if (!nodeIds.has(source) || !nodeIds.has(target) || source === target) return [];
      const type = EDGE_TYPES.has(raw?.type) ? raw.type : "related";
      const defaultLayer = ["membership", "fork", "shared-prefix", "continuation"]
        .includes(type) ? "task" : "content";
      const defaultDirection = ["related", "shared-prefix"].includes(type)
        ? "symmetric"
        : "directed";
      return [{
        id: text(raw?.id, `edge-${index + 1}`, 180),
        source,
        target,
        type,
        layer: EDGE_LAYERS.has(raw?.layer) ? raw.layer : defaultLayer,
        direction: EDGE_DIRECTIONS.has(raw?.direction) ? raw.direction : defaultDirection,
        evidenceType: text(raw?.evidenceType, "", 80),
        evidence: text(raw?.evidence, "", 500),
        confidence: Math.max(0, Math.min(1, number(raw?.confidence, type === "fork" ? 1 : 0.6))),
        label: text(raw?.label, "", 100),
      }];
    });

  return {
    version: 1,
    title: text(input.title, "MemoryGraph", 120),
    query: text(input.query, "", 240),
    scope: text(input.scope, "当前项目", 160),
    rootProjectId: text(input.rootProjectId, "", 160),
    mode: ["project", "search", "branch"].includes(input.mode) ? input.mode : "project",
    generatedAt: input.generatedAt || new Date().toISOString(),
    retrieval: retrieval(input.retrieval),
    nodes,
    edges,
  };
}
