import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { appPath } from "./paths.js";

type SynthesisOptions = {
  provider: "kokoro" | "chatterbox";
  hostAVoice: string;
  hostBVoice: string;
};

function runPython(args: string[], failure: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn("python3", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `${failure} exited with code ${code}`));
    });
  });
}

export async function synthesize(
  script: string,
  outputPath: string,
  options: SynthesisOptions,
) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const inputPath = path.join(os.tmpdir(), `council-tts-${crypto.randomUUID()}.txt`);
  await fs.writeFile(inputPath, script);
  try {
    await runPython(
      [
        appPath("scripts", "synthesize.py"),
        "--provider",
        options.provider,
        "--input",
        inputPath,
        "--output",
        outputPath,
        "--host-a-voice",
        options.hostAVoice,
        "--host-b-voice",
        options.hostBVoice,
      ],
      "TTS",
    );
  } finally {
    await fs.rm(inputPath, { force: true });
  }
}

export async function combineAudioParts(partPaths: string[], outputPath: string) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await runPython(
    [appPath("scripts", "combine_audio.py"), "--output", outputPath, ...partPaths],
    "Audio combine",
  );
}
