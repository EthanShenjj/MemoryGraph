import {
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  readSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

const INDEX_VERSION = 2;
const MAX_RECORD_CONTENT = 20000;
const MAX_PROMPT_CONTENT = 6000;
const APPROVAL_PREFIX = "The following is the Codex agent history";
const DEFAULT_INDEX_DIR = path.join(os.homedir(), ".codex", "memorygraph");
const LEGACY_INDEX_DIR = path.join(os.homedir(), ".codex", "thread-atlas");

function normalize(value) {
  return String(value ?? "").normalize("NFKC").trim();
}

function normalizedSearch(value) {
  return normalize(value).toLocaleLowerCase();
}

function clamp(value, max) {
  return normalize(value).slice(0, max);
}

function hash(value) {
  return createHash("sha256").update(String(value ?? "")).digest("hex");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function listJsonlFiles(root) {
  if (!existsSync(root)) return [];
  const result = [];
  const queue = [root];
  while (queue.length) {
    const current = queue.shift();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) queue.push(fullPath);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) result.push(fullPath);
    }
  }
  return result.sort();
}

function firstJsonLine(filePath) {
  const descriptor = openSync(filePath, "r");
  const chunks = [];
  const buffer = Buffer.alloc(65536);
  let total = 0;
  try {
    while (total < 1024 * 1024) {
      const bytes = readSync(descriptor, buffer, 0, buffer.length, total);
      if (!bytes) break;
      const chunk = buffer.subarray(0, bytes);
      const newline = chunk.indexOf(10);
      if (newline >= 0) {
        chunks.push(chunk.subarray(0, newline));
        break;
      }
      chunks.push(chunk);
      total += bytes;
    }
  } finally {
    closeSync(descriptor);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}

function messageText(payload) {
  return (Array.isArray(payload?.content) ? payload.content : [])
    .map((item) => item?.text || "")
    .join("\n")
    .trim();
}

function cleanUserPrompt(value) {
  let text = normalize(value);
  text = text
    .replace(/<in-app-browser-context[\s\S]*?<\/in-app-browser-context>/gi, "")
    .replace(/<environment_context[\s\S]*?<\/environment_context>/gi, "")
    .trim();
  const explicitRequest = text.match(/## My request for Codex:\s*([\s\S]*)$/i);
  if (explicitRequest) text = explicitRequest[1].trim();
  return text;
}

function isHumanPrompt(value) {
  const text = cleanUserPrompt(value);
  if (!text) return false;
  if (text.startsWith(APPROVAL_PREFIX)) return false;
  if (/approval assessment/i.test(text)) return false;
  return true;
}

function parseSessionFile(filePath) {
  const lines = readFileSync(filePath, "utf8").split("\n");
  let meta = null;
  let currentTurnId = "";
  const turns = new Map();

  for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
    const line = lines[lineNumber];
    if (!line) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event.type === "session_meta") {
      meta = event.payload || null;
      continue;
    }
    if (event.type === "turn_context") {
      currentTurnId = normalize(event.payload?.turn_id) || currentTurnId;
      continue;
    }
    const payload = event.type === "response_item" ? event.payload : null;
    if (payload?.type !== "message" || !["user", "assistant"].includes(payload.role)) continue;
    const turnId = normalize(
      payload.internal_chat_message_metadata_passthrough?.turn_id || currentTurnId,
    );
    if (!turnId) continue;
    const text = messageText(payload);
    if (!text) continue;
    const turn = turns.get(turnId) || { turnId, messages: [] };
    turn.messages.push({
      role: payload.role,
      phase: normalize(payload.phase),
      text,
      timestamp: event.timestamp || null,
      line: lineNumber + 1,
    });
    turns.set(turnId, turn);
  }

  return {
    threadId: normalize(meta?.id || meta?.session_id),
    cwd: normalize(meta?.cwd),
    createdAt: meta?.timestamp || null,
    source: normalize(meta?.source),
    originator: normalize(meta?.originator),
    turns: [...turns.values()],
  };
}

function loadTitles(indexPath) {
  const titles = new Map();
  if (!existsSync(indexPath)) return titles;
  for (const line of readFileSync(indexPath, "utf8").split("\n")) {
    if (!line) continue;
    try {
      const item = JSON.parse(line);
      if (item?.id) titles.set(String(item.id), normalize(item.thread_name));
    } catch {
      // Ignore one malformed title row without losing the rest of the local index.
    }
  }
  return titles;
}

function chooseMessage(messages, role) {
  const candidates = messages.filter((message) => message.role === role);
  if (!candidates.length) return null;
  if (role === "assistant") {
    const finals = candidates.filter((message) => message.phase === "final_answer");
    if (finals.length) return finals.at(-1);
  }
  return candidates.at(-1);
}

function buildCanonicalRecords(fileEntries, titles) {
  const occurrencesByTurn = new Map();
  const threadTurns = new Map();
  const threads = new Map();

  for (const entry of Object.values(fileEntries)) {
    const session = entry.session;
    if (!session?.threadId) continue;
    const turnIds = threadTurns.get(session.threadId) || new Set();
    const thread = threads.get(session.threadId) || {
      id: session.threadId,
      title: titles.get(session.threadId) || "Untitled task",
      cwd: session.cwd,
      createdAt: session.createdAt,
      updatedAt: session.createdAt,
      turnCount: 0,
    };

    for (const turn of session.turns || []) {
      turnIds.add(turn.turnId);
      const user = chooseMessage(turn.messages || [], "user");
      const assistant = chooseMessage(turn.messages || [], "assistant");
      if (!user || !assistant || !isHumanPrompt(user.text)) continue;
      const occurrence = {
        turnId: turn.turnId,
        threadId: session.threadId,
        threadTitle: titles.get(session.threadId) || "Untitled task",
        cwd: session.cwd,
        sessionCreatedAt: session.createdAt,
        prompt: cleanUserPrompt(user.text),
        answer: assistant.text,
        promptTimestamp: user.timestamp,
        answerTimestamp: assistant.timestamp,
        promptLine: user.line,
        answerLine: assistant.line,
      };
      const occurrences = occurrencesByTurn.get(turn.turnId) || [];
      occurrences.push(occurrence);
      occurrencesByTurn.set(turn.turnId, occurrences);
      thread.updatedAt = assistant.timestamp || user.timestamp || thread.updatedAt;
    }
    thread.turnCount = turnIds.size;
    threadTurns.set(session.threadId, turnIds);
    threads.set(session.threadId, thread);
  }

  const records = [];
  for (const [turnId, rawOccurrences] of occurrencesByTurn) {
    const occurrences = rawOccurrences
      .filter((item) => item.prompt && item.answer)
      .sort((a, b) =>
        String(a.promptTimestamp || "").localeCompare(String(b.promptTimestamp || "")) ||
        String(a.sessionCreatedAt || "").localeCompare(String(b.sessionCreatedAt || "")) ||
        String(a.threadId).localeCompare(String(b.threadId)));
    if (!occurrences.length) continue;
    const origin = occurrences[0];
    const copies = unique(occurrences.map((item) => item.threadId));
    const answer = clamp(origin.answer, MAX_RECORD_CONTENT);
    const prompt = clamp(origin.prompt, MAX_PROMPT_CONTENT);
    records.push({
      id: `record:${origin.threadId}:${turnId}:assistant`,
      canonicalId: `${origin.threadId}:${turnId}:assistant`,
      turnId,
      originThreadId: origin.threadId,
      originThreadTitle: origin.threadTitle,
      cwd: origin.cwd,
      prompt,
      answer,
      promptTimestamp: origin.promptTimestamp,
      answerTimestamp: origin.answerTimestamp,
      promptLine: origin.promptLine,
      answerLine: origin.answerLine,
      contentHash: hash(answer),
      copies,
      duplicateCount: rawOccurrences.length,
    });
  }

  records.sort((a, b) =>
    String(b.answerTimestamp || "").localeCompare(String(a.answerTimestamp || "")));

  return {
    records,
    threads: [...threads.values()],
    threadTurns: Object.fromEntries(
      [...threadTurns].map(([threadId, turnIds]) => [threadId, [...turnIds]]),
    ),
  };
}

function memoryStatement(answer) {
  const lines = String(answer || "").replace(/\r\n?/g, "\n").split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^(?:#{1,6}\s*)?(?:final conclusion|core conclusion|product conclusion|conclusion|one-line summary|\u6700\u7ec8\u7ed3\u8bba|\u6838\u5fc3\u7ed3\u8bba|\u4ea7\u54c1\u7ed3\u8bba|\u7ed3\u8bba|\u4e00\u53e5\u8bdd\u603b\u7ed3)\s*[\uFF1A:]?\s*$/i
      .test(lines[index].trim())) continue;
    for (let cursor = index + 1; cursor < Math.min(lines.length, index + 8); cursor += 1) {
      const candidate = lines[cursor].replace(/^\s*>\s?/, "").trim();
      if (candidate) return candidate;
    }
  }
  return "";
}

function extractMemories(records) {
  return records.flatMap((record) => {
    const statement = memoryStatement(record.answer);
    if (!statement) return [];
    return [{
      id: `memory:${record.originThreadId}:${record.turnId}:decision`,
      recordId: record.id,
      threadId: record.originThreadId,
      turnId: record.turnId,
      title: clamp(statement, 120),
      content: clamp(statement, 1200),
      memoryType: "decision",
      memoryStatus: "candidate",
      evidenceType: "explicit-statement",
      confidence: 0.78,
      source: {
        threadId: record.originThreadId,
        turnId: record.turnId,
        threadTitle: record.originThreadTitle,
        timestamp: record.answerTimestamp,
        prompt: record.prompt,
        excerpt: clamp(record.answer, 280),
        contentHash: record.contentHash,
        duplicateCount: record.duplicateCount,
        copies: record.copies,
        cwd: record.cwd,
      },
    }];
  });
}

function indexFilePath(cwd, indexDir) {
  return path.join(indexDir, `memory-index-${hash(cwd).slice(0, 16)}.json`);
}

function safeLoadIndex(filePath, cwd) {
  if (!existsSync(filePath)) return null;
  try {
    const index = JSON.parse(readFileSync(filePath, "utf8"));
    if (index.version !== INDEX_VERSION || index.cwd !== cwd) return null;
    return index;
  } catch {
    return null;
  }
}

function atomicWrite(filePath, value) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value)}\n`, "utf8");
  renameSync(temporary, filePath);
}

export function refreshMemoryIndex({
  cwd,
  force = false,
  sessionsRoot = process.env.CODEX_SESSIONS_DIR ||
    path.join(os.homedir(), ".codex", "sessions"),
  titleIndexPath = process.env.CODEX_SESSION_INDEX ||
    path.join(os.homedir(), ".codex", "session_index.jsonl"),
  indexDir = process.env.MEMORYGRAPH_INDEX_DIR ||
    process.env.THREAD_ATLAS_INDEX_DIR ||
    DEFAULT_INDEX_DIR,
} = {}) {
  const exactCwd = normalize(cwd);
  if (!exactCwd) throw new Error("cwd is required for a project-scoped memory index");
  const targetPath = indexFilePath(exactCwd, indexDir);
  const legacyPath = indexFilePath(exactCwd, LEGACY_INDEX_DIR);
  const previous = force
    ? null
    : safeLoadIndex(targetPath, exactCwd) ||
      (indexDir === DEFAULT_INDEX_DIR ? safeLoadIndex(legacyPath, exactCwd) : null);
  const previousFiles = previous?.files || {};
  const previousScanCache = previous?.scanCache || {};
  const files = {};
  const scanCache = {};
  let parsedFiles = 0;
  let reusedFiles = 0;
  let skippedFiles = 0;

  for (const filePath of listJsonlFiles(sessionsRoot)) {
    let fileStat;
    try {
      fileStat = statSync(filePath);
    } catch {
      continue;
    }
    const cached = previousFiles[filePath];
    const scanned = previousScanCache[filePath];
    if (!force && cached &&
        cached.mtimeMs === fileStat.mtimeMs &&
        cached.size === fileStat.size) {
      files[filePath] = cached;
      scanCache[filePath] = { mtimeMs: fileStat.mtimeMs, size: fileStat.size, inScope: true };
      reusedFiles += 1;
      continue;
    }
    if (!force && scanned &&
        scanned.mtimeMs === fileStat.mtimeMs &&
        scanned.size === fileStat.size &&
        scanned.inScope === false) {
      scanCache[filePath] = scanned;
      skippedFiles += 1;
      continue;
    }
    const first = firstJsonLine(filePath);
    if (first?.type !== "session_meta" || normalize(first.payload?.cwd) !== exactCwd) {
      scanCache[filePath] = { mtimeMs: fileStat.mtimeMs, size: fileStat.size, inScope: false };
      skippedFiles += 1;
      continue;
    }
    const session = parseSessionFile(filePath);
    if (session.cwd !== exactCwd) continue;
    files[filePath] = {
      mtimeMs: fileStat.mtimeMs,
      size: fileStat.size,
      session,
    };
    scanCache[filePath] = { mtimeMs: fileStat.mtimeMs, size: fileStat.size, inScope: true };
    parsedFiles += 1;
  }

  const titles = loadTitles(titleIndexPath);
  const canonical = buildCanonicalRecords(files, titles);
  const memories = extractMemories(canonical.records);
  const index = {
    version: INDEX_VERSION,
    cwd: exactCwd,
    generatedAt: new Date().toISOString(),
    sessionsRoot,
    titleIndexPath,
    files,
    scanCache,
    threads: canonical.threads,
    threadTurns: canonical.threadTurns,
    records: canonical.records,
    memories,
  };
  atomicWrite(targetPath, index);
  return {
    index,
    indexPath: targetPath,
    stats: {
      mode: force || !previous ? "full" : "incremental",
      parsedFiles,
      reusedFiles,
      skippedFiles,
      indexedTasks: canonical.threads.length,
      indexedRecords: canonical.records.length,
      memoryCandidates: memories.length,
    },
  };
}

function queryTokens(query) {
  const normalized = normalizedSearch(query);
  const words = normalized.match(/[\p{L}\p{N}_-]+/gu) || [];
  const tokens = new Set(words.filter((word) => word.length > 1));
  for (const word of words) {
    if (!/[\p{Script=Han}]/u.test(word) || word.length < 4) continue;
    for (let index = 0; index < word.length - 1; index += 1) {
      tokens.add(word.slice(index, index + 2));
    }
  }
  return [...tokens];
}

function scoreRecord(record, query) {
  const phrase = normalizedSearch(query);
  const prompt = normalizedSearch(record.prompt);
  const answer = normalizedSearch(record.answer);
  const title = normalizedSearch(record.originThreadTitle);
  const tokens = queryTokens(query);
  const reasons = [];
  let score = 0;
  if (phrase && prompt.includes(phrase)) {
    score += 100;
    reasons.push("The original user prompt contains the full query");
  }
  if (phrase && answer.includes(phrase)) {
    score += 70;
    reasons.push("The original assistant answer contains the full query");
  }
  if (phrase && title.includes(phrase)) {
    score += 45;
    reasons.push("The task title contains the full query");
  }
  let promptHits = 0;
  let answerHits = 0;
  let titleHits = 0;
  for (const token of tokens) {
    if (prompt.includes(token)) {
      score += 15;
      promptHits += 1;
    }
    if (answer.includes(token)) {
      score += 8;
      answerHits += 1;
    }
    if (title.includes(token)) {
      score += 6;
      titleHits += 1;
    }
  }
  if (promptHits) reasons.push(`User prompt matched ${promptHits}/${tokens.length || 1} query terms`);
  if (answerHits) reasons.push(`Assistant answer matched ${answerHits}/${tokens.length || 1} query terms`);
  if (titleHits) reasons.push(`Task title matched ${titleHits}/${tokens.length || 1} query terms`);
  return {
    score,
    matchType: phrase && (prompt.includes(phrase) || answer.includes(phrase) || title.includes(phrase))
      ? "exact"
      : "lexical",
    reasons,
  };
}

function sharedPrefixEdges(index, taskIds) {
  const edges = [];
  const sets = new Map(taskIds.map((threadId) => [
    threadId,
    new Set(index.threadTurns?.[threadId] || []),
  ]));
  for (let left = 0; left < taskIds.length; left += 1) {
    for (let right = left + 1; right < taskIds.length; right += 1) {
      const a = taskIds[left];
      const b = taskIds[right];
      const aTurns = sets.get(a);
      const bTurns = sets.get(b);
      const shared = [...aTurns].filter((turnId) => bTurns.has(turnId));
      if (shared.length < 3) continue;
      edges.push({
        id: `shared-prefix:${a}:${b}`,
        source: a,
        target: b,
        type: "shared-prefix",
        layer: "task",
        direction: "symmetric",
        evidenceType: "turn-id-overlap",
        evidence: `${shared.length} shared Turn IDs`,
        confidence: Math.min(0.99, 0.7 + shared.length * 0.02),
        label: `${shared.length} shared Turns`,
      });
    }
  }
  return edges;
}

function projectId(cwd) {
  return `project:${hash(cwd).slice(0, 16)}`;
}

export function searchMemoryIndex(index, {
  query,
  limit = 8,
  indexStats = {},
} = {}) {
  const searchQuery = normalize(query);
  if (!searchQuery) throw new Error("query is required");
  const cappedLimit = Math.max(1, Math.min(20, Number(limit) || 8));
  const scored = index.records
    .map((record) => ({ record, ranking: scoreRecord(record, searchQuery) }))
    .filter((item) => item.ranking.score > 0);
  const taskHitCounts = new Map();
  for (const item of scored) {
    const threadId = item.record.originThreadId;
    taskHitCounts.set(threadId, (taskHitCounts.get(threadId) || 0) + 1);
  }
  const ranked = scored
    .map((item) => {
      const taskHits = taskHitCounts.get(item.record.originThreadId) || 1;
      const densityBonus = Math.min(30, Math.max(0, taskHits - 1) * 10);
      return {
        ...item,
        ranking: {
          ...item.ranking,
          score: item.ranking.score + densityBonus,
          reasons: densityBonus
            ? [...item.ranking.reasons, `${taskHits - 1} additional relevant records in the same source task`]
            : item.ranking.reasons,
        },
      };
    })
    .sort((a, b) =>
      b.ranking.score - a.ranking.score ||
      String(b.record.answerTimestamp || "").localeCompare(String(a.record.answerTimestamp || "")))
    .slice(0, cappedLimit);

  const threadById = new Map(index.threads.map((thread) => [thread.id, thread]));
  const taskIds = unique(ranked.map((item) => item.record.originThreadId));
  const rootId = projectId(index.cwd);
  const nodes = [{
    id: rootId,
    title: path.basename(index.cwd) || index.cwd,
    summary: `${index.threads.length} local tasks · ${index.records.length} deduplicated records`,
    kind: "project",
    status: "indexed",
    cwd: index.cwd,
    cluster: "Project",
    tags: ["Local index", "Complete project"],
  }];

  for (const threadId of taskIds) {
    const thread = threadById.get(threadId) || {
      id: threadId,
      title: "Untitled task",
      cwd: index.cwd,
    };
    const taskMatches = ranked.filter((item) => item.record.originThreadId === threadId);
    nodes.push({
      id: thread.id,
      title: thread.title,
      summary: `${taskMatches.length} relevant source records`,
      kind: "thread",
      status: "indexed",
      cwd: thread.cwd,
      updatedAt: thread.updatedAt,
      hostId: "local",
      cluster: "Search match",
      matchType: taskMatches[0]?.ranking.matchType === "exact" ? "exact" : "context",
      matchScore: Math.min(1, (taskMatches[0]?.ranking.score || 0) / 160),
      matchReason: taskMatches[0]?.ranking.reasons.join("; ") || "",
      tags: ["Source task", `${taskMatches.length} records`],
    });
  }

  const edges = taskIds.map((threadId) => ({
    id: `membership:${rootId}:${threadId}`,
    source: rootId,
    target: threadId,
    type: "membership",
    layer: "task",
    direction: "directed",
    evidenceType: "exact-cwd",
    evidence: `The task working directory exactly matches the project scope: ${index.cwd}`,
    confidence: 1,
    label: "Belongs to project",
  }));
  edges.push(...sharedPrefixEdges(index, taskIds));

  const memoryByRecord = new Map();
  for (const memory of index.memories || []) {
    const list = memoryByRecord.get(memory.recordId) || [];
    list.push(memory);
    memoryByRecord.set(memory.recordId, list);
  }

  ranked.forEach(({ record, ranking }, rank) => {
    const score = Math.min(1, ranking.score / 160);
    nodes.push({
      id: record.id,
      title: `Original answer: ${clamp(record.prompt, 72)}`,
      summary: clamp(record.answer.replace(/\s+/g, " "), 180),
      content: record.answer,
      kind: "record",
      status: "found",
      cwd: record.cwd,
      updatedAt: record.answerTimestamp,
      cluster: "Source record",
      matchType: ranking.matchType === "exact" ? "exact" : "context",
      matchScore: score,
      matchReason: ranking.reasons.join("; "),
      tags: ["Original answer", `Top ${rank + 1}`],
      source: {
        threadId: record.originThreadId,
        turnId: record.turnId,
        threadTitle: record.originThreadTitle,
        role: "assistant",
        timestamp: record.answerTimestamp,
        prompt: record.prompt,
        excerpt: clamp(record.answer, 320),
        contentHash: record.contentHash,
        duplicateCount: record.duplicateCount,
        cwd: record.cwd,
        line: record.answerLine,
        copies: record.copies,
      },
    });
    edges.push({
      id: `contains:${record.originThreadId}:${record.id}`,
      source: record.originThreadId,
      target: record.id,
      type: "contains",
      layer: "content",
      direction: "directed",
      evidenceType: "turn-id",
      evidence: `Turn ${record.turnId}`,
      confidence: 1,
    });
    for (const memory of memoryByRecord.get(record.id) || []) {
      nodes.push({
        ...memory,
        kind: "memory",
        status: memory.memoryStatus,
        cwd: record.cwd,
        updatedAt: record.answerTimestamp,
        cluster: "Memory candidate",
        matchType: "context",
        matchScore: memory.confidence,
        matchReason: "Extracted from an explicit conclusion marker in the original answer; not yet confirmed by the user",
        tags: ["Memory candidate", "Needs review"],
      });
      edges.push({
        id: `derived:${record.id}:${memory.id}`,
        source: record.id,
        target: memory.id,
        type: "derived",
        layer: "content",
        direction: "directed",
        evidenceType: "explicit-statement",
        evidence: memory.content,
        confidence: memory.confidence,
        label: "Extract memory candidate",
      });
    }
  });

  return {
    graph: {
      version: 1,
      title: `${path.basename(index.cwd)} · MemoryGraph`,
      query: searchQuery,
      scope: index.cwd,
      mode: "search",
      generatedAt: new Date().toISOString(),
      rootProjectId: rootId,
      retrieval: {
        strategy: "local-exact-turn-index",
        scannedTasks: index.threads.length,
        candidateTasks: taskIds.length,
        scannedRecords: index.records.length,
        deduplicatedRecords: index.records.length,
        exactMatches: ranked.filter((item) => item.ranking.matchType === "exact").length,
        semanticMatches: 0,
        indexMode: indexStats.mode || "cached",
        changedFiles: indexStats.parsedFiles || 0,
        reusedFiles: indexStats.reusedFiles || 0,
        memoryCandidates: nodes.filter((node) => node.kind === "memory").length,
      },
      nodes,
      edges,
    },
    results: ranked.map(({ record, ranking }, rank) => ({
      rank: rank + 1,
      canonicalId: record.canonicalId,
      threadId: record.originThreadId,
      threadTitle: record.originThreadTitle,
      turnId: record.turnId,
      prompt: record.prompt,
      answer: record.answer,
      timestamp: record.answerTimestamp,
      contentHash: record.contentHash,
      duplicateCount: record.duplicateCount,
      copiedToThreads: record.copies,
      matchType: ranking.matchType,
      score: ranking.score,
      reasons: ranking.reasons,
    })),
  };
}

export function loadOrRefreshMemoryIndex(options = {}) {
  return refreshMemoryIndex(options);
}
