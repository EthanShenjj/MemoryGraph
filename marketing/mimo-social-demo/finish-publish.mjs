import { chromium } from "/Users/ethanshen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const pages = browser.contexts().flatMap((context) => context.pages());
const page = pages.find((item) => item.url().includes("creator.xiaohongshu.com/publish"));
if (!page) throw new Error("The prepared Xiaohongshu publish page is not open.");

const guide = page.getByRole("button", { name: "我知道了", exact: true });
if (await guide.isVisible().catch(() => false)) {
  await guide.click();
  await page.waitForTimeout(500);
  console.log("Dismissed the image editing guide.");
}

const publish = page.getByRole("button", { name: "发布", exact: true }).last();
if (await publish.isVisible().catch(() => false)) {
  if (await publish.isDisabled().catch(() => true)) {
    throw new Error("The publish button is disabled after dismissing the guide.");
  }
  await publish.click();
} else {
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("Unable to determine the page viewport.");
  await page.mouse.click(viewport.width * 0.52, viewport.height - 42);
  console.log(`Clicked the fixed publish control at ${Math.round(viewport.width * 0.52)}, ${viewport.height - 42}.`);
}
console.log("Publish button clicked.");
await page.waitForTimeout(7000);
await page.screenshot({ path: path.join(here, "publish-result.png"), fullPage: true });

const bodyText = await page.locator("body").innerText();
console.log(`RESULT_URL: ${page.url()}`);
console.log("RESULT_TEXT:\n" + bodyText.slice(-5000));

const success = /发布成功|已发布|笔记管理/.test(bodyText) || !page.url().includes("/publish/publish");
process.exit(success ? 0 : 2);
