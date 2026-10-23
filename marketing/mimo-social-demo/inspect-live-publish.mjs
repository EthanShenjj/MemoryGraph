import { chromium } from "/Users/ethanshen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const pages = browser.contexts().flatMap((context) => context.pages());
const page = pages.find((item) => item.url().includes("creator.xiaohongshu.com/publish")) || pages.at(-1);
console.log(`URL: ${page.url()}`);
console.log(`TITLE: ${await page.title()}`);
await page.screenshot({ path: path.join(here, "publish-current.png"), fullPage: true });
console.log("VISIBLE TEXT:\n" + (await page.locator("body").innerText()).slice(-10000));
console.log("BUTTONS:", await page.locator("button").evaluateAll((nodes) => nodes.map((node) => ({ text: node.innerText.trim(), disabled: node.disabled, className: node.className })).filter((item) => item.text)));
console.log("INPUTS:", await page.locator("input").evaluateAll((nodes) => nodes.map((node) => ({ type: node.type, value: node.value, placeholder: node.placeholder, disabled: node.disabled, className: node.className }))));
console.log("PUBLISH ELEMENTS:", await page.locator("body *").evaluateAll((nodes) => nodes.filter((node) => node.textContent?.trim() === "发布").map((node) => {
  const rect = node.getBoundingClientRect();
  const style = getComputedStyle(node);
  return { tag: node.tagName, className: node.className, role: node.getAttribute("role"), disabled: node.disabled, display: style.display, visibility: style.visibility, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
})));
process.exit(0);
