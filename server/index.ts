import fs from "node:fs/promises";
import express from "express";
import cors from "cors";
import { z } from "zod";
import { loadRegistry } from "./sources.js";
import {
  getLibrary,
  getRuns,
  getSettings,
  listScripts,
  resolveOutputFolder,
  saveSettings,
  scriptPath,
} from "./storage.js";
import { collectDocuments, generateAudio, generateScript } from "./runner.js";
import { appPath } from "./paths.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));

const settingsSchema = z.object({
  outputFolder: z.string(),
  openRouterModel: z.string(),
});

const collectSchema = z.object({
  sourceIds: z.array(z.string()).min(1),
  dateFrom: z.iso.date(),
  dateTo: z.iso.date(),
  browserAssisted: z.boolean().optional(),
});

const scriptSchema = z.object({
  documentIds: z.array(z.string()).min(1),
  openRouterApiKey: z.string().min(1),
  openRouterModel: z.string().optional(),
  outputMode: z.enum(["summary", "podcast", "custom"]),
  customPrompt: z.string().optional(),
  podcastStyle: z
    .enum(["analytical", "conversational", "witty", "sensational", "executive"])
    .optional(),
  podcastStyleNotes: z.string().optional(),
  humorLevel: z.enum(["none", "light", "strong"]).optional(),
  allowProfanity: z.boolean().optional(),
  energyLevel: z.enum(["calm", "balanced", "high"]).optional(),
  targetMinutes: z.number().int().min(2).max(60).optional(),
  targetAudience: z.string().optional(),
});

const audioSchema = z.object({
  scriptName: z.string().min(1),
  ttsProvider: z.enum(["kokoro", "chatterbox"]),
  hostAVoice: z.string().optional(),
  hostBVoice: z.string().optional(),
  audioConcurrency: z.number().int().min(1).max(3).optional(),
});

type Handler = (request: express.Request, response: express.Response) => Promise<unknown>;
const route =
  (handler: Handler) =>
  (request: express.Request, response: express.Response, next: express.NextFunction) => {
    handler(request, response).then(
      (body) => {
        if (!response.headersSent) response.json(body);
      },
      next,
    );
  };

async function settingsResponse() {
  const settings = await getSettings();
  return { ...settings, resolvedOutputFolder: resolveOutputFolder(settings.outputFolder) };
}

app.get("/api/health", (_request, response) => {
  response.json({ ok: true });
});

app.get("/api/sources", route(() => loadRegistry()));

app.get("/api/settings", route(settingsResponse));

app.put(
  "/api/settings",
  route(async (request) => {
    await saveSettings(settingsSchema.parse(request.body));
    return settingsResponse();
  }),
);

app.get("/api/runs", route(() => getRuns()));

app.get("/api/documents", route(() => getLibrary()));

app.post(
  "/api/collect",
  route(async (request, response) => {
    const input = collectSchema.parse(request.body);
    if (input.dateFrom > input.dateTo) {
      response.status(400).json({ error: "From date must not be after To date." });
      return;
    }
    return collectDocuments(input);
  }),
);

app.get("/api/scripts", route(() => listScripts()));

app.post("/api/scripts", route((request) => generateScript(scriptSchema.parse(request.body))));

app.get(
  "/api/scripts/:name",
  route(async (request) => ({
    content: await fs.readFile(await scriptPath(String(request.params.name)), "utf8"),
  })),
);

app.put(
  "/api/scripts/:name",
  route(async (request) => {
    const { content } = z.object({ content: z.string() }).parse(request.body);
    await fs.writeFile(await scriptPath(String(request.params.name)), content);
    return { ok: true };
  }),
);

app.post("/api/audio", route((request) => generateAudio(audioSchema.parse(request.body))));

app.use(
  (
    error: unknown,
    _request: express.Request,
    response: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error(error);
    response.status(500).json({
      error: error instanceof Error ? error.message : "Unknown server error",
    });
  },
);

if (process.env.NODE_ENV === "production") {
  app.use(express.static(appPath("dist")));
  app.get("/{*splat}", (_request, response) => {
    response.sendFile(appPath("dist", "index.html"));
  });
}

const port = Number(process.env.PORT ?? 8787);
app.listen(port, () => {
  console.log(`Council Collector API listening at http://localhost:${port}`);
});
