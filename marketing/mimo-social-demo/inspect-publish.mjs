import { chromium } from "/Users/ethanshen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const context = await chromium.launchPersistentContext(
  "/Users/ethanshen/Google/Chrome/XiaohongshuProfiles/default",
  {
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    headless: true,
    viewport: { width: 1440, height: 1000 },
  },
);
const pages = context.pages();
const initial = pages[0] || await context.newPage();
await initial.goto("https://creator.xiaohongshu.com/publish/publish?source=official", { waitUntil: "domcontentloaded" });
await initial.waitForTimeout(5000);
for (const [index, page] of pages.entries()) {
  console.log(`PAGE ${index}: ${await page.title()} :: ${page.url()}`);
}
const page = context.pages().find((item) => item.url().includes("creator.xiaohongshu.com")) || initial;
await page.screenshot({ path: path.join(here, "publish-page.png"), fullPage: true });
console.log("VISIBLE TEXT:\n" + (await page.locator("body").innerText()).slice(0, 8000));
console.log("INPUTS:", await page.locator("input").evaluateAll((nodes) => nodes.map((node) => ({ type: node.type, accept: node.accept, placeholder: node.placeholder, className: node.className }))));
await context.close();
