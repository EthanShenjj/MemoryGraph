import { chromium } from "/Users/ethanshen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";

const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const pages = browser.contexts().flatMap((context) => context.pages());
const page = pages.find((item) => item.url().includes("creator.xiaohongshu.com/publish"));
if (!page) throw new Error("The prepared publish page is not open.");
const session = await page.context().newCDPSession(page);
await session.send("Accessibility.enable");
const { nodes } = await session.send("Accessibility.getFullAXTree", { depth: -1 });
const matches = nodes.filter((node) => {
  const name = node.name?.value?.trim();
  return name === "发布" || name === "暂存离开" || name === "我知道了";
});
console.log(JSON.stringify(matches, null, 2));
process.exit(0);
