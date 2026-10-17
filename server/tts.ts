import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { appPath } from "./paths.js";

type SynthesisOptions = {
  provider: "kokoro" | "chatterbox";
  hostAVoice: string;
  hostBVoice: string;
};

export async function synthesize(
  script: string,
  outputPath: string,
  options: SynthesisOptions,
) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const inputPath = `${outputPath}.txt`;
  await fs.writeFile(inputPath, script);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "python3",
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
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `TTS exited with code ${code}`));
    });
  });
  return fs.readFile(outputPath);
}

export async function combineAudioParts(
  partPaths: string[],
  outputPath: string,
) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "python3",
      [
        appPath("scripts", "combine_audio.py"),
        "--output",
        outputPath,
        ...partPaths,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `Audio combine exited with code ${code}`));
    });
  });
  return fs.readFile(outputPath);
}
