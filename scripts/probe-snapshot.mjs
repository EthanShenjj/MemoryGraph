import {
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  formatSnapshotTimestamp,
  saveGraphSnapshot,
  snapshotTitleSlug,
} from "../mcp/snapshot.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), "memorygraph-snapshot-"));

try {
  const now = new Date(2026, 6, 29, 14, 5, 9);
  const graph = {
    title: "Sample Project Webhook/Review",
    query: "webhook review",
    nodes: [{ id: "project:sample", title: "sample-project", kind: "project" }],
    edges: [],
  };
  const options = {
    graph,
    widgetHtml: readFileSync(path.join(ROOT, "assets", "widget.html"), "utf8"),
    markPngBase64: readFileSync(path.join(ROOT, "assets", "memorygraph-mark.png")).toString("base64"),
    title: graph.title,
    now,
    snapshotDir: temporaryRoot,
  };
  const first = saveGraphSnapshot(options);
  const second = saveGraphSnapshot(options);
  const html = readFileSync(first.path, "utf8");
  const timestamp = formatSnapshotTimestamp(now);

  if (timestamp.stamp !== "2026-07-29_14-05-09") throw new Error("Timestamp format changed");
  if (snapshotTitleSlug(graph.title) !== "Sample-Project-Webhook-Review") {
    throw new Error("Snapshot title sanitization failed");
  }
  if (first.fileName !== "2026-07-29_14-05-09_Sample-Project-Webhook-Review.html") {
    throw new Error(`Unexpected first filename: ${first.fileName}`);
  }
  if (second.fileName !== "2026-07-29_14-05-09_Sample-Project-Webhook-Review-02.html") {
    throw new Error(`Collision suffix missing: ${second.fileName}`);
  }
  if (!html.includes("window.openai={toolOutput:")) throw new Error("Graph bootstrap missing");
  if (!html.includes("data:image/png;base64,")) throw new Error("Embedded mark missing");
  if (html.includes('src="./memorygraph-mark.png"')) throw new Error("Snapshot is not standalone");
  if (!html.includes(first.fileName)) throw new Error("Snapshot metadata missing");

  process.stdout.write("MemoryGraph snapshot probe passed\n");
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true });
}
