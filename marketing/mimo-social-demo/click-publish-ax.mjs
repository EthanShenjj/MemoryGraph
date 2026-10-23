import { chromium } from "/Users/ethanshen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const pages = browser.contexts().flatMap((context) => context.pages());
const page = pages.find((item) => item.url().includes("creator.xiaohongshu.com/publish"));
if (!page) throw new Error("The prepared publish page is not open.");

const session = await page.context().newCDPSession(page);
await session.send("Accessibility.enable");
const { nodes } = await session.send("Accessibility.getFullAXTree", { depth: -1 });
const target = nodes.find((node) =>
  node.role?.value === "button" && node.name?.value?.trim() === "发布" && node.backendDOMNodeId
);
if (!target) throw new Error("No accessibility button named 发布 was found.");

const resolved = await session.send("DOM.resolveNode", { backendNodeId: target.backendDOMNodeId });
const objectId = resolved.object?.objectId;
if (!objectId) throw new Error("The 发布 accessibility node could not be resolved to a DOM control.");

const activation = await session.send("Runtime.callFunctionOn", {
  objectId,
  returnByValue: true,
  functionDeclaration: `function () {
    if (this.disabled || this.getAttribute('aria-disabled') === 'true') {
      return { clicked: false, disabled: true, tag: this.tagName, className: this.className };
    }
    this.scrollIntoView({ block: 'center', inline: 'center' });
    this.click();
    return { clicked: true, disabled: false, tag: this.tagName, className: this.className };
  }`,
});
console.log("ACTIVATION:", activation.result?.value);
if (!activation.result?.value?.clicked) throw new Error("The exact 发布 button was disabled.");

await page.waitForTimeout(10000);
await page.screenshot({ path: path.join(here, "publish-result.png"), fullPage: true });
const bodyText = await page.locator("body").innerText();
console.log(`RESULT_URL: ${page.url()}`);
console.log("RESULT_TEXT:\n" + bodyText.slice(-6000));

const success = /发布成功|发布完成|审核中/.test(bodyText) || /note-manager|manage/.test(page.url());
process.exit(success ? 0 : 2);
