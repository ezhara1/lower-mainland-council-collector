import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { collectSource } from "./collector.js";
import { extractText } from "./extract.js";
import { buildDigest } from "./openrouter.js";
import { splitScript } from "./script-parts.js";
import { combineAudioParts, synthesize } from "./tts.js";
import {
  addToLibrary,
  downloadedUrls,
  getLibrary,
  getSettings,
  outputPath,
  rememberDownloaded,
  safeName,
  saveRun,
  scriptPath,
  writeOutputFile,
} from "./storage.js";
import { loadRegistry } from "./sources.js";
import type {
  AudioRequest,
  CollectRequest,
  CollectedDocument,
  LibraryDocument,
  RunResult,
  ScriptRequest,
} from "./types.js";

function createLimiter(limit: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  const next = () => {
    active -= 1;
    queue.shift()?.();
  };
  return async <T>(operation: () => Promise<T>) => {
    if (active >= limit) {
      await new Promise<void>((resolve) => queue.push(resolve));
    }
    active += 1;
    try {
      return await operation();
    } finally {
      next();
    }
  };
}

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

const documentId = (url: string) =>
  crypto.createHash("sha1").update(url).digest("hex").slice(0, 16);

export async function collectDocuments(request: CollectRequest): Promise<RunResult> {
  const startedAt = new Date().toISOString();
  const { sources } = await loadRegistry();
  const selected = sources.filter((source) => request.sourceIds.includes(source.id));
  const existing = await downloadedUrls();
  const failedSources: RunResult["failedSources"] = [];
  const files: RunResult["files"] = [];
  const warnings: string[] = [];
  const saved: LibraryDocument[] = [];
  let skippedDuplicates = 0;

  for (const source of selected) {
    let documents: CollectedDocument[];
    try {
      documents = await collectSource(source, request.dateFrom, request.dateTo, {
        browserAssisted: request.browserAssisted,
      });
    } catch (error) {
      failedSources.push({ sourceId: source.id, error: errorMessage(error) });
      continue;
    }
    for (const document of documents) {
      if (existing.has(document.url)) {
        skippedDuplicates += 1;
        continue;
      }
      existing.add(document.url);
      try {
        const location = await writeOutputFile(
          "documents",
          path.join(
            safeName(document.municipality),
            document.meetingDate ?? "Undated",
            safeName(document.fileName),
          ),
          document.bytes,
        );
        files.push({
          municipality: document.municipality,
          title: document.title,
          location,
        });
        saved.push({
          id: documentId(document.url),
          sourceId: document.sourceId,
          municipality: document.municipality,
          title: document.title,
          url: document.url,
          meetingDate: document.meetingDate,
          mimeType: document.mimeType,
          filePath: location,
          collectedAt: new Date().toISOString(),
        });
      } catch (error) {
        warnings.push(`Could not save ${document.fileName}: ${errorMessage(error)}`);
      }
    }
  }

  await addToLibrary(saved);
  await rememberDownloaded(saved.map((document) => document.url));
  const result: RunResult = {
    runId: crypto.randomUUID(),
    startedAt,
    completedAt: new Date().toISOString(),
    collected: saved.length,
    skippedDuplicates,
    failedSources,
    files,
    warnings: [...new Set(warnings)],
  };
  await saveRun(result);
  return result;
}

export async function generateScript(request: ScriptRequest) {
  const settings = await getSettings();
  const chosen = (await getLibrary()).filter((document) =>
    request.documentIds.includes(document.id),
  );
  if (!chosen.length) throw new Error("Choose at least one saved document.");

  const warnings: string[] = [];
  const documents: { municipality: string; title: string; text: string }[] = [];
  for (const document of chosen) {
    try {
      const text = await extractText(await fs.readFile(document.filePath), document.mimeType);
      if (!text) warnings.push(`No text could be extracted from ${document.title}.`);
      documents.push({ municipality: document.municipality, title: document.title, text });
    } catch (error) {
      warnings.push(`Skipped ${document.title}: ${errorMessage(error)}`);
    }
  }
  if (!documents.length) throw new Error("None of the chosen documents could be read.");

  const script = await buildDigest(
    documents,
    request.openRouterApiKey,
    request.openRouterModel || settings.openRouterModel,
    request.outputMode,
    request.customPrompt,
    {
      style: request.podcastStyle,
      styleNotes: request.podcastStyleNotes,
      humorLevel: request.humorLevel,
      allowProfanity: request.allowProfanity,
      energyLevel: request.energyLevel,
      targetMinutes: request.targetMinutes,
      targetAudience: request.targetAudience,
    },
  );

  const dates = chosen
    .map((document) => document.meetingDate)
    .filter((date): date is string => Boolean(date))
    .sort();
  const range = dates.length ? `${dates[0]} to ${dates[dates.length - 1]}` : "undated";
  const descriptor = {
    summary: "digest",
    podcast: "podcast script",
    custom: "custom output",
  }[request.outputMode];
  const stamp = new Date().toISOString().slice(0, 16).replace("T", " ").replace(":", "");
  const name = `${safeName(`${stamp} - ${range} - ${descriptor}`)}.md`;
  const location = await writeOutputFile("scripts", name, script);
  return { name, location, documents: documents.length, warnings };
}

export async function generateAudio(request: AudioRequest) {
  const source = await scriptPath(request.scriptName);
  const parts = splitScript(await fs.readFile(source, "utf8"));
  if (!parts.length) throw new Error("The script has no text to read.");

  const baseName = request.scriptName.replace(/\.(md|txt)$/i, "");
  const partsFolder = await outputPath("audio", `${baseName} parts`);
  const limit = createLimiter(Math.max(1, Math.min(request.audioConcurrency ?? 1, 3)));
  const options = {
    provider: request.ttsProvider,
    hostAVoice: request.hostAVoice || "af_heart",
    hostBVoice: request.hostBVoice || "am_michael",
  };
  const partPaths = await Promise.all(
    parts.map((part, index) =>
      limit(async () => {
        const partPath = path.join(
          partsFolder,
          `${String(index + 1).padStart(3, "0")} - ${safeName(part.title)}.wav`,
        );
        await synthesize(part.text, partPath, options);
        return partPath;
      }),
    ),
  );
  const location = await outputPath("audio", `${baseName}.wav`);
  await combineAudioParts(partPaths, location);
  return { location, parts: partPaths.length };
}
