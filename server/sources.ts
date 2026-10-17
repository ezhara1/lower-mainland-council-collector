import fs from "node:fs/promises";
import path from "node:path";
import type { MunicipalSource } from "./types.js";
import { appPath } from "./paths.js";

type Registry = { sources: MunicipalSource[]; caveats: string[] };

export async function loadRegistry(): Promise<Registry> {
  const registryPath = appPath("source-registry.json");
  try {
    return JSON.parse(await fs.readFile(registryPath, "utf8")) as Registry;
  } catch {
    return { sources: [], caveats: ["Source research is not complete yet."] };
  }
}
