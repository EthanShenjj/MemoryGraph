# MemoryGraph

MemoryGraph is a local-first, project-scoped recall layer for Codex. It recovers exact answers scattered across tasks and branches, preserves their task/Turn evidence, separates task structure from content similarity, and derives reviewable memory objects from original records.

The installable plugin ID and product name are both `memorygraph` / MemoryGraph.

## Product Shape

- The root node is the Codex project.
- Every main node is a Codex task.
- Every task node keeps the exact Codex task title; topic explanations belong in the summary.
- Every task card shows how many task-internal messages match the current retrieval.
- The selected task card uses a blue focus treatment and an explicit “已选中” label.
- The interface uses a quiet editorial workspace style: flat white regions, restrained blue/amber states, compact typography, and low-noise shadows.
- The right inspector separates source-backed “原始记录”, derived “候选记忆”, and technical “日志” metadata into three focused tabs.
- Selecting the project root aggregates all project records and memories in those tabs; selecting a task narrows them to that task.
- Record and memory tabs remain selectable at zero results and explain the empty state instead of appearing broken or disabled.
- The right inspector uses a reading-first type scale and a draggable desktop divider; its width is keyboard-adjustable, resettable, and remembered locally.
- Project and task nodes can be dragged to adjust the current canvas layout; connected edges redraw live.
- The primary search result opens its owning task and shows the original record in the detail panel.
- Search mode opens a ranked original-record list first; the DAG remains one click away as the relationship explanation layer.
- Every result exposes the matched source location and highlighted literal evidence when available.
- “找对了 / 不是这条” feedback is stored locally and becomes a bounded ranking signal for the same project and query.
- Record details safely render the complete original answer as Markdown and show the preceding user prompt.
- Copying a record still copies the untouched source Markdown; raw HTML and scripts are never executed.
- Every record keeps a source task ID and Turn ID when available.
- “打开来源任务” uses the real source task ID with a local `codex://threads/<id>` deep link.
- “查看这条记录的上下文” sends a structured follow-up that asks Codex to read the source task around the exact Turn ID, with timestamp, prompt, and excerpt fallbacks.
- Repeated log envelopes are merged into one logical record with a visible duplicate count.
- Copied branch history is attributed to the earliest source task and later appearances remain visible as source copies.
- Candidate memories have a type, review status, extraction evidence, confidence, and a `derived` edge back to the original record.
- Candidate memories can be confirmed, rejected, or returned to candidate status without changing their source provenance.
- Project recall actions support “恢复上次进度”, “汇总最近决策”, and “整理未解决问题”.
- “带着这条记录继续” hands an exact source-backed record to Codex with task and Turn anchors.
- Explicit forks use a strong solid task-to-task line.
- Continuations use a dashed blue line.
- Task structure (`membership`, `fork`, `continuation`, `shared-prefix`) is separate from content association (`related`, `contains`, `derived`).
- Content-related tasks use a dotted neutral line with confidence and never imply task flow.
- Independent tasks stay parallel under the project root; similar dates, titles, URLs, or topics never create a directional continuation edge.
- The right detail panel explains dimmed context tasks and every edge style in plain language.
- Decisions, artifacts, and milestones remain task-internal context.
- Synthetic decision IDs are never used to open Codex tasks.

## Architecture

1. `search_memory_graph` receives an exact project `cwd` and literal query.
2. A local index compares session-file size and modification time, reparses changed files only, and reuses unchanged entries.
3. User prompts are paired with final assistant answers by Turn ID.
4. Copied history and transport copies are deduplicated, while provenance and copy counts are preserved.
5. Literal evidence is ranked ahead of answer-only and title-only matches; multiple relevant records in one source task add a bounded density signal.
6. Explicitly marked conclusions become `candidate` memory objects; user confirmation is required before they become durable confirmed memory.
7. The widget auto-selects the strongest source task and exposes the complete Markdown answer, evidence, task ID, Turn ID, and context actions.
8. The completed graph is saved as a standalone local HTML snapshot using its date, time, and title; filename collisions receive an incrementing suffix instead of overwriting history.
9. Local result feedback adjusts repeated-query ranking within safe bounds; it never converts an inferred result into literal evidence.
10. Memory reviews persist separately from source transcripts, so confirmed or rejected state remains reversible and auditable.

The source JSONL files remain authoritative. The index is disposable local derived state and is never uploaded by the plugin. Search results report whether the index used a full build or incremental refresh, including changed and reused file counts.

Retrieval feedback and memory-review state are stored locally in:

```text
~/.codex/memorygraph/product-state.json
```

This file contains verdicts and review status only. It does not modify Codex source tasks or their JSONL transcripts.

After the rename, MemoryGraph writes new state under `~/.codex/memorygraph/`. If that location is
empty, it can read the previous `~/.codex/thread-atlas/` index and product-state files and writes
subsequent updates to the new location. The legacy `THREAD_ATLAS_*` environment variables remain
accepted as compatibility aliases for the preferred `MEMORYGRAPH_*` variables. Existing legacy
files are not deleted.

## Snapshot Storage

Every successful search or manually constructed graph is archived by default:

```text
~/.codex/memorygraph/snapshots/
└── 2026-07-29/
    ├── 2026-07-29_14-05-09_Sample-Project-Webhook-Review.html
    └── 2026-07-29_14-05-09_Sample-Project-Webhook-Review-02.html
```

The filename format is `YYYY-MM-DD_HH-mm-ss_<title>.html`. Reserved path characters are removed while readable Chinese and Latin title text is preserved. When the same timestamp and title occur more than once, the plugin appends `-02`, `-03`, and so on.

Each snapshot embeds the graph data, complete canvas/detail widget, and MemoryGraph mark. It is independent of any distributable synthetic fixtures. Pass `saveSnapshot: false` only for an ephemeral run, or `snapshotTitle` to override the human-readable title.

Directional task-to-task edges require evidence. `fork` needs explicit Codex ancestry metadata, and `continuation` needs an explicit cross-task reference. `related` and `shared-prefix` are symmetric, arrowless relationships between otherwise independent tasks.

Task titles are identifiers for human retrieval as well as display text. The plugin never rewrites or shortens a `thread.title`: users can copy the title from the detail panel and paste it directly into Codex search. Long titles are visually clamped on the canvas but remain complete in the payload, hover text, accessibility label, and detail view.

The local project index is the primary retrieval path. Host-provided task tools are a fallback when the local search tool is unavailable. A capped host task list must be reported as incomplete.

## Memory Shape

```json
{
  "id": "memory:<record-id>:<hash>",
  "kind": "memory",
  "memoryType": "decision",
  "memoryStatus": "candidate",
  "evidenceType": "explicit-statement",
  "confidence": 0.78,
  "content": "The extracted statement",
  "source": {
    "threadId": "real Codex task ID",
    "turnId": "real Turn ID"
  }
}
```

## Record Shape

```json
{
  "id": "record:<threadId>:<turnId>:assistant",
  "kind": "record",
  "title": "原始回答：总结一下这款产品",
  "summary": "What the record contains",
  "content": "The complete original answer",
  "matchType": "exact",
  "matchScore": 1,
  "matchReason": "Why it answers the query",
  "source": {
    "threadId": "real Codex task ID",
    "turnId": "real Turn ID",
    "threadTitle": "Source task title",
    "role": "assistant",
    "timestamp": "original timestamp",
    "prompt": "preceding user message",
    "excerpt": "short source excerpt",
    "contentHash": "optional stable fingerprint",
    "duplicateCount": 3,
    "cwd": "/source/project"
  }
}
```

## Files

- `.codex-plugin/plugin.json`: Codex plugin manifest.
- `skills/memorygraph/SKILL.md`: record-first discovery and graph-building workflow.
- `mcp/server.mjs`: dependency-free MCP server and widget registration.
- `mcp/graph.mjs`: graph normalization, provenance handling, and safety bounds.
- `mcp/memory-index.mjs`: project-scoped incremental index, Turn deduplication, lexical retrieval, and memory extraction.
- `mcp/snapshot.mjs`: standalone HTML snapshot naming, collision avoidance, asset embedding, and atomic writes.
- `mcp/product-state.mjs`: local retrieval feedback, bounded ranking adjustments, and candidate-memory review state.
- `assets/widget.html`: standalone and embedded DAG canvas.
- `assets/memorygraph-mark.png`: transparent MemoryGraph product mark used by the widget and served as an MCP resource.
- `scripts/probe-mcp.mjs`: protocol and source-anchor smoke test.
- `scripts/probe-memory-index.mjs`: local index, branch-copy, relation-layer, memory, and incremental-update regression test.
- `scripts/probe-snapshot.mjs`: date-title filename, collision suffix, and standalone snapshot regression test.
- `scripts/probe-product-state.mjs`: result-feedback replacement, ranking adjustment, memory review, and correction validation.
- `scripts/search-project.mjs`: run a real project-scoped MCP search from the command line and optionally preserve the complete JSON result.

## Verify

```bash
node ./scripts/probe-mcp.mjs
node ./scripts/probe-memory-index.mjs
node ./scripts/probe-snapshot.mjs
node ./scripts/probe-product-state.mjs
python3 ~/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py .
```

To test a real project without installing the plugin UI:

```bash
node ./scripts/search-project.mjs /absolute/project/path "literal query" ./result.json
```

Real-project indexes, search results, and HTML snapshots contain source conversations and are
private local artifacts. Keep them outside the plugin package and never commit `test-runs/`.

## Privacy and Packaging

- Package the plugin source only; never include generated indexes, search results, or snapshots.
- Treat every real-project export as private because it can contain full prompts, answers, local
  paths, task IDs, Turn IDs, and internal project details.
- Keep secrets in environment variables. Do not write API keys or bearer tokens into fixtures,
  documentation, snapshots, or result files.
- The included probes use synthetic project names, paths, task IDs, Turn IDs, and conversations.
- `.gitignore` excludes common local secrets and real-project test artifacts.
