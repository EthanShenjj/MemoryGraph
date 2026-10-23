import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import readline from "node:readline";
import { makeFixture } from "./fixtures/retrieval.mjs";

// Uses an installed Playwright through NODE_PATH; no package installation or network.
const { chromium } = createRequire(import.meta.url)("playwright");
const fixture = makeFixture();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const preferences = path.join(fixture.root, "preferences.json");
writeFileSync(preferences, JSON.stringify({ locale: "en" }));
const child = spawn(process.execPath, [path.join(root, "mcp/server.mjs")], {
  env: { ...process.env, CODEX_SESSIONS_DIR: fixture.options.sessionsRoot,
    CODEX_ARCHIVED_SESSIONS_DIR: fixture.options.archivedRoot,
    CODEX_SESSION_INDEX: fixture.options.titleIndexPath, MEMORYGRAPH_INDEX_DIR: fixture.options.indexDir,
    MEMORYGRAPH_STATE_PATH: fixture.statePath, MEMORYGRAPH_PREFERENCES_PATH: preferences,
    MEMORYGRAPH_SNAPSHOT_DIR: path.join(fixture.root, "snapshots") },
  stdio: ["pipe", "pipe", "inherit"],
});
const pending = new Map();
let serial = 0;
readline.createInterface({ input: child.stdout }).on("line", (line) => {
  const message = JSON.parse(line);
  const entry = pending.get(message.id);
  if (!entry) return;
  clearTimeout(entry.timer);
  pending.delete(message.id);
  if (message.error) entry.reject(new Error(message.error.message));
  else entry.resolve(message.result);
});
function call(name, args) {
  const id = ++serial;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("MCP timeout")); }, 15000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }) + "\n");
  });
}

let browser;
try {
  const initial = await call("search_memory_graph", { cwd: fixture.cwd, query: "common", limit: 8, saveSnapshot: false });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  let failSave = false;
  let delayCommon = false;
  let copied = "";
  let sent = "";
  await page.exposeFunction("hostCall", async (name, args) => {
    if (delayCommon && name === "search_memory_graph" && args.query === "common") await new Promise((resolve) => setTimeout(resolve, 500));
    if (failSave && name === "record_retrieval_feedback") throw new Error("TEST_DISK_FAILURE");
    return call(name, args);
  });
  await page.exposeFunction("captureCopy", (text) => { copied = text; });
  await page.exposeFunction("captureSend", ({ prompt }) => { sent = prompt; });
  await page.addInitScript((graph) => {
    localStorage.setItem("memorygraph-language:v2", "en");
    window.openai = { toolOutput: graph,
      callTool: (name, args) => window.hostCall(name, args),
      sendFollowUpMessage: (value) => window.captureSend(value) };
    Object.defineProperty(navigator, "clipboard", { value: { writeText: async (text) => { await window.captureCopy(text); window.__copiedLength = text.length; } } });
  }, initial._meta.widgetData);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(pathToFileURL(path.join(root, "assets/widget.html")).href);
  await page.locator(".result-card").first().waitFor();
  assert.equal(await page.locator(".result-card").count(), 8);
  await page.locator("#nextPage").click();
  await page.waitForFunction(() => document.querySelector("#pageInfo").textContent.startsWith("9–"));
  await page.locator("#previousPage").click();
  await page.waitForFunction(() => document.querySelector("#pageInfo").textContent.startsWith("1–"));

  // The target was outside the old payload: pressing Enter must reach the backend.
  await page.locator("#searchInput").fill("TAIL_UNIQUE_FULLTEXT");
  await page.locator("#searchInput").press("Enter");
  await page.waitForFunction(() => document.querySelector("#sourcePrompt").textContent.includes("Ｆｕｌｌｗｉｄｔｈ"));
  assert(!(await page.locator("#recordContent").textContent()).includes("TAIL_UNIQUE_FULLTEXT"));
  await page.locator("#loadRecord").click();
  await page.waitForFunction(() => document.querySelector("#recordContent").textContent.includes("TAIL_UNIQUE_FULLTEXT"));
  await page.locator("#copyRecord").click();
  await page.waitForFunction(() => document.querySelector("#sourceReadStatus").textContent.includes("Source verified"));
  await page.waitForFunction((length) => window.__copiedLength === length, fixture.longAnswer.length);
  assert(copied === fixture.longAnswer, "Copied original must retain every character");
  await page.locator("#continueWithRecord").click();
  await page.locator("#continuePreview[open]").waitFor();
  assert((await page.locator("#continuePreviewText").inputValue()).includes("TAIL_UNIQUE_FULLTEXT"));
  assert.equal(sent, "", "Opening preview must not send");
  await page.locator("#includeAdjacent").check();
  await page.waitForFunction(() => document.querySelector("#continuePreviewText").value.includes("common result 24"));
  await page.locator("#sendContinuation").click();
  await page.waitForFunction(() => !document.querySelector("#continuePreview").open);
  assert(sent.includes("TAIL_UNIQUE_FULLTEXT"));

  await page.locator("#searchInput").fill("退信");
  await page.locator("#searchInput").press("Enter");
  await page.waitForFunction(() => document.querySelector("#recordContent").textContent.includes("bounce"));
  assert.equal(await page.locator(".result-card").count(), 1, "Lexical expansion must survive UI filtering");
  assert(!(await page.locator(".result-score").textContent()).includes("%"));
  failSave = true;
  await page.locator('[data-feedback="incorrect"]').click();
  await page.waitForFunction(() => document.querySelector("#toast").textContent.includes("TEST_DISK_FAILURE"));
  assert.equal(await page.locator(".result-card").count(), 1, "Failed feedback must not hide the result");
  failSave = false;
  await page.locator('[data-feedback="incorrect"]').click();
  await page.waitForFunction(() => document.querySelectorAll(".result-card").length === 0);
  await page.locator("#includeExcluded").check();
  await page.locator("#searchHistory").click();
  await page.locator(".result-card").waitFor();
  await page.locator('[data-feedback="cleared"]').click();
  await page.waitForFunction(() => !document.querySelector(".result-score.incorrect"));

  await page.locator("#searchInput").fill("choose protocol");
  await page.locator("#searchInput").press("Enter");
  await page.waitForFunction(() => document.querySelector("#sourcePrompt").textContent === "choose protocol");
  await page.locator('[data-content-kind="memory"]').click();
  await page.locator('[data-memory-review="confirmed"]').click();
  await page.waitForFunction(() => document.querySelector("#memoryReviewState").textContent.includes("Confirmed"));
  await page.locator("#memoryCorrection").fill("Reviewed correction");
  await page.locator('[data-memory-review="corrected"]').click();
  await page.waitForFunction(() => document.querySelector("#recordContent").textContent.includes("Reviewed correction"));
  assert((await page.locator("#reviewHistoryText").textContent()).includes('"revision": 2'));
  await page.reload();
  await page.locator("#searchInput").fill("choose protocol");
  await page.locator("#searchInput").press("Enter");
  await page.waitForFunction(() => document.querySelector("#sourcePrompt").textContent === "choose protocol");
  await page.locator('[data-content-kind="memory"]').click();
  await page.waitForFunction(() => document.querySelector("#recordContent").textContent.includes("Reviewed correction"));

  delayCommon = true;
  await page.locator("#searchInput").fill("common");
  await page.locator("#searchInput").press("Enter");
  await page.locator("#searchInput").fill("退信");
  await page.locator("#searchInput").press("Enter");
  await page.waitForFunction(() => document.querySelector("#recordContent").textContent.includes("bounce"));
  await page.waitForTimeout(650);
  assert.equal(await page.locator("#searchInput").inputValue(), "退信", "A late search must not overwrite the latest query");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#searchOptionsToggle").click();
  assert(await page.locator("#scopeInput").isVisible(), "Mobile filters must remain reachable");
  await page.locator("#searchOptionsToggle").click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  const offline = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await offline.addInitScript((graph) => {
    localStorage.setItem("memorygraph-language:v2", "en");
    window.openai = { toolOutput: graph };
  }, initial._meta.widgetData);
  await offline.goto(pathToFileURL(path.join(root, "assets/widget.html")).href);
  await offline.locator('[data-feedback="incorrect"]').click();
  await offline.waitForFunction(() => document.querySelector("#toast").textContent.includes("Static preview"));
  assert.equal(await offline.locator(".result-card").count(), 8);
  await offline.close();
  writeFileSync(fixture.options.titleIndexPath, JSON.stringify({ id: "source", thread_name: "Delivery decisions and email callbacks" }));
  await page.locator("#searchHistory").click();
  await page.waitForFunction(() => document.querySelector("#detailTitle").textContent === "Delivery decisions and email callbacks");
  await page.screenshot({ path: path.join(process.env.MEMORYGRAPH_TEST_OUTPUT || fixture.root, "memorygraph-optimized.png") });
  assert.deepEqual(errors, []);
  console.log("MemoryGraph widget + real MCP integration probe passed");
} finally {
  await browser?.close();
  child.stdin.end();
  child.kill("SIGTERM");
  for (const { timer } of pending.values()) clearTimeout(timer);
  fixture.cleanup();
}
