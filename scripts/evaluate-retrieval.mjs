import { readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { refreshMemoryIndex, searchMemoryIndex } from "../mcp/memory-index.mjs";
import { loadProductState } from "../mcp/product-state.mjs";
import { makeFixture } from "./fixtures/retrieval.mjs";

const [input, output] = process.argv.slice(2);
if (!input) throw new Error("Usage: node scripts/evaluate-retrieval.mjs --synthetic|cases.json [report.json]");
const fixture = input === "--synthetic" ? makeFixture() : null;
try {
  // Expected answers are declared independently of the search output.
  const cases = fixture ? [
    ...Array.from({ length: 25 }, (_, i) => ({ id: `prompt-${i}`, query: `common request ${i}`, expectedTurnIds: [`turn-${i}`] })),
    ...Array.from({ length: 10 }, (_, i) => ({ id: `answer-${i}`, query: `common result ${i}`, expectedTurnIds: [`turn-${i}`] })),
    { id: "alias-zh", query: "退信", expectedTurnIds: ["alias"] },
    { id: "alias-en", query: "bounces", expectedTurnIds: ["alias"] },
    { id: "archive", query: "archived-only", expectedTurnIds: ["archived"] },
    { id: "archive-filter", query: "archived-only", includeArchived: false, expectedTurnIds: [] },
    { id: "long-tail", query: "TAIL_UNIQUE_FULLTEXT", expectedTurnIds: ["long"] },
    ...Array.from({ length: 8 }, (_, i) => ({ id: `negative-${i}`, query: `absent_marker_${i}_94857`, expectedTurnIds: [] })),
  ].map((item) => ({ ...item, cwd: fixture.cwd })) : JSON.parse(readFileSync(input, "utf8"));
  if (!Array.isArray(cases) || !cases.length) throw new Error("Expected a non-empty array of labelled cases");
  const indexes = new Map();
  const results = [];
  for (const item of cases) {
    if (!item.id || !item.cwd || typeof item.query !== "string" || !Array.isArray(item.expectedTurnIds)) throw new Error("Each case needs id, cwd, query, expectedTurnIds");
    if (!indexes.has(item.cwd)) indexes.set(item.cwd, refreshMemoryIndex(fixture?.options || { cwd: item.cwd }).index);
    const started = performance.now();
    const found = searchMemoryIndex(indexes.get(item.cwd), { ...item, limit: 5,
      productState: loadProductState(fixture?.statePath) }).results;
    const firstRelevant = found.findIndex((result) => item.expectedTurnIds.includes(result.turnId));
    results.push({ id: item.id, hasAnswer: item.expectedTurnIds.length > 0,
      passed: item.expectedTurnIds.length ? firstRelevant >= 0 : found.length === 0,
      rank: firstRelevant >= 0 ? firstRelevant + 1 : null,
      elapsedMs: Math.round((performance.now() - started) * 100) / 100 });
  }
  const positives = results.filter((item) => item.hasAnswer);
  const negatives = results.filter((item) => !item.hasAnswer);
  const times = results.map((item) => item.elapsedMs).sort((a, b) => a - b);
  const report = { kind: fixture ? "synthetic-regression-only" : "user-labelled-local-evaluation",
    note: "Synthetic results do not establish real-user accuracy or an advantage over native search. Timing excludes indexing and UI.",
    generatedAt: new Date().toISOString(), caseCount: results.length,
    top5: { passed: positives.filter((item) => item.passed).length, total: positives.length },
    noAnswer: { passed: negatives.filter((item) => item.passed).length, total: negatives.length },
    warmSearchP95Ms: times[Math.min(times.length - 1, Math.ceil(times.length * 0.95) - 1)], results };
  if (output) writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ kind: report.kind, caseCount: report.caseCount, top5: report.top5,
    noAnswer: report.noAnswer, warmSearchP95Ms: report.warmSearchP95Ms,
    failedCases: results.filter((item) => !item.passed).map((item) => item.id) }, null, 2));
} finally { fixture?.cleanup(); }
