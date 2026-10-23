import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export function makeFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "memorygraph-retrieval-"));
  const cwd = "/workspace/项目Ａ";
  const sessionsRoot = path.join(root, "sessions");
  const archivedRoot = path.join(root, "archived_sessions");
  mkdirSync(sessionsRoot);
  mkdirSync(archivedRoot);
  const event = (type, payload) => JSON.stringify({ type, payload, timestamp: "2026-10-23T01:00:00Z" });
  const turn = (id, prompt, answer) => [
    event("turn_context", { turn_id: id }),
    event("response_item", { type: "message", role: "user", content: [{ text: prompt }] }),
    event("response_item", { type: "message", role: "assistant", phase: "final_answer", content: [{ text: answer }] }),
  ];
  const session = (id, turns, project = cwd) => [event("session_meta", { id, cwd: project, timestamp: "2026-10-23T00:00:00Z" }), ...turns.flat()].join("\n") + "\n";
  const longAnswer = "  ＡＢＣ：原文\n" + "原始内容\n".repeat(7000) + "TAIL_UNIQUE_FULLTEXT\n ";
  const turns = Array.from({ length: 25 }, (_, i) => turn(`turn-${i}`, `common request ${i}`, `common result ${i}`));
  turns.push(turn("long", "  Ｆｕｌｌｗｉｄｔｈ 原始问题  ", longAnswer));
  turns.push(turn("alias", "handle email errors", "Process bounce events safely."));
  turns.push(turn("decision", "choose protocol", "## Final conclusion\nUse signed callbacks."));
  turns.push(turn("decision-two", "new protocol", "## Final conclusion\nUse versioned signed callbacks."));
  const sourcePath = path.join(sessionsRoot, "source.jsonl");
  writeFileSync(sourcePath, session("source", turns));
  writeFileSync(path.join(archivedRoot, "archive.jsonl"), session("archive", [turn("archived", "archived-only", "Archived original.")]));
  writeFileSync(path.join(sessionsRoot, "other.jsonl"), session("other", [turn("private", "common", "WRONG_PROJECT")], "/workspace/项目A"));
  writeFileSync(path.join(sessionsRoot, "copy.jsonl"), session("copy", turns.slice(0, 4)));
  writeFileSync(path.join(sessionsRoot, "reordered.jsonl"), session("reordered", [...turns.slice(0, 4)].reverse()));
  writeFileSync(path.join(sessionsRoot, "conflict.jsonl"), session("conflict", [turn("turn-0", "common request 0", "common CHANGED version")]));
  writeFileSync(path.join(sessionsRoot, "unsupported.jsonl.zst"), "unsupported fixture");
  const titleIndexPath = path.join(root, "titles.jsonl");
  const title = "Exact Ｔｉｔｌｅ " + "title ".repeat(150);
  writeFileSync(titleIndexPath, JSON.stringify({ id: "source", thread_name: title }));
  const options = { cwd, sessionsRoot, archivedRoot, titleIndexPath, indexDir: path.join(root, "index") };
  const statePath = path.join(root, "state.json");
  return { root, cwd, sourcePath, statePath, longAnswer, title, options, turn, session,
    cleanup: () => rmSync(root, { recursive: true, force: true }) };
}
