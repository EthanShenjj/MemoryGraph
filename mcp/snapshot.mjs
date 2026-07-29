import {
  existsSync,
  mkdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

function pad(value) {
  return String(value).padStart(2, "0");
}

export function formatSnapshotTimestamp(date = new Date()) {
  const day = [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("-");
  const time = [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("-");
  return { day, stamp: `${day}_${time}` };
}

export function snapshotTitleSlug(value) {
  const normalized = String(value || "MemoryGraph")
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[.\-\s]+|[.\-\s]+$/g, "");
  return Array.from(normalized || "MemoryGraph").slice(0, 72).join("");
}

function scriptSafeJson(value) {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function standaloneHtml({ graph, widgetHtml, markPngBase64 }) {
  const bootstrap = `<script>window.openai={toolOutput:${scriptSafeJson(graph)}};</script>`;
  return widgetHtml
    .replace("</head>", `  ${bootstrap}\n</head>`)
    .replace(
      'src="./memorygraph-mark.png"',
      `src="data:image/png;base64,${markPngBase64}"`,
    );
}

function availablePath(directory, baseName) {
  const direct = path.join(directory, `${baseName}.html`);
  if (!existsSync(direct)) return direct;
  for (let index = 2; index < 10_000; index += 1) {
    const candidate = path.join(directory, `${baseName}-${pad(index)}.html`);
    if (!existsSync(candidate)) return candidate;
  }
  throw new Error("Unable to allocate a unique MemoryGraph snapshot filename");
}

function atomicWrite(filePath, contents) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  writeFileSync(temporary, contents, "utf8");
  renameSync(temporary, filePath);
}

export function saveGraphSnapshot({
  graph,
  widgetHtml,
  markPngBase64,
  title = graph?.title,
  now = new Date(),
  snapshotDir = process.env.MEMORYGRAPH_SNAPSHOT_DIR ||
    process.env.THREAD_ATLAS_SNAPSHOT_DIR ||
    path.join(os.homedir(), ".codex", "memorygraph", "snapshots"),
} = {}) {
  if (!graph?.nodes || !graph?.edges) throw new Error("A normalized graph is required");
  if (!widgetHtml) throw new Error("Widget HTML is required");
  if (!markPngBase64) throw new Error("MemoryGraph mark is required");

  const { day, stamp } = formatSnapshotTimestamp(now);
  const filePath = availablePath(
    path.join(snapshotDir, day),
    `${stamp}_${snapshotTitleSlug(title)}`,
  );
  const snapshot = {
    path: filePath,
    fileName: path.basename(filePath),
    date: day,
    title: title || "MemoryGraph",
  };
  atomicWrite(
    filePath,
    standaloneHtml({
      graph: { ...graph, snapshot },
      widgetHtml,
      markPngBase64,
    }),
  );
  return snapshot;
}
