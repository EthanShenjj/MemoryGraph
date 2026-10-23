import { chromium } from "/Users/ethanshen/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const assets = path.join(here, "assets");
await mkdir(assets, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();
const url = "http://127.0.0.1:8765/assets/widget.html";

async function setLocale(locale, firstOpen = false) {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.evaluate(({ locale, firstOpen }) => {
    localStorage.removeItem("memorygraph-language:v2");
    localStorage.removeItem("memorygraph-install-locale:v1");
    if (!firstOpen) localStorage.setItem("memorygraph-language:v2", locale);
  }, { locale, firstOpen });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(300);
}

async function shot(name) {
  await page.screenshot({ path: path.join(assets, name), type: "png" });
}

await setLocale("zh-CN");
await page.locator('[data-canvas-mode="results"]').click();
await page.waitForTimeout(250);
await shot("dashboard-zh.png");
await page.locator('[data-canvas-mode="graph"]').click();
await page.waitForTimeout(250);
await shot("graph-zh.png");

await setLocale("en");
await page.locator('[data-canvas-mode="results"]').click();
await page.waitForTimeout(250);
await shot("dashboard-en.png");
await page.locator('[data-canvas-mode="graph"]').click();
await page.waitForTimeout(250);
await shot("graph-en.png");

await setLocale("zh-CN", true);
await page.waitForSelector("#languageOnboarding:not([hidden])");
await shot("onboarding.png");

const portraitContext = await browser.newContext({
  viewport: { width: 900, height: 1200 },
  deviceScaleFactor: 1.2,
});
const portrait = await portraitContext.newPage();

async function portraitLocale(locale, firstOpen = false) {
  await portrait.goto(url, { waitUntil: "networkidle" });
  await portrait.evaluate(({ locale, firstOpen }) => {
    localStorage.removeItem("memorygraph-language:v2");
    localStorage.removeItem("memorygraph-install-locale:v1");
    if (!firstOpen) localStorage.setItem("memorygraph-language:v2", locale);
  }, { locale, firstOpen });
  await portrait.reload({ waitUntil: "networkidle" });
  await portrait.waitForTimeout(250);
}

async function portraitShot(name) {
  await portrait.screenshot({ path: path.join(assets, name), type: "png" });
}

await portraitLocale("zh-CN");
await portrait.locator('[data-canvas-mode="results"]').click();
await portrait.waitForTimeout(200);
await portraitShot("product-results-portrait.png");
await portrait.locator("#searchInput").fill("AND or OR");
await portrait.waitForTimeout(250);
await portraitShot("product-search-portrait.png");
await portrait.locator('[data-canvas-mode="graph"]').click();
await portrait.waitForTimeout(250);
await portraitShot("product-graph-portrait.png");
await portraitLocale("zh-CN", true);
await portrait.waitForSelector("#languageOnboarding:not([hidden])");
await portraitShot("product-onboarding-portrait.png");

await portraitContext.close();

await browser.close();
console.log("Captured MemoryGraph product scenes.");
