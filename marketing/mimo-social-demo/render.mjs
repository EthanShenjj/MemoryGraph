import { chromium } from "/Users/ethanshen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";
import { mkdir } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const output = path.join(here, "output");
await mkdir(output, { recursive: true });

const targets = [
  ["#xhs-01", "xhs-01-cover.png"],
  ["#xhs-02", "xhs-02-retrieval.png"],
  ["#xhs-03", "xhs-03-evidence.png"],
  ["#xhs-04", "xhs-04-graph.png"],
  ["#xhs-05", "xhs-05-language.png"],
  ["#x-01", "x-01-cover.png"],
  ["#x-02", "x-02-retrieval.png"],
  ["#x-03", "x-03-lineage.png"],
  ["#x-04", "x-04-mimo.png"],
];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 2200, height: 1600 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(path.join(here, "index.html")).href, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);

for (const [selector, filename] of targets) {
  const node = page.locator(selector);
  await node.screenshot({ path: path.join(output, filename), type: "png" });
}

await browser.close();
console.log(`Rendered ${targets.length} social images.`);
