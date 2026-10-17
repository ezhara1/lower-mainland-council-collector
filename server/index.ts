import path from "node:path";
import express from "express";
import cors from "cors";
import { z } from "zod";
import { loadRegistry } from "./sources.js";
import { getRuns, getSettings, saveSettings } from "./storage.js";
import { exchangeGoogleCode, googleAuthUrl } from "./google-drive.js";
import { runCollection } from "./runner.js";

const app = express();
app.use(cors());
app.use(express.json({ limit: "2mb" }));

const settingsSchema = z.object({
  googleClientId: z.string(),
  googleClientSecret: z.string(),
  googleDriveFolderId: z.string(),
  openRouterModel: z.string(),
});

const runSchema = z.object({
  sourceIds: z.array(z.string()).min(1),
  dateFrom: z.iso.date(),
  dateTo: z.iso.date(),
  summarize: z.boolean(),
  openRouterApiKey: z.string().optional(),
  openRouterModel: z.string().optional(),
  outputMode: z.enum(["summary", "podcast", "custom"]).optional(),
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
  generateAudio: z.boolean().optional(),
  ttsProvider: z.enum(["kokoro", "chatterbox"]).optional(),
  hostAVoice: z.string().optional(),
  hostBVoice: z.string().optional(),
  audioConcurrency: z.number().int().min(1).max(3).optional(),
  browserAssisted: z.boolean().optional(),
});

app.get("/api/health", (_request, response) => {
  response.json({ ok: true });
});

app.get("/api/sources", async (_request, response, next) => {
  try {
    response.json(await loadRegistry());
  } catch (error) {
    next(error);
  }
});

app.get("/api/settings", async (_request, response, next) => {
  try {
    const settings = await getSettings();
    response.json({
      googleClientId: settings.googleClientId,
      googleClientSecret: settings.googleClientSecret,
      googleDriveFolderId: settings.googleDriveFolderId,
      googleConnected: Boolean(settings.googleRefreshToken),
      openRouterModel: settings.openRouterModel,
    });
  } catch (error) {
    next(error);
  }
});

app.put("/api/settings", async (request, response, next) => {
  try {
    response.json(await saveSettings(settingsSchema.parse(request.body)));
  } catch (error) {
    next(error);
  }
});

app.get("/api/google/auth-url", async (_request, response, next) => {
  try {
    response.json({ url: googleAuthUrl(await getSettings()) });
  } catch (error) {
    next(error);
  }
});

app.get("/api/google/callback", async (request, response, next) => {
  try {
    const code = z.string().parse(request.query.code);
    const settings = await getSettings();
    const googleRefreshToken = await exchangeGoogleCode(settings, code);
    if (googleRefreshToken) await saveSettings({ googleRefreshToken });
    response.redirect("http://localhost:5173/?google=connected");
  } catch (error) {
    next(error);
  }
});

app.get("/api/runs", async (_request, response, next) => {
  try {
    response.json(await getRuns());
  } catch (error) {
    next(error);
  }
});

app.post("/api/run", async (request, response, next) => {
  try {
    const input = runSchema.parse(request.body);
    if (input.dateFrom > input.dateTo) {
      response.status(400).json({ error: "From date must not be after To date." });
      return;
    }
    response.json(await runCollection(input));
  } catch (error) {
    next(error);
  }
});

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
  app.use(express.static(path.resolve("dist")));
  app.get("*", (_request, response) => {
    response.sendFile(path.resolve("dist/index.html"));
  });
}

app.listen(8787, () => {
  console.log("Council Collector API listening at http://localhost:8787");
});
