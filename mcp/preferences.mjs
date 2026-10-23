import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const PREFERENCES_PATH = process.env.MEMORYGRAPH_PREFERENCES_PATH ||
  path.join(os.homedir(), ".codex", "memorygraph", "preferences.json");

export function validLocale(value) {
  return value === "zh-CN" || value === "en";
}

export function readPreferredLocale() {
  try {
    const value = JSON.parse(readFileSync(PREFERENCES_PATH, "utf8"));
    return validLocale(value?.locale) ? value.locale : null;
  } catch {
    return null;
  }
}

export function savePreferredLocale(locale) {
  if (!validLocale(locale)) throw new Error("Language must be zh-CN or en");
  mkdirSync(path.dirname(PREFERENCES_PATH), { recursive: true });
  const temporary = `${PREFERENCES_PATH}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({ locale }, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, PREFERENCES_PATH);
}
