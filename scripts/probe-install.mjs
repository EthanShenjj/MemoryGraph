import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const temporary = mkdtempSync(path.join(os.tmpdir(), "memorygraph-install-probe-"));
const fakeCodex = path.join(temporary, "codex");
const argumentsFile = path.join(temporary, "args.txt");
const preferencesFile = path.join(temporary, "preferences.json");

try {
  writeFileSync(fakeCodex, '#!/bin/sh\nprintf "%s\\n" "$@" > "$MEMORYGRAPH_FAKE_INSTALL_ARGS"\nexit "${MEMORYGRAPH_FAKE_INSTALL_EXIT:-0}"\n');
  chmodSync(fakeCodex, 0o755);
  const env = {
    ...process.env,
    PATH: `${temporary}${path.delimiter}${process.env.PATH || ""}`,
    MEMORYGRAPH_PREFERENCES_PATH: preferencesFile,
    MEMORYGRAPH_FAKE_INSTALL_ARGS: argumentsFile,
  };
  const install = spawnSync(process.execPath, [path.join(ROOT, "scripts", "install.mjs"), "memorygraph@test", "--language", "en"], {
    cwd: ROOT, env, encoding: "utf8",
  });
  if (install.status !== 0) throw new Error(install.stderr || "Installer failed");
  if (readFileSync(argumentsFile, "utf8") !== "plugin\nadd\nmemorygraph@test\n") {
    throw new Error("Installer called Codex with the wrong arguments");
  }
  if (JSON.parse(readFileSync(preferencesFile, "utf8")).locale !== "en") {
    throw new Error("Installer did not save the selected language");
  }
  const failure = spawnSync(process.execPath, [path.join(ROOT, "scripts", "install.mjs"), "memorygraph@test", "--language", "zh-CN"], {
    cwd: ROOT, env: { ...env, MEMORYGRAPH_FAKE_INSTALL_EXIT: "7" }, encoding: "utf8",
  });
  if (failure.status !== 7 || JSON.parse(readFileSync(preferencesFile, "utf8")).locale !== "en") {
    throw new Error("Failed installation changed the saved language");
  }
  process.stdout.write("MemoryGraph installer probe passed\n");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
