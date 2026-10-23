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
import { loadProductState } from "./product-state.mjs";

const INDEX_VERSION = 3;
const MAX_RECORD_CONTENT = 20000;
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

function listJsonlFiles(root, coverage) {
  if (!existsSync(root)) return [];
  const result = [];
  const queue = [root];
  while (queue.length) {
    const current = queue.shift();
    let entries;
    try { entries = readdirSync(current, { withFileTypes: true }); }
    catch { coverage.failedFiles += 1; continue; }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) queue.push(fullPath);
      else if (entry.isFile() && entry.name.endsWith(".jsonl")) result.push(fullPath);
      else if (entry.isFile() && /\.jsonl\./.test(entry.name)) coverage.unsupportedFiles += 1;
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
    .join("\n");
}

function cleanUserPrompt(value) {
  let text = String(value ?? "");
  if (!/<(?:in-app-browser-context|environment_context)|## My request for Codex:/i.test(text)) return text;
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
  let malformedLines = 0;

  for (let lineNumber = 0; lineNumber < lines.length; lineNumber += 1) {
    const line = lines[lineNumber];
    if (!line) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      malformedLines += 1;
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
    cwd: String(meta?.cwd || "").trim(),
    createdAt: meta?.timestamp || null,
    source: normalize(meta?.source),
    originator: normalize(meta?.originator),
    turns: [...turns.values()],
    malformedLines,
  };
}

function loadTitles(indexPath) {
  const titles = new Map();
  if (!existsSync(indexPath)) return titles;
  for (const line of readFileSync(indexPath, "utf8").split("\n")) {
    if (!line) continue;
    try {
      const item = JSON.parse(line);
      if (item?.id) titles.set(String(item.id), String(item.thread_name || ""));
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
      title: titles.get(session.threadId) || "未命名任务",
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
        threadTitle: titles.get(session.threadId) || "未命名任务",
        cwd: session.cwd,
        archived: Boolean(entry.archived),
        sourceRef: entry.sourceRef,
        sessionCreatedAt: session.createdAt,
        prompt: cleanUserPrompt(user.text),
        answer: assistant.text,
        promptTimestamp: user.timestamp,
        answerTimestamp: assistant.timestamp,
        promptLine: user.line,
        answerLine: assistant.line,
      };
      const versionKey = `${turn.turnId}:${hash(occurrence.prompt + "\u0000" + occurrence.answer)}`;
      const occurrences = occurrencesByTurn.get(versionKey) || [];
      occurrences.push(occurrence);
      occurrencesByTurn.set(versionKey, occurrences);
      thread.updatedAt = assistant.timestamp || user.timestamp || thread.updatedAt;
    }
    thread.turnCount = turnIds.size;
    threadTurns.set(session.threadId, turnIds);
    threads.set(session.threadId, thread);
  }

  const records = [];
  const turnVersions = new Map();
  for (const occurrences of occurrencesByTurn.values()) {
    const turnId = occurrences[0].turnId;
    turnVersions.set(turnId, (turnVersions.get(turnId) || 0) + 1);
  }
  for (const rawOccurrences of occurrencesByTurn.values()) {
    const turnId = rawOccurrences[0].turnId;
    const occurrences = rawOccurrences
      .filter((item) => item.prompt && item.answer)
      .sort((a, b) =>
        String(a.promptTimestamp || "").localeCompare(String(b.promptTimestamp || "")) ||
        String(a.sessionCreatedAt || "").localeCompare(String(b.sessionCreatedAt || "")) ||
        String(a.threadId).localeCompare(String(b.threadId)));
    if (!occurrences.length) continue;
    const origin = occurrences[0];
    const copies = unique(occurrences.map((item) => item.threadId));
    const answer = origin.answer;
    const prompt = origin.prompt;
    const conflict = turnVersions.get(turnId) > 1;
    const suffix = conflict ? `:${hash(prompt + "\u0000" + answer).slice(0, 12)}` : "";
    records.push({
      id: `record:${origin.threadId}:${turnId}:assistant${suffix}`,
      canonicalId: `${origin.threadId}:${turnId}:assistant${suffix}`,
      turnId,
      originThreadId: origin.threadId,
      originThreadTitle: origin.threadTitle,
      cwd: origin.cwd,
      archived: occurrences.every((item) => item.archived),
      conflict,
      sourceRef: origin.sourceRef,
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
      id: record.memoryId || `memory:${record.originThreadId}:${record.turnId}:decision${record.conflict ? `:${record.contentHash.slice(0, 12)}` : ""}`,
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
  archivedRoot = process.env.CODEX_ARCHIVED_SESSIONS_DIR || path.join(path.dirname(sessionsRoot), "archived_sessions"),
  titleIndexPath = process.env.CODEX_SESSION_INDEX ||
    path.join(os.homedir(), ".codex", "session_index.jsonl"),
  indexDir = process.env.MEMORYGRAPH_INDEX_DIR ||
    process.env.THREAD_ATLAS_INDEX_DIR ||
    DEFAULT_INDEX_DIR,
} = {}) {
  const exactCwd = String(cwd || "").trim();
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

  const coverage = { roots: [sessionsRoot, archivedRoot], failedFiles: 0,
    unsupportedFiles: 0, malformedLines: 0, scannedFiles: 0, indexedFiles: 0 };
  const candidates = unique(coverage.roots.flatMap((root) => listJsonlFiles(root, coverage)));
  for (const filePath of candidates) {
    coverage.scannedFiles += 1;
    try {
      const fileStat = statSync(filePath);
      const archived = filePath.startsWith(path.resolve(archivedRoot) + path.sep);
      const cached = previousFiles[filePath];
      const scanned = previousScanCache[filePath];
      if (!force && cached && cached.mtimeMs === fileStat.mtimeMs && cached.size === fileStat.size) {
        files[filePath] = { ...cached, archived, sourceRef: filePath };
        coverage.malformedLines += cached.session.malformedLines || 0;
        scanCache[filePath] = { mtimeMs: fileStat.mtimeMs, size: fileStat.size, inScope: true };
        reusedFiles += 1;
        continue;
      }
      if (!force && scanned && scanned.mtimeMs === fileStat.mtimeMs &&
          scanned.size === fileStat.size && scanned.inScope === false) {
        scanCache[filePath] = scanned;
        skippedFiles += 1;
        continue;
      }
      const first = firstJsonLine(filePath);
      if (first?.type !== "session_meta") {
        coverage.failedFiles += 1;
        continue;
      }
      if (String(first.payload?.cwd || "").trim() !== exactCwd) {
        scanCache[filePath] = { mtimeMs: fileStat.mtimeMs, size: fileStat.size, inScope: false };
        skippedFiles += 1;
        continue;
      }
      const session = parseSessionFile(filePath);
      if (session.cwd !== exactCwd) continue;
      coverage.malformedLines += session.malformedLines;
      files[filePath] = { mtimeMs: fileStat.mtimeMs, size: fileStat.size, session, archived, sourceRef: filePath };
      scanCache[filePath] = { mtimeMs: fileStat.mtimeMs, size: fileStat.size, inScope: true };
      parsedFiles += 1;
    } catch {
      coverage.failedFiles += 1;
    }
  }
  coverage.indexedFiles = Object.keys(files).length;
  coverage.missingRoots = coverage.roots.filter((root) => !existsSync(root));
  coverage.partial = Boolean(coverage.failedFiles || coverage.unsupportedFiles || coverage.malformedLines || coverage.missingRoots.length === coverage.roots.length);
  coverage.refreshedAt = new Date().toISOString();

  let titles;
  try { titles = loadTitles(titleIndexPath); }
  catch { titles = new Map(); coverage.failedFiles += 1; coverage.partial = true; }
  const canonical = buildCanonicalRecords(files, titles);
  // Keep reviewed record identities when the earliest known copy moves or disappears.
  // A forced parse must not discard this identity mapping.
  const identityIndex = previous || safeLoadIndex(targetPath, exactCwd);
  const priorRecords = new Map((identityIndex?.records || []).map((record) =>
    [`${record.turnId}:${record.contentHash}:${hash(record.prompt)}`, record]));
  const priorMemories = new Map((identityIndex?.memories || []).map((memory) => [memory.recordId, memory.id]));
  const priorTurnIds = new Set((identityIndex?.records || []).map((record) => record.turnId));
  for (const record of canonical.records) {
    const prior = priorRecords.get(`${record.turnId}:${record.contentHash}:${hash(record.prompt)}`);
    if (!prior) {
      if (priorTurnIds.has(record.turnId)) {
        record.id = `record:${record.originThreadId}:${record.turnId}:assistant:${hash(record.prompt + "\u0000" + record.answer).slice(0, 12)}`;
        record.canonicalId = record.id.replace(/^record:/, "");
        record.memoryId = `memory:${record.originThreadId}:${record.turnId}:decision:${record.contentHash.slice(0, 12)}`;
        record.conflict = true;
      }
      continue;
    }
    record.id = prior.id;
    record.canonicalId = prior.canonicalId;
    record.memoryId = priorMemories.get(prior.id);
  }
  const memories = extractMemories(canonical.records);
  const index = {
    version: INDEX_VERSION,
    cwd: exactCwd,
    generatedAt: new Date().toISOString(),
    sessionsRoot,
    coverage,
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
      coverage,
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

const QUERY_ALIASES = [
  ["退信", "bounce", "bounces"], ["退订", "unsubscribe", "unsubscription"],
  ["回调", "callback", "webhook"], ["限流", "rate limit", "rate limiting"],
  ["鉴权", "认证", "authentication", "auth"], ["索引", "indexing", "index"],
];

function expandedTokens(query) {
  const normalized = normalizedSearch(query);
  return unique(QUERY_ALIASES.filter((group) => group.some((word) => normalized.includes(word)))
    .flat().filter((word) => word !== normalized));
}

function scoreRecord(record, query) {
  const phrase = normalizedSearch(query);
  const prompt = normalizedSearch(record.prompt);
  const answer = normalizedSearch(record.answer);
  const title = normalizedSearch(record.originThreadTitle);
  const tokens = queryTokens(query);
  const reasons = [];
  const literalQuery = String(query).toLocaleLowerCase();
  const literalMatch = [record.prompt, record.answer, record.originThreadTitle]
    .some((value) => String(value || "").toLocaleLowerCase().includes(literalQuery));
  let score = 0;
  if (phrase && prompt.includes(phrase)) {
    score += 100;
    reasons.push(String(record.prompt).toLocaleLowerCase().includes(literalQuery) ? "原始用户提问包含完整查询" : "用户提问规范化后匹配完整查询");
  }
  if (phrase && answer.includes(phrase)) {
    score += 70;
    reasons.push(String(record.answer).toLocaleLowerCase().includes(literalQuery) ? "原始助手回答包含完整查询" : "助手回答规范化后匹配完整查询");
  }
  if (phrase && title.includes(phrase)) {
    score += 45;
    reasons.push(String(record.originThreadTitle).toLocaleLowerCase().includes(literalQuery) ? "任务标题包含完整查询" : "任务标题规范化后匹配完整查询");
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
  if (promptHits) reasons.push(`用户提问匹配 ${promptHits}/${tokens.length || 1} 个查询词`);
  if (answerHits) reasons.push(`助手回答匹配 ${answerHits}/${tokens.length || 1} 个查询词`);
  if (titleHits) reasons.push(`任务标题匹配 ${titleHits}/${tokens.length || 1} 个查询词`);
  const expansions = expandedTokens(query).filter((word) =>
    prompt.includes(word) || answer.includes(word) || title.includes(word));
  score += expansions.length * 4;
  if (expansions.length) reasons.push(`扩展词匹配：${expansions.join(", ")}`);
  return {
    score,
    matchType: phrase && literalMatch
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
      const aOrder = [...aTurns];
      const bOrder = [...bTurns];
      const signatures = (threadId) => new Map(Object.values(index.files || {}).flatMap((entry) =>
        entry.session?.threadId === threadId ? entry.session.turns.map((turn) =>
          [turn.turnId, hash(JSON.stringify(turn.messages.map(({ role, text }) => ({ role, text }))))]) : []));
      const aSignatures = signatures(a);
      const bSignatures = signatures(b);
      const shared = [];
      for (let i = 0; i < Math.min(aOrder.length, bOrder.length); i += 1) {
        if (aOrder[i] !== bOrder[i] || aSignatures.get(aOrder[i]) !== bSignatures.get(bOrder[i])) break;
        shared.push(aOrder[i]);
      }
      if (shared.length < 3) continue;
      edges.push({
        id: `shared-prefix:${a}:${b}`,
        source: a,
        target: b,
        type: "shared-prefix",
        layer: "task",
        direction: "symmetric",
        evidenceType: "ordered-turn-content-prefix",
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
  cursor = "",
  after = "",
  before = "",
  includeArchived = true,
  includeExcluded = false,
  productState = loadProductState(),
  indexStats = {},
} = {}) {
  const searchQuery = String(query ?? "").trim();
  if (searchQuery.length > 1000) throw new Error("Query must be at most 1000 characters");
  const dates = [after, before].map((value) => value ? Date.parse(value) : null);
  if (dates.some((value) => value !== null && !Number.isFinite(value)) ||
      (dates[0] !== null && dates[1] !== null && dates[0] >= dates[1])) {
    throw new Error("Invalid date range");
  }
  const cappedLimit = Math.max(1, Math.min(20, Math.floor(Number(limit) || 8)));
  const feedback = new Map((productState.feedback || []).filter((entry) =>
    entry.cwd === index.cwd && entry.query.toLocaleLowerCase() === searchQuery.toLocaleLowerCase())
    .map((entry) => [entry.recordId, entry]));
  const allRanked = index.records.filter((record) => {
    const timestamp = Date.parse(record.answerTimestamp);
    return (includeArchived || !record.archived) &&
      (dates[0] === null || timestamp >= dates[0]) && (dates[1] === null || timestamp < dates[1]);
  }).map((record) => {
    const ranking = searchQuery ? scoreRecord(record, searchQuery) : { score: 1, matchType: "context", reasons: ["最近记录"] };
    return { record, ranking, feedback: feedback.get(record.id) };
  }).filter((item) => item.ranking.score > 0 && (includeExcluded || item.feedback?.verdict !== "incorrect"));
  const taskHitCounts = new Map();
  for (const { record } of allRanked) taskHitCounts.set(record.originThreadId, (taskHitCounts.get(record.originThreadId) || 0) + 1);
  for (const item of allRanked) {
    item.ranking.score += searchQuery ? Math.min(30, Math.max(0, (taskHitCounts.get(item.record.originThreadId) || 1) - 1) * 10) : 0;
  }
  allRanked.sort((a, b) =>
    Number(b.feedback?.verdict === "correct") - Number(a.feedback?.verdict === "correct") ||
    Number(a.feedback?.verdict === "incorrect") - Number(b.feedback?.verdict === "incorrect") ||
    Number(b.ranking.matchType === "exact") - Number(a.ranking.matchType === "exact") ||
    b.ranking.score - a.ranking.score ||
    String(b.record.answerTimestamp || "").localeCompare(String(a.record.answerTimestamp || "")) ||
    a.record.id.localeCompare(b.record.id));
  const signature = hash(JSON.stringify({ cwd: index.cwd, searchQuery, after, before, includeArchived,
    includeExcluded, limit: cappedLimit, records: allRanked.map((item) =>
      [item.record.id, item.record.contentHash, item.record.originThreadTitle, item.feedback?.verdict]) }));
  let offset = 0;
  if (cursor) {
    try {
      const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
      if (value.signature !== signature || !Number.isSafeInteger(value.offset) || value.offset < 0 || value.offset >= allRanked.length) throw new Error();
      offset = value.offset;
    } catch { throw new Error("Search changed or cursor expired; search again"); }
  }
  const ranked = allRanked.slice(offset, offset + cappedLimit);
  const page = { total: allRanked.length, offset, limit: cappedLimit,
    nextCursor: offset + cappedLimit < allRanked.length
      ? Buffer.from(JSON.stringify({ signature, offset: offset + cappedLimit })).toString("base64url") : null };
  const coverage = index.coverage || { partial: false };

  const threadById = new Map(index.threads.map((thread) => [thread.id, thread]));
  const taskIds = unique(ranked.map((item) => item.record.originThreadId));
  const rootId = projectId(index.cwd);
  const nodes = [{
    id: rootId,
    title: path.basename(index.cwd) || index.cwd,
    summary: `${index.threads.length} 个本地任务 · ${index.records.length} 条去重记录`,
    kind: "project",
    status: "indexed",
    cwd: index.cwd,
    cluster: "项目",
    tags: ["本地索引", coverage.partial ? "部分覆盖" : "支持的本地来源"],
  }];

  for (const threadId of taskIds) {
    const thread = threadById.get(threadId) || {
      id: threadId,
      title: "未命名任务",
      cwd: index.cwd,
    };
    const taskMatches = ranked.filter((item) => item.record.originThreadId === threadId);
    nodes.push({
      id: thread.id,
      title: thread.title,
      summary: `${taskMatches.length} 条相关来源记录`,
      kind: "thread",
      status: "indexed",
      cwd: thread.cwd,
      updatedAt: thread.updatedAt,
      hostId: "local",
      cluster: "搜索匹配",
      matchType: taskMatches[0]?.ranking.matchType === "exact" ? "exact" : "context",
      matchScore: Math.min(1, (taskMatches[0]?.ranking.score || 0) / 160),
      matchReason: taskMatches[0]?.ranking.reasons.join("; ") || "",
      tags: ["来源任务", `${taskMatches.length} 条记录`],
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
    evidence: `任务工作目录与项目范围完全一致：${index.cwd}`,
    confidence: 1,
    label: "属于项目",
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
      title: `原始回答：${clamp(record.prompt, 72)}`,
      summary: clamp(record.answer.replace(/\s+/g, " "), 180),
      content: record.answer.slice(0, MAX_RECORD_CONTENT),
      contentLength: record.answer.length,
      contentTruncated: record.answer.length > MAX_RECORD_CONTENT,
      rank: offset + rank + 1,
      userFeedback: feedback.get(record.id)?.verdict || "",
      retrievalScoreApplied: true,
      kind: "record",
      status: "found",
      cwd: record.cwd,
      updatedAt: record.answerTimestamp,
      cluster: "来源记录",
      matchType: ranking.matchType,
      matchScore: score,
      matchReason: ranking.reasons.join("; "),
      tags: ["原始回答", `前 ${rank + 1}`],
      source: {
        threadId: record.originThreadId,
        turnId: record.turnId,
        threadTitle: record.originThreadTitle,
        role: "assistant",
        timestamp: record.answerTimestamp,
        prompt: record.prompt,
        excerpt: record.answer.slice(0, 320),
        sourceRef: record.sourceRef,
        archived: record.archived,
        conflict: record.conflict,
        verification: "indexed",
        originLabel: "earliest-known",
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
      evidence: `轮次 ${record.turnId}`,
      confidence: 1,
    });
    for (const memory of memoryByRecord.get(record.id) || []) {
      nodes.push({
        ...memory,
        kind: "memory",
        status: memory.memoryStatus,
        cwd: record.cwd,
        updatedAt: record.answerTimestamp,
        cluster: "记忆候选",
        matchType: "context",
        matchScore: memory.confidence,
        matchReason: "从原始回答中的明确结论标记提取，尚未由用户确认",
        tags: ["记忆候选", "待审核"],
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
        label: "提取记忆候选",
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
      page,
      coverage,
      searchOptions: { after, before, includeArchived, includeExcluded },
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
    page,
    coverage,
    results: ranked.map(({ record, ranking }, rank) => ({
      rank: offset + rank + 1,
      id: record.id,
      userFeedback: feedback.get(record.id)?.verdict || "",
      canonicalId: record.canonicalId,
      threadId: record.originThreadId,
      threadTitle: record.originThreadTitle,
      turnId: record.turnId,
      prompt: record.prompt,
      answer: record.answer.slice(0, MAX_RECORD_CONTENT),
      answerLength: record.answer.length,
      truncated: record.answer.length > MAX_RECORD_CONTENT,
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

export function readMemoryRecord(index, { recordId, contentHash, offset = 0, length = 12000, context = 0 } = {}) {
  const record = index.records.find((item) => item.id === recordId);
  if (!record) throw new Error("Source record is unavailable; refresh the search");
  const session = parseSessionFile(record.sourceRef);
  if (session.cwd !== index.cwd) throw new Error("Source project changed");
  const turn = session.turns.find((item) => item.turnId === record.turnId &&
    hash(chooseMessage(item.messages, "assistant")?.text || "") === record.contentHash);
  if (!turn || (contentHash && record.contentHash !== contentHash)) throw new Error("Source content changed; search again");
  const answer = chooseMessage(turn.messages, "assistant").text;
  const start = Number(offset);
  const size = Number(length);
  if (!Number.isSafeInteger(start) || start < 0 || start > answer.length ||
      !Number.isSafeInteger(size) || size < 1 || size > 20000) throw new Error("Invalid record page");
  const position = session.turns.indexOf(turn);
  const radius = Math.max(0, Math.min(2, Math.floor(Number(context) || 0)));
  return { recordId, threadId: record.originThreadId, turnId: record.turnId,
    contentHash: record.contentHash, verification: "verified", prompt: record.prompt,
    text: answer.slice(start, start + size), offset: start, totalLength: answer.length,
    nextOffset: start + size < answer.length ? start + size : null,
    context: radius ? session.turns.slice(Math.max(0, position - radius), position + radius + 1).map((item) => ({
      turnId: item.turnId, timestamp: chooseMessage(item.messages, "assistant")?.timestamp || null,
      prompt: cleanUserPrompt(chooseMessage(item.messages, "user")?.text || ""),
      answer: (chooseMessage(item.messages, "assistant")?.text || "").slice(0, 20000),
      truncated: (chooseMessage(item.messages, "assistant")?.text.length || 0) > 20000,
    })) : [] };
}

export function loadOrRefreshMemoryIndex(options = {}) {
  return refreshMemoryIndex(options);
}
