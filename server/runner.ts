import crypto from "node:crypto";
import path from "node:path";
import { collectSource } from "./collector.js";
import { uploadToDrive } from "./google-drive.js";
import { buildDigest } from "./openrouter.js";
import { combineAudioParts, synthesize } from "./tts.js";
import {
  downloadedUrls,
  getSettings,
  rememberDownloaded,
  saveLocalFile,
  saveRun,
} from "./storage.js";
import { loadRegistry } from "./sources.js";
import type { RunRequest, RunResult } from "./types.js";

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

export async function runCollection(request: RunRequest): Promise<RunResult> {
  const startedAt = new Date().toISOString();
  const runId = crypto.randomUUID();
  const settings = await getSettings();
  const { sources } = await loadRegistry();
  const selected = sources.filter((source) =>
    request.sourceIds.includes(source.id),
  );
  const existing = await downloadedUrls();
  const collected = [];
  const failedSources: RunResult["failedSources"] = [];
  let skippedDuplicates = 0;

  for (const source of selected) {
    try {
      const documents = await collectSource(
        source,
        request.dateFrom,
        request.dateTo,
        { browserAssisted: request.browserAssisted },
      );
      for (const document of documents) {
        if (existing.has(document.url)) {
          skippedDuplicates += 1;
          continue;
        }
        collected.push(document);
      }
    } catch (error) {
      failedSources.push({
        sourceId: source.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const files: RunResult["files"] = [];
  const warnings: string[] = [];
  for (const document of collected) {
    const dateFolder = document.meetingDate ?? "Undated";
    let location: string;
    try {
      location = await uploadToDrive(
        settings,
        document.municipality,
        dateFolder,
        document.fileName,
        document.mimeType,
        document.bytes,
      );
    } catch (error) {
      const relativePath = path.join(
        document.municipality,
        dateFolder,
        document.fileName,
      );
      location = await saveLocalFile(relativePath, document.bytes);
      warnings.push(
        `Saved ${document.fileName} locally because Drive upload failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    files.push({
      municipality: document.municipality,
      title: document.title,
      location,
    });
  }

  let digestLocation: string | undefined;
  let audioLocation: string | undefined;
  if (request.summarize && collected.length) {
    if (!request.openRouterApiKey) {
      warnings.push("Summarization was skipped because no OpenRouter API key was supplied.");
    } else {
      const audioJobs: Promise<void>[] = [];
      const audioParts: { index: number; path: string }[] = [];
      const audioDirectory = path.resolve(".data", "generated", runId);
      const limitAudio = createLimiter(
        Math.max(1, Math.min(request.audioConcurrency ?? 1, 3)),
      );
      const digest = await buildDigest(
        collected,
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
        request.generateAudio && request.outputMode === "podcast"
          ? async (segment) => {
              const safeTitle = segment.title.replace(/[^a-z0-9]+/gi, "-");
              const partPath = path.join(
                audioDirectory,
                `${String(segment.index).padStart(3, "0")} - ${safeTitle}.wav`,
              );
              audioJobs.push(
                limitAudio(async () => {
                  await synthesize(segment.text, partPath, {
                    provider: request.ttsProvider ?? "kokoro",
                    hostAVoice: request.hostAVoice || "af_heart",
                    hostBVoice: request.hostBVoice || "am_michael",
                  });
                  audioParts.push({ index: segment.index, path: partPath });
                }),
              );
            }
          : undefined,
      );
      const descriptor =
        request.outputMode === "podcast" ? "podcast script" : "council digest";
      const digestName = `${request.dateFrom} to ${request.dateTo} - ${descriptor}.md`;
      try {
        digestLocation = await uploadToDrive(
          settings,
          "Regional Digests",
          `${request.dateFrom} to ${request.dateTo}`,
          digestName,
          "text/markdown",
          Buffer.from(digest),
        );
      } catch {
        digestLocation = await saveLocalFile(
          path.join("Regional Digests", digestName),
          digest,
        );
      }
      if (request.generateAudio) {
        try {
          const localAudioPath = path.resolve(
            ".data",
            "generated",
            `${request.dateFrom} to ${request.dateTo} - council podcast.wav`,
          );
          let audio: Buffer;
          if (request.outputMode === "podcast" && audioJobs.length) {
            await Promise.all(audioJobs);
            audioParts.sort((left, right) => left.index - right.index);
            audio = await combineAudioParts(
              audioParts.map((part) => part.path),
              localAudioPath,
            );
          } else {
            audio = await synthesize(digest, localAudioPath, {
              provider: request.ttsProvider ?? "kokoro",
              hostAVoice: request.hostAVoice || "af_heart",
              hostBVoice: request.hostBVoice || "am_michael",
            });
          }
          try {
            audioLocation = await uploadToDrive(
              settings,
              "Regional Digests",
              `${request.dateFrom} to ${request.dateTo}`,
              path.basename(localAudioPath),
              "audio/wav",
              audio,
            );
          } catch {
            audioLocation = localAudioPath;
          }
        } catch (error) {
          warnings.push(
            `Audio generation failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
  }

  await rememberDownloaded(collected.map((document) => document.url));
  const result: RunResult = {
    runId,
    startedAt,
    completedAt: new Date().toISOString(),
    collected: collected.length,
    skippedDuplicates,
    failedSources,
    files,
    digestLocation,
    audioLocation,
    warnings: [...new Set(warnings)],
  };
  await saveRun(result);
  return result;
}
