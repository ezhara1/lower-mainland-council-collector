import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AppSettings, LibraryDocument, RunResult } from "./types.js";
import { dataDir, dataPath } from "./paths.js";

const settingsPath = path.join(dataDir, "settings.json");
const ledgerPath = path.join(dataDir, "downloaded.json");
const runsPath = path.join(dataDir, "runs.json");
const libraryPath = path.join(dataDir, "library.json");

const defaultSettings: AppSettings = {
  outputFolder: "",
  openRouterModel: "google/gemini-2.5-flash",
};

export const OUTPUT_FOLDERS = {
  documents: "Council Documents",
  scripts: "Scripts",
  audio: "Audio",
} as const;

type OutputKind = keyof typeof OUTPUT_FOLDERS;

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

export async function getSettings(): Promise<AppSettings> {
  const stored = await readJson<Partial<AppSettings>>(settingsPath, {});
  return {
    outputFolder: stored.outputFolder ?? defaultSettings.outputFolder,
    openRouterModel: stored.openRouterModel || defaultSettings.openRouterModel,
  };
}

export async function saveSettings(update: Partial<AppSettings>) {
  const next = { ...(await getSettings()), ...update };
  await writeJson(settingsPath, next);
  return next;
}

export function resolveOutputFolder(folder: string) {
  const trimmed = folder.trim();
  if (!trimmed) return dataPath("output");
  if (trimmed === "~" || /^~[/\\]/.test(trimmed)) {
    return path.join(os.homedir(), trimmed.slice(1));
  }
  return path.resolve(trimmed);
}

export async function outputPath(kind: OutputKind, relativePath: string) {
  const root = resolveOutputFolder((await getSettings()).outputFolder);
  return path.join(root, OUTPUT_FOLDERS[kind], relativePath);
}

export async function writeOutputFile(
  kind: OutputKind,
  relativePath: string,
  contents: Buffer | string,
) {
  const destination = await outputPath(kind, relativePath);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, contents);
  return destination;
}

export function safeName(value: string) {
  return (
    value
      .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 150) || "untitled"
  );
}

export async function scriptPath(name: string) {
  if (path.basename(name) !== name || !/\.(md|txt)$/i.test(name)) {
    throw new Error("Scripts must be .md or .txt files in the Scripts folder.");
  }
  return outputPath("scripts", name);
}

export async function listScripts() {
  const folder = await outputPath("scripts", "");
  let names: string[];
  try {
    names = await fs.readdir(folder);
  } catch {
    return [];
  }
  const scripts = await Promise.all(
    names
      .filter((name) => /\.(md|txt)$/i.test(name))
      .map(async (name) => ({
        name,
        modifiedAt: (await fs.stat(path.join(folder, name))).mtime.toISOString(),
      })),
  );
  return scripts.sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt));
}

export async function getLibrary() {
  return readJson<LibraryDocument[]>(libraryPath, []);
}

export async function addToLibrary(documents: LibraryDocument[]) {
  if (!documents.length) return;
  const byId = new Map((await getLibrary()).map((document) => [document.id, document]));
  documents.forEach((document) => byId.set(document.id, document));
  await writeJson(libraryPath, [...byId.values()]);
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
