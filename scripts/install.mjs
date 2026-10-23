#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import readline from "node:readline/promises";
import { stdin, stdout, stderr } from "node:process";
import { savePreferredLocale, validLocale } from "../mcp/preferences.mjs";

const args = process.argv.slice(2);
let selector = "";
let locale = "";
for (let index = 0; index < args.length; index += 1) {
  const argument = args[index];
  if (argument === "--language") locale = args[++index] || "";
  else if (argument.startsWith("--language=")) locale = argument.slice("--language=".length);
  else if (!selector && !argument.startsWith("-")) selector = argument;
  else {
    stderr.write(`Unknown argument: ${argument}\n`);
    process.exit(2);
  }
}

if (!/^memorygraph@[^@\s]+$/.test(selector) || (locale && !validLocale(locale))) {
  stderr.write("Usage: node scripts/install.mjs memorygraph@<marketplace-name> [--language zh-CN|en]\n");
  process.exit(2);
}

if (!locale) {
  if (!stdin.isTTY) {
    stderr.write("Interactive language selection needs a terminal. Use --language zh-CN or --language en.\n");
    process.exit(2);
  }
  const prompt = readline.createInterface({ input: stdin, output: stdout });
  try {
    stdout.write("MemoryGraph dashboard language / 界面语言\n  1) 中文\n  2) English\n");
    while (!locale) {
      const answer = (await prompt.question("Choose 1 or 2 / 请选择 1 或 2: ")).trim();
      if (answer === "1") locale = "zh-CN";
      else if (answer === "2") locale = "en";
    }
  } finally {
    prompt.close();
  }
}

const installed = spawnSync("codex", ["plugin", "add", selector], { stdio: "inherit" });
if (installed.error) {
  stderr.write(`Could not run Codex: ${installed.error.message}\n`);
  process.exit(1);
}
if (installed.status !== 0) process.exit(installed.status || 1);

savePreferredLocale(locale);
stdout.write(locale === "en"
  ? "MemoryGraph installed. Dashboard language: English.\n"
  : "MemoryGraph 已安装。Dashboard 语言：中文。\n");
