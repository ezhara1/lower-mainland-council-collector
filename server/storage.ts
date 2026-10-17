import fs from "node:fs/promises";
import path from "node:path";
import type { AppSettings, RunResult } from "./types.js";

const dataDir = path.resolve(".data");
const settingsPath = path.join(dataDir, "settings.json");
const ledgerPath = path.join(dataDir, "downloaded.json");
const runsPath = path.join(dataDir, "runs.json");

const defaultSettings: AppSettings = {
  googleClientId: "",
  googleClientSecret: "",
  googleDriveFolderId: "",
  googleRefreshToken: "",
  openRouterModel: "google/gemini-2.5-flash",
};

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(filePath: string, value: unknown) {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
}

export async function getSettings() {
  return readJson(settingsPath, defaultSettings);
}

export async function saveSettings(update: Partial<AppSettings>) {
  const current = await getSettings();
  const next = { ...current, ...update };
  await writeJson(settingsPath, next);
  return next;
}

export async function downloadedUrls() {
  return new Set(await readJson<string[]>(ledgerPath, []));
}

export async function rememberDownloaded(urls: string[]) {
  const current = await downloadedUrls();
  urls.forEach((url) => current.add(url));
  await writeJson(ledgerPath, [...current].sort());
}

export async function saveRun(result: RunResult) {
  const current = await readJson<RunResult[]>(runsPath, []);
  await writeJson(runsPath, [result, ...current].slice(0, 50));
}

export async function getRuns() {
  return readJson<RunResult[]>(runsPath, []);
}

export async function saveLocalFile(
  relativePath: string,
  bytes: Buffer | string,
) {
  const destination = path.join(dataDir, "downloads", relativePath);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, bytes);
  return destination;
}
