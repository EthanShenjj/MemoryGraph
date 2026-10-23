import assert from "node:assert/strict";
import path from "node:path";
import { appendFileSync, writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { refreshMemoryIndex, searchMemoryIndex, readMemoryRecord } from "../mcp/memory-index.mjs";
import { normalizeGraph } from "../mcp/graph.mjs";
import { loadProductState, recordRetrievalFeedback, reviewMemoryCandidate, applyProductState } from "../mcp/product-state.mjs";
import { makeFixture } from "./fixtures/retrieval.mjs";

const fixture = makeFixture();
try {
  const { index } = refreshMemoryIndex(fixture.options);
  const state = () => loadProductState(fixture.statePath);
  const search = (query, options = {}) => searchMemoryIndex(index, { query, productState: state(), ...options });
  assert.equal(index.coverage.partial, true);
  assert.equal(index.coverage.unsupportedFiles, 1);
  assert(!index.records.some((record) => record.answer.includes("WRONG_PROJECT")), "Exact cwd must not normalize distinct paths together");
  const long = search("TAIL_UNIQUE_FULLTEXT");
  assert.equal(long.results.length, 1);
  assert.equal(long.results[0].truncated, true);
  let offset = 0;
  let text = "";
  do {
    const chunk = readMemoryRecord(index, { recordId: long.results[0].id, offset, length: 20000, contentHash: long.results[0].contentHash });
    assert.equal(chunk.verification, "verified");
    assert.equal(chunk.prompt, "  Ｆｕｌｌｗｉｄｔｈ 原始问题  ");
    text += chunk.text;
    offset = chunk.nextOffset;
  } while (offset !== null);
  assert.equal(text, fixture.longAnswer, "Full original whitespace and fullwidth text must survive");
  const normalized = normalizeGraph(long.graph);
  assert.equal(normalized.nodes.find((node) => node.kind === "thread").title, fixture.title);
  assert(normalized.nodes.find((node) => node.kind === "record").contentTruncated);
  assert.equal(search("Fullwidth").results[0].matchType, "lexical", "Normalized text is not a literal source match");
  const alias = search("退信");
  assert.equal(alias.results[0].turnId, "alias");
  assert.equal(alias.results[0].matchType, "lexical");
  assert.equal(normalizeGraph(alias.graph).nodes.find((node) => node.kind === "record").matchType, "lexical");
  assert.equal(search("archived-only").results.length, 1);
  assert.equal(search("archived-only", { includeArchived: false }).results.length, 0);
  assert.equal(search("common", { before: "2026-10-23T00:00:00Z" }).results.length, 0);
  assert.throws(() => search("common", { after: "nonsense" }), /date range/);
  assert.throws(() => search("x".repeat(1001)), /1000/);
  assert.equal(search("absent_needle_983475").page.total, 0);

  const first = search("common", { limit: 10 });
  assert(first.page.total > 20);
  let cursor = "";
  const ids = [];
  do {
    const result = search("common", { limit: 10, cursor });
    assert.deepEqual(result.results.map((item) => item.id), result.graph.nodes.filter((node) => node.kind === "record").map((node) => node.id));
    ids.push(...result.results.map((item) => item.id));
    cursor = result.page.nextCursor;
  } while (cursor);
  assert.equal(new Set(ids).size, first.page.total);
  assert.equal(search("common request 0").results.filter((item) => item.turnId === "turn-0").length, 2, "Conflicting versions must remain separate");
  assert(!first.graph.edges.some((edge) => edge.type === "shared-prefix" && [edge.source, edge.target].includes("reordered")), "Turn intersections are not ordered prefixes");

  const rejected = first.results[0];
  recordRetrievalFeedback({ cwd: fixture.cwd, query: "common", recordId: rejected.id, verdict: "incorrect" }, { filePath: fixture.statePath });
  const afterFeedback = search("common", { limit: 10 });
  assert.equal(afterFeedback.results.length, 10, "Reject before Top K to fill the page");
  assert(!afterFeedback.results.some((item) => item.id === rejected.id));
  assert(search("common request", { includeExcluded: true }).results.some((item) => item.id === rejected.id), "Feedback must be query scoped");
  assert.throws(() => search("common", { limit: 10, cursor: first.page.nextCursor }), /cursor expired/);
  assert(search("common", { includeExcluded: true, limit: 20 }).page.total > afterFeedback.page.total);
  recordRetrievalFeedback({ cwd: fixture.cwd, query: "common", recordId: rejected.id, verdict: "cleared" }, { filePath: fixture.statePath });
  assert.equal(search("common").page.total, first.page.total);

  const memories = index.memories;
  const review = (input) => reviewMemoryCandidate({ cwd: fixture.cwd, ...input }, { filePath: fixture.statePath });
  const confirmed = review({ memoryId: memories[0].id, status: "confirmed", expectedRevision: 0 });
  assert.equal(confirmed.revision, 1);
  assert.throws(() => review({ memoryId: memories[0].id, status: "rejected", expectedRevision: 0 }), /another window/);
  review({ memoryId: memories[1].id, status: "confirmed" });
  review({ memoryId: memories[0].id, status: "corrected", content: "Corrected decision", expectedRevision: 1 });
  const graph = search("choose protocol").graph;
  applyProductState(graph, { filePath: fixture.statePath });
  assert.equal(graph.nodes.find((node) => node.id === memories[0].id).content, "Corrected decision");
  review({ memoryId: memories[0].id, status: "superseded", supersededBy: memories[1].id });
  assert.equal(state().reviewHistory.length, 4);
  assert.throws(() => review({ memoryId: memories[1].id, status: "superseded", supersededBy: memories[1].id }), /cycle/);

  const originalSource = readFileSync(fixture.sourcePath, "utf8");
  writeFileSync(fixture.sourcePath, originalSource.replace("TAIL_UNIQUE_FULLTEXT", "ALTERED_FULLTEXT"));
  assert.throws(() => readMemoryRecord(index, { recordId: long.results[0].id }), /changed/);
  writeFileSync(fixture.sourcePath, originalSource);
  appendFileSync(fixture.sourcePath, "invalid line\n");
  const refreshed = refreshMemoryIndex(fixture.options);
  assert(refreshed.index.coverage.malformedLines > 0);
  assert.equal(state().memoryReviews[memories[0].id].status, "superseded", "Index rebuilding must preserve review state");
  writeFileSync(path.join(fixture.options.archivedRoot, "moved.jsonl"), originalSource.replace('"id":"source"', '"id":"z-moved-source"'));
  unlinkSync(fixture.sourcePath);
  assert.throws(() => readMemoryRecord(index, { recordId: long.results[0].id }));
  const moved = refreshMemoryIndex({ ...fixture.options, force: true });
  const movedSearch = searchMemoryIndex(moved.index, { query: "choose protocol", productState: state() });
  assert(movedSearch.graph.nodes.some((node) => node.id === memories[0].id), "A surviving copy must retain the reviewed identity");
  assert.equal(readMemoryRecord(moved.index, { recordId: long.results[0].id }).verification, "verified");
  writeFileSync(fixture.statePath, "corrupt-state");
  assert.throws(() => review({ memoryId: "new", status: "confirmed" }), /not overwritten/);
  assert.equal(readFileSync(fixture.statePath, "utf8"), "corrupt-state");
  console.log("MemoryGraph retrieval regression probe passed");
} finally {
  fixture.cleanup();
}
